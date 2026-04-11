import { SupabaseClient } from '@supabase/supabase-js';

export async function recalcIAG(siteId: string, supabase: SupabaseClient): Promise<number | null> {
  const { data: services } = await supabase
    .from('site_services')
    .select('purchased, site_type_requirements(is_mandatory)')
    .eq('site_id', siteId);

  if (!services || services.length === 0) {
    await supabase.from('sites').update({ iag_score: null }).eq('id', siteId);
    return null;
  }

  const total = services.length;
  const purchased = services.filter((s: any) => s.purchased).length;
  const iag_score = Math.round((purchased / total) * 100);

  await supabase.from('sites').update({ iag_score }).eq('id', siteId);
  return iag_score;
}
