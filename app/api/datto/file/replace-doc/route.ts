import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { BASE_URL, AUTH_HEADER } from '../../folder-utils';
import Busboy from 'busboy';
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

function vaultFolderPath(siteFolderPath: string) {
  const parts = siteFolderPath.split('/');
  const manualName = parts[parts.length - 1];
  const siteName = manualName.replace(/\s*H&S Manual\s*$/i, '').trim();
  return path.join(DATTO_DRIVE_ROOT, ...parts.slice(0, -1), 'Vault', siteName);
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? '';
    const { docxBuffer, docxName, docFileId, docName, parentFolderId, folderPath, siteId } =
      await parseMultipart(req, contentType);

    if (!docxBuffer || !docxName || !docFileId || !parentFolderId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data: site } = siteId
      ? await supabase.from('sites').select('datto_folder_path').eq('id', siteId).single()
      : { data: null };

    // Determine version number by listing the parent folder
    const dotIndex = docName.lastIndexOf('.');
    const baseName = dotIndex !== -1 ? docName.slice(0, dotIndex) : docName;
    const ext = dotIndex !== -1 ? docName.slice(dotIndex) : '';
    let versionNum = 1;
    try {
      const listRes = await fetch(`${BASE_URL}/file/${parentFolderId}/files`, {
        headers: { Authorization: AUTH_HEADER },
        cache: 'no-store',
      });
      if (listRes.ok) {
        const json = await listRes.json();
        const arr: any[] = Array.isArray(json) ? json : (json.result ?? json.files ?? json.items ?? []);
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
    const archivedName = `${baseName} v${versionNum} ${dd}-${mm}-${yy}${ext}`;

    // Archive the .doc — try W: drive vault move first, then PATCH rename fallback
    let archived = false;
    if (site?.datto_folder_path) {
      try {
        const subPath = folderPath ? folderPath.split('/').filter(Boolean) : [];
        const srcPath = path.join(DATTO_DRIVE_ROOT, ...site.datto_folder_path.split('/'), ...subPath, docName);
        if (fs.existsSync(srcPath)) {
          const vaultDir = vaultFolderPath(site.datto_folder_path);
          fs.mkdirSync(vaultDir, { recursive: true });
          fs.renameSync(srcPath, path.join(vaultDir, archivedName));
          archived = true;
          console.log('[replace-doc] moved .doc to vault:', archivedName);
        }
      } catch (e) {
        console.warn('[replace-doc] W: drive vault move failed:', e);
      }
    }

    if (!archived) {
      await fetch(`${BASE_URL}/file/${docFileId}?name=${encodeURIComponent(archivedName)}`, {
        method: 'PATCH',
        headers: { Authorization: AUTH_HEADER },
      });
      console.log('[replace-doc] renamed .doc via Datto PATCH:', archivedName);
    }

    // Upload the .docx to the same folder
    const form = new FormData();
    form.append('partData', new Blob([new Uint8Array(docxBuffer)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }), docxName);
    form.append('fileName', docxName);
    form.append('makeUnique', 'false');

    const uploadRes = await fetch(`${BASE_URL}/file/${parentFolderId}/files`, {
      method: 'POST',
      headers: { Authorization: AUTH_HEADER },
      body: form,
    });

    if (!uploadRes.ok) {
      const detail = await uploadRes.text();
      return NextResponse.json({ error: 'Datto upload failed', detail }, { status: 502 });
    }

    const uploadJson = await uploadRes.json().catch(() => ({}));
    const docxDattoFileId = uploadJson?.id ?? uploadJson?.fileId ?? null;

    return NextResponse.json({ docxDattoFileId, archived });
  } catch (e: any) {
    console.error('[replace-doc] error:', e);
    return NextResponse.json({ error: e.message || 'Replace-doc failed' }, { status: 500 });
  }
}

function parseMultipart(req: NextRequest, contentType: string): Promise<{
  docxBuffer: Buffer | null;
  docxName: string;
  docFileId: string;
  docName: string;
  parentFolderId: string;
  folderPath: string;
  siteId: string;
}> {
  return new Promise(async (resolve, reject) => {
    const bb = Busboy({ headers: { 'content-type': contentType } });
    let docxBuffer: Buffer | null = null;
    let docxName = '';
    let docFileId = '';
    let docName = '';
    let parentFolderId = '';
    let folderPath = '';
    let siteId = '';
    const chunks: Buffer[] = [];

    bb.on('file', (_field: string, stream: any, info: { filename: string }) => {
      docxName = info.filename;
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => { docxBuffer = Buffer.concat(chunks); });
    });

    bb.on('field', (name: string, val: string) => {
      if (name === 'docFileId') docFileId = val;
      if (name === 'docName') docName = val;
      if (name === 'parentFolderId') parentFolderId = val;
      if (name === 'folderPath') folderPath = val;
      if (name === 'siteId') siteId = val;
    });

    bb.on('finish', () => resolve({ docxBuffer, docxName, docFileId, docName, parentFolderId, folderPath, siteId }));
    bb.on('error', reject);

    const body = await req.arrayBuffer();
    bb.write(Buffer.from(body));
    bb.end();
  });
}
