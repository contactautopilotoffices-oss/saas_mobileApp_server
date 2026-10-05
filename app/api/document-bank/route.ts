import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId") || searchParams.get("property_id");
    const organizationId = searchParams.get("organizationId") || searchParams.get("organization_id");
    const category = searchParams.get("category");
    const status = searchParams.get("status"); // expired | expiring | valid | all
    const q = searchParams.get("q") || searchParams.get("search");

    const admin = createAdminClient();

    let orgId = organizationId;
    if (propertyId) {
      const access = await getPropertyAccess(auth.user.id, propertyId);
      if (!access.authorized) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!orgId) {
        const { data: prop } = await admin
          .from("properties")
          .select("organization_id")
          .eq("id", propertyId)
          .single();
        orgId = prop?.organization_id;
      }
    }

    let query = admin
      .from("document_bank")
      .select("*")
      .order("created_at", { ascending: false });

    if (propertyId) {
      query = query.or(`property_id.eq.${propertyId},property_id.is.null`);
    } else if (orgId) {
      query = query.eq("organization_id", orgId);
    }

    if (category && category !== "all") {
      query = query.eq("category", category);
    }

    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    if (status === "expired") {
      query = query.lt("valid_to", today);
    } else if (status === "expiring") {
      query = query.gte("valid_to", today).lte("valid_to", in30);
    } else if (status === "valid") {
      query = query.or(`valid_to.is.null,valid_to.gt.${in30}`);
    }

    if (q && q.trim()) {
      const cleanQ = q.trim().replace(/[%_]/g, "");
      const like = `%${cleanQ}%`;
      query = query.or(
        `title.ilike.${like},vendor_name.ilike.${like},doc_number.ilike.${like},equipment.ilike.${like}`
      );
    }

    const { data: docs, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Generate signed URLs if files have a path
    const docsWithSigned = await Promise.all(
      (docs || []).map(async (doc) => {
        let signedUrl = null;
        if (doc.file_path) {
          try {
            const { data: signed } = await admin.storage
              .from("document_bank")
              .createSignedUrl(doc.file_path, 3600);
            signedUrl = signed?.signedUrl ?? null;
          } catch {
            signedUrl = null;
          }
        }
        return {
          ...doc,
          signed_url: signedUrl,
        };
      })
    );

    // Compute stats
    const allDocs = docs || [];
    const stats = {
      total: allDocs.length,
      expiring: allDocs.filter((d) => {
        if (!d.valid_to) return false;
        const days = (new Date(d.valid_to).getTime() - Date.now()) / 86400000;
        return days >= 0 && days <= 30;
      }).length,
      expired: allDocs.filter((d) => {
        if (!d.valid_to) return false;
        return new Date(d.valid_to).getTime() < Date.now();
      }).length,
      verified: allDocs.filter((d) => Boolean(d.verified_at)).length,
    };

    return NextResponse.json({
      documents: docsWithSigned,
      stats,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
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
      property_id,
      organization_id,
      title,
      category,
      equipment,
      vendor_name,
      doc_number,
      issue_date,
      valid_from,
      valid_to,
      file_name,
      file_path,
      file_type,
      tags,
    } = body;

    if (!title || !category) {
      return NextResponse.json(
        { error: "title and category are required" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    let resolvedOrgId = organization_id;
    if (property_id) {
      const access = await getPropertyAccess(auth.user.id, property_id);
      if (!access.authorized) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!resolvedOrgId) {
        const { data: prop } = await admin
          .from("properties")
          .select("organization_id")
          .eq("id", property_id)
          .single();
        resolvedOrgId = prop?.organization_id;
      }
    }

    const { data: newDoc, error } = await admin
      .from("document_bank")
      .insert({
        organization_id: resolvedOrgId,
        property_id: property_id || null,
        title,
        category,
        equipment: equipment || null,
        vendor_name: vendor_name || null,
        doc_number: doc_number || null,
        issue_date: issue_date || null,
        valid_from: valid_from || null,
        valid_to: valid_to || null,
        file_name: file_name || "document.pdf",
        file_path: file_path || null,
        file_type: file_type || "application/pdf",
        tags: Array.isArray(tags) ? tags : [],
        ocr_status: "not_applicable",
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ document: newDoc }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
