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
    if (!propertyId || !body.name) return NextResponse.json({ error: "Missing meter fields" }, { status: 400 });
    if (!(await canManageProperty(auth.user.id, propertyId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();
    const { data: meter, error } = await admin
      .from("electricity_meters")
      .insert({
        property_id: propertyId,
        name: body.name,
        meter_number: body.meter_number ?? null,
        meter_type: body.meter_type ?? "main",
        last_reading: body.last_reading ?? 0,
        status: "active",
      })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: "Failed to create meter" }, { status: 500 });

    const multiplierValue =
      ((Number(body.ct_ratio_primary) || 0) / (Number(body.ct_ratio_secondary) || 1)) *
      ((Number(body.pt_ratio_primary) || 0) / (Number(body.pt_ratio_secondary) || 1)) *
      (Number(body.meter_constant) || 0);
    await admin.from("meter_multipliers").insert({
      meter_id: meter.id,
      ct_ratio_primary: body.ct_ratio_primary ?? 0,
      ct_ratio_secondary: body.ct_ratio_secondary ?? 0,
      pt_ratio_primary: body.pt_ratio_primary ?? 0,
      pt_ratio_secondary: body.pt_ratio_secondary ?? 0,
      meter_constant: body.meter_constant ?? 0,
      multiplier_value: multiplierValue,
      effective_from: new Date().toISOString().split("T")[0],
      created_by: auth.user.id,
    });

    return NextResponse.json({ success: true, meter }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] electricity meters POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
