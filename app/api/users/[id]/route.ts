import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { canManageOrganization, canManageProperty, getUserProfile } from "@/lib/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

interface UpdateUserRequest {
  full_name?: string;
  phone?: string;
  user_photo_url?: string;
  is_active?: boolean;
  organizationId?: string;
  propertyId?: string;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Fetch user profile
    const { data: user, error } = await admin
      .from("users")
      .select("id, full_name, email, phone, user_photo_url, created_at")
      .eq("id", id)
      .maybeSingle();

    if (error || !user) {
      // Fallback for new users whose trigger hasn't populated public.users yet
      if (id === auth.user.id) {
        return NextResponse.json({
          success: true,
          data: {
            id: auth.user.id,
            full_name: auth.user.email?.split('@')[0] || "User",
            email: auth.user.email || "",
            phone: null,
            user_photo_url: null,
            is_active: true,
            created_at: new Date().toISOString(),
            property_memberships: [],
            organization_memberships: []
          }
        });
      }
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Fetch property memberships
    const { data: propertyMemberships } = await admin
      .from("property_memberships")
      .select("id, property_id, role, is_active, properties(name, code)")
      .eq("user_id", id)
      .eq("is_active", true);

    // Fetch organization memberships
    const { data: orgMemberships } = await admin
      .from("organization_memberships")
      .select("id, organization_id, role, is_active, organizations(name)")
      .eq("user_id", id)
      .eq("is_active", true);

    return NextResponse.json({
      success: true,
      data: {
        ...user,
        property_memberships: propertyMemberships ?? [],
        organization_memberships: orgMemberships ?? []
      }
    });
  } catch (error: any) {
    console.error("[users/[id]] GET error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

async function canManageTargetUser(actorUserId: string, targetUserId: string) {
  const profile = await getUserProfile(actorUserId);
  if (profile?.is_master_admin) return true;

  const admin = createAdminClient();

  const { data: targetOrgMemberships } = await admin
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", targetUserId)
    .eq("is_active", true);

  if (targetOrgMemberships) {
    for (const membership of targetOrgMemberships) {
      if (await canManageOrganization(actorUserId, membership.organization_id)) {
        return true;
      }
    }
  }

  const { data: targetPropMemberships } = await admin
    .from("property_memberships")
    .select("property_id")
    .eq("user_id", targetUserId)
    .eq("is_active", true);

  if (targetPropMemberships) {
    for (const membership of targetPropMemberships) {
      if (await canManageProperty(actorUserId, membership.property_id)) {
        return true;
      }
    }
  }

  return false;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = (await request.json()) as UpdateUserRequest;
    const { full_name, phone, user_photo_url, is_active, organizationId, propertyId } = body;

    if (!id) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }

    const isSelfUpdate = auth.user.id === id;
    const canManage = await canManageTargetUser(auth.user.id, id);

    if (!isSelfUpdate && !canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!isSelfUpdate && (organizationId || propertyId)) {
      const canManageScope = organizationId
        ? await canManageOrganization(auth.user.id, organizationId)
        : propertyId
        ? await canManageProperty(auth.user.id, propertyId)
        : false;
      if (!canManageScope) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (isSelfUpdate && is_active !== undefined) {
      return NextResponse.json({ error: "Users cannot change their own active status" }, { status: 403 });
    }

    const admin = createAdminClient();
    const updatePayload: Record<string, unknown> = {};
    if (full_name !== undefined) updatePayload.full_name = full_name ? String(full_name).trim() : null;
    if (phone !== undefined) updatePayload.phone = phone ? String(phone).trim() : null;
    if (user_photo_url !== undefined) updatePayload.user_photo_url = user_photo_url;

    if (!Object.keys(updatePayload).length && is_active === undefined) {
      return NextResponse.json({ error: "No supported fields to update" }, { status: 400 });
    }

    let user = null;
    if (Object.keys(updatePayload).length > 0) {
      const { data, error } = await admin
        .from("users")
        .update(updatePayload)
        .eq("id", id)
        .select("id, full_name, email, phone, user_photo_url, created_at")
        .maybeSingle();

      if (error) {
        require('fs').writeFileSync('D:/Projects/Mono-Repo-Fms-App-/saas_mobileApp_server/patch_error.log', JSON.stringify({ step: 'update', error }));
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      user = data;
    } else {
      // Fetch user if we are only updating is_active
      const { data } = await admin.from("users").select("id, full_name, email, phone, user_photo_url, created_at").eq("id", id).maybeSingle();
      user = data;
    }
    
    if (!user) {
      // User doesn't exist in public.users yet, insert them
      const insertPayload = {
        id,
        email: auth.user.email || "",
        full_name: (updatePayload.full_name as string) || auth.user.email?.split("@")[0] || "User",
        phone: (updatePayload.phone as string) || null,
      };
      
      const { data: newUser, error: insertError } = await admin
        .from("users")
        .insert(insertPayload)
        .select("id, full_name, email, phone, user_photo_url, created_at")
        .single();
        
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
      user = newUser;
    }

    if (is_active === false && canManage) {
      if (propertyId) {
        await admin
          .from("property_memberships")
          .update({ is_active: false })
          .eq("user_id", id)
          .eq("property_id", propertyId);
      } else if (organizationId) {
        await admin
          .from("organization_memberships")
          .update({ is_active: false })
          .eq("user_id", id)
          .eq("organization_id", organizationId);

        const { data: properties } = await admin
          .from("properties")
          .select("id")
          .eq("organization_id", organizationId);

        if (properties?.length) {
          await admin
            .from("property_memberships")
            .update({ is_active: false })
            .eq("user_id", id)
            .in("property_id", properties.map((property) => property.id));
        }
      }
    }

    return NextResponse.json({ success: true, user });
  } catch (error: any) {
    require('fs').writeFileSync('D:/Projects/Mono-Repo-Fms-App-/saas_mobileApp_server/patch_error.log', JSON.stringify({ step: 'catch', error: error.message, stack: error.stack }));
    console.error("[saas-mobile-server] users/[id] PATCH error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const hardDelete = request.nextUrl.searchParams.get("hard") === "true";
    const organizationId = request.nextUrl.searchParams.get("organizationId");
    const propertyId = request.nextUrl.searchParams.get("propertyId");

    if (!id) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }

    const profile = await getUserProfile(auth.user.id);
    const canManage = await canManageTargetUser(auth.user.id, id);

    if (hardDelete) {
      if (!profile?.is_master_admin) {
        return NextResponse.json({ error: "Only master admins can hard delete users" }, { status: 403 });
      }
    } else if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!hardDelete && (organizationId || propertyId)) {
      const canManageScope = organizationId
        ? await canManageOrganization(auth.user.id, organizationId)
        : propertyId
        ? await canManageProperty(auth.user.id, propertyId)
        : false;
      if (!canManageScope) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const admin = createAdminClient();

    if (hardDelete) {
      const { error: authDeleteError } = await admin.auth.admin.deleteUser(id);
      if (authDeleteError) {
        return NextResponse.json({ error: authDeleteError.message }, { status: 500 });
      }

      await admin.from("users").delete().eq("id", id);
      await admin.from("property_memberships").delete().eq("user_id", id);
      await admin.from("organization_memberships").delete().eq("user_id", id);
      await admin.from("mst_skills").delete().eq("user_id", id);
      await admin.from("resolver_stats").delete().eq("user_id", id);

      return NextResponse.json({ success: true, hardDeleted: true });
    }

    await admin.from("users").update({ is_active: false }).eq("id", id);

    if (propertyId) {
      await admin
        .from("property_memberships")
        .update({ is_active: false })
        .eq("user_id", id)
        .eq("property_id", propertyId);
    } else if (organizationId) {
      await admin
        .from("organization_memberships")
        .update({ is_active: false })
        .eq("user_id", id)
        .eq("organization_id", organizationId);

      const { data: properties } = await admin
        .from("properties")
        .select("id")
        .eq("organization_id", organizationId);

      if (properties?.length) {
        await admin
          .from("property_memberships")
          .update({ is_active: false })
          .eq("user_id", id)
          .in("property_id", properties.map((property) => property.id));
      }
    } else {
      await admin.from("organization_memberships").update({ is_active: false }).eq("user_id", id);
      await admin.from("property_memberships").update({ is_active: false }).eq("user_id", id);
    }

    return NextResponse.json({ success: true, deleted: true });
  } catch (error: any) {
    console.error("[saas-mobile-server] users/[id] DELETE error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
