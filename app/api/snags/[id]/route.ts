import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const { status, resolutionNotes, photoAfterUrl, assignedTo } = body;

    if (!id) {
      return NextResponse.json({ error: "Snag ID is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Verify existing snag
    const { data: existing, error: fetchErr } = await admin
      .from("tickets")
      .select("id, property_id, status")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Snag not found" }, { status: 404 });
    }

    const access = await getPropertyAccess(auth.user.id, existing.property_id);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updatePayload: any = {};
    if (status) {
      updatePayload.status = status;
      if (status === "resolved" || status === "closed") {
        updatePayload.resolved_at = new Date().toISOString();
      }
    }
    if (resolutionNotes !== undefined) {
      updatePayload.resolution_notes = resolutionNotes;
    }
    if (photoAfterUrl !== undefined) {
      updatePayload.photo_after_url = photoAfterUrl;
    }
    if (assignedTo !== undefined) {
      updatePayload.assigned_to = assignedTo;
    }

    const { data: updated, error: updateErr } = await admin
      .from("tickets")
      .update(updatePayload)
      .eq("id", id)
      .select(`
        id,
        ticket_number,
        title,
        description,
        status,
        priority,
        internal,
        created_at,
        resolved_at,
        property_id,
        location,
        photo_before_url,
        photo_after_url,
        resolution_notes,
        skill_group:skill_groups(id, code, name),
        assignee:users!assigned_to(id, full_name, email)
      `)
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, snag: updated });
  } catch (error: any) {
    console.error("[snags/[id]] PATCH error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
