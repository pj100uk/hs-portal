import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { recalcIAG } from '../../lib/iag';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/requirements?siteType=WAREHOUSE
export async function GET(request: NextRequest) {
  const siteType = request.nextUrl.searchParams.get('siteType');
  if (!siteType) return NextResponse.json({ error: 'siteType required' }, { status: 400 });

  const { data, error } = await supabase
    .from('site_type_requirements')
    .select('*')
    .eq('site_type', siteType)
    .order('display_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/requirements — create a requirement and seed site_services for all matching sites
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.site_type || !body?.requirement_name) {
    return NextResponse.json({ error: 'site_type and requirement_name required' }, { status: 400 });
  }

  const { data: req, error: reqErr } = await supabase
    .from('site_type_requirements')
    .insert({
      site_type: body.site_type,
      requirement_name: body.requirement_name,
      description: body.description ?? null,
      is_mandatory: body.is_mandatory ?? false,
      legal_basis: body.legal_basis ?? null,
      ai_generated: body.ai_generated ?? false,
      display_order: body.display_order ?? 0,
    })
    .select()
    .single();

  if (reqErr || !req) return NextResponse.json({ error: reqErr?.message }, { status: 500 });

  // Seed site_services rows for all sites of this type
  const { data: sites } = await supabase
    .from('sites')
    .select('id')
    .eq('type', body.site_type);

  if (sites && sites.length > 0) {
    const rows = sites.map((s: any) => ({ site_id: s.id, requirement_id: req.id, purchased: false }));
    await supabase.from('site_services').upsert(rows, { onConflict: 'site_id,requirement_id' });
    await Promise.all(sites.map((s: any) => recalcIAG(s.id, supabase)));
  }

  return NextResponse.json(req);
}

// PATCH /api/requirements — update a requirement
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { id, ...fields } = body;
  const { data, error } = await supabase
    .from('site_type_requirements')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/requirements?id=
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { data: req } = await supabase
    .from('site_type_requirements')
    .select('site_type')
    .eq('id', id)
    .single();

  const { error } = await supabase.from('site_type_requirements').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (req?.site_type) {
    const { data: sites } = await supabase.from('sites').select('id').eq('type', req.site_type);
    if (sites) await Promise.all(sites.map((s: any) => recalcIAG(s.id, supabase)));
  }

  return NextResponse.json({ ok: true });
}
