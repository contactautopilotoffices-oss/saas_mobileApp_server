import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: scheduleId } = await context.params;
    const body = await request.json();

    const admin = createAdminClient();

    const { data: schedule } = await admin.from("ppm_schedules").select("property_id").eq("id", scheduleId).maybeSingle();
    if (!schedule) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const access = await getPropertyAccess(auth.user.id, schedule.property_id);
    if (!access.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data, error } = await admin
      .from("ppm_schedules")
      .update(body)
      .eq("id", scheduleId)
      .select()
      .single();

    if (error) {
      console.error("[saas-mobile-server] ppm attachments PATCH error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, schedule: data });
  } catch (error) {
    console.error("[saas-mobile-server] ppm attachments PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
