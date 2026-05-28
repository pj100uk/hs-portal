import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Busboy from 'busboy';
import { BASE_URL, AUTH_HEADER, resolveClientDocsFolderId } from '../datto/folder-utils';

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

    // Upload to Datto "Client Provided Documents"
    let dattoFileId: string | null = null;
    try {
      const { data: site } = await supabase.from('sites').select('datto_folder_id, datto_folder_path').eq('id', siteId).single();
      if (site?.datto_folder_id) {
        const targetFolderId = await resolveClientDocsFolderId(site.datto_folder_id);
        const form = new FormData();
        form.append('partData', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName);
        form.append('fileName', fileName);
        form.append('makeUnique', 'true');
        const dattoRes = await fetch(`${BASE_URL}/file/${targetFolderId}/files`, {
          method: 'POST', headers: { Authorization: AUTH_HEADER }, body: form,
        });
        if (dattoRes.ok) {
          const body = await dattoRes.json().catch(() => ({}));
          const d = body.value ?? body;
          dattoFileId = String(d.fileID ?? d.fileId ?? d.id ?? '') || null;
          console.log('[client-upload] Datto API upload ok, fileId:', dattoFileId);
        } else {
          console.error('[client-upload] Datto API upload failed:', dattoRes.status, await dattoRes.text());
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
        file_name: fileName,
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

    // TODO: notify advisor by email when SMTP available

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
