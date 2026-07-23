import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";
import { createAnonClient } from "@/lib/supabase/client";

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user || !auth.token) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { membershipId, is_active } = body;

    if (!membershipId) {
      return NextResponse.json({ error: "Membership id is required" }, { status: 400 });
    }

    // Get the membership to check property_id
    const supabase = createAnonClient(auth.token);
    const { data: existing } = await supabase
      .from("property_memberships")
      .select("property_id")
      .eq("id", membershipId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    // Check if user can manage this property
    const canManage = await canManageProperty(auth.user.id, existing.property_id);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Update the membership
    const { data: updated, error } = await supabase
      .from("property_memberships")
      .update({ is_active })
      .eq("id", membershipId)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[property-memberships] PATCH error:", error);
      return NextResponse.json({ error: "Failed to update membership" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("[property-memberships] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user || !auth.token) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const membershipId = searchParams.get("membershipId");
    const propertyId = searchParams.get("propertyId");

    if (!membershipId || !propertyId) {
      return NextResponse.json({ error: "membershipId and propertyId are required" }, { status: 400 });
    }

    // Check if user can manage this property
    const canManage = await canManageProperty(auth.user.id, propertyId);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = createAnonClient(auth.token);
    const { error } = await supabase
      .from("property_memberships")
      .delete()
      .eq("id", membershipId);

    if (error) {
      console.error("[property-memberships] DELETE error:", error);
      return NextResponse.json({ error: "Failed to delete membership" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[property-memberships] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
