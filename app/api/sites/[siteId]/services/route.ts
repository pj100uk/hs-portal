import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { recalcIAG } from '../../../../lib/iag';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type RouteContext = { params: Promise<{ siteId: string }> };

// GET /api/sites/[siteId]/services — list services with purchased status
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { siteId } = await params;

  // Get the site type first
  const { data: site } = await supabase.from('sites').select('type').eq('id', siteId).single();
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

  // Get all requirements for this site type, joined with purchased status for this site
  const { data: requirements, error } = await supabase
    .from('site_type_requirements')
    .select(`
      id,
      requirement_name,
      description,
      is_mandatory,
      legal_basis,
      display_order,
      site_services!left(purchased, notes)
    `)
    .eq('site_type', site.type)
    .eq('site_services.site_id', siteId)
    .order('display_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = (requirements ?? []).map(r => ({
    id: r.id,
    requirement_name: r.requirement_name,
    description: r.description,
    is_mandatory: r.is_mandatory,
    legal_basis: r.legal_basis,
    display_order: r.display_order,
    purchased: (r.site_services as unknown as { purchased: boolean }[] | null)?.[0]?.purchased ?? false,
    notes: (r.site_services as unknown as { notes: string | null }[] | null)?.[0]?.notes ?? null,
  }));

  return NextResponse.json(result);
}

// PATCH /api/sites/[siteId]/services — toggle purchased for a requirement
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { siteId } = await params;
  const body = await request.json().catch(() => null);
  if (!body?.requirementId) return NextResponse.json({ error: 'requirementId required' }, { status: 400 });

  const { error } = await supabase
    .from('site_services')
    .upsert(
      {
        site_id: siteId,
        requirement_id: body.requirementId,
        purchased: body.purchased ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'site_id,requirement_id' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const iag_score = await recalcIAG(siteId, supabase);
  return NextResponse.json({ ok: true, iag_score });
}
