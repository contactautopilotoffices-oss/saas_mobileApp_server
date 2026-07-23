import { NextResponse } from 'next/server';

/**
 * GET /api/whatsapp/templates
 *
 * List all available WhatsApp campaign templates
 */
export async function GET() {
  const templates = [
    // Tickets (7)
    { key: 'TICKET_CREATED', name: 'fms_ticket_created', description: 'Ticket raised notification' },
    { key: 'TICKET_ASSIGNED', name: 'fms_ticket_assigned', description: 'Ticket assigned to staff' },
    { key: 'TICKET_RESOLVED', name: 'fms_ticket_resolved', description: 'Ticket resolved notification' },
    { key: 'TICKET_SLA_BREACHED', name: 'fms_ticket_sla_breached', description: 'SLA breach alert' },
    { key: 'TICKET_COMMENTED', name: 'fms_ticket_commented', description: 'New comment on ticket' },
    { key: 'TICKET_UPDATED', name: 'fms_ticket_updated', description: 'Ticket status updated' },
    { key: 'TICKET_CLOSED', name: 'fms_ticket_closed', description: 'Ticket closed notification' },

    // PPM (3)
    { key: 'PPM_DUE', name: 'fms_ppm_due', description: 'PPM task due today' },
    { key: 'PPM_OVERDUE', name: 'fms_ppm_overdue', description: 'PPM task overdue' },
    { key: 'PPM_COMPLETED', name: 'fms_ppm_completed', description: 'PPM task completed' },

    // Visitors (3)
    { key: 'VISITOR_CHECKIN', name: 'fms_visitor_checkin', description: 'Visitor checked in' },
    { key: 'VISITOR_CHECKOUT', name: 'fms_visitor_checkout', description: 'Visitor checked out' },
    { key: 'VISITOR_EXPECTED', name: 'fms_visitor_expected', description: 'Expected visitor notification' },

    // Meeting Rooms (3)
    { key: 'MEETING_ROOM_BOOKED', name: 'fms_meeting_room_booked', description: 'Room booking confirmation' },
    { key: 'MEETING_ROOM_REMINDER', name: 'fms_meeting_room_reminder', description: '15 min before meeting' },
    { key: 'MEETING_ROOM_CANCELLED', name: 'fms_meeting_room_cancelled', description: 'Booking cancelled' },

    // Material Requests (2)
    { key: 'MATERIAL_REQUEST_CREATED', name: 'fms_material_request_created', description: 'New procurement request' },
    { key: 'MATERIAL_REQUEST_APPROVED', name: 'fms_material_request_approved', description: 'Request approved' },

    // Checklists (2)
    { key: 'CHECKLIST_DUE', name: 'fms_checklist_due', description: 'Checklist due notification' },
    { key: 'CHECKLIST_MISSED', name: 'fms_checklist_missed', description: 'Checklist missed alert' },

    // General (1)
    { key: 'ANNOUNCEMENT', name: 'fms_announcement', description: 'Broadcast announcement' },
  ];

  return NextResponse.json({ templates, total: templates.length });
}
