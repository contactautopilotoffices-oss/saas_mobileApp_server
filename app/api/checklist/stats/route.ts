import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/checklist/stats?propertyId=xxx
 * Returns checklist (SOP) completions stats for a property
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

    // Calculate date range (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sinceDate = sevenDaysAgo.toISOString();

    const { data: completions, error } = await admin
      .from("sop_completions")
      .select("status, created_at")
      .eq("property_id", propertyId)
      .gte("created_at", sinceDate);

    if (error) {
      console.error("[checklist/stats] error:", error);
      return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
    }

    const stats = {
      total: completions?.length ?? 0,
      completed: completions?.filter(c => c.status === 'completed').length ?? 0,
      due: completions?.filter(c => c.status === 'pending' || c.status === 'in_progress').length ?? 0,
      missed: completions?.filter(c => c.status === 'missed').length ?? 0,
    };

    return NextResponse.json({ success: true, data: stats });
  } catch (error) {
    console.error("[checklist/stats] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
