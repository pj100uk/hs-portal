import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data: row } = await supabase
    .from('client_uploads')
    .select('storage_path, file_name')
    .eq('id', params.id)
    .single();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase.storage
    .from('client-uploads')
    .createSignedUrl(row.storage_path, 3600, { download: row.file_name });
  if (error || !data?.signedUrl) return NextResponse.json({ error: error?.message ?? 'Could not generate URL' }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { action, actionId, reviewedBy, reviewNote } = body;

  if (action === 'acknowledge') {
    const { data, error } = await supabase
      .from('client_uploads')
      .update({
        status: 'acknowledged',
        reviewed_by: reviewedBy || null,
        reviewed_at: new Date().toISOString(),
        review_note: reviewNote || null,
      })
      .eq('id', params.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ upload: data });
  }

  if (action === 'link') {
    if (!actionId) return NextResponse.json({ error: 'actionId required for link' }, { status: 400 });

    // Fetch the upload to get file info
    const { data: upload, error: fetchErr } = await supabase
      .from('client_uploads')
      .select('*')
      .eq('id', params.id)
      .single();
    if (fetchErr || !upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 });

    // Fetch action to get site_id
    const { data: actionRow, error: actionErr } = await supabase
      .from('actions')
      .select('id, site_id, hazard_ref, source_document_id')
      .eq('id', actionId)
      .single();
    if (actionErr || !actionRow) return NextResponse.json({ error: 'Action not found' }, { status: 404 });

    // Create action_evidence record pointing to the existing storage path
    const { data: evidence, error: evidenceErr } = await supabase
      .from('action_evidence')
      .insert({
        action_id: actionId,
        site_id: actionRow.site_id,
        uploaded_by: upload.uploaded_by,
        file_name: upload.file_name,
        file_size_bytes: upload.file_size_bytes,
        storage_path: upload.storage_path,
        hazard_ref: actionRow.hazard_ref || null,
        source_document_id: actionRow.source_document_id || null,
      })
      .select()
      .single();
    if (evidenceErr) return NextResponse.json({ error: evidenceErr.message }, { status: 500 });

    // Update the upload record
    const { data: updated, error: updateErr } = await supabase
      .from('client_uploads')
      .update({
        status: 'linked',
        action_id: actionId,
        action_evidence_id: evidence.id,
        reviewed_by: reviewedBy || null,
        reviewed_at: new Date().toISOString(),
        review_note: reviewNote || null,
      })
      .eq('id', params.id)
      .select()
      .single();
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    return NextResponse.json({ upload: updated, evidence: { id: evidence.id } });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
