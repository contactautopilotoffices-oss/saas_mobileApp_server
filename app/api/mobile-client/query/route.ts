import { NextRequest, NextResponse } from "next/server";
import {
  QueryRequestBody,
  applyQueryFilters,
  applyQueryOrdering,
  getAuthorizedSupabase,
  extractPropertyIdFromQuery,
} from "@/lib/mobileClient";
import { getPropertyAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function buildMutationQuery(client: any, body: QueryRequestBody) {
  const table = client.from(body.table);

  switch (body.action) {
    case "insert": {
      let query = table.insert(body.values as any, body.mutationOptions as any);
      if (body.select) query = query.select(body.select);
      return query;
    }
    case "update": {
      let query = table.update(body.values as any);
      if (body.select) query = query.select(body.select);
      return query;
    }
    case "delete": {
      let query = table.delete();
      if (body.select) query = query.select(body.select);
      return query;
    }
    case "upsert": {
      let query = table.upsert(body.values as any, body.mutationOptions as any);
      if (body.select) query = query.select(body.select);
      return query;
    }
    case "select":
    default:
      return table.select(body.select ?? "*", body.selectOptions as any);
  }
}

/**
 * For SELECT queries, we use the admin client (service role) to bypass RLS and
 * enforce property scoping manually via getPropertyAccess(). This mirrors how
 * the web app's API routes work and avoids depending on RLS policies that may
 * not align with the actual app_role enum.
 *
 * For INSERT/UPDATE/DELETE, we keep using the anon client so RLS policies can
 * enforce write-level restrictions (e.g. only org admins can create properties).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorizedSupabase(request);
    if (auth.response || !auth.client || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as QueryRequestBody;
    if (!body?.table || !body?.action) {
      return NextResponse.json({ error: "table and action are required" }, { status: 400 });
    }

    let client = auth.client;

    // ── SELECT: bypass RLS, enforce explicit property/user scoping ─────────
    if (body.action === "select") {
      const propertyId = extractPropertyIdFromQuery(body);

      if (propertyId) {
        // Property-scoped query → verify the caller can access this property
        const access = await getPropertyAccess(auth.user.id, propertyId);
        if (!access.authorized) {
          return NextResponse.json(
            { error: "Forbidden: you do not have access to this property" },
            { status: 403 }
          );
        }
      } else if (body.table === "notifications") {
        // User-scoped table → ensure they can only read their own rows
        const userIdFilter = body.filters?.find(
          (f) => f.op === "eq" && f.column === "user_id"
        );
        if (!userIdFilter || userIdFilter.value !== auth.user.id) {
          return NextResponse.json(
            { error: "Forbidden: you can only read your own notifications" },
            { status: 403 }
          );
        }
      }
      // For all other SELECTs without property_id (global lookup tables, etc.),
      // allow authenticated users to read.

      client = createAdminClient();
    }

    // ── Execute query ─────────────────────────────────────────────────────
    let query = buildMutationQuery(client, body);
    query = applyQueryFilters(query, body.filters);
    query = applyQueryOrdering(query, body.orders, body.limit, body.offset);

    const result = body.single
      ? await query.single()
      : body.maybeSingle
        ? await query.maybeSingle()
        : await query;

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
    console.error("[saas-mobile-server] mobile-client/query error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
