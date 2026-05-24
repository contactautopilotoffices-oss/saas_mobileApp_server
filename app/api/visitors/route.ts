import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";



export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const propertyId = request.nextUrl.searchParams.get("propertyId");
    const status = request.nextUrl.searchParams.get("status");
    const search = request.nextUrl.searchParams.get("search");
    if (!propertyId) return NextResponse.json({ error: "Missing propertyId" }, { status: 400 });

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();

    let query = admin
      .from("visitor_logs")
      .select("*")
      .eq("property_id", propertyId)
      .order("checkin_time", { ascending: false });

    if (status && status !== "all") query = query.eq("status", status);
    if (search) {
      const term = `%${search}%`;
      query = query.or(`name.ilike.${term},mobile.ilike.${term},whom_to_meet.ilike.${term},visitor_id.ilike.${term}`);
    }

    const [{ data: visitors, error }, { data: property }] = await Promise.all([
      query,
      admin.from("properties").select("*").eq("id", propertyId).maybeSingle(),
    ]);
    if (error) return NextResponse.json({ error: "Failed to fetch visitors" }, { status: 500 });

    const visitorRows = visitors ?? [];
    const stats = {
      total: visitorRows.length,
      checked_in: visitorRows.filter((v: any) => v.status === "checked_in").length,
      checked_out: visitorRows.filter((v: any) => v.status === "checked_out").length,
      pending: visitorRows.filter((v: any) => v.status === "pending").length,
    };

    return NextResponse.json({ property: property ?? null, visitors: visitorRows, stats });
  } catch (error) {
    console.error("[saas-mobile-server] visitors GET error:", error);
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
    if (!propertyId || !body.name || !body.whom_to_meet || !body.category) {
      return NextResponse.json({ error: "Missing visitor fields" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();
    const { data: property } = await admin.from("properties").select("organization_id").eq("id", propertyId).single();

    let visitorId = "";
    try {
      const { data: generatedId } = await admin.rpc("generate_visitor_id", { p_property_id: propertyId });
      if (generatedId) visitorId = generatedId;
    } catch {}
    if (!visitorId) {
      visitorId = `VIS-${Math.floor(100000 + Math.random() * 900000)}`;
    }

    const { data: visitor, error } = await admin
      .from("visitor_logs")
      .insert({
        property_id: propertyId,
        organization_id: property?.organization_id ?? null,
        visitor_id: visitorId,
        category: body.category,
        name: body.name,
        mobile: body.mobile ?? null,
        coming_from: body.coming_from ?? null,
        whom_to_meet: body.whom_to_meet,
        whom_to_meet_uid: body.whom_to_meet_uid ?? null,
        purpose: body.purpose ?? null,
        photo_url: body.photo_url ?? null,
        checkin_time: new Date().toISOString(),
        status: "checked_in",
      })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: "Failed to create visitor log" }, { status: 500 });

    return NextResponse.json({ success: true, visitorId, visitor, message: `Welcome ${body.name}! Visit logged.` }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] visitors POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
