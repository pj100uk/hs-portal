import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { recalcSiteCompliance } from './recalc-compliance';
import { BASE_URL, AUTH_HEADER } from '../datto/folder-utils';
import fs from 'fs';
import path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DATTO_DRIVE_ROOT = 'W:\\Customer Documents';

/** Resolve the W: drive path for a client-provided document */
function clientDocPath(siteFolderPath: string, fileName: string) {
  return path.join(DATTO_DRIVE_ROOT, ...siteFolderPath.split('/'), 'Client Provided Documents', fileName);
}

/** Resolve the W: drive path for the Archive folder (sibling of H&S Manual) */
function archiveFolderPath(siteFolderPath: string) {
  const parts = siteFolderPath.split('/');
  const parentParts = parts.slice(0, -1); // strip the H&S Manual segment
  return path.join(DATTO_DRIVE_ROOT, ...parentParts, 'Archive');
}

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
    .select('site_id, datto_file_id, file_name, client_provided')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Rename client-provided file on W: drive:
  // 1. Copy old version → Archive/{originalName} v1 dd-mm-yy.ext
  // 2. Rename current file in Client Provided Documents → newName.ext
  if (document_name && data.datto_file_id && data.client_provided) {
    try {
      const { data: site } = await supabase
        .from('sites')
        .select('datto_folder_path')
        .eq('id', data.site_id)
        .single();

      if (site?.datto_folder_path) {
        const originalName: string = data.file_name ?? 'file';
        const dotIndex = originalName.lastIndexOf('.');
        const ext = dotIndex !== -1 ? originalName.slice(dotIndex) : '';
        const newFileName = document_name.includes('.') ? document_name : `${document_name}${ext}`;
        const srcPath = clientDocPath(site.datto_folder_path, originalName);

        if (fs.existsSync(srcPath)) {
          // Step 1 — archive old version with next version number
          const now = new Date();
          const dd = String(now.getDate()).padStart(2, '0');
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const yy = String(now.getFullYear()).slice(2);
          const baseName = dotIndex !== -1 ? originalName.slice(0, dotIndex) : originalName;
          const archiveDir = archiveFolderPath(site.datto_folder_path);
          fs.mkdirSync(archiveDir, { recursive: true });
          // Find next version number by scanning Archive for existing versions of this file
          let versionNum = 1;
          try {
            const existing = fs.readdirSync(archiveDir);
            const vRegex = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} v(\\d+)`, 'i');
            const maxV = existing.reduce((max, f) => {
              const m = f.match(vRegex);
              return m ? Math.max(max, parseInt(m[1], 10)) : max;
            }, 0);
            versionNum = maxV + 1;
          } catch { /* default to v1 */ }
          const archivedName = `${baseName} v${versionNum} ${dd}-${mm}-${yy}${ext}`;
          fs.copyFileSync(srcPath, path.join(archiveDir, archivedName));
          console.log('[documents] archived old version → Archive/', archivedName);

          // Step 2 — rename in place
          const newPath = clientDocPath(site.datto_folder_path, newFileName);
          fs.renameSync(srcPath, newPath);
          await supabase.from('site_documents').update({ file_name: newFileName }).eq('id', documentId);
          console.log('[documents] renamed on W: drive:', originalName, '→', newFileName);
        } else {
          console.warn('[documents] file not found on W: drive for rename:', srcPath);
        }
      }
    } catch (err) {
      console.error('[documents] W: drive rename failed:', err);
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

  // Remove actions linked to this document via site_document_id (upload-linked)
  await supabase.from('actions').delete().eq('site_document_id', body.documentId);

  // Also remove AI-sync actions linked by Datto file ID (source_document_id), which have no site_document_id
  if (data.datto_file_id) {
    await supabase.from('actions').delete()
      .eq('site_id', data.site_id)
      .eq('source_document_id', String(data.datto_file_id))
      .is('site_document_id', null);
  }

  // Archive client-provided files on W: drive — rename with v1 date suffix and move to Archive
  // Advisor docs (AI-synced) are left untouched in Datto; only the portal record is removed.
  // skipDattoRename is set when datto-link already handled the rename (replace duplicate flow)
  if (data.client_provided && data.datto_file_id && !body.skipDattoRename) {
    try {
      const { data: siteData } = await supabase
        .from('sites')
        .select('datto_folder_path')
        .eq('id', data.site_id)
        .single();

      if (siteData?.datto_folder_path) {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yy = String(now.getFullYear()).slice(2);
        const originalName: string = data.file_name ?? 'file';
        const dotIndex = originalName.lastIndexOf('.');
        const archivedName = dotIndex !== -1
          ? `${originalName.slice(0, dotIndex)} v1 ${dd}-${mm}-${yy}${originalName.slice(dotIndex)}`
          : `${originalName} v1 ${dd}-${mm}-${yy}`;

        const srcPath = clientDocPath(siteData.datto_folder_path, originalName);
        const archiveDir = archiveFolderPath(siteData.datto_folder_path);
        const destPath = path.join(archiveDir, archivedName);

        if (fs.existsSync(srcPath)) {
          fs.mkdirSync(archiveDir, { recursive: true });
          fs.renameSync(srcPath, destPath);
          console.log('[documents] archived on W: drive:', originalName, '→ Archive/', archivedName);
        } else {
          console.warn('[documents] file not found on W: drive for archive:', srcPath);
        }
      }
    } catch (err) {
      console.error('[documents] W: drive archive failed:', err);
    }
  }

  await recalcSiteCompliance(data.site_id, supabase);
  return NextResponse.json({ ok: true });
}
