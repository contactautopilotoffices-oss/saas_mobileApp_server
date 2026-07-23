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

    const cacheKey = `admin:organizations:${auth.user.id}`;
    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return NextResponse.json({ success: true, data: cachedData, source: "cache" });
    }

    const admin = createAdminClient();

    // Fetch organizations with property counts
    const { data: organizations, error } = await admin
      .from('organizations')
      .select('*, properties(count)')
      .order('created_at', { ascending: false });

    if (error) {
      console.error("[admin/organizations] fetch error:", error);
      return NextResponse.json({ error: "Failed to fetch organizations" }, { status: 500 });
    }

    await setCache(cacheKey, organizations, CACHE_TTL.WARM);

    return NextResponse.json({
      success: true,
      data: organizations,
      total: organizations?.length ?? 0
    });
  } catch (error) {
    console.error("[admin/organizations] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
