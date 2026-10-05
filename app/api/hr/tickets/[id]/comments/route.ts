import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const admin = createAdminClient();

    const { data: comments, error } = await admin
      .from("hr_ticket_comments")
      .select(`
        *,
        author:users!author_user_id(id, email, full_name)
      `)
      .eq("ticket_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: comments || [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { comment, is_internal = false, attachment_urls = [] } = body;

    if (!comment || typeof comment !== "string" || !comment.trim()) {
      return NextResponse.json({ success: false, error: "Comment text is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: newComment, error } = await admin
      .from("hr_ticket_comments")
      .insert({
        ticket_id: id,
        author_user_id: auth.user.id,
        comment: comment.trim(),
        is_internal: Boolean(is_internal),
        attachment_urls
      })
      .select(`
        *,
        author:users!author_user_id(id, email, full_name)
      `)
      .single();

    if (error || !newComment) {
      return NextResponse.json({ success: false, error: error?.message || "Failed to post comment" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: newComment }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
