import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/webhooks/aisensy
 *
 * Receives real-time events from AiSensy:
 *   - message.created        → a message was sent out
 *   - message.status.updated → delivery/read receipt
 *   - message.sender.user    → a user sent a message TO your business
 *   - contact.created        → new contact created
 *   - contact.attribute.revised → contact attributes changed
 *
 * AiSensy Configuration:
 *   In AiSensy Dashboard → Settings → Webhooks:
 *   URL: https://your-server.com/api/webhooks/aisensy
 *   Topics: message.created, message.status.updated, message.sender.user
 *
 * Security:
 *   Set AISENSY_WEBHOOK_SECRET in your .env and also add it to the
 *   AiSensy webhook secret field. We verify the X-AiSensy-Signature header.
 */

const AISENSY_WEBHOOK_SECRET = process.env.AISENSY_WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
  try {
    // ── 1. Verify signature ────────────────────────────────────────────────
    const signature = request.headers.get('x-aisensy-signature');
    if (AISENSY_WEBHOOK_SECRET && signature !== AISENSY_WEBHOOK_SECRET) {
      console.warn('[AiSensy Webhook] Invalid signature:', signature);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── 2. Parse payload ───────────────────────────────────────────────────
    const payload = await request.json();
    const { topic, project_id, id: eventId, created_at } = payload;

    console.log(`[AiSensy Webhook] Event: ${topic} | project: ${project_id} | id: ${eventId}`);

    // ── 3. Route by topic ──────────────────────────────────────────────────
    switch (topic) {
      case 'message.sender.user': {
        // A user (customer) sent a message to your WhatsApp Business number
        await handleIncomingUserMessage(payload);
        break;
      }

      case 'message.status.updated': {
        // Delivery/read receipt update
        await handleMessageStatusUpdate(payload);
        break;
      }

      case 'message.created': {
        // Message sent out (by AiSensy, agent, broadcast)
        // Usually used for logging — no action required
        console.log('[AiSensy Webhook] Message created:', payload?.data?.id);
        break;
      }

      case 'contact.created': {
        // New WhatsApp contact added to AiSensy
        console.log('[AiSensy Webhook] Contact created:', payload?.data?.phone);
        break;
      }

      case 'contact.attribute.revised': {
        // Contact attributes updated
        console.log('[AiSensy Webhook] Contact attributes updated');
        break;
      }

      default:
        console.log('[AiSensy Webhook] Unknown topic:', topic);
    }

    // ── 4. Always return 200 quickly ───────────────────────────────────────
    return NextResponse.json({ received: true, topic }, { status: 200 });
  } catch (err: any) {
    console.error('[AiSensy Webhook] Error:', err);
    // Still return 200 so AiSensy doesn't keep retrying
    return NextResponse.json({ received: true, error: err.message }, { status: 200 });
  }
}

// ── GET: Verification endpoint (AiSensy may call GET to verify URL is live) ────
export async function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get('challenge');
  if (challenge) {
    return new Response(challenge, { status: 200 });
  }
  return NextResponse.json({ status: 'AiSensy webhook endpoint is live' }, { status: 200 });
}

// ── Handlers ───────────────────────────────────────────────────────────────────

async function handleIncomingUserMessage(payload: any) {
  const data = payload?.data ?? {};
  const from = data?.from ?? data?.phone;          // sender's WhatsApp number
  const messageObj = data?.message ?? data?.text;
  const messageText =
    typeof messageObj === 'string'
      ? messageObj
      : messageObj?.text?.body ?? messageObj?.body ?? JSON.stringify(messageObj);

  console.log(`[AiSensy Webhook] Incoming message from ${from}: "${messageText}"`);

  if (!from || !messageText) return;

  try {
    const admin = createAdminClient();

    // Look up user by phone number
    const digitsOnly = from.replace(/\D/g, '');
    const phoneVariants = [
      digitsOnly,
      '+' + digitsOnly,
      digitsOnly.startsWith('91') ? digitsOnly.slice(2) : null,
    ].filter(Boolean);

    let userId: string | null = null;
    for (const variant of phoneVariants) {
      const { data: user } = await admin
        .from('users')
        .select('id')
        .eq('phone', variant)
        .maybeSingle();
      if (user?.id) {
        userId = user.id;
        break;
      }
    }

    try {
      await admin.from('whatsapp_inbound_messages').insert({
        from_phone: from,
        message_text: messageText,
        message_raw: payload,
        user_id: userId,
        source: 'aisensy',
        received_at: new Date().toISOString(),
      }).throwOnError();
      console.log('[AiSensy Webhook] Inbound message stored');
    } catch (err: any) {
      // Table may not exist yet — just log, don't fail
      console.warn('[AiSensy Webhook] Could not store inbound message (table may not exist):', err.message);
    }
  } catch (err: any) {
    console.error('[AiSensy Webhook] handleIncomingUserMessage error:', err);
  }
}

async function handleMessageStatusUpdate(payload: any) {
  const data = payload?.data ?? {};
  const status = data?.status;                    // sent, delivered, read, failed
  const messageId = data?.id ?? data?.message_id;
  const phone = data?.to ?? data?.destination;

  console.log(`[AiSensy Webhook] Status update — ${messageId}: ${status} → ${phone}`);

  // Optional: store delivery receipts
  if (!messageId || !status) return;

  try {
    const admin = createAdminClient();
    try {
      await admin.from('whatsapp_message_status').upsert({
        message_id: messageId,
        status,
        phone,
        updated_at: new Date().toISOString(),
        raw: payload,
      }, { onConflict: 'message_id' }).throwOnError();
      console.log(`[AiSensy Webhook] Status stored: ${messageId} → ${status}`);
    } catch (err: any) {
      console.warn('[AiSensy Webhook] Could not store status (table may not exist):', err.message);
    }
  } catch (err: any) {
    console.error('[AiSensy Webhook] handleMessageStatusUpdate error:', err);
  }
}
