import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId") || searchParams.get("property_id");
    const skillGroup = searchParams.get("skillGroup");
    const status = searchParams.get("status");

    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    let query = admin
      .from("tickets")
      .select(`
        id,
        ticket_number,
        title,
        description,
        status,
        priority,
        internal,
        created_at,
        resolved_at,
        property_id,
        photo_before_url,
        photo_after_url,
        resolution_notes,
        location,
        raised_by,
        assigned_to,
        skill_group:skill_groups(id, code, name),
        creator:users!raised_by(id, full_name, email, user_photo_url),
        assignee:users!assigned_to(id, full_name, email, user_photo_url)
      `)
      .eq("property_id", propertyId)
      .eq("internal", true)
      .order("created_at", { ascending: false });

    if (status && status !== "all") {
      if (status === "resolved") {
        query = query.in("status", ["resolved", "closed"]);
      } else {
        query = query.eq("status", status);
      }
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter by skill group in-memory or by relationship code if specified
    let snags = data || [];
    if (skillGroup && skillGroup !== "all") {
      snags = snags.filter((s: any) => {
        const groupCode = s.skill_group?.code?.toLowerCase() || "";
        const groupName = s.skill_group?.name?.toLowerCase() || "";
        return groupCode.includes(skillGroup.toLowerCase()) || groupName.includes(skillGroup.toLowerCase());
      });
    }

    return NextResponse.json({ snags });
  } catch (error: any) {
    console.error("[snags] GET error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      propertyId,
      title,
      description,
      priority = "medium",
      skillGroupId,
      location,
      photoBeforeUrl,
      assignedTo,
    } = body;

    if (!propertyId || !title) {
      return NextResponse.json({ error: "propertyId and title are required" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Generate reference number
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const ticketNumber = `SNG-${datePrefix}-${randomSuffix}`;

    const insertPayload: any = {
      property_id: propertyId,
      ticket_number: ticketNumber,
      title,
      description: description || title,
      priority,
      status: "open",
      internal: true,
      raised_by: auth.user.id,
      location: location || null,
      photo_before_url: photoBeforeUrl || null,
      assigned_to: assignedTo || null,
      created_at: new Date().toISOString(),
    };

    if (skillGroupId) {
      insertPayload.skill_group_id = skillGroupId;
    }

    const { data, error } = await admin
      .from("tickets")
      .insert(insertPayload)
      .select(`
        id,
        ticket_number,
        title,
        description,
        status,
        priority,
        internal,
        created_at,
        property_id,
        location,
        photo_before_url,
        skill_group:skill_groups(id, code, name),
        creator:users!raised_by(id, full_name, email)
      `)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, snag: data }, { status: 201 });
  } catch (error: any) {
    console.error("[snags] POST error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
