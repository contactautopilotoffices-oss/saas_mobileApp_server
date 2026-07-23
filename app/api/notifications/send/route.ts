/**
 * POST /api/notifications/send
 * Send push notification to user(s)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { sendPushNotification, NOTIFICATION_TYPES } from '@/lib/notificationService';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, userIds, role, propertyId, organizationId, type, title, message, deepLink, ticketId, bookingId, priority } = body;

    // Validate required fields
    if (!type || !title || !message) {
      return NextResponse.json({ error: 'type, title, and message are required' }, { status: 400 });
    }

    // Validate notification type
    const validTypes = Object.values(NOTIFICATION_TYPES);
    if (!validTypes.includes(type) && !type.includes('_')) {
      return NextResponse.json({
        error: 'Invalid notification type',
        validTypes
      }, { status: 400 });
    }

    // Send notification
    const result = await sendPushNotification({
      userId,
      userIds,
      role,
      propertyId,
      organizationId,
      type,
      title,
      message,
      deepLink,
      ticketId,
      bookingId,
      priority: priority || 'NORMAL',
    });

    if (!result.success) {
      return NextResponse.json({
        error: 'Failed to send notification',
        details: result.errors
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      notificationsCreated: result.notificationsCreated,
      pushNotificationsSent: result.pushNotificationsSent,
    });

  } catch (err: any) {
    console.error('[Notifications] Send error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}