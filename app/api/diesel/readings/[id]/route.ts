import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const propertyId = request.nextUrl.searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "Missing propertyId" }, { status: 400 });
    if (!(await canManageProperty(auth.user.id, propertyId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();
    const { data: reading } = await admin.from("diesel_readings").select("*").eq("id", id).eq("property_id", propertyId).maybeSingle();
    if (!reading) return NextResponse.json({ error: "Reading not found" }, { status: 404 });

    const { error } = await admin.from("diesel_readings").delete().eq("id", id);
    if (error) return NextResponse.json({ error: "Failed to delete reading" }, { status: 500 });

    const { data: remaining } = await admin
      .from("diesel_readings")
      .select("closing_hours, closing_diesel_level")
      .eq("generator_id", reading.generator_id)
      .eq("property_id", propertyId)
      .order("reading_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    await admin
      .from("generators")
      .update({
        initial_run_hours: remaining?.closing_hours ?? 0,
        initial_diesel_level: remaining?.closing_diesel_level ?? 0,
      })
      .eq("id", reading.generator_id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[saas-mobile-server] diesel reading DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
