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
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    if (!propertyId || propertyId === "undefined" || propertyId === "null") {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Vendor isolation: vendor users can only see their own vendor's analytics
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
          date_from: dateFrom || new Date().toISOString().split("T")[0],
          date_to: dateTo || new Date().toISOString().split("T")[0],
          total_revenue: 0,
          total_commission: 0,
          active_vendors: 0,
          trend: [],
          vendor_breakdown: [],
        });
      }
    }

    // Food vendors
    let vendorQuery = admin
      .from("vendors")
      .select("id, shop_name, commission_rate")
      .eq("property_id", propertyId)
      .eq("status", "active");

    if (allowedVendorIds) {
      vendorQuery = vendorQuery.in("id", allowedVendorIds);
    }

    vendorQuery = vendorQuery.order("shop_name", { ascending: true });

    const { data: vendors, error: vendorsError } = await vendorQuery;

    if (vendorsError) {
      console.error("[saas-mobile-server] cafeteria analytics vendors error:", vendorsError);
      return NextResponse.json({ error: vendorsError.message }, { status: 500 });
    }

    const vendorIds = (vendors ?? []).map((v) => v.id);

    // Default date range: current month
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const defaultTo = now.toISOString().split("T")[0];
    const fromDate = dateFrom || defaultFrom;
    const toDate = dateTo || defaultTo;

    // Daily revenue in range
    let revenueQuery = admin
      .from("vendor_daily_revenue")
      .select("vendor_id, revenue_date, revenue_amount")
      .eq("property_id", propertyId)
      .gte("revenue_date", fromDate)
      .lte("revenue_date", toDate);

    if (vendorIds.length > 0) {
      revenueQuery = revenueQuery.in("vendor_id", vendorIds);
    }

    revenueQuery = revenueQuery.order("revenue_date", { ascending: true });

    const { data: revenues, error: revenueError } = await revenueQuery;

    if (revenueError) {
      console.error("[saas-mobile-server] cafeteria analytics revenue error:", revenueError);
      return NextResponse.json({ error: revenueError.message }, { status: 500 });
    }

    // Build daily trend
    const trendMap = new Map<string, number>();
    const commissionMap = new Map<string, number>();
    const vendorRateMap = new Map((vendors ?? []).map((v) => [v.id, v.commission_rate || 0]));

    for (const r of revenues ?? []) {
      const date = r.revenue_date;
      const amount = r.revenue_amount || 0;
      const rate = vendorRateMap.get(r.vendor_id) || 0;
      trendMap.set(date, (trendMap.get(date) || 0) + amount);
      commissionMap.set(date, (commissionMap.get(date) || 0) + amount * (rate / 100));
    }

    const trend = Array.from(trendMap.entries()).map(([date, revenue]) => ({
      date,
      revenue,
      commission: Math.round((commissionMap.get(date) || 0) * 100) / 100,
    }));

    // Vendor breakdown
    const vendorBreakdown = (vendors ?? []).map((v) => {
      const vendorRevenues = (revenues ?? []).filter((r) => r.vendor_id === v.id);
      const totalRevenue = vendorRevenues.reduce((sum, r) => sum + (r.revenue_amount || 0), 0);
      const totalCommission = totalRevenue * ((v.commission_rate || 0) / 100);
      return {
        vendor_id: v.id,
        vendor_name: v.shop_name,
        commission_rate: v.commission_rate || 0,
        total_revenue: totalRevenue,
        total_commission: Math.round(totalCommission * 100) / 100,
        entry_count: vendorRevenues.length,
      };
    });

    const totalRevenue = (revenues ?? []).reduce((sum, r) => sum + (r.revenue_amount || 0), 0);
    const totalCommission = vendorBreakdown.reduce((sum, v) => sum + v.total_commission, 0);

    return NextResponse.json({
      success: true,
      property_id: propertyId,
      date_from: fromDate,
      date_to: toDate,
      total_revenue: totalRevenue,
      total_commission: Math.round(totalCommission * 100) / 100,
      active_vendors: vendorIds.length,
      trend,
      vendor_breakdown: vendorBreakdown,
    });
  } catch (error) {
    console.error("[saas-mobile-server] cafeteria analytics GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
