import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runSyncForSite, SyncEvent } from '../lib/sync-site';

export const runtime = 'nodejs';
export const maxDuration = 300;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const validTokens = [process.env.SYNC_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!validTokens.length || !validTokens.includes(token)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const host = req.headers.get('host') ?? 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const baseUrl = `${proto}://${host}`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const write = (event: SyncEvent) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch { /* closed */ }
      };

      const { data: sites } = await supabase
        .from('sites')
        .select('id, name')
        .not('datto_folder_id', 'is', null);

      if (!sites?.length) { controller.close(); return; }

      let totalProcessed = 0; let totalNewPending = 0; let totalUpdated = 0;

      for (const site of sites) {
        const result = await runSyncForSite(site.id, false, baseUrl, write);
        totalProcessed += result.processed;
        totalNewPending += result.newPending;
        totalUpdated += result.updated;
      }

      write({ type: 'site_done', siteName: '__all__', processed: totalProcessed, newPending: totalNewPending, updated: totalUpdated, errors: [] });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    },
  });
}
