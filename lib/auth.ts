import { NextRequest, NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/client";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export async function getAuthenticatedUser(request: NextRequest): Promise<{
  token: string | null;
  user: AuthenticatedUser | null;
  response?: NextResponse;
}> {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    return {
      token: null,
      user: null,
      response: NextResponse.json({ error: "Missing bearer token" }, { status: 401 })
    };
  }

  const supabase = createAnonClient(token);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return {
      token,
      user: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    };
  }

  return {
    token,
    user: {
      id: data.user.id,
      email: data.user.email
    }
  };
}

// ── Role Constants (aligned with app_role enum + saas_one web app) ─────────
// NOTE: The DB enum app_role only contains: master_admin, org_super_admin,
// property_admin, staff, tenant, food_vendor, mst, security, vendor,
// soft_service_staff, soft_service_supervisor, soft_service_manager,
// super_tenant, maintenance_vendor, procurement.
// The web app TypeScript types also reference org_admin / owner, but these
// do NOT exist in the current DB enum.

/** Org-level admin roles that have access to ALL properties in the org */
const ORG_ADMIN_ROLES = new Set(["org_super_admin", "org_admin", "owner"]);

/** Property-level roles that grant scoped access to a specific property */
const PROPERTY_ROLES = new Set([
  "property_admin", "staff", "mst", "tenant", "security",
  "soft_service_manager", "soft_service_staff", "soft_service_supervisor",
  "food_vendor", "vendor", "maintenance_vendor", "procurement"
]);

/** MST roles - can be stored in either org_memberships or property_memberships */
const MST_ROLES = ['mst', 'master_admin', 'super_admin'];

// ── Property Access (read gate) ────────────────────────────────────────────
// Mirrors saas_one web app property-access logic + super_tenant portfolio check.
// Any user that can READ property data passes this gate.

export async function getPropertyAccess(userId: string, propertyId: string) {
  const admin = createAdminClient();

  console.log(`[getPropertyAccess] START userId: ${userId}, propertyId: ${propertyId}`);

  // 1. Master admin bypass
  const { data: userProfile } = await admin
    .from("users")
    .select("is_master_admin")
    .eq("id", userId)
    .maybeSingle();

  if (userProfile?.is_master_admin) {
    console.log(`[getPropertyAccess] Master admin bypass`);
    return { authorized: true, role: "master_admin" };
  }

  // 2. Get property's organization
  const { data: property, error: pError } = await admin
    .from("properties")
    .select("organization_id")
    .eq("id", propertyId)
    .maybeSingle();

  if (pError) console.error(`[getPropertyAccess] Property error:`, pError);

  // 3. Check property-level membership FIRST (MST may store role here)
  const { data: propertyMembership, error: pmError } = await admin
    .from("property_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("property_id", propertyId)
    .or("is_active.eq.true,is_active.is.null")
    .maybeSingle();

  if (pmError) console.error(`[getPropertyAccess] Property membership error:`, pmError);
  console.log(`[getPropertyAccess] propertyMembership:`, propertyMembership);

  if (propertyMembership) {
    // MST users from property_memberships get access
    if (MST_ROLES.includes(propertyMembership.role)) {
      return { authorized: true, role: propertyMembership.role };
    }
    // All other property-level roles get access
    return { authorized: true, role: propertyMembership.role };
  }

  // 4. If no property membership, check org-level membership
  if (property?.organization_id) {
    const { data: orgMembership, error: omError } = await admin
      .from("organization_memberships")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", property.organization_id)
      .or("is_active.eq.true,is_active.is.null")
      .maybeSingle();

    if (omError) console.error(`[getPropertyAccess] Org membership error:`, omError);
    console.log(`[getPropertyAccess] orgMembership:`, orgMembership);

    if (orgMembership) {
      // MST users get access to ALL properties in the org
      if (MST_ROLES.includes(orgMembership.role)) {
        return { authorized: true, role: orgMembership.role };
      }

      // Org admins get access to ALL properties in the org
      if (ORG_ADMIN_ROLES.has(orgMembership.role)) {
        return { authorized: true, role: orgMembership.role };
      }

      // Super tenant: must have property in their portfolio
      if (orgMembership.role === "super_tenant") {
        const { data: stProp } = await admin
          .from("super_tenant_properties")
          .select("id")
          .eq("user_id", userId)
          .eq("property_id", propertyId)
          .eq("organization_id", property.organization_id)
          .maybeSingle();

        if (stProp) {
          return { authorized: true, role: "super_tenant" };
        }
      }

      // Any active org member can read property-scoped data
      return { authorized: true, role: orgMembership.role };
    }
  }

  console.log(`[getPropertyAccess] FAILED. Returning authorized: false`);
  return { authorized: false as const };
}
