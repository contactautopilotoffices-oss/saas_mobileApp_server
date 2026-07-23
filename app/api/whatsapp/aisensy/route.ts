import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { sendAiSensyMessage, formatPhone } from '@/lib/whatsapp/aiSensyService';

/**
 * POST /api/whatsapp/aisensy
 *
 * Send a WhatsApp template message via AiSensy.
 * Requires an "API Campaign" to be created and set to Live in AiSensy dashboard.
 *
 * Body:
 * {
 *   phone?: string;            // Direct phone number
 *   userId?: string;           // OR user ID to look up phone from DB
 *   userName?: string;         // Name for AiSensy contact
 *   campaignName: string;      // Exact AiSensy API campaign name
 *   templateParams?: string[]; // Template variable values in order
 *   attributes?: Record<string, string>;
 *   media?: { url: string; filename?: string };
 * }
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (auth.response || !auth.user) {
    return auth.response ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { phone, userId, userName, campaignName, templateParams, attributes, media } = body;

  if (!campaignName) {
    return NextResponse.json({ error: 'campaignName is required' }, { status: 400 });
  }

  let phoneToSend: string | null = phone || null;
  let nameToUse: string = userName || 'User';

  // Look up phone from DB if userId given
  if (!phoneToSend && userId) {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient();
    const { data } = await admin.from('users').select('phone, full_name').eq('id', userId).single();
    phoneToSend = data?.phone || null;
    nameToUse = data?.full_name || nameToUse;
  }

  if (!phoneToSend) {
    return NextResponse.json({ error: 'phone or userId with a phone number is required' }, { status: 400 });
  }

  const result = await sendAiSensyMessage({
    phone: phoneToSend,
    userName: nameToUse,
    campaignName,
    templateParams,
    attributes,
    media,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
