import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCache, setCache, CACHE_TTL } from "@/lib/cache";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    if (!propertyId || propertyId === 'undefined' || propertyId === 'null') {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const cacheKey = `water:analytics:${propertyId}:${dateFrom ?? 'none'}:${dateTo ?? 'none'}`;
    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return NextResponse.json({ success: true, data: cachedData, source: "cache" });
    }

    const admin = createAdminClient();

    // Fetch active source IDs for this property
    const { data: sources } = await admin
      .from("water_sources")
      .select("id, name, source_type, water_tariffs(*)")
      .eq("property_id", propertyId)
      .eq("is_active", true);

    const sourceIds = (sources ?? []).map((s) => s.id);

    const todayStart = new Date().toISOString().split('T')[0];
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const prevMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().split('T')[0];
    const prevMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().split('T')[0];
    const trendStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const baseQuery = () =>
      admin
        .from("water_readings")
        .select("*, source:water_sources(name, source_type)")
        .in("source_id", sourceIds.length > 0 ? sourceIds : ['00000000-0000-0000-0000-000000000000']);

    const [
      { data: today },
      { data: month },
      { data: prevMonth },
      { data: trend },
      { data: custom }
    ] = await Promise.all([
      baseQuery().eq("reading_date", todayStart),
      baseQuery().gte("reading_date", monthStart),
      baseQuery().gte("reading_date", prevMonthStart).lte("reading_date", prevMonthEnd),
      baseQuery().gte("reading_date", trendStart),
      (dateFrom && dateTo)
        ? baseQuery().gte("reading_date", dateFrom).lte("reading_date", dateTo)
        : Promise.resolve({ data: [] })
    ]);

    const data = {
      sources: sources ?? [],
      today: today || [],
      month: month || [],
      prevMonth: prevMonth || [],
      trend: trend || [],
      custom: custom || [],
    };

    await setCache(cacheKey, data, CACHE_TTL.HOT);

    return NextResponse.json({ success: true, data, source: "db" });
  } catch (error) {
    console.error("[saas-mobile-server] water analytics error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
