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
    const listRes = await fetch(`${BASE_URL}/file/${targetFolderId}/files`, {
      headers: { Authorization: AUTH_HEADER },
      cache: 'no-store',
    });

    if (!listRes.ok) return NextResponse.json({ found: false, reason: 'datto_error' });

    const json = await listRes.json();
    const arr: any[] = Array.isArray(json) ? json : (json.result ?? json.files ?? json.items ?? []);
    const match = arr.find((f: any) => (f.name ?? f.fileName) === doc.file_name);

    if (!match) return NextResponse.json({ found: false, reason: 'not_in_folder' });

    const dattoFileId = String(match.id ?? match.fileId ?? match.fileID ?? '');
    if (!dattoFileId) return NextResponse.json({ found: false, reason: 'no_id' });

    await supabase
      .from('site_documents')
      .update({ datto_file_id: dattoFileId, datto_folder_id: targetFolderId })
      .eq('id', documentId);

    return NextResponse.json({ found: true, dattoFileId });
  } catch (err: any) {
    console.error('[datto-retry]', err);
    return NextResponse.json({ found: false, reason: 'exception' });
  }
}
