import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { sendWhatsAppMessage, getUserPhone } from '@/lib/whatsapp/whatsappService';

/**
 * POST /api/whatsapp/send
 * Send WhatsApp message to a phone number or user ID
 *
 * Body: { phone?: string; userId?: string; message: string }
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (auth.response || !auth.user) {
    return auth.response ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { phone, userId, message } = body;

  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  let phoneToSend: string | null = phone || null;

  if (!phoneToSend && userId) {
    phoneToSend = await getUserPhone(userId);
  }

  if (!phoneToSend) {
    return NextResponse.json({ error: 'phone or userId required' }, { status: 400 });
  }

  const result = await sendWhatsAppMessage(phoneToSend, message);
  return NextResponse.json(result);
}
