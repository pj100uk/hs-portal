import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { BASE_URL, AUTH_HEADER, resolveSubfolder } from '../../datto/folder-utils';
import { notifyClientOfUploadRejection } from '../../../lib/email';

export const runtime = 'nodejs';

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
    .createSignedUrl(row.storage_path, 3600);
  if (error || !data?.signedUrl) return NextResponse.json({ error: error?.message ?? 'Could not generate URL' }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { action, actionId, reviewedBy, reviewNote } = body;

  if (action === 'hide') {
    const { error } = await supabase.from('client_uploads').update({ hidden: true }).eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

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

  if (action === 'reject') {
    const { data: upload, error: fetchErr } = await supabase
      .from('client_uploads').select('uploaded_by, file_name').eq('id', params.id).single();
    if (fetchErr || !upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 });

    const { data, error } = await supabase
      .from('client_uploads')
      .update({ status: 'rejected', reviewed_by: reviewedBy || null, reviewed_at: new Date().toISOString(), review_note: reviewNote || null })
      .eq('id', params.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (upload.uploaded_by) {
      notifyClientOfUploadRejection({ uploadedBy: upload.uploaded_by, fileName: upload.file_name, reviewNote: reviewNote || null });
    }
    return NextResponse.json({ upload: data });
  }

  if (action === 'link') {
    if (!actionId) return NextResponse.json({ error: 'actionId required for link' }, { status: 400 });

    const { data: upload, error: fetchErr } = await supabase
      .from('client_uploads')
      .select('*')
      .eq('id', params.id)
      .single();
    if (fetchErr || !upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 });

    // Fetch action and site in parallel
    const { data: actionRow, error: actionErr } = await supabase
      .from('actions').select('id, site_id, hazard_ref, source_document_id, source_document_name, source_folder_id').eq('id', actionId).single();
    if (actionErr || !actionRow) return NextResponse.json({ error: 'Action not found' }, { status: 404 });

    // Build canonical filename
    const ext = upload.file_name.includes('.') ? upload.file_name.slice(upload.file_name.lastIndexOf('.')) : '';
    const docBase = actionRow.source_document_name ? actionRow.source_document_name.replace(/\.[^.]+$/, '') : null;
    const { count: existingCount } = await supabase.from('action_evidence').select('id', { count: 'exact', head: true }).eq('action_id', actionId);
    const evNum = (existingCount ?? 0) + 1;
    const now = new Date();
    const ukDate = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getFullYear()).slice(2)}`;
    const parts = [docBase, actionRow.hazard_ref ? `Ref ${actionRow.hazard_ref}` : null, `EV${evNum} ${ukDate}`].filter(Boolean);
    const canonicalName = parts.length > 0 ? parts.join('-') + ext : upload.file_name;

    // Insert action_evidence row to get ID
    const { data: evidence, error: evidenceErr } = await supabase
      .from('action_evidence')
      .insert({
        action_id: actionId,
        site_id: actionRow.site_id,
        uploaded_by: upload.uploaded_by,
        file_name: canonicalName,
        file_size_bytes: upload.file_size_bytes,
        storage_path: 'pending',
        hazard_ref: actionRow.hazard_ref || null,
        source_document_id: actionRow.source_document_id || null,
      })
      .select()
      .single();
    if (evidenceErr) return NextResponse.json({ error: evidenceErr.message }, { status: 500 });

    // Copy to canonical Supabase evidence path
    const newStoragePath = `evidence/${actionId}/${evidence.id}/${canonicalName}`;
    const { error: copyErr } = await supabase.storage.from('client-uploads').copy(upload.storage_path, newStoragePath);
    if (copyErr) {
      await supabase.from('action_evidence').delete().eq('id', evidence.id);
      return NextResponse.json({ error: `Storage copy failed: ${copyErr.message}` }, { status: 500 });
    }
    await supabase.from('action_evidence').update({ storage_path: newStoragePath }).eq('id', evidence.id);
    await supabase.storage.from('client-uploads').remove([upload.storage_path]);

    // Move file in Datto: upload to Evidence folder, remove from Client Provided Documents
    let newDattoFileId: string | null = null;
    if (actionRow.source_folder_id) {
      try {
        const { id: evidenceFolderId, error: folderErr } = await resolveSubfolder(actionRow.source_folder_id, 'Evidence');
        if (evidenceFolderId) {
          // Check if a file with this canonical name already exists (avoids "(1)" duplicates)
          const listRes = await fetch(`${BASE_URL}/file/${evidenceFolderId}/files`, {
            headers: { Authorization: AUTH_HEADER }, cache: 'no-store',
          });
          if (listRes.ok) {
            const json = await listRes.json();
            const arr: any[] = Array.isArray(json) ? json : (json.result ?? json.files ?? json.items ?? []);
            const existing = arr.find((f: any) => (f.name ?? f.fileName) === canonicalName);
            if (existing) {
              newDattoFileId = String(existing.id ?? existing.fileId ?? existing.fileID ?? '') || null;
              console.log('[client-upload link] file already exists in Evidence, reusing id:', newDattoFileId);
            }
          }

          let actualEvidenceName = canonicalName;
          if (!newDattoFileId) {
            const { data: fileBlob, error: dlErr } = await supabase.storage.from('client-uploads').download(newStoragePath);
            if (!dlErr && fileBlob) {
              const form = new FormData();
              form.append('partData', fileBlob, canonicalName);
              form.append('fileName', canonicalName);
              form.append('makeUnique', 'true');
              const dattoRes = await fetch(`${BASE_URL}/file/${evidenceFolderId}/files`, {
                method: 'POST', headers: { Authorization: AUTH_HEADER }, body: form,
              });
              if (dattoRes.ok) {
                const respBody = await dattoRes.json().catch(() => ({}));
                const d = respBody.value ?? respBody;
                newDattoFileId = String(d.fileID ?? d.fileId ?? d.id ?? '') || null;
                // Capture actual Datto filename in case it was renamed (e.g. "(1)" suffix)
                const actualName: string | null = d.name ?? d.fileName ?? null;
                if (actualName && actualName !== canonicalName) actualEvidenceName = actualName;
                console.log('[client-upload link] Datto API Evidence upload ok, fileId:', newDattoFileId, '| name:', actualEvidenceName);
              } else {
                console.error('[client-upload link] Datto Evidence upload failed:', dattoRes.status, await dattoRes.text());
              }
            }
          }

          // Remove original from Datto Client Provided Documents
          if (upload.datto_file_id) {
            const delRes = await fetch(`${BASE_URL}/file/${upload.datto_file_id}`, { method: 'DELETE', headers: { Authorization: AUTH_HEADER } });
            if (!delRes.ok) console.warn('[client-upload link] Datto delete of original failed:', delRes.status);
          }

          const evidenceUpdates: Record<string, string> = {};
          if (newDattoFileId) evidenceUpdates.datto_file_id = newDattoFileId;
          if (actualEvidenceName !== canonicalName) evidenceUpdates.file_name = actualEvidenceName;
          if (Object.keys(evidenceUpdates).length > 0) {
            await supabase.from('action_evidence').update(evidenceUpdates).eq('id', evidence.id);
          }
        } else {
          console.warn('[client-upload link] could not resolve Evidence folder:', folderErr);
        }
      } catch (dattoErr: any) {
        console.error('[client-upload link] Datto move exception:', dattoErr.message);
      }
    }

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

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data: row } = await supabase.from('client_uploads').select('storage_path, status').eq('id', params.id).single();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Remove from Supabase Storage if not linked (linked files were moved to evidence/ path)
  if (row.status !== 'linked' && row.storage_path && row.storage_path !== 'pending') {
    await supabase.storage.from('client-uploads').remove([row.storage_path]);
  }

  const { error } = await supabase.from('client_uploads').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
