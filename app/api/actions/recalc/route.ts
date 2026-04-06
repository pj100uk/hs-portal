import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 3, red: 3,
  upcoming: 2, amber: 2,
  scheduled: 1, green: 1,
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.site_id) return NextResponse.json({ error: 'site_id required' }, { status: 400 });

  const { data: actions, error } = await supabase
    .from('actions')
    .select('priority, status, due_date, site_document_id')
    .eq('site_id', body.site_id)
    .is('site_document_id', null); // exclude client-managed doc actions

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!actions || actions.length === 0) {
    await supabase.from('sites').update({ action_progress: 100 }).eq('id', body.site_id);
    return NextResponse.json({ action_progress: 100 });
  }

  const today = new Date().toISOString().slice(0, 10);
  let resolvedPoints = 0;
  let totalPoints = 0;

  for (const a of actions) {
    const w = PRIORITY_WEIGHT[a.priority] ?? 1;
    const isResolved = a.status === 'resolved';
    const isOverdue = !isResolved && a.due_date && a.due_date < today;
    const isCriticalNoDueDate = !isResolved && (a.priority === 'critical' || a.priority === 'red') && !a.due_date;

    if (isResolved) {
      resolvedPoints += w;
      totalPoints += w;
    } else if (isOverdue) {
      totalPoints += w * 2; // overdue = double weight penalty
    } else if (isCriticalNoDueDate) {
      totalPoints += w * 1.5; // mild penalty for unscheduled critical
    } else {
      totalPoints += w;
    }
  }

  const action_progress = totalPoints === 0 ? 100 : Math.round((resolvedPoints / totalPoints) * 100);
  await supabase.from('sites').update({ action_progress }).eq('id', body.site_id);
  return NextResponse.json({ action_progress });
}
