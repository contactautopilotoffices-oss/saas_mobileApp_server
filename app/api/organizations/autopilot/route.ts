import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/organizations/autopilot
 * Returns the Autopilot organization ID
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: org, error } = await admin
      .from("organizations")
      .select("id")
      .or("code.eq.autopilot,name.ilike.%autopilot%")
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[organizations/autopilot] error:", error);
      return NextResponse.json({ error: "Failed to find Autopilot organization" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: org });
  } catch (error) {
    console.error("[organizations/autopilot] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
