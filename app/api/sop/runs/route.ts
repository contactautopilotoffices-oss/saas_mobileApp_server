import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageProperty } from "@/lib/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { templateId, propertyId } = body;

    if (!templateId || !propertyId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Since users may just be staff starting a checklist, allow property members
    const admin = createAdminClient();
    const { data: membership } = await admin
      .from("property_members")
      .select("role")
      .eq("user_id", auth.user.id)
      .eq("property_id", propertyId)
      .maybeSingle();

    if (!membership) {
      const { data: orgMembership } = await admin
        .from("organization_members")
        .select("role")
        .eq("user_id", auth.user.id)
        .maybeSingle();

      if (!orgMembership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: run, error } = await admin
      .from("sop_completions")
      .insert({
        template_id: templateId,
        property_id: propertyId,
        status: "in_progress",
        completed_by: auth.user.id
      })
      .select()
      .single();

    if (error) {
      console.error("[saas-mobile-server] sop runs POST error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, run }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] sop runs POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
