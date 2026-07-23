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
    const generatorId = searchParams.get("generatorId");
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");

    if (!propertyId) {
      return NextResponse.json({ error: "Missing propertyId" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    let query = admin.from("diesel_readings").select("*, user:users(full_name)").eq("property_id", propertyId);

    if (generatorId) query = query.eq("generator_id", generatorId);
    if (fromDate) query = query.gte("reading_date", fromDate);
    if (toDate) query = query.lte("reading_date", toDate);

    query = query.order("reading_date", { ascending: false }).order("created_at", { ascending: false });

    const { data: readings, error } = await query;

    if (error) {
      console.error("[saas-mobile-server] diesel readings GET error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, readings: readings ?? [] });
  } catch (error) {
    console.error("[saas-mobile-server] diesel readings GET error:", error);
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
    const propertyId = body.property_id;

    if (!propertyId || !body.generator_id || !body.reading_date) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    
    // Ensure we DO NOT manually insert computed_run_hours
    const insertPayload = {
      property_id: propertyId,
      generator_id: body.generator_id,
      reading_date: body.reading_date,
      opening_hours: body.opening_hours,
      closing_hours: body.closing_hours,
      opening_kwh: body.opening_kwh ?? null,
      closing_kwh: body.closing_kwh ?? null,
      opening_diesel_level: body.opening_diesel_level,
      closing_diesel_level: body.closing_diesel_level,
      diesel_added_litres: body.diesel_added_litres,
      computed_consumed_litres: body.computed_consumed_litres,
      notes: body.notes ?? null,
      created_by: auth.user.id
    };

    const { data, error } = await admin
      .from("diesel_readings")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      console.error("[saas-mobile-server] diesel readings POST error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, reading: data }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] diesel readings POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
