import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const propertyId = request.nextUrl.searchParams.get("propertyId");
    const month = request.nextUrl.searchParams.get("month");
    const startDateParam = request.nextUrl.searchParams.get("startDate");
    const endDateParam = request.nextUrl.searchParams.get("endDate");

    if (!propertyId || (!month && (!startDateParam || !endDateParam))) {
      return NextResponse.json({ error: "propertyId and either month or startDate+endDate are required" }, { status: 400 });
    }

    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    const { data: property } = await admin.from("properties").select("id, name, code, address").eq("id", propertyId).maybeSingle();
    const { data: feature } = await admin
      .from("property_features")
      .select("is_enabled")
      .eq("property_id", propertyId)
      .eq("feature_key", "ticket_validation")
      .maybeSingle();

    const isValidationEnabled = feature ? feature.is_enabled : true;

    let startDate: string;
    let endDate: string;

    if (startDateParam && endDateParam) {
      startDate = new Date(`${startDateParam}T00:00:00`).toISOString();
      endDate = new Date(`${endDateParam}T23:59:59`).toISOString();
    } else {
      const [year, monthNumber] = month!.split("-").map(Number);
      startDate = new Date(year, monthNumber - 1, 1).toISOString();
      endDate = new Date(year, monthNumber, 1).toISOString();
    }

    const { data: tickets, error: ticketsError } = await admin
      .from("tickets")
      .select(
        `
        id,
        title,
        description,
        category,
        category_id,
        skill_group_code,
        status,
        priority,
        floor_number,
        location,
        created_at,
        resolved_at,
        raised_by,
        assigned_to,
        photo_before_url,
        photo_after_url,
        ticket_number,
        internal,
        issue_category:category_id(id, name, code),
        raiser:raised_by(id, full_name, email),
        assignee:assigned_to(id, full_name, email)
        `
      )
      .eq("property_id", propertyId)
      .gte("created_at", startDate)
      .lt("created_at", endDate)
      .order("floor_number", { ascending: true })
      .order("created_at", { ascending: false });

    if (ticketsError) {
      return NextResponse.json({ error: "Failed to fetch tickets" }, { status: 500 });
    }

    const allTickets = tickets ?? [];
    const totalSnags = allTickets.length;
    const closedSnags = allTickets.filter((ticket: any) => ticket.status === "resolved" || ticket.status === "closed").length;
    const openSnags = allTickets.filter(
      (ticket: any) => ticket.status !== "resolved" && ticket.status !== "closed" && ticket.status !== "pending_validation"
    ).length;
    const pendingValidationCount = allTickets.filter((ticket: any) => ticket.status === "pending_validation").length;
    const closureRate = totalSnags > 0 ? Number(((closedSnags / totalSnags) * 100).toFixed(1)) : 0;

    const floorGroups: Record<string, any[]> = {};
    const floorCounts: Record<string, number> = {};
    const categoryStats: Record<string, { open: number; closed: number }> = {};

    for (const ticket of allTickets as any[]) {
      let floor = "Unspecified";
      if (ticket.floor_number === 0) floor = "ground floor";
      else if (ticket.floor_number === -1) floor = "basement";
      else if (ticket.floor_number !== null && ticket.floor_number !== undefined) floor = `floor ${ticket.floor_number}`;

      if (!floorGroups[floor]) {
        floorGroups[floor] = [];
        floorCounts[floor] = 0;
      }
      floorGroups[floor].push(ticket);
      floorCounts[floor] += 1;

      const categoryName =
        ticket.issue_category?.name ||
        ticket.category ||
        (ticket.skill_group_code ? String(ticket.skill_group_code).replace(/_/g, " ") : null) ||
        "Other";

      if (!categoryStats[categoryName]) {
        categoryStats[categoryName] = { open: 0, closed: 0 };
      }
      if (ticket.status === "resolved" || ticket.status === "closed") {
        categoryStats[categoryName].closed += 1;
      } else {
        categoryStats[categoryName].open += 1;
      }
    }

    const ticketIds = allTickets.map((ticket: any) => ticket.id);
    const { data: activityLogs } = ticketIds.length
      ? await admin
          .from("ticket_activity_log")
          .select("ticket_id, action, new_value, old_value, created_at")
          .in("ticket_id", ticketIds)
          .or(
            "action.eq.photo_before_uploaded,action.eq.video_before_uploaded,action.eq.photo_after_uploaded,action.eq.video_after_uploaded,action.eq.photo_upload,action.eq.video_upload"
          )
      : { data: [] as any[] };

    const formattedTickets = allTickets.map((ticket: any) => {
      const logs = (activityLogs ?? []).filter((entry: any) => entry.ticket_id === ticket.id);
      const beforeLog = logs.find(
        (entry: any) =>
          entry.action === "photo_before_uploaded" ||
          entry.action === "video_before_uploaded" ||
          (entry.action === "photo_upload" && String(entry.new_value || "").includes("before")) ||
          (entry.action === "video_upload" && String(entry.new_value || "").includes("before"))
      );
      const afterLog = logs.find(
        (entry: any) =>
          entry.action === "photo_after_uploaded" ||
          entry.action === "video_after_uploaded" ||
          (entry.action === "photo_upload" && String(entry.new_value || "").includes("after")) ||
          (entry.action === "video_upload" && String(entry.new_value || "").includes("after"))
      );

      const reportedDate = beforeLog?.old_value || beforeLog?.created_at || ticket.created_at;
      const closedDate = afterLog?.old_value || afterLog?.created_at || ticket.resolved_at;

      return {
        id: ticket.id,
        ticketNumber: `#${String(ticket.id).slice(0, 8).toUpperCase()}`,
        title: ticket.title,
        description: ticket.description,
        category:
          ticket.issue_category?.name ||
          ticket.category ||
          (ticket.skill_group_code ? String(ticket.skill_group_code).replace(/_/g, " ") : null) ||
          "Other",
        status: ticket.status,
        priority: ticket.priority,
        floor: ticket.floor_number !== null && ticket.floor_number !== undefined ? String(ticket.floor_number) : null,
        floorLabel:
          ticket.floor_number === 0
            ? "ground floor"
            : ticket.floor_number === -1
              ? "basement"
              : ticket.floor_number !== null && ticket.floor_number !== undefined
                ? `floor ${ticket.floor_number}`
                : "unspecified",
        location: ticket.location,
        reportedDate,
        closedDate,
        spocName: ticket.raiser?.full_name || "Unknown",
        spocEmail: ticket.raiser?.email || "",
        assigneeName: ticket.assignee?.full_name || "Unassigned",
        beforePhoto: ticket.photo_before_url,
        afterPhoto: ticket.photo_after_url,
        ticketNumberDisplay: ticket.ticket_number || `#${String(ticket.id).slice(0, 8).toUpperCase()}`,
        internal: !!ticket.internal
      };
    });

    const displayLabel =
      startDateParam && endDateParam
        ? `${new Date(startDateParam).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} - ${new Date(endDateParam).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric"
          })}`
        : (() => {
            const [year, monthNumber] = month!.split("-").map(Number);
            return new Date(year, monthNumber - 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
          })();

    return NextResponse.json({
      success: true,
      month: {
        value: startDateParam && endDateParam ? `${startDateParam}_${endDateParam}` : month,
        label: displayLabel
      },
      property: property || { name: "Unknown Property", code: "N/A" },
      kpis: {
        totalSnags,
        closedSnags,
        openSnags,
        pendingValidationCount,
        isValidationEnabled,
        closureRate
      },
      charts: {
        floor: { labels: Object.keys(floorCounts), data: Object.values(floorCounts) },
        department: {
          labels: Object.keys(categoryStats).map((category) => category.charAt(0).toUpperCase() + category.slice(1)),
          open: Object.values(categoryStats).map((stat) => stat.open),
          closed: Object.values(categoryStats).map((stat) => stat.closed)
        }
      },
      floorGroups,
      tickets: formattedTickets
    });
  } catch (error) {
    console.error("[saas-mobile-server] requests-report error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
