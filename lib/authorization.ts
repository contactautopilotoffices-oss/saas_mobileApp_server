import { createAdminClient } from "@/lib/supabase/admin";

const ORG_ADMIN_ROLES = new Set(["org_super_admin", "org_admin", "admin", "owner"]);
const PROPERTY_ADMIN_ROLES = new Set(["property_admin"]);
const CREDIT_ADMIN_ROLES = new Set(["property_admin", "staff", "security", "org_admin", "org_super_admin", "owner"]);
const MST_ROLES = new Set(["mst", "master_admin", "super_admin"]);
const PROPERTY_MANAGER_ROLES = new Set(["property_admin", "admin", "manager", "property_manager", "facility_manager", "spoc", "administrator"]);
const STOCK_MANAGE_ROLES = new Set([
  "property_admin",
  "admin",
  "manager",
  "property_manager",
  "facility_manager",
  "spoc",
  "administrator",
  "staff",
  "soft_service_manager",
  "soft_service_supervisor",
  "soft_service_staff",
  "technician",
  "procurement",
  "security",
  "vendor",
  "food_vendor",
  "maintenance_vendor",
  "mst",
  "master_admin",
  "super_admin",
  "org_admin",
  "org_super_admin",
  "owner"
]);

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
  return !!orgRole && ORG_ADMIN_ROLES.has(orgRole.toLowerCase());
}

export async function canManageProperty(userId: string, propertyId: string) {
  const profile = await getUserProfile(userId);
  if (profile?.is_master_admin) return true;

  // Check MST role in property_memberships first
  const propertyRole = await getPropertyRole(userId, propertyId);
  if (propertyRole) {
    const norm = propertyRole.toLowerCase();
    if (MST_ROLES.has(norm)) return true;
    if (PROPERTY_ADMIN_ROLES.has(norm)) return true;
    if (PROPERTY_MANAGER_ROLES.has(norm)) return true;
  }

  // Check org-level membership
  const organizationId = await getPropertyOrganizationId(propertyId);
  if (organizationId) {
    const orgRole = await getOrganizationRole(userId, organizationId);
    if (orgRole) {
      const normOrg = orgRole.toLowerCase();
      if (ORG_ADMIN_ROLES.has(normOrg)) return true;
      if (MST_ROLES.has(normOrg)) return true;
    }
  }

  return false;
}

export async function canManageMeetingRoomCredits(userId: string, propertyId: string) {
  const profile = await getUserProfile(userId);
  if (profile?.is_master_admin) return true;

  const propertyRole = await getPropertyRole(userId, propertyId);
  if (propertyRole) {
    const norm = propertyRole.toLowerCase();
    if (MST_ROLES.has(norm)) return true;
    if (CREDIT_ADMIN_ROLES.has(norm)) return true;
  }

  const organizationId = await getPropertyOrganizationId(propertyId);
  if (organizationId) {
    const orgRole = await getOrganizationRole(userId, organizationId);
    if (orgRole) {
      const normOrg = orgRole.toLowerCase();
      if (ORG_ADMIN_ROLES.has(normOrg)) return true;
    }
  }

  return false;
}

export async function canManageStock(userId: string, propertyId: string): Promise<boolean> {
  const profile = await getUserProfile(userId);
  if (profile?.is_master_admin) return true;

  const propertyRole = await getPropertyRole(userId, propertyId);
  if (propertyRole) {
    const norm = propertyRole.toLowerCase();
    if (STOCK_MANAGE_ROLES.has(norm) || MST_ROLES.has(norm)) return true;
  }

  const organizationId = await getPropertyOrganizationId(propertyId);
  if (organizationId) {
    const orgRole = await getOrganizationRole(userId, organizationId);
    if (orgRole) {
      const normOrg = orgRole.toLowerCase();
      if (ORG_ADMIN_ROLES.has(normOrg) || MST_ROLES.has(normOrg) || STOCK_MANAGE_ROLES.has(normOrg)) return true;
    }
  }

  return false;
}
