// app/api/users/onboarding-status/route.ts
import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabaseServer'; // helper to get supabase with auth

export async function GET(request: Request) {
  // Get supabase client with user session from cookies
  const supabase = getSupabaseClient(request);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('users')
    .select('onboarding_completed')
    .eq('id', user.id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ onboarding_completed: data?.onboarding_completed ?? false });
}
