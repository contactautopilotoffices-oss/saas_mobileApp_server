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
    const date = searchParams.get("date"); // YYYY-MM-DD or defaults to today
    const month = searchParams.get("month"); // YYYY-MM

    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    // 1. Fetch staff members
    const { data: staffData, error: staffErr } = await admin
      .from("property_memberships")
      .select(`
        id,
        user_id,
        role,
        custom_designation,
        is_active,
        user:users!user_id(id, full_name, email, user_photo_url)
      `)
      .eq("property_id", propertyId)
      .eq("is_active", true)
      .not("role", "in", '("vendor","tenant","super_tenant")');

    if (staffErr) {
      return NextResponse.json({ error: staffErr.message }, { status: 500 });
    }

    // 2. Fetch rosters
    let rosterQuery = admin
      .from("staff_rosters")
      .select(`
        id,
        user_id,
        roster_date,
        shift_id,
        is_reliever,
        notes,
        created_at
      `)
      .eq("property_id", propertyId);

    if (date) {
      rosterQuery = rosterQuery.eq("roster_date", date);
    } else if (month) {
      const startOfMonth = `${month}-01`;
      const endOfMonth = `${month}-31`;
      rosterQuery = rosterQuery.gte("roster_date", startOfMonth).lte("roster_date", endOfMonth);
    } else {
      // Default: current week window (-2 days to +5 days)
      const now = new Date();
      const past = new Date(now);
      past.setDate(now.getDate() - 3);
      const future = new Date(now);
      future.setDate(now.getDate() + 7);
      rosterQuery = rosterQuery
        .gte("roster_date", past.toISOString().slice(0, 10))
        .lte("roster_date", future.toISOString().slice(0, 10));
    }

    const { data: rosterData, error: rosterErr } = await rosterQuery;
    if (rosterErr) {
      return NextResponse.json({ error: rosterErr.message }, { status: 500 });
    }

    return NextResponse.json({
      staff: staffData || [],
      rosters: rosterData || [],
    });
  } catch (error: any) {
    console.error("[roster] GET error:", error);
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
    const { propertyId, userId, rosterDate, shiftId, notes } = body;

    if (!propertyId || !userId || !rosterDate || !shiftId) {
      return NextResponse.json(
        { error: "propertyId, userId, rosterDate, and shiftId are required" },
        { status: 400 }
      );
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Check if shift already assigned for user on this date
    const { data: existing } = await admin
      .from("staff_rosters")
      .select("id")
      .eq("property_id", propertyId)
      .eq("user_id", userId)
      .eq("roster_date", rosterDate)
      .maybeSingle();

    let result;
    if (existing) {
      const { data, error } = await admin
        .from("staff_rosters")
        .update({
          shift_id: shiftId,
          notes: notes || null,
          updated_by: auth.user.id,
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await admin
        .from("staff_rosters")
        .insert({
          property_id: propertyId,
          user_id: userId,
          roster_date: rosterDate,
          shift_id: shiftId,
          notes: notes || null,
          updated_by: auth.user.id,
        })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    return NextResponse.json({ success: true, roster: result });
  } catch (error: any) {
    console.error("[roster] POST error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
