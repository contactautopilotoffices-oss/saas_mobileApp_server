import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

function getNextMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, m, 1);
  return date.toISOString().split("T")[0];
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const vendorId = searchParams.get("vendorId");
    const month = searchParams.get("month");
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");
    const period = searchParams.get("period"); // today | month | all

    if (!propertyId || propertyId === "undefined" || propertyId === "null") {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Vendor isolation: vendor users can only see their own vendor's revenue
    let allowedVendorIds: string[] | null = null;
    if (access.role === "vendor") {
      const { data: userVendors } = await admin
        .from("vendors")
        .select("id")
        .eq("property_id", propertyId)
        .eq("user_id", auth.user.id);
      allowedVendorIds = (userVendors ?? []).map((v) => v.id);
      if (allowedVendorIds.length === 0) {
        return NextResponse.json({ success: true, revenues: [] });
      }
    }

    // Build base query
    let query = admin
      .from("vendor_daily_revenue")
      .select("*, vendor:vendors(id, shop_name, commission_rate)")
      .eq("property_id", propertyId);

    if (allowedVendorIds) {
      query = query.in("vendor_id", allowedVendorIds);
    } else if (vendorId) {
      query = query.eq("vendor_id", vendorId);
    }

    if (month) {
      query = query.gte("revenue_date", `${month}-01`).lt("revenue_date", getNextMonth(month));
    } else if (period === "today") {
      const today = new Date().toISOString().split("T")[0];
      query = query.eq("revenue_date", today);
    } else if (period === "month") {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
      query = query.gte("revenue_date", monthStart);
    }

    if (fromDate) query = query.gte("revenue_date", fromDate);
    if (toDate) query = query.lte("revenue_date", toDate);

    query = query.order("revenue_date", { ascending: false });

    const { data: revenues, error } = await query;

    if (error) {
      console.error("[saas-mobile-server] cafeteria revenue GET error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, revenues: revenues ?? [] });
  } catch (error) {
    console.error("[saas-mobile-server] cafeteria revenue GET error:", error);
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
    const { property_id, vendor_id, revenue_date, revenue_amount } = body;

    if (!property_id || !vendor_id || !revenue_date || revenue_amount === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Vendors can only submit for themselves; admins can submit for any vendor in the property
    const access = await getPropertyAccess(auth.user.id, property_id);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const isAdmin = await canManageProperty(auth.user.id, property_id);
    const admin = createAdminClient();

    if (!isAdmin) {
      // Verify this vendor row belongs to the current user
      const { data: vendor } = await admin
        .from("vendors")
        .select("user_id")
        .eq("id", vendor_id)
        .single();

      if (!vendor || vendor.user_id !== auth.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Upsert by vendor_id + revenue_date
    const { data: existing } = await admin
      .from("vendor_daily_revenue")
      .select("id")
      .eq("vendor_id", vendor_id)
      .eq("revenue_date", revenue_date)
      .maybeSingle();

    const payload = {
      property_id,
      vendor_id,
      revenue_date,
      revenue_amount: Number(revenue_amount),
      updated_by: auth.user.id,
      created_by: auth.user.id,
    };

    let result;
    if (existing?.id) {
      const { data, error } = await admin
        .from("vendor_daily_revenue")
        .update(payload)
        .eq("id", existing.id)
        .select("*, vendor:vendors(id, name, commission_rate)")
        .single();

      if (error) {
        console.error("[saas-mobile-server] cafeteria revenue POST update error:", error);
        return NextResponse.json({ error: "Failed to update revenue" }, { status: 500 });
      }
      result = data;
    } else {
      const { data, error } = await admin
        .from("vendor_daily_revenue")
        .insert(payload)
        .select("*, vendor:vendors(id, name, commission_rate)")
        .single();

      if (error) {
        console.error("[saas-mobile-server] cafeteria revenue POST insert error:", error);
        return NextResponse.json({ error: "Failed to create revenue" }, { status: 500 });
      }
      result = data;
    }

    // Update active commission cycle if one exists
    const { data: activeCycle } = await admin
      .from("commission_cycles")
      .select("id, cycle_start, cycle_end, commission_rate")
      .eq("vendor_id", vendor_id)
      .eq("status", "in_progress")
      .maybeSingle();

    if (activeCycle && revenue_date >= activeCycle.cycle_start && revenue_date <= activeCycle.cycle_end) {
      const { data: cycleRevenues } = await admin
        .from("vendor_daily_revenue")
        .select("revenue_amount")
        .eq("vendor_id", vendor_id)
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

    return NextResponse.json({ success: true, revenue: result }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] cafeteria revenue POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
