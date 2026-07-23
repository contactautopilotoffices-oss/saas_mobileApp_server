/**
 * AiSensy WhatsApp Business Integration Service
 * API Docs: https://backend.aisensy.com/campaign/t1/api/v2
 *
 * Flow:
 * 1. Create a template in WhatsApp Business Manager
 * 2. Create an "API Campaign" in AiSensy dashboard pointing to that template
 * 3. Set the campaign to "Live"
 * 4. Call this service with the campaign name + phone + template params
 */

import { createAdminClient } from '@/lib/supabase/admin';

// ── Config ─────────────────────────────────────────────────────────────────────
const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const AISENSY_SOURCE = process.env.AISENSY_SOURCE || 'FMS App';
const AISENSY_ENABLED = process.env.AISENSY_ENABLED !== 'false';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AiSensyPayload {
  /** Your AiSensy API Key from dashboard → Manage → API Key */
  apiKey: string;
  /** Exact name of the "API Campaign" (must be Live) in AiSensy */
  campaignName: string;
  /** Phone number with country code e.g. +917428526285 */
  destination: string;
  /** Contact display name stored inside AiSensy */
  userName: string;
  /** Optional source label (appears in AiSensy analytics) */
  source?: string;
  /** Template variable replacements, in order of {{1}}, {{2}} etc. */
  templateParams?: string[];
  /** Optional extra attributes stored on the AiSensy contact */
  attributes?: Record<string, string>;
  /** Optional media URL for templates with header image/document */
  media?: {
    url: string;
    filename?: string;
  };
}

export interface AiSensyResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ── Phone formatter ─────────────────────────────────────────────────────────────

export function formatPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;                          // 10-digit → 91XXXXXXXXXX
  if (digits.length === 12 && digits.startsWith('91')) return digits;      // already 91...
  if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1);
  if (digits.startsWith('+')) return digits.slice(1);                      // strip leading +
  return digits;
}

// ── Core send function ─────────────────────────────────────────────────────────

export async function sendAiSensyMessage(options: {
  phone: string;
  userName: string;
  campaignName: string;
  templateParams?: string[];
  attributes?: Record<string, string>;
  media?: { url: string; filename?: string };
}): Promise<AiSensyResult> {
  if (!AISENSY_ENABLED) {
    console.log('[AiSensy] WhatsApp disabled — skipping send');
    return { success: false, error: 'AiSensy WhatsApp disabled' };
  }

  if (!AISENSY_API_KEY) {
    console.warn('[AiSensy] AISENSY_API_KEY not configured');
    return { success: false, error: 'AiSensy not configured — missing AISENSY_API_KEY' };
  }

  const destination = formatPhone(options.phone);
  if (!destination) {
    return { success: false, error: 'Invalid phone number' };
  }

  const payload: AiSensyPayload = {
    apiKey: AISENSY_API_KEY,
    campaignName: options.campaignName,
    destination,
    userName: options.userName || 'User',
    source: AISENSY_SOURCE,
    templateParams: options.templateParams,
    attributes: options.attributes,
    media: options.media,
  };

  try {
    console.log(`[AiSensy] Sending "${options.campaignName}" to ${destination}`);

    const response = await fetch(AISENSY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[AiSensy] Send failed (${response.status}):`, responseText);
      return { success: false, error: `HTTP ${response.status}: ${responseText}` };
    }

    let parsed: any = {};
    try { parsed = JSON.parse(responseText); } catch {}

    console.log(`[AiSensy] Message sent successfully — ${destination}`);
    return { success: true, messageId: parsed?.id || parsed?.message_id };
  } catch (err: any) {
    console.error('[AiSensy] Network error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Fetch user info from DB ─────────────────────────────────────────────────────

export async function getUserContactInfo(userId: string): Promise<{
  phone: string | null;
  fullName: string;
}> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('users')
    .select('phone, full_name')
    .eq('id', userId)
    .single();

  return {
    phone: data?.phone || null,
    fullName: data?.full_name || 'User',
  };
}

// ── High-level notification helpers ────────────────────────────────────────────
// Each corresponds to an API Campaign you must create in AiSensy dashboard.
// Campaign names below are suggested names — match them exactly with what
// you create in the AiSensy dashboard.

/**
 * Campaign: fms_ticket_created
 * Template params: [ticketNumber, title, propertyName]
 */
export async function notifyTicketCreated_AiSensy(
  userId: string,
  ticketNumber: string,
  title: string,
  propertyName: string
): Promise<AiSensyResult> {
  const { phone, fullName } = await getUserContactInfo(userId);
  if (!phone) return { success: false, error: 'No phone number for user' };
  return sendAiSensyMessage({
    phone,
    userName: fullName,
    campaignName: 'fms_ticket_created',
    templateParams: [ticketNumber, title, propertyName],
  });
}

/**
 * Campaign: fms_ticket_assigned
 * Template params: [ticketNumber, title, priority, propertyName]
 */
export async function notifyTicketAssigned_AiSensy(
  userId: string,
  ticketNumber: string,
  title: string,
  priority: string,
  propertyName: string
): Promise<AiSensyResult> {
  const { phone, fullName } = await getUserContactInfo(userId);
  if (!phone) return { success: false, error: 'No phone number for user' };
  return sendAiSensyMessage({
    phone,
    userName: fullName,
    campaignName: 'fms_ticket_assigned',
    templateParams: [ticketNumber, title, priority.toUpperCase(), propertyName],
  });
}

/**
 * Campaign: fms_ticket_resolved
 * Template params: [ticketNumber, title, propertyName]
 */
export async function notifyTicketResolved_AiSensy(
  userId: string,
  ticketNumber: string,
  title: string,
  propertyName: string
): Promise<AiSensyResult> {
  const { phone, fullName } = await getUserContactInfo(userId);
  if (!phone) return { success: false, error: 'No phone number for user' };
  return sendAiSensyMessage({
    phone,
    userName: fullName,
    campaignName: 'fms_ticket_resolved',
    templateParams: [ticketNumber, title, propertyName],
  });
}

/**
 * Campaign: fms_visitor_checkin
 * Template params: [visitorName, checkInTime, purpose]
 * → Notify host on visitor arrival
 */
export async function notifyVisitorCheckIn_AiSensy(options: {
  hostUserId: string;
  visitorName: string;
  checkInTime: string;
  purpose?: string;
}): Promise<AiSensyResult> {
  const { phone, fullName } = await getUserContactInfo(options.hostUserId);
  if (!phone) return { success: false, error: 'No phone number for host' };
  return sendAiSensyMessage({
    phone,
    userName: fullName,
    campaignName: 'fms_visitor_checkin',
    templateParams: [options.visitorName, options.checkInTime, options.purpose || 'N/A'],
  });
}

/**
 * Campaign: fms_meeting_room_booked
 * Template params: [roomName, date, time, propertyName]
 */
export async function notifyMeetingRoomBooked_AiSensy(
  userId: string,
  roomName: string,
  date: string,
  time: string,
  propertyName: string
): Promise<AiSensyResult> {
  const { phone, fullName } = await getUserContactInfo(userId);
  if (!phone) return { success: false, error: 'No phone number for user' };
  return sendAiSensyMessage({
    phone,
    userName: fullName,
    campaignName: 'fms_meeting_room_booked',
    templateParams: [roomName, date, time, propertyName],
  });
}

/**
 * Campaign: fms_ppm_due
 * Template params: [scheduleName, dueDate, propertyName]
 */
export async function notifyPPMDue_AiSensy(
  userId: string,
  scheduleName: string,
  dueDate: string,
  propertyName: string
): Promise<AiSensyResult> {
  const { phone, fullName } = await getUserContactInfo(userId);
  if (!phone) return { success: false, error: 'No phone number for user' };
  return sendAiSensyMessage({
    phone,
    userName: fullName,
    campaignName: 'fms_ppm_due',
    templateParams: [scheduleName, dueDate, propertyName],
  });
}

/**
 * Campaign: fms_checklist_due
 * Template params: [checklistTitle, propertyName, dueTime]
 */
export async function notifyChecklistDue_AiSensy(
  userId: string,
  checklistTitle: string,
  propertyName: string,
  dueTime: string
): Promise<AiSensyResult> {
  const { phone, fullName } = await getUserContactInfo(userId);
  if (!phone) return { success: false, error: 'No phone number for user' };
  return sendAiSensyMessage({
    phone,
    userName: fullName,
    campaignName: 'fms_checklist_due',
    templateParams: [checklistTitle, propertyName, dueTime],
  });
}
