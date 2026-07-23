import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatPhone } from '@/lib/whatsapp/aiSensyService';

/**
 * POST /api/whatsapp/enqueue
 *
 * Add a WhatsApp message to the queue for later processing.
 *
 * Body:
 * {
 *   userId?: string;           // User ID to look up phone
 *   phone?: string;            // Or direct phone number
 *   eventType: string;         // e.g., "ticket_created", "visitor_checkin"
 *   message?: string;          // Optional custom message
 *   ticketId?: string;          // Optional ticket reference
 *   templateParams?: string[]; // For template rendering
 * }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { userId, phone, eventType, message, ticketId, templateParams } = body;

  if (!eventType) {
    return NextResponse.json({ error: 'eventType is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  let phoneToUse: string | null = phone || null;
  let userIdToUse: string | null = userId || null;

  // Look up phone from userId if not provided
  if (!phoneToUse && userId) {
    const { data: user } = await admin
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();
    phoneToUse = user?.phone || null;
  }

  // If phone is provided, try to find userId
  if (!userIdToUse && phoneToUse) {
    const formatted = formatPhone(phoneToUse);
    if (formatted) {
      const { data: user } = await admin
        .from('users')
        .select('id')
        .eq('phone', formatted)
        .single();
      userIdToUse = user?.id || null;
    }
  }

  if (!phoneToUse) {
    return NextResponse.json(
      { error: 'phone or userId with a phone number is required' },
      { status: 400 }
    );
  }

  const formattedPhone = formatPhone(phoneToUse);
  if (!formattedPhone) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
  }

  // Create queue entry
  const { data, error } = await admin
    .from('whatsapp_queue')
    .insert({
      user_id: userIdToUse || '00000000-0000-0000-0000-000000000000',
      phone: formattedPhone,
      message: message || `[${eventType}] ${(templateParams || []).join(' | ')}`,
      event_type: eventType,
      ticket_id: ticketId || null,
      status: 'pending',
      retry_count: 0,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[WhatsApp Enqueue] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, queueId: data.id });
}
