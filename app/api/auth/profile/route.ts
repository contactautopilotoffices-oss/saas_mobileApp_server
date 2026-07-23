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
    const userId = auth.user.id;

    // Get user profile
    const { data: userProfile } = await admin
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (!userProfile) {
      return NextResponse.json({ error: "User profile not found" }, { status: 404 });
    }

    // Get organization memberships
    const { data: orgMemberships } = await admin
      .from("organization_memberships")
      .select("*, organizations(id, name, code)")
      .eq("user_id", userId)
      .eq("is_active", true);

    // Get property memberships
    const { data: propMemberships } = await admin
      .from("property_memberships")
      .select("*, properties(id, name, code, organization_id)")
      .eq("user_id", userId)
      .eq("is_active", true);

    // Determine user role
    const ORG_LEVEL_ROLES = ['org_super_admin', 'super_tenant', 'owner', 'admin', 'org_admin', 'maintenance_vendor'];
    const activeOrgMemberships = (orgMemberships ?? []).filter(
      (m: any) => ORG_LEVEL_ROLES.includes(m.role) && (m.is_active === true || m.is_active === null)
    );

    const ORG_PRIORITY = ['org_super_admin', 'super_tenant', 'owner', 'admin', 'member'];
    const bestOrg = [...activeOrgMemberships].sort((a: any, b: any) => {
      const ai = ORG_PRIORITY.indexOf(a.role) === -1 ? 99 : ORG_PRIORITY.indexOf(a.role);
      const bi = ORG_PRIORITY.indexOf(b.role) === -1 ? 99 : ORG_PRIORITY.indexOf(b.role);
      return ai - bi;
    })[0];

    // Property level roles
    const PROPERTY_LEVEL_ROLES = ['property_admin', 'admin', 'manager', 'property_manager', 'facility_manager', 'mst', 'staff'];
    const activePropMemberships = (propMemberships ?? []).filter(
      (m: any) => PROPERTY_LEVEL_ROLES.includes(m.role) && (m.is_active === true || m.is_active === null)
    );

    const PROP_PRIORITY = ['property_admin', 'admin', 'manager', 'mst', 'staff'];
    const bestProp = [...activePropMemberships].sort((a: any, b: any) => {
      const ai = PROP_PRIORITY.indexOf(a.role) === -1 ? 99 : PROP_PRIORITY.indexOf(a.role);
      const bi = PROP_PRIORITY.indexOf(b.role) === -1 ? 99 : PROP_PRIORITY.indexOf(b.role);
      return ai - bi;
    })[0];

    // Get organization details
    let organizationId = bestOrg?.organization_id ?? null;
    let organizationName = bestOrg?.organizations?.name ?? null;

    // Get property details
    let propertyId = bestProp?.property_id ?? null;
    let propertyName = bestProp?.properties?.name ?? null;
    let propertyRole = bestProp?.role ?? null;

    return NextResponse.json({
      success: true,
      data: {
        user: userProfile,
        organization_memberships: orgMemberships ?? [],
        property_memberships: propMemberships ?? [],
        organizationId,
        organizationName,
        propertyId,
        propertyName,
        propertyRole,
        isMasterAdmin: userProfile.email === 'sanyog@gmail.com' || userProfile.is_master_admin === true,
      }
    });
  } catch (error) {
    console.error("[auth/profile] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
