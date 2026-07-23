import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/users/me/voice-enrollment
 * Returns whether the current user has voice enrollment
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: embedding, error } = await admin
      .from("user_voice_embeddings")
      .select("id")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (error) {
      console.error("[users/me/voice-enrollment] error:", error);
      return NextResponse.json({ error: "Failed to check voice enrollment" }, { status: 500 });
    }

    return NextResponse.json({ success: true, enrolled: !!embedding });
  } catch (error) {
    console.error("[users/me/voice-enrollment] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
