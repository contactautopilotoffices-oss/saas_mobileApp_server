import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const after = searchParams.get("after"); // For polling new notifications

    const admin = createAdminClient();
    
    let query = admin
      .from("notifications")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (after) {
      query = query.gt("created_at", after);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Enrich with photos
    let enrichedData = data;
    if (data && data.length > 0) {
      const ticketIds = data.map(n => n.ticket_id).filter(Boolean);
      const bookingIds = data.map(n => n.booking_id).filter(Boolean);
      let userPhotoMap: Record<string, string> = {};
      let userIdsToFetch: Set<string> = new Set();

      if (ticketIds.length > 0) {
        const { data: tickets } = await admin.from("tickets").select("id, raised_by, photo_before_url, photo_after_url").in("id", ticketIds);
        if (tickets) {
           tickets.forEach(t => {
             if (t.raised_by) userIdsToFetch.add(t.raised_by);
           });
           userPhotoMap.ticketsData = tickets as any;
        }
      }

      if (bookingIds.length > 0) {
        const { data: bookings } = await admin.from("meeting_room_bookings").select("id, user_id").in("id", bookingIds);
        if (bookings) {
           bookings.forEach(b => {
             if (b.user_id) userIdsToFetch.add(b.user_id);
           });
           userPhotoMap.bookingsData = bookings as any;
        }
      }

      if (userIdsToFetch.size > 0) {
         const { data: users } = await admin.from("users").select("id, user_photo_url").in("id", Array.from(userIdsToFetch));
         users?.forEach(u => { if (u.user_photo_url) userPhotoMap[u.id] = u.user_photo_url; });
      }

      // Map back to entities
      const ticketsData = (userPhotoMap.ticketsData as any) || [];
      ticketsData.forEach((t: any) => {
          if (t.raised_by && userPhotoMap[t.raised_by]) {
             userPhotoMap[`ticket_${t.id}`] = userPhotoMap[t.raised_by];
          }
      });
      const bookingsData = (userPhotoMap.bookingsData as any) || [];
      bookingsData.forEach((b: any) => {
          if (b.user_id && userPhotoMap[b.user_id]) {
             userPhotoMap[`booking_${b.id}`] = userPhotoMap[b.user_id];
          }
      });
      enrichedData = data.map((n: any) => {
         let photo_url = null;
         if (n.entity_type === "ticket" && n.ticket_id) {
            const ticketData = ticketsData.find((t: any) => t.id === n.ticket_id);
            const nType = (n.notification_type || "").toUpperCase();
            if (nType.includes("RESOLVED") || nType.includes("COMPLETED")) {
               photo_url = ticketData?.photo_after_url || null;
            } else if (nType.includes("CREATED") || nType.includes("ASSIGNED") || nType.includes("NEW")) {
               photo_url = ticketData?.photo_before_url || null;
            } else {
               photo_url = null;
            }
         } else {
            photo_url = null;
         }
         return { ...n, photo_url };
      });
    }

    return NextResponse.json({ success: true, data: enrichedData });
  } catch (error) {
    console.error("[saas-mobile-server] GET /api/users/notifications error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action, notificationId } = body;

    const admin = createAdminClient();

    if (action === "mark_read") {
      if (!notificationId) {
        return NextResponse.json({ error: "Missing notificationId" }, { status: 400 });
      }

      // Security: ensure the notification belongs to the user
      const { data: notif, error: fetchErr } = await admin
        .from("notifications")
        .select("user_id")
        .eq("id", notificationId)
        .single();
        
      if (fetchErr || !notif || notif.user_id !== auth.user.id) {
        return NextResponse.json({ error: "Notification not found or unauthorized" }, { status: 404 });
      }

      const { error } = await admin
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });

    } else if (action === "mark_all_read") {
      const { error } = await admin
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", auth.user.id)
        .eq("is_read", false);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });

    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[saas-mobile-server] PATCH /api/users/notifications error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
