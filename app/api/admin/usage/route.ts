import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const days = parseInt(searchParams.get('days') ?? '30', 10);

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (profile?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [totalsRes, dailyRes, orgRes, recentRes, ccRes] = await Promise.all([
    supabase
      .from('ai_usage_log')
      .select('service, input_tokens, output_tokens, cost_usd')
      .gte('created_at', since),

    supabase
      .from('ai_usage_log')
      .select('created_at, service, cost_usd')
      .gte('created_at', since)
      .order('created_at', { ascending: true }),

    supabase
      .from('ai_usage_log')
      .select('organisation_id, service, cost_usd, organisations(name)')
      .gte('created_at', since),

    supabase
      .from('ai_usage_log')
      .select('created_at, service, model, operation, site_id, input_tokens, output_tokens, cost_usd, metadata, sites(name)')
      .order('created_at', { ascending: false })
      .limit(50),

    fetch('https://api.cloudconvert.com/v2/users/me', {
      headers: { Authorization: `Bearer ${process.env.CLOUDCONVERT_API_KEY}` },
    }).then(r => r.json()).catch(() => null),
  ]);

  // Compute summary totals per service
  type ServiceTotals = Record<string, { inputTokens: number; outputTokens: number; costUsd: number; count: number }>;
  const totals: ServiceTotals = {};
  for (const row of totalsRes.data ?? []) {
    if (!totals[row.service]) totals[row.service] = { inputTokens: 0, outputTokens: 0, costUsd: 0, count: 0 };
    totals[row.service].inputTokens += row.input_tokens ?? 0;
    totals[row.service].outputTokens += row.output_tokens ?? 0;
    totals[row.service].costUsd += parseFloat(row.cost_usd ?? 0);
    totals[row.service].count += 1;
  }

  // Daily breakdown: { date: string, gemini: number, claude: number, cloudconvert: number }
  type DayMap = Record<string, { gemini: number; claude: number; cloudconvert: number }>;
  const dayMap: DayMap = {};
  for (const row of dailyRes.data ?? []) {
    const day = row.created_at.slice(0, 10);
    if (!dayMap[day]) dayMap[day] = { gemini: 0, claude: 0, cloudconvert: 0 };
    const svc = row.service as keyof typeof dayMap[string];
    if (svc in dayMap[day]) dayMap[day][svc] += parseFloat(row.cost_usd ?? 0);
  }
  const daily = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, costs]) => ({ date, ...costs }));

  // Per-org breakdown
  type OrgMap = Record<string, { name: string; gemini: number; claude: number; cloudconvert: number; total: number }>;
  const orgMap: OrgMap = {};
  for (const row of orgRes.data ?? []) {
    const orgId = row.organisation_id ?? '__none__';
    const orgName = (row as any).organisations?.name ?? (row.organisation_id ? row.organisation_id : 'No org');
    if (!orgMap[orgId]) orgMap[orgId] = { name: orgName, gemini: 0, claude: 0, cloudconvert: 0, total: 0 };
    const cost = parseFloat(row.cost_usd ?? 0);
    const svc = row.service as 'gemini' | 'claude' | 'cloudconvert';
    if (svc in orgMap[orgId]) orgMap[orgId][svc] += cost;
    orgMap[orgId].total += cost;
  }
  const orgs = Object.values(orgMap).sort((a, b) => b.total - a.total);

  const ccCredits: number | null = ccRes?.data?.credits ?? null;

  return NextResponse.json({
    days,
    totals,
    daily,
    orgs,
    recent: recentRes.data ?? [],
    cloudconvertCredits: ccCredits,
  });
}
