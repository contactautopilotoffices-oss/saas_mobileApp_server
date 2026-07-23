import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { createAnonClient } from "@/lib/supabase/client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/tickets/[id]/assign
 * Assign a ticket to a specific user (MST)
 * Only Property Admins or existing assignee can reassign
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user || !auth.token) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: ticketId } = await context.params;
    if (!ticketId) {
      return NextResponse.json({ error: "Ticket id is required" }, { status: 400 });
    }

    const body = await request.json();
    const { assigned_to } = body;

    if (!assigned_to) {
      return NextResponse.json({ error: "assigned_to is required" }, { status: 400 });
    }

    const supabase = createAnonClient(auth.token);
    const admin = createAdminClient();

    // Fetch current ticket
    const { data: ticket, error: ticketError } = await admin
      .from("tickets")
      .select("*")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Verify property access
    const access = await getPropertyAccess(auth.user.id, ticket.property_id);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check permission: user must be property_admin/mst OR the current assignee
    const { data: membership } = await admin
      .from("property_memberships")
      .select("role")
      .eq("property_id", ticket.property_id)
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .maybeSingle();

    const userRole = membership?.role?.toUpperCase();
    const isPropertyAdmin = ["PROPERTY_ADMIN", "ADMIN", "MST", "STAFF", "MANAGER"].includes(userRole || "");
    const isCurrentAssignee = ticket.assigned_to === auth.user.id;
    const isTicketCreator = ticket.raised_by === auth.user.id;

    if (!isPropertyAdmin && !isCurrentAssignee && !isTicketCreator) {
      return NextResponse.json({
        error: "You do not have permission to assign this ticket"
      }, { status: 403 });
    }

    // Verify assignee exists and is an MST/Staff at this property
    const { data: assigneeMembership } = await admin
      .from("property_memberships")
      .select("user_id, role")
      .eq("property_id", ticket.property_id)
      .eq("user_id", assigned_to)
      .eq("is_active", true)
      .maybeSingle();

    if (!assigneeMembership) {
      return NextResponse.json({
        error: "Assignee is not a valid member of this property"
      }, { status: 400 });
    }

    // Reject assignment to non-technician roles (procurement/tenant/client)
    const assigneeRole = (assigneeMembership.role ?? "").toLowerCase();
    const NON_ASSIGNABLE_ROLES = ["tenant", "client", "procurement", "procurement_user", "procurement_admin"];
    if (NON_ASSIGNABLE_ROLES.includes(assigneeRole)) {
      return NextResponse.json({
        error: `Cannot assign ticket to a user with role "${assigneeMembership.role}". Only technicians/staff can be assigned.`
      }, { status: 400 });
    }

    const now = new Date().toISOString();
    const slaHours = ticket.sla_hours || 24;

    const updates: Record<string, any> = {
      assigned_to,
      assigned_at: now,
      status: "assigned",
      sla_started: true,
      sla_deadline: new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString(),
      updated_at: now,
    };

    // Update ticket
    const { data: updatedTicket, error: updateError } = await admin
      .from("tickets")
      .update(updates)
      .eq("id", ticketId)
      .select()
      .single();

    if (updateError) {
      console.error("[tickets/[id]/assign] update error:", updateError);
      return NextResponse.json({ error: "Failed to assign ticket" }, { status: 500 });
    }

    // Log activity
    await admin.from("ticket_activity_log").insert({
      ticket_id: ticketId,
      performed_by: auth.user.id,
      action: "assigned",
      old_value: ticket.assigned_to || "unassigned",
      new_value: assigned_to,
    });

    // Web app backend handles push notifications, so we do not send them here to avoid duplicates.
    return NextResponse.json({
      success: true,
      ticket: updatedTicket,
      message: "Ticket assigned successfully"
    });
  } catch (error) {
    console.error("[tickets/[id]/assign] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
