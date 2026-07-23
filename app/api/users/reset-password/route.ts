import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  try {
    const { email, redirectTo } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { error } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo || "autopilot://reset-password",
    });

    if (error) {
      console.error("[users/reset-password] error:", error);
      // Return a generic success to prevent email enumeration
      return NextResponse.json({ message: "If an account exists with this email, a password reset link has been sent." });
    }

    return NextResponse.json({ success: true, message: "Password reset email sent successfully" });
  } catch (err: any) {
    console.error("[users/reset-password] Exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
