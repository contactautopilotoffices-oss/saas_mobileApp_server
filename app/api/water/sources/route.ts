import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId || propertyId === 'undefined' || propertyId === 'null') {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: sources, error } = await admin
      .from("water_sources")
      .select("*, water_tariffs(*)")
      .eq("property_id", propertyId)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      console.error("[saas-mobile-server] water sources GET error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, sources: sources ?? [] });
  } catch (error) {
    console.error("[saas-mobile-server] water sources GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const propertyId = body.property_id;

    if (!propertyId) {
      return NextResponse.json({ error: "Missing property_id" }, { status: 400 });
    }
    if (!body.name || !body.source_type) {
      return NextResponse.json({ error: "Missing name or source_type" }, { status: 400 });
    }

    const hasAccess = await canManageProperty(auth.user.id, propertyId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("water_sources")
      .insert({
        property_id: propertyId,
        name: body.name,
        source_type: body.source_type,
        capacity_litres: body.capacity_litres ?? null,
        created_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .select("*")
      .single();

    if (error) {
      console.error("[saas-mobile-server] water sources POST error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, source: data }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] water sources POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
