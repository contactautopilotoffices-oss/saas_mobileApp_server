import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser, getPropertyAccess } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const admin = createAdminClient();

    const { data: doc, error } = await admin
      .from("document_bank")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (doc.property_id) {
      const access = await getPropertyAccess(auth.user.id, doc.property_id);
      if (!access.authorized) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

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

    return NextResponse.json({
      document: {
        ...doc,
        signed_url: signedUrl,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (auth.response || !auth.user) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const admin = createAdminClient();

    const { data: doc, error: fetchErr } = await admin
      .from("document_bank")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (doc.property_id) {
      const access = await getPropertyAccess(auth.user.id, doc.property_id);
      if (!access.authorized) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const body = await request.json();
    const updateData: Record<string, any> = {};

    if (body.verify === true) {
      updateData.verified_by = auth.user.id;
      updateData.verified_at = new Date().toISOString();
    } else if (body.verify === false) {
      updateData.verified_by = null;
      updateData.verified_at = null;
    }

    const editableFields = [
      "title",
      "category",
      "equipment",
      "vendor_name",
      "doc_number",
      "issue_date",
      "valid_from",
      "valid_to",
      "tags",
    ];

    for (const f of editableFields) {
      if (body[f] !== undefined) {
        updateData[f] = body[f];
      }
    }

    const { data: updated, error: updateErr } = await admin
      .from("document_bank")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ document: updated });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
