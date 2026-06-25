import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Busboy from 'busboy';
import { BASE_URL, AUTH_HEADER, resolveClientDocsFolderId } from '../datto/folder-utils';
import { logActivity } from '../../lib/activity';
import { notifyAdvisorOfGeneralUpload } from '../../lib/email';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get('siteId');
  const userId = searchParams.get('userId');
  const role = searchParams.get('role');

  if (!siteId) return NextResponse.json({ error: 'siteId required' }, { status: 400 });

  const includeHidden = new URL(req.url).searchParams.get('includeHidden') === 'true';
  let query = supabase
    .from('client_uploads')
    .select('id, site_id, uploaded_by, uploaded_at, file_name, file_size_bytes, notes, status, action_id, action_evidence_id, reviewed_by, reviewed_at, review_note, hidden, datto_file_id')
    .eq('site_id', siteId)
    .order('uploaded_at', { ascending: false });
  if (!includeHidden) query = query.eq('hidden', false);

  if (role === 'client' && userId) {
    query = query.eq('uploaded_by', userId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Always include count of hidden items so UI can show "X hidden"
  const { count: hiddenCount } = await supabase
    .from('client_uploads')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('hidden', true);

  return NextResponse.json({ uploads: data ?? [], hiddenCount: hiddenCount ?? 0 });
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    const { fileBuffer, fileName, fileSize, mimeType, siteId, userId, notes } =
      await parseMultipart(request, contentType);

    if (!fileBuffer || !fileName) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 });

    const uploadId = crypto.randomUUID();
    const storagePath = `general-uploads/${uploadId}/${fileName}`;

    const { error: storageErr } = await supabase.storage
      .from('client-uploads')
      .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: true });

    if (storageErr) return NextResponse.json({ error: `Storage upload failed: ${storageErr.message}` }, { status: 500 });

    // Upload to Datto "Client Provided Documents" via API
    let dattoFileId: string | null = null;
    let storedFileName = fileName; // may be updated if Datto assigns a different name
    try {
      const { data: site } = await supabase.from('sites').select('datto_folder_id').eq('id', siteId).single();
      if (site?.datto_folder_id) {
        const targetFolderId = await resolveClientDocsFolderId(String(site.datto_folder_id));
        const form = new FormData();
        form.append('partData', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName);
        form.append('fileName', fileName);
        form.append('makeUnique', 'true');
        const dattoRes = await fetch(`${BASE_URL}/file/${targetFolderId}/files`, {
          method: 'POST', headers: { Authorization: AUTH_HEADER }, body: form,
        });
        const dattoBody = await dattoRes.text();
        if (dattoRes.ok) {
          let dattoJson: any = {};
          try { dattoJson = JSON.parse(dattoBody); } catch { /* non-JSON */ }
          const d = dattoJson.value ?? dattoJson;
          dattoFileId = String(d.fileID ?? d.fileId ?? d.id ?? '') || null;
          // If Datto assigned a different name (e.g. "(1)" suffix), store the actual name
          const actualDattoName: string | null = d.name ?? d.fileName ?? null;
          if (actualDattoName && actualDattoName !== fileName) storedFileName = actualDattoName;
          console.log('[client-upload] Datto API upload ok, fileId:', dattoFileId, '| name:', storedFileName);
        } else {
          console.error('[client-upload] Datto API upload failed:', dattoRes.status, dattoBody);
        }
      } else {
        console.warn('[client-upload] site has no datto_folder_id — skipping Datto upload');
      }
    } catch (dattoErr: any) {
      console.error('[client-upload] Datto upload exception:', dattoErr.message);
    }

    const { data: row, error: insertErr } = await supabase
      .from('client_uploads')
      .insert({
        id: uploadId,
        site_id: siteId,
        uploaded_by: userId || null,
        file_name: storedFileName,
        file_size_bytes: fileSize || null,
        storage_path: storagePath,
        notes: notes || null,
        status: 'pending_review',
        datto_file_id: dattoFileId,
      })
      .select()
      .single();

    if (insertErr) {
      await supabase.storage.from('client-uploads').remove([storagePath]);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    notifyAdvisorOfGeneralUpload({ siteId, uploadedBy: userId || null, fileName: storedFileName, notes: notes || null });

    logActivity({
      userId: userId || null,
      siteId: siteId || null,
      action: 'file_uploaded',
      resourceType: 'client_upload',
      resourceId: row.id,
      resourceName: storedFileName,
      metadata: { fileSizeBytes: fileSize || null },
    });

    return NextResponse.json({ upload: row });
  } catch (err: any) {
    console.error('[client-upload] error:', err);
    return NextResponse.json({ error: err.message ?? 'Upload failed' }, { status: 500 });
  }
}

function parseMultipart(request: NextRequest, contentType: string): Promise<{
  fileBuffer: Buffer | null; fileName: string; fileSize: number;
  mimeType: string; siteId: string; userId: string; notes: string;
}> {
  return new Promise(async (resolve, reject) => {
    const bb = Busboy({ headers: { 'content-type': contentType } });
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let fileSize = 0;
    let fileMime = '';
    let siteId = '';
    let userId = '';
    let notes = '';
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
      if (name === 'notes') notes = val;
    });
    bb.on('finish', () => resolve({ fileBuffer, fileName, fileSize, mimeType: fileMime, siteId, userId, notes }));
    bb.on('error', reject);

    const body = await request.arrayBuffer();
    bb.write(Buffer.from(body));
    bb.end();
  });
}
