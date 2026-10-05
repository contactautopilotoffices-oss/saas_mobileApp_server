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

    // Fetch property memberships including users awaiting approval
    const { data: members, error } = await admin
      .from("property_memberships")
      .select(`
        role,
        is_active,
        created_at,
        user:users(
          id,
          full_name,
          email,
          phone,
          user_photo_url,
          is_approved,
          approval_status,
          approved_by,
          approved_at,
          rejection_reason,
          deleted_at
        )
      `)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[properties/[id]/users] error:", error);
      return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    }

    // Filter out soft-deleted users while retaining genuinely pending onboarding applicants
    const visibleMembers = (members ?? []).filter((m: any) => {
      if (!m.user || m.user.deleted_at) return false;
      if (m.is_active === true) return true;
      const isPending = (m.user.is_approved === false || m.user.approval_status === "pending") && m.user.approval_status !== "rejected";
      const isRejected = m.user.approval_status === "rejected";
      return isPending || isRejected;
    });

    // Resolve approver names if any approved_by exists
    const approverIds = Array.from(new Set(visibleMembers.map((m: any) => m.user?.approved_by).filter(Boolean)));
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

    // Transform to flat structure with approval fields
    const users = visibleMembers.map((m: any) => {
      const isAppr = m.user?.is_approved ?? (m.is_active ? true : false);
      const appStatus = m.user?.approval_status || (isAppr ? "approved" : "pending");

      return {
        role: m.role,
        is_active: m.is_active,
        created_at: m.created_at,
        user_id: m.user?.id,
        full_name: m.user?.full_name || "Unknown",
        email: m.user?.email || "",
        phone: m.user?.phone,
        user_photo_url: m.user?.user_photo_url,
        is_approved: isAppr,
        approval_status: appStatus,
        approved_by: m.user?.approved_by || null,
        approved_at: m.user?.approved_at || null,
        rejection_reason: m.user?.rejection_reason || null,
        approverName: m.user?.approved_by ? (approverMap.get(m.user.approved_by) || "Administrator") : null,
      };
    });

    return NextResponse.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error("[properties/[id]/users] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
