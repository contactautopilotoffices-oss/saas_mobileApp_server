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
    const { data: tariffs, error } = await admin
      .from("water_tariffs")
      .select("*, source:water_sources!inner(property_id)")
      .eq("source.property_id", propertyId)
      .order("effective_from", { ascending: false });

    if (error) {
      console.error("[saas-mobile-server] water tariffs GET error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, tariffs: tariffs ?? [] });
  } catch (error) {
    console.error("[saas-mobile-server] water tariffs GET error:", error);
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
    const sourceId = body.source_id;
    const propertyId = body.property_id;

    if (!sourceId || !propertyId || !body.rate_per_unit || !body.effective_from) {
      return NextResponse.json({ error: "Missing tariff fields" }, { status: 400 });
    }

    const hasAccess = await canManageProperty(auth.user.id, propertyId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Close previous open-ended tariff for this source
    const { data: previousOpen } = await admin
      .from("water_tariffs")
      .select("id, effective_from")
      .eq("source_id", sourceId)
      .is("effective_to", null)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    const effectiveFrom = new Date(body.effective_from);
    effectiveFrom.setDate(effectiveFrom.getDate() - 1);
    const closeDate = effectiveFrom.toISOString().split("T")[0];

    if (previousOpen) {
      await admin
        .from("water_tariffs")
        .update({ effective_to: closeDate })
        .eq("id", previousOpen.id);
    }

    const { data, error } = await admin
      .from("water_tariffs")
      .insert({
        source_id: sourceId,
        rate_per_unit: body.rate_per_unit,
        effective_from: body.effective_from,
        created_by: auth.user.id,
      })
      .select("*")
      .single();

    if (error) {
      console.error("[saas-mobile-server] water tariffs POST error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, tariff: data }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] water tariffs POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
