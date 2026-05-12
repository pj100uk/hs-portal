import { NextRequest, NextResponse } from 'next/server';
import { runSyncForSite } from '../lib/sync-site';

export const runtime = 'nodejs';
export const maxDuration = 300;

function siteBaseUrl(req: NextRequest): string {
  const host = req.headers.get('host') ?? 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const validTokens = [process.env.SYNC_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!validTokens.length || !validTokens.includes(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let siteId: string; let forceAll = false;
  try {
    const body = await req.json();
    siteId = body.siteId;
    forceAll = !!body.forceAll;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 });

  const summary = await runSyncForSite(siteId, forceAll, siteBaseUrl(req), undefined, 'ai_suggested');
  return NextResponse.json(summary);
}
