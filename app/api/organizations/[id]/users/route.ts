import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: orgId } = await context.params;
    if (!orgId) {
      return NextResponse.json({ error: "Organization id is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data, error } = await admin
      .from("organization_memberships")
      .select("role, is_active, created_at, users(id, full_name, email, phone)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[organizations/[id]/users] error:", error);
      return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    console.error("[organizations/[id]/users] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
