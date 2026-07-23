import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/tickets/[id]/details
 * Returns comprehensive ticket details including all related data needed for the ticket detail page.
 * This replaces multiple direct Supabase calls from the mobile app.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Missing ticket id" }, { status: 400 });

    const admin = createAdminClient();

    // Fetch ticket with all related data
    const { data: ticket, error: ticketError } = await admin
      .from("tickets")
      .select(`
        *,
        category:issue_categories(id, code, name),
        skill_group:skill_groups(id, code, name),
        assignee:users!assigned_to(id, full_name, user_photo_url, property_memberships(role, property_id)),
        creator:users!raised_by(id, full_name, email, user_photo_url, property_memberships(role, property_id))
      `)
      .eq("id", id)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Verify property access
    const access = await getPropertyAccess(auth.user.id, ticket.property_id);
    if (!access.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Fetch comments
    const { data: comments, error: commentsError } = await admin
      .from("ticket_comments")
      .select("*, user:users(full_name, user_photo_url)")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true });

    if (commentsError) {
      console.error("[tickets/[id]/details] Comments error:", commentsError);
    }

    // Fetch activity log
    const { data: activities, error: activityError } = await admin
      .from("ticket_activity_log")
      .select("*")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true });

    if (activityError) {
      console.error("[tickets/[id]/details] Activity error:", activityError);
    }

    // Fetch escalation logs
    const { data: escalationLogs, error: escalationError } = await admin
      .from("ticket_escalation_logs")
      .select(`*, from_employee:users!from_employee_id(full_name), to_employee:users!to_employee_id(full_name)`)
      .eq("ticket_id", id)
      .order("escalated_at", { ascending: true });

    if (escalationError) {
      console.error("[tickets/[id]/details] Escalation error:", escalationError);
    }

    // Fetch user's role for this property
    let userRole = null;
    const { data: memberData } = await admin
      .from("property_memberships")
      .select("role")
      .eq("user_id", auth.user.id)
      .eq("property_id", ticket.property_id)
      .eq("is_active", true)
      .single();
    userRole = memberData?.role ?? null;

    // Fetch property features
    const { data: features } = await admin
      .from("property_features")
      .select("feature_key, is_enabled")
      .eq("property_id", ticket.property_id);

    const validationEnabled = features?.some(
      (f: any) => f.feature_key === "ticket_validation" && f.is_enabled === true
    ) ?? false;

    // Fetch available MSTs for this property
    const { data: mstData } = await admin
      .from("property_memberships")
      .select("role, user:users(id, full_name)")
      .eq("property_id", ticket.property_id)
      .eq("is_active", true);

    const msts = (mstData ?? [])
      .filter((m: any) => m.role !== "client")
      .map((m: any) => ({
        id: m.user?.id,
        full_name: m.user?.full_name,
      }))
      .filter((u: any) => u.id && u.full_name);

    // Resolve user names from activity entries
    const userIdsToResolve = new Set<string>();
    (activities ?? []).forEach((act: any) => {
      if (act.performed_by && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(act.performed_by)) {
        userIdsToResolve.add(act.performed_by);
      }
      if (act.user_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(act.user_id)) {
        userIdsToResolve.add(act.user_id);
      }
      try {
        const details = act.details ? JSON.parse(act.details) : null;
        if (details?.new_value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(details.new_value)) {
          userIdsToResolve.add(details.new_value);
        }
        if (details?.old_value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(details.old_value)) {
          userIdsToResolve.add(details.old_value);
        }
      } catch {}
    });

    // Add assignee and creator IDs
    if (ticket.assignee?.id) userIdsToResolve.add(ticket.assignee.id);
    if (ticket.creator?.id) userIdsToResolve.add(ticket.creator.id);

    let userNameMap: Record<string, string> = {};
    if (userIdsToResolve.size > 0) {
      const { data: userRows } = await admin
        .from("users")
        .select("id, full_name")
        .in("id", Array.from(userIdsToResolve));

      (userRows ?? []).forEach((u: { id: string; full_name: string }) => {
        userNameMap[u.id] = u.full_name;
      });
    }

    // Populate activity entries with resolved user names
    const populatedActivities = (activities ?? []).map((act: any) => {
      const actorId = act.performed_by || act.user_id;
      if (actorId && userNameMap[actorId]) {
        return { ...act, user: { full_name: userNameMap[actorId] } };
      }
      return act;
    });

    return NextResponse.json({
      success: true,
      ticket,
      comments: comments ?? [],
      activities: populatedActivities,
      escalationLogs: escalationLogs ?? [],
      currentUserRole: userRole,
      validationEnabled,
      availableMSTs: msts,
      userNameMap,
    });
  } catch (error) {
    console.error("[saas-mobile-server] tickets/[id]/details GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
