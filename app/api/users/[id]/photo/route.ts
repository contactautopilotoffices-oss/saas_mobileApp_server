import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAnonClient } from "@/lib/supabase/client";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user || !auth.token) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (id !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${id}/${Date.now()}.${ext}`;
    const filePath = `${filename}`;

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage
    const supabase = createAdminClient();
    const { error: uploadError } = await supabase.storage
      .from("user-photos")
      .upload(filePath, buffer, {
        upsert: true,
        contentType: file.type || `image/${ext}`,
      });

    if (uploadError) {
      console.error("[users/[id]/photo] upload error:", uploadError);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from("user-photos").getPublicUrl(filePath);
    const publicUrl = urlData.publicUrl;

    // Update user profile with photo URL
    const { data: updatedUsers, error: updateError } = await supabase
      .from("users")
      .update({ user_photo_url: publicUrl })
      .eq("id", id)
      .select("id");

    if (updateError) {
      console.error("[users/[id]/photo] update error:", updateError);
      return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }

    if (!updatedUsers || updatedUsers.length === 0) {
      // User doesn't exist in public.users yet, create them
      const { error: insertError } = await supabase.from("users").insert({
        id,
        email: auth.user.email || "",
        full_name: auth.user.email?.split("@")[0] || "User",
        user_photo_url: publicUrl,
      });
      if (insertError) {
        console.error("[users/[id]/photo] insert error:", insertError);
        return NextResponse.json({ error: "Failed to create profile" }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      data: { url: publicUrl }
    });
  } catch (error: any) {
    console.error("[users/[id]/photo] error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
