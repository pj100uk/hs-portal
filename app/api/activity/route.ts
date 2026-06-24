import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const siteId   = searchParams.get('siteId');
  const userId   = searchParams.get('userId');
  const callerId = searchParams.get('callerId');
  const format   = searchParams.get('format'); // 'csv' for export

  if (!siteId && !userId) {
    return NextResponse.json({ error: 'siteId or userId required' }, { status: 400 });
  }
  if (!callerId) {
    return NextResponse.json({ error: 'callerId required' }, { status: 400 });
  }

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .single();

  if (!callerProfile || (callerProfile.role !== 'advisor' && callerProfile.role !== 'superadmin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let query = supabase
    .from('activity_log')
    .select('id, created_at, user_id, site_id, organisation_id, action, resource_type, resource_id, resource_name, metadata')
    .order('created_at', { ascending: false })
    .limit(100);

  if (siteId) query = query.eq('site_id', siteId);
  if (userId) query = query.eq('user_id', userId);

  const { data: events, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = [...new Set((events ?? []).map(e => e.user_id).filter(Boolean))] as string[];
  let nameMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);
    for (const p of profiles ?? []) {
      if (p.full_name) nameMap[p.id] = p.full_name;
    }
  }

  const enriched = (events ?? []).map(e => ({
    ...e,
    userName: e.user_id ? (nameMap[e.user_id] ?? 'Unknown user') : 'System',
  }));

  if (format === 'csv') {
    const rows = [
      ['Date', 'User', 'Action', 'File / Resource', 'Site ID'].join(','),
      ...enriched.map(e => [
        new Date(e.created_at).toLocaleString('en-GB'),
        `"${e.userName.replace(/"/g, '""')}"`,
        e.action,
        e.resource_name ? `"${e.resource_name.replace(/"/g, '""')}"` : '',
        e.site_id ?? '',
      ].join(',')),
    ].join('\r\n');
    return new NextResponse(rows, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="activity-${Date.now()}.csv"`,
      },
    });
  }

  return NextResponse.json({ events: enriched });
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { userId, siteId, organisationId, action, resourceType, resourceId, resourceName, metadata } = body;
  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });

  const { error } = await supabase.from('activity_log').insert({
    user_id:         userId ?? null,
    site_id:         siteId ?? null,
    organisation_id: organisationId ?? null,
    action,
    resource_type:   resourceType ?? null,
    resource_id:     resourceId ?? null,
    resource_name:   resourceName ?? null,
    metadata:        metadata ?? {},
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
