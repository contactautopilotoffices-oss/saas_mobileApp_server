import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Delete an object from Supabase Storage.
 *
 * Counterpart to /api/storage/upload. The mobile client (serverApi.removeFile)
 * issues a DELETE with a JSON body of { bucket, path } and expects the standard
 * { data, error } envelope back.
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const bucket = body?.bucket;
    const path = body?.path;

    if (!bucket || !path) {
      return NextResponse.json(
        { data: null, error: { message: "Missing required fields: bucket or path" } },
        { status: 400 }
      );
    }

    // Accept a single path or an array of paths.
    const paths: string[] = Array.isArray(path) ? path : [path];

    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(bucket).remove(paths);

    if (error) {
      console.error("[storage/remove] error:", error);
      return NextResponse.json(
        { data: null, error: { message: "Remove failed: " + error.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({ data, error: null });
  } catch (error) {
    console.error("[storage/remove] error:", error);
    return NextResponse.json(
      { data: null, error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
