import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/checklist/scan?templateId=xxx&propertyId=xxx&organizationId=xxx
 * Validates a template and creates a new completion record when scanned
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const templateId = request.nextUrl.searchParams.get("templateId");
    const propertyId = request.nextUrl.searchParams.get("propertyId");
    const organizationId = request.nextUrl.searchParams.get("organizationId");

    if (!templateId) {
      return NextResponse.json({ error: "templateId is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Fetch the template
    const { data: template, error: templateError } = await admin
      .from("sop_templates")
      .select("id, title")
      .eq("id", templateId)
      .maybeSingle();

    if (templateError || !template) {
      return NextResponse.json({ error: "SOP template not found for this QR code" }, { status: 404 });
    }

    let completion = null;

    // If propertyId and organizationId provided, create a completion record
    if (propertyId && organizationId) {
      const { data: newCompletion, error: completionError } = await admin
        .from("sop_completions")
        .insert({
          template_id: templateId,
          property_id: propertyId,
          organization_id: organizationId,
          status: "in_progress",
          completed_by: auth.user.id,
          completion_date: new Date().toISOString().split("T")[0],
        })
        .select("id")
        .single();

      if (completionError) {
        console.error("[checklist/scan] completion error:", completionError);
        return NextResponse.json({ error: "Failed to start checklist" }, { status: 500 });
      }

      completion = newCompletion;
    }

    return NextResponse.json({
      success: true,
      data: {
        template: { id: template.id, title: template.title },
        completionId: completion?.id ?? templateId,
      }
    });
  } catch (error) {
    console.error("[checklist/scan] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
