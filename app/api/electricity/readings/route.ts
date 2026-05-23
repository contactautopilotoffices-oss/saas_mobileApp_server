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
    if (!propertyId || !body.meter_id || !body.reading_date) return NextResponse.json({ error: "Missing reading fields" }, { status: 400 });
    if (!(await canManageProperty(auth.user.id, propertyId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();
    const { data: multData }: any = await admin.rpc("get_active_multiplier", { p_meter_id: body.meter_id, p_date: body.reading_date });
    const multiplierValue = multData?.[0]?.multiplier_value ?? 1;
    const multiplierId = multData?.[0]?.id ?? null;
    const rawUnits = Number(body.closing_reading) - Number(body.opening_reading);
    const finalUnits = rawUnits * multiplierValue;

    const { data, error } = await admin
      .from("electricity_readings")
      .insert({
        property_id: propertyId,
        meter_id: body.meter_id,
        reading_date: body.reading_date,
        opening_reading: body.opening_reading,
        closing_reading: body.closing_reading,
        final_units: finalUnits,
        multiplier_id: multiplierId,
        multiplier_value_used: multiplierValue,
        notes: body.notes ?? null,
      })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: "Failed to create electricity reading" }, { status: 500 });

    await admin.from("electricity_meters").update({ last_reading: body.closing_reading }).eq("id", body.meter_id);
    return NextResponse.json({ success: true, reading: data }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] electricity readings POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
