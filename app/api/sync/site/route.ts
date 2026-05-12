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
  if (!token) return new Response('Unauthorized', { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return new Response('Unauthorized', { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || !['advisor', 'superadmin'].includes(profile.role)) {
    return new Response('Forbidden', { status: 403 });
  }

  let siteId: string; let forceAll = false;
  try {
    const body = await req.json();
    siteId = body.siteId;
    forceAll = !!body.forceAll;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!siteId) return new Response('siteId required', { status: 400 });

  if (profile.role !== 'superadmin') {
    const { data: site } = await supabase.from('sites').select('organisation_id, advisor_id').eq('id', siteId).single();
    if (!site) return new Response('Site not found', { status: 404 });

    const [{ data: siteAssign }, { data: orgAssign }] = await Promise.all([
      supabase.from('advisor_site_assignments').select('id').eq('advisor_id', user.id).eq('site_id', siteId).maybeSingle(),
      site.organisation_id
        ? supabase.from('advisor_organisations').select('id').eq('advisor_id', user.id).eq('organisation_id', site.organisation_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const isDirectAdvisor = site.advisor_id === user.id;
    if (!siteAssign && !orgAssign && !isDirectAdvisor) {
      return new Response('Forbidden', { status: 403 });
    }
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
      await runSyncForSite(siteId, forceAll, baseUrl, write, 'ai_suggested');
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
