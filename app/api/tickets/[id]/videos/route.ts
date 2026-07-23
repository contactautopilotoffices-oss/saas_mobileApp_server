import { NextRequest, NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

const BUCKET_NAME = "ticket_videos";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const admin = createAdminClient();

    const { data: ticket, error: ticketError } = await admin
      .from("tickets")
      .select("id, property_id, video_before_url, video_after_url")
      .eq("id", id)
      .maybeSingle();

    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const access = await getPropertyAccess(auth.user.id, ticket.property_id);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      before: ticket.video_before_url ?? null,
      after: ticket.video_after_url ?? null
    });
  } catch (error) {
    console.error("[saas-mobile-server] ticket videos GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user || !auth.token) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const videoType = String(formData.get("type") || "");
    const takenAt = String(formData.get("takenAt") || "");

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (!["before", "after"].includes(videoType)) {
      return NextResponse.json({ error: 'Invalid video type. Use "before" or "after"' }, { status: 400 });
    }
    if (!file.type.startsWith("video/")) return NextResponse.json({ error: "File must be a video" }, { status: 400 });
    if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: "Video must be under 50MB" }, { status: 400 });

    const admin = createAdminClient();
    const { data: ticket } = await admin
      .from("tickets")
      .select("id, property_id, raised_by, assigned_to")
      .eq("id", id)
      .maybeSingle();

    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    if (ticket.raised_by !== auth.user.id && ticket.assigned_to !== auth.user.id) {
      return NextResponse.json({ error: "Not authorized to upload videos for this ticket" }, { status: 403 });
    }

    const fileExt = file.name.split(".").pop() || "mp4";
    const fileName = `${id}/${videoType}_${Date.now()}.${fileExt}`;
    const supabase = createAnonClient(auth.token);

    const { error: uploadError } = await supabase.storage.from(BUCKET_NAME).upload(fileName, file, {
      cacheControl: "3600",
      upsert: true
    });

    if (uploadError) {
      return NextResponse.json({ error: "Failed to upload video" }, { status: 500 });
    }

    const { data: publicData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(fileName);
    const publicUrl = publicData.publicUrl;
    const updateField = videoType === "before" ? "video_before_url" : "video_after_url";

    const { error: updateError } = await admin
      .from("tickets")
      .update({ [updateField]: publicUrl, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to save video URL" }, { status: 500 });
    }

    await admin.from("ticket_activity_log").insert({
      ticket_id: id,
      user_id: auth.user.id,
      action: `video_${videoType}_uploaded`,
      new_value: publicUrl,
      old_value: takenAt || new Date().toISOString()
    });

    return NextResponse.json({ success: true, url: publicUrl, type: videoType });
  } catch (error) {
    console.error("[saas-mobile-server] ticket videos POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user || !auth.token) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const videoType = searchParams.get("type");

    if (!videoType || !["before", "after"].includes(videoType)) {
      return NextResponse.json({ error: 'Invalid video type. Use ?type=before or ?type=after' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: ticket } = await admin
      .from("tickets")
      .select("id, property_id, raised_by, assigned_to, video_before_url, video_after_url")
      .eq("id", id)
      .maybeSingle();

    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    if (ticket.raised_by !== auth.user.id && ticket.assigned_to !== auth.user.id) {
      return NextResponse.json({ error: "Not authorized to delete videos for this ticket" }, { status: 403 });
    }

    const urlField = videoType === "before" ? "video_before_url" : "video_after_url";
    const existingUrl = ticket[urlField] as string | null;

    if (existingUrl) {
      const marker = `/${BUCKET_NAME}/`;
      const pathStart = existingUrl.indexOf(marker);
      if (pathStart !== -1) {
        const storagePath = existingUrl.slice(pathStart + marker.length);
        const supabase = createAnonClient(auth.token);
        await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
      }
    }

    const { error: updateError } = await admin
      .from("tickets")
      .update({ [urlField]: null, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to clear video URL" }, { status: 500 });
    }

    await admin.from("ticket_activity_log").insert({
      ticket_id: id,
      user_id: auth.user.id,
      action: `video_${videoType}_deleted`,
      old_value: existingUrl
    });

    return NextResponse.json({ success: true, type: videoType });
  } catch (error) {
    console.error("[saas-mobile-server] ticket videos DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
