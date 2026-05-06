import { NextRequest, NextResponse } from 'next/server';
import { BASE_URL, AUTH_HEADER } from '../folder-utils';

export const runtime = 'nodejs';

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

// Walk relSegments into startFolderId, fuzzy-matching (strips leading numeric prefixes) or creating each subfolder.
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
    // 409 or missing ID — re-list
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

    // Archive name: strip trailing spaces from base, append arc + date
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    const baseName = fileName.slice(0, fileName.length - ext.length).trimEnd();
    const today = new Date().toISOString().slice(0, 10);
    const archiveName = `${baseName} arc${today}${ext}`;

    // Find or create Z-Archived Documents at site root level
    const zArchive = await findOrCreateZArchive(siteFolderId);
    if (!zArchive) {
      return NextResponse.json({ error: 'Could not find or create Z-Archived Documents folder' }, { status: 500 });
    }

    // Derive relative path from site root to source folder so we mirror the structure inside Z-Archive
    let relSegments: string[] = [];
    if (sourceFolderPath && siteFolderPath) {
      const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/$/, '');
      const rel = norm(sourceFolderPath).replace(norm(siteFolderPath), '').replace(/^\//, '');
      relSegments = rel ? rel.split('/').filter(Boolean) : [];
    }

    const targetFolderId = relSegments.length > 0
      ? await resolveArchiveFolderPath(zArchive.id, relSegments)
      : zArchive.id;

    // Download original from Datto
    const downloadRes = await fetch(`${BASE_URL}/file/${fileId}/data`, {
      headers: { Authorization: AUTH_HEADER },
    });
    if (!downloadRes.ok) {
      return NextResponse.json({ error: 'Failed to download file from Datto' }, { status: 502 });
    }
    const fileBuffer = await downloadRes.arrayBuffer();

    const mimeType = ext.toLowerCase() === '.docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : ext.toLowerCase() === '.doc' ? 'application/msword'
      : 'application/octet-stream';

    // Upload to archive folder
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

    // Delete original
    await fetch(`${BASE_URL}/file/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: AUTH_HEADER },
    });

    const targetPath = [zArchive.name, ...relSegments, archiveName].join('/');

    return NextResponse.json({ success: true, archivedFileId, archivedFileName: archiveName, targetPath });
  } catch (err: any) {
    console.error('[archive-document] error:', err);
    return NextResponse.json({ error: err.message ?? 'Archive failed' }, { status: 500 });
  }
}
