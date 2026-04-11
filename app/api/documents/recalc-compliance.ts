import { SupabaseClient } from '@supabase/supabase-js';

function docStatus(issueDate: string | null, reviewDue: string | null, today: string): 'red' | 'amber' | 'green' | 'grey' {
  if (reviewDue) {
    if (reviewDue < today) return 'red';
    const days = Math.ceil((new Date(reviewDue + 'T00:00:00').getTime() - Date.now()) / 86400000);
    return days <= 30 ? 'amber' : 'green';
  }
  if (!issueDate) return 'grey';
  const months = Math.floor((Date.now() - new Date(issueDate + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24 * 30.5));
  if (months > 24) return 'red';
  if (months > 12) return 'amber';
  return 'green';
}

/**
 * Recalculates the compliance score for a site based on RA document health.
 * Documents are grouped from AI-synced actions by source_document_name.
 * Score per doc: green=100, amber=50, grey=50, red=0.
 * If no AI-synced documents exist, leaves the current score unchanged.
 */
export async function recalcSiteCompliance(siteId: string, supabase: SupabaseClient) {
  const today = new Date().toISOString().slice(0, 10);

  const [actRes, healthRes] = await Promise.all([
    supabase
      .from('actions')
      .select('source_document_name, issue_date')
      .eq('site_id', siteId)
      .not('source_document_name', 'is', null),
    supabase
      .from('document_health')
      .select('document_name, review_due')
      .eq('site_id', siteId),
  ]);

  const actions = actRes.data ?? [];
  if (actions.length === 0) return;

  // Group by source_document_name, pick most recent issue_date
  const map = new Map<string, string | null>();
  for (const a of actions) {
    const name: string = a.source_document_name;
    const d = a.issue_date as string | null;
    const existing = map.get(name);
    if (existing === undefined) {
      map.set(name, d);
    } else if (d && (!existing || d > existing)) {
      map.set(name, d);
    }
  }

  const reviewMap = new Map<string, string | null>(
    (healthRes.data ?? []).map((h: any) => [h.document_name, h.review_due as string | null])
  );

  let totalPoints = 0;
  Array.from(map.entries()).forEach(([docName, issueDate]) => {
    const reviewDue = reviewMap.get(docName) ?? null;
    const s = docStatus(issueDate, reviewDue, today);
    totalPoints += s === 'green' ? 100 : s === 'amber' ? 95 : s === 'red' ? 0 : 50;
  });

  const count = map.size;
  const score = Math.round(totalPoints / (count * 100) * 100);
  await supabase.from('sites').update({ compliance_score: score }).eq('id', siteId);
}
