import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyMeetingRoomBookedUser, notifyMeetingRoomBookedAdmin } from "@/lib/whatsapp/whatsappService";

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} minute${m !== 1 ? "s" : ""}`;
  if (m === 0) return `${h} hour${h !== 1 ? "s" : ""}`;
  return `${h} hour${h !== 1 ? "s" : ""} ${m} minute${m !== 1 ? "s" : ""}`;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const propertyId = searchParams.get("propertyId");
    const tenantId = searchParams.get("tenantId");
    const status = searchParams.get("status");

    if (!propertyId || propertyId === 'undefined' || propertyId === 'null') {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    let query = admin
      .from("meeting_room_bookings")
      .select("*, meeting_room:meeting_rooms(name, photo_url, location), tenant:users!user_id(full_name, email)")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false });

    if (tenantId) query = query.eq("user_id", tenantId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: "Failed to fetch bookings" }, { status: 500 });
    }

    return NextResponse.json({ bookings: data ?? [] });
  } catch (error) {
    console.error("[saas-mobile-server] meeting-room-bookings GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const meetingRoomId = body.meetingRoomId;
    const propertyId = body.propertyId;
    const date = body.date;
    const startTime = body.startTime;
    const endTime = body.endTime;
    const comment = body.comment || null;

    if (!meetingRoomId || !propertyId || !date || !startTime || !endTime) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const bookingDateTime = new Date(`${date}T${startTime}`);
    if (bookingDateTime < new Date()) {
      return NextResponse.json({ error: "Cannot book for a past date/time" }, { status: 400 });
    }

    const [startHour, startMinute] = startTime.split(":").map(Number);
    const [endHour, endMinute] = endTime.split(":").map(Number);
    const durationHours = (endHour * 60 + endMinute - startHour * 60 - startMinute) / 60;

    if (durationHours <= 0) {
      return NextResponse.json({ error: "Invalid booking duration" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: companyMember } = await admin
      .from("company_members")
      .select("company_id")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    let creditQuery = admin
      .from("meeting_room_credits")
      .select("id, remaining_hours, company_id, user_id")
      .eq("property_id", propertyId);

    creditQuery = companyMember?.company_id ? creditQuery.eq("company_id", companyMember.company_id) : creditQuery.eq("user_id", auth.user.id);

    const { data: credit } = await creditQuery.maybeSingle();
    if (credit) {
      const remaining = Number(credit.remaining_hours ?? 0);
      if (remaining < durationHours) {
        return NextResponse.json(
          {
            error: `Insufficient ${credit.company_id ? "company " : ""}meeting room credits. You need ${formatHours(durationHours)} but only have ${formatHours(remaining)} remaining.`
          },
          { status: 402 }
        );
      }
    }

    const { data: overlaps, error: overlapError } = await admin
      .from("meeting_room_bookings")
      .select("id")
      .eq("meeting_room_id", meetingRoomId)
      .eq("booking_date", date)
      .eq("status", "confirmed")
      .lt("start_time", endTime)
      .gt("end_time", startTime);

    if (overlapError) {
      return NextResponse.json({ error: "Failed to validate availability" }, { status: 500 });
    }

    if (overlaps?.length) {
      return NextResponse.json({ error: "Room is already booked for this time slot" }, { status: 409 });
    }

    const { data: property } = await admin.from("properties").select("organization_id, name").eq("id", propertyId).maybeSingle();
    const { data: room } = await admin.from("meeting_rooms").select("name").eq("id", meetingRoomId).maybeSingle();

    const { data: booking, error: insertError } = await admin
      .from("meeting_room_bookings")
      .insert({
        meeting_room_id: meetingRoomId,
        property_id: propertyId,
        organization_id: property?.organization_id || null,
        user_id: auth.user.id,
        company_id: companyMember?.company_id || null,
        booking_date: date,
        start_time: startTime,
        end_time: endTime,
        comment,
        status: "confirmed"
      })
      .select("*")
      .single();

    if (insertError || !booking) {
      return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
    }

    if (credit) {
      const { data: deductionResult, error: deductionError } = await admin.rpc("deduct_meeting_room_credit", {
        p_credit_id: credit.id,
        p_hours: durationHours,
        p_booking_id: booking.id,
        p_user_id: auth.user.id,
        p_notes: `Booking deduction (${credit.company_id ? "Company" : "Individual"}): ${durationHours}h`
      });

      if (deductionError || !deductionResult) {
        await admin.from("meeting_room_bookings").delete().eq("id", booking.id);
        return NextResponse.json({ error: "Failed to deduct meeting room credits" }, { status: 402 });
      }
    }

    // ── WhatsApp Notifications ──────────────────────────────────────────────────
    try {
      // 1. Notify the user who booked
      await notifyMeetingRoomBookedUser(
        auth.user.id,
        room?.name || "Meeting Room",
        property?.name || "Property",
        date,
        `${startTime} - ${endTime} (${durationHours} hrs)`
      );

      // 2. Notify Property Admins
      const { data: admins } = await admin
        .from("property_memberships")
        .select("user_id")
        .eq("property_id", propertyId)
        .in("role", ["property_admin"]);

      if (admins?.length) {
        // Fetch user's name for the admin notification
        const { data: userProfile } = await admin.from("users").select("full_name").eq("id", auth.user.id).maybeSingle();
        
        for (const adminUser of admins) {
          await notifyMeetingRoomBookedAdmin(
            adminUser.user_id,
            room?.name || "Meeting Room",
            property?.name || "Property",
            date,
            `${startTime} - ${endTime} (${durationHours} hrs)`,
            userProfile?.full_name || "A user"
          );
        }
      }
    } catch (notifErr) {
      console.error("[WhatsApp] Failed to send meeting room notifications:", notifErr);
    }

    return NextResponse.json({ success: true, booking }, { status: 201 });
  } catch (error) {
    console.error("[saas-mobile-server] meeting-room-bookings POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
