import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { notifyAdvisorOfActionSubmitted } from '../../../../lib/email';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;

  const { data: action, error: fetchError } = await supabase
    .from('actions')
    .select('title, hazard_ref, source_document_name, site_id')
    .eq('id', id)
    .single();

  if (fetchError || !action) return NextResponse.json({ error: 'Action not found' }, { status: 404 });

  const { error } = await supabase
    .from('actions')
    .update({ status: 'pending_review', review_note: null })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  void notifyAdvisorOfActionSubmitted({
    siteId: action.site_id,
    actionTitle: action.title,
    hazardRef: action.hazard_ref,
    sourceDocumentName: action.source_document_name,
  });

  return NextResponse.json({ ok: true });
}
