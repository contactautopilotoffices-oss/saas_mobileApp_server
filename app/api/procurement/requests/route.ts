import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { canManageOrganization, canManageProperty } from "@/lib/authorization";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const organizationId = searchParams.get("organizationId");
    const propertyId = searchParams.get("propertyId");
    const ticketId = searchParams.get("ticketId");
    const approverId = searchParams.get("approverId");

    const admin = createAdminClient();

    if (propertyId) {
      const access = await getPropertyAccess(auth.user.id, propertyId);
      if (!access.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    } else if (organizationId) {
      if (!(await canManageOrganization(auth.user.id, organizationId))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    let query = admin
      .from("material_requests")
      .select(
        `
        *,
        ticket:tickets!inner(ticket_number, title, floor_number),
        line_items:material_request_items(*),
        requester:users!material_requests_requested_by_fkey(full_name),
        assignee:users!material_requests_assignee_uid_fkey(full_name)
        `
      )
      .order("created_at", { ascending: false });

    if (organizationId) query = query.eq("organization_id", organizationId);
    if (propertyId) query = query.eq("property_id", propertyId);
    if (ticketId) query = query.eq("ticket_id", ticketId);
    if (approverId) query = query.eq("target_approver_id", approverId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const formatted = (data ?? []).map((request: any) => ({
      ...request,
      items: [...(Array.isArray(request.items) ? request.items : []), ...(request.line_items || [])]
    }));

    return NextResponse.json(formatted);
  } catch (error) {
    console.error("[saas-mobile-server] procurement requests GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
