import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getCache, setCache, CACHE_TTL } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const cacheKey = `admin:users:${auth.user.id}`;
    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return NextResponse.json({ success: true, data: cachedData, source: "cache" });
    }

    const admin = createAdminClient();

    // Fetch users
    const { data: users, error } = await admin
      .from('users')
      .select('id, full_name, email, phone, created_at, is_master_admin')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error("[admin/users] fetch error:", error);
      return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    }

    await setCache(cacheKey, users, CACHE_TTL.WARM);

    return NextResponse.json({
      success: true,
      data: users,
      total: users?.length ?? 0
    });
  } catch (error) {
    console.error("[admin/users] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
