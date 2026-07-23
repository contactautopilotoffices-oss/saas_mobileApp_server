import { NextRequest, NextResponse } from 'next/server';
import { sendPushNotification, NOTIFICATION_TYPES } from '@/lib/notificationService';

// To secure the webhook, you should configure a secret in your Supabase Webhook HTTP headers
// e.g. x-webhook-secret: YOUR_SECRET_HERE
// and add WEBHOOK_SECRET to your mobile backend .env
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
  try {
    // 1. Verify webhook secret
    const secret = request.headers.get('x-webhook-secret');
    if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
    }

    // 2. Parse payload
    const payload = await request.json();
    console.log('[Webhooks] Tickets payload received:', payload.type, payload.record?.id);

    const { type, record, old_record } = payload;

    if (!record) {
      return NextResponse.json({ error: 'No record found in payload' }, { status: 400 });
    }

    const {
      id: ticketId,
      ticket_number: ticketNumber,
      title: ticketTitle,
      property_id: propertyId,
      organization_id: organizationId,
      status: currentStatus,
      raised_by: raisedByUserId,
      assigned_to: assignedToUserId,
      priority: ticketPriority,
      skill_group_id: skillGroupId,
    } = record;

    const previousStatus = old_record?.status;
    const previousAssignedTo = old_record?.assigned_to;

    // Convert ticket priority to push priority
    let priority: 'NORMAL' | 'HIGH' | 'CRITICAL' = 'NORMAL';
    if (ticketPriority === 'high') priority = 'HIGH';
    if (ticketPriority === 'urgent' || ticketPriority === 'critical') priority = 'CRITICAL';

    const deepLink = `/property/${propertyId}/tickets/${ticketId}`;
    const basePayload = {
      propertyId,
      organizationId,
      deepLink,
      ticketId,
      priority,
    };

    const notificationsToSend = [];

    // 3. Determine notifications to send

    // A. Ticket Created
    if (type === 'INSERT') {
      // Notify property admins that a new ticket was created
      notificationsToSend.push({
        ...basePayload,
        role: 'property_admin', // Target role
        type: NOTIFICATION_TYPES.TICKET_CREATED,
        title: `New Ticket Raised: ${ticketNumber || 'TKT'}`,
        message: ticketTitle,
      });

      // If it was auto-assigned upon creation
      if (assignedToUserId) {
        notificationsToSend.push({
          ...basePayload,
          userId: assignedToUserId,
          type: NOTIFICATION_TYPES.TICKET_ASSIGNED,
          title: `Ticket Assigned: ${ticketNumber || 'TKT'}`,
          message: `You have been assigned to: ${ticketTitle}`,
        });
      }
    } 
    // B. Ticket Updated
    else if (type === 'UPDATE') {
      // Ticket newly assigned to someone
      if (assignedToUserId && assignedToUserId !== previousAssignedTo) {
        notificationsToSend.push({
          ...basePayload,
          userId: assignedToUserId,
          type: NOTIFICATION_TYPES.TICKET_ASSIGNED,
          title: `Ticket Assigned: ${ticketNumber || 'TKT'}`,
          message: `You have been assigned to: ${ticketTitle}`,
        });
      }

      // Ticket Status Changed
      if (currentStatus !== previousStatus) {
        // Notify the creator when status changes (especially resolved/closed)
        if (raisedByUserId) {
          let notifTitle = `Ticket Update: ${ticketNumber || 'TKT'}`;
          let notifType: string = NOTIFICATION_TYPES.TICKET_UPDATED;
          
          if (currentStatus === 'resolved') {
            notifTitle = `Ticket Resolved: ${ticketNumber || 'TKT'}`;
            notifType = NOTIFICATION_TYPES.TICKET_RESOLVED;
          } else if (currentStatus === 'closed') {
            notifTitle = `Ticket Closed: ${ticketNumber || 'TKT'}`;
            notifType = NOTIFICATION_TYPES.TICKET_CLOSED;
          } else if (currentStatus === 'in_progress') {
            notifTitle = `Ticket In Progress: ${ticketNumber || 'TKT'}`;
          }

          notificationsToSend.push({
            ...basePayload,
            userId: raisedByUserId,
            type: notifType,
            title: notifTitle,
            message: `Status changed to ${currentStatus.replace('_', ' ')}`,
          });
        }
      }
    }

    // 4. Web app backend handles push notifications
    const results: any[] = [];


    return NextResponse.json({
      success: true,
      processed: notificationsToSend.length,
      results,
    });

  } catch (err: any) {
    console.error('[Webhooks] Tickets exception:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
