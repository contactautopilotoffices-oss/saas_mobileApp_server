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
    const admin = createAdminClient();

    const { data: properties, error } = await admin
      .from("properties")
      .select("id, name, code, status")
      .eq("organization_id", orgId)
      .order("name", { ascending: true });

    if (error) {
      console.error("[organizations/[id]/properties] error:", error);
      return NextResponse.json({ error: "Failed to fetch properties" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: properties ?? [] });
  } catch (error) {
    console.error("[organizations/[id]/properties] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
