'use client';
import React, { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

const NAVY = '#051f5b';
const today = new Date();
const todayISO = today.toLocaleDateString('en-CA');
const todayUK = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

const ONGOING_RE = /on.?going|continuous|continual|continued|continuing|rolling|recurring|recurrent|regular|permanent|indefinite|open.?ended|as.?required|as.?needed|periodic|routine|always|review/i;

function toUK(iso: string | null | undefined) {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso;
}

function actionStatus(a: any): 'overdue' | 'upcoming' | 'scheduled' | 'resolved' | 'pending' {
  if (a.status === 'resolved') return 'resolved';
  if (a.status === 'pending_review') return 'pending';
  const d = a.due_date;
  if (!d || ONGOING_RE.test(d)) return 'scheduled';
  if (d < todayISO) return 'overdue';
  const days = Math.ceil((new Date(d + 'T00:00:00').getTime() - Date.now()) / 86400000);
  if (days <= 30) return 'upcoming';
  return 'scheduled';
}

function docReviewStatus(reviewDue: string | null): 'red' | 'amber' | 'green' | 'grey' {
  if (!reviewDue) return 'grey';
  const days = Math.ceil((new Date(reviewDue + 'T00:00:00').getTime() - Date.now()) / 86400000);
  if (days <= 30) return 'red';
  if (days <= 90) return 'amber';
  return 'green';
}

function ScoreChip({ label, pct }: { label: string; pct: number }) {
  const color = pct >= 85 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626';
  return (
    <div style={{ border: `2px solid ${color}`, borderRadius: 12, padding: '12px 20px', minWidth: 130, textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 900, color }}>{Math.round(pct)}%</div>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          {headers.map(h => (
            <th key={h} style={{ background: NAVY, color: '#fff', padding: '6px 10px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? '#f9fafb' : '#fff' }}>
            {row.map((cell, j) => (
              <td key={j} style={{ padding: '6px 10px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'top' }}>{cell}</td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={headers.length} style={{ padding: '12px 10px', color: '#9ca3af', fontStyle: 'italic' }}>No data</td></tr>
        )}
      </tbody>
    </table>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 style={{ fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', color: NAVY, borderBottom: `2px solid ${NAVY}`, paddingBottom: 4, marginTop: 28, marginBottom: 12 }}>{title}</h2>
  );
}

function riskBadge(level: string | null) {
  if (!level) return '—';
  const col = level === 'HIGH' ? '#dc2626' : level === 'MEDIUM' ? '#d97706' : '#059669';
  return <span style={{ background: col, color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{level}</span>;
}

function statusBadge(s: string) {
  const map: Record<string, [string, string]> = {
    overdue:   ['#fef2f2', '#dc2626'],
    upcoming:  ['#fffbeb', '#d97706'],
    scheduled: ['#f0fdf4', '#059669'],
    resolved:  ['#f0fdf4', '#059669'],
    pending:   ['#fffbeb', '#d97706'],
  };
  const [bg, fg] = map[s] ?? ['#f3f4f6', '#374151'];
  return <span style={{ background: bg, color: fg, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{s}</span>;
}

// ─── Site Report ─────────────────────────────────────────────────────────────
function SiteReport({ siteId }: { siteId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const [{ data: site }, { data: actions }, { data: docs }, { data: health }] = await Promise.all([
        supabase.from('sites').select('name, organisation_id, compliance_score, iag_weighted_score').eq('id', siteId).single(),
        supabase.from('actions').select('hazard_ref, title, risk_level, priority, status, due_date, resolved_date, responsible_person').eq('site_id', siteId),
        supabase.from('site_documents').select('document_name, document_type, issue_date, expiry_date, client_provided').eq('site_id', siteId),
        supabase.from('document_health').select('document_name, review_due').eq('site_id', siteId),
      ]);
      if (!site) { setError('Site not found or access denied.'); setLoading(false); return; }
      const { data: org } = site.organisation_id
        ? await supabase.from('organisations').select('name').eq('id', site.organisation_id).single()
        : { data: null };
      setData({ site, org, actions: actions ?? [], docs: docs ?? [], health: health ?? [] });
      setLoading(false);
    })();
  }, [siteId]);

  if (loading) return <p style={{ padding: 40, color: '#6b7280' }}>Loading report…</p>;
  if (error) return <p style={{ padding: 40, color: '#dc2626' }}>{error}</p>;

  const { site, org, actions, docs, health } = data;
  const healthMap = new Map(health.map((h: any) => [h.document_name, h.review_due]));

  // Action stats
  const statuses = actions.map(actionStatus);
  const overdue   = statuses.filter((s: string) => s === 'overdue').length;
  const upcoming  = statuses.filter((s: string) => s === 'upcoming').length;
  const scheduled = statuses.filter((s: string) => s === 'scheduled').length;
  const pending   = statuses.filter((s: string) => s === 'pending').length;
  const resolved  = statuses.filter((s: string) => s === 'resolved').length;
  const open = overdue + upcoming + scheduled + pending;
  const totalForScore = open * 2 + resolved; // weight: open=2, resolved skipped in portal calc
  // Actions progress % — mirrors portal: overdue=bad weight
  const onTrackWeight = upcoming + scheduled + pending;
  const actionsScore = open === 0 ? 100 : Math.max(0, Math.round((onTrackWeight / (open + overdue)) * 100));

  // Risk health
  const openActions = actions.filter((a: any) => a.status !== 'resolved');
  const high   = openActions.filter((a: any) => a.risk_level === 'HIGH').length;
  const medium = openActions.filter((a: any) => a.risk_level === 'MEDIUM').length;
  const low    = openActions.filter((a: any) => a.risk_level?.toUpperCase() === 'LOW' || (!a.risk_level && a.priority === 'green')).length;
  const riskTotal = high * 3 + medium * 2 + low;
  const highOT   = openActions.filter((a: any) => a.risk_level === 'HIGH' && actionStatus(a) !== 'overdue').length;
  const medOT    = openActions.filter((a: any) => a.risk_level === 'MEDIUM' && actionStatus(a) !== 'overdue').length;
  const lowOT    = openActions.filter((a: any) => (a.risk_level?.toUpperCase() === 'LOW' || !a.risk_level) && actionStatus(a) !== 'overdue').length;
  const riskScore = riskTotal === 0 ? 100 : Math.round(((highOT * 3 + medOT * 2 + lowOT) / riskTotal) * 100);

  // Doc health
  const docStatuses = health.map((h: any) => docReviewStatus(h.review_due));
  const docRed   = docStatuses.filter((s: string) => s === 'red').length;
  const docAmber = docStatuses.filter((s: string) => s === 'amber').length;
  const docGreen = docStatuses.filter((s: string) => s === 'green').length;
  const docGrey  = docStatuses.filter((s: string) => s === 'grey').length;
  const docTotal = docStatuses.length;
  const docScore = docTotal === 0 ? 100 : Math.round(((docGreen * 100 + docAmber * 95 + docGrey * 50) / (docTotal * 100)) * 100);

  // Composite H&S score
  const iagScore = site.iag_weighted_score ?? 0;
  const hsScore  = Math.round(actionsScore * 0.4 + riskScore * 0.4 + docScore * 0.2);

  // Top overdue actions
  const overdueActions = actions.filter((a: any) => actionStatus(a) === 'overdue')
    .sort((a: any, b: any) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
    .slice(0, 10);

  const clientLabel = org?.name && site.name ? `${org.name} / ${site.name}` : org?.name || site.name;

  return (
    <div>
      {/* Score cards */}
      <SectionHeader title="Performance Overview" />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <ScoreChip label="H&S Performance" pct={hsScore} />
        <ScoreChip label="Actions Progress" pct={actionsScore} />
        <ScoreChip label="Risk Health" pct={riskScore} />
        <ScoreChip label="Document Health" pct={docScore} />
      </div>

      {/* Actions breakdown */}
      <SectionHeader title="Actions Summary" />
      <Table
        headers={['Category', 'Count']}
        rows={[
          ['Overdue', <span style={{ color: '#dc2626', fontWeight: 700 }}>{overdue}</span>],
          ['Upcoming (≤30 days)', <span style={{ color: '#d97706', fontWeight: 700 }}>{upcoming}</span>],
          ['Scheduled', String(scheduled)],
          ['Pending Review', String(pending)],
          ['Resolved', String(resolved)],
          ['Total Open', <strong>{open}</strong>],
        ]}
      />

      {/* Overdue actions detail */}
      {overdueActions.length > 0 && (
        <>
          <SectionHeader title="Overdue Actions" />
          <Table
            headers={['Hazard Ref', 'Action', 'Risk', 'Due Date', 'Responsible']}
            rows={overdueActions.map((a: any) => [
              a.hazard_ref ?? '—',
              a.title,
              riskBadge(a.risk_level),
              toUK(a.due_date),
              a.responsible_person ?? '—',
            ])}
          />
        </>
      )}

      {/* Risk breakdown */}
      <SectionHeader title="Risk Health" />
      <Table
        headers={['Risk Level', 'Open Actions', 'On Track', 'Overdue']}
        rows={[
          ['HIGH',   String(high),   String(highOT),           String(high - highOT)],
          ['MEDIUM', String(medium), String(medOT),            String(medium - medOT)],
          ['LOW',    String(low),    String(lowOT),            String(low - lowOT)],
        ]}
      />

      {/* Document health */}
      <SectionHeader title="Document Health" />
      <Table
        headers={['Status', 'Count']}
        rows={[
          ['GREEN (review >90 days)',  <span style={{ color: '#059669', fontWeight: 700 }}>{docGreen}</span>],
          ['AMBER (review 30–90 days)',<span style={{ color: '#d97706', fontWeight: 700 }}>{docAmber}</span>],
          ['RED (review ≤30 days)',    <span style={{ color: '#dc2626', fontWeight: 700 }}>{docRed}</span>],
          ['GREY (no review date)',    String(docGrey)],
        ]}
      />
      {health.filter((h: any) => docReviewStatus(h.review_due) === 'red').length > 0 && (
        <Table
          headers={['Document', 'Review Due']}
          rows={health.filter((h: any) => docReviewStatus(h.review_due) === 'red').map((h: any) => [h.document_name, toUK(h.review_due)])}
        />
      )}
    </div>
  );
}

// ─── Org Report ───────────────────────────────────────────────────────────────
function OrgReport({ orgId }: { orgId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data: org } = await supabase.from('organisations').select('name').eq('id', orgId).single();
      if (!org) { setError('Organisation not found or access denied.'); setLoading(false); return; }
      const { data: sites } = await supabase.from('sites').select('id, name, compliance_score, iag_weighted_score').eq('organisation_id', orgId);
      if (!sites?.length) { setError('No sites found for this organisation.'); setLoading(false); return; }
      // Fetch actions for all sites
      const siteIds = sites.map((s: any) => s.id);
      const { data: actions } = await supabase.from('actions').select('site_id, status, risk_level, due_date').in('site_id', siteIds);
      const { data: health } = await supabase.from('document_health').select('site_id, review_due').in('site_id', siteIds);
      setData({ org, sites, actions: actions ?? [], health: health ?? [] });
      setLoading(false);
    })();
  }, [orgId]);

  if (loading) return <p style={{ padding: 40, color: '#6b7280' }}>Loading report…</p>;
  if (error) return <p style={{ padding: 40, color: '#dc2626' }}>{error}</p>;

  const { org, sites, actions, health } = data;

  const rows = sites.map((site: any) => {
    const siteActions = actions.filter((a: any) => a.site_id === site.id);
    const openActions = siteActions.filter((a: any) => a.status !== 'resolved');
    const overdueCount = openActions.filter((a: any) => {
      const d = a.due_date;
      return d && !ONGOING_RE.test(d) && d < todayISO;
    }).length;
    const highRisk = openActions.filter((a: any) => a.risk_level === 'HIGH').length;
    const siteHealth = health.filter((h: any) => h.site_id === site.id);
    const docsDueSoon = siteHealth.filter((h: any) => docReviewStatus(h.review_due) === 'red').length;
    const compScore = site.compliance_score ?? 0;
    return [
      site.name,
      <span style={{ color: compScore >= 85 ? '#059669' : compScore >= 50 ? '#d97706' : '#dc2626', fontWeight: 700 }}>{compScore}%</span>,
      overdueCount > 0 ? <span style={{ color: '#dc2626', fontWeight: 700 }}>{overdueCount}</span> : '0',
      highRisk > 0 ? <span style={{ color: '#dc2626', fontWeight: 700 }}>{highRisk}</span> : '0',
      docsDueSoon > 0 ? <span style={{ color: '#dc2626', fontWeight: 700 }}>{docsDueSoon}</span> : '0',
    ];
  });

  return (
    <div>
      <SectionHeader title="Site Performance Overview" />
      <Table
        headers={['Site', 'H&S Score', 'Overdue Actions', 'Open High Risk', 'Docs Due ≤30 days']}
        rows={rows}
      />
    </div>
  );
}

// ─── Report Shell ─────────────────────────────────────────────────────────────
function ReportPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const type   = searchParams.get('type');
  const siteId = searchParams.get('siteId');
  const orgId  = searchParams.get('orgId');

  const [checking, setChecking] = useState(true);
  const [orgName, setOrgName] = useState('');
  const [siteName, setSiteName] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/'); return; }
      setChecking(false);
      // Load names for header
      if (siteId) {
        supabase.from('sites').select('name, organisation_id').eq('id', siteId).single().then(({ data: s }) => {
          if (s) {
            setSiteName(s.name);
            if (s.organisation_id) {
              supabase.from('organisations').select('name').eq('id', s.organisation_id).single().then(({ data: o }) => {
                if (o) setOrgName(o.name);
              });
            }
          }
        });
      }
      if (orgId) {
        supabase.from('organisations').select('name').eq('id', orgId).single().then(({ data: o }) => {
          if (o) setOrgName(o.name);
        });
      }
    });
  }, [siteId, orgId, router]);

  if (checking) return null;

  const reportTitle = type === 'org' ? 'Organisation H&S Summary' : 'H&S Status Report';
  const subtitle = type === 'org'
    ? orgName
    : [orgName, siteName].filter(Boolean).join(' / ');

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
        }
        body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; background: #fff; color: #111827; margin: 0; }
      `}</style>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 32px 64px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, borderBottom: `3px solid ${NAVY}`, paddingBottom: 16 }}>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="MB Health & Safety" style={{ height: 50, marginBottom: 8, display: 'block' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <h1 style={{ fontSize: 20, fontWeight: 900, color: NAVY, margin: 0 }}>{reportTitle}</h1>
            {subtitle && <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{subtitle}</p>}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: '#6b7280' }}>
            <div style={{ fontWeight: 700 }}>Date Generated</div>
            <div>{todayUK}</div>
          </div>
        </div>

        {/* Print button */}
        <div className="no-print" style={{ marginBottom: 24 }}>
          <button
            onClick={() => window.print()}
            style={{ background: NAVY, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            Print / Save as PDF
          </button>
        </div>

        {/* Report body */}
        {type === 'site' && siteId && <SiteReport siteId={siteId} />}
        {type === 'org'  && orgId  && <OrgReport  orgId={orgId}  />}
        {!type && <p style={{ color: '#dc2626' }}>Invalid report URL — missing type parameter.</p>}

        {/* Footer */}
        <p style={{ marginTop: 40, fontSize: 11, color: '#9ca3af', borderTop: '1px solid #e5e7eb', paddingTop: 12, textAlign: 'right' }}>
          Generated by MB Health &amp; Safety Portal · {todayUK}
        </p>
      </div>
    </>
  );
}

export default function ReportPage() {
  return (
    <React.Suspense fallback={null}>
      <ReportPageInner />
    </React.Suspense>
  );
}
