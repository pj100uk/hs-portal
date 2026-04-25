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
    const { data: row } = await supabase
      .from('action_evidence')
      .select('storage_path')
      .eq('id', signedUrlFor)
      .eq('action_id', params.id)
      .single();
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { data, error } = await supabase.storage
      .from('client-uploads')
      .createSignedUrl(row.storage_path, 3600);
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
    const seqSuffix = existingCount && existingCount > 0 ? ` ${existingCount + 1}` : '';

    // Insert DB row first to get the id for the storage path
    const { data: row, error: insertErr } = await supabase
      .from('action_evidence')
      .insert({
        action_id: actionId,
        site_id: siteId,
        uploaded_by: userId || null,
        file_name: fileName,
        file_size_bytes: fileSize || null,
        storage_path: 'pending', // placeholder, updated after upload
        hazard_ref: hazardRef || null,
        source_document_id: sourceDocumentId || null,
      })
      .select()
      .single();

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    const storagePath = `evidence/${actionId}/${row.id}/${fileName}`;

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
    console.log('[evidence] sourceFolderId:', sourceFolderId || '(none)', '| hazardRef:', hazardRef || '(none)');
    if (sourceFolderId) {
      const { id: evidenceFolderId, error: folderErr } = await resolveSubfolder(sourceFolderId, 'Evidence');
      console.log('[evidence] evidenceFolderId:', evidenceFolderId ?? `(null — ${folderErr})`);
      if (evidenceFolderId) {
        try {
          const docBase = sourceDocumentName ? sourceDocumentName.replace(/\.[^.]+$/, '') : null;
          const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
          const parts = [docBase, hazardRef || null, `Evidence${seqSuffix}`].filter(Boolean);
          const dattoFileName = parts.join(' - ') + ext;
          const form = new FormData();
          form.append('partData', new Blob([new Uint8Array(fileBuffer!)], { type: mimeType }), dattoFileName);
          form.append('fileName', dattoFileName);
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
            if (dattoFileId) {
              await supabase.from('action_evidence').update({ datto_file_id: dattoFileId }).eq('id', row.id);
            } else {
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
        fileName,
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
    .select('storage_path, datto_file_id, file_name')
    .eq('id', evidenceId)
    .eq('action_id', params.id)
    .single();

  if (fetchErr || !row) return NextResponse.json({ error: 'Evidence not found' }, { status: 404 });

  // Rename in Datto to flag as removed (preserves audit trail)
  if (row.datto_file_id) {
    const removedDate = new Date().toISOString().slice(0, 10);
    const ext = row.file_name.includes('.') ? row.file_name.slice(row.file_name.lastIndexOf('.')) : '';
    const base = row.file_name.slice(0, row.file_name.length - ext.length);
    const newName = `${base} (${removedDate})${ext}`;
    const patchRes = await fetch(`${BASE_URL}/file/${row.datto_file_id}?name=${encodeURIComponent(newName)}`, {
      method: 'PATCH', headers: { Authorization: AUTH_HEADER },
    });
    if (!patchRes.ok) console.warn('[evidence delete] Datto rename failed:', patchRes.status, await patchRes.text());
  }

  const { error: storageErr } = await supabase.storage
    .from('client-uploads')
    .remove([row.storage_path]);

  if (storageErr) {
    console.warn('[evidence delete] storage removal failed:', storageErr.message);
    // Continue to delete DB row even if storage removal failed
  }

  const { error: deleteErr } = await supabase
    .from('action_evidence')
    .delete()
    .eq('id', evidenceId);

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
