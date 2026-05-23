import { NextRequest, NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/client";

export async function GET(request: NextRequest) {
  try {
    const bucket = request.nextUrl.searchParams.get("bucket");
    const path = request.nextUrl.searchParams.get("path");

    if (!bucket || !path) {
      return NextResponse.json({ error: "bucket and path are required" }, { status: 400 });
    }

    const client = createAnonClient();
    const {
      data: { publicUrl },
    } = client.storage.from(bucket).getPublicUrl(path);

    return NextResponse.redirect(publicUrl, { status: 302 });
  } catch (error) {
    console.error("[saas-mobile-server] mobile-client/storage/public-url error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
