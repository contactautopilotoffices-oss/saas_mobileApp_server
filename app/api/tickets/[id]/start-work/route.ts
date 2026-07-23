import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { createAnonClient } from "@/lib/supabase/client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/tickets/[id]/start-work
 * MST starts working on an assigned ticket
 * Required: User must be the assigned user
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

    // Check if user is assigned to this ticket
    if (ticket.assigned_to !== auth.user.id) {
      return NextResponse.json({
        error: "You must be assigned to this ticket to start work"
      }, { status: 400 });
    }

    // Check if already in progress
    if (ticket.status === "in_progress") {
      return NextResponse.json({
        error: "Work has already started on this ticket"
      }, { status: 400 });
    }

    // Cannot start work on closed/resolved tickets
    if (["closed", "resolved"].includes(ticket.status)) {
      return NextResponse.json({
        error: "Cannot start work on a closed or resolved ticket"
      }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Update ticket
    const { data: updatedTicket, error: updateError } = await admin
      .from("tickets")
      .update({
        status: "in_progress",
        work_started_at: now,
        work_paused: false,
        updated_at: now,
      })
      .eq("id", ticketId)
      .select()
      .single();

    if (updateError) {
      console.error("[tickets/[id]/start-work] update error:", updateError);
      return NextResponse.json({ error: "Failed to start work" }, { status: 500 });
    }

    // Log activity
    await admin.from("ticket_activity_log").insert({
      ticket_id: ticketId,
      performed_by: auth.user.id,
      action: "work_started",
      old_value: ticket.status,
      new_value: "in_progress",
    });

    return NextResponse.json({
      success: true,
      ticket: updatedTicket,
      message: "Work started successfully"
    });
  } catch (error) {
    console.error("[tickets/[id]/start-work] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
