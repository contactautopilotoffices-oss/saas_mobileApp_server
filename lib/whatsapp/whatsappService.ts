/**
 * WhatsApp Wasender API Service
 * Sends ticket/PPM notifications via WhatsApp
 */

import { createAdminClient } from '@/lib/supabase/admin';

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || 'https://wasenderapi.com/api';
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY;
const WHATSAPP_SENDER_ID = process.env.WHATSAPP_SENDER_ID;
const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED !== 'false';

// Format Indian phone: 10 digits → 91XXXXXXXXXX
function formatPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '+91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  if (digits.length === 11 && digits.startsWith('0')) return '+91' + digits.slice(1);
  return '+' + digits;
}

// ── Send WhatsApp Message ──────────────────────────────────────────────────────

export interface WhatsAppResult {
  success: boolean;
  error?: string;
}

export async function sendWhatsAppMessage(
  phone: string,
  message: string
): Promise<WhatsAppResult> {
  if (!WHATSAPP_ENABLED) {
    console.log('[WhatsApp] Disabled, skipping send');
    return { success: false, error: 'WhatsApp disabled' };
  }

  if (!WHATSAPP_API_KEY || !WHATSAPP_SENDER_ID) {
    console.warn('[WhatsApp] Not configured (WHATSAPP_API_KEY or WHATSAPP_SENDER_ID missing');
    return { success: false, error: 'WhatsApp not configured' };
  }

  const formattedPhone = formatPhone(phone);
  if (!formattedPhone) {
    return { success: false, error: 'Invalid phone number' };
  }

  try {
    const response = await fetch(`${WHATSAPP_API_URL}/send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WHATSAPP_API_KEY}`,
      },
      body: JSON.stringify({
        to: formattedPhone,
        text: message,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[WhatsApp] Send failed:', error);
      return { success: false, error };
    }

    return { success: true };
  } catch (err: any) {
    console.error('[WhatsApp] Error:', err);
    return { success: false, error: err.message };
  }
}

// ── Ticket Notifications ───────────────────────────────────────────────────────

export async function notifyTicketCreated(
  phone: string,
  ticketNumber: string,
  title: string,
  propertyName: string
): Promise<WhatsAppResult> {
  const message = `🔔 *New Ticket Created*

🎫 ${ticketNumber}
📋 ${title}
🏢 ${propertyName}

You'll be notified when there's an update.`;
  return sendWhatsAppMessage(phone, message);
}

export async function notifyTicketAssigned(
  phone: string,
  ticketNumber: string,
  title: string,
  priority: string,
  propertyName: string
): Promise<WhatsAppResult> {
  const emoji = priority === 'critical' ? '🔴' : priority === 'high' ? '🟠' : '🟡';
  const message = `${emoji} *Ticket Assigned to You*

🎫 ${ticketNumber}
📋 ${title}
🏢 ${propertyName}
⚡ Priority: ${priority.toUpperCase()}

Please acknowledge and start working on this.`;
  return sendWhatsAppMessage(phone, message);
}

export async function notifyTicketCompleted(
  phone: string,
  ticketNumber: string,
  title: string,
  propertyName: string
): Promise<WhatsAppResult> {
  const message = `✅ *Ticket Resolved*

🎫 ${ticketNumber}
📋 ${title}
🏢 ${propertyName}

Your ticket has been marked as resolved. Please verify and close if satisfied.`;
  return sendWhatsAppMessage(phone, message);
}

// ── PPM Notifications ─────────────────────────────────────────────────────────

export async function notifyPPMTaskDue(
  phone: string,
  scheduleName: string,
  propertyName: string,
  dueDate: string
): Promise<WhatsAppResult> {
  const message = `⏰ *PPM Task Due*

📋 ${scheduleName}
🏢 ${propertyName}
📅 Due: ${dueDate}

Please complete the preventive maintenance task on time.`;
  return sendWhatsAppMessage(phone, message);
}

export async function notifyPPMTaskCompleted(
  phone: string,
  scheduleName: string,
  propertyName: string,
  completedBy: string
): Promise<WhatsAppResult> {
  const message = `✅ *PPM Task Completed*

📋 ${scheduleName}
🏢 ${propertyName}
👤 By: ${completedBy}

Task marked as done.`;
  return sendWhatsAppMessage(phone, message);
}

// ── Meeting Room Notifications ────────────────────────────────────────────────

export async function notifyMeetingRoomBookedUser(
  userId: string,
  roomName: string,
  propertyName: string,
  date: string,
  time: string
): Promise<WhatsAppResult> {
  const message = `✅ *Meeting Room Booked*

🏢 ${propertyName}
🚪 ${roomName}
📅 ${date}
⏰ ${time}

Your booking is confirmed!`;
  return notifyUser(userId, message);
}

export async function notifyMeetingRoomBookedAdmin(
  userId: string,
  roomName: string,
  propertyName: string,
  date: string,
  time: string,
  bookedBy: string
): Promise<WhatsAppResult> {
  const message = `🏢 *New Meeting Room Booking*

🚪 Room: ${roomName}
📅 Date: ${date}
⏰ Time: ${time}
👤 Booked By: ${bookedBy}

This booking has been confirmed.`;
  return notifyUser(userId, message);
}

// ── Fetch user phone from DB ────────────────────────────────────────────────────

export async function getUserPhone(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('users')
    .select('phone')
    .eq('id', userId)
    .single();

  return data?.phone || null;
}

export async function notifyUser(
  userId: string,
  message: string
): Promise<WhatsAppResult> {
  const phone = await getUserPhone(userId);
  if (!phone) {
    return { success: false, error: 'User has no phone number' };
  }
  return sendWhatsAppMessage(phone, message);
}
