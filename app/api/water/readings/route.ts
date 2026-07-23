import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const sourceId = searchParams.get("sourceId");
    const month = searchParams.get("month");
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");

    if (!propertyId || propertyId === 'undefined' || propertyId === 'null') {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Get active source IDs for this property
    let sourceQuery = admin
      .from("water_sources")
      .select("id")
      .eq("property_id", propertyId)
      .eq("is_active", true);
    if (sourceId) sourceQuery = sourceQuery.eq("id", sourceId);

    const { data: sources, error: sourceError } = await sourceQuery;
    if (sourceError) {
      console.error("[saas-mobile-server] water readings GET source error:", sourceError);
      return NextResponse.json({ error: sourceError.message }, { status: 500 });
    }

    const sourceIds = (sources ?? []).map((s) => s.id);
    if (sourceIds.length === 0) {
      return NextResponse.json({ success: true, readings: [] });
    }

    let readingQuery = admin
      .from("water_readings")
      .select("*, source:water_sources(name, source_type), user:users!water_readings_created_by_fkey(full_name)")
      .in("source_id", sourceIds);

    if (month) {
      readingQuery = readingQuery.gte("reading_date", `${month}-01`).lt("reading_date", getNextMonth(month));
    } else {
      if (fromDate) readingQuery = readingQuery.gte("reading_date", fromDate);
      if (toDate) readingQuery = readingQuery.lte("reading_date", toDate);
    }

    readingQuery = readingQuery.order("reading_date", { ascending: false });

    const { data: readings, error } = await readingQuery;

    if (error) {
      console.error("[saas-mobile-server] water readings GET error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, readings: readings ?? [] });
  } catch (error) {
    console.error("[saas-mobile-server] water readings GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function getNextMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m, 1));
  return date.toISOString().split("T")[0];
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const propertyId = body.propertyId || body.property_id;
    const readings = Array.isArray(body.readings) ? body.readings : [body];

    if (!propertyId || readings.length === 0) {
      return NextResponse.json({ error: "Missing propertyId or readings" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const savedReadings = [];

    // Helper to resolve a tariff from the embedded RPC result or fallback to a direct query.
    // The fallback protects against RPC timezone/edge-case mismatches so computed_cost is always populated.
    async function resolveTariff(sourceId: string, readingDate: string) {
      const { data: tariffData } = await admin.rpc("get_active_water_tariff", {
        p_source_id: sourceId,
        p_date: readingDate,
      });
      const tariffRow = Array.isArray(tariffData) ? tariffData[0] : tariffData;
      if (tariffRow) return tariffRow as { id: string; rate_per_unit: number };

      const { data: fallbackTariffs } = await admin
        .from("water_tariffs")
        .select("id, rate_per_unit, effective_from")
        .eq("source_id", sourceId)
        .lte("effective_from", readingDate)
        .order("effective_from", { ascending: false })
        .limit(1);
      const fallback = (fallbackTariffs ?? [])[0];
      if (fallback) return fallback as { id: string; rate_per_unit: number };

      // No tariff active for the reading date; use the most recent tariff as a last resort.
      const { data: latestTariff } = await admin
        .from("water_tariffs")
        .select("id, rate_per_unit")
        .eq("source_id", sourceId)
        .order("effective_from", { ascending: false })
        .limit(1);
      return (latestTariff ?? [])[0] as { id: string; rate_per_unit: number } | null;
    }

    for (const reading of readings) {
      if (!reading.source_id || !reading.reading_date || reading.quantity === undefined) {
        return NextResponse.json({ error: "Missing reading fields" }, { status: 400 });
      }

      const quantity = Number(reading.quantity);

      // Lookup active tariff for this source/date
      const tariff = await resolveTariff(reading.source_id, reading.reading_date);
      const tariffRate = tariff?.rate_per_unit ?? 0;
      const tariffId = tariff?.id ?? null;
      const computedCost = quantity * tariffRate;

      const { data: existing } = await admin
        .from("water_readings")
        .select("id")
        .eq("source_id", reading.source_id)
        .eq("reading_date", reading.reading_date)
        .maybeSingle();

      const payload = {
        source_id: reading.source_id,
        reading_date: reading.reading_date,
        quantity,
        tariff_id: tariffId,
        tariff_rate_used: tariffRate,
        computed_cost: computedCost,
        updated_by: auth.user.id,
        created_by: auth.user.id,
      };

      let result;
      if (existing?.id) {
        const { data, error } = await admin
          .from("water_readings")
          .update(payload)
          .eq("id", existing.id)
          .select("*")
          .single();
        if (error) {
          console.error("[saas-mobile-server] water readings POST update error:", error);
          return NextResponse.json({ error: "Failed to update water reading" }, { status: 500 });
        }
        result = data;
      } else {
        const { data, error } = await admin
          .from("water_readings")
          .insert(payload)
          .select("*")
          .single();
        if (error) {
          console.error("[saas-mobile-server] water readings POST insert error:", error);
          return NextResponse.json({ error: "Failed to create water reading" }, { status: 500 });
        }
        result = data;
      }

      savedReadings.push(result);
    }

    return NextResponse.json({ success: true, readings: savedReadings }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] water readings POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
