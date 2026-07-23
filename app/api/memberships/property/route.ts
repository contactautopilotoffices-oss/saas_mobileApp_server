import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

interface CreateMembershipRequest {
  user_id: string;
  organization_id: string;
  property_id: string;
  role: string;
  is_active?: boolean;
}

/**
 * POST /api/memberships/property
 * Create a property membership
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as CreateMembershipRequest;
    const { user_id, organization_id, property_id, role, is_active = true } = body;

    if (!user_id || !organization_id || !property_id || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: membership, error } = await admin
      .from("property_memberships")
      .insert({
        user_id,
        organization_id,
        property_id,
        role,
        is_active,
      })
      .select()
      .single();

    if (error) {
      // Ignore duplicate key errors
      if (error.code === '23505') {
        return NextResponse.json({ success: true, message: "Membership already exists" });
      }
      console.error("[memberships/property] error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: membership });
  } catch (error) {
    console.error("[memberships/property] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
