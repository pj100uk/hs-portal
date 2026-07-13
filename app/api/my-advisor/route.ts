import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — returns the advisor contact details for the client's site
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || profile.role !== 'client') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const siteId = new URL(request.url).searchParams.get('siteId');
  if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 });

  const [{ data: site }, { data: siteAssigns }] = await Promise.all([
    supabaseAdmin.from('sites').select('advisor_id, organisation_id').eq('id', siteId).single(),
    supabaseAdmin.from('advisor_site_assignments').select('advisor_id').eq('site_id', siteId).limit(1),
  ]);

  let advisorId: string | null =
    siteAssigns?.[0]?.advisor_id ?? null;

  if (!advisorId && site?.organisation_id) {
    const { data: orgAssigns } = await supabaseAdmin.from('advisor_organisations').select('advisor_id').eq('organisation_id', site.organisation_id).limit(1);
    advisorId = orgAssigns?.[0]?.advisor_id ?? null;
  }

  if (!advisorId && site?.advisor_id) advisorId = site.advisor_id;

  if (!advisorId) return NextResponse.json(null);

  const { data: advisorProfile } = await supabaseAdmin.from('profiles').select('full_name, phone').eq('id', advisorId).single();
  const { data: { user: advisorUser } } = await supabaseAdmin.auth.admin.getUserById(advisorId);

  return NextResponse.json({
    full_name: advisorProfile?.full_name ?? null,
    email: advisorUser?.email ?? '',
    phone: advisorProfile?.phone ?? null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
