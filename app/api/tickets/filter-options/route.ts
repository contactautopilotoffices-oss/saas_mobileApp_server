import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/tickets/filter-options
 * Returns available filter options for tickets:
 * - Issue categories
 * - Skill groups
 * - Priority levels
 * - Status values
 * - Staff/MST members by property
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const propertyId = searchParams.get("propertyId") || searchParams.get("property_id");
    const organizationId = searchParams.get("organizationId") || searchParams.get("organization_id");

    if (!propertyId && !organizationId) {
      return NextResponse.json({
        error: "Either propertyId or organizationId is required"
      }, { status: 400 });
    }

    const admin = createAdminClient();
    const result: Record<string, any> = {};

    // Fetch issue categories
    let categoriesQuery = admin
      .from("issue_categories")
      .select("id, code, name, icon, priority, sla_hours")
      .order("name");

    if (propertyId) {
      categoriesQuery = categoriesQuery.eq("property_id", propertyId);
    }
    if (organizationId) {
      categoriesQuery = categoriesQuery.eq("organization_id", organizationId);
    }

    const { data: categories, error: categoriesError } = await categoriesQuery;
    if (categoriesError) {
      console.error("[tickets/filter-options] categories error:", categoriesError);
    }
    result.categories = categories || [];

    // Fetch skill groups
    let skillGroupsQuery = admin
      .from("skill_groups")
      .select("id, code, name, is_manual_assign")
      .order("name");

    if (propertyId) {
      skillGroupsQuery = skillGroupsQuery.eq("property_id", propertyId);
    }
    if (organizationId) {
      skillGroupsQuery = skillGroupsQuery.eq("organization_id", organizationId);
    }

    const { data: skillGroups, error: skillGroupsError } = await skillGroupsQuery;
    if (skillGroupsError) {
      console.error("[tickets/filter-options] skill groups error:", skillGroupsError);
    }
    result.skillGroups = skillGroups || [];

    // Static priority levels
    result.priorities = [
      { value: "low", label: "Low", color: "#22c55e" },
      { value: "medium", label: "Medium", color: "#3b82f6" },
      { value: "high", label: "High", color: "#f97316" },
      { value: "urgent", label: "Urgent", color: "#ef4444" },
      { value: "critical", label: "Critical", color: "#dc2626" },
    ];

    // Static status values with labels
    result.statuses = [
      { value: "open", label: "Open", color: "#6b7280" },
      { value: "waitlist", label: "Waitlist", color: "#f59e0b" },
      { value: "assigned", label: "Assigned", color: "#3b82f6" },
      { value: "in_progress", label: "In Progress", color: "#06b6d4" },
      { value: "pending_validation", label: "Pending Approval", color: "#8b5cf6" },
      { value: "resolved", label: "Resolved", color: "#22c55e" },
      { value: "closed", label: "Closed", color: "#10b981" },
    ];

    // Fetch staff/MST members for this property (excludes tenants, clients, procurement)
    if (propertyId) {
      const { data: members, error: membersError } = await admin
        .from("property_memberships")
        .select(`
          user_id,
          role,
          is_active,
          user:users(id, full_name, email, user_photo_url)
        `)
        .eq("property_id", propertyId)
        .eq("is_active", true)
        .not("role", "ilike", "%tenant%")
        .not("role", "ilike", "%client%")
        .not("role", "ilike", "%procurement%");

      if (membersError) {
        console.error("[tickets/filter-options] members error:", membersError);
      }

      result.staff = (members || [])
        .filter((m: any) => m.user)
        .map((m: any) => ({
          id: m.user.id,
          full_name: m.user.full_name,
          email: m.user.email,
          user_photo_url: m.user.user_photo_url,
          role: m.role,
        }));
    }

    // Fetch property features (for validation toggle)
    if (propertyId) {
      const { data: features, error: featuresError } = await admin
        .from("property_features")
        .select("feature_key, is_enabled")
        .eq("property_id", propertyId);

      if (featuresError) {
        console.error("[tickets/filter-options] features error:", featuresError);
      }

      const validationFeature = features?.find(
        (f: any) => f.feature_key === "ticket_validation"
      );
      // Default to true if not configured
      result.validationEnabled = validationFeature ? validationFeature.is_enabled : true;
    }

    return NextResponse.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("[tickets/filter-options] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
