import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageOrganization, canManageProperty } from "@/lib/authorization";
import { sendPushNotification, NOTIFICATION_TYPES } from "@/lib/notificationService";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const status = body.status;
    const notes = body.notes;
    if (!status) return NextResponse.json({ error: "Missing status" }, { status: 400 });

    const admin = createAdminClient();
    const { data: current, error: fetchError } = await admin
      .from("material_requests")
      .select("id, property_id, organization_id")
      .eq("id", id)
      .maybeSingle();

    if (fetchError || !current) return NextResponse.json({ error: "Request not found" }, { status: 404 });

    const canManage =
      (current.property_id ? await canManageProperty(auth.user.id, current.property_id) : false) ||
      (current.organization_id ? await canManageOrganization(auth.user.id, current.organization_id) : false);
    if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (notes !== undefined) patch.notes = notes;
    if (status === "approved") {
      patch.approved_by = auth.user.id;
      patch.approved_at = new Date().toISOString();
    } else if (status === "rejected") {
      patch.rejected_by = auth.user.id;
      patch.rejected_at = new Date().toISOString();
    } else if (status === "escalated") {
      patch.escalated_by = auth.user.id;
      patch.escalated_at = new Date().toISOString();
    }

    const { data, error } = await admin.from("material_requests").update(patch).eq("id", id).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // ── Push notification: inform the requester of an approval/rejection ──────
    // Non-blocking — a notification failure must never fail the status update.
    try {
      if ((status === "approved" || status === "rejected") && data?.requested_by) {
        const { data: firstItem } = await admin
          .from("material_request_items")
          .select("name")
          .eq("request_id", id)
          .limit(1)
          .maybeSingle();
        const itemLabel = firstItem?.name ?? "your material request";
        const approved = status === "approved";
        await sendPushNotification({
          userId: data.requested_by,
          propertyId: data.property_id ?? undefined,
          organizationId: data.organization_id ?? undefined,
          type: approved
            ? NOTIFICATION_TYPES.MATERIAL_REQUEST_APPROVED
            : NOTIFICATION_TYPES.MATERIAL_REQUEST_REJECTED,
          title: approved ? "Request Approved" : "Request Rejected",
          message: approved
            ? `Your request for ${itemLabel} has been approved`
            : `Your request for ${itemLabel} was rejected${notes ? `: ${notes}` : ""}`,
          deepLink: `/property/${data.property_id}/stock/${id}`,
          priority: "NORMAL",
        });
      }
    } catch (notifErr) {
      console.error("[Notifications] material request decision push failed:", notifErr);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[saas-mobile-server] procurement requests PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
