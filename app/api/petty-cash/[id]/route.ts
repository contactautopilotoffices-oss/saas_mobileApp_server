import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("petty_cash_requests")
      .select(`
        id,
        request_no,
        property_id,
        organization_id,
        requester_id,
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
      `)
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Petty cash request not found" }, { status: 404 });
    }

    return NextResponse.json({ request: data });
  } catch (error: any) {
    console.error("[petty-cash/[id]] GET error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const { action, amountApproved, remarks } = body;

    if (!action || !["approve", "reject", "disburse"].includes(action)) {
      return NextResponse.json({ error: "Valid action (approve, reject, disburse) is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Verify existing record
    const { data: existing, error: fetchErr } = await admin
      .from("petty_cash_requests")
      .select("id, property_id, status, amount_requested")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const access = await getPropertyAccess(auth.user.id, existing.property_id);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updatePayload: any = {
      updated_at: new Date().toISOString(),
    };

    if (action === "approve") {
      updatePayload.status = "approved";
      updatePayload.approver_id = auth.user.id;
      updatePayload.amount_approved = amountApproved ? Number(amountApproved) : existing.amount_requested;
    } else if (action === "reject") {
      updatePayload.status = "rejected";
      updatePayload.approver_id = auth.user.id;
    } else if (action === "disburse") {
      updatePayload.status = "disbursed";
      updatePayload.amount_disbursed = amountApproved ? Number(amountApproved) : existing.amount_requested;
    }

    if (remarks) {
      updatePayload.notes = remarks;
    }

    const { data: updated, error: updateErr } = await admin
      .from("petty_cash_requests")
      .update(updatePayload)
      .eq("id", id)
      .select(`
        id,
        request_no,
        property_id,
        amount_requested,
        amount_approved,
        amount_disbursed,
        status,
        purpose,
        category,
        notes,
        created_at,
        updated_at
      `)
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, request: updated });
  } catch (error: any) {
    console.error("[petty-cash/[id]] PATCH error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
