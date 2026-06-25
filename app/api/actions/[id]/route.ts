import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { notifyClientOfActionRejection } from '../../../lib/email';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { action, note, siteId } = body;

  if (action === 'reject') {
    const { data: actionRow, error: fetchErr } = await supabase
      .from('actions').select('title, site_id').eq('id', params.id).single();
    if (fetchErr || !actionRow) return NextResponse.json({ error: 'Action not found' }, { status: 404 });

    const { error } = await supabase
      .from('actions')
      .update({ status: 'open', review_note: note || null })
      .eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    notifyClientOfActionRejection({
      siteId: siteId ?? actionRow.site_id,
      actionTitle: actionRow.title,
      reviewNote: note || null,
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
