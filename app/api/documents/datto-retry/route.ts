import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveClientDocsFolderId, BASE_URL, AUTH_HEADER } from '../../datto/folder-utils';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  const { documentId } = await req.json().catch(() => ({}));
  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });

  const { data: doc } = await supabase
    .from('site_documents')
    .select('id, file_name, site_id, datto_file_id')
    .eq('id', documentId)
    .single();

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (doc.datto_file_id) return NextResponse.json({ found: true, dattoFileId: doc.datto_file_id });

  const { data: site } = await supabase
    .from('sites')
    .select('datto_folder_id')
    .eq('id', doc.site_id)
    .single();

  if (!site?.datto_folder_id) {
    return NextResponse.json({ found: false, reason: 'no_folder' });
  }

  const targetFolderId = await resolveClientDocsFolderId(site.datto_folder_id);

  try {
    // 1. Check if the file already exists in Datto (e.g. uploaded but ID not saved)
    const listCtrl = new AbortController();
    const listTimer = setTimeout(() => listCtrl.abort(), 10_000);
    let listRes: Response | null = null;
    try {
      listRes = await fetch(`${BASE_URL}/file/${targetFolderId}/files`, {
        headers: { Authorization: AUTH_HEADER },
        cache: 'no-store',
        signal: listCtrl.signal,
      });
    } catch { /* timeout or network error — fall through to re-upload */ }
    clearTimeout(listTimer);
    if (listRes?.ok) {
      const json = await listRes.json();
      const arr: any[] = Array.isArray(json) ? json : (json.result ?? json.files ?? json.items ?? []);
      const match = arr.find((f: any) => (f.name ?? f.fileName) === doc.file_name);
      if (match) {
        const dattoFileId = String(match.id ?? match.fileId ?? match.fileID ?? '');
        if (dattoFileId) {
          await supabase.from('site_documents').update({ datto_file_id: dattoFileId, datto_folder_id: targetFolderId }).eq('id', documentId);
          return NextResponse.json({ found: true, dattoFileId });
        }
      }
    }

    // 2. File not in Datto — re-upload from Supabase Storage
    const storagePath = `${doc.id}/${doc.file_name}`;
    const { data: fileBlob, error: dlErr } = await supabase.storage.from('client-uploads').download(storagePath);
    if (dlErr || !fileBlob) return NextResponse.json({ found: false, reason: 'storage_missing' });

    const fileBuffer = Buffer.from(await fileBlob.arrayBuffer());
    const mimeType = fileBlob.type || 'application/octet-stream';

    const form = new FormData();
    form.append('partData', new Blob([fileBuffer], { type: mimeType }), doc.file_name);
    form.append('fileName', doc.file_name);
    form.append('makeUnique', 'false');
    const uploadRes = await fetch(`${BASE_URL}/file/${targetFolderId}/files`, {
      method: 'POST', headers: { Authorization: AUTH_HEADER }, body: form,
    });
    if (!uploadRes.ok) {
      console.error('[datto-retry] API upload failed:', uploadRes.status, await uploadRes.text());
      return NextResponse.json({ found: false, reason: 'upload_failed' });
    }
    const uploadBody = await uploadRes.json().catch(() => ({}));
    const ud = uploadBody.value ?? uploadBody;
    const dattoFileId = String(ud.fileID ?? ud.fileId ?? ud.id ?? '') || null;

    if (!dattoFileId) return NextResponse.json({ found: false, reason: 'no_id_after_upload' });

    await supabase.from('site_documents').update({ datto_file_id: dattoFileId, datto_folder_id: targetFolderId }).eq('id', documentId);
    return NextResponse.json({ found: true, dattoFileId, reuploaded: true });
  } catch (err: any) {
    console.error('[datto-retry]', err);
    return NextResponse.json({ found: false, reason: 'exception' });
  }
}
