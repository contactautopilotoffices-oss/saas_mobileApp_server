import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const propertyId = request.nextUrl.searchParams.get("propertyId");
    const search = request.nextUrl.searchParams.get("search");
    const category = request.nextUrl.searchParams.get("category");
    if (!propertyId) {
      return NextResponse.json({ error: "Missing propertyId" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    let query = admin.from("stock_items").select("*").eq("property_id", propertyId).order("name", { ascending: true });
    if (search) {
      const term = `%${search}%`;
      query = query.or(`name.ilike.${term},item_code.ilike.${term},barcode.ilike.${term}`);
    }
    if (category) {
      query = query.eq("category", category);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: "Failed to fetch stock items" }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (error) {
    console.error("[saas-mobile-server] stock items GET error:", error);
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
    const propertyId = body.propertyId || body.property_id;
    if (!propertyId || !body.name) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!(await canManageProperty(auth.user.id, propertyId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("stock_items")
      .insert({
        property_id: propertyId,
        name: body.name,
        item_code: body.item_code ?? null,
        description: body.description ?? null,
        category: body.category ?? null,
        quantity: body.quantity ?? 0,
        unit: body.unit ?? null,
        min_threshold: body.min_threshold ?? 10,
        unit_price: body.unit_price ?? 0,
        location: body.location ?? null,
        barcode: body.barcode ?? null,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create stock item" }, { status: 500 });
    }

    return NextResponse.json({ success: true, item: data }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] stock items POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
