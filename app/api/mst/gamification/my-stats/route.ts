import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const propertyId = request.nextUrl.searchParams.get("property_id") || request.nextUrl.searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "property_id is required" }, { status: 400 });

    const access = await getPropertyAccess(auth.user.id, propertyId);
    if (!access.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const admin = createAdminClient();
    const userId = auth.user.id;
    const today = new Date().toISOString().slice(0, 10);

    const { data: todayRow } = await admin
      .from("mst_daily_scores")
      .select("total_points, tickets_resolved, sla_met_count, first_time_fixes, avg_resolution_minutes, streak_days")
      .eq("property_id", propertyId)
      .eq("user_id", userId)
      .eq("score_date", today)
      .maybeSingle();

    const { data: allScores } = await admin
      .from("mst_daily_scores")
      .select("total_points, tickets_resolved, sla_met_count")
      .eq("property_id", propertyId)
      .eq("user_id", userId);

    const allTime = (allScores || []).reduce(
      (acc, row) => ({
        total_points: acc.total_points + (row.total_points || 0),
        tickets_resolved: acc.tickets_resolved + (row.tickets_resolved || 0),
        sla_met_count: acc.sla_met_count + (row.sla_met_count || 0),
      }),
      { total_points: 0, tickets_resolved: 0, sla_met_count: 0 }
    );

    const { data: streakRow } = await admin
      .from("mst_streaks")
      .select("current_streak, longest_streak")
      .eq("property_id", propertyId)
      .eq("user_id", userId)
      .maybeSingle();

    const { data: todayScores } = await admin
      .from("mst_daily_scores")
      .select("user_id, total_points")
      .eq("property_id", propertyId)
      .eq("score_date", today);

    let rank: number | null = null;
    let totalInRank = 0;
    if (todayScores && todayScores.length > 0) {
      totalInRank = todayScores.length;
      const myPoints = todayRow?.total_points || 0;
      const ahead = todayScores.filter((r) => (r.total_points || 0) > myPoints).length;
      rank = ahead + 1;
    }

    const { data: badges } = await admin
      .from("mst_user_badges")
      .select("earned_at, achievement:mst_achievements(id, code, name, description, icon, color, tier, points_bonus)")
      .eq("user_id", userId)
      .order("earned_at", { ascending: false });

    const earnedIds = new Set((badges || []).map((b: any) => b.achievement?.id).filter(Boolean));

    const { data: achievements } = await admin
      .from("mst_achievements")
      .select("id, code, name, description, icon, color, tier, criteria, points_bonus")
      .eq("is_active", true);

    const nextAchievements = (achievements || [])
      .filter((a: any) => !earnedIds.has(a.id))
      .slice(0, 3)
      .map((a: any) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        description: a.description,
        icon: a.icon,
        color: a.color,
        tier: a.tier,
        criteria: a.criteria as Record<string, unknown>,
        points_bonus: a.points_bonus || 0,
      }));

    return NextResponse.json({
      property_id: propertyId,
      user_id: userId,
      today: {
        total_points: todayRow?.total_points || 0,
        tickets_resolved: todayRow?.tickets_resolved || 0,
        sla_met_count: todayRow?.sla_met_count || 0,
        first_time_fixes: todayRow?.first_time_fixes || 0,
        avg_resolution_minutes: todayRow?.avg_resolution_minutes ?? null,
        rank,
        total_in_rank: totalInRank,
      },
      all_time: allTime,
      streak: {
        current: streakRow?.current_streak || 0,
        longest: streakRow?.longest_streak || 0,
      },
      badges: (badges ?? []).map((entry: any) => ({
        code: entry.achievement?.code || "",
        name: entry.achievement?.name || "",
        description: entry.achievement?.description || "",
        icon: entry.achievement?.icon || "award",
        color: entry.achievement?.color || "#F59E0B",
        tier: entry.achievement?.tier || "bronze",
        points_bonus: entry.achievement?.points_bonus || 0,
        earned_at: entry.earned_at,
      })),
      next_achievements: nextAchievements,
    });
  } catch (error) {
    console.error("[saas-mobile-server] gamification my-stats error:", error);
    return NextResponse.json({
      property_id: "",
      user_id: "",
      today: { total_points: 0, tickets_resolved: 0, sla_met_count: 0, first_time_fixes: 0, avg_resolution_minutes: null, rank: null, total_in_rank: 0 },
      all_time: { total_points: 0, tickets_resolved: 0, sla_met_count: 0 },
      streak: { current: 0, longest: 0 },
      badges: [],
      next_achievements: []
    });
  }
}
