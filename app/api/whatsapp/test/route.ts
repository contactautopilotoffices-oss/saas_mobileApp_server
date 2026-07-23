import { NextRequest, NextResponse } from 'next/server';
import { sendAiSensyMessage, formatPhone } from '@/lib/whatsapp/aiSensyService';

/**
 * POST /api/whatsapp/test
 *
 * Test AiSensy integration with a sample message.
 * Only for testing - should be disabled in production.
 *
 * Body:
 * {
 *   phone: string;              // Phone number to test
 *   campaignName?: string;      // Campaign name (default: fms_ticket_created)
 *   templateParams?: string[]; // Template params
 * }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { phone, campaignName, templateParams } = body;

  if (!phone) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 });
  }

  const formattedPhone = formatPhone(phone);
  if (!formattedPhone) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
  }

  const result = await sendAiSensyMessage({
    phone: formattedPhone,
    userName: 'Test User',
    campaignName: campaignName || 'fms_ticket_created',
    templateParams: templateParams || [
      'TKT-TEST',
      'Test User',
      'Test Property',
      'Test Issue',
      '27 Jun 2026',
    ],
  });

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
