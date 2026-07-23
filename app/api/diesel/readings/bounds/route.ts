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
    const generatorId = searchParams.get("generatorId");
    const readingDate = searchParams.get("readingDate");

    if (!propertyId || !generatorId || !readingDate) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    
    // Fetch latest reading BEFORE or ON this date
    const beforePromise = admin.from("diesel_readings")
      .select("closing_hours, closing_diesel_level, closing_kwh")
      .eq("property_id", propertyId)
      .eq("generator_id", generatorId)
      .lt("reading_date", readingDate)
      .order("reading_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    // Fetch earliest reading AFTER this date
    const afterPromise = admin.from("diesel_readings")
      .select("opening_hours, opening_diesel_level")
      .eq("property_id", propertyId)
      .eq("generator_id", generatorId)
      .gt("reading_date", readingDate)
      .order("reading_date", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1);

    const [beforeRes, afterRes] = await Promise.all([beforePromise, afterPromise]);

    return NextResponse.json({
      success: true,
      data: {
        before: beforeRes.data?.[0] ?? null,
        after: afterRes.data?.[0] ?? null,
      }
    });

  } catch (error) {
    console.error("[saas-mobile-server] diesel readings bounds GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
