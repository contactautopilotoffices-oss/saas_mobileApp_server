import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageOrganization } from "@/lib/authorization";
import { createAnonClient } from "@/lib/supabase/client";

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user || !auth.token) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { userId, organizationId, is_active } = body;

    if (!organizationId) {
      return NextResponse.json({ error: "Organization id is required" }, { status: 400 });
    }

    // Check if user can manage this organization
    const canManage = await canManageOrganization(auth.user.id, organizationId);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = createAnonClient(auth.token);

    // Find membership
    const { data: membership } = await supabase
      .from("organization_memberships")
      .select("id")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    // Update
    const { error } = await supabase
      .from("organization_memberships")
      .update({ is_active })
      .eq("id", membership.id);

    if (error) {
      console.error("[organization-memberships] PATCH error:", error);
      return NextResponse.json({ error: "Failed to update membership" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[organization-memberships] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
