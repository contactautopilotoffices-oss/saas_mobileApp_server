import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

// Bucket name - visitor-photos (with hyphen, matching Supabase bucket)
const BUCKET_NAME = "visitor-photos";

// Max file size: 5MB (Supabase free tier limit)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * POST /api/visitors/photos?propertyId=...
 * Upload visitor photo to Supabase Storage
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const propertyId = request.nextUrl.searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Missing propertyId" }, { status: 400 });
    }

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();

    const body = await request.json();
    const visitorId = body.visitor_id;
    const fileBase64 = body.fileBase64;
    const contentType = body.contentType || 'image/jpeg';

    if (!visitorId) {
      return NextResponse.json({ error: "visitor_id required" }, { status: 400 });
    }
    if (!fileBase64) {
      return NextResponse.json({ error: "No fileBase64 provided" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!allowedTypes.includes(contentType)) {
      return NextResponse.json({ error: "Only image files allowed." }, { status: 400 });
    }

    // Decode base64 to Buffer
    const buffer = Buffer.from(fileBase64, 'base64');

    // Validate file size (max 5MB)
    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Max 5MB allowed.` }, { status: 400 });
    }

    // Generate path: {propertyId}/{visitorId}.{ext}
    const fileExt = contentType.split('/').pop() || "jpg";
    const filePath = `${propertyId}/${visitorId}.${fileExt}`;

    // Upload to Supabase Storage - pass Buffer
    const { data: uploadData, error: uploadError } = await admin.storage
      .from(BUCKET_NAME)
      .upload(filePath, buffer, {
        cacheControl: "3600",
        upsert: true,
        contentType: contentType,
      });

    if (uploadError) {
      console.error("[visitors/photos] Upload error:", uploadError);
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = admin.storage.from(BUCKET_NAME).getPublicUrl(uploadData.path);

    // Update visitor_logs with photo URL
    await admin
      .from("visitor_logs")
      .update({ photo_url: urlData.publicUrl })
      .eq("visitor_id", visitorId)
      .eq("property_id", propertyId);

    return NextResponse.json({
      success: true,
      url: urlData.publicUrl,
      path: uploadData.path,
    });
  } catch (error: any) {
    console.error("[visitors/photos] Photo upload error:", error);
    return NextResponse.json({ error: `Internal error: ${error.message}` }, { status: 500 });
  }
}
