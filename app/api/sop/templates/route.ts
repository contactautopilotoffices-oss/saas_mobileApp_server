import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAnonClient } from "@/lib/supabase/client";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user || !auth.token) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    const supabase = createAnonClient(auth.token);

    let query = supabase
      .from("sop_templates")
      .select("*")
      .order("created_at", { ascending: false });

    if (propertyId) {
      query = query.eq("property_id", propertyId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[sop/templates] error:", error);
      return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    console.error("[sop/templates] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
