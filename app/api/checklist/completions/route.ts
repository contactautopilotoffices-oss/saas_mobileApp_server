import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const propertyId = body.propertyId || body.property_id;
    if (!propertyId || !body.template_id) return NextResponse.json({ error: "Missing checklist fields" }, { status: 400 });
    if (!(await canManageProperty(auth.user.id, propertyId))) {
      const accessAllowed = body.completed_by === auth.user.id;
      if (!accessAllowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("sop_completions")
      .insert({
        template_id: body.template_id,
        property_id: propertyId,
        organization_id: body.organization_id ?? null,
        completed_by: body.completed_by ?? auth.user.id,
        status: body.status ?? "in_progress",
        completion_date: body.completion_date,
        slot_time: body.slot_time ?? null,
      })
      .select("*, user:users(id, full_name)")
      .single();
    if (error) return NextResponse.json({ error: "Failed to start checklist" }, { status: 500 });
    return NextResponse.json({ success: true, completion: data }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] checklist completions POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
