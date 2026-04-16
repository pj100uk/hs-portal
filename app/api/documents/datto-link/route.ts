import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Busboy from 'busboy';
import { resolveClientDocsFolderId, BASE_URL, AUTH_HEADER } from '../../datto/folder-utils';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DATTO_DRIVE_ROOT = 'W:\\Customer Documents';

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Write file to W: drive and return the Datto file ID by listing the folder via API */
async function writeViaDrive(
  siteFolderPath: string,
  targetFolderId: string,
  fileName: string,
  fileBuffer: Buffer,
): Promise<string | null> {
  const destDir = path.join(DATTO_DRIVE_ROOT, ...siteFolderPath.split('/'), 'Client Provided Documents');
  const destPath = path.join(destDir, fileName);

  // Ensure the folder exists (should already be there from setup-site-folders)
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(destPath, fileBuffer);
  console.log('[datto-link] wrote file to W: drive:', destPath);

  // Poll the Datto API for up to 5s to get the file ID
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const listRes = await fetch(`${BASE_URL}/file/${targetFolderId}/files`, {
        headers: { Authorization: AUTH_HEADER },
        cache: 'no-store',
      });
      if (listRes.ok) {
        const json = await listRes.json();
        const arr: any[] = Array.isArray(json) ? json : (json.result ?? json.files ?? json.items ?? []);
        const match = arr.find((i: any) => (i.name ?? i.fileName) === fileName);
        if (match) {
          const id = String(match.id ?? match.fileId ?? match.fileID ?? '');
          if (id) { console.log('[datto-link] found file ID:', id); return id; }
        }
      }
    } catch { /* retry */ }
    console.log('[datto-link] poll attempt', i + 1, '— file not visible yet');
  }

  console.warn('[datto-link] file not found in Datto listing after 5s — ID will be null');
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    const { fileBuffer, fileName, documentId, oldDattoFileId } =
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
      .select('datto_folder_id, datto_folder_path')
      .eq('id', doc.site_id)
      .single();

    if (!site?.datto_folder_id) {
      return NextResponse.json({ dattoFileId: null, noFolder: true });
    }

    // Resolve the "Client Provided Documents" subfolder ID (find by name, don't create via API)
    const targetFolderId = await resolveClientDocsFolderId(site.datto_folder_id);

    // If replacing an existing file — rename old version with v(n) date suffix via W: drive
    if (oldDattoFileId) {
      try {
        const metaRes = await fetch(`${BASE_URL}/file/${oldDattoFileId}`, {
          headers: { Authorization: AUTH_HEADER },
          cache: 'no-store',
        });
        const oldName: string = metaRes.ok ? ((await metaRes.json()).name ?? fileName) : fileName;

        // Determine next version number from folder listing
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

        // Rename via W: drive
        if (site.datto_folder_path) {
          const dir = path.join(DATTO_DRIVE_ROOT, ...site.datto_folder_path.split('/'), 'Client Provided Documents');
          const oldPath = path.join(dir, oldName);
          const newPath = path.join(dir, archivedName);
          if (fs.existsSync(oldPath)) {
            fs.renameSync(oldPath, newPath);
            console.log('[datto-link] renamed old file:', oldName, '→', archivedName);
          } else {
            // Fallback: rename via Datto API PATCH
            await fetch(`${BASE_URL}/file/${oldDattoFileId}?name=${encodeURIComponent(archivedName)}`, {
              method: 'PATCH',
              headers: { Authorization: AUTH_HEADER },
            });
          }
        }
      } catch (err) {
        console.error('[datto-link] version rename failed:', err);
        // Non-fatal — continue with upload
      }
    }

    // Write new file via W: drive, get Datto file ID
    let dattoFileId: string | null = null;
    if (site.datto_folder_path) {
      dattoFileId = await writeViaDrive(site.datto_folder_path, targetFolderId, fileName, fileBuffer);
    } else {
      console.warn('[datto-link] no datto_folder_path on site — cannot write via W: drive');
    }

    // Update Supabase record
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
