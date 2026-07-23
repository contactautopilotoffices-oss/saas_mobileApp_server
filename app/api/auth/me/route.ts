import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Get user profile
    const { data: user } = await admin
      .from("users")
      .select("*")
      .eq("id", auth.user.id)
      .maybeSingle();

    // Get org memberships
    const { data: orgMemberships } = await admin
      .from("organization_memberships")
      .select("*, organizations(id, name, code)")
      .eq("user_id", auth.user.id)
      .eq("is_active", true);

    // Get property memberships
    const { data: propMemberships } = await admin
      .from("property_memberships")
      .select("*, properties(id, name, code, organization_id)")
      .eq("user_id", auth.user.id)
      .eq("is_active", true);

    return NextResponse.json({
      success: true,
      data: {
        user,
        organization_memberships: orgMemberships ?? [],
        property_memberships: propMemberships ?? [],
      }
    });
  } catch (error) {
    console.error("[auth/me] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
