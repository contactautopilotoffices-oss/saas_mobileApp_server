import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/users/me/organization-memberships
 * Returns the current user's organization memberships
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: memberships, error } = await admin
      .from("organization_memberships")
      .select("organization_id, role, is_active, created_at")
      .eq("user_id", auth.user.id);

    if (error) {
      console.error("[users/me/organization-memberships] error:", error);
      return NextResponse.json({ error: "Failed to fetch memberships" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: memberships ?? [] });
  } catch (error) {
    console.error("[users/me/organization-memberships] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
