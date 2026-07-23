/**
 * Notification Service — Firebase Admin SDK Integration
 *
 * Handles sending push notifications via FCM v1 API.
 * Notification types:
 *   - ticket_created, ticket_assigned, ticket_updated, ticket_resolved, ticket_closed
 *   - ticket_sla_breached, ticket_commented
 *   - ppm_due, ppm_overdue, ppm_completed
 *   - material_request_created, material_request_approved, material_request_rejected
 *   - meeting_room_booked, meeting_room_cancelled, meeting_room_reminder
 *   - visitor_checkin, visitor_checkout, visitor_expected
 *   - shift_started, shift_ended, shift_reminder
 *   - announcement, system_alert
 */

import { createAdminClient } from '@/lib/supabase/admin';
import * as admin from 'firebase-admin';

// Lazy Firebase Admin initialization
function getFirebaseAdmin() {
  if (!admin.apps.length) {
    if (!process.env.FIREBASE_PROJECT_ID) {
      console.warn('[Notifications] Firebase env vars missing. Push notifications disabled.');
      return null;
    }
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')!,
        }),
      });
      console.log('[Notifications] Firebase Admin initialized');
    } catch (err) {
      console.error('[Notifications] Firebase Admin init error:', err);
      return null;
    }
  }
  return admin;
}

// Notification type constants
export const NOTIFICATION_TYPES = {
  // Tickets
  TICKET_CREATED: 'ticket_created',
  TICKET_ASSIGNED: 'ticket_assigned',
  TICKET_UPDATED: 'ticket_updated',
  TICKET_RESOLVED: 'ticket_resolved',
  TICKET_CLOSED: 'ticket_closed',
  TICKET_SLA_BREACHED: 'ticket_sla_breached',
  TICKET_COMMENTED: 'ticket_commented',

  // PPM
  PPM_DUE: 'ppm_due',
  PPM_OVERDUE: 'ppm_overdue',
  PPM_COMPLETED: 'ppm_completed',

  // Material Requests
  MATERIAL_REQUEST_CREATED: 'material_request_created',
  MATERIAL_REQUEST_APPROVED: 'material_request_approved',
  MATERIAL_REQUEST_REJECTED: 'material_request_rejected',

  // Meeting Rooms
  MEETING_ROOM_BOOKED: 'meeting_room_booked',
  MEETING_ROOM_CANCELLED: 'meeting_room_cancelled',
  MEETING_ROOM_REMINDER: 'meeting_room_reminder',

  // Visitors
  VISITOR_CHECKIN: 'visitor_checkin',
  VISITOR_CHECKOUT: 'visitor_checkout',
  VISITOR_EXPECTED: 'visitor_expected',

  // Shifts
  SHIFT_STARTED: 'shift_started',
  SHIFT_ENDED: 'shift_ended',
  SHIFT_REMINDER: 'shift_reminder',

  // General
  ANNOUNCEMENT: 'announcement',
  SYSTEM_ALERT: 'system_alert',
} as const;

export type NotificationType = typeof NOTIFICATION_TYPES[keyof typeof NOTIFICATION_TYPES];

export interface NotificationPayload {
  userId?: string;
  userIds?: string[];
  role?: string;
  propertyId?: string;
  organizationId?: string;
  type: NotificationType | string;
  title: string;
  message: string;
  deepLink?: string;
  ticketId?: string;
  bookingId?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
}

export interface SendResult {
  success: boolean;
  notificationsCreated: number;
  pushNotificationsSent: number;
  errors?: string[];
}

/**
 * Send push notification to user(s)
 */
export async function sendPushNotification(payload: NotificationPayload): Promise<SendResult> {
  const supabase = createAdminClient();
  const result: SendResult = {
    success: false,
    notificationsCreated: 0,
    pushNotificationsSent: 0,
    errors: [],
  };

  try {
    // Determine target user IDs
    let targetUserIds: string[] = [];

    if (payload.userId) {
      targetUserIds = [payload.userId];
    } else if (payload.userIds?.length) {
      targetUserIds = payload.userIds;
    } else if (payload.role && payload.propertyId) {
      // Get users by role at property
      const { data: members } = await supabase
        .from('property_memberships')
        .select('user_id')
        .eq('property_id', payload.propertyId)
        .eq('role', payload.role);

      targetUserIds = members?.map(m => m.user_id) || [];
    }

    if (targetUserIds.length === 0) {
      result.errors?.push('No target users found');
      return result;
    }

    // Create notification records
    const notificationRecords = targetUserIds.map(uid => ({
      user_id: uid,
      ticket_id: payload.ticketId || null,
      booking_id: payload.bookingId || null,
      property_id: payload.propertyId || null,
      organization_id: payload.organizationId || null,
      notification_type: payload.type,
      title: payload.title,
      message: payload.message,
      deep_link: payload.deepLink || null,
      is_read: false,
      priority: payload.priority?.toLowerCase() || 'normal',
    }));

    const { data: notifications, error: insertError } = await supabase
      .from('notifications')
      .insert(notificationRecords)
      .select();

    if (insertError) {
      result.errors?.push(`Failed to create notification records: ${insertError.message}`);
      return result;
    }

    result.notificationsCreated = notifications?.length || 0;

    // Get active push tokens for target users
    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('user_id, token, is_active')
      .in('user_id', targetUserIds)
      .eq('is_active', true);

    if (!tokens?.length) {
      result.success = true;
      return result;
    }

    // Send push notifications via FCM
    const fcmPriority: 'high' | 'normal' =
      (payload.priority === 'CRITICAL' || payload.priority === 'HIGH') ? 'high' : 'normal';

    const firebase = getFirebaseAdmin();
    if (!firebase) {
      result.errors?.push('Firebase Admin not configured');
      return result;
    }

    for (const tokenRecord of tokens) {
      const notification = notifications?.find(n => n.user_id === tokenRecord.user_id) || notifications?.[0];
      if (!notification || !tokenRecord.token) continue;

      const message: admin.messaging.Message = {
        token: tokenRecord.token,
        notification: {
          title: payload.title,
          body: payload.message,
        },
        data: {
          notificationId: notification.id,
          type: payload.type,
          deepLink: payload.deepLink || '',
          ticketId: payload.ticketId || '',
          bookingId: payload.bookingId || '',
          propertyId: payload.propertyId || '',
        },
        android: {
          priority: fcmPriority,
          notification: {
            // Must match a channel the app creates (only 'default' and 'critical'
            // exist). Posting to a missing channel is silently dropped on Android 8+.
            channelId: payload.priority === 'CRITICAL' ? 'critical' : 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: payload.priority === 'CRITICAL' ? 'emergency.caf' : 'default',
              'content-available': 1,
            },
          },
        },
      };

      try {
        await firebase.messaging().send(message);
        result.pushNotificationsSent++;

        // Record delivery
        await supabase
          .from('notification_delivery')
          .insert({
            notification_id: notification.id,
            push_token: tokenRecord.token,
            delivery_status: 'DELIVERED',
          });
      } catch (sendErr: any) {
        console.error('[Notifications] FCM send error:', sendErr.message);

        // Mark invalid tokens as inactive
        if (
          sendErr.code === 'messaging/invalid-registration-token' ||
          sendErr.code === 'messaging/registration-token-not-registered'
        ) {
          await supabase
            .from('push_tokens')
            .update({ is_active: false })
            .eq('token', tokenRecord.token);
        }

        result.errors?.push(`Failed to send to ${tokenRecord.token.slice(0, 20)}...: ${sendErr.message}`);
      }
    }

    result.success = true;
    return result;

  } catch (err: any) {
    console.error('[Notifications] sendPushNotification error:', err);
    result.errors?.push(err.message);
    return result;
  }
}

/**
 * Send ticket assigned notification
 */
export async function notifyTicketAssigned(
  ticketId: string,
  ticketNumber: string,
  ticketTitle: string,
  assignedUserId: string,
  propertyId: string,
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL' = 'NORMAL'
): Promise<SendResult> {
  return sendPushNotification({
    userId: assignedUserId,
    propertyId,
    type: NOTIFICATION_TYPES.TICKET_ASSIGNED,
    title: `New Ticket Assigned: ${ticketNumber}`,
    message: ticketTitle,
    deepLink: `/property/${propertyId}/tickets/${ticketId}`,
    ticketId,
    priority,
  });
}

/**
 * Send ticket created notification
 */
export async function notifyTicketCreated(
  ticketId: string,
  ticketNumber: string,
  ticketTitle: string,
  createdByUserId: string,
  propertyId: string,
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL' = 'NORMAL'
): Promise<SendResult> {
  return sendPushNotification({
    userId: createdByUserId,
    propertyId,
    type: NOTIFICATION_TYPES.TICKET_CREATED,
    title: `Ticket Created: ${ticketNumber}`,
    message: `Your ticket "${ticketTitle}" has been submitted`,
    deepLink: `/property/${propertyId}/tickets/${ticketId}`,
    ticketId,
    priority,
  });
}

/**
 * Send PPM due notification
 */
export async function notifyPPMDue(
  ppmId: string,
  systemName: string,
  plannedDate: string,
  userId: string,
  propertyId: string
): Promise<SendResult> {
  return sendPushNotification({
    userId,
    propertyId,
    type: NOTIFICATION_TYPES.PPM_DUE,
    title: 'PPM Due Today',
    message: `${systemName} maintenance is scheduled for ${plannedDate}`,
    deepLink: `/property/${propertyId}/ppm/${ppmId}`,
    priority: 'NORMAL',
  });
}

/**
 * Send PPM overdue notification
 */
export async function notifyPPMOverdue(
  ppmId: string,
  systemName: string,
  plannedDate: string,
  userId: string,
  propertyId: string
): Promise<SendResult> {
  return sendPushNotification({
    userId,
    propertyId,
    type: NOTIFICATION_TYPES.PPM_OVERDUE,
    title: 'PPM Overdue',
    message: `${systemName} maintenance was due on ${plannedDate} and is now overdue`,
    deepLink: `/property/${propertyId}/ppm/${ppmId}`,
    priority: 'HIGH',
  });
}

/**
 * Send visitor check-in notification
 */
export async function notifyVisitorCheckin(
  visitorId: string,
  visitorName: string,
  hostUserId: string,
  propertyId: string
): Promise<SendResult> {
  return sendPushNotification({
    userId: hostUserId,
    propertyId,
    type: NOTIFICATION_TYPES.VISITOR_CHECKIN,
    title: 'Visitor Arrived',
    message: `${visitorName} has checked in and is waiting for you`,
    deepLink: `/property/${propertyId}/visitors/${visitorId}`,
    priority: 'NORMAL',
  });
}

/**
 * Send visitor expected notification
 */
export async function notifyVisitorExpected(
  visitorId: string,
  visitorName: string,
  expectedTime: string,
  hostUserId: string,
  propertyId: string
): Promise<SendResult> {
  return sendPushNotification({
    userId: hostUserId,
    propertyId,
    type: NOTIFICATION_TYPES.VISITOR_EXPECTED,
    title: 'Expected Visitor',
    message: `${visitorName} is expected at ${expectedTime}`,
    deepLink: `/property/${propertyId}/visitors/${visitorId}`,
    priority: 'NORMAL',
  });
}

/**
 * Send meeting room booked notification
 */
export async function notifyMeetingRoomBooked(
  bookingId: string,
  roomName: string,
  startTime: string,
  userId: string,
  propertyId: string
): Promise<SendResult> {
  return sendPushNotification({
    userId,
    propertyId,
    type: NOTIFICATION_TYPES.MEETING_ROOM_BOOKED,
    title: 'Room Booked',
    message: `Your booking for ${roomName} starts at ${startTime}`,
    deepLink: `/property/${propertyId}/rooms/${bookingId}`,
    bookingId,
    priority: 'NORMAL',
  });
}

/**
 * Send meeting room reminder notification
 */
export async function notifyMeetingRoomReminder(
  bookingId: string,
  roomName: string,
  startTime: string,
  userId: string,
  propertyId: string
): Promise<SendResult> {
  return sendPushNotification({
    userId,
    propertyId,
    type: NOTIFICATION_TYPES.MEETING_ROOM_REMINDER,
    title: 'Meeting Reminder',
    message: `Your meeting in ${roomName} starts in 15 minutes at ${startTime}`,
    deepLink: `/property/${propertyId}/rooms/${bookingId}`,
    bookingId,
    priority: 'NORMAL',
  });
}

/**
 * Send material request created notification
 */
export async function notifyMaterialRequestCreated(
  requestId: string,
  itemName: string,
  requestedBy: string,
  approverUserId: string,
  propertyId: string
): Promise<SendResult> {
  return sendPushNotification({
    userId: approverUserId,
    propertyId,
    type: NOTIFICATION_TYPES.MATERIAL_REQUEST_CREATED,
    title: 'Material Request Pending',
    message: `${requestedBy} has requested: ${itemName}`,
    deepLink: `/property/${propertyId}/stock/${requestId}`,
    priority: 'NORMAL',
  });
}

/**
 * Send material request approved notification
 */
export async function notifyMaterialRequestApproved(
  requestId: string,
  itemName: string,
  requesterUserId: string,
  propertyId: string
): Promise<SendResult> {
  return sendPushNotification({
    userId: requesterUserId,
    propertyId,
    type: NOTIFICATION_TYPES.MATERIAL_REQUEST_APPROVED,
    title: 'Request Approved',
    message: `Your request for ${itemName} has been approved`,
    deepLink: `/property/${propertyId}/stock/${requestId}`,
    priority: 'NORMAL',
  });
}

/**
 * Broadcast notification to all users with a specific role at a property
 */
export async function notifyPropertyRole(
  role: string,
  propertyId: string,
  type: NotificationType | string,
  title: string,
  message: string,
  deepLink?: string,
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL' = 'NORMAL'
): Promise<SendResult> {
  return sendPushNotification({
    role,
    propertyId,
    type,
    title,
    message,
    deepLink,
    priority,
  });
}