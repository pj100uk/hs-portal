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

  const trigger = token === process.env.CRON_SECRET ? 'cron' : 'manual';
  const startedAt = Date.now();

  const { data: logRow } = await supabase.from('sync_log').insert({
    trigger, sites_attempted: sites.length, started_at: new Date(startedAt).toISOString(),
  }).select('id').single();
  const logId = logRow?.id;

  const results: { name: string; processed: number; newPending: number; updated: number; errors: string[] }[] = [];

  const CONCURRENCY = 5;
  for (let i = 0; i < sites.length; i += CONCURRENCY) {
    const batch = sites.slice(i, i + CONCURRENCY);
    console.log(`[sync/all] Batch ${Math.floor(i / CONCURRENCY) + 1}: ${batch.map(s => s.name).join(', ')}`);
    const settled = await Promise.allSettled(
      batch.map(site => runSyncForSite(site.id, false, baseUrl, undefined, 'ai_suggested')
        .then(summary => ({ name: site.name, ...summary }))
        .catch((err: any) => ({ name: site.name, processed: 0, newPending: 0, updated: 0, errors: [err.message] }))
      )
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
  }

  const totalErrors = results.flatMap(r => r.errors);
  const duration = Math.round((Date.now() - startedAt) / 1000);

  if (logId) {
    await supabase.from('sync_log').update({
      completed_at: new Date().toISOString(),
      sites_processed: results.filter(r => r.errors.length === 0).length,
      new_suggestions: results.reduce((s, r) => s + r.newPending, 0),
      updated: results.reduce((s, r) => s + r.updated, 0),
      duration_seconds: duration,
      errors: totalErrors,
      site_results: results,
    }).eq('id', logId);
  }

  return NextResponse.json({ sites: results, errors: totalErrors });
}
