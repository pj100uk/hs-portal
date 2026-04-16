import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const DATTO_BASE = 'https://eu.workplace.datto.com/2/api/v1';
const DATTO_CLIENT_ID = '8768d9f6-7ae5-4c96-a8a7-512e3c957fd0';
const DATTO_CLIENT_SECRET = '8228393f-1323-4d80-8dbe-e3e87c291158';
const DATTO_AUTH = 'Basic ' + Buffer.from(`${DATTO_CLIENT_ID}:${DATTO_CLIENT_SECRET}`).toString('base64');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
};

// GET /api/storage/file?docId=<site_documents.id>
// Resolves the file from Datto (if datto_file_id set) or Supabase Storage (portal-only),
// and serves it directly. Used by the viewer for client document access.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const docId = searchParams.get('docId');
  const forceDownload = searchParams.get('download') === '1';

  if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 });

  const { data: doc, error: docErr } = await supabase
    .from('site_documents')
    .select('file_name, datto_file_id')
    .eq('id', docId)
    .single();

  if (docErr || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

  const ext = doc.file_name.split('.').pop()?.toLowerCase() || '';
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

  // Prefer Datto if file ID is available
  if (doc.datto_file_id) {
    const dattoRes = await fetch(`${DATTO_BASE}/file/${doc.datto_file_id}/data`, {
      headers: { Authorization: DATTO_AUTH },
    });
    if (!dattoRes.ok) return NextResponse.json({ error: `Datto fetch failed: ${dattoRes.status}` }, { status: 502 });
    const buffer = await dattoRes.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `${forceDownload ? 'attachment' : 'inline'}; filename="${doc.file_name}"`,
      },
    });
  }

  // Fallback: Supabase Storage (portal-only uploads)
  const storagePath = `${docId}/${doc.file_name}`;
  const { data: storageData, error: storageErr } = await supabase.storage
    .from('client-uploads')
    .download(storagePath);

  if (storageErr || !storageData) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const arrayBuffer = await storageData.arrayBuffer();
  return new NextResponse(arrayBuffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${forceDownload ? 'attachment' : 'inline'}; filename="${doc.file_name}"`,
    },
  });
}
