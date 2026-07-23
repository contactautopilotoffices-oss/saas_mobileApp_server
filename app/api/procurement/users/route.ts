import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
    try {
        const auth = await getAuthenticatedUser(request);
        if (auth.response || !auth.user) return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organizationId');

        const adminSupabase = createAdminClient();

        // Build query for organization_memberships with procurement role only
        let query = adminSupabase
            .from('organization_memberships')
            .select(`
                user_id,
                organization_id,
                user:users!user_id(id, full_name, email, user_photo_url),
                role
            `)
            .eq('role', 'procurement')
            .eq('is_active', true);

        // Filter by organization if provided
        if (organizationId) {
            query = query.eq('organization_id', organizationId);
        }

        const { data: orgMemberships, error: orgError } = await query;

        if (orgError) {
            console.error('Error fetching procurement users:', orgError);
            return NextResponse.json({ error: 'Database error' }, { status: 500 });
        }

        const userMap = new Map<string, any>();

        if (orgMemberships) {
            orgMemberships.forEach((m: any) => {
                if (m.user && !userMap.has(m.user_id)) {
                    const u = m.user;
                    userMap.set(m.user_id, {
                        id: u.id,
                        full_name: u.full_name,
                        email: u.email,
                        user_photo_url: u.user_photo_url,
                        role: m.role,
                    });
                }
            });
        }

        return NextResponse.json(Array.from(userMap.values()));
    } catch (error) {
        console.error('[Procurement Users GET] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
