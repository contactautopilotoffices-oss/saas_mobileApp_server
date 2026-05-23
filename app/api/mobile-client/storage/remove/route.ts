import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedSupabase } from "@/lib/mobileClient";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorizedSupabase(request);
    if (auth.response || !auth.client) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const bucket = body?.bucket;
    const paths = Array.isArray(body?.paths) ? body.paths : [];

    if (!bucket || !paths.length) {
      return NextResponse.json({ error: "bucket and paths are required" }, { status: 400 });
    }

    const result = await auth.client.storage.from(bucket).remove(paths);

    return NextResponse.json({
      data: result.data ?? null,
      error: result.error
        ? {
            message: result.error.message,
            name: result.error.name,
          }
        : null,
    });
  } catch (error) {
    console.error("[saas-mobile-server] mobile-client/storage/remove error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
