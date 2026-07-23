import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Fetch user profile
    const { data: user, error: userError } = await admin
      .from("users")
      .select("*")
      .eq("id", id)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Fetch org memberships
    const { data: orgMembers } = await admin
      .from("organization_memberships")
      .select("role, organization:organizations(name)")
      .eq("user_id", id)
      .eq("is_active", true);

    // Fetch property memberships
    const { data: propMembers } = await admin
      .from("property_memberships")
      .select("role, property:properties(name)")
      .eq("user_id", id)
      .eq("is_active", true);

    // Fetch vendor info
    const { data: vendor } = await admin
      .from("vendors")
      .select("id, shop_name")
      .eq("user_id", id)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      data: {
        user,
        organization_memberships: orgMembers ?? [],
        property_memberships: propMembers ?? [],
        vendor
      }
    });
  } catch (error) {
    console.error("[users/[id]/settings] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
