import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId") || searchParams.get("property_id");
    const organizationId = searchParams.get("organizationId") || searchParams.get("organization_id");

    const admin = createAdminClient();

    let orgId = organizationId;
    if (propertyId) {
      const access = await getPropertyAccess(auth.user.id, propertyId);
      if (!access.authorized) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!orgId) {
        const { data: prop } = await admin
          .from("properties")
          .select("organization_id")
          .eq("id", propertyId)
          .single();
        orgId = prop?.organization_id;
      }
    }

    let query = admin
      .from("electricity_bill_alerts")
      .select("*")
      .order("due_date", { ascending: true });

    if (propertyId) {
      query = query.or(`property_id.eq.${propertyId},property_id.is.null`);
    } else if (orgId) {
      query = query.eq("organization_id", orgId);
    }

    const { data: alerts, error } = await query;

    if (error) {
      // Fallback directly to electricity_bills table if view query has an issue
      let fallbackQuery = admin
        .from("electricity_bills")
        .select("*")
        .order("due_date", { ascending: false });

      if (orgId) fallbackQuery = fallbackQuery.eq("organization_id", orgId);

      const { data: fallbackBills, error: fbErr } = await fallbackQuery;
      if (fbErr) {
        return NextResponse.json({ error: fbErr.message }, { status: 500 });
      }

      const mapped = (fallbackBills || []).map((b) => ({
        id: b.id,
        site_label: b.consumer_name || "Main Grid Meter",
        provider: "Utility Board",
        consumer_ref: b.bill_number,
        property_id: propertyId,
        billing_month: b.billing_month,
        bill_date: b.bill_date,
        due_date: b.due_date,
        total_amount: b.total_amount,
        early_payment_date: b.early_payment_date,
        early_payment_amount: b.early_payment_amount,
        after_due_date_amount: b.after_due_date_amount,
        payment_status: b.payment_status || "pending",
        payment_date: b.payment_date,
        days_to_early_payment: null,
        days_to_due: null,
        discount_at_risk: b.early_payment_amount ? (b.total_amount - b.early_payment_amount) : 0,
        penalty_exposure: b.after_due_date_amount ? (b.after_due_date_amount - b.total_amount) : 0,
        urgency: b.payment_status === "paid" ? "settled" : "ok",
      }));

      return NextResponse.json({
        bills: mapped,
        stats: {
          totalLiability: mapped.reduce((sum, b) => sum + (b.total_amount || 0), 0),
          activeCount: mapped.filter((b) => b.payment_status !== "paid" && b.payment_status !== "settled").length,
          discountAtRisk: mapped.reduce((sum, b) => sum + (b.discount_at_risk || 0), 0),
          overdueCount: 0,
        },
      });
    }

    const allAlerts = alerts || [];
    const stats = {
      totalLiability: allAlerts
        .filter((b) => b.payment_status !== "paid" && b.payment_status !== "settled")
        .reduce((sum, b) => sum + Number(b.total_amount || 0), 0),
      activeCount: allAlerts.filter((b) => b.payment_status !== "paid" && b.payment_status !== "settled").length,
      discountAtRisk: allAlerts
        .filter((b) => b.urgency === "discount_expiring" || b.urgency === "due_soon")
        .reduce((sum, b) => sum + Number(b.discount_at_risk || 0), 0),
      overdueCount: allAlerts.filter((b) => b.urgency === "overdue").length,
    };

    return NextResponse.json({
      bills: allAlerts,
      stats,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
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
      property_id,
      organization_id,
      bill_number,
      billing_month,
      bill_date,
      due_date,
      total_amount,
      early_payment_date,
      early_payment_amount,
      after_due_date_amount,
      notes,
    } = body;

    if (!billing_month || !total_amount) {
      return NextResponse.json(
        { error: "billing_month and total_amount are required" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    let resolvedOrgId = organization_id;
    if (property_id) {
      const access = await getPropertyAccess(auth.user.id, property_id);
      if (!access.authorized) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!resolvedOrgId) {
        const { data: prop } = await admin
          .from("properties")
          .select("organization_id")
          .eq("id", property_id)
          .single();
        resolvedOrgId = prop?.organization_id;
      }
    }

    const { data: newBill, error } = await admin
      .from("electricity_bills")
      .insert({
        organization_id: resolvedOrgId,
        bill_number: bill_number || null,
        billing_month,
        bill_date: bill_date || null,
        due_date: due_date || null,
        total_amount: Number(total_amount),
        early_payment_date: early_payment_date || null,
        early_payment_amount: early_payment_amount ? Number(early_payment_amount) : null,
        after_due_date_amount: after_due_date_amount ? Number(after_due_date_amount) : null,
        payment_status: "pending",
        notes: notes || null,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ bill: newBill }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { bill_id, paid_amount, payment_date, notes } = body;

    if (!bill_id) {
      return NextResponse.json({ error: "bill_id is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: updated, error } = await admin
      .from("electricity_bills")
      .update({
        payment_status: "paid",
        paid_amount: paid_amount ? Number(paid_amount) : undefined,
        payment_date: payment_date || new Date().toISOString().slice(0, 10),
        notes: notes ? notes : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bill_id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ bill: updated });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
