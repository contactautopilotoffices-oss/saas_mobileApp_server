import { NextRequest, NextResponse } from "next/server";
import {
  QueryRequestBody,
  applyQueryFilters,
  applyQueryOrdering,
  getAuthorizedSupabase,
} from "@/lib/mobileClient";

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

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorizedSupabase(request);
    if (auth.response || !auth.client) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as QueryRequestBody;
    if (!body?.table || !body?.action) {
      return NextResponse.json({ error: "table and action are required" }, { status: 400 });
    }

    let query = buildMutationQuery(auth.client, body);
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
