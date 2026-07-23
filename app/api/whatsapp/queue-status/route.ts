import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/whatsapp/queue-status
 *
 * Get WhatsApp queue statistics
 */
export async function GET() {
  const admin = createAdminClient();

  const [pending, sent, failed] = await Promise.all([
    admin.from('whatsapp_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('whatsapp_queue').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
    admin.from('whatsapp_queue').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
  ]);

  return NextResponse.json({
    pending: pending.count || 0,
    sent: sent.count || 0,
    failed: failed.count || 0,
  });
}
