/**
 * POST /api/notifications/read-all
 * Mark all notifications as read for user
 *
 * Body: { userId: string, propertyId?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, propertyId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    let query = createAdminClient()
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (propertyId) {
      query = query.eq('property_id', propertyId);
    }

    const { data, error } = await query.select('id');
    const count = data ? data.length : 0;

    if (error) {
      console.error('[Notifications] Mark all read error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, markedRead: count || 0 });

  } catch (err: any) {
    console.error('[Notifications] Mark all read error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}