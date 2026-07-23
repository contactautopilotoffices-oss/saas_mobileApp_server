import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

function bucketForType(type: string) {
  return type === "video" ? "sop-videos" : "sop-photos";
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";
    const admin = createAdminClient();
    let file: File | null = null;
    let propertyId = "";
    let completionId = "";
    let itemId = "";
    let type = "photo";

    if (contentType.includes("multipart/form-data")) {
      // FormData upload (from mobile or web)
      const formData = await request.formData();
      file = formData.get("file") as File | null;
      propertyId = String(formData.get("propertyId") || "");
      completionId = String(formData.get("completionId") || "");
      itemId = String(formData.get("itemId") || "");
      type = String(formData.get("type") || "photo");
    } else {
      // JSON upload with base64 (from mobile serverApi.uploadFile)
      const body = await request.json();
      propertyId = body.propertyId || "";
      completionId = body.completionId || "";
      itemId = body.itemId || "";
      type = body.type || "photo";

      if (body.fileBase64) {
        const buffer = Buffer.from(body.fileBase64, "base64");
        const ext = body.fileName
          ? body.fileName.split(".").pop()
          : type === "video"
            ? "mp4"
            : "jpg";
        const blobType = body.contentType || (type === "video" ? "video/mp4" : "image/jpeg");
        const fileName = body.fileName || `${itemId}-${Date.now()}.${ext}`;
        const blob = new Blob([buffer], { type: blobType });
        file = new File([blob], fileName, { type: blobType });
      }
    }

    if (!file || !propertyId || !completionId || !itemId) {
      return NextResponse.json({ error: "Missing required fields: file, propertyId, completionId, itemId" }, { status: 400 });
    }

    // Verify property access
    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const bucket = bucketForType(type);
    const fileExt = file.name.split(".").pop() || (type === "video" ? "mp4" : "jpg");
    const fileName = `sop-${type === "video" ? "videos" : "photos"}/${propertyId}/${completionId}/${itemId}-${Date.now()}.${fileExt}`;

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const { error } = await admin.storage.from(bucket).upload(fileName, buffer, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || (type === "video" ? "video/mp4" : "image/jpeg"),
    });

    if (error) {
      console.error("[checklist/media] upload error:", error);
      return NextResponse.json({ error: "Failed to upload media: " + error.message }, { status: 500 });
    }

    const { data } = admin.storage.from(bucket).getPublicUrl(fileName);
    return NextResponse.json({ success: true, url: data.publicUrl, bucket, filePath: fileName });
  } catch (error) {
    console.error("[saas-mobile-server] checklist media POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const urlParam = request.nextUrl.searchParams.get("url") || "";
    const type = request.nextUrl.searchParams.get("type") || "photo";
    const bucket = bucketForType(type);
    const marker = `/${bucket}/`;
    const index = urlParam.indexOf(marker);
    if (!urlParam || index === -1) {
      return NextResponse.json({ error: "Invalid media URL" }, { status: 400 });
    }
    const filePath = urlParam.slice(index + marker.length);
    const admin = createAdminClient();
    const { error } = await admin.storage.from(bucket).remove([filePath]);
    if (error) return NextResponse.json({ error: "Failed to delete media" }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[saas-mobile-server] checklist media DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

