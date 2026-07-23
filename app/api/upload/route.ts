import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const bucket = formData.get("bucket") as string || "ticket_photos";
    const path = formData.get("path") as string || `${auth.user.id}/${Date.now()}`;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = file.name.split(".").pop() || "jpg";
    const filePath = `${path}.${ext}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const admin = createAdminClient();

    const { error: uploadError } = await admin.storage
      .from(bucket)
      .upload(filePath, buffer, {
        upsert: true,
        contentType: file.type || `image/${ext}`,
      });

    if (uploadError) {
      console.error("[upload] error:", uploadError);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const { data: urlData } = admin.storage.from(bucket).getPublicUrl(filePath);

    return NextResponse.json({
      success: true,
      data: {
        url: urlData.publicUrl,
        path: filePath,
      }
    });
  } catch (error) {
    console.error("[upload] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
