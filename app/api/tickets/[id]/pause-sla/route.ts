import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: ticketId } = await params;
    const body = await request.json();
    const { pause, reason } = body;

    const admin = createAdminClient();

    const { data: ticket, error: fetchErr } = await admin
      .from("tickets")
      .select("*")
      .eq("id", ticketId)
      .single();

    if (fetchErr || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const now = new Date();
    const updates: Record<string, any> = {
      sla_paused: Boolean(pause),
      updated_at: now.toISOString()
    };

    if (pause) {
      updates.sla_paused_at = now.toISOString();
      updates.sla_pause_reason = reason || "Paused by supervisor";
    } else {
      if (ticket.sla_paused_at) {
        const pausedAt = new Date(ticket.sla_paused_at);
        const diffMinutes = Math.max(0, Math.floor((now.getTime() - pausedAt.getTime()) / 60000));
        updates.total_paused_minutes = (ticket.total_paused_minutes || 0) + diffMinutes;

        if (ticket.sla_deadline) {
          const oldDeadline = new Date(ticket.sla_deadline);
          const newDeadline = new Date(oldDeadline.getTime() + diffMinutes * 60000);
          updates.sla_deadline = newDeadline.toISOString();
        }
      }
      updates.sla_paused_at = null;
      updates.sla_pause_reason = null;
    }

    const { data: updated, error: updateErr } = await admin
      .from("tickets")
      .update(updates)
      .eq("id", ticketId)
      .select("*")
      .single();

    if (updateErr || !updated) {
      return NextResponse.json({ error: "Failed to update SLA state" }, { status: 500 });
    }

    // Activity log
    await admin.from("ticket_activity_log").insert({
      ticket_id: ticketId,
      user_id: auth.user.id,
      action: pause ? "sla_paused" : "sla_resumed",
      new_value: reason || (pause ? "SLA paused" : "SLA resumed")
    });

    return NextResponse.json({ success: true, ticket: updated });
  } catch (err: any) {
    console.error("[saas-mobile-server] pause-sla error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
