import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedSupabase } from "@/lib/mobileClient";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorizedSupabase(request);
    if (auth.response || !auth.client) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const bucket = String(formData.get("bucket") ?? "");
    const path = String(formData.get("path") ?? "");
    const contentType = String(formData.get("contentType") ?? "application/octet-stream");
    const cacheControl = String(formData.get("cacheControl") ?? "");
    const upsert = String(formData.get("upsert") ?? "false") === "true";
    const file = formData.get("file");

    if (!bucket || !path || !(file instanceof File)) {
      return NextResponse.json({ error: "bucket, path, and file are required" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await auth.client.storage.from(bucket).upload(path, arrayBuffer, {
      contentType,
      cacheControl: cacheControl || undefined,
      upsert,
    });

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
    console.error("[saas-mobile-server] mobile-client/storage/upload error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
