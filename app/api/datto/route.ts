import { NextRequest, NextResponse } from 'next/server';

const CLIENT_ID = '8768d9f6-7ae5-4c96-a8a7-512e3c957fd0';
const CLIENT_SECRET = '8228393f-1323-4d80-8dbe-e3e87c291158';
const BASE_URL = 'https://eu.workplace.datto.com/2/api/v1';

const AUTH_HEADER = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get('folderId');

  if (!folderId) {
    return NextResponse.json({ error: 'folderId is required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${BASE_URL}/file/${folderId}/files`, {
      headers: {
        Authorization: AUTH_HEADER,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('Datto API error:', res.status, text);
      return NextResponse.json(
        { error: `Datto API error: ${res.status}`, detail: text },
        { status: res.status }
      );
    }

    const data = await res.json();

    const items = (data.result || []).map((item: any) => ({
      id: String(item.id),
      name: item.name,
      type: item.folder ? 'folder' : 'file',
    }));

    return NextResponse.json(items);
  } catch (err: any) {
    console.error('Datto route error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}