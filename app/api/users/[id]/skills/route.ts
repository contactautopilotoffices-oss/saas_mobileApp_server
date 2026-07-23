import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAnonClient } from "@/lib/supabase/client";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user || !auth.token) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: userId } = await context.params;
    if (!userId) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }

    const supabase = createAnonClient(auth.token);

    const { data: skills, error } = await supabase
      .from("mst_skills")
      .select("skill_code")
      .eq("user_id", userId);

    if (error) {
      console.error("[users/[id]/skills] error:", error);
      return NextResponse.json({ error: "Failed to fetch skills" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: skills ?? [] });
  } catch (error) {
    console.error("[users/[id]/skills] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
