import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const isCheckedIn = !!body.is_checked_in;
    const userId = auth.user.id;

    const admin = createAdminClient();

    const { data: existingStats, error: fetchError } = await admin
      .from("resolver_stats")
      .select("id")
      .eq("user_id", userId)
      .eq("property_id", propertyId)
      .limit(1);

    if (fetchError) throw fetchError;

    let statsError = null;
    if (existingStats && existingStats.length > 0) {
      const { error } = await admin
        .from("resolver_stats")
        .update({ is_checked_in: isCheckedIn })
        .eq("id", existingStats[0].id);
      statsError = error;
    } else {
      const { error } = await admin
        .from("resolver_stats")
        .insert({ property_id: propertyId, user_id: userId, is_checked_in: isCheckedIn });
      statsError = error;
    }

    if (statsError) throw statsError;

    // Log the action in shift_logs
    if (isCheckedIn) {
      await admin.from("shift_logs").insert({
        user_id: userId,
        property_id: propertyId,
        check_in_at: new Date().toISOString(),
        status: 'active'
      });
    } else {
      // Find the most recent active shift log and check out
      const { data: activeShifts } = await admin
        .from("shift_logs")
        .select("id")
        .eq("user_id", userId)
        .eq("property_id", propertyId)
        .eq("status", "active")
        .order("check_in_at", { ascending: false })
        .limit(1);

      if (activeShifts && activeShifts.length > 0) {
        await admin
          .from("shift_logs")
          .update({
            check_out_at: new Date().toISOString(),
            status: 'completed'
          })
          .eq("id", activeShifts[0].id);
      }
    }

    return NextResponse.json({ success: true, data: { is_checked_in: isCheckedIn } });
  } catch (error: any) {
    console.error("[saas-mobile-server] shift-status error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
