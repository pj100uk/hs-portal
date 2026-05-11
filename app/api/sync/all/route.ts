import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runSyncForSite } from '../lib/sync-site';

export const runtime = 'nodejs';
export const maxDuration = 300;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  // Auth
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const validTokens = [process.env.SYNC_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!validTokens.length || !validTokens.includes(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const host = req.headers.get('host') ?? 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const baseUrl = `${proto}://${host}`;

  // Load all sites that have a Datto folder configured
  const { data: sites, error } = await supabase
    .from('sites')
    .select('id, name')
    .not('datto_folder_id', 'is', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!sites?.length) return NextResponse.json({ sites: [], errors: [] });

  const results: { name: string; processed: number; newPending: number; updated: number; errors: string[] }[] = [];

  // Sequential — one site at a time to avoid Gemini rate limits
  for (const site of sites) {
    console.log(`[sync/all] Starting sync for: ${site.name}`);
    try {
      const summary = await runSyncForSite(site.id, false, baseUrl);
      results.push({ name: site.name, ...summary });
    } catch (err: any) {
      console.error(`[sync/all] ${site.name} failed:`, err.message);
      results.push({ name: site.name, processed: 0, newPending: 0, updated: 0, errors: [err.message] });
    }
  }

  const totalErrors = results.flatMap(r => r.errors);
  return NextResponse.json({ sites: results, errors: totalErrors });
}
