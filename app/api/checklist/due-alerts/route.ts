import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/checklist/due-alerts?propertyId=xxx
 * Returns due and missed checklist (SOP) completions for a property
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const propertyId = request.nextUrl.searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: alerts, error } = await admin
      .from("sop_completions")
      .select("id, status, created_at, template:sop_templates(title)")
      .eq("property_id", propertyId)
      .in("status", ["pending", "in_progress", "missed"])
      .order("created_at", { ascending: true })
      .limit(20);

    if (error) {
      console.error("[checklist/due-alerts] error:", error);
      return NextResponse.json({ error: "Failed to fetch alerts" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: alerts ?? [] });
  } catch (error) {
    console.error("[checklist/due-alerts] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
