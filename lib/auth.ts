import { NextRequest, NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/client";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export async function getAuthenticatedUser(request: NextRequest): Promise<{
  token: string | null;
  user: AuthenticatedUser | null;
  response?: NextResponse;
}> {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    return {
      token: null,
      user: null,
      response: NextResponse.json({ error: "Missing bearer token" }, { status: 401 })
    };
  }

  const supabase = createAnonClient(token);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return {
      token,
      user: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    };
  }

  return {
    token,
    user: {
      id: data.user.id,
      email: data.user.email
    }
  };
}

export async function getPropertyAccess(userId: string, propertyId: string) {
  const admin = createAdminClient();

  const { data: userProfile } = await admin
    .from("users")
    .select("is_master_admin")
    .eq("id", userId)
    .maybeSingle();

  if (userProfile?.is_master_admin) {
    return { authorized: true, role: "master_admin" };
  }

  const { data: property } = await admin
    .from("properties")
    .select("organization_id")
    .eq("id", propertyId)
    .maybeSingle();

  if (property?.organization_id) {
    const { data: orgMembership } = await admin
      .from("organization_memberships")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", property.organization_id)
      .eq("is_active", true)
      .maybeSingle();

    if (orgMembership && ["org_admin", "org_super_admin", "owner", "super_tenant"].includes(orgMembership.role)) {
      return { authorized: true, role: orgMembership.role };
    }
  }

  const { data: propertyMembership } = await admin
    .from("property_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("property_id", propertyId)
    .eq("is_active", true)
    .maybeSingle();

  if (propertyMembership) {
    return { authorized: true, role: propertyMembership.role };
  }

  return { authorized: false as const };
}
