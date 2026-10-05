import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageOrganization, canManageProperty } from "@/lib/authorization";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const orgId = searchParams.get("orgId") ?? searchParams.get("organizationId");
    const propertyId = searchParams.get("propertyId");

    if (!propertyId || propertyId === 'undefined' || propertyId === 'null') {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    if (!orgId && !propertyId) {
      return NextResponse.json({ error: "Missing required parameter: orgId or propertyId" }, { status: 400 });
    }

    const admin = createAdminClient();

    if (propertyId) {
      const hasAccess = await getPropertyAccess(auth.user.id, propertyId);
      const canManage = await canManageProperty(auth.user.id, propertyId);
      if (!hasAccess.authorized || !canManage) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const { data, error } = await admin
        .from("property_memberships")
        .select(
          `
          role,
          is_active,
          created_at,
          property:properties(id, name),
          user:users(id, full_name, email, user_photo_url, phone, is_approved, approval_status, approved_by, approved_at, rejection_reason, deleted_at)
          `
        )
        .eq("property_id", propertyId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const visible = ((data ?? []) as any[]).filter((item: any) => {
        if (!item.user || item.user.deleted_at) return false;
        if (item.is_active === true) return true;
        const isPending = (item.user.is_approved === false || item.user.approval_status === "pending") && item.user.approval_status !== "rejected";
        return isPending || item.user.approval_status === "rejected";
      });

      const approverIds = Array.from(new Set(visible.map((m: any) => m.user?.approved_by).filter(Boolean)));
      const approverMap = new Map<string, string>();
      if (approverIds.length > 0) {
        const { data: approvers } = await admin
          .from("users")
          .select("id, full_name")
          .in("id", approverIds);
        (approvers || []).forEach((a: any) => {
          if (a.id && a.full_name) approverMap.set(a.id, a.full_name);
        });
      }

      const users = visible
        .map((item: any) => ({
          id: item.user?.id,
          full_name: item.user?.full_name,
          email: item.user?.email,
          user_photo_url: item.user?.user_photo_url,
          propertyRole: item.role,
          propertyName: item.property?.name,
          propertyId: item.property?.id,
          is_active: item.is_active,
          joined_at: item.created_at,
          phone: item.user?.phone,
          is_approved: item.user?.is_approved ?? (item.is_active ? true : false),
          approval_status: item.user?.approval_status || (item.user?.is_approved === false ? "pending" : "approved"),
          approved_by: item.user?.approved_by || null,
          approved_at: item.user?.approved_at || null,
          rejection_reason: item.user?.rejection_reason || null,
          approverName: item.user?.approved_by ? (approverMap.get(item.user.approved_by) || "Administrator") : null,
        }))
        .filter((user) => !!user.id)
        .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));

      return NextResponse.json({ users });
    }

    if (!(await canManageOrganization(auth.user.id, orgId!))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: orgUsers, error: orgError } = await admin
      .from("organization_memberships")
      .select(
        `
        role,
        is_active,
        created_at,
        user:users(id, full_name, email, user_photo_url, phone)
        `
      )
      .eq("organization_id", orgId!)
      .eq("is_active", true);

    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 500 });
    }

    const { data: propUsers, error: propError } = await admin
      .from("property_memberships")
      .select(
        `
        role,
        is_active,
        created_at,
        property:properties!inner(id, name, organization_id),
        user:users(id, full_name, email, user_photo_url, phone)
        `
      )
      .eq("properties.organization_id", orgId!)
      .eq("is_active", true);

    if (propError) {
      return NextResponse.json({ error: propError.message }, { status: 500 });
    }

    const userMap = new Map<string, any>();

    for (const item of (orgUsers ?? []) as any[]) {
      if (!item.user?.id) continue;
      userMap.set(item.user.id, {
        id: item.user.id,
        full_name: item.user.full_name,
        email: item.user.email,
        user_photo_url: item.user.user_photo_url,
        orgRole: item.role,
        organizationId: orgId,
        is_active: item.is_active,
        joined_at: item.created_at,
        phone: item.user.phone
      });
    }

    for (const item of (propUsers ?? []) as any[]) {
      if (!item.user?.id) continue;
      const existing = userMap.get(item.user.id);
      if (existing) {
        existing.propertyRole = item.role;
        existing.propertyName = item.property?.name;
        existing.propertyId = item.property?.id;
      } else {
        userMap.set(item.user.id, {
          id: item.user.id,
          full_name: item.user.full_name,
          email: item.user.email,
          user_photo_url: item.user.user_photo_url,
          propertyRole: item.role,
          propertyName: item.property?.name,
          propertyId: item.property?.id,
          is_active: item.is_active,
          joined_at: item.created_at,
          phone: item.user.phone
        });
      }
    }

    const users = Array.from(userMap.values()).sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
    return NextResponse.json({ users });
  } catch (error) {
    console.error("[saas-mobile-server] users/list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
