import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const admin = createAdminClient();
    const { data: source } = await admin
      .from("water_sources")
      .select("property_id")
      .eq("id", id)
      .single();

    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    const hasAccess = await canManageProperty(auth.user.id, source.property_id);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updatePayload: Record<string, unknown> = {};
    if (body.name !== undefined) updatePayload.name = body.name;
    if (body.source_type !== undefined) updatePayload.source_type = body.source_type;
    if (body.capacity_litres !== undefined) updatePayload.capacity_litres = body.capacity_litres;
    updatePayload.updated_by = auth.user.id;
    updatePayload.updated_at = new Date().toISOString();

    const { data, error } = await admin
      .from("water_sources")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("[saas-mobile-server] water sources PUT error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, source: data });
  } catch (error) {
    console.error("[saas-mobile-server] water sources PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const admin = createAdminClient();
    const { data: source } = await admin
      .from("water_sources")
      .select("property_id")
      .eq("id", id)
      .single();

    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    const hasAccess = await canManageProperty(auth.user.id, source.property_id);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await admin
      .from("water_sources")
      .update({ is_active: false, updated_by: auth.user.id, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("[saas-mobile-server] water sources DELETE error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[saas-mobile-server] water sources DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
