import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";

async function getHierarchyPropertyId(id: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("escalation_hierarchies").select("property_id").eq("id", id).maybeSingle();
  return data?.property_id ?? null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const body = await request.json();
    const propertyId = body.propertyId || body.property_id || (await getHierarchyPropertyId(id));
    if (!propertyId) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    if (!(await canManageProperty(auth.user.id, propertyId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();
    const { error } = await admin
      .from("escalation_hierarchies")
      .update({ name: body.name, description: body.description ?? null })
      .eq("id", id);
    if (error) return NextResponse.json({ error: "Failed to update hierarchy" }, { status: 500 });

    await admin.from("escalation_levels").delete().eq("hierarchy_id", id);
    const levels = Array.isArray(body.levels) ? body.levels : [];
    if (levels.length > 0) {
      const rows = levels
        .filter((level: any) => level.role || level.user_id)
        .map((level: any, index: number) => ({
          hierarchy_id: id,
          level: index + 1,
          role: level.role || null,
          user_id: level.user_id || null,
          user_name: level.user_name || null,
          response_time_minutes: level.response_time_minutes ?? 30,
        }));
      if (rows.length > 0) {
        const { error: levelsError } = await admin.from("escalation_levels").insert(rows);
        if (levelsError) return NextResponse.json({ error: "Failed to update escalation levels" }, { status: 500 });
      }
    }

    const { data } = await admin.from("escalation_hierarchies").select("*, levels:escalation_levels(*)").eq("id", id).single();
    return NextResponse.json({ success: true, hierarchy: data });
  } catch (error) {
    console.error("[saas-mobile-server] escalation hierarchy PATCH error:", error);
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
    const propertyId = request.nextUrl.searchParams.get("propertyId") || (await getHierarchyPropertyId(id));
    if (!propertyId) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    if (!(await canManageProperty(auth.user.id, propertyId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();
    await admin.from("escalation_levels").delete().eq("hierarchy_id", id);
    const { error } = await admin.from("escalation_hierarchies").delete().eq("id", id);
    if (error) return NextResponse.json({ error: "Failed to delete hierarchy" }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[saas-mobile-server] escalation hierarchy DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
