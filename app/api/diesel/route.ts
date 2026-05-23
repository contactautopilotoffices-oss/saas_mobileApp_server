import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const propertyId = request.nextUrl.searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "Missing propertyId" }, { status: 400 });

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();
    const [{ data: generators }, { data: readings }] = await Promise.all([
      admin.from("generators").select("*").eq("property_id", propertyId).order("name"),
      admin.from("diesel_readings").select("*").eq("property_id", propertyId).order("reading_date", { ascending: false }).order("created_at", { ascending: false }),
    ]);

    return NextResponse.json({ generators: generators ?? [], readings: readings ?? [] });
  } catch (error) {
    console.error("[saas-mobile-server] diesel GET error:", error);
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
    const propertyId = body.propertyId || body.property_id;
    if (!propertyId || !body.generator_id || !body.reading_date) {
      return NextResponse.json({ error: "Missing diesel reading fields" }, { status: 400 });
    }
    if (!(await canManageProperty(auth.user.id, propertyId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("diesel_readings")
      .insert({
        property_id: propertyId,
        generator_id: body.generator_id,
        reading_date: body.reading_date,
        opening_hours: body.opening_hours,
        closing_hours: body.closing_hours,
        opening_kwh: body.opening_kwh ?? 0,
        closing_kwh: body.closing_kwh ?? 0,
        opening_diesel_level: body.opening_diesel_level,
        closing_diesel_level: body.closing_diesel_level,
        diesel_added_litres: body.diesel_added_litres ?? 0,
        computed_consumed_litres: body.computed_consumed_litres ?? 0,
        notes: body.notes ?? null,
        alert_status: body.alert_status ?? "normal",
      })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: "Failed to create diesel reading" }, { status: 500 });

    await admin
      .from("generators")
      .update({
        initial_run_hours: body.closing_hours,
        initial_diesel_level: body.closing_diesel_level,
        initial_kwh_reading: body.closing_kwh ?? 0,
      })
      .eq("id", body.generator_id);

    return NextResponse.json({ success: true, reading: data }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] diesel POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
