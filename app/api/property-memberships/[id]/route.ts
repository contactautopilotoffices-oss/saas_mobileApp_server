import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";
import { createAnonClient } from "@/lib/supabase/client";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user || !auth.token) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: membershipId } = await context.params;
    if (!membershipId) {
      return NextResponse.json({ error: "Membership id is required" }, { status: 400 });
    }

    const supabase = createAnonClient(auth.token);

    const { data: membership, error } = await supabase
      .from("property_memberships")
      .select("*, users(full_name, email, phone)")
      .eq("id", membershipId)
      .maybeSingle();

    if (error || !membership) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: membership });
  } catch (error) {
    console.error("[property-memberships/[id]] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user || !auth.token) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: membershipId } = await context.params;
    const body = await request.json();

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
      .update({
        role: body.role,
        is_active: body.is_active,
      })
      .eq("id", membershipId)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[property-memberships/[id]] PATCH error:", error);
      return NextResponse.json({ error: "Failed to update membership" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("[property-memberships/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
