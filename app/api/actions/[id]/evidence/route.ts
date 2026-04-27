import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Busboy from 'busboy';
import { BASE_URL, AUTH_HEADER, resolveSubfolder } from '../../../datto/folder-utils';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const signedUrlFor = new URL(req.url).searchParams.get('signedUrl');

  if (signedUrlFor) {
    const forceDownload = new URL(req.url).searchParams.get('download') === 'true';
    const { data: row } = await supabase
      .from('action_evidence')
      .select('storage_path, file_name')
      .eq('id', signedUrlFor)
      .eq('action_id', params.id)
      .single();
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { data, error } = await supabase.storage
      .from('client-uploads')
      .createSignedUrl(row.storage_path, 3600, forceDownload ? { download: row.file_name } : undefined);
    if (error || !data?.signedUrl) return NextResponse.json({ error: error?.message ?? 'Could not generate URL' }, { status: 500 });
    return NextResponse.json({ url: data.signedUrl });
  }

  const { data, error } = await supabase
    .from('action_evidence')
    .select('id, file_name, file_size_bytes, storage_path, uploaded_at, uploaded_by, datto_file_id, hazard_ref, source_document_id')
    .eq('action_id', params.id)
    .order('uploaded_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const evidence = (data ?? []).map(row => ({
    id: row.id,
    fileName: row.file_name,
    fileSizeBytes: row.file_size_bytes,
    storagePath: row.storage_path,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    dattoFileId: row.datto_file_id ?? null,
    hazardRef: row.hazard_ref ?? null,
    sourceDocumentId: row.source_document_id ?? null,
  }));
  return NextResponse.json({ evidence });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const actionId = params.id;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    const { fileBuffer, fileName, fileSize, mimeType, siteId, userId, sourceFolderId, hazardRef, sourceDocumentId, sourceDocumentName } =
      await parseMultipart(request, contentType);

    if (!fileBuffer || !fileName) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 });

    const { count: existingCount } = await supabase
      .from('action_evidence')
      .select('id', { count: 'exact', head: true })
      .eq('action_id', actionId);
    const seqSuffix = existingCount && existingCount > 0 ? `${existingCount + 1}` : '';

    // Build canonical filename used for DB, storage and Datto
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    const docBase = sourceDocumentName ? sourceDocumentName.replace(/\.[^.]+$/, '') : null;
    const now = new Date();
    const ukDate = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getFullYear()).slice(2)}`;
    const parts = [docBase, hazardRef ? `Ref ${hazardRef}` : null, `Evidence${seqSuffix} ${ukDate}`].filter(Boolean);
    const canonicalName = parts.length > 0 ? parts.join('-') + ext : fileName;

    // Insert DB row first to get the id for the storage path
    const { data: row, error: insertErr } = await supabase
      .from('action_evidence')
      .insert({
        action_id: actionId,
        site_id: siteId,
        uploaded_by: userId || null,
        file_name: canonicalName,
        file_size_bytes: fileSize || null,
        storage_path: 'pending', // placeholder, updated after upload
        hazard_ref: hazardRef || null,
        source_document_id: sourceDocumentId || null,
      })
      .select()
      .single();

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    const storagePath = `evidence/${actionId}/${row.id}/${canonicalName}`;

    const { error: storageErr } = await supabase.storage
      .from('client-uploads')
      .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: true });

    if (storageErr) {
      await supabase.from('action_evidence').delete().eq('id', row.id);
      return NextResponse.json({ error: `Storage upload failed: ${storageErr.message}` }, { status: 500 });
    }

    // Update the storage path now we know it
    await supabase.from('action_evidence').update({ storage_path: storagePath }).eq('id', row.id);

    // Upload to Datto Evidence subfolder if sourceFolderId provided
    let dattoFileId: string | null = null;
    let finalFileName = canonicalName;
    console.log('[evidence] sourceFolderId:', sourceFolderId || '(none)', '| hazardRef:', hazardRef || '(none)');
    if (sourceFolderId) {
      const { id: evidenceFolderId, error: folderErr } = await resolveSubfolder(sourceFolderId, 'Evidence');
      console.log('[evidence] evidenceFolderId:', evidenceFolderId ?? `(null — ${folderErr})`);
      if (evidenceFolderId) {
        try {
          const form = new FormData();
          form.append('partData', new Blob([new Uint8Array(fileBuffer!)], { type: mimeType }), canonicalName);
          form.append('fileName', canonicalName);
          form.append('makeUnique', 'true');
          const dattoRes = await fetch(`${BASE_URL}/file/${evidenceFolderId}/files`, {
            method: 'POST', headers: { Authorization: AUTH_HEADER }, body: form,
          });
          const dattoBody = await dattoRes.text();
          console.log('[evidence] Datto upload status:', dattoRes.status, '| body:', dattoBody);
          if (dattoRes.ok) {
            let dattoJson: any = {};
            try { dattoJson = JSON.parse(dattoBody); } catch { /* non-JSON */ }
            const d = dattoJson.value ?? dattoJson;
            dattoFileId = String(d.fileID ?? d.fileId ?? d.id ?? '') || null;
            // Capture actual filename Datto stored — makeUnique may have changed it (e.g. "Evidence.docx" → "Evidence (2).docx")
            const actualDattoName: string | null = d.name ?? d.fileName ?? null;
            const dbUpdates: Record<string, string> = {};
            if (dattoFileId) dbUpdates.datto_file_id = dattoFileId;
            if (actualDattoName && actualDattoName !== canonicalName) {
              dbUpdates.file_name = actualDattoName;
              finalFileName = actualDattoName;
              console.log('[evidence] Datto renamed file via makeUnique:', canonicalName, '→', actualDattoName);
            }
            if (Object.keys(dbUpdates).length > 0) {
              await supabase.from('action_evidence').update(dbUpdates).eq('id', row.id);
            } else if (!dattoFileId) {
              console.warn('[evidence] Datto upload OK but no file ID in response:', dattoBody);
            }
          } else {
            console.warn('[evidence] Datto upload failed:', dattoRes.status, dattoBody);
          }
        } catch (err) {
          console.warn('[evidence] Datto upload exception:', err);
        }
      }
    }

    return NextResponse.json({
      evidence: {
        id: row.id,
        fileName: finalFileName,
        fileSizeBytes: fileSize || null,
        storagePath,
        uploadedAt: row.uploaded_at,
        uploadedBy: userId || null,
        dattoFileId,
        hazardRef: hazardRef || null,
        sourceDocumentId: sourceDocumentId || null,
      },
    });
  } catch (err: any) {
    console.error('[evidence upload] error:', err);
    return NextResponse.json({ error: err.message ?? 'Upload failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const evidenceId = new URL(request.url).searchParams.get('evidenceId');
  if (!evidenceId) return NextResponse.json({ error: 'evidenceId required' }, { status: 400 });

  const { data: row, error: fetchErr } = await supabase
    .from('action_evidence')
    .select('storage_path, datto_file_id, file_name, site_id')
    .eq('id', evidenceId)
    .eq('action_id', params.id)
    .single();

  if (fetchErr || !row) return NextResponse.json({ error: 'Evidence not found' }, { status: 404 });

  if (row.datto_file_id) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(2);
    const ext = row.file_name.includes('.') ? row.file_name.slice(row.file_name.lastIndexOf('.')) : '';
    const base = row.file_name.slice(0, row.file_name.length - ext.length);
    const archivedName = row.file_name;

    try {
      const { data: site } = await supabase.from('sites').select('vault_folder_id').eq('id', row.site_id).single();

      let movedToVault = false;
      if (site?.vault_folder_id) {
        const { id: vaultEvidenceFolderId, error: folderErr } = await resolveSubfolder(site.vault_folder_id, 'Evidence');
        console.log('[evidence delete] vault Evidence folder:', vaultEvidenceFolderId ?? `(null — ${folderErr})`);

        if (vaultEvidenceFolderId) {
          console.log('[evidence delete] downloading file:', row.datto_file_id);
          const downloadRes = await fetch(`${BASE_URL}/file/${row.datto_file_id}/data`, {
            headers: { Authorization: AUTH_HEADER },
          });
          console.log('[evidence delete] download status:', downloadRes.status, 'content-type:', downloadRes.headers.get('content-type'));
          if (downloadRes.ok) {
            const fileData = await downloadRes.arrayBuffer();
            console.log('[evidence delete] downloaded bytes:', fileData.byteLength);
            const mimeType = downloadRes.headers.get('content-type') ?? 'application/octet-stream';
            const form = new FormData();
            form.append('partData', new Blob([new Uint8Array(fileData)], { type: mimeType }), archivedName);
            form.append('fileName', archivedName);
            form.append('makeUnique', 'true');
            console.log('[evidence delete] uploading to vault folder:', vaultEvidenceFolderId, 'as:', archivedName);
            const uploadRes = await fetch(`${BASE_URL}/file/${vaultEvidenceFolderId}/files`, {
              method: 'POST', headers: { Authorization: AUTH_HEADER }, body: form,
            });
            const uploadBody = await uploadRes.text();
            console.log('[evidence delete] vault upload status:', uploadRes.status, '| body:', uploadBody);
            if (uploadRes.ok) {
              movedToVault = true;
              // Can't DELETE in Datto (permission denied) — rename original to mark it as moved
              const movedName = `${base} (moved ${dd}-${mm}-${yy})${ext}`;
              const renameRes = await fetch(`${BASE_URL}/file/${row.datto_file_id}?name=${encodeURIComponent(movedName)}`, {
                method: 'PATCH', headers: { Authorization: AUTH_HEADER },
              });
              if (!renameRes.ok) console.warn('[evidence delete] Datto original rename failed:', renameRes.status, await renameRes.text());
              else console.log('[evidence delete] original renamed to:', movedName);
            } else {
              console.warn('[evidence delete] vault upload failed:', uploadRes.status, uploadBody);
            }
          } else {
            const errBody = await downloadRes.text();
            console.warn('[evidence delete] Datto download failed:', downloadRes.status, errBody);
          }
        }
      }

      if (!movedToVault) {
        // Fallback: rename in place with removal date
        const patchRes = await fetch(`${BASE_URL}/file/${row.datto_file_id}?name=${encodeURIComponent(archivedName)}`, {
          method: 'PATCH', headers: { Authorization: AUTH_HEADER },
        });
        if (!patchRes.ok) console.warn('[evidence delete] Datto rename fallback failed:', patchRes.status, await patchRes.text());
      }
    } catch (err) {
      console.warn('[evidence delete] Datto vault move exception:', err);
    }
  }

  const { error: storageErr } = await supabase.storage.from('client-uploads').remove([row.storage_path]);
  if (storageErr) console.warn('[evidence delete] storage removal failed:', storageErr.message);

  const { error: deleteErr } = await supabase.from('action_evidence').delete().eq('id', evidenceId);
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

function parseMultipart(request: NextRequest, contentType: string): Promise<{
  fileBuffer: Buffer | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  siteId: string;
  userId: string;
  sourceFolderId: string;
  hazardRef: string;
  sourceDocumentId: string;
  sourceDocumentName: string;
}> {
  return new Promise(async (resolve, reject) => {
    const bb = Busboy({ headers: { 'content-type': contentType } });
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let fileSize = 0;
    let fileMime = '';
    let siteId = '';
    let userId = '';
    let sourceFolderId = '';
    let hazardRef = '';
    let sourceDocumentId = '';
    let sourceDocumentName = '';
    const chunks: Buffer[] = [];

    bb.on('file', (_field: string, stream: any, info: { filename: string; mimeType: string }) => {
      fileName = info.filename;
      fileMime = info.mimeType;
      stream.on('data', (chunk: Buffer) => { chunks.push(chunk); fileSize += chunk.length; });
      stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
    });

    bb.on('field', (name: string, val: string) => {
      if (name === 'siteId') siteId = val;
      if (name === 'userId') userId = val;
      if (name === 'sourceFolderId') sourceFolderId = val;
      if (name === 'hazardRef') hazardRef = val;
      if (name === 'sourceDocumentId') sourceDocumentId = val;
      if (name === 'sourceDocumentName') sourceDocumentName = val;
    });

    bb.on('finish', () => resolve({ fileBuffer, fileName, fileSize, mimeType: fileMime, siteId, userId, sourceFolderId, hazardRef, sourceDocumentId, sourceDocumentName }));
    bb.on('error', reject);

    const body = await request.arrayBuffer();
    bb.write(Buffer.from(body));
    bb.end();
  });
}
