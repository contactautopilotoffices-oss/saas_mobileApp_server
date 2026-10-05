import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized. Please log in." }, { status: 401 });
    }

    const body = await request.json();
    const { userId, action = "approve", reason, propertyId, role } = body;

    if (!userId) {
      return NextResponse.json({ error: "Missing userId parameter" }, { status: 400 });
    }

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: 'Action must be "approve" or "reject"' }, { status: 400 });
    }

    const admin = createAdminClient();

    // 1. Check caller permissions
    const { data: callerProfile } = await admin
      .from("users")
      .select("is_master_admin, full_name")
      .eq("id", auth.user.id)
      .single();

    const isMasterAdmin = !!callerProfile?.is_master_admin;

    // Fetch target user memberships to know target org and property
    const { data: targetPropMemb } = await admin
      .from("property_memberships")
      .select("property_id, organization_id, role")
      .eq("user_id", userId)
      .maybeSingle();

    const { data: targetOrgMemb } = await admin
      .from("organization_memberships")
      .select("organization_id, role")
      .eq("user_id", userId)
      .maybeSingle();

    let targetOrgId = targetPropMemb?.organization_id || targetOrgMemb?.organization_id || null;
    const targetPropId = propertyId || targetPropMemb?.property_id || null;

    if (!targetOrgId && targetPropId) {
      const { data: propRow } = await admin
        .from("properties")
        .select("organization_id")
        .eq("id", targetPropId)
        .maybeSingle();
      if (propRow?.organization_id) {
        targetOrgId = propRow.organization_id;
      }
    }

    if (!isMasterAdmin) {
      let isAuthorized = false;

      // Check caller's organization memberships
      const { data: callerOrgMembs } = await admin
        .from("organization_memberships")
        .select("organization_id, role")
        .eq("user_id", auth.user.id)
        .eq("is_active", true);

      const callerSuperOrgIds = (callerOrgMembs || [])
        .filter((m: any) => ["org_super_admin", "admin", "owner", "bd_super_admin"].includes(m.role))
        .map((m: any) => m.organization_id);

      if (callerSuperOrgIds.length > 0) {
        if (!targetOrgId || callerSuperOrgIds.includes(targetOrgId)) {
          isAuthorized = true;
        }
      }

      // Check if Property Admin for the user's property
      if (!isAuthorized && targetPropId) {
        const { data: propMemb } = await admin
          .from("property_memberships")
          .select("role")
          .eq("user_id", auth.user.id)
          .eq("property_id", targetPropId)
          .eq("is_active", true)
          .maybeSingle();

        if (propMemb && propMemb.role === "property_admin") {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        return NextResponse.json(
          { error: "Forbidden. You do not have administrative permission to approve users for this workspace." },
          { status: 403 }
        );
      }
    }

    const now = new Date().toISOString();

    if (action === "approve") {
      // 1. Update users table
      const { error: userUpdateErr } = await admin
        .from("users")
        .update({
          is_approved: true,
          approval_status: "approved",
          approved_by: auth.user.id,
          approved_at: now,
          rejection_reason: null,
        })
        .eq("id", userId);

      if (userUpdateErr) {
        throw userUpdateErr;
      }

      // 2. Activate property memberships
      const propUpdate: any = { is_active: true };
      if (role && targetPropId) propUpdate.role = role;

      await admin
        .from("property_memberships")
        .update(propUpdate)
        .eq("user_id", userId);

      // 3. Activate or create org membership
      if (targetOrgId) {
        const targetRole = role || targetOrgMemb?.role || "staff";
        await admin
          .from("organization_memberships")
          .upsert(
            {
              organization_id: targetOrgId,
              user_id: userId,
              role: targetRole,
              is_active: true,
            },
            { onConflict: "organization_id,user_id" }
          );
      }

      // 4. Link employee profile if internal staff/admin
      const { data: approvedUserData } = await admin
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (approvedUserData) {
        const appRole = role || targetOrgMemb?.role || approvedUserData.role || "staff";
        if (["hr", "hr_head", "staff", "property_admin", "org_super_admin"].includes(appRole)) {
          const fullName = approvedUserData.full_name || approvedUserData.email.split("@")[0];
          const nameParts = fullName.split(" ");
          const firstName = nameParts[0] || "Employee";
          const lastName = nameParts.slice(1).join(" ") || "";
          const ecode = `E${Math.floor(100 + Math.random() * 900)}`;

          try {
            await admin.from("employee_profiles").upsert(
              {
                organization_id: targetOrgId || approvedUserData.organization_id || null,
                user_id: userId,
                employee_code: ecode,
                first_name: firstName,
                last_name: lastName,
                full_name: fullName,
                email: approvedUserData.email,
                contact_number: approvedUserData.phone || null,
                department: appRole.includes("hr") ? "Human Resources" : "Operations",
                designation: appRole.replace(/_/g, " ").toUpperCase(),
                joining_date: new Date().toISOString().split("T")[0],
                employment_status: "Active",
              },
              { onConflict: "organization_id,user_id" }
            );
          } catch (e) {
            // Ignore employee profile failure if table not present
          }
        }
      }

      return NextResponse.json({
        success: true,
        action: "approve",
        approvedBy: callerProfile?.full_name || "Administrator",
        approvedAt: now,
      });
    } else {
      // Rejection logic
      const rejectReason = reason || "Application requirements not met";

      const { error: userUpdateErr } = await admin
        .from("users")
        .update({
          is_approved: false,
          approval_status: "rejected",
          rejection_reason: rejectReason,
          approved_by: auth.user.id,
        })
        .eq("id", userId);

      if (userUpdateErr) {
        throw userUpdateErr;
      }

      // Deactivate property memberships
      await admin
        .from("property_memberships")
        .update({ is_active: false })
        .eq("user_id", userId);

      return NextResponse.json({
        success: true,
        action: "reject",
        rejectionReason: rejectReason,
        rejectedAt: now,
      });
    }
  } catch (error: any) {
    console.error("[Approve User API] error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
