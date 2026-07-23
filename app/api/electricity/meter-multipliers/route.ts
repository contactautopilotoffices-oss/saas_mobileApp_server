import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const meterId = request.nextUrl.searchParams.get("meterId");
    if (!meterId) return NextResponse.json({ error: "Missing meterId" }, { status: 400 });

    const admin = createAdminClient();
    
    // Check access via meter's property
    const { data: meter } = await admin.from("electricity_meters").select("property_id").eq("id", meterId).single();
    if (!meter) return NextResponse.json({ error: "Meter not found" }, { status: 404 });
    if (!(await canManageProperty(auth.user.id, meter.property_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data, error } = await admin.from("meter_multipliers").select("*").eq("meter_id", meterId).order("effective_from", { ascending: false });
    if (error) return NextResponse.json({ error: "Failed to fetch meter multipliers" }, { status: 500 });
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    console.error("[saas-mobile-server] meter_multipliers GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const meterId = body.meterId || body.meter_id;
    if (!meterId || !body.effective_from) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

    const admin = createAdminClient();

    // Check access
    const { data: meter } = await admin.from("electricity_meters").select("property_id").eq("id", meterId).single();
    if (!meter) return NextResponse.json({ error: "Meter not found" }, { status: 404 });
    if (!(await canManageProperty(auth.user.id, meter.property_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const effectiveFrom = String(body.effective_from);
    const dayBefore = new Date(effectiveFrom);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayBeforeStr = dayBefore.toISOString().split("T")[0];

    await admin
      .from("meter_multipliers")
      .update({ effective_to: dayBeforeStr })
      .eq("meter_id", meterId)
      .is("effective_to", null)
      .lt("effective_from", effectiveFrom);

    const { data, error } = await admin
      .from("meter_multipliers")
      .insert({
        meter_id: meterId,
        ct_ratio_primary: body.ct_ratio_primary ?? null,
        ct_ratio_secondary: body.ct_ratio_secondary ?? null,
        pt_ratio_primary: body.pt_ratio_primary ?? null,
        pt_ratio_secondary: body.pt_ratio_secondary ?? null,
        meter_constant: body.meter_constant ?? 1,
        effective_from: effectiveFrom,
        reason: body.reason ?? null,
        created_by: auth.user.id,
      })
      .select("*")
      .single();
      
    if (error) return NextResponse.json({ error: "Failed to create multiplier" }, { status: 500 });

    const ct_ratio_primary = body.ct_ratio_primary !== null && body.ct_ratio_primary !== undefined ? Number(body.ct_ratio_primary) : null;
    const ct_ratio_secondary = body.ct_ratio_secondary !== null && body.ct_ratio_secondary !== undefined ? Number(body.ct_ratio_secondary) : null;
    const pt_ratio_primary = body.pt_ratio_primary !== null && body.pt_ratio_primary !== undefined ? Number(body.pt_ratio_primary) : null;
    const pt_ratio_secondary = body.pt_ratio_secondary !== null && body.pt_ratio_secondary !== undefined ? Number(body.pt_ratio_secondary) : null;
    const meter_constant = body.meter_constant !== null && body.meter_constant !== undefined ? Number(body.meter_constant) : 1;

    const computedMultiplierValue = (ct_ratio_primary || 1) / (ct_ratio_secondary || 1) * (pt_ratio_primary || 1) / (pt_ratio_secondary || 1) * meter_constant;

    // Retroactive recalculation
    const { data: readingsToUpdate } = await admin
      .from("electricity_readings")
      .select("*")
      .eq("meter_id", meterId)
      .gte("reading_date", effectiveFrom);

    if (readingsToUpdate && readingsToUpdate.length > 0) {
      for (const reading of readingsToUpdate) {
        const rawUnits = Number(reading.closing_reading) - Number(reading.opening_reading);
        const finalUnits = rawUnits * computedMultiplierValue;
        
        const { data: tariffData } = await admin.rpc("get_active_grid_tariff", { p_property_id: meter.property_id, p_date: reading.reading_date });
        const tariffRate = (tariffData as any)?.[0]?.rate_per_unit ?? 0;
        const computedCost = finalUnits * tariffRate;

        await admin.from("electricity_readings").update({
          multiplier_id: data.id,
          multiplier_value_used: computedMultiplierValue,
          final_units: finalUnits,
          computed_cost: computedCost
        }).eq("id", reading.id);

        await admin.from("facility_meter_readings").update({
          consumption: finalUnits,
          meter_constant_used: computedMultiplierValue
        }).eq("meter_id", meterId).eq("reading_date", reading.reading_date);
      }
    }

    // Sync the new computed multiplier to the facility_meters table for the spreadsheet view
    const { error: syncError } = await admin
      .from("facility_meters")
      .update({ meter_constant: computedMultiplierValue })
      .eq("id", meterId);
    
    if (syncError) {
      console.warn("[saas-mobile-server] Could not sync facility_meters:", syncError);
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] meter_multipliers POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
