import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }
    const admin = createAdminClient();
    const { error: authError } = await admin.auth.admin.deleteUser(id);
    if (authError) throw authError;
    const { error: dbError } = await admin.from('users').delete().eq('id', id);
    if (dbError) throw dbError;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[saas-mobile-server] users/hard-delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
