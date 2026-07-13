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
  const orgId    = searchParams.get('orgId');
  const callerId = searchParams.get('callerId');
  const format   = searchParams.get('format');
  const limit    = Math.min(parseInt(searchParams.get('limit') ?? '200', 10), 500);

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

  // Non-superadmin must supply siteId or userId
  if (callerProfile.role !== 'superadmin' && !siteId && !userId) {
    return NextResponse.json({ error: 'siteId or userId required' }, { status: 400 });
  }

  let query = supabase
    .from('activity_log')
    .select('id, created_at, user_id, site_id, organisation_id, action, resource_type, resource_id, resource_name, metadata')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (siteId)  query = query.eq('site_id', siteId);
  if (userId)  query = query.eq('user_id', userId);
  if (orgId)   query = query.eq('organisation_id', orgId);

  const { data: events, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with user name + email
  const userIds = [...new Set((events ?? []).map(e => e.user_id).filter(Boolean))] as string[];
  const nameMap: Record<string, { name: string; email: string }> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);
    for (const p of profiles ?? []) {
      nameMap[p.id] = { name: p.full_name ?? '', email: '' };
    }
  }

  // Enrich with site names
  const siteIds = [...new Set((events ?? []).map(e => e.site_id).filter(Boolean))] as string[];
  const siteMap: Record<string, string> = {};
  if (siteIds.length > 0) {
    const { data: sitesData } = await supabase.from('sites').select('id, name').in('id', siteIds);
    for (const s of sitesData ?? []) siteMap[s.id] = s.name;
  }

  // Enrich with org names
  const orgIds = [...new Set((events ?? []).map(e => e.organisation_id).filter(Boolean))] as string[];
  const orgMap: Record<string, string> = {};
  if (orgIds.length > 0) {
    const { data: orgsData } = await supabase.from('organisations').select('id, name').in('id', orgIds);
    for (const o of orgsData ?? []) orgMap[o.id] = o.name;
  }

  const enriched = (events ?? []).map(e => ({
    ...e,
    userName: e.user_id ? (nameMap[e.user_id]?.name || 'Unknown user') : 'System',
    siteName: e.site_id ? (siteMap[e.site_id] ?? e.site_id) : null,
    orgName:  e.organisation_id ? (orgMap[e.organisation_id] ?? null) : null,
  }));

  if (format === 'csv') {
    const rows = [
      ['Date', 'User', 'Action', 'Resource', 'Site', 'Organisation'].join(','),
      ...enriched.map(e => [
        new Date(e.created_at).toLocaleString('en-GB'),
        `"${e.userName.replace(/"/g, '""')}"`,
        e.action,
        e.resource_name ? `"${e.resource_name.replace(/"/g, '""')}"` : '',
        e.siteName ? `"${e.siteName.replace(/"/g, '""')}"` : '',
        e.orgName  ? `"${e.orgName.replace(/"/g, '""')}"` : '',
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
