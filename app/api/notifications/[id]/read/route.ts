/**
 * PATCH /api/notifications/[id]/read
 * Mark notification as read
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const { data, error } = await createAdminClient()
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[Notifications] Mark read error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, notification: data });

  } catch (err: any) {
    console.error('[Notifications] Mark read error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}