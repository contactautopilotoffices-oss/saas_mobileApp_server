import { createAdminClient } from "@/lib/supabase/admin";

const ORG_ADMIN_ROLES = new Set(["org_super_admin", "org_admin", "admin", "owner"]);
const PROPERTY_ADMIN_ROLES = new Set(["property_admin"]);
const CREDIT_ADMIN_ROLES = new Set(["property_admin", "staff", "security", "org_admin", "org_super_admin", "owner"]);
const MST_ROLES = new Set(["mst", "master_admin", "super_admin"]);
const PROPERTY_MANAGER_ROLES = new Set(["property_admin", "admin", "manager", "property_manager", "facility_manager", "spoc", "administrator"]);

export async function getUserProfile(userId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("users").select("id, is_master_admin").eq("id", userId).maybeSingle();
  return data;
}

export async function getPropertyOrganizationId(propertyId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("properties").select("organization_id").eq("id", propertyId).maybeSingle();
  return data?.organization_id ?? null;
}

export async function getOrganizationRole(userId: string, organizationId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("organization_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .or("is_active.eq.true,is_active.is.null")
    .maybeSingle();

  return data?.role ?? null;
}

export async function getPropertyRole(userId: string, propertyId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("property_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("property_id", propertyId)
    .or("is_active.eq.true,is_active.is.null")
    .maybeSingle();

  return data?.role ?? null;
}

export async function canManageOrganization(userId: string, organizationId: string) {
  const profile = await getUserProfile(userId);
  if (profile?.is_master_admin) return true;
  const orgRole = await getOrganizationRole(userId, organizationId);
  return !!orgRole && ORG_ADMIN_ROLES.has(orgRole);
}

export async function canManageProperty(userId: string, propertyId: string) {
  const profile = await getUserProfile(userId);
  if (profile?.is_master_admin) return true;

  // Check MST role in property_memberships first
  const propertyRole = await getPropertyRole(userId, propertyId);
  if (propertyRole && MST_ROLES.has(propertyRole)) return true;
  if (propertyRole && PROPERTY_ADMIN_ROLES.has(propertyRole)) return true;
  if (propertyRole && PROPERTY_MANAGER_ROLES.has(propertyRole)) return true;

  // Check org-level membership
  const organizationId = await getPropertyOrganizationId(propertyId);
  if (organizationId) {
    const orgRole = await getOrganizationRole(userId, organizationId);
    if (orgRole && ORG_ADMIN_ROLES.has(orgRole)) return true;
    if (orgRole && MST_ROLES.has(orgRole)) return true;
  }

  return false;
}

export async function canManageMeetingRoomCredits(userId: string, propertyId: string) {
  const profile = await getUserProfile(userId);
  if (profile?.is_master_admin) return true;

  const propertyRole = await getPropertyRole(userId, propertyId);
  if (propertyRole && MST_ROLES.has(propertyRole)) return true;
  if (propertyRole && CREDIT_ADMIN_ROLES.has(propertyRole)) return true;

  const organizationId = await getPropertyOrganizationId(propertyId);
  if (organizationId) {
    const orgRole = await getOrganizationRole(userId, organizationId);
    if (orgRole && ORG_ADMIN_ROLES.has(orgRole)) return true;
  }

  return false;
}
