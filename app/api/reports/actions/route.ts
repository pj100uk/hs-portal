import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function escCsv(val: string | null | undefined): string {
  if (val == null) return '';
  const s = String(val);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function toUKDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso;
}

function daysLate(resolved: string, due: string): number {
  return Math.round((new Date(resolved + 'T00:00:00').getTime() - new Date(due + 'T00:00:00').getTime()) / 86400000);
}

export async function GET(req: NextRequest) {
  const siteId = new URL(req.url).searchParams.get('siteId');
  if (!siteId) return NextResponse.json({ error: 'siteId required' }, { status: 400 });

  const { data: site } = await supabase.from('sites').select('name').eq('id', siteId).single();
  const { data: actions, error } = await supabase
    .from('actions')
    .select('hazard_ref, title, risk_level, priority, status, due_date, responsible_person, resolved_date, source_document_name, created_at')
    .eq('site_id', siteId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const headers = ['Hazard Ref', 'Action', 'Risk Level', 'Priority', 'Status', 'Due Date', 'Responsible Person', 'Resolved Date', 'Days Late', 'Source Document'];
  const rows = (actions ?? []).map(a => {
    const late = a.resolved_date && a.due_date ? daysLate(a.resolved_date, a.due_date) : 0;
    return [
      escCsv(a.hazard_ref),
      escCsv(a.title),
      escCsv(a.risk_level),
      escCsv(a.priority),
      escCsv(a.status),
      escCsv(toUKDate(a.due_date)),
      escCsv(a.responsible_person),
      escCsv(toUKDate(a.resolved_date)),
      late > 0 ? String(late) : '',
      escCsv(a.source_document_name),
    ].join(',');
  });

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(2);
  const siteName = (site?.name ?? 'Site').replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
  const filename = `Actions - ${siteName} - ${dd}-${mm}-${yy}.csv`;

  const csv = [headers.join(','), ...rows].join('\r\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
