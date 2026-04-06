import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Busboy from 'busboy';
import { resolveClientDocsFolderId, BASE_URL, AUTH_HEADER } from '../../datto/folder-utils';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    const { fileBuffer, fileName, mimeType, documentId, oldDattoFileId } =
      await parseMultipart(request, contentType);

    if (!fileBuffer || !fileName) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
    }

    // Look up site via documentId
    const { data: doc } = await supabase
      .from('site_documents')
      .select('site_id')
      .eq('id', documentId)
      .single();

    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const { data: site } = await supabase
      .from('sites')
      .select('datto_folder_id')
      .eq('id', doc.site_id)
      .single();

    if (!site?.datto_folder_id) {
      return NextResponse.json({ dattoFileId: null, noFolder: true });
    }

    // Resolve or create "Client Provided Documents" subfolder
    const targetFolderId = await resolveClientDocsFolderId(site.datto_folder_id);

    // If a previous version exists, rename it to v(n) dd-mm-yy before uploading new
    if (oldDattoFileId) {
      try {
        // Get old file's current name
        const metaRes = await fetch(`${BASE_URL}/file/${oldDattoFileId}`, {
          headers: { Authorization: AUTH_HEADER },
          cache: 'no-store',
        });
        const oldName: string = metaRes.ok
          ? ((await metaRes.json()).name ?? fileName)
          : fileName;

        // Scan folder to determine next version number
        let versionNum = 1;
        try {
          const listRes = await fetch(`${BASE_URL}/file/${targetFolderId}/files`, {
            headers: { Authorization: AUTH_HEADER },
            cache: 'no-store',
          });
          if (listRes.ok) {
            const json = await listRes.json();
            const arr: any[] = Array.isArray(json) ? json : (json.result ?? json.files ?? json.items ?? []);
            const baseName = oldName.replace(/\.[^.]+$/, '');
            const versionRegex = new RegExp(`^${escapeRegex(baseName)} v(\\d+)`, 'i');
            const maxV = arr.reduce((max: number, item: any) => {
              const match = (item.name ?? '').match(versionRegex);
              return match ? Math.max(max, parseInt(match[1], 10)) : max;
            }, 0);
            versionNum = maxV + 1;
          }
        } catch { /* default to v1 */ }

        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yy = String(now.getFullYear()).slice(2);
        const dotIndex = oldName.lastIndexOf('.');
        const archivedName = dotIndex !== -1
          ? `${oldName.slice(0, dotIndex)} v${versionNum} ${dd}-${mm}-${yy}${oldName.slice(dotIndex)}`
          : `${oldName} v${versionNum} ${dd}-${mm}-${yy}`;

        await fetch(`${BASE_URL}/file/${oldDattoFileId}?name=${encodeURIComponent(archivedName)}`, {
          method: 'PATCH',
          headers: { Authorization: AUTH_HEADER },
        });
      } catch (err) {
        console.error('[datto-link] version rename failed:', err);
        // Non-fatal — continue with upload
      }
    }

    // Upload new file with original name
    const form = new FormData();
    form.append('partData', new Blob([new Uint8Array(fileBuffer)], { type: mimeType ?? 'application/octet-stream' }), fileName);
    form.append('fileName', fileName);
    form.append('makeUnique', 'false');

    const uploadRes = await fetch(`${BASE_URL}/file/${targetFolderId}/files`, {
      method: 'POST',
      headers: { Authorization: AUTH_HEADER },
      body: form,
    });

    let dattoFileId: string | null = null;
    if (uploadRes.ok) {
      const uploaded = await uploadRes.json();
      const raw = uploaded.value ?? uploaded.result ?? uploaded;
      dattoFileId = String(raw.fileID ?? raw.id ?? raw.fileId ?? '') || null;
    } else {
      const detail = await uploadRes.text();
      console.error('[datto-link] Datto upload failed:', detail);
    }

    // Update Supabase record with Datto file info
    await supabase
      .from('site_documents')
      .update({ datto_file_id: dattoFileId, datto_folder_id: targetFolderId })
      .eq('id', documentId);

    return NextResponse.json({ dattoFileId });
  } catch (err: any) {
    console.error('[datto-link] error:', err);
    return NextResponse.json({ error: err.message ?? 'Datto link failed' }, { status: 500 });
  }
}

function parseMultipart(request: NextRequest, contentType: string): Promise<{
  fileBuffer: Buffer | null;
  fileName: string;
  mimeType: string;
  documentId: string;
  oldDattoFileId: string;
}> {
  return new Promise(async (resolve, reject) => {
    const bb = Busboy({ headers: { 'content-type': contentType } });
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let fileMime = '';
    let documentId = '';
    let oldDattoFileId = '';
    const chunks: Buffer[] = [];

    bb.on('file', (_field: string, stream: any, info: { filename: string; mimeType: string }) => {
      fileName = info.filename;
      fileMime = info.mimeType;
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
    });

    bb.on('field', (name: string, val: string) => {
      if (name === 'documentId') documentId = val;
      if (name === 'oldDattoFileId') oldDattoFileId = val;
    });

    bb.on('finish', () => resolve({ fileBuffer, fileName, mimeType: fileMime, documentId, oldDattoFileId }));
    bb.on('error', reject);

    const body = await request.arrayBuffer();
    bb.write(Buffer.from(body));
    bb.end();
  });
}
