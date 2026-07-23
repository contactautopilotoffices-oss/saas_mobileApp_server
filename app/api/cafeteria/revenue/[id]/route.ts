import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Revenue ID is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Fetch the revenue entry to determine property and vendor
    const { data: revenue, error: fetchError } = await admin
      .from("vendor_daily_revenue")
      .select("id, property_id, vendor_id, revenue_date")
      .eq("id", id)
      .single();

    if (fetchError || !revenue) {
      return NextResponse.json({ error: "Revenue entry not found" }, { status: 404 });
    }

    const access = await getPropertyAccess(auth.user.id, revenue.property_id);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const isAdmin = await canManageProperty(auth.user.id, revenue.property_id);
    if (!isAdmin) {
      // Vendors can only delete their own entries
      const { data: vendor } = await admin
        .from("vendors")
        .select("user_id")
        .eq("id", revenue.vendor_id)
        .single();

      if (!vendor || vendor.user_id !== auth.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const { error: deleteError } = await admin
      .from("vendor_daily_revenue")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("[saas-mobile-server] cafeteria revenue DELETE error:", deleteError);
      return NextResponse.json({ error: "Failed to delete revenue" }, { status: 500 });
    }

    // Recalculate active commission cycle
    const { data: activeCycle } = await admin
      .from("commission_cycles")
      .select("id, cycle_start, cycle_end, commission_rate")
      .eq("vendor_id", revenue.vendor_id)
      .eq("status", "in_progress")
      .maybeSingle();

    if (activeCycle && revenue.revenue_date >= activeCycle.cycle_start && revenue.revenue_date <= activeCycle.cycle_end) {
      const { data: cycleRevenues } = await admin
        .from("vendor_daily_revenue")
        .select("revenue_amount")
        .eq("vendor_id", revenue.vendor_id)
        .gte("revenue_date", activeCycle.cycle_start)
        .lte("revenue_date", activeCycle.cycle_end);

      const totalRevenue = (cycleRevenues ?? []).reduce((sum, r) => sum + (r.revenue_amount || 0), 0);
      const commissionRate = activeCycle.commission_rate || 0;
      const commissionDue = Math.round(totalRevenue * (commissionRate / 100) * 100) / 100;

      await admin
        .from("commission_cycles")
        .update({
          total_revenue: totalRevenue,
          commission_due: commissionDue,
          updated_at: new Date().toISOString(),
        })
        .eq("id", activeCycle.id);
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("[saas-mobile-server] cafeteria revenue DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
