import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ importId: string }> }) {
  try {
    const { importId } = await params;
    const auth = await getAuthenticatedUser(_request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: importRecord, error: importError } = await admin.from("snag_imports").select("*").eq("id", importId).maybeSingle();
    if (importError || !importRecord) {
      return NextResponse.json({ error: "Import not found" }, { status: 404 });
    }

    const access = await getPropertyAccess(auth.user.id, importRecord.property_id);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: property } = await admin
      .from("properties")
      .select("id, name, code, address")
      .eq("id", importRecord.property_id)
      .maybeSingle();

    const { data: tickets, error: ticketsError } = await admin
      .from("tickets")
      .select(
        `
        id,
        title,
        description,
        category,
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
        raiser:raised_by(id, full_name, email),
        assignee:assigned_to(id, full_name, email)
        `
      )
      .eq("import_batch_id", importId)
      .order("floor_number", { ascending: true })
      .order("created_at", { ascending: false });

    if (ticketsError) return NextResponse.json({ error: "Failed to fetch tickets" }, { status: 500 });
    const allTickets = tickets ?? [];

    const totalSnags = allTickets.length;
    const closedSnags = allTickets.filter((ticket: any) => ticket.status === "resolved" || ticket.status === "closed").length;
    const openSnags = allTickets.filter((ticket: any) => ["open", "in_progress", "waitlist"].includes(ticket.status)).length;
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

      const category = ticket.category || "other";
      if (!categoryStats[category]) categoryStats[category] = { open: 0, closed: 0 };
      if (ticket.status === "resolved" || ticket.status === "closed") categoryStats[category].closed += 1;
      else categoryStats[category].open += 1;
    }

    const formattedTickets = allTickets.map((ticket: any) => ({
      id: ticket.id,
      ticketNumber: `#${String(ticket.id).slice(0, 8).toUpperCase()}`,
      title: ticket.title,
      description: ticket.description,
      category: ticket.category,
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
      reportedDate: ticket.created_at,
      closedDate: ticket.resolved_at,
      spocName: ticket.raiser?.full_name || "Unknown",
      spocEmail: ticket.raiser?.email || "",
      assigneeName: ticket.assignee?.full_name || "Unassigned",
      beforePhoto: ticket.photo_before_url,
      afterPhoto: ticket.photo_after_url,
      ticketNumberDisplay: ticket.ticket_number || `#${String(ticket.id).slice(0, 8).toUpperCase()}`
    }));

    return NextResponse.json({
      success: true,
      import: {
        id: importRecord.id,
        filename: importRecord.filename,
        createdAt: importRecord.created_at,
        completedAt: importRecord.completed_at,
        totalRows: importRecord.total_rows,
        validRows: importRecord.valid_rows
      },
      property: property || { name: "Unknown Property", code: "N/A" },
      kpis: { totalSnags, closedSnags, openSnags, closureRate },
      charts: {
        floor: { labels: Object.keys(floorCounts), data: Object.values(floorCounts) },
        department: {
          labels: Object.keys(categoryStats).map((category) => category.charAt(0).toUpperCase() + category.slice(1).replace("_", " ")),
          open: Object.values(categoryStats).map((item) => item.open),
          closed: Object.values(categoryStats).map((item) => item.closed)
        }
      },
      floorGroups,
      tickets: formattedTickets
    });
  } catch (error) {
    console.error("[saas-mobile-server] snag-report GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
