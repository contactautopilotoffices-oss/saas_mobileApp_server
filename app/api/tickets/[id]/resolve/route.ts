import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { createAnonClient } from "@/lib/supabase/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordTicketResolution } from "@/lib/gamification/scoring";

/**
 * POST /api/tickets/[id]/resolve
 * MST marks ticket as complete/resolved
 * Workflow:
 * - If property has validation enabled (default true): status -> pending_validation
 * - If internal ticket OR validation disabled: status -> closed directly
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
        error: "You must be assigned to this ticket to resolve it"
      }, { status: 400 });
    }

    // Cannot resolve already closed/resolved tickets
    if (["closed", "resolved"].includes(ticket.status)) {
      return NextResponse.json({
        error: "Ticket is already closed or resolved"
      }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const resolutionNotes = body.resolution_notes || null;
    const photoAfterUrl = body.photo_after_url || ticket.photo_after_url;

    const now = new Date().toISOString();

    // Check if this property has validation enabled via feature flags
    const { data: feature } = await admin
      .from("property_features")
      .select("is_enabled")
      .eq("property_id", ticket.property_id)
      .eq("feature_key", "ticket_validation")
      .maybeSingle();

    // Default to true if not specifically configured (maintains existing behavior)
    const validationEnabled = feature ? feature.is_enabled : true;

    const updates: Record<string, any> = {
      resolved_at: now,
      work_paused: false,
      updated_at: now,
    };

    let finalStatus: string;
    let activityAction: string;

    if (ticket.internal || !validationEnabled) {
      // Internal tickets OR properties without validation -> close directly
      finalStatus = "closed";
      activityAction = "completed";
      updates.status = "closed";
    } else {
      // Non-internal tickets with validation enabled -> pending_validation
      finalStatus = "pending_validation";
      activityAction = "pending_validation";
      updates.status = "pending_validation";
      updates.validation_status = "pending";
    }

    if (resolutionNotes) {
      updates.resolution_notes = resolutionNotes;
    }
    if (photoAfterUrl) {
      updates.photo_after_url = photoAfterUrl;
    }

    // Update ticket
    const { data: updatedTicket, error: updateError } = await admin
      .from("tickets")
      .update(updates)
      .eq("id", ticketId)
      .select()
      .single();

    if (updateError) {
      console.error("[tickets/[id]/resolve] update error:", updateError);
      return NextResponse.json({ error: "Failed to resolve ticket" }, { status: 500 });
    }

    // Log activity
    await admin.from("ticket_activity_log").insert({
      ticket_id: ticketId,
      performed_by: auth.user.id,
      action: activityAction,
      old_value: ticket.status,
      new_value: finalStatus,
    });

    // Update gamification scores
    const slaMet =
      !ticket.sla_breached &&
      (!ticket.sla_deadline || new Date(ticket.sla_deadline) >= new Date(now));
    await recordTicketResolution(admin, { ...ticket, status: finalStatus, resolved_at: now }, auth.user.id, {
      slaMet,
    });

    // Web app backend handles push notifications, so we do not send them here to avoid duplicates.

    return NextResponse.json({
      success: true,
      ticket: updatedTicket,
      message: validationEnabled && !ticket.internal
        ? "Ticket marked complete. Awaiting client validation."
        : "Ticket closed successfully.",
      pendingValidation: finalStatus === "pending_validation"
    });
  } catch (error) {
    console.error("[tickets/[id]/resolve] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
