import { NextRequest, NextResponse } from 'next/server';

const CLIENT_ID = '8768d9f6-7ae5-4c96-a8a7-512e3c957fd0';
const CLIENT_SECRET = '8228393f-1323-4d80-8dbe-e3e87c291158';
const BASE_URL = 'https://eu.workplace.datto.com/2/api/v1';
const AUTH_HEADER = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');
  const fileName = searchParams.get('fileName') || 'document';
  const forceDownload = searchParams.get('forceDownload') === 'true';

  if (!fileId) {
    return NextResponse.json({ error: 'fileId is required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${BASE_URL}/file/${fileId}/data`, {
      headers: { Authorization: AUTH_HEADER },
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Datto error: ${res.status}`, detail: text }, { status: res.status });
    }

    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const contentTypeMap: Record<string, string> = {
      pdf:  'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      doc:  'application/msword',
      xls:  'application/vnd.ms-excel',
      png:  'image/png',
      jpg:  'image/jpeg',
      jpeg: 'image/jpeg',
      gif:  'image/gif',
      webp: 'image/webp',
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    // PDFs and images open inline unless forceDownload is set
    const inlineable = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
    const disposition = (!forceDownload && inlineable)
      ? `inline; filename="${fileName}"`
      : `attachment; filename="${fileName}"`;

    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Content-Length': buffer.byteLength.toString(),
      },
    });
  } catch (err: any) {
    console.error('Datto file route error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}