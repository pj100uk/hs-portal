import { NextRequest, NextResponse } from 'next/server';
import { BASE_URL, AUTH_HEADER } from '../folder-utils';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { fileId } = await request.json();
    if (!fileId) return NextResponse.json({ error: 'fileId is required' }, { status: 400 });

    const res = await fetch(`${BASE_URL}/file/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: AUTH_HEADER },
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: 'Datto delete failed', detail }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[delete-file] error:', err);
    return NextResponse.json({ error: err.message ?? 'Delete failed' }, { status: 500 });
  }
}
