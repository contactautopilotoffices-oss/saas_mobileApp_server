import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("hr_ticket_categories")
      .select("id, category_name, ticket_type, first_level_owner_type, is_confidential, is_anonymous, l1_sla_days, l2_sla_days, l3_sla_days, l4_sla_days")
      .order("category_name", { ascending: true });

    if (error) {
      console.error("[saas-mobile-server] hr categories error:", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (err: any) {
    console.error("[saas-mobile-server] hr categories exception:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
