import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { recalcSiteCompliance } from './recalc-compliance';
import { BASE_URL, AUTH_HEADER, resolveArchiveFolderId } from '../datto/folder-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/documents?siteId=xxx[&clientProvided=true|false]
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const siteId = params.get('siteId');
  if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 });

  let query = supabase
    .from('site_documents')
    .select('*')
    .eq('site_id', siteId)
    .order('uploaded_at', { ascending: false });

  const clientProvided = params.get('clientProvided');
  if (clientProvided === 'true') query = query.eq('client_provided', true);
  if (clientProvided === 'false') query = query.or('client_provided.eq.false,client_provided.is.null');

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const docs = data ?? [];

  // Sync with Datto — remove advisor docs whose file no longer exists in Datto.
  // Client uploads (client_provided = true) are protected — only deletable via the UI.
  const withDatto = docs.filter(d => d.datto_file_id && d.datto_folder_id && !d.client_provided);
  if (withDatto.length > 0) {
    // Group by folder to minimise Datto API calls
    const folderMap = new Map<string, string[]>();
    for (const d of withDatto) {
      const ids = folderMap.get(d.datto_folder_id) ?? [];
      ids.push(d.datto_file_id);
      folderMap.set(d.datto_folder_id, ids);
    }

    const missingFileIds = new Set<string>();
    await Promise.all(Array.from(folderMap.entries()).map(async ([folderId, fileIds]) => {
      try {
        const res = await fetch(`${BASE_URL}/file/${folderId}/files`, {
          headers: { Authorization: AUTH_HEADER },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = await res.json();
        const arr: any[] = Array.isArray(json) ? json : (json.result ?? json.files ?? json.items ?? []);
        const presentIds = new Set(arr.map((i: any) => String(i.id ?? i.fileId ?? '')));
        for (const fileId of fileIds) {
          if (!presentIds.has(String(fileId))) missingFileIds.add(String(fileId));
        }
      } catch {
        // If Datto is unreachable, don't delete anything
      }
    }));

    if (missingFileIds.size > 0) {
      const missingDocs = withDatto.filter(d => missingFileIds.has(String(d.datto_file_id)));
      const toDelete = missingDocs.map(d => d.id);
      const dattoFileIdsToDelete = missingDocs.map(d => String(d.datto_file_id));
      // Cascade: remove actions linked by Datto file ID (AI sync actions use source_document_id)
      await supabase.from('actions').delete().in('source_document_id', dattoFileIdsToDelete);
      await supabase.from('site_documents').delete().in('id', toDelete);
      await recalcSiteCompliance(siteId, supabase);
      return NextResponse.json({ documents: docs.filter(d => !toDelete.includes(d.id)) });
    }
  }

  return NextResponse.json({ documents: docs });
}

// PATCH /api/documents — update reviewed fields after AI extraction, optionally insert actions
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.documentId) return NextResponse.json({ error: 'documentId is required' }, { status: 400 });

  const { documentId, document_name, document_type, issue_date, expiry_date, people_mentioned, notes, actions, source_document_id } = body;

  const { data, error } = await supabase
    .from('site_documents')
    .update({ document_name, document_type, issue_date: issue_date || null, expiry_date: expiry_date || null, people_mentioned, notes })
    .eq('id', documentId)
    .select('site_id, datto_file_id, file_name')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If renaming and the doc has a Datto file, push the rename there too
  if (document_name && data.datto_file_id) {
    try {
      const originalName: string = data.file_name ?? 'file';
      const dotIndex = originalName.lastIndexOf('.');
      const ext = dotIndex !== -1 ? originalName.slice(dotIndex) : '';
      // Append extension only if the new name doesn't already have one
      const newFileName = document_name.includes('.') ? document_name : `${document_name}${ext}`;
      await fetch(`${BASE_URL}/file/${data.datto_file_id}?name=${encodeURIComponent(newFileName)}`, {
        method: 'PATCH',
        headers: { Authorization: AUTH_HEADER },
      });
    } catch (err) {
      console.error('[documents] Datto rename failed:', err);
    }
  }

  // Insert actions server-side so site_document_id is set correctly
  if (Array.isArray(actions) && actions.length > 0) {
    const rows = actions.map((a: any) => ({
      site_id: data.site_id,
      title: a.description,
      description: '',
      priority: 'green',
      status: 'open',
      due_date: a.dueDate ?? null,
      responsible_person: a.responsiblePerson ?? null,
      source_document_name: a.sourceDocumentName ?? null,
      source_document_id: source_document_id ?? null,
      site_document_id: documentId,
      is_suggested: a.suggested ?? false,
      hazard: a.hazardContext ?? null,
    }));
    console.log('[documents] inserting actions:', rows.length, 'for document:', documentId);
    const { error: actErr } = await supabase.from('actions').insert(rows);
    if (actErr) console.error('[documents] action insert error:', actErr);
  } else {
    console.log('[documents] no actions to insert, received:', actions);
  }

  await recalcSiteCompliance(data.site_id, supabase);
  return NextResponse.json({ ok: true });
}

// DELETE /api/documents — remove a document record and archive the Datto file by renaming it
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.documentId) return NextResponse.json({ error: 'documentId is required' }, { status: 400 });

  const { data, error } = await supabase
    .from('site_documents')
    .delete()
    .eq('id', body.documentId)
    .select('site_id, datto_file_id, datto_folder_id, file_name, client_provided')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Remove actions linked to this document
  await supabase.from('actions').delete().eq('site_document_id', body.documentId);

  // Archive in Datto — move to Archive subfolder with OV- date suffix (non-fatal if it fails)
  // skipDattoRename is set when datto-link already handled the rename (replace duplicate flow)
  if (data.datto_file_id && !body.skipDattoRename) {
    try {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yy = String(now.getFullYear()).slice(2);

      const originalName: string = data.file_name ?? 'file';
      const dotIndex = originalName.lastIndexOf('.');
      const archivedName = dotIndex !== -1
        ? `${originalName.slice(0, dotIndex)} v1 ${dd}-${mm}-${yy}${originalName.slice(dotIndex)}`
        : `${originalName} v1 ${dd}-${mm}-${yy}`;

      // Resolve the archive folder — client uploads archive inside the client docs folder,
      // advisor docs archive at the site root level
      const archiveParentId = data.datto_folder_id ?? null;
      const archiveFolderId = archiveParentId ? await resolveArchiveFolderId(archiveParentId) : null;

      if (archiveFolderId) {
        // Move = download + re-upload to archive folder + delete original
        // (Datto PATCH only supports name/locked — no move parameter exists)
        const downloadRes = await fetch(`${BASE_URL}/file/${data.datto_file_id}/data`, {
          headers: { Authorization: AUTH_HEADER },
        });
        if (downloadRes.ok) {
          const fileBytes = await downloadRes.arrayBuffer();
          const form = new FormData();
          form.append('partData', new Blob([fileBytes]), archivedName);
          form.append('fileName', archivedName);
          form.append('makeUnique', 'false');
          const uploadRes = await fetch(`${BASE_URL}/file/${archiveFolderId}/files`, {
            method: 'POST',
            headers: { Authorization: AUTH_HEADER },
            body: form,
          });
          if (uploadRes.ok) {
            // Delete the original now the archive copy exists
            await fetch(`${BASE_URL}/file/${data.datto_file_id}`, {
              method: 'DELETE',
              headers: { Authorization: AUTH_HEADER },
            });
          } else {
            // Upload to archive failed — fall back to renaming in place
            console.warn('[documents] Datto archive upload failed:', uploadRes.status);
            await fetch(`${BASE_URL}/file/${data.datto_file_id}?name=${encodeURIComponent(archivedName)}`, {
              method: 'PATCH',
              headers: { Authorization: AUTH_HEADER },
            });
          }
        } else {
          // Download failed — fall back to renaming in place
          await fetch(`${BASE_URL}/file/${data.datto_file_id}?name=${encodeURIComponent(archivedName)}`, {
            method: 'PATCH',
            headers: { Authorization: AUTH_HEADER },
          });
        }
      } else {
        // No archive folder — rename in place as before
        await fetch(`${BASE_URL}/file/${data.datto_file_id}?name=${encodeURIComponent(archivedName)}`, {
          method: 'PATCH',
          headers: { Authorization: AUTH_HEADER },
        });
      }
    } catch (err) {
      console.error('[documents] Datto archive failed:', err);
    }
  }

  await recalcSiteCompliance(data.site_id, supabase);
  return NextResponse.json({ ok: true });
}
