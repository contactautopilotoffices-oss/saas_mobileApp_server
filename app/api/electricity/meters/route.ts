import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId || propertyId === 'undefined' || propertyId === 'null') {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: meters, error } = await admin
      .from("electricity_meters")
      .select("*")
      .eq("property_id", propertyId)
      .is("deleted_at", null)
      .order("name", { ascending: true });

    if (error) {
      console.error("[saas-mobile-server] electricity meters GET error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, meters: meters ?? [] });
  } catch (error) {
    console.error("[saas-mobile-server] electricity meters GET error:", error);
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
    const { initial_multiplier, ...meterPayload } = body;
    const propertyId = meterPayload.property_id;

    if (!propertyId) {
      return NextResponse.json({ error: "Missing property_id" }, { status: 400 });
    }

    const hasAccess = await canManageProperty(auth.user.id, propertyId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("electricity_meters")
      .insert(meterPayload)
      .select()
      .single();

    if (error) {
      console.error("[saas-mobile-server] electricity meters POST error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // DUAL WRITE: Sync to facility_meters
    const { error: fwError } = await admin.from("facility_meters").insert({
      id: data.id,
      property_id: propertyId,
      name: meterPayload.name,
      meter_number: meterPayload.meter_number,
      created_by: auth.user.id
    });

    if (fwError) {
      console.warn("[saas-mobile-server] Dual write to facility_meters failed:", fwError);
    }

    if (initial_multiplier && data) {
      await admin.from("meter_multipliers").insert({
        meter_id: data.id,
        ct_ratio_primary: initial_multiplier.ct_ratio_primary ?? null,
        ct_ratio_secondary: initial_multiplier.ct_ratio_secondary ?? null,
        pt_ratio_primary: initial_multiplier.pt_ratio_primary ?? null,
        pt_ratio_secondary: initial_multiplier.pt_ratio_secondary ?? null,
        meter_constant: initial_multiplier.meter_constant ?? 1,
        effective_from: initial_multiplier.effective_from || new Date().toISOString().split("T")[0],
        reason: initial_multiplier.reason ?? "Initial Setup",
        created_by: auth.user.id,
      });
    }

    return NextResponse.json({ success: true, meter: data });
  } catch (error) {
    console.error("[saas-mobile-server] electricity meters POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
