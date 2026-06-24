import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Busboy from 'busboy';
import { resolveClientDocsFolderId, BASE_URL, AUTH_HEADER } from '../../datto/folder-utils';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';
  const { documentId, fileBuffer, fileName, mimeType } = await parseMultipart(req, contentType);

  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
  if (!fileBuffer || !fileName) return NextResponse.json({ error: 'file required' }, { status: 400 });

  const { data: doc } = await supabase
    .from('site_documents')
    .select('id, file_name, site_id')
    .eq('id', documentId)
    .single();
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

  const { data: site } = await supabase
    .from('sites')
    .select('datto_folder_id, datto_folder_path')
    .eq('id', doc.site_id)
    .single();
  if (!site?.datto_folder_id) return NextResponse.json({ error: 'No Datto folder configured' }, { status: 422 });

  const targetFolderId = await resolveClientDocsFolderId(site.datto_folder_id);

  const form = new FormData();
  form.append('partData', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName);
  form.append('fileName', fileName);
  form.append('makeUnique', 'false');
  const uploadRes = await fetch(`${BASE_URL}/file/${targetFolderId}/files`, {
    method: 'POST', headers: { Authorization: AUTH_HEADER }, body: form,
  });
  if (!uploadRes.ok) return NextResponse.json({ error: 'Datto upload failed' }, { status: 500 });
  const body = await uploadRes.json().catch(() => ({}));
  const d = body.value ?? body;
  const dattoFileId = String(d.fileID ?? d.fileId ?? d.id ?? '') || null;

  if (!dattoFileId) return NextResponse.json({ error: 'Could not get Datto file ID after upload' }, { status: 500 });

  // Update Supabase Storage copy
  await supabase.storage.from('client-uploads').upload(`${documentId}/${fileName}`, fileBuffer, { contentType: mimeType, upsert: true });

  await supabase.from('site_documents').update({ datto_file_id: dattoFileId, datto_folder_id: targetFolderId, file_name: fileName }).eq('id', documentId);

  return NextResponse.json({ dattoFileId });
}

function parseMultipart(request: NextRequest, contentType: string): Promise<{
  documentId: string; fileBuffer: Buffer | null; fileName: string; mimeType: string;
}> {
  return new Promise(async (resolve, reject) => {
    const bb = Busboy({ headers: { 'content-type': contentType } });
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let mimeType = '';
    let documentId = '';
    const chunks: Buffer[] = [];

    bb.on('file', (_field: string, stream: any, info: { filename: string; mimeType: string }) => {
      fileName = info.filename;
      mimeType = info.mimeType;
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
    });
    bb.on('field', (name: string, val: string) => { if (name === 'documentId') documentId = val; });
    bb.on('finish', () => resolve({ documentId, fileBuffer, fileName, mimeType }));
    bb.on('error', reject);

    const body = await request.arrayBuffer();
    bb.write(Buffer.from(body));
    bb.end();
  });
}
