import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";
import { sendPushNotification, NOTIFICATION_TYPES } from "@/lib/notificationService";

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const body = await request.json();
    const { id, propertyId, status, done_date, remark } = body;
    
    if (!id || !propertyId || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!(await canManageProperty(auth.user.id, propertyId))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    
    const { data: updated, error: updateError } = await admin
      .from("ppm_schedules")
      .update({
        status: status,
        done_date: done_date || null,
        remark: remark || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("property_id", propertyId)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message || "Failed to update schedule status" }, { status: 500 });
    }

    // ── Push notification: inform property admins a PPM task was completed ────
    // Non-blocking — a notification failure must never fail the status update.
    // (Due / overdue reminders are time-based and belong in a scheduled cron,
    //  not this route, so only completion is handled here.)
    try {
      const normalized = String(status).toLowerCase();
      if (normalized === "completed" || normalized === "done") {
        await sendPushNotification({
          role: "property_admin",
          propertyId,
          type: NOTIFICATION_TYPES.PPM_COMPLETED,
          title: "PPM Completed",
          message: "A scheduled maintenance task was marked completed.",
          deepLink: `/property/${propertyId}/ppm`,
          priority: "NORMAL",
        });
      }
    } catch (notifErr) {
      console.error("[Notifications] PPM completed push failed:", notifErr);
    }

    return NextResponse.json({ success: true, schedule: updated });
  } catch (error) {
    console.error("[saas-mobile-server] ppm status PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
