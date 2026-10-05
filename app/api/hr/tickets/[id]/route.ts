import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const admin = createAdminClient();

    const { data: ticket, error } = await admin
      .from("hr_tickets")
      .select(`
        *,
        category:hr_ticket_categories(*),
        raised_by:users!raised_by_user_id(id, email, full_name),
        assigned_to:users!assigned_to_user_id(id, email, full_name),
        resolved_by:users!resolved_by_user_id(id, email, full_name),
        comments:hr_ticket_comments(*),
        audit_logs:hr_ticket_audit_logs(
          *,
          actor:users!actor_user_id(id, email, full_name)
        )
      `)
      .eq("id", id)
      .single();

    if (error || !ticket) {
      return NextResponse.json({ success: false, error: "HR ticket not found" }, { status: 404 });
    }

    // Mask anonymity if requester is not the creator
    if (ticket.is_anonymous && ticket.raised_by_user_id !== auth.user.id) {
      ticket.raised_by = { id: null, email: "anonymous@hidden.local", full_name: "Anonymous Employee" };
      ticket.employee_snapshot = { name: "Anonymous Employee", department: "Confidential", location: "Hidden" };
    }

    return NextResponse.json({ success: true, data: ticket });
  } catch (err: any) {
    console.error("[saas-mobile-server] hr ticket [id] GET error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { status, resolution_note, assigned_to_user_id } = body;

    const admin = createAdminClient();
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString()
    };

    if (status) {
      updates.status = status;
      if (status === "resolved" || status === "closed") {
        updates.resolved_at = new Date().toISOString();
        updates.resolved_by_user_id = auth.user.id;
        if (resolution_note) updates.resolution_note = resolution_note;
      }
    }

    if (assigned_to_user_id) {
      updates.assigned_to_user_id = assigned_to_user_id;
    }

    const { data: updated, error } = await admin
      .from("hr_tickets")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !updated) {
      return NextResponse.json({ success: false, error: error?.message || "Failed to update HR ticket" }, { status: 500 });
    }

    // Audit log
    await admin.from("hr_ticket_audit_logs").insert({
      ticket_id: id,
      actor_user_id: auth.user.id,
      action: status ? `status_${status}` : "updated",
      details: { updates }
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    console.error("[saas-mobile-server] hr ticket [id] PATCH error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
