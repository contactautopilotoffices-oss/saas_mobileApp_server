import { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

interface TicketLike {
  id: string;
  property_id: string;
  assigned_to: string | null;
  raised_by: string | null;
  status: string;
  created_at?: string | null;
  sla_breached?: boolean | null;
  sla_deadline?: string | null;
  resolved_at?: string | null;
}

interface ScoreOptions {
  slaMet?: boolean;
  firstTimeFix?: boolean;
  approvedByTenant?: boolean;
}

const BASE_RESOLVE_POINTS = 50;
const SLA_MET_POINTS = 20;
const FIRST_TIME_FIX_POINTS = 30;
const TENANT_APPROVAL_POINTS = 50;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

async function hasExistingTransaction(
  admin: AdminClient,
  ticketId: string,
  userId: string,
  eventType: string
) {
  const { data } = await admin
    .from('mst_point_transactions')
    .select('id')
    .eq('source_ticket_id', ticketId)
    .eq('user_id', userId)
    .eq('event_type', eventType)
    .maybeSingle();
  return !!data;
}

async function isFirstTimeResolution(admin: AdminClient, ticketId: string) {
  const { data } = await admin
    .from('mst_point_transactions')
    .select('id')
    .eq('source_ticket_id', ticketId)
    .eq('event_type', 'ticket_resolved')
    .maybeSingle();
  return !data;
}

function resolutionMinutes(ticket: TicketLike): number | null {
  if (!ticket.resolved_at) return null;
  const created = ticket.created_at ? new Date(ticket.created_at).getTime() : new Date(ticket.resolved_at).getTime();
  const resolved = new Date(ticket.resolved_at).getTime();
  return Math.max(0, Math.round((resolved - created) / 60000));
}

async function upsertDailyScore(
  admin: AdminClient,
  ticket: TicketLike,
  resolverId: string,
  options: ScoreOptions,
  points: number
) {
  const date = todayStr();
  const now = nowIso();

  const { data: existing } = await admin
    .from('mst_daily_scores')
    .select('*')
    .eq('property_id', ticket.property_id)
    .eq('user_id', resolverId)
    .eq('score_date', date)
    .maybeSingle();

  const resMinutes = resolutionMinutes(ticket);

  if (existing) {
    const currentResolved = existing.tickets_resolved || 0;
    const currentPoints = existing.total_points || 0;
    const currentSlaMet = existing.sla_met_count || 0;
    const currentSlaBreached = existing.sla_breached_count || 0;
    const currentFirstTime = existing.first_time_fixes || 0;

    const resolvedIncrement = options.approvedByTenant ? 0 : 1;
    const newResolved = currentResolved + resolvedIncrement;

    let newAvgMinutes = existing.avg_resolution_minutes ?? null;
    if (resMinutes !== null && resolvedIncrement > 0) {
      const currentAvg = existing.avg_resolution_minutes ?? 0;
      newAvgMinutes = Math.round((currentAvg * currentResolved + resMinutes) / newResolved);
    }

    const updates: any = {
      tickets_resolved: newResolved,
      total_points: currentPoints + points,
      last_activity_at: now,
      updated_at: now,
    };

    if (!options.approvedByTenant) {
      if (options.slaMet) updates.sla_met_count = currentSlaMet + 1;
      else updates.sla_breached_count = currentSlaBreached + 1;
      if (options.firstTimeFix) updates.first_time_fixes = currentFirstTime + 1;
    }

    if (newAvgMinutes !== null) updates.avg_resolution_minutes = newAvgMinutes;

    await admin
      .from('mst_daily_scores')
      .update(updates)
      .eq('property_id', ticket.property_id)
      .eq('user_id', resolverId)
      .eq('score_date', date);
  } else {
    const insert: any = {
      property_id: ticket.property_id,
      user_id: resolverId,
      score_date: date,
      tickets_resolved: options.approvedByTenant ? 0 : 1,
      total_points: points,
      sla_met_count: !options.approvedByTenant && options.slaMet ? 1 : 0,
      sla_breached_count: !options.approvedByTenant && !options.slaMet ? 1 : 0,
      first_time_fixes: !options.approvedByTenant && options.firstTimeFix ? 1 : 0,
      avg_resolution_minutes: resMinutes,
      streak_days: 0,
      last_activity_at: now,
      updated_at: now,
    };

    await admin.from('mst_daily_scores').insert(insert);
  }
}

async function updateStreak(admin: AdminClient, userId: string, propertyId: string) {
  const today = todayStr();
  const now = nowIso();

  const { data: existing } = await admin
    .from('mst_streaks')
    .select('*')
    .eq('property_id', propertyId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) {
    await admin.from('mst_streaks').insert({
      property_id: propertyId,
      user_id: userId,
      current_streak: 1,
      longest_streak: 1,
      last_active_date: today,
      updated_at: now,
    });
    return;
  }

  const last = existing.last_active_date;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  let current = existing.current_streak || 0;

  if (last === today) {
    return;
  } else if (last === yesterdayStr) {
    current += 1;
  } else {
    current = 1;
  }

  const longest = Math.max(existing.longest_streak || 0, current);

  await admin
    .from('mst_streaks')
    .update({
      current_streak: current,
      longest_streak: longest,
      last_active_date: today,
      updated_at: now,
    })
    .eq('property_id', propertyId)
    .eq('user_id', userId);
}

async function checkAchievements(admin: AdminClient, userId: string, propertyId: string) {
  const { data: achievements } = await admin
    .from('mst_achievements')
    .select('*')
    .eq('is_active', true);

  if (!achievements || achievements.length === 0) return;

  const { data: earned } = await admin
    .from('mst_user_badges')
    .select('achievement_id')
    .eq('user_id', userId);

  const earnedIds = new Set((earned || []).map((e: any) => e.achievement_id));

  const { data: allScores } = await admin
    .from('mst_daily_scores')
    .select('total_points, tickets_resolved')
    .eq('property_id', propertyId)
    .eq('user_id', userId);

  const { data: streakRow } = await admin
    .from('mst_streaks')
    .select('current_streak, longest_streak')
    .eq('property_id', propertyId)
    .eq('user_id', userId)
    .maybeSingle();

  const totalPoints = (allScores || []).reduce((sum, s: any) => sum + (s.total_points || 0), 0);
  const totalResolved = (allScores || []).reduce((sum, s: any) => sum + (s.tickets_resolved || 0), 0);
  const longestStreak = streakRow?.longest_streak || 0;

  const newBadges: any[] = [];
  const now = nowIso();

  for (const ach of achievements) {
    if (earnedIds.has(ach.id)) continue;

    const criteria = (ach.criteria || {}) as any;
    let unlocked = false;

    if (criteria.type === 'tickets_resolved' && typeof criteria.value === 'number') {
      unlocked = totalResolved >= criteria.value;
    } else if (criteria.type === 'total_points' && typeof criteria.value === 'number') {
      unlocked = totalPoints >= criteria.value;
    } else if (criteria.type === 'streak_days' && typeof criteria.value === 'number') {
      unlocked = longestStreak >= criteria.value;
    }

    if (unlocked) {
      newBadges.push({
        user_id: userId,
        achievement_id: ach.id,
        earned_at: now,
      });
    }
  }

  if (newBadges.length > 0) {
    await admin.from('mst_user_badges').insert(newBadges);
  }
}

export async function recordTicketResolution(
  admin: AdminClient,
  ticket: TicketLike,
  resolverUserId: string,
  options: ScoreOptions = {}
) {
  if (!resolverUserId || !ticket.property_id) return;

  const eventType = options.approvedByTenant ? 'ticket_approved' : 'ticket_resolved';

  if (await hasExistingTransaction(admin, ticket.id, resolverUserId, eventType)) {
    return;
  }

  let points = 0;
  if (options.approvedByTenant) {
    points = TENANT_APPROVAL_POINTS;
  } else {
    const isFirstTime = options.firstTimeFix ?? (await isFirstTimeResolution(admin, ticket.id));
    points = BASE_RESOLVE_POINTS;
    if (options.slaMet) points += SLA_MET_POINTS;
    if (isFirstTime) points += FIRST_TIME_FIX_POINTS;
    options.firstTimeFix = isFirstTime;
  }

  await admin.from('mst_point_transactions').insert({
    user_id: resolverUserId,
    property_id: ticket.property_id,
    source_ticket_id: ticket.id,
    event_type: eventType,
    points,
    metadata: {
      ticket_status: ticket.status,
      sla_met: options.slaMet ?? null,
      first_time_fix: options.firstTimeFix ?? null,
      approved_by_tenant: options.approvedByTenant ?? false,
    },
  });

  await upsertDailyScore(admin, ticket, resolverUserId, options, points);
  await updateStreak(admin, resolverUserId, ticket.property_id);
  await checkAchievements(admin, resolverUserId, ticket.property_id);
}
