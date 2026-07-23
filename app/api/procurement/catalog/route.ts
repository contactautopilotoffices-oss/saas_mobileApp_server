import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthenticatedUser } from '@/lib/auth';
import { canUserSeePrices } from '@/lib/procurement';

function isValidUuid(uuid: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

// Helper: Check if user is procurement/admin
async function isProcurementUser(userId: string, organizationId: string): Promise<boolean> {
    if (!isValidUuid(organizationId)) return false;
    const adminSupabase = createAdminClient();
    const { data } = await adminSupabase
        .from('organization_memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .maybeSingle();
    return ['procurement', 'org_super_admin', 'master_admin'].includes(data?.role || '');
}

// Helper: Resolve organization
async function resolveOrganizationId(userId: string, providedId: string | null): Promise<string | null> {
    if (providedId && isValidUuid(providedId)) return providedId;
    
    const adminSupabase = createAdminClient();
    const { data } = await adminSupabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
        
    return data?.organization_id || null;
}

export async function GET(request: NextRequest) {
    try {
        const auth = await getAuthenticatedUser(request);
        if (auth.response || !auth.user) return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const searchParams = request.nextUrl.searchParams;
        const providedOrgId = searchParams.get('organizationId');
        const providedPropId = searchParams.get('propertyId');
        const search = searchParams.get("search");
        const category = searchParams.get("category");
        
        const organizationId = await resolveOrganizationId(auth.user.id, providedOrgId);

        if (!organizationId) {
            return NextResponse.json({ error: 'Valid Organization ID is required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();
        const canSeePrice = await canUserSeePrices(auth.user.id, organizationId, providedPropId || undefined);

        let query = adminSupabase
            .from('procurement_catalog')
            .select('id, name, description, photo_url, category, estimated_price, unit')
            .eq('organization_id', organizationId)
            .eq('is_active', true)
            .order('name');
            
        if (search) {
          query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
        }
        if (category && category !== "all") {
          query = query.eq("category", category);
        }

        const { data: catalog, error } = await query;

        if (error) {
            console.error('[Catalog GET] Error:', error);
            return NextResponse.json({ error: 'Database error' }, { status: 500 });
        }

        // Mask price for non-procurement users
        const result = (catalog || []).map(item => ({
            ...item,
            estimated_price: canSeePrice ? item.estimated_price : null,
        }));

        // Return array to match saas_one
        return NextResponse.json(result);
    } catch (error) {
        console.error('[Catalog GET] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const auth = await getAuthenticatedUser(request);
        if (auth.response || !auth.user) return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { name, description, category, estimated_price, unit, organization_id: providedOrgId, photo_base64, photo_url: existingPhotoUrl } = body;

        const organization_id = await resolveOrganizationId(auth.user.id, providedOrgId);

        if (!organization_id || !name) {
            return NextResponse.json({ error: 'Valid Organization ID and Name are required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        if (!(await isProcurementUser(auth.user.id, organization_id))) {
            return NextResponse.json({ error: 'Forbidden: procurement role required' }, { status: 403 });
        }

        // Check for duplicates
        const { data: existing } = await adminSupabase
            .from('procurement_catalog')
            .select('id')
            .eq('organization_id', organization_id)
            .ilike('name', name)
            .eq('is_active', true)
            .maybeSingle();

        if (existing) {
            return NextResponse.json({ error: `An item named "${name}" already exists in the catalog.` }, { status: 409 });
        }

        let finalPhotoUrl = existingPhotoUrl;

        if (photo_base64 && photo_base64.startsWith('data:image')) {
            try {
                const bucketName = 'procurement-items';
                const fileName = `${organization_id}/${Date.now()}-${name.replace(/\s+/g, '-').toLowerCase()}.webp`;
                const base64Data = photo_base64.split(',')[1];
                const buffer = Buffer.from(base64Data, 'base64');

                const { error: uploadError } = await adminSupabase.storage
                    .from(bucketName)
                    .upload(fileName, buffer, { contentType: 'image/webp', upsert: true });

                if (!uploadError) {
                    const { data: { publicUrl } } = adminSupabase.storage.from(bucketName).getPublicUrl(fileName);
                    finalPhotoUrl = publicUrl;
                } else {
                    console.error('[Catalog POST] Storage upload error:', uploadError);
                }
            } catch (uploadErr) {
                console.error('[Catalog POST] Upload error:', uploadErr);
            }
        }

        const { data, error } = await adminSupabase
            .from('procurement_catalog')
            .insert({
                organization_id,
                name,
                description,
                category,
                estimated_price: parseFloat(estimated_price) || 0,
                unit: unit || 'pcs',
                photo_url: finalPhotoUrl,
                is_active: true,
            })
            .select()
            .single();

        if (error) {
            console.error('[Catalog POST] DB error:', error);
            return NextResponse.json({ error: 'Database error' }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('[Catalog POST] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const auth = await getAuthenticatedUser(request);
        if (auth.response || !auth.user) return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { id, name, description, category, estimated_price, unit, organization_id: providedOrgId, photo_base64, photo_url: existingPhotoUrl } = body;

        const organization_id = await resolveOrganizationId(auth.user.id, providedOrgId);

        if (!id || !organization_id) {
            return NextResponse.json({ error: 'Item ID and Valid Organization ID are required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        if (!(await isProcurementUser(auth.user.id, organization_id))) {
            return NextResponse.json({ error: 'Forbidden: procurement role required' }, { status: 403 });
        }

        // Check for duplicates (excluding self)
        const { data: existing } = await adminSupabase
            .from('procurement_catalog')
            .select('id')
            .eq('organization_id', organization_id)
            .ilike('name', name)
            .eq('is_active', true)
            .neq('id', id)
            .maybeSingle();

        if (existing) {
            return NextResponse.json({ error: `Another item named "${name}" already exists.` }, { status: 409 });
        }

        let finalPhotoUrl = existingPhotoUrl;

        if (photo_base64 && photo_base64.startsWith('data:image')) {
            const bucketName = 'procurement-items';
            const fileName = `${organization_id}/${Date.now()}-${(name || 'item').replace(/\s+/g, '-').toLowerCase()}.webp`;
            const base64Data = photo_base64.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');

            const { error: uploadError } = await adminSupabase.storage
                .from(bucketName)
                .upload(fileName, buffer, { contentType: 'image/webp', upsert: true });

            if (!uploadError) {
                const { data: { publicUrl } } = adminSupabase.storage.from(bucketName).getPublicUrl(fileName);
                finalPhotoUrl = publicUrl;
            }
        }

        const { data, error } = await adminSupabase
            .from('procurement_catalog')
            .update({
                name,
                description,
                category,
                estimated_price: parseFloat(estimated_price) || 0,
                unit: unit || 'pcs',
                photo_url: finalPhotoUrl,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('organization_id', organization_id)
            .select()
            .single();

        if (error) {
            console.error('[Catalog PATCH] DB error:', error);
            return NextResponse.json({ error: 'Database error' }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('[Catalog PATCH] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const auth = await getAuthenticatedUser(request);
        if (auth.response || !auth.user) return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { id, organization_id: providedOrgId } = body;

        const organization_id = await resolveOrganizationId(auth.user.id, providedOrgId);

        if (!id || !organization_id) {
            return NextResponse.json({ error: 'Item ID and Valid Organization ID are required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        if (!(await isProcurementUser(auth.user.id, organization_id))) {
            return NextResponse.json({ error: 'Forbidden: procurement role required' }, { status: 403 });
        }

        const { error } = await adminSupabase
            .from('procurement_catalog')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', id)
            .eq('organization_id', organization_id);

        if (error) {
            console.error('[Catalog DELETE] DB error:', error);
            return NextResponse.json({ error: 'Database error' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Catalog DELETE] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
