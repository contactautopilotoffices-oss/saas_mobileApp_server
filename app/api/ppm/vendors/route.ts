import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: vendors, error } = await admin
      .from("maintenance_vendors")
      .select("id, company_name, contact_person, phone, email, specialization, is_active")
      .eq("is_active", true)
      .order("company_name", { ascending: true });

    if (error) {
      console.error("[saas-mobile-server] ppm vendors GET error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, vendors: vendors ?? [] });
  } catch (error) {
    console.error("[saas-mobile-server] ppm vendors GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
