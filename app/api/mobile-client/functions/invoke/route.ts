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
    const invokeBody = body?.body;

    if (!functionName) {
      return NextResponse.json({ error: "functionName is required" }, { status: 400 });
    }

    const result = await auth.client.functions.invoke(functionName, {
      body: invokeBody,
    });

    return NextResponse.json({
      data: result.data ?? null,
      error: result.error
        ? {
            message: result.error.message,
            name: result.error.name,
          }
        : null,
    });
  } catch (error) {
    console.error("[saas-mobile-server] mobile-client/functions/invoke error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
