import { NextRequest, NextResponse } from 'next/server';
import { BASE_URL, AUTH_HEADER } from '../folder-utils';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { archivedFileId, originalFolderId, originalFileName } = await request.json();
    if (!archivedFileId || !originalFolderId || !originalFileName) {
      return NextResponse.json({ error: 'archivedFileId, originalFolderId, and originalFileName are required' }, { status: 400 });
    }

    // Download archived file from Datto
    const downloadRes = await fetch(`${BASE_URL}/file/${archivedFileId}/data`, {
      headers: { Authorization: AUTH_HEADER },
    });
    if (!downloadRes.ok) {
      return NextResponse.json({ error: 'Archived file not found in Datto' }, { status: 404 });
    }
    const fileBuffer = await downloadRes.arrayBuffer();

    const ext = originalFileName.includes('.') ? originalFileName.slice(originalFileName.lastIndexOf('.')).toLowerCase() : '';
    const mimeType = ext === '.docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : ext === '.doc' ? 'application/msword'
      : 'application/octet-stream';

    // Upload back to original folder
    const form = new FormData();
    form.append('partData', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), originalFileName);
    form.append('fileName', originalFileName);
    form.append('makeUnique', 'false');

    const uploadRes = await fetch(`${BASE_URL}/file/${originalFolderId}/files`, {
      method: 'POST',
      headers: { Authorization: AUTH_HEADER },
      body: form,
    });
    if (!uploadRes.ok) {
      const detail = await uploadRes.text();
      return NextResponse.json({ error: 'Restore upload failed', detail }, { status: 502 });
    }

    // Delete the archived copy
    await fetch(`${BASE_URL}/file/${archivedFileId}`, {
      method: 'DELETE',
      headers: { Authorization: AUTH_HEADER },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[unarchive-document] error:', err);
    return NextResponse.json({ error: err.message ?? 'Unarchive failed' }, { status: 500 });
  }
}
