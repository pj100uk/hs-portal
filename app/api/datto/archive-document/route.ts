import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { BASE_URL, AUTH_HEADER } from '../folder-utils';

export const runtime = 'nodejs';

const DATTO_DRIVE_ROOT = 'W:\\Customer Documents';

function normalizeSegment(s: string): string {
  return s.replace(/^\d+[\.\s]+/, '').trim().toLowerCase();
}

function extractId(item: any): string | null {
  const d = item?.value ?? item;
  const raw = d?.id ?? d?.fileId ?? d?.folderId ?? d?.fileID ?? d?.folderID;
  return raw != null ? String(raw) : null;
}

function isFolder(item: any): boolean {
  return item.type === 'folder' || item.type === 'FOLDER' || item.isDirectory === true
    || item.folderType !== undefined || item.childCount !== undefined || item.folder === true;
}

function toArr(raw: any): any[] {
  return Array.isArray(raw) ? raw : (raw?.result ?? raw?.files ?? raw?.items ?? raw?.data ?? []);
}

async function listChildren(folderId: string): Promise<any[]> {
  const res = await fetch(`${BASE_URL}/file/${folderId}/files`, {
    headers: { Authorization: AUTH_HEADER },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return toArr(await res.json());
}

async function findOrCreateZArchive(siteFolderId: string): Promise<{ id: string; name: string } | null> {
  const children = await listChildren(siteFolderId);
  const match = children.find(i => {
    if (!isFolder(i)) return false;
    const n = (i.name ?? i.folderName ?? '').toLowerCase();
    return n.startsWith('z-archiv') || n.startsWith('z archiv');
  });
  if (match) return { id: extractId(match)!, name: match.name ?? match.folderName };

  const createRes = await fetch(`${BASE_URL}/file/${siteFolderId}?name=${encodeURIComponent('Z-Archived Documents')}`, {
    method: 'POST',
    headers: { Authorization: AUTH_HEADER },
  });
  if (!createRes.ok) return null;
  let body: any = {};
  try { body = await createRes.json(); } catch { /* non-JSON */ }
  const newId = extractId(body);
  if (newId) return { id: newId, name: 'Z-Archived Documents' };
  const retry = await listChildren(siteFolderId);
  const found = retry.find(i => isFolder(i) && (i.name ?? '').toLowerCase().startsWith('z-archiv'));
  return found ? { id: extractId(found)!, name: found.name } : null;
}

async function resolveArchiveFolderPath(startFolderId: string, relSegments: string[]): Promise<string> {
  let currentId = startFolderId;
  for (const seg of relSegments) {
    const children = await listChildren(currentId);
    const norm = normalizeSegment(seg);
    const match = children.find(i => isFolder(i) && normalizeSegment(i.name ?? i.folderName ?? '') === norm);
    if (match) { currentId = extractId(match)!; continue; }

    const createRes = await fetch(`${BASE_URL}/file/${currentId}?name=${encodeURIComponent(seg)}`, {
      method: 'POST',
      headers: { Authorization: AUTH_HEADER },
    });
    let createBody: any = {};
    try { createBody = await createRes.json(); } catch { /* non-JSON */ }
    const newId = extractId(createBody);
    if (newId) { currentId = newId; continue; }
    const retry = await listChildren(currentId);
    const retryMatch = retry.find(i => isFolder(i) && (i.name ?? '').toLowerCase() === seg.toLowerCase());
    if (retryMatch) { currentId = extractId(retryMatch)!; continue; }
    throw new Error(`Failed to create archive subfolder: ${seg}`);
  }
  return currentId;
}

export async function POST(request: NextRequest) {
  try {
    const { fileId, fileName, sourceFolderId, siteFolderId, siteFolderPath, sourceFolderPath } = await request.json();

    if (!fileId || !fileName || !siteFolderId) {
      return NextResponse.json({ error: 'fileId, fileName and siteFolderId are required' }, { status: 400 });
    }

    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    const baseName = fileName.slice(0, fileName.length - ext.length).trimEnd();
    const today = new Date().toISOString().slice(0, 10);
    const archiveName = `${baseName} Archived-${today}${ext}`;

    // Derive relative path from site root to source folder
    let relSegments: string[] = [];
    if (sourceFolderPath && siteFolderPath) {
      const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/$/, '');
      const rel = norm(sourceFolderPath).replace(norm(siteFolderPath), '').replace(/^\//, '');
      relSegments = rel ? rel.split('/').filter(Boolean) : [];
    }

    const targetPath = ['Z-Archived Documents', ...relSegments, archiveName].join('/');

    // 1. Try W: drive first — direct filesystem move
    if (sourceFolderPath) {
      try {
        const sourceFile = path.join(DATTO_DRIVE_ROOT, ...sourceFolderPath.split('/').filter(Boolean), fileName);
        console.log('[archive-document] W: drive probe:', sourceFile, '| exists:', fs.existsSync(sourceFile));
        if (fs.existsSync(sourceFile)) {
          let targetDir: string;
          if (siteFolderPath) {
            // Ideal: Z-Archive at site root level, preserving subfolder structure
            const zArchiveBase = path.join(DATTO_DRIVE_ROOT, ...siteFolderPath.split('/').filter(Boolean), 'Z-Archived Documents');
            targetDir = relSegments.length > 0 ? path.join(zArchiveBase, ...relSegments) : zArchiveBase;
          } else {
            // Fallback: Z-Archive alongside source folder (siteFolderPath not configured)
            targetDir = path.join(DATTO_DRIVE_ROOT, ...sourceFolderPath.split('/').filter(Boolean), 'Z-Archived Documents');
          }
          fs.mkdirSync(targetDir, { recursive: true });
          const targetFile = path.join(targetDir, archiveName);
          fs.renameSync(sourceFile, targetFile);
          console.log('[archive-document] moved via W: drive:', sourceFile, '->', targetFile);
          return NextResponse.json({ success: true, archivedFileId: null, archivedFileName: archiveName, targetPath, wdrivePath: targetFile, via: 'wdrive' });
        }
      } catch (fsErr: any) {
        console.warn('[archive-document] W: drive move failed, falling back to API:', fsErr.message, fsErr.code ?? '');
      }
    } else {
      console.warn('[archive-document] sourceFolderPath is empty — skipping W: drive');
    }

    // 2. Fall back to Datto API
    const zArchive = await findOrCreateZArchive(siteFolderId);
    if (!zArchive) {
      return NextResponse.json({ error: 'Could not find or create Z-Archived Documents folder' }, { status: 500 });
    }

    const targetFolderId = relSegments.length > 0
      ? await resolveArchiveFolderPath(zArchive.id, relSegments)
      : zArchive.id;

    const downloadRes = await fetch(`${BASE_URL}/file/${fileId}/data`, { headers: { Authorization: AUTH_HEADER } });
    if (!downloadRes.ok) {
      return NextResponse.json({ error: 'Failed to download file from Datto' }, { status: 502 });
    }
    const fileBuffer = await downloadRes.arrayBuffer();
    if (fileBuffer.byteLength < 100) {
      return NextResponse.json({ error: 'Source file appears corrupt or empty in Datto', detail: `File size: ${fileBuffer.byteLength} bytes` }, { status: 422 });
    }

    const mimeType = ext.toLowerCase() === '.docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : ext.toLowerCase() === '.doc' ? 'application/msword'
      : 'application/octet-stream';

    const form = new FormData();
    form.append('partData', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), archiveName);
    form.append('fileName', archiveName);
    form.append('makeUnique', 'false');

    const uploadRes = await fetch(`${BASE_URL}/file/${targetFolderId}/files`, {
      method: 'POST',
      headers: { Authorization: AUTH_HEADER },
      body: form,
    });
    const uploadBody = await uploadRes.text();
    if (!uploadRes.ok) {
      return NextResponse.json({ error: 'Archive upload failed', detail: uploadBody }, { status: 502 });
    }

    let archivedFileId: string | null = null;
    try {
      const j = JSON.parse(uploadBody);
      const d = j.value ?? j;
      archivedFileId = String(d.fileID ?? d.fileId ?? d.id ?? '') || null;
    } catch { /* non-JSON */ }

    await fetch(`${BASE_URL}/file/${fileId}`, { method: 'DELETE', headers: { Authorization: AUTH_HEADER } });

    return NextResponse.json({ success: true, archivedFileId, archivedFileName: archiveName, targetPath });
  } catch (err: any) {
    console.error('[archive-document] error:', err);
    return NextResponse.json({ error: err.message ?? 'Archive failed' }, { status: 500 });
  }
}
