import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAnonClient } from "@/lib/supabase/client";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    const supabase = createAnonClient(auth.token);

    // Build update payload
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.status !== undefined) updatePayload.status = body.status;
    if (body.assigned_to !== undefined) updatePayload.assigned_to = body.assigned_to;
    if (body.priority !== undefined) updatePayload.priority = body.priority;
    if (body.work_started_at !== undefined) updatePayload.work_started_at = body.work_started_at;
    if (body.resolved_at !== undefined) updatePayload.resolved_at = body.resolved_at;
    if (body.accepted_at !== undefined) updatePayload.accepted_at = body.accepted_at;

    const { data, error } = await supabase
      .from("tickets")
      .update(updatePayload)
      .eq("id", ticketId)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[tickets/[id]/flow-update] error:", error);
      return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[tickets/[id]/flow-update] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
