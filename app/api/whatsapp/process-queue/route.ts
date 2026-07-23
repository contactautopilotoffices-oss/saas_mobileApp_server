import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/whatsapp/process-queue
 *
 * Process pending WhatsApp messages from the queue.
 * Called by Vercel Cron every minute.
 *
 * Security: Only accepts requests from Vercel Cron (verified via header)
 */

const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const AISENSY_ENABLED = process.env.AISENSY_ENABLED !== 'false';

function formatPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1);
  if (digits.startsWith('+')) return digits.slice(1);
  return digits;
}

async function sendAiSensyMessage(options: {
  phone: string;
  userName: string;
  campaignName: string;
  templateParams?: string[];
}): Promise<{ success: boolean; error?: string }> {
  if (!AISENSY_API_KEY) {
    return { success: false, error: 'AiSensy not configured' };
  }

  try {
    const response = await fetch(AISENSY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: AISENSY_API_KEY,
        campaignName: options.campaignName,
        destination: formatPhone(options.phone),
        userName: options.userName || 'User',
        source: 'FMS App',
        templateParams: options.templateParams,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function POST(request: NextRequest) {
  // Verify this is called by Vercel Cron
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Allow if no cron secret set, or if authorization header matches
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!AISENSY_ENABLED) {
    return NextResponse.json({ message: 'WhatsApp disabled', processed: 0 });
  }

  const admin = createAdminClient();
  let processed = 0;
  let sent = 0;
  let failed = 0;

  try {
    // Get pending messages (max 50 at a time)
    const { data: pending, error } = await admin
      .from('whatsapp_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('retry_count', 3)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('[WhatsApp Queue] Fetch error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    for (const msg of pending || []) {
      // Get user name
      const { data: user } = await admin
        .from('users')
        .select('full_name')
        .eq('id', msg.user_id)
        .single();

      // Send via AiSensy using event_type as campaign name
      const result = await sendAiSensyMessage({
        phone: msg.phone,
        userName: user?.full_name || 'User',
        campaignName: `fms_${msg.event_type}`,
        templateParams: msg.message ? [msg.message] : [],
      });

      if (result.success) {
        await admin
          .from('whatsapp_queue')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', msg.id);
        sent++;
      } else {
        const newRetryCount = msg.retry_count + 1;
        if (newRetryCount >= 3) {
          await admin
            .from('whatsapp_queue')
            .update({ status: 'failed', error: result.error, retry_count: newRetryCount })
            .eq('id', msg.id);
        } else {
          await admin
            .from('whatsapp_queue')
            .update({ error: result.error, retry_count: newRetryCount })
            .eq('id', msg.id);
        }
        failed++;
      }

      processed++;
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`[WhatsApp Queue] Processed: ${processed}, Sent: ${sent}, Failed: ${failed}`);
    return NextResponse.json({ processed, sent, failed });
  } catch (err: any) {
    console.error('[WhatsApp Queue] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
