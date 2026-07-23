import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const period = searchParams.get("period") || "today"; // today | month | all

    if (!propertyId || propertyId === "undefined" || propertyId === "null") {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Vendor isolation: vendor users can only see their own vendor's summary
    let allowedVendorIds: string[] | null = null;
    if (access.role === "vendor") {
      const { data: userVendors } = await admin
        .from("vendors")
        .select("id")
        .eq("property_id", propertyId)
        .eq("user_id", auth.user.id);
      allowedVendorIds = (userVendors ?? []).map((v) => v.id);
      if (allowedVendorIds.length === 0) {
        return NextResponse.json({
          success: true,
          property_id: propertyId,
          period,
          total_revenue: 0,
          total_commission: 0,
          active_vendors: 0,
        });
      }
    }

    // Active food vendors
    let vendorQuery = admin
      .from("vendors")
      .select("id, commission_rate")
      .eq("property_id", propertyId)
      .eq("status", "active")
      .or("role.eq.food_vendor,service_type.eq.food_vendor,category.eq.food_vendor");

    if (allowedVendorIds) {
      vendorQuery = vendorQuery.in("id", allowedVendorIds);
    }

    const { data: vendors, error: vendorsError } = await vendorQuery;

    if (vendorsError) {
      console.error("[saas-mobile-server] cafeteria summary vendors error:", vendorsError);
      return NextResponse.json({ error: vendorsError.message }, { status: 500 });
    }

    const vendorIds = (vendors ?? []).map((v) => v.id);

    // Date filter
    let fromDate: string | null = null;
    let toDate: string | null = null;
    const today = new Date().toISOString().split("T")[0];

    if (period === "today") {
      fromDate = today;
      toDate = today;
    } else if (period === "month") {
      fromDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
      toDate = today;
    }

    let revenueQuery = admin
      .from("vendor_daily_revenue")
      .select("vendor_id, revenue_amount")
      .in("vendor_id", vendorIds.length > 0 ? vendorIds : ["00000000-0000-0000-0000-000000000000"]);

    if (fromDate) revenueQuery = revenueQuery.gte("revenue_date", fromDate);
    if (toDate) revenueQuery = revenueQuery.lte("revenue_date", toDate);

    const { data: revenues, error: revenueError } = await revenueQuery;

    if (revenueError) {
      console.error("[saas-mobile-server] cafeteria summary revenue error:", revenueError);
      return NextResponse.json({ error: revenueError.message }, { status: 500 });
    }

    const totalRevenue = (revenues ?? []).reduce((sum, r) => sum + (r.revenue_amount || 0), 0);

    // Estimate commission using vendor commission rates
    const commissionMap = new Map((vendors ?? []).map((v) => [v.id, v.commission_rate || 0]));
    const totalCommission = (revenues ?? []).reduce((sum, r) => {
      const rate = commissionMap.get(r.vendor_id) || 0;
      return sum + r.revenue_amount * (rate / 100);
    }, 0);

    return NextResponse.json({
      success: true,
      property_id: propertyId,
      period,
      total_revenue: totalRevenue,
      total_commission: Math.round(totalCommission * 100) / 100,
      active_vendors: vendorIds.length,
    });
  } catch (error) {
    console.error("[saas-mobile-server] cafeteria summary GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
