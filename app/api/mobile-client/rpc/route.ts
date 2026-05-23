import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedSupabase } from "@/lib/mobileClient";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorizedSupabase(request);
    if (auth.response || !auth.client) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const functionName = body?.functionName;
    const params = body?.params ?? {};

    if (!functionName) {
      return NextResponse.json({ error: "functionName is required" }, { status: 400 });
    }

    const result = await auth.client.rpc(functionName, params);

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
