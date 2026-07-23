import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAnonClient } from "@/lib/supabase/client";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user || !auth.token) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (id !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { full_name, phone, user_photo_url, vendor_shop_name } = body;

    const admin = createAdminClient();

    // Update user
    const updateData: Record<string, any> = {};
    if (full_name !== undefined) updateData.full_name = full_name;
    if (phone !== undefined) updateData.phone = phone;
    if (user_photo_url !== undefined) updateData.user_photo_url = user_photo_url;

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await admin
        .from("users")
        .update(updateData)
        .eq("id", id);

      if (updateError) {
        console.error("[users/[id]/settings-update] update error:", updateError);
        return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
      }
    }

    // Update vendor if provided
    if (vendor_shop_name !== undefined) {
      const { error: vendorError } = await admin
        .from("vendors")
        .update({ shop_name: vendor_shop_name })
        .eq("user_id", id);

      if (vendorError) {
        console.error("[users/[id]/settings-update] vendor error:", vendorError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[users/[id]/settings-update] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
