import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { bucket, path, fileBase64, contentType } = body;

    if (!bucket || !path || !fileBase64) {
      return NextResponse.json({ error: "Missing required fields: bucket, path, or fileBase64" }, { status: 400 });
    }

    const admin = createAdminClient();
    const buffer = Buffer.from(fileBase64, 'base64');

    const { error: uploadError } = await admin.storage
      .from(bucket)
      .upload(path, buffer, {
        upsert: true,
        contentType: contentType || "application/octet-stream",
      });

    if (uploadError) {
      console.error("[storage/upload] error:", uploadError);
      return NextResponse.json({ error: "Upload failed: " + uploadError.message }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        path: path,
      }
    });
  } catch (error) {
    console.error("[storage/upload] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
