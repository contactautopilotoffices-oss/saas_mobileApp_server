import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const orgId = searchParams.get("orgId");
    
    if (!propertyId && !orgId) {
      return NextResponse.json({ error: "Missing propertyId or orgId" }, { status: 400 });
    }

    const admin = createAdminClient();
    let propertyIds: string[] = [];

    if (propertyId) {
      propertyIds = [propertyId];
    } else if (orgId) {
      const { data: props } = await admin.from("properties").select("id").eq("organization_id", orgId);
      propertyIds = (props ?? []).map((p) => p.id);
    }

    if (propertyIds.length === 0) {
       return NextResponse.json({ success: true, stats: { today: 0, checkedIn: 0, total: 0 } });
    }

    const today = new Date().toISOString().split('T')[0];

    const { data: logs, error } = await admin
      .from("visitor_logs")
      .select("status, checkin_time")
      .in("property_id", propertyIds);

    if (error) {
      console.error("[saas-mobile-server] visitor stats GET error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = logs ?? [];
    let todayCount = 0;
    let checkedInAll = 0;

    rows.forEach(v => {
      if (v.status === "checked_in") {
        checkedInAll++;
        if ((v.checkin_time ?? "").startsWith(today)) {
          todayCount++;
        }
      }
    });

    return NextResponse.json({
      success: true,
      stats: {
        today: todayCount,
        checkedIn: checkedInAll,
        total: rows.length
      }
    });
  } catch (error) {
    console.error("[saas-mobile-server] visitor stats GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
