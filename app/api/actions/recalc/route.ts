import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { recalcSiteCompliance } from '../../documents/recalc-compliance';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.site_id) return NextResponse.json({ error: 'site_id required' }, { status: 400 });

  const { data: actions, error } = await supabase
    .from('actions')
    .select('status, due_date, updated_at, site_document_id')
    .eq('site_id', body.site_id)
    .is('site_document_id', null); // exclude client-managed doc actions

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!actions || actions.length === 0) {
    await supabase.from('sites').update({ action_progress: 100 }).eq('id', body.site_id);
    return NextResponse.json({ action_progress: 100 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ONGOING_RE = /on.?going|continuous|continual|continued|continuing|rolling|recurring|recurrent|regular|permanent|indefinite|open.?ended|as.?required|as.?needed|periodic|routine|always/i;
  const IMMEDIATE_RE = /\b(immediately?|urgent(ly)?|asap|a\.?s\.?a\.?p\.?|as\s+soon\s+as\s+(possible|practicable)|right\s+away|straight\s+away|without\s+delay|at\s+once|now|today)\b/i;
  let resolvedPoints = 0;
  let totalPoints = 0;

  for (const a of actions) {
    const isResolved = a.status === 'resolved' || a.status === 'pending_review';
    const date = a.due_date as string | null;
    const isImmediate = !!date && IMMEDIATE_RE.test(date) && !ONGOING_RE.test(date);
    const isOngoing = !isImmediate && !!date && ONGOING_RE.test(date);
    const hasSpecificDate = !!date && !isImmediate && !isOngoing && /^\d{4}-\d{2}-\d{2}$/.test(date);

    let w = 1;
    if (isImmediate) {
      w = 2; // treat same as overdue
    } else if (hasSpecificDate) {
      if (date! < today) {
        w = 2; // overdue
      } else {
        const daysAway = Math.ceil((new Date(date!).getTime() - Date.now()) / 86400000);
        w = daysAway <= 30 ? 1 : 1;
      }
    } else {
      const lastUpdated = (a.updated_at as string | null)?.slice(0, 10) ?? null;
      w = (lastUpdated && lastUpdated < sixMonthsAgo) ? 1 : 1;
    }

    if (isResolved) {
      resolvedPoints += w;
      totalPoints += w;
    } else {
      totalPoints += w;
    }
  }

  const action_progress = totalPoints === 0 ? 100 : Math.round((resolvedPoints / totalPoints) * 100);
  await supabase.from('sites').update({ action_progress }).eq('id', body.site_id);
  await recalcSiteCompliance(body.site_id, supabase).catch((e) => { console.error('[recalc] recalcSiteCompliance failed:', e?.message ?? e); });
  return NextResponse.json({ action_progress });
}
