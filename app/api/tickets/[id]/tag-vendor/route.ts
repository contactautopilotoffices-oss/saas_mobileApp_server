import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: ticketId } = await params;
    const body = await request.json();
    const { note, assignedProcurementUserId } = body;

    if (!note || typeof note !== "string" || !note.trim()) {
      return NextResponse.json({ error: "Vendor requirement note is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: ticket, error: ticketError } = await admin
      .from("tickets")
      .select("id, title, status, property_id, organization_id")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const updatePayload: any = {
      needs_vendor_procurement: true,
      vendor_procurement_status: "pending_vendor",
      vendor_procurement_note: note.trim(),
      vendor_procurement_tagged_at: now,
      vendor_procurement_tagged_by: auth.user.id,
      vendor_procurement_assigned_to: assignedProcurementUserId || null,
      updated_at: now
    };

    const { data: updated, error: updateError } = await admin
      .from("tickets")
      .update(updatePayload)
      .eq("id", ticketId)
      .select("*")
      .single();

    if (updateError || !updated) {
      return NextResponse.json({ error: "Failed to tag vendor procurement" }, { status: 500 });
    }

    // Log in ticket activity
    await admin.from("ticket_activity_log").insert({
      ticket_id: ticketId,
      user_id: auth.user.id,
      action: "vendor_procurement_tagged",
      new_value: note.trim()
    });

    return NextResponse.json({ success: true, ticket: updated });
  } catch (err: any) {
    console.error("[saas-mobile-server] tag-vendor error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
