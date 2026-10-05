import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

const SELECT_FIELDS = `
  id,
  request_no,
  property_id,
  organization_id,
  requester_id,
  assigned_approver_id,
  approver_id,
  amount_requested,
  amount_approved,
  amount_disbursed,
  status,
  purpose,
  category,
  vendor_name,
  notes,
  bill_url,
  created_at,
  updated_at,
  requester:users!requester_id(id, full_name, email, user_photo_url),
  approver:users!approver_id(id, full_name, email)
`;

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId") || searchParams.get("property_id");
    const tab = searchParams.get("tab") || "mine"; // mine | approvals | all
    const status = searchParams.get("status");

    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    let query = admin
      .from("petty_cash_requests")
      .select(SELECT_FIELDS)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false });

    if (tab === "mine") {
      query = query.eq("requester_id", auth.user.id);
    } else if (tab === "approvals") {
      query = query.in("status", ["submitted", "pending"]);
    }

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ requests: data || [] });
  } catch (error: any) {
    console.error("[petty-cash] GET error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      propertyId,
      amount,
      purpose,
      category = "Maintenance & Repairs",
      vendorName,
      notes,
      billUrl,
    } = body;

    if (!propertyId || !amount || Number(amount) <= 0 || !purpose) {
      return NextResponse.json(
        { error: "propertyId, valid amount, and purpose are required" },
        { status: 400 }
      );
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Fetch property organization_id
    const { data: propData } = await admin
      .from("properties")
      .select("organization_id")
      .eq("id", propertyId)
      .single();

    const orgId = propData?.organization_id;

    // Generate Request Number (PC-YYYYMMDD-XXXX)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.floor(1000 + Math.random() * 9000);
    const requestNo = `PC-${dateStr}-${rand}`;

    const insertPayload: any = {
      property_id: propertyId,
      organization_id: orgId,
      requester_id: auth.user.id,
      request_no: requestNo,
      amount_requested: Number(amount),
      purpose: purpose.trim(),
      category: category.trim(),
      vendor_name: vendorName ? vendorName.trim() : null,
      notes: notes ? notes.trim() : null,
      bill_url: billUrl || null,
      status: "submitted",
      created_at: new Date().toISOString(),
    };

    const { data, error } = await admin
      .from("petty_cash_requests")
      .insert(insertPayload)
      .select(SELECT_FIELDS)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, request: data }, { status: 201 });
  } catch (error: any) {
    console.error("[petty-cash] POST error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
