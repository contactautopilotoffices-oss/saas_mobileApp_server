import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const propertyId = request.nextUrl.searchParams.get("propertyId");
    const query = request.nextUrl.searchParams.get("query") || "";
    if (!propertyId) return NextResponse.json({ error: "Missing propertyId" }, { status: 400 });

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();

    // Fetch all active property members with user details
    const { data, error } = await admin
      .from("property_memberships")
      .select("user_id, role, users!inner(id, full_name, email)")
      .eq("property_id", propertyId)
      .eq("is_active", true);

    if (error) return NextResponse.json({ error: "Failed to fetch hosts: " + error.message }, { status: 500 });

    // Filter and transform in JS
    const lq = query.toLowerCase();
    const hosts = (data ?? [])
      .map((row: any) => ({
        id: row.user_id,
        full_name: row.users?.full_name ?? "Unknown",
        email: row.users?.email ?? "",
        role: row.role || "",
        name: row.users?.full_name ?? "Unknown",
      }))
      .filter((row: any) => {
        if (!row.id) return false;
        if (query.length < 2) return true;
        return row.full_name?.toLowerCase().includes(lq) || row.email?.toLowerCase().includes(lq);
      })
      .slice(0, 20);

    return NextResponse.json({ hosts });
  } catch (error) {
    console.error("[saas-mobile-server] visitors hosts GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
