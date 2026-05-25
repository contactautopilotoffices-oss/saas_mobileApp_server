import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedSupabase, extractPropertyIdFromRpc } from "@/lib/mobileClient";
import { getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * RPC proxy: uses admin client (service role) to bypass RLS and enforces
 * property scoping manually via getPropertyAccess() when a property_id is
 * present in the RPC parameters. This mirrors how the web app's API routes
 * handle server-side data access.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorizedSupabase(request);
    if (auth.response || !auth.client || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const functionName = body?.functionName;
    const params = body?.params ?? {};

    if (!functionName) {
      return NextResponse.json({ error: "functionName is required" }, { status: 400 });
    }

    // Enforce property scoping when a property_id is present in RPC params
    const propertyId = extractPropertyIdFromRpc(params);
    if (propertyId) {
      const access = await getPropertyAccess(auth.user.id, propertyId);
      if (!access.authorized) {
        return NextResponse.json(
          { error: "Forbidden: you do not have access to this property" },
          { status: 403 }
        );
      }
    }

    // Use admin client to bypass RLS (auth already verified above)
    const adminClient = createAdminClient();
    const result = await adminClient.rpc(functionName, params);

    return NextResponse.json({
      data: result.data ?? null,
      error: result.error
        ? {
            message: result.error.message,
            code: result.error.code,
            details: result.error.details,
            hint: result.error.hint,
          }
        : null,
      count: typeof result.count === "number" ? result.count : null,
    });
  } catch (error) {
    console.error("[saas-mobile-server] mobile-client/rpc error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
