import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";
import { getCache, setCache, CACHE_TTL } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    
    if (!propertyId || propertyId === 'undefined' || propertyId === 'null') {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    const userId = auth.user.id;
    const cacheKey = `dashboard:property-admin:${propertyId}:${userId}`;

    // 1. Try to fetch from Redis Cache
    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return NextResponse.json({ success: true, data: cachedData, source: "cache" });
    }

    // 2. Cache miss -> Fetch from Database
    const admin = createAdminClient();
    const isAll = propertyId === 'all';
    
    // Resolve which properties this user has access to if "all"
    let propIds: string[] = [];
    if (isAll) {
      // Find org memberships first
      const { data: orgMems } = await admin
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', userId)
        .or('is_active.eq.true,is_active.is.null')
        .in('role', ['org_super_admin', 'super_tenant', 'master_admin'])
        .limit(1);
        
      const orgMembership = orgMems && orgMems.length > 0 ? orgMems[0] : null;
        
      if (orgMembership?.organization_id) {
        const { data: props } = await admin
          .from('properties')
          .select('id')
          .eq('organization_id', orgMembership.organization_id);
        propIds = (props ?? []).map((p: any) => p.id);
      } else {
        return NextResponse.json({ error: "Unauthorized access to org properties" }, { status: 403 });
      }
    } else {
      const access = await getPropertyAccess(userId, propertyId);
      console.log(`[property-admin] getPropertyAccess userId: ${userId}, propertyId: ${propertyId}, access:`, access);
      if (!access.authorized) {
        return NextResponse.json({ error: "Access Denied to this Property" }, { status: 403 });
      }
      propIds = [propertyId];
    }

    if (propIds.length === 0) {
      return NextResponse.json({ success: true, data: null, source: "db" });
    }

    // 6 AM Operational Shift Boundary: If before 6 AM, logically count it as yesterday
    const shiftNow = new Date();
    if (shiftNow.getHours() < 6) {
      shiftNow.setDate(shiftNow.getDate() - 1);
    }
    const todayStr = shiftNow.toISOString().split("T")[0];

    // Build the bulk parallel queries
    const bulkQueries = Promise.all([
      // Property Name (only if single)
      isAll 
        ? Promise.resolve({ data: { name: 'All Properties Overview', image_url: null } })
        : admin.from('properties').select('name, image_url').eq('id', propertyId).single(),
        
      // Recent Tickets
      admin.from('tickets')
        .select('id, title, status, priority, created_at, is_internal, photo_before_url, sla_hours, raised_by')
        .in('property_id', propIds)
        .order('created_at', { ascending: false })
        .limit(100),
        
      // Active SOP Templates
      admin.from('sop_templates')
        .select('id, title, start_time, end_time')
        .in('property_id', propIds)
        .eq('is_active', true),
        
      // SOP Completions Today
      admin.from('sop_completions')
        .select('template_id, status')
        .in('property_id', propIds)
        .eq('completion_date', todayStr)
        .eq('status', 'completed'),
        
      // Visitor Logs
      admin.from('visitor_logs')
        .select('status, created_at, name, whom_to_meet')
        .in('property_id', propIds)
        .order('created_at', { ascending: false }),
        
      // Vendor Daily Revenue
      admin.from('vendor_daily_revenue')
        .select('revenue_amount, vendor_id, revenue_date, created_at')
        .in('property_id', propIds),
        
      // Total Tickets Count (All)
      admin.from('tickets').select('id', { count: 'exact', head: true }).in('property_id', propIds),
      // Open Tickets Count (All)
      admin.from('tickets').select('id', { count: 'exact', head: true }).in('property_id', propIds).in('status', ['open', 'assigned', 'in_progress', 'client_raised', 'waitlist', 'blocked']),
      // Closed Tickets Count (All)
      admin.from('tickets').select('id', { count: 'exact', head: true }).in('property_id', propIds).in('status', ['completed', 'resolved', 'closed', 'pending_validation']),
      
      // Total Tickets Count (Month)
      admin.from('tickets').select('id', { count: 'exact', head: true }).in('property_id', propIds).gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
      // Open Tickets Count (Month)
      admin.from('tickets').select('id', { count: 'exact', head: true }).in('property_id', propIds).gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()).in('status', ['open', 'assigned', 'in_progress', 'client_raised', 'waitlist', 'blocked']),
      // Closed Tickets Count (Month)
      admin.from('tickets').select('id', { count: 'exact', head: true }).in('property_id', propIds).gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()).in('status', ['completed', 'resolved', 'closed', 'pending_validation']),

      // Total Tickets Count (Today)
      admin.from('tickets').select('id', { count: 'exact', head: true }).in('property_id', propIds).gte('created_at', todayStr),
      // Open Tickets Count (Today)
      admin.from('tickets').select('id', { count: 'exact', head: true }).in('property_id', propIds).gte('created_at', todayStr).in('status', ['open', 'assigned', 'in_progress', 'client_raised', 'waitlist', 'blocked']),
      // Closed Tickets Count (Today)
      admin.from('tickets').select('id', { count: 'exact', head: true }).in('property_id', propIds).gte('created_at', todayStr).in('status', ['completed', 'resolved', 'closed', 'pending_validation']),

      // Tenant Users
      admin.from('property_memberships').select('user_id').in('property_id', propIds).in('role', ['tenant', 'super_tenant']),

      // Tickets — last 14 days (for trend chart + AI insights, independent of the 100-row recent-tickets cap)
      admin.from('tickets')
        .select('created_at, resolved_at, status, priority, sla_breached')
        .in('property_id', propIds)
        .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    // Build the per-property parallel queries
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const perPropQueries = Promise.all(propIds.map(async (pid) => {
      const [elec, elecMonthly, diesel, water, health, attention, funnel, ppm, ppmSchedules] = await Promise.all([
        // Last reading (for trend calculation)
        admin.from('electricity_readings')
          .select('final_units, computed_units, created_at')
          .eq('property_id', pid)
          .order('reading_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        // All readings for electricity (main & dg)
        admin.from('electricity_readings')
          .select('computed_units, final_units, reading_date, electricity_meters!inner(meter_type)')
          .eq('property_id', pid)
          .order('reading_date', { ascending: false }),
        admin.from('diesel_readings')
          .select('closing_diesel_level, computed_consumed_litres, reading_date, generator_id, created_at, generators(name, tank_capacity_litres)')
          .eq('property_id', pid)
          .order('reading_date', { ascending: false }),
        // Water readings
        admin.from('water_readings')
          .select('quantity, computed_cost, reading_date, created_at, source:water_sources!inner(property_id, source_type)')
          .eq('water_sources.property_id', pid)
          .order('reading_date', { ascending: false }),
        admin.rpc('get_property_health_score', { p_property_id: pid }),
        admin.rpc('get_attention_items', { p_property_id: pid, p_limit: 10 }),
        admin.rpc('get_ticket_funnel', { p_property_id: pid, p_days: 30 }),
        admin.rpc("get_ppm_stats", { prop_id: pid }),
        admin.from('ppm_schedules')
          .select('id, system_name, detail_name, planned_date, status, frequency, updated_at')
          .eq('property_id', pid)
          .order('planned_date', { ascending: true })
      ]);
      return { elec, elecMonthly, diesel, water, health, attention, funnel, ppm, ppmSchedules };
    }));

    // Wait for all queries to execute
    const [
      [
        propRes, 
        ticketRes, 
        sopTemplatesRes, 
        sopCompletionsRes, 
        vmsRes, 
        revRes, 
        countTotalAllRes, countOpenAllRes, countClosedAllRes,
        countTotalMonthRes, countOpenMonthRes, countClosedMonthRes,
        countTotalTodayRes, countOpenTodayRes, countClosedTodayRes,
        tenantUsersRes,
        ticketsTrendRes
      ],
      perPropResults
    ] = await Promise.all([bulkQueries, perPropQueries]);

    // --- AGGREGATE RESULTS ---
    
    // VMS Stats
    let vmsStats = {
      today: { total: 0, in: 0, out: 0 },
      month: { total: 0, in: 0, out: 0 },
      all: { total: 0, in: 0, out: 0 }
    };
    if (vmsRes?.data) {
      const mStartStr = monthStart.split('T')[0];
      
      vmsRes.data.forEach((v: any) => {
        const dateStr = v.created_at ? v.created_at.split('T')[0] : '';
        const isToday = dateStr === todayStr;
        const isMonth = dateStr >= mStartStr;
        
        vmsStats.all.total++;
        if (v.status === 'checked_in') vmsStats.all.in++;
        if (v.status === 'checked_out') vmsStats.all.out++;
        
        if (isMonth) {
          vmsStats.month.total++;
          if (v.status === 'checked_in') vmsStats.month.in++;
          if (v.status === 'checked_out') vmsStats.month.out++;
        }
        
        if (isToday) {
          vmsStats.today.total++;
          if (v.status === 'checked_in') vmsStats.today.in++;
          if (v.status === 'checked_out') vmsStats.today.out++;
        }
      });
    }

    // Vendor Stats
    let vendorStats = { 
      today: { revenue: 0, commission: 0 },
      month: { revenue: 0, commission: 0 },
      all: { revenue: 0, commission: 0 }
    };
    if (revRes?.data) {
      const monthStartStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
      revRes.data.forEach((row: any) => {
        const rev = row.revenue_amount || 0;
        const comm = rev * 0.1;
        vendorStats.all.revenue += rev;
        vendorStats.all.commission += comm;
        
        if (row.revenue_date) {
          if (row.revenue_date === todayStr) {
            vendorStats.today.revenue += rev;
            vendorStats.today.commission += comm;
          }
          if (row.revenue_date >= monthStartStr) {
            vendorStats.month.revenue += rev;
            vendorStats.month.commission += comm;
          }
        }
      });
    }

    // Per Property Aggregation
    let totalElec = 0;
    let elecTrendSum = 0;
    let elecTrendCount = 0;
    let monthlyElecSum = 0;
    let totalDieselLevel = 0;
    let totalDieselConsumption = 0;
    let dieselCount = 0;
    let totalWaterQuantity = 0;
    let totalWaterCost = 0;
    let healthSum = 0;
    let attentionArr: any[] = [];
    let funnelCounts: Record<string, number> = {};
    let pTotal = 0, pDone = 0, pPending = 0, pOverdue = 0, pPostponed = 0;

    const energyLast7Days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().split('T')[0];
    });
    let energyHistoryArr = [0, 0, 0, 0, 0, 0, 0];
    let dieselHistoryArr = [0, 0, 0, 0, 0, 0, 0];

    perPropResults.forEach(res => {
      // Last reading (for current/trend)
      if (res.elec.data) {
        const lastReading = res.elec.data as any;
        if (lastReading?.final_units || lastReading?.computed_units) {
          const lastElec = lastReading.computed_units || lastReading.final_units || 0;
          totalElec += lastElec;
        }
      }

      let elecToday = 0, elecMonth = 0, elecAll = 0;
      let dgElecToday = 0, dgElecMonth = 0, dgElecAll = 0;

      // Readings for electricity meters
      if (res.elecMonthly?.data && Array.isArray(res.elecMonthly.data)) {
        const allReadings = res.elecMonthly.data as any[];
        const mStartStr = monthStart.split('T')[0];
        
        allReadings.forEach(r => {
          const units = r.final_units ?? r.computed_units ?? 0;
          const mType = (r.electricity_meters?.meter_type || '').toLowerCase();
          if (mType === 'dg') {
            dgElecAll += units;
            if (r.reading_date >= mStartStr) dgElecMonth += units;
            if (r.reading_date === todayStr) dgElecToday += units;
          } else if (mType === 'main') {
            elecAll += units;
            if (r.reading_date >= mStartStr) elecMonth += units;
            if (r.reading_date === todayStr) elecToday += units;
            
            const idx = energyLast7Days.indexOf(r.reading_date);
            if (idx !== -1) {
              energyHistoryArr[idx] += units;
            }
          }
        });
        
        monthlyElecSum += elecMonth; // keep old behavior
        totalElec += elecAll;
      }
      
      // Store in per-property results so we can aggregate if needed
      (res as any).elecStats = { today: elecToday, month: elecMonth, all: elecAll };
      (res as any).dgElecStats = { today: dgElecToday, month: dgElecMonth, all: dgElecAll };

      let dieselToday = 0, dieselMonth = 0, dieselAll = 0;
      let dieselLevel = 0;
      let dieselCapacity = 0;
      let genMap: Record<string, { id: string, name: string, level: number, capacity: number, levelPct: number, consumption: number }> = {};

      if (res.diesel.data && Array.isArray(res.diesel.data)) {
        const dReadings = res.diesel.data as any[];
        if (dReadings.length > 0) {
          // No need to set dieselLevel here, it's aggregated per generator
        }
        
        const mStartStr = monthStart.split('T')[0];
        dReadings.forEach(r => {
          const c = r.computed_consumed_litres || 0;
          dieselAll += c;
          if (r.reading_date >= mStartStr) dieselMonth += c;
          if (r.reading_date === todayStr) dieselToday += c;

          const idx = energyLast7Days.indexOf(r.reading_date);
          if (idx !== -1) {
            dieselHistoryArr[idx] += c;
          }

          // Accumulate per generator for today/latest
          const gid = r.generator_id;
          if (gid) {
            if (!genMap[gid]) {
              const capacity = r.generators?.tank_capacity_litres || 1000;
              const lvl = r.closing_diesel_level || 0;
              genMap[gid] = {
                id: gid,
                name: r.generators?.name || 'Generator',
                level: lvl, // raw liters
                capacity: capacity,
                levelPct: capacity > 0 ? Math.round((lvl / capacity) * 100) : 0,
                consumption: 0
              };
              dieselLevel += lvl;
              dieselCapacity += capacity;
            }
            if (r.reading_date === todayStr) {
              genMap[gid].consumption += c;
            }
          }
        });
      }
      (res as any).dieselStats = { 
        today: dieselToday, month: dieselMonth, all: dieselAll,
        level: dieselLevel,
        capacity: dieselCapacity,
        generators: Object.values(genMap)
      };

      let waterTodayQty = 0, waterMonthQty = 0, waterAllQty = 0;
      let waterTodayCost = 0, waterMonthCost = 0, waterAllCost = 0;
      let waterSources = { 
        today: {} as Record<string, { count: number, cost: number, qty: number }>, 
        month: {} as Record<string, { count: number, cost: number, qty: number }>, 
        all: {} as Record<string, { count: number, cost: number, qty: number }> 
      };
      
      if (res.water.error) {
        console.error("[SuperAdmin API] Water readings query error:", JSON.stringify(res.water.error));
      }
      
      if (res.water.data && Array.isArray(res.water.data)) {
        const wReadings = res.water.data as any[];
        
        const mStartStr = monthStart.split('T')[0];
        wReadings.forEach(r => {
          const q = r.quantity || 0;
          const c = r.computed_cost || 0;
          const sType = r.source?.source_type || 'Unknown';
          
          waterAllQty += q; waterAllCost += c;
          if (!waterSources.all[sType]) waterSources.all[sType] = { count: 0, cost: 0, qty: 0 };
          waterSources.all[sType].count++; waterSources.all[sType].cost += c; waterSources.all[sType].qty += q;
          
          if (r.reading_date >= mStartStr) { 
            waterMonthQty += q; waterMonthCost += c; 
            if (!waterSources.month[sType]) waterSources.month[sType] = { count: 0, cost: 0, qty: 0 };
            waterSources.month[sType].count++; waterSources.month[sType].cost += c; waterSources.month[sType].qty += q;
          }
          if (r.reading_date === todayStr) { 
            waterTodayQty += q; waterTodayCost += c; 
            if (!waterSources.today[sType]) waterSources.today[sType] = { count: 0, cost: 0, qty: 0 };
            waterSources.today[sType].count++; waterSources.today[sType].cost += c; waterSources.today[sType].qty += q;
          }
        });
      }
      (res as any).waterStats = { 
        qty: { today: waterTodayQty, month: waterMonthQty, all: waterAllQty },
        cost: { today: waterTodayCost, month: waterMonthCost, all: waterAllCost },
        sources: waterSources
      };
      if (res.health.data) healthSum += (res.health.data as number);
      if (res.attention.data) attentionArr.push(...(res.attention.data as any[]));
      
      if (res.funnel.data) {
        (res.funnel.data as any[]).forEach(fItem => {
          funnelCounts[fItem.status_label] = (funnelCounts[fItem.status_label] || 0) + fItem.ticket_count;
        });
      }
      
      if (res.ppm.data) {
        pTotal += res.ppm.data.total ?? 0;
        pDone += res.ppm.data.done ?? 0;
        pPending += res.ppm.data.pending ?? 0;
        pOverdue += res.ppm.data.overdue ?? 0;
        pPostponed += res.ppm.data.postponed ?? 0;
      }
    });

    const ppmSchedulesArr = perPropResults.flatMap(res => res.ppmSchedules?.data ?? []);

    const aggElecStats = perPropResults.reduce((acc, res) => {
      acc.today += (res as any).elecStats?.today || 0;
      acc.month += (res as any).elecStats?.month || 0;
      acc.all += (res as any).elecStats?.all || 0;
      return acc;
    }, { today: 0, month: 0, all: 0 });

    const aggDieselStats = perPropResults.reduce((acc, res) => {
      acc.today += (res as any).dieselStats?.today || 0;
      acc.month += (res as any).dieselStats?.month || 0;
      acc.all += (res as any).dieselStats?.all || 0;
      acc.level += (res as any).dieselStats?.level || 0;
      acc.capacity += (res as any).dieselStats?.capacity || 0;
      
      acc.dg_kwh_today += (res as any).dgElecStats?.today || 0;
      acc.dg_kwh_month += (res as any).dgElecStats?.month || 0;
      acc.dg_kwh_all += (res as any).dgElecStats?.all || 0;
      
      const gens = (res as any).dieselStats?.generators;
      if (gens && Array.isArray(gens)) {
        gens.forEach(g => acc.generators.push(g));
      }

      return acc;
    }, { today: 0, month: 0, all: 0, level: 0, capacity: 0, dg_kwh_today: 0, dg_kwh_month: 0, dg_kwh_all: 0, generators: [] as any[] });

    const aggWaterStats = perPropResults.reduce((acc, res) => {
      acc.qty.today += (res as any).waterStats?.qty?.today || 0;
      acc.qty.month += (res as any).waterStats?.qty?.month || 0;
      acc.qty.all += (res as any).waterStats?.qty?.all || 0;
      acc.cost.today += (res as any).waterStats?.cost?.today || 0;
      acc.cost.month += (res as any).waterStats?.cost?.month || 0;
      acc.cost.all += (res as any).waterStats?.cost?.all || 0;
      
      const wSources = (res as any).waterStats?.sources;
      if (wSources) {
        (['today', 'month', 'all'] as const).forEach(period => {
          Object.keys(wSources[period] || {}).forEach(sType => {
            if (!acc.sources[period][sType]) acc.sources[period][sType] = { count: 0, cost: 0, qty: 0 };
            acc.sources[period][sType].count += wSources[period][sType].count;
            acc.sources[period][sType].cost += wSources[period][sType].cost;
            acc.sources[period][sType].qty += wSources[period][sType].qty;
          });
        });
      }
      return acc;
    }, { 
      qty: { today: 0, month: 0, all: 0 }, 
      cost: { today: 0, month: 0, all: 0 },
      sources: { 
        today: {} as Record<string, { count: number, cost: number, qty: number }>, 
        month: {} as Record<string, { count: number, cost: number, qty: number }>, 
        all: {} as Record<string, { count: number, cost: number, qty: number }> 
      }
    });

    // Derive final fields
    const healthScore = propIds.length > 0 ? Math.round(healthSum / propIds.length) : 100;
    const sortedAttention = attentionArr.sort((a, b) => {
      const score = (sev: string) => sev === 'critical' ? 3 : sev === 'high' ? 2 : 1;
      return score(b.severity) - score(a.severity);
    }).slice(0, 10);
    const ticketFunnel = Object.entries(funnelCounts).map(([status_label, ticket_count]) => ({ status_label, ticket_count }));
    const tenantData = tenantUsersRes?.data || [];
    const tenantUserIds = tenantData.map((t: any) => t.user_id).filter(Boolean);

    // --- TICKET TREND (real dates + counts, last 7 days) & AI INSIGHTS ---
    const OPEN_STATUSES = ['open', 'assigned', 'in_progress', 'client_raised', 'waitlist', 'blocked'];
    const trendTickets = (ticketsTrendRes?.data ?? []) as {
      created_at: string; resolved_at: string | null; status: string; priority: string; sla_breached: boolean | null;
    }[];

    const dayKey = (iso: string) => iso.split('T')[0];
    const now = new Date();
    const last7TicketDays: string[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().split('T')[0];
    });

    const createdByDay: Record<string, number> = {};
    const resolvedByDay: Record<string, number> = {};
    let thisWeekCreated = 0;
    let lastWeekCreated = 0;
    let resolvedCount = 0;
    let resolutionHoursSum = 0;
    let slaBreachCount = 0;
    const openPriorityCounts: Record<string, number> = { urgent: 0, high: 0, medium: 0, low: 0 };

    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    trendTickets.forEach((t) => {
      const createdDate = new Date(t.created_at);
      const createdDay = dayKey(t.created_at);

      if (createdDate >= sevenDaysAgo) thisWeekCreated++;
      else if (createdDate >= fourteenDaysAgo) lastWeekCreated++;

      if (last7TicketDays.includes(createdDay)) {
        createdByDay[createdDay] = (createdByDay[createdDay] || 0) + 1;
      }

      if (t.resolved_at) {
        const resolvedDay = dayKey(t.resolved_at);
        if (last7TicketDays.includes(resolvedDay)) {
          resolvedByDay[resolvedDay] = (resolvedByDay[resolvedDay] || 0) + 1;
        }
        if (new Date(t.resolved_at) >= sevenDaysAgo) {
          resolvedCount++;
          resolutionHoursSum += (new Date(t.resolved_at).getTime() - createdDate.getTime()) / (1000 * 60 * 60);
        }
      }

      if (t.sla_breached && createdDate >= sevenDaysAgo) slaBreachCount++;

      if (OPEN_STATUSES.includes(t.status)) {
        const p = (t.priority || 'medium').toLowerCase();
        if (p === 'critical') openPriorityCounts.urgent++;
        else if (openPriorityCounts[p] !== undefined) openPriorityCounts[p]++;
      }
    });

    const ticketTrend = last7TicketDays.map((dateStr) => {
      const d = new Date(dateStr + 'T00:00:00Z');
      return {
        date: dateStr,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        created: createdByDay[dateStr] || 0,
        resolved: resolvedByDay[dateStr] || 0,
      };
    });

    const busiestDay = ticketTrend.reduce((max, day) => (day.created > max.created ? day : max), ticketTrend[0]);
    const weekOverWeekChangePct = lastWeekCreated > 0
      ? Math.round(((thisWeekCreated - lastWeekCreated) / lastWeekCreated) * 100)
      : (thisWeekCreated > 0 ? 100 : 0);

    const ticketInsights = {
      thisWeekCreated,
      lastWeekCreated,
      weekOverWeekChangePct,
      avgResolutionHours: resolvedCount > 0 ? Math.round((resolutionHoursSum / resolvedCount) * 10) / 10 : null,
      slaBreachCount,
      busiestDay: busiestDay?.created > 0 ? busiestDay.label : null,
      openPriorityCounts,
    };

    const completedTemplateIds = new Set((sopCompletionsRes.data || []).map((c: any) => c.template_id));
    
    let dayTotal = 0;
    let dayCompleted = 0;
    let nightTotal = 0;
    let nightCompleted = 0;
    
    const sopItems = (sopTemplatesRes.data || []).map((t: any) => {
      let isNight = false;
      if (t.start_time) {
        // e.g. "18:00:00" or "22:00:00"
        const sh = parseInt(t.start_time.split(':')[0], 10);
        if (sh >= 18 || (t.end_time && t.start_time > t.end_time)) {
          isNight = true;
        }
      }
      const isCompleted = completedTemplateIds.has(t.id);
      
      if (isNight) {
        nightTotal++;
        if (isCompleted) nightCompleted++;
      } else {
        dayTotal++;
        if (isCompleted) dayCompleted++;
      }
      
      return {
        id: t.id,
        title: t.title,
        completed: isCompleted,
        shift: isNight ? 'night' : 'day'
      };
    });
    
    const sopStats = {
      day: { total: dayTotal, completed: dayCompleted },
      night: { total: nightTotal, completed: nightCompleted }
    };

    const visitorItems = (vmsRes.data || []).slice(0, 50).map((v: any) => ({
      name: v.name,
      purpose: v.whom_to_meet,
      status: v.status,
      time: v.created_at
    }));

    const maxDate = (arr: any[], field: string) => {
      if (!arr || arr.length === 0) return null;
      let max = 0;
      for (const item of arr) {
        if (item[field]) {
          const t = new Date(item[field]).getTime();
          if (t > max && !isNaN(t)) max = t;
        }
      }
      return max > 0 ? max : null;
    };

    const elecReadings = perPropResults.flatMap(res => res.elec?.data || []);
    const dieselReadings = perPropResults.flatMap(res => res.diesel?.data || []);
    const waterReadings = perPropResults.flatMap(res => res.water?.data || []);

    const lastUpdated = {
      tickets: maxDate(ticketRes.data || [], 'created_at'), // using created_at as fallback for tickets
      energy: maxDate(elecReadings, 'created_at'),
      diesel: maxDate(dieselReadings, 'created_at'),
      water: maxDate(waterReadings, 'created_at'),
      vendor: maxDate(revRes.data || [], 'created_at'),
      vms: maxDate(vmsRes.data || [], 'created_at'),
      ppm: maxDate(ppmSchedulesArr, 'updated_at'),
      checklist: maxDate(sopCompletionsRes.data || [], 'completed_at'),
    };

    // --- RETURN PAYLOAD ---
    const dashboardData = {
      lastUpdated,
      propertyId,
      propertyName: propRes?.data?.name ?? "",
      propertyLogoUrl: propRes?.data?.image_url ?? null,
      tickets: ticketRes.data ?? [],
      ticketCounts: {
        all: { total: countTotalAllRes?.count ?? 0, open: countOpenAllRes?.count ?? 0, closed: countClosedAllRes?.count ?? 0 },
        month: { total: countTotalMonthRes?.count ?? 0, open: countOpenMonthRes?.count ?? 0, closed: countClosedMonthRes?.count ?? 0 },
        today: { total: countTotalTodayRes?.count ?? 0, open: countOpenTodayRes?.count ?? 0, closed: countClosedTodayRes?.count ?? 0 },
      },
      ticketTrend,
      ticketInsights,
      sopTotal: dayTotal + nightTotal,
      sopCount: dayCompleted + nightCompleted,
      sopStats,
      sopItems,
      visitorItems,
      energyKwh: Math.round(aggElecStats.month),
      energyStats: {
        today: Math.round(aggElecStats.today),
        month: Math.round(aggElecStats.month),
        all: Math.round(aggElecStats.all)
      },
      energyHistory: energyHistoryArr.map(val => Math.round(val)),
      energyTrend: elecTrendCount > 0 ? Math.round(elecTrendSum / elecTrendCount) : 0,
      healthScore,
      attentionItems: sortedAttention,
      ticketFunnel,
      vmsStats,
      vendorStats,
      dieselStats: {
        level: aggDieselStats.capacity > 0 ? Math.round((aggDieselStats.level / aggDieselStats.capacity) * 100) : 0,
        consumption: {
          today: Math.round(aggDieselStats.today),
          month: Math.round(aggDieselStats.month),
          all: Math.round(aggDieselStats.all),
        },
        dg_kwh: {
          today: Math.round(aggDieselStats.dg_kwh_today),
          month: Math.round(aggDieselStats.dg_kwh_month),
          all: Math.round(aggDieselStats.dg_kwh_all),
        },
        generators: aggDieselStats.generators
      },
      dieselHistory: dieselHistoryArr.map(val => Math.round(val)),
      waterStats: {
        quantity: {
          today: Math.round(aggWaterStats.qty.today),
          month: Math.round(aggWaterStats.qty.month),
          all: Math.round(aggWaterStats.qty.all)
        },
        cost: {
          today: Math.round(aggWaterStats.cost.today),
          month: Math.round(aggWaterStats.cost.month),
          all: Math.round(aggWaterStats.cost.all)
        },
        sources: aggWaterStats.sources
      },
      ppm: {
        total: pTotal,
        done: pDone,
        pending: pPending,
        overdue: pOverdue,
        postponed: pPostponed
      },
      ppmSchedules: ppmSchedulesArr,
      tenantUserIds,
      loadedPropertyId: propertyId,
      fetchedAt: Date.now(),
    };

    // 3. Store in Redis
    await setCache(cacheKey, dashboardData, CACHE_TTL.HOT);

    return NextResponse.json({ success: true, data: dashboardData, source: "db" });
  } catch (error) {
    console.error("[saas-mobile-server] property-admin dashboard error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
