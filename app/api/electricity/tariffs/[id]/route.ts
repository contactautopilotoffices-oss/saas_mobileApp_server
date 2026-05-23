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
    await admin
      .from("electricity_readings")
      .update({ tariff_id: null, tariff_rate_used: null, computed_cost: 0 })
      .eq("tariff_id", id);

    const { error } = await admin.from("grid_tariffs").delete().eq("id", id).eq("property_id", propertyId);
    if (error) return NextResponse.json({ error: "Failed to delete tariff" }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[saas-mobile-server] electricity tariff DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
