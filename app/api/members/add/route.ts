import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageOrganization, canManageProperty } from "@/lib/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { email, property_id, organization_id, role } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Check if user exists
    const { data: existingUser, error: lookupError } = await admin
      .from("users")
      .select("id, full_name, email")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    if (lookupError) {
      console.error("[members/add] lookup error:", lookupError);
      return NextResponse.json({ error: "Failed to lookup user" }, { status: 500 });
    }

    if (!existingUser) {
      return NextResponse.json({
        success: false,
        error: "User not found. Ask the user to sign up first, then add them here."
      }, { status: 404 });
    }

    // Add to property membership if propertyId given
    if (property_id) {
      const canManage = await canManageProperty(auth.user.id, property_id);
      if (!canManage) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const { error: memError } = await admin
        .from("property_memberships")
        .upsert({
          user_id: existingUser.id,
          property_id: property_id,
          organization_id: organization_id,
          role: role || 'staff',
          is_active: true,
          joined_at: new Date().toISOString(),
        }, { onConflict: 'user_id,property_id' });

      if (memError) {
        console.error("[members/add] property membership error:", memError);
      }
    }

    // Always add to org membership
    if (organization_id) {
      const canManage = await canManageOrganization(auth.user.id, organization_id);
      if (!canManage) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const { error: orgMemError } = await admin
        .from("organization_memberships")
        .upsert({
          user_id: existingUser.id,
          organization_id: organization_id,
          role: role || 'staff',
          is_active: true,
          joined_at: new Date().toISOString(),
        }, { onConflict: 'user_id,organization_id' });

      if (orgMemError) {
        console.error("[members/add] org membership error:", orgMemError);
        return NextResponse.json({ error: "Failed to add to organization" }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      message: `${existingUser.full_name} added successfully`,
      user: {
        id: existingUser.id,
        email: existingUser.email,
        full_name: existingUser.full_name,
        role: role || 'staff'
      },
    });
  } catch (error) {
    console.error("[members/add] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
