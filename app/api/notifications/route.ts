/**
 * GET /api/notifications
 * Get notifications for user
 *
 * Query params:
 *   - userId: string (required)
 *   - propertyId: string (optional)
 *   - limit: number (default 20)
 *   - offset: number (default 0)
 *   - unreadOnly: boolean (default false)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || auth.user.id;
    const propertyId = searchParams.get('propertyId');
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const unreadOnly = searchParams.get('unreadOnly') === 'true';

    // Build query
    let query = createAdminClient()
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (propertyId) {
      query = query.eq('property_id', propertyId);
    }

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('[Notifications] Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      notifications: data || [],
      count: count || 0,
    });

  } catch (err: any) {
    console.error('[Notifications] Get error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}