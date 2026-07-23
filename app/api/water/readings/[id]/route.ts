import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const admin = createAdminClient();
    const { data: reading } = await admin
      .from("water_readings")
      .select("source_id, source:water_sources(property_id)")
      .eq("id", id)
      .single();

    if (!reading) {
      return NextResponse.json({ error: "Reading not found" }, { status: 404 });
    }

    const propertyId = (reading.source as any)?.property_id;
    const hasAccess = await canManageProperty(auth.user.id, propertyId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await admin.from("water_readings").delete().eq("id", id);

    if (error) {
      console.error("[saas-mobile-server] water readings DELETE error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[saas-mobile-server] water readings DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
