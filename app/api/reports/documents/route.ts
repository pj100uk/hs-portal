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

function docStatus(reviewDue: string | null): string {
  if (!reviewDue) return 'GREY';
  const days = Math.ceil((new Date(reviewDue + 'T00:00:00').getTime() - Date.now()) / 86400000);
  if (days < 0) return 'RED';
  if (days <= 30) return 'RED';
  if (days <= 90) return 'AMBER';
  return 'GREEN';
}

export async function GET(req: NextRequest) {
  const siteId = new URL(req.url).searchParams.get('siteId');
  if (!siteId) return NextResponse.json({ error: 'siteId required' }, { status: 400 });

  const { data: site } = await supabase.from('sites').select('name').eq('id', siteId).single();
  const { data: docs, error } = await supabase
    .from('site_documents')
    .select('document_name, document_type, issue_date, expiry_date, client_provided')
    .eq('site_id', siteId)
    .order('document_name', { ascending: true });

  const { data: health } = await supabase
    .from('document_health')
    .select('document_name, review_due')
    .eq('site_id', siteId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const healthMap = new Map((health ?? []).map(h => [h.document_name, h.review_due]));

  const headers = ['Document Name', 'Type', 'Issue Date', 'Expiry Date', 'Review Due', 'Status', 'Client Provided'];
  const rows = (docs ?? []).map(d => {
    const reviewDue = healthMap.get(d.document_name ?? '') ?? null;
    return [
      escCsv(d.document_name),
      escCsv(d.document_type),
      escCsv(toUKDate(d.issue_date)),
      escCsv(toUKDate(d.expiry_date)),
      escCsv(toUKDate(reviewDue)),
      docStatus(reviewDue),
      d.client_provided ? 'Yes' : 'No',
    ].join(',');
  });

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(2);
  const siteName = (site?.name ?? 'Site').replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
  const filename = `Documents - ${siteName} - ${dd}-${mm}-${yy}.csv`;

  const csv = [headers.join(','), ...rows].join('\r\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
