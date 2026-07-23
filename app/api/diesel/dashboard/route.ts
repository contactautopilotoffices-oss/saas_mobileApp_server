import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const propertyId = request.nextUrl.searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Missing propertyId" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Fetch all in parallel
    const [genRes, readingsRes, tariffsRes] = await Promise.all([
      admin.from("generators").select("*").eq("property_id", propertyId).order("name"),
      admin.from("diesel_readings").select("*").eq("property_id", propertyId).order("reading_date", { ascending: false }).limit(100),
      admin.from("dg_tariffs").select("*").eq("property_id", propertyId).is("effective_to", null),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        generators: genRes.data ?? [],
        readings: readingsRes.data ?? [],
        tariffs: tariffsRes.data ?? [],
      }
    });

  } catch (error) {
    console.error("[saas-mobile-server] diesel dashboard GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
