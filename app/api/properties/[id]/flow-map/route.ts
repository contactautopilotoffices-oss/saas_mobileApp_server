import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: propertyId } = await context.params;
    if (!propertyId) {
      return NextResponse.json({ error: "Property id is required" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Fetch property name
    const { data: property } = await admin
      .from("properties")
      .select("name")
      .eq("id", propertyId)
      .maybeSingle();

    // Check validation feature
    const { data: feature } = await admin
      .from("property_features")
      .select("is_enabled")
      .eq("property_id", propertyId)
      .eq("feature_key", "ticket_validation")
      .maybeSingle();

    // Fetch tickets with related data
    const { data: tickets, error } = await admin
      .from("tickets")
      .select(`
        *,
        assignee:users!assigned_to(id, full_name, user_photo_url),
        creator:users!raised_by(id, full_name),
        ticket_escalation_logs(
          from_level,
          to_level,
          escalated_at,
          from_employee:users!from_employee_id(full_name, user_photo_url),
          to_employee:users!to_employee_id(full_name, user_photo_url)
        )
      `)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[properties/[id]/flow-map] error:", error);
      return NextResponse.json({ error: "Failed to fetch tickets" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        tickets: tickets ?? [],
        propertyName: property?.name ?? "Property",
        validationEnabled: feature?.is_enabled === true,
      }
    });
  } catch (error) {
    console.error("[properties/[id]/flow-map] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
