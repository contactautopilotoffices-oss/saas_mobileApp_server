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
    if (!propertyId) {
      return NextResponse.json({ error: "Missing propertyId" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: companies, error } = await admin
      .from("companies")
      .select(`
        *,
        members:company_members(
          user_id,
          user:users(id, full_name, email, user_photo_url)
        ),
        credits:meeting_room_credits(
          id,
          monthly_hours,
          remaining_hours
        )
      `)
      .eq("property_id", propertyId);

    if (error) {
      console.error("[saas-mobile-server] companies GET query error:", error);
      return NextResponse.json({ error: error.message || "Failed to fetch companies" }, { status: 500 });
    }

    return NextResponse.json({ success: true, companies: companies ?? [] });
  } catch (error) {
    console.error("[saas-mobile-server] companies GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
