import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function assertSuperadmin(userId: string) {
  const { data } = await supabase.from('profiles').select('role').eq('id', userId).single();
  return data?.role === 'superadmin';
}

export async function DELETE(req: NextRequest, { params }: { params: { siteId: string } }) {
  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId || !(await assertSuperadmin(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { siteId } = params;

  // Fetch action IDs for this site first (Supabase JS doesn't support subquery deletes)
  const { data: actionRows, error: fetchErr } = await supabase
    .from('actions')
    .select('id')
    .eq('site_id', siteId);

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const actionIds = (actionRows ?? []).map(r => r.id);
  let evidenceDeleted = 0;

  if (actionIds.length > 0) {
    const { count, error: evErr } = await supabase
      .from('action_evidence')
      .delete({ count: 'exact' })
      .in('action_id', actionIds);
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
    evidenceDeleted = count ?? 0;
  }

  const { count: actionsDeleted, error: actErr } = await supabase
    .from('actions')
    .delete({ count: 'exact' })
    .eq('site_id', siteId);

  if (actErr) return NextResponse.json({ error: actErr.message }, { status: 500 });

  return NextResponse.json({ deleted: { actions: actionsDeleted ?? 0, evidence: evidenceDeleted } });
}
