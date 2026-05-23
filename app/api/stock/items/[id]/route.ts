import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";

async function resolvePropertyId(itemId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("stock_items").select("property_id").eq("id", itemId).maybeSingle();
  return data?.property_id ?? null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const propertyId = request.nextUrl.searchParams.get("propertyId") ?? (await resolvePropertyId(id));
    if (!propertyId) return NextResponse.json({ error: "Property not found" }, { status: 404 });

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();
    const { data, error } = await admin.from("stock_items").select("*").eq("id", id).eq("property_id", propertyId).maybeSingle();
    if (error || !data) return NextResponse.json({ error: "Stock item not found" }, { status: 404 });
    return NextResponse.json({ item: data });
  } catch (error) {
    console.error("[saas-mobile-server] stock item GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const propertyId = (await resolvePropertyId(id)) ?? request.nextUrl.searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    if (!(await canManageProperty(auth.user.id, propertyId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const payload = {
      name: body.name,
      item_code: body.item_code,
      description: body.description,
      category: body.category,
      quantity: body.quantity,
      unit: body.unit,
      min_threshold: body.min_threshold,
      unit_price: body.unit_price,
      location: body.location,
      barcode: body.barcode,
    };

    const admin = createAdminClient();
    const { data, error } = await admin.from("stock_items").update(payload).eq("id", id).select("*").single();
    if (error) return NextResponse.json({ error: "Failed to update stock item" }, { status: 500 });
    return NextResponse.json({ success: true, item: data });
  } catch (error) {
    console.error("[saas-mobile-server] stock item PATCH error:", error);
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
    const propertyId = (await resolvePropertyId(id)) ?? request.nextUrl.searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    if (!(await canManageProperty(auth.user.id, propertyId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { error } = await admin.from("stock_items").delete().eq("id", id);
    if (error) return NextResponse.json({ error: "Failed to delete stock item" }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[saas-mobile-server] stock item DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
