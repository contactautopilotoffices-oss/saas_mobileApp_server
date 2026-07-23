import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: propertyId } = await context.params;
    if (!propertyId) {
      return NextResponse.json({ error: "Property id is required" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Fetch property users with roles
    const { data: members, error } = await admin
      .from("property_memberships")
      .select(`
        role,
        is_active,
        created_at,
        user:users(
          id,
          full_name,
          email,
          phone,
          user_photo_url
        )
      `)
      .eq("property_id", propertyId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[properties/[id]/users] error:", error);
      return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    }

    // Transform to flat structure
    const users = (members ?? []).map((m: any) => ({
      role: m.role,
      is_active: m.is_active,
      created_at: m.created_at,
      user_id: m.user?.id,
      full_name: m.user?.full_name,
      email: m.user?.email,
      phone: m.user?.phone,
      user_photo_url: m.user?.user_photo_url,
    }));

    return NextResponse.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error("[properties/[id]/users] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

