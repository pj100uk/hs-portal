import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Recalculates the compliance score for a site based on its site_documents.
 * Score = (valid docs / total docs) * 100, where valid = not expired or no expiry.
 * If no documents exist, leaves the current score unchanged.
 */
export async function recalcSiteCompliance(siteId: string, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('site_documents')
    .select('expiry_date')
    .eq('site_id', siteId);

  if (error || !data || data.length === 0) return;

  const total = data.length;
  const today = new Date().toISOString().slice(0, 10);
  const valid = data.filter(d => !d.expiry_date || d.expiry_date >= today).length;
  const score = Math.round((valid / total) * 100);

  await supabase.from('sites').update({ compliance_score: score }).eq('id', siteId);
}
