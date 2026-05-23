import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const body = await request.json();
    const admin = createAdminClient();
    const { data: existing } = await admin.from("sop_completions").select("id, property_id, completed_by").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Checklist completion not found" }, { status: 404 });
    if (existing.completed_by && existing.completed_by !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await admin
      .from("sop_completions")
      .update({
        status: body.status,
        completed_at: body.completed_at,
        is_late: body.is_late,
      })
      .eq("id", id)
      .select("*, user:users(id, full_name)")
      .single();
    if (error) return NextResponse.json({ error: "Failed to update checklist completion" }, { status: 500 });
    return NextResponse.json({ success: true, completion: data });
  } catch (error) {
    console.error("[saas-mobile-server] checklist completion PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
