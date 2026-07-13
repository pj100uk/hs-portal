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
  if (a.status === 'resolved' || a.status === 'archived') return 'resolved';
  if (a.status === 'pending_review') return 'pending';
  const d = a.due_date;
  if (!d || ONGOING_RE.test(d)) return 'scheduled';
  if (d < todayISO) return 'overdue';
  const days = Math.ceil((new Date(d + 'T00:00:00').getTime() - Date.now()) / 86400000);
  if (days <= 30) return 'upcoming';
  return 'scheduled';
}

function computeSiteStats(actions: any[]) {
  // ── Scores: match UI formulas exactly ──
  // Actions Progress: overdue ×2, upcoming (≤30 days) also NOT on-track — matches UI tooltip
  let apOnTrack = 0, apTotal = 0;
  for (const a of actions) {
    const isResolved = a.status === 'resolved' || a.status === 'pending_review' || a.status === 'archived';
    const d = a.due_date ?? null;
    const hasDate = !!d && !ONGOING_RE.test(d) && /^\d{4}-\d{2}-\d{2}$/.test(d);
    const isOverdue  = !isResolved && hasDate && d < todayISO;
    const daysAway   = hasDate && !isOverdue ? Math.ceil((new Date(d + 'T00:00:00').getTime() - Date.now()) / 86400000) : null;
    const isUpcoming = !isResolved && !isOverdue && daysAway !== null && daysAway <= 30;
    const w = isOverdue ? 2 : 1;
    apTotal += w;
    if (isResolved || (!isOverdue && !isUpcoming)) apOnTrack += w;
  }
  const actionsScore = apTotal === 0 ? 100 : Math.round((apOnTrack / apTotal) * 100);

  // Risk Health: explicit risk_level only, archived goes through date check (not auto on-track)
  const riskTiersScore = (['HIGH', 'MEDIUM', 'LOW'] as const).map(tier => {
    const forTier = actions.filter(a => a.risk_level?.toUpperCase() === tier);
    const onTrack  = forTier.filter(a => {
      if (a.status === 'resolved' || a.status === 'pending_review') return true;
      const d = a.due_date ?? null;
      return !(!!d && !ONGOING_RE.test(d) && /^\d{4}-\d{2}-\d{2}$/.test(d) && d < todayISO);
    }).length;
    const w = tier === 'HIGH' ? 3 : tier === 'MEDIUM' ? 2 : 1;
    return { total: forTier.length, onTrack, w };
  });
  const wTotal   = riskTiersScore.reduce((s, t) => s + t.total * t.w, 0);
  const wOnTrack = riskTiersScore.reduce((s, t) => s + t.onTrack * t.w, 0);
  const riskScore = wTotal === 0 ? 100 : Math.round((wOnTrack / wTotal) * 100);

  const hsScore = Math.round(actionsScore * 0.5 + riskScore * 0.5);

  // ── Display counts: exclude archived for clean client-facing table ──
  const displayActions = actions.filter(a => a.status !== 'archived');
  const statuses  = displayActions.map(actionStatus);
  const overdue   = statuses.filter(s => s === 'overdue').length;
  const upcoming  = statuses.filter(s => s === 'upcoming').length;
  const scheduled = statuses.filter(s => s === 'scheduled').length;
  const pending   = statuses.filter(s => s === 'pending').length;
  const resolved  = statuses.filter(s => s === 'resolved').length;
  const open      = overdue + upcoming + scheduled; // pending review shown separately, matching UI "101 open"

  // Risk counts for Risk Health table: open non-archived actions only
  const openActions = displayActions.filter(a => a.status !== 'resolved' && a.status !== 'pending_review');
  const high   = openActions.filter(a => a.risk_level?.toUpperCase() === 'HIGH').length;
  const medium = openActions.filter(a => a.risk_level?.toUpperCase() === 'MEDIUM').length;
  const low    = openActions.filter(a => a.risk_level?.toUpperCase() === 'LOW').length;
  const highOT = openActions.filter(a => a.risk_level === 'HIGH'   && actionStatus(a) !== 'overdue').length;
  const medOT  = openActions.filter(a => a.risk_level === 'MEDIUM' && actionStatus(a) !== 'overdue').length;
  const lowOT  = openActions.filter(a => a.risk_level?.toUpperCase() === 'LOW' && actionStatus(a) !== 'overdue').length;

  // Risk counts for explainer text: all actions (matches UI card totals)
  const highAll = actions.filter(a => a.risk_level?.toUpperCase() === 'HIGH').length;
  const medAll  = actions.filter(a => a.risk_level?.toUpperCase() === 'MEDIUM').length;
  const lowAll  = actions.filter(a => a.risk_level?.toUpperCase() === 'LOW').length;

  return { overdue, upcoming, scheduled, pending, resolved, open, actionsScore, high, medium, low, highOT, medOT, lowOT, riskScore, hsScore, openActions, highAll, medAll, lowAll };
}

function DonutScore({ pct, size = 80 }: { pct: number; size?: number }) {
  const r = size * 0.36;
  const circ = 2 * Math.PI * r;
  const filled = (pct / 100) * circ;
  const sw = size * 0.11;
  const cx = size / 2, cy = size / 2;
  const color = pct >= 85 ? '#059669' : pct >= 60 ? '#d97706' : '#dc2626';
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={sw} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={`${filled} ${circ}`}
        strokeDashoffset={circ * 0.25}
        strokeLinecap="round" />
      <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="auto"
        style={{ fontSize: size * 0.22, fontWeight: 900, fill: color, fontFamily: 'Calibri, Segoe UI, sans-serif' }}>
        {Math.round(pct)}%
      </text>
      <text x={cx} y={cy + size * 0.14} textAnchor="middle" dominantBaseline="auto"
        style={{ fontSize: size * 0.115, fill: '#9ca3af', fontFamily: 'Calibri, Segoe UI, sans-serif', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        H&amp;S
      </text>
    </svg>
  );
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
  const B = '1px solid #d0d9ee';
  return (
    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 0', fontSize: 12 }}>
      <thead>
        <tr>
          {headers.map((h, i, arr) => (
            <th key={h} style={{ background: NAVY, color: '#fff', padding: '6px 10px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', borderRadius: i === 0 ? '4px 0 0 4px' : i === arr.length - 1 ? '0 4px 4px 0' : 0 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr><td colSpan={headers.length} style={{ height: 5, padding: 0, border: 'none' }} /></tr>
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            {i > 0 && <tr><td colSpan={headers.length} style={{ height: 5, padding: 0, border: 'none' }} /></tr>}
            <tr>
              {row.map((cell, j) => (
                <td key={j} style={{
                  padding: '6px 10px',
                  background: '#f6f9fd',
                  borderTop: B,
                  borderBottom: B,
                  borderLeft: j === 0 ? B : 'none',
                  borderRight: j === row.length - 1 ? B : 'none',
                  borderRadius: j === 0 ? '4px 0 0 4px' : j === row.length - 1 ? '0 4px 4px 0' : 0,
                  verticalAlign: 'top',
                }}>{cell}</td>
              ))}
            </tr>
          </React.Fragment>
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

// ─── Shared site report body (used by both SiteReport and OrgReport) ──────────
function SiteReportBody({ actions, services = [] }: { actions: any[]; services?: any[] }) {
  const { overdue, upcoming, scheduled, pending, resolved, open, actionsScore, high, medium, low, highOT, medOT, lowOT, riskScore, hsScore, openActions, highAll, medAll, lowAll } = computeSiteStats(actions);

  const riskOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const overdueActions = actions
    .filter((a: any) => actionStatus(a) === 'overdue')
    .sort((a: any, b: any) => {
      const ar = riskOrder[a.risk_level?.toUpperCase()] ?? 3;
      const br = riskOrder[b.risk_level?.toUpperCase()] ?? 3;
      return ar !== br ? ar - br : (a.due_date ?? '').localeCompare(b.due_date ?? '');
    });

  const hsRating = hsScore >= 85 ? 'Strong' : hsScore >= 60 ? 'Moderate' : 'Requires Attention';
  const hsRatingColor = hsScore >= 85 ? '#059669' : hsScore >= 60 ? '#d97706' : '#dc2626';
  const onTrack = scheduled + pending;

  return (
    <>
      {/* Score cards */}
      <SectionHeader title="Performance Overview" />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20, justifyContent: 'center' }}>
        <ScoreChip label="Actions Progress" pct={actionsScore} />
        <ScoreChip label="Risk Health" pct={riskScore} />
        <ScoreChip label="H&S Performance" pct={hsScore} />
      </div>

      {/* Performance explainer */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 20, fontSize: 12, background: '#f8fafc', overflow: 'hidden' }}>
        {/* Actions Progress */}
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: NAVY, marginBottom: 4 }}>
            Actions Progress — <span style={{ color: actionsScore >= 85 ? '#059669' : actionsScore >= 60 ? '#d97706' : '#dc2626' }}>{Math.round(actionsScore)}%</span>
          </div>
          <div style={{ color: '#6b7280', lineHeight: 1.5 }}>
            Measures how many open actions are on track vs overdue or due within 30 days. {open === 0
              ? 'No open actions.'
              : <>{scheduled} of {open} open action{open !== 1 ? 's' : ''} on schedule{overdue > 0 ? `, ${overdue} overdue` : ''}{upcoming > 0 ? `, ${upcoming} due within 30 days` : ''}{pending > 0 ? `, ${pending} pending review` : ''}.</>}
          </div>
        </div>
        {/* Risk Health */}
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: NAVY, marginBottom: 4 }}>
            Risk Health — <span style={{ color: riskScore >= 85 ? '#059669' : riskScore >= 60 ? '#d97706' : '#dc2626' }}>{Math.round(riskScore)}%</span>
          </div>
          <div style={{ color: '#6b7280', lineHeight: 1.5 }}>
            Reflects the severity mix of actions across all statuses. {(highAll + medAll + lowAll) === 0
              ? 'No risk-rated actions.'
              : <>{highAll > 0 ? <span style={{ color: '#dc2626', fontWeight: 700 }}>{highAll} high</span> : null}{highAll > 0 && (medAll > 0 || lowAll > 0) ? ', ' : ''}{medAll > 0 ? <span style={{ color: '#d97706' }}>{medAll} medium</span> : null}{medAll > 0 && lowAll > 0 ? ', ' : ''}{lowAll > 0 ? <span style={{ color: '#059669' }}>{lowAll} low</span> : null}{' risk action'}{(highAll + medAll + lowAll) !== 1 ? 's' : ''}.</>}
          </div>
        </div>
        {/* H&S Performance */}
        <div style={{ padding: '12px 18px' }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: NAVY, marginBottom: 4 }}>
            H&S Performance — <span style={{ color: hsRatingColor }}>{Math.round(hsScore)}% — {hsRating}</span>
          </div>
          <div style={{ color: '#6b7280', lineHeight: 1.5 }}>
            Overall score calculated equally from Actions Progress and Risk Health.
            {' '}<strong>85%+</strong> strong · <strong>60–84%</strong> moderate · <strong>below 60%</strong> requires attention.
          </div>
        </div>
      </div>

      {/* Actions Summary */}
      <SectionHeader title="Actions Summary" />
      <Table
        headers={['Action Status', 'Count']}
        rows={[
          ['Overdue',             <span style={{ color: '#dc2626', fontWeight: 700 }}>{overdue}</span>],
          ['Due within 30 days', <span style={{ color: '#d97706', fontWeight: 700 }}>{upcoming}</span>],
          ['Scheduled',           String(scheduled)],
          ['Pending Review',      String(pending)],
          ['Resolved',            String(resolved)],
          ['Total Open',          <strong>{open}</strong>],
        ]}
      />

      {/* Actions Required — flat rows, doc name + hazard ref inline */}
      {overdueActions.length > 0 && (
        <>
          <SectionHeader title="Actions Required" />
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 0', fontSize: 12 }}>
            <thead>
              <tr>
                {['Action', 'Risk', 'Due Date', 'Responsible'].map((h, i, arr) => (
                  <th key={h} style={{ background: NAVY, color: '#fff', padding: '6px 10px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', borderRadius: i === 0 ? '4px 0 0 4px' : i === arr.length - 1 ? '0 4px 4px 0' : 0 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={4} style={{ height: 6, padding: 0, border: 'none' }} /></tr>
              {overdueActions.map((a: any, i: number) => {
                const docName = a.source_document_name ?? '';
                const label = [docName, a.hazard_ref ? `Hazard Ref: ${a.hazard_ref}` : ''].filter(Boolean).join(' | ');
                const B = '1px solid #d0d9ee';
                return (
                  <React.Fragment key={i}>
                    {i > 0 && <tr><td colSpan={4} style={{ height: 6, padding: 0, border: 'none' }} /></tr>}
                    {label && (
                      <tr>
                        <td colSpan={4} style={{ padding: '4px 10px', background: '#edf2fa', borderTop: B, borderLeft: B, borderRight: B, borderBottom: 'none', borderRadius: '4px 4px 0 0', fontSize: 10, color: '#3d5a99', fontWeight: 700 }}>{label}</td>
                      </tr>
                    )}
                    <tr>
                      <td style={{ padding: '6px 10px', background: '#f6f9fd', borderTop: label ? 'none' : B, borderBottom: B, borderLeft: B, borderRadius: label ? '0 0 0 4px' : '4px 0 0 4px', verticalAlign: 'top' }}>{a.title}</td>
                      <td style={{ padding: '6px 10px', background: '#f6f9fd', borderTop: label ? 'none' : B, borderBottom: B, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{riskBadge(a.risk_level)}</td>
                      <td style={{ padding: '6px 10px', background: '#f6f9fd', borderTop: label ? 'none' : B, borderBottom: B, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{toUK(a.due_date)}</td>
                      <td style={{ padding: '6px 10px', background: '#f6f9fd', borderTop: label ? 'none' : B, borderBottom: B, borderRight: B, borderRadius: label ? '0 0 4px 0' : '0 4px 4px 0', verticalAlign: 'top' }}>{a.responsible_person ?? '—'}</td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {/* Risk Health */}
      <SectionHeader title="Risk Health" />
      <Table
        headers={['Risk Level', 'Open Actions', 'On Track', 'Overdue']}
        rows={[
          ['HIGH',   String(high),   String(highOT),  String(high - highOT)],
          ['MEDIUM', String(medium), String(medOT),   String(medium - medOT)],
          ['LOW',    String(low),    String(lowOT),   String(low - lowOT)],
        ]}
      />

      {/* What's Going Well */}
      {(() => {
        const positives: string[] = [];
        if (overdue === 0 && open > 0) positives.push(`All ${open} open action${open !== 1 ? 's' : ''} are being managed on time — nothing is currently overdue. Your Actions Progress score reflects this at ${Math.round(actionsScore)}%.`);
        if (resolved > 0) positives.push(`${resolved} action${resolved !== 1 ? 's have' : ' has'} been resolved and closed out — this directly contributes to your overall H&S Performance score of ${Math.round(hsScore)}%.`);
        if (pending > 0) positives.push(`${pending} action${pending !== 1 ? 's are' : ' is'} currently submitted for advisor review, demonstrating active engagement with the H&S process.`);
        if (high > 0 && high - highOT === 0) positives.push(`All ${high} open high risk action${high !== 1 ? 's are' : ' is'} on track with no overdue items — your highest-priority risks are being effectively managed.`);
        if (high === 0 && open > 0) positives.push(`There are no open high risk actions — all critical risk items have been resolved or are not present, keeping your risk exposure low.`);
        if (medium > 0 && medium - medOT === 0 && low - lowOT === 0) positives.push(`All ${medium + low} medium and low risk action${medium + low !== 1 ? 's are' : ' is'} currently on track — no overdue items across either risk category.`);
        if (hsScore >= 85) positives.push(`Your H&S Performance score of ${Math.round(hsScore)}% places you in the strong compliance band, reflecting well-managed actions and a healthy risk profile.`);
        else if (hsScore >= 70) positives.push(`Your H&S Performance score of ${Math.round(hsScore)}% is in the moderate compliance band — a solid foundation with clear scope to reach the strong compliance threshold of 85%.`);
        if (!positives.length) return null;
        return (
          <>
            <SectionHeader title="What's Going Well" />
            <div style={{ border: '1px solid #bbf7d0', borderRadius: 6, padding: '10px 14px', background: '#f0fdf4', marginBottom: 8, fontSize: 12 }}>
              <ul style={{ margin: 0, paddingLeft: 16, color: '#166534' }}>
                {positives.map((msg, i) => <li key={i} style={{ marginBottom: i < positives.length - 1 ? 4 : 0 }}>{msg}</li>)}
              </ul>
            </div>
          </>
        );
      })()}

      {/* Areas of Improvement */}
      {(() => {
        const urgentActions = [...overdueActions]
          .sort((a, b) => {
            const ar = riskOrder[a.risk_level?.toUpperCase()] ?? 3;
            const br = riskOrder[b.risk_level?.toUpperCase()] ?? 3;
            return ar !== br ? ar - br : (a.due_date ?? '').localeCompare(b.due_date ?? '');
          })
          .slice(0, 3);
        const openHighRisk = openActions.filter((a: any) => a.risk_level?.toUpperCase() === 'HIGH' && actionStatus(a) !== 'overdue');
        const mandatoryGaps = services.filter((s: any) => !s.purchased && s.site_type_requirements?.is_mandatory);
        const recommendedGaps = services.filter((s: any) => !s.purchased && !s.site_type_requirements?.is_mandatory);

        if (!urgentActions.length && !openHighRisk.length && !mandatoryGaps.length && !recommendedGaps.length) return null;
        const B = '1px solid #d0d9ee';
        return (
          <>
            <SectionHeader title="Areas of Improvement" />
            <p style={{ fontSize: 12, color: '#6b7280', margin: '-4px 0 16px', lineHeight: 1.6 }}>
              The following areas require attention. Addressing these will directly improve your H&S Performance score and reduce risk exposure.
            </p>

            {/* Urgent overdue actions */}
            {urgentActions.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#374151', marginBottom: 8 }}>Most Urgent Actions</div>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 0', fontSize: 12, marginBottom: 16 }}>
                  <tbody>
                    <tr><td colSpan={4} style={{ height: 0, padding: 0, border: 'none' }} /></tr>
                    {urgentActions.map((a: any, i: number) => (
                      <React.Fragment key={i}>
                        {i > 0 && <tr><td colSpan={4} style={{ height: 5, padding: 0, border: 'none' }} /></tr>}
                        <tr>
                          <td style={{ padding: '7px 10px', background: '#fff5f5', borderTop: B, borderBottom: B, borderLeft: B, borderRadius: '4px 0 0 4px', verticalAlign: 'top', width: '50%' }}>{a.title}</td>
                          <td style={{ padding: '7px 10px', background: '#fff5f5', borderTop: B, borderBottom: B, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{riskBadge(a.risk_level)}</td>
                          <td style={{ padding: '7px 10px', background: '#fff5f5', borderTop: B, borderBottom: B, verticalAlign: 'top', whiteSpace: 'nowrap', color: '#dc2626', fontWeight: 700 }}>{toUK(a.due_date)}</td>
                          <td style={{ padding: '7px 10px', background: '#fff5f5', borderTop: B, borderBottom: B, borderRight: B, borderRadius: '0 4px 4px 0', verticalAlign: 'top' }}>{a.responsible_person ?? '—'}</td>
                        </tr>
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Open high risk (not overdue) */}
            {openHighRisk.length > 0 && (
              <div style={{ border: '1px solid #fecaca', borderRadius: 6, padding: '10px 14px', background: '#fef2f2', marginBottom: 16, fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: '#dc2626' }}>{openHighRisk.length} high risk action{openHighRisk.length !== 1 ? 's' : ''} open</span>
                <span style={{ color: '#6b7280' }}> — not yet overdue but require close monitoring: </span>
                <span style={{ color: '#374151' }}>{openHighRisk.map((a: any) => a.title).join('; ')}</span>
              </div>
            )}

            {/* Industry alignment gaps */}
            {(mandatoryGaps.length > 0 || recommendedGaps.length > 0) && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#374151', marginBottom: 4 }}>Industry Alignment</div>
                <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 10px', lineHeight: 1.5 }}>Based on your site type, the following recommended or required services are not currently contracted. Contracting mandatory services will improve your Industry Alignment score.</p>
                {mandatoryGaps.length > 0 && (
                  <div style={{ border: '1px solid #fed7aa', borderRadius: 6, padding: '10px 14px', background: '#fff7ed', marginBottom: 8, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, color: '#c2410c', marginBottom: 4 }}>Mandatory services not contracted ({mandatoryGaps.length})</div>
                    <ul style={{ margin: 0, paddingLeft: 16, color: '#374151' }}>
                      {mandatoryGaps.map((s: any, i: number) => (
                        <li key={i}>{s.site_type_requirements?.requirement_name ?? 'Unknown service'}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {recommendedGaps.length > 0 && (
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 14px', background: '#f8fafc', marginBottom: 8, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, color: '#374151', marginBottom: 4 }}>Recommended services not contracted ({recommendedGaps.length})</div>
                    <ul style={{ margin: 0, paddingLeft: 16, color: '#6b7280' }}>
                      {recommendedGaps.map((s: any, i: number) => (
                        <li key={i}>{s.site_type_requirements?.requirement_name ?? 'Unknown service'}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </>
        );
      })()}
    </>
  );
}

// ─── Site Report ─────────────────────────────────────────────────────────────
function SiteReport({ siteId }: { siteId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actions, setActions] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: actionsData }, { data: servicesData }] = await Promise.all([
        supabase
          .from('actions')
          .select('hazard_ref, title, risk_level, priority, status, due_date, resolved_date, responsible_person, source_document_name')
          .eq('site_id', siteId)
          .is('site_document_id', null)
          .neq('status', 'ai_suggested'),
        supabase
          .from('site_services')
          .select('purchased, site_type_requirements(requirement_name, is_mandatory)')
          .eq('site_id', siteId),
      ]);
      if (!actionsData) { setError('Failed to load actions.'); setLoading(false); return; }
      setActions(actionsData);
      setServices(servicesData ?? []);
      setLoading(false);
    })();
  }, [siteId]);

  if (loading) return <p style={{ padding: 40, color: '#6b7280' }}>Loading report…</p>;
  if (error) return <p style={{ padding: 40, color: '#dc2626' }}>{error}</p>;

  return <SiteReportBody actions={actions} services={services} />;
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
      const { data: sites } = await supabase.from('sites').select('id, name').eq('organisation_id', orgId).order('name');
      if (!sites?.length) { setError('No sites found for this organisation.'); setLoading(false); return; }
      const siteIds = sites.map((s: any) => s.id);
      const [{ data: actions }, { data: services }] = await Promise.all([
        supabase
          .from('actions')
          .select('site_id, hazard_ref, title, risk_level, priority, status, due_date, resolved_date, responsible_person, source_document_name')
          .in('site_id', siteIds)
          .is('site_document_id', null)
          .neq('status', 'ai_suggested'),
        supabase
          .from('site_services')
          .select('site_id, purchased, site_type_requirements(requirement_name, is_mandatory)')
          .in('site_id', siteIds),
      ]);
      setData({ org, sites, actions: actions ?? [], services: services ?? [] });
      setLoading(false);
    })();
  }, [orgId]);

  if (loading) return <p style={{ padding: 40, color: '#6b7280' }}>Loading report…</p>;
  if (error) return <p style={{ padding: 40, color: '#dc2626' }}>{error}</p>;

  const { sites, actions, services } = data;

  const siteStats = sites.map((site: any) => ({
    site,
    actions: actions.filter((a: any) => a.site_id === site.id),
    stats: computeSiteStats(actions.filter((a: any) => a.site_id === site.id)),
    services: services.filter((s: any) => s.site_id === site.id),
  }));

  const totalOverdue   = siteStats.reduce((n: number, s: any) => n + s.stats.overdue, 0);
  const totalOpen      = siteStats.reduce((n: number, s: any) => n + s.stats.open, 0);
  const totalHighRisk  = siteStats.reduce((n: number, s: any) => n + s.stats.high, 0);
  const avgHsScore     = siteStats.length ? Math.round(siteStats.reduce((n: number, s: any) => n + s.stats.hsScore, 0) / siteStats.length) : 0;

  return (
    <>
      {/* ── Org Overview ── */}
      <SectionHeader title="Organisation Overview" />
      <div style={{ border: '2px solid #cbd5e1', borderRadius: 12, padding: '24px', background: '#fff', marginBottom: 8 }}>

      {/* Org-level summary strip */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
        {[
          { label: 'Sites',          value: sites.length,  color: NAVY },
          { label: 'Open High Risk', value: totalHighRisk, color: totalHighRisk > 0 ? '#dc2626' : '#059669' },
          { label: 'Total Overdue',  value: totalOverdue,  color: totalOverdue  > 0 ? '#dc2626' : '#059669' },
          { label: 'Total Open',     value: totalOpen,     color: '#374151' },
          { label: 'Avg H&S Score',  value: `${avgHsScore}%`, color: avgHsScore >= 85 ? '#059669' : avgHsScore >= 60 ? '#d97706' : '#dc2626' },
        ].map(stat => (
          <div key={stat.label} style={{ flex: '1 1 100px', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', textAlign: 'center', background: '#f8fafc' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', marginTop: 2 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Per-site donut cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 40, justifyContent: 'center' }}>
        {siteStats.map(({ site, stats }: any) => {
          const scoreColor = stats.hsScore >= 85 ? '#059669' : stats.hsScore >= 60 ? '#d97706' : '#dc2626';
          return (
            <div key={site.id} style={{ border: `1px solid #e2e8f0`, borderRadius: 10, padding: '14px 12px', textAlign: 'center', background: '#fff', width: 170, boxSizing: 'border-box' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 10, lineHeight: 1.3, minHeight: 44 }}>{site.name}</div>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                <DonutScore pct={stats.hsScore} size={80} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, fontSize: 10, color: '#6b7280' }}>
                <span style={{ color: stats.overdue > 0 ? '#dc2626' : '#9ca3af', fontWeight: stats.overdue > 0 ? 700 : 400 }}>
                  {stats.overdue} overdue
                </span>
                <span>·</span>
                <span>{stats.open} open</span>
              </div>
              {stats.high > 0 && (
                <div style={{ marginTop: 4, fontSize: 10, color: '#dc2626', fontWeight: 700 }}>{stats.high} high risk</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Org-level What's Going Well */}
      {(() => {
        const positives: string[] = [];
        const sitesNoOverdue = siteStats.filter((s: any) => s.stats.overdue === 0 && s.stats.open > 0).length;
        const sitesAllOnTrack = siteStats.filter((s: any) => s.stats.overdue === 0 && s.stats.open === 0).length;
        const totalResolved = siteStats.reduce((n: number, s: any) => n + s.stats.resolved, 0);
        const sitesNoHighRisk = siteStats.filter((s: any) => s.stats.high === 0).length;
        const sitesStrongScore = siteStats.filter((s: any) => s.stats.hsScore >= 85).length;
        const sitesModerateScore = siteStats.filter((s: any) => s.stats.hsScore >= 70 && s.stats.hsScore < 85).length;

        if (sitesAllOnTrack > 0) positives.push(`${sitesAllOnTrack} site${sitesAllOnTrack !== 1 ? 's have' : ' has'} all actions completed — no open or overdue items.`);
        if (sitesNoOverdue > 0) positives.push(`${sitesNoOverdue} of ${siteStats.length} site${siteStats.length !== 1 ? 's have' : ' has'} no overdue actions — open items are all being managed on time.`);
        if (totalResolved > 0) positives.push(`${totalResolved} action${totalResolved !== 1 ? 's have' : ' has'} been resolved across the organisation — demonstrating consistent progress.`);
        if (sitesNoHighRisk === siteStats.length && totalOpen > 0) positives.push(`No open high risk actions across any site — critical risks are under control organisation-wide.`);
        else if (sitesNoHighRisk > 0) positives.push(`${sitesNoHighRisk} of ${siteStats.length} site${siteStats.length !== 1 ? 's have' : ' has'} no open high risk actions.`);
        if (sitesStrongScore > 0) positives.push(`${sitesStrongScore} site${sitesStrongScore !== 1 ? 's are' : ' is'} in the strong compliance band (≥85%) — ${sitesStrongScore !== 1 ? 'these sites reflect' : 'this site reflects'} excellent H&S management.`);
        else if (sitesModerateScore > 0) positives.push(`${sitesModerateScore + (sitesStrongScore ?? 0)} of ${siteStats.length} site${siteStats.length !== 1 ? 's are' : ' is'} scoring 70% or above — a solid baseline across the organisation.`);
        if (avgHsScore >= 85) positives.push(`Average H&S Performance across all sites is ${avgHsScore}% — placing the organisation in the strong compliance band.`);
        else if (avgHsScore >= 70) positives.push(`Average H&S Performance across all sites is ${avgHsScore}% — a solid organisational baseline with room to reach the strong compliance threshold.`);

        if (!positives.length) return null;
        return (
          <>
            <SectionHeader title="What's Going Well" />
            <div style={{ border: '1px solid #bbf7d0', borderRadius: 6, padding: '10px 14px', background: '#f0fdf4', marginBottom: 24, fontSize: 12 }}>
              <ul style={{ margin: 0, paddingLeft: 16, color: '#166534' }}>
                {positives.map((msg, i) => <li key={i} style={{ marginBottom: i < positives.length - 1 ? 4 : 0 }}>{msg}</li>)}
              </ul>
            </div>
          </>
        );
      })()}

      {/* Org-level Areas of Improvement */}
      {(() => {
        const improvements: string[] = [];
        const sitesWithOverdue = siteStats.filter((s: any) => s.stats.overdue > 0);
        const sitesWithHighRisk = siteStats.filter((s: any) => s.stats.high > 0);
        const sitesWithMandatoryGaps = siteStats.filter((s: any) =>
          services.filter((sv: any) => sv.site_id === s.site.id && !sv.purchased && sv.site_type_requirements?.is_mandatory).length > 0
        );
        const sitesWeakScore = siteStats.filter((s: any) => s.stats.hsScore < 60);

        if (sitesWithOverdue.length > 0) improvements.push(`${sitesWithOverdue.length} site${sitesWithOverdue.length !== 1 ? 's have' : ' has'} overdue actions requiring immediate attention: ${sitesWithOverdue.map((s: any) => `${s.site.name} (${s.stats.overdue} overdue)`).join(', ')}.`);
        if (sitesWithHighRisk.length > 0) improvements.push(`${sitesWithHighRisk.length} site${sitesWithHighRisk.length !== 1 ? 's have' : ' has'} open high risk actions — these require close monitoring: ${sitesWithHighRisk.map((s: any) => s.site.name).join(', ')}.`);
        if (sitesWithMandatoryGaps.length > 0) improvements.push(`${sitesWithMandatoryGaps.length} site${sitesWithMandatoryGaps.length !== 1 ? 's have' : ' has'} mandatory services not contracted — review industry alignment for: ${sitesWithMandatoryGaps.map((s: any) => s.site.name).join(', ')}.`);
        if (sitesWeakScore.length > 0) improvements.push(`${sitesWeakScore.length} site${sitesWeakScore.length !== 1 ? 's are' : ' is'} below 60% H&S Performance and require priority support: ${sitesWeakScore.map((s: any) => `${s.site.name} (${Math.round(s.stats.hsScore)}%)`).join(', ')}.`);

        if (!improvements.length) return null;
        return (
          <>
            <SectionHeader title="Areas of Improvement" />
            <p style={{ fontSize: 12, color: '#6b7280', margin: '-4px 0 16px', lineHeight: 1.6 }}>
              The following issues have been identified across sites. Addressing these will improve overall organisational H&S performance.
            </p>
            <div style={{ border: '1px solid #fecaca', borderRadius: 6, padding: '10px 14px', background: '#fef2f2', marginBottom: 24, fontSize: 12 }}>
              <ul style={{ margin: 0, paddingLeft: 16, color: '#991b1b' }}>
                {improvements.map((msg, i) => <li key={i} style={{ marginBottom: i < improvements.length - 1 ? 6 : 0 }}>{msg}</li>)}
              </ul>
            </div>
          </>
        );
      })()}

      </div>{/* end org overview panel */}

      {/* ── Per-site detailed reports ── */}
      {siteStats.map(({ site, actions: siteActions, services: siteServices }: any, idx: number) => (
        <React.Fragment key={site.id}>
          <div style={{ height: 2, background: '#94a3b8', margin: '40px 0' }} />
          <div style={{ pageBreakBefore: 'always' }}>
            <div style={{ background: NAVY, color: '#fff', borderRadius: 8, padding: '14px 20px', marginBottom: 24 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.7, marginBottom: 4 }}>Site Report</div>
              <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.01em' }}>{site.name}</div>
            </div>
            <SiteReportBody actions={siteActions} services={siteServices} />
          </div>
        </React.Fragment>
      ))}
    </>
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
  const [orgLogo, setOrgLogo] = useState('');
  const [siteLogo, setSiteLogo] = useState('');
  const [siteName, setSiteName] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/'); return; }
      setChecking(false);
      if (siteId) {
        supabase.from('sites').select('name, organisation_id, logo_url').eq('id', siteId).single().then(({ data: s }) => {
          if (s) {
            setSiteName(s.name);
            if (s.logo_url) setSiteLogo(s.logo_url);
            if (s.organisation_id) {
              supabase.from('organisations').select('name, logo_url').eq('id', s.organisation_id).single().then(({ data: o }) => {
                if (o) { setOrgName(o.name); if (o.logo_url) setOrgLogo(o.logo_url); }
              });
            }
          }
        });
      }
      if (orgId) {
        supabase.from('organisations').select('name, logo_url').eq('id', orgId).single().then(({ data: o }) => {
          if (o) { setOrgName(o.name); if (o.logo_url) setOrgLogo(o.logo_url); }
        });
      }
    });
  }, [siteId, orgId, router]);

  if (checking) return null;

  const reportTitle = 'Health & Safety Status Report';
  const subtitle = type === 'org'
    ? orgName
    : [orgName, siteName].filter(Boolean).join(' - ');

  const month = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const pdfName = [subtitle, 'H&S Status Report', month].filter(Boolean).join(' - ');
  if (typeof document !== 'undefined') document.title = pdfName;

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
        }
        body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; background: #fff !important; color: #111827; margin: 0; }
      `}</style>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 32px 64px' }}>
        {/* Header */}
        <div style={{ marginBottom: 28, borderBottom: `3px solid ${NAVY}`, paddingBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            {/* Left: MB logo + report title/subtitle + date */}
            <div style={{ flex: 1, paddingRight: 24 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="MB Health & Safety" style={{ height: 44, display: 'block', marginBottom: 14 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <div style={{ fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: NAVY, opacity: 0.7, marginBottom: 6 }}>{reportTitle}</div>
              {subtitle ? (
                <>
                  <div style={{ fontSize: 28, fontWeight: 900, color: NAVY, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{subtitle}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Date generated: {todayUK}</div>
                </>
              ) : (
                <>
                  <h1 style={{ fontSize: 22, fontWeight: 900, color: NAVY, margin: '0 0 6px' }}>{reportTitle}</h1>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Date generated: {todayUK}</div>
                </>
              )}
            </div>
            {/* Right: site logo (falls back to org logo) */}
            {(siteLogo || orgLogo) && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={siteLogo || orgLogo} alt="" style={{ maxHeight: 90, maxWidth: 200, objectFit: 'contain', display: 'block', alignSelf: 'center' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
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
          McCormack Besnon Health &amp; Safety — Health &amp; Safety Status Report · {todayUK}
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
