import { NextResponse } from 'next/server';

const CLIENT_ID = '8768d9f6-7ae5-4c96-a8a7-512e3c957fd0';
const CLIENT_SECRET = '8228393f-1323-4d80-8dbe-e3e87c291158';
const AUTH_HEADER = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

const CANDIDATES = [
  'https://eu.workplace.datto.com/2/api/v1/swagger.json',
  'https://eu.workplace.datto.com/2/api/v1/openapi.json',
  'https://eu.workplace.datto.com/2/api/v1/api-docs',
  'https://eu.workplace.datto.com/openapi/swagger.json',
  'https://eu.workplace.datto.com/openapi/openapi.json',
  'https://eu.workplace.datto.com/api/v1/swagger.json',
];

export async function GET() {
  const url = 'https://eu.workplace.datto.com/2/api/v1/openapi.json';
  const res = await fetch(url, { headers: { Authorization: AUTH_HEADER, Accept: 'application/json' } });
  const text = await res.text();
  let spec: any;
  try { spec = JSON.parse(text); } catch { return NextResponse.json({ error: 'parse failed', raw: text.slice(0, 500) }); }

  const fileId = '1637377337';
  const res2 = await fetch(`https://eu.workplace.datto.com/2/api/v1/file/${fileId}?metadata=abcdefghijklmnopqrstuvwxyz`, {
    headers: { Authorization: AUTH_HEADER, Accept: 'application/json' },
  });
  return NextResponse.json(await res2.json());
}
