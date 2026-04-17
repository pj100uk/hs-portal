import { SupabaseClient } from '@supabase/supabase-js';

export async function recalcIAG(siteId: string, supabase: SupabaseClient): Promise<number | null> {
  const { data: services } = await supabase
    .from('site_services')
    .select('purchased, site_type_requirements(is_mandatory)')
    .eq('site_id', siteId);

  if (!services || services.length === 0) {
    await supabase.from('sites').update({ iag_score: null, iag_weighted_score: null }).eq('id', siteId);
    return null;
  }

  const total = services.length;
  const purchased = services.filter((s: any) => s.purchased).length;
  const iag_score = Math.round((purchased / total) * 100);

  const mandatory = services.filter((s: any) => s.site_type_requirements?.is_mandatory);
  const recommended = services.filter((s: any) => !s.site_type_requirements?.is_mandatory);
  const mandatoryScore = mandatory.length === 0 ? null
    : Math.round((mandatory.filter((s: any) => s.purchased).length / mandatory.length) * 100);
  const recommendedScore = recommended.length === 0 ? null
    : Math.round((recommended.filter((s: any) => s.purchased).length / recommended.length) * 100);
  const iag_weighted_score =
    mandatoryScore !== null && recommendedScore !== null ? Math.round(mandatoryScore * 0.8 + recommendedScore * 0.2)
    : mandatoryScore !== null ? mandatoryScore
    : recommendedScore !== null ? recommendedScore
    : null;

  await supabase.from('sites').update({ iag_score, iag_weighted_score }).eq('id', siteId);
  return iag_score;
}
