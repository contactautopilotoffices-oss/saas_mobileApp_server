import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId") || searchParams.get("organization_id");
    const propertyId = searchParams.get("propertyId") || searchParams.get("property_id");
    const status = searchParams.get("status");
    const type = searchParams.get("type"); // 'grievance' | 'hr_query' | 'confidential_feedback' | 'anonymous_feedback'
    const scope = searchParams.get("scope"); // 'my_raised' | 'assigned_to_me' | 'all'

    const admin = createAdminClient();

    // Check if user is an HR authority or Admin
    const hrRoles = ["hr", "hr_head", "hr_manager", "hr_ops", "org_super_admin", "master_admin", "org_admin"];
    const { data: mems } = await admin
      .from("organization_memberships")
      .select("role")
      .eq("user_id", auth.user.id);

    const isHrAuthority = mems?.some(m => hrRoles.includes((m.role || "").toLowerCase())) || false;

    let query = admin
      .from("hr_tickets")
      .select(`
        *,
        category:hr_ticket_categories(*),
        raised_by:users!raised_by_user_id(id, email, full_name),
        assigned_to:users!assigned_to_user_id(id, email, full_name)
      `)
      .order("created_at", { ascending: false });

    if (orgId) {
      query = query.eq("organization_id", orgId);
    }

    if (propertyId && propertyId !== "all") {
      query = query.or(`property_id.eq.${propertyId},employee_snapshot->>property_id.eq.${propertyId}`);
    }

    // Role-based visibility scoping
    if (scope === "my_raised" || !isHrAuthority) {
      query = query.eq("raised_by_user_id", auth.user.id);
    } else if (scope === "assigned_to_me") {
      query = query.eq("assigned_to_user_id", auth.user.id);
    }

    if (type && type !== "all") {
      query = query.eq("ticket_type", type);
    }

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[saas-mobile-server] hr tickets query error:", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Sanitize anonymous records
    const sanitized = (data || []).map(t => {
      if (t.is_anonymous && t.raised_by_user_id !== auth.user!.id) {
        return {
          ...t,
          raised_by_user_id: null,
          raised_by: { id: null, email: "anonymous@hidden.local", full_name: "Anonymous Employee" },
          employee_snapshot: { name: "Anonymous Employee", department: "Confidential", location: "Hidden" }
        };
      }
      return t;
    });

    return NextResponse.json({ success: true, data: sanitized });
  } catch (err: any) {
    console.error("[saas-mobile-server] hr tickets GET exception:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      organization_id,
      property_id,
      category_id,
      subject,
      description,
      attachment_urls = [],
      is_confidential = false,
      is_anonymous = false,
      priority = "medium"
    } = body;

    if (!category_id || !subject || !description) {
      return NextResponse.json({ success: false, error: "Category, subject, and description are required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // 1. Fetch Category
    const { data: category, error: catErr } = await admin
      .from("hr_ticket_categories")
      .select("*")
      .eq("id", category_id)
      .single();

    if (catErr || !category) {
      return NextResponse.json({ success: false, error: "Invalid category" }, { status: 404 });
    }

    // 2. Fetch User & Employee Profile details
    const { data: userObj } = await admin
      .from("users")
      .select("id, email, full_name")
      .eq("id", auth.user.id)
      .maybeSingle();

    const { data: empProfile } = await admin
      .from("employee_profiles")
      .select("*, reporting_manager:users!reporting_manager_id(id, full_name, email)")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    const effectiveOrgId = organization_id || empProfile?.organization_id || "211e1330-ad83-446d-941f-dcea48396798";
    const empLocation = empProfile?.location || "Headquarters";

    // 3. Generate Ticket Number
    let ticketNumber = "";
    const { data: generatedNum, error: rpcErr } = await admin.rpc("generate_hr_ticket_number", {
      p_org_id: effectiveOrgId,
      p_property_id: property_id || null,
      p_location: empLocation
    });

    if (!rpcErr && generatedNum) {
      ticketNumber = generatedNum;
    } else {
      const locInitials = empLocation.split(" ").map((w: string) => w[0]).join("").substring(0, 2).toUpperCase() || "HQ";
      const year = new Date().getFullYear();
      const { count } = await admin.from("hr_tickets").select("*", { count: "exact", head: true });
      const seqStr = String((count || 0) + 1).padStart(5, "0");
      ticketNumber = `HR-WS-${locInitials}-${year}-${seqStr}`;
    }

    // 4. Ticket Type & Owner
    let ticketType = category.ticket_type;
    if (is_anonymous) ticketType = "anonymous_feedback";
    else if (is_confidential) ticketType = "confidential_feedback";

    let assignedToUserId: string | null = null;
    if (category.first_level_owner_type === "reporting_manager" && empProfile?.reporting_manager?.id) {
      assignedToUserId = empProfile.reporting_manager.id;
    } else if (category.default_hr_owner_id) {
      assignedToUserId = category.default_hr_owner_id;
    }

    // 5. Calculate SLA Deadline (default 3 days for L1)
    const slaDays = category.l1_sla_days || 3;
    const slaDeadline = new Date(Date.now() + slaDays * 24 * 60 * 60 * 1000).toISOString();

    const insertPayload: any = {
      ticket_number: ticketNumber,
      organization_id: effectiveOrgId,
      property_id: property_id || null,
      category_id: category.id,
      ticket_type: ticketType,
      subject,
      description,
      priority,
      status: "open",
      current_level: 1,
      is_confidential: Boolean(is_confidential || category.is_confidential),
      is_anonymous: Boolean(is_anonymous || category.is_anonymous),
      attachment_urls,
      sla_deadline: slaDeadline,
      raised_by_user_id: auth.user.id,
      assigned_to_user_id: assignedToUserId,
      employee_snapshot: is_anonymous
        ? { name: "Anonymous Employee", department: "Confidential", location: "Hidden" }
        : {
            name: userObj?.full_name || userObj?.email || "Employee",
            email: userObj?.email,
            code: empProfile?.employee_code || null,
            designation: empProfile?.designation || "Staff",
            department: empProfile?.department || "Operations",
            location: empLocation,
            property_id: property_id || null,
            manager_name: (empProfile?.reporting_manager as any)?.full_name || null
          }
    };

    const { data: newTicket, error: insertErr } = await admin
      .from("hr_tickets")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertErr || !newTicket) {
      console.error("[saas-mobile-server] hr ticket insert error:", insertErr);
      return NextResponse.json({ success: false, error: insertErr?.message || "Failed to create HR ticket" }, { status: 500 });
    }

    // Log initial audit action
    await admin.from("hr_ticket_audit_logs").insert({
      ticket_id: newTicket.id,
      actor_user_id: auth.user.id,
      action: "created",
      details: {
        ticket_number: ticketNumber,
        category: category.category_name,
        is_anonymous: Boolean(is_anonymous)
      }
    });

    return NextResponse.json({ success: true, data: newTicket }, { status: 201 });
  } catch (err: any) {
    console.error("[saas-mobile-server] hr ticket POST exception:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
