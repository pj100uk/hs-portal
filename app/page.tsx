"use client";
import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronRight, Building2,
  CheckCircle2, FileText, ArrowLeft, User, Layout,
  Clock, Factory, Wrench, RefreshCw, Database, ExternalLink,
  CheckCircle, Settings, Truck, PenTool, BarChart3, TrendingUp,
  ChevronDown, ChevronUp, Paperclip, MessageSquare, HardHat,
  Zap, Shield, ArrowUpRight, X, Plus, LogOut, Lock, Mail,
  Folder, FolderOpen, File, Pencil, GraduationCap, Heart,
  Warehouse, ShoppingBag, Home, Sparkles, AlertCircle,
  Upload, FileCheck, Trash2, Users, Search, KeyRound, Download,
  Archive, Copy, RotateCcw, Minus, EyeOff, Eye, ArrowRight
} from 'lucide-react';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { supabase } from './lib/supabase';
import { CURRENT_EXTRACTION_VERSION } from '../lib/extraction-version';

// ─── Types ────────────────────────────────────────────────────────────────────
type Priority = 'red' | 'amber' | 'green';
type ActionStatus = 'open' | 'resolved' | 'pending_review' | 'archived' | 'ai_suggested';
type AppView = 'portfolio' | 'site' | 'admin';
type AdminTab = 'organisations' | 'sites' | 'users' | 'requirements' | 'usage' | 'data-health' | 'sync-logs';

interface Action {
  id: string; action: string; description: string; date: string; site: string;
  who: string; contractor?: string; source: string; source_document_id?: string;
  priority: Priority; regulation: string; notes: string; evidenceLabel?: string; status: ActionStatus;
  hazardRef?: string | null; hazard?: string | null; existingControls?: string | null;
  riskRating?: string | null; riskLevel?: string | null; resolvedDate?: string | null; sourceFolderId?: string | null;
  isSuggested?: boolean; updatedAt?: string | null; sourceFolderPath?: string | null; issueDate?: string | null; dattoFileId?: string | null;
  reviewNote?: string | null;
}
interface ActionEvidence {
  id: string;
  fileName: string;
  fileSizeBytes: number | null;
  storagePath: string;
  uploadedAt: string;
  uploadedBy: string | null;
  dattoFileId?: string | null;
  hazardRef?: string | null;
  sourceDocumentId?: string | null;
}

interface Site {
  id: string; name: string; type: string; organisation_id: string | null;
  red: number; amber: number; green: number; compliance: number; lastReview: string;
  trend: number; datto_folder_id: string | null; datto_folder_path?: string | null; advisor_id: string | null;
  last_ai_sync: string | null;
  excluded_datto_folder_ids: string[];
  included_datto_folder_ids?: string[] | null;
  actionProgress: number;
  iagScore: number | null;
  iagWeightedScore: number | null;
  employeeCount: number | null;
  logo_url?: string | null;
}

interface DocumentMeta {
  assessmentDate: string | null;
  reviewDate: string | null;
  assessor: string | null;
  clientConsulted: string | null;
  documentType?: 'general_ra' | 'coshh' | 'dse' | 'fire_ra' | 'other' | null;
}

interface ExtractedAction {
  description: string;
  hazardRef: string | null;
  hazard: string | null;
  existingControls: string | null;
  regulation: string | null;
  riskRating: string | null;
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  responsiblePerson: string | null;
  dueDate: string | null;
  dueDateRelative: string | null;
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | null;
}

interface ReviewAction extends ExtractedAction {
  id: string;
  docName: string;
  docFileId: string;
  docFolderFileId: string;
  docFolderPath: string;
  documentMeta: DocumentMeta | null;
  selected: boolean;
  added: boolean;
  justAdded?: boolean;
  isError?: boolean;
  errorMessage?: string;
  advisorPriority: string | null;
  isUnverified?: boolean;
  unverifiedSignals?: string[];
  pendingActions?: ExtractedAction[];
}
interface Organisation { id: string; name: string; datto_folder_id: string | null; datto_folder_name: string | null; logo_url: string | null; }
interface Profile { role: 'superadmin' | 'advisor' | 'client'; site_id: string | null; organisation_id: string | null; datto_base_path: string | null; view_only: boolean; full_name: string | null; receive_emails: boolean; }
interface SiteDocument {
  id: string; site_id: string; uploaded_by: string | null; uploaded_at: string;
  file_name: string; datto_file_id: string | null; datto_folder_id: string | null;
  file_size_bytes: number | null; document_name: string | null; document_type: string | null;
  issue_date: string | null; expiry_date: string | null;
  people_mentioned: string[] | null; notes: string | null; client_provided: boolean;
}
interface DattoItem { id: string; name: string; type: 'folder' | 'file'; [key: string]: any; }

const DATTO_ROOT_ID = '175942289';
const SITE_TYPES = ['OFFICE', 'SCHOOL', 'HEALTHCARE', 'WAREHOUSE', 'RETAIL', 'CONSTRUCTION', 'CARE_HOME', 'OTHER'];
const SITE_TYPE_LABELS: Record<string, string> = {
  OFFICE: 'Office', SCHOOL: 'School', HEALTHCARE: 'Healthcare',
  WAREHOUSE: 'Warehouse / Industrial', RETAIL: 'Retail',
  CONSTRUCTION: 'Construction', CARE_HOME: 'Care Home', OTHER: 'Other',
};
const getSiteLabel = (type: string) => SITE_TYPE_LABELS[type] ?? type;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  const na = norm(a); const nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const wordsA = na.split(/\s+/).filter(w => w.length > 3 || /^\d+$/.test(w));
  const wordsB = nb.split(/\s+/).filter(w => w.length > 3 || /^\d+$/.test(w));
  const setBo = wordsB.reduce((acc: Record<string,boolean>, w) => { acc[w] = true; return acc; }, {});
  const intersection = wordsA.filter(w => setBo[w]).length;
  const unionSize = Array.from(new Set(wordsA.concat(wordsB))).length;
  return unionSize > 0 ? intersection / unionSize : 0;
}

const formatExtractedText = (text: string) => {
  // HTML content (from XML-parsed routes) — must use div, not span, to validly contain <p> children
  if (text.trimStart().startsWith('<')) {
    const liCount = (text.match(/<li/g) ?? []).length;
    const totalBullets = (text.match(/•/g) ?? []).length;
    const bulletParaCount = (text.match(/<p[^>]*>\s*•/g) ?? []).length;

    console.log('[fmt-html]', 'li:', liCount, 'bullets:', totalBullets, 'bullet-p:', bulletParaCount);
    let html = text;
    if (liCount > 4) {
      // Proper <ul><li> list — inject column styles
      html = html
        .replace(/<ul>/g, '<ul style="columns:2;column-gap:1.5rem;list-style-type:disc;padding-left:1rem;margin:0.25rem 0">')
        .replace(/<li>/g, '<li style="break-inside:avoid;margin-bottom:0.125rem">');
    } else if (totalBullets > 1) {
      // Mammoth renders manual • bullets inside <p> tags (may be at start or inside <em>/<strong>)
      const items: string[] = [];
      const processed = html.replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (fullMatch: string, inner: string) => {
        if (!inner.includes('•')) return fullMatch;
        // Split paragraph content by • to extract individual bullet items
        inner.split('•')
          .map((s: string) => s.trim())
          .filter((s: string) => s.replace(/<[^>]*>/g, '').trim().length > 0)
          .forEach((s: string) => items.push(s));
        return '';
      });
      if (items.length > 1) {
        const useColumns = items.length > 3;
        const ulStyle = `list-style-type:disc;padding-left:1rem;margin:0.25rem 0${useColumns ? ';columns:2;column-gap:1.5rem' : ''}`;
        const liStyle = 'break-inside:avoid;font-size:12px;color:#475569;margin-bottom:0.125rem';
        html = processed + `<ul style="${ulStyle}">${items.map((item: string) => `<li style="${liStyle}">${item}</li>`).join('')}</ul>`;
      }
    }

    return (
      <div
        className="text-[12px] text-slate-600 [&_p]:mb-1 [&_p:last-child]:mb-0 [&_em]:italic [&_strong]:font-bold"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  // Pre-pass: collect all bullet lines regardless of blank-line separation between them.
  // Without this, bullets separated by blank lines each become single-line paragraphs → <p> tags.
  const allLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bulletLines = allLines.filter(l => l.startsWith('•'));
  if (bulletLines.length > 1) {
    console.log('[fmt] plain-text pre-pass hit, bullets:', bulletLines.length);
    const clean = bulletLines.map(l => l.slice(1).trim());
    const avgLen = clean.reduce((s, c) => s + c.length, 0) / clean.length;
    const useColumns = clean.length > 3 && avgLen < 80;
    return (
      <ul style={{ listStyleType: 'disc', paddingLeft: '1rem', border: '2px solid blue', ...(useColumns ? { columns: 2, columnGap: '1.5rem' } : {}) }}>
        {clean.map((item, i) => (
          <li key={i} style={{ breakInside: 'avoid', fontSize: '12px', color: '#475569', marginBottom: '0.125rem' }}>{item}</li>
        ))}
      </ul>
    );
  }

  console.log('[fmt] fell through to paragraph path, text:', JSON.stringify(text.slice(0, 80)));

  // Normalise explicit • bullets to newlines, then split into paragraphs (blank lines)
  const normalised = text.replace(/\s*•\s*/g, '\n• ');
  const paragraphs = normalised.split(/\r?\n[ \t]*\r?\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return <span>{text}</span>;

  // If multiple paragraphs are all single-line items, collect into one list with column layout.
  // This handles Gemini returning items separated by blank lines rather than as a single block.
  const allSingleLine = paragraphs.every(p => !p.includes('\n'));
  if (paragraphs.length > 1 && allSingleLine) {
    const clean = paragraphs.map(p => p.startsWith('•') ? p.slice(1).trim() : p);
    const avgLen = clean.reduce((s, c) => s + c.length, 0) / clean.length;
    const useColumns = clean.length > 3 && avgLen < 80;
    return (
      <ul style={{ listStyleType: 'disc', paddingLeft: '1rem', ...(useColumns ? { columns: 2, columnGap: '1.5rem' } : {}) }}>
        {clean.map((item, i) => <li key={i} style={{ breakInside: 'avoid', fontSize: '12px', color: '#475569', marginBottom: '0.125rem' }}>{item}</li>)}
      </ul>
    );
  }

  const renderPara = (para: string, key: number) => {
    const lines = para.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    // Single-line prose — plain text, no bullets, no columns
    if (lines.length <= 1) {
      return <p key={key} className="text-[12px] text-slate-600">{lines[0] ?? ''}</p>;
    }
    // Multiple lines within a paragraph (enumeration / list) — bullet each line
    const clean = lines.map(l => l.startsWith('•') ? l.slice(1).trim() : l);
    const avgLen = clean.reduce((s, c) => s + c.length, 0) / clean.length;
    const useColumns = clean.length > 3 && avgLen < 80;
    return (
      <ul key={key} style={{ listStyleType: 'disc', paddingLeft: '1rem', ...(useColumns ? { columns: 2, columnGap: '1.5rem' } : {}) }}>
        {clean.map((line, i) => <li key={i} style={{ breakInside: 'avoid', fontSize: '12px', color: '#475569', marginBottom: '0.125rem' }}>{line}</li>)}
      </ul>
    );
  };

  if (paragraphs.length === 1) return renderPara(paragraphs[0], 0);
  return (
    <div className="flex flex-col gap-2">
      {paragraphs.map((para, pi) => renderPara(para, pi))}
    </div>
  );
};

const getSiteIcon = (type: string, size = 20) => {
  switch (type) {
    case 'OFFICE': return <Building2 size={size} />;
    case 'SCHOOL': return <GraduationCap size={size} />;
    case 'HEALTHCARE': return <Heart size={size} />;
    case 'WAREHOUSE': return <Warehouse size={size} />;
    case 'RETAIL': return <ShoppingBag size={size} />;
    case 'CONSTRUCTION': return <HardHat size={size} />;
    case 'CARE_HOME': return <Home size={size} />;
    default: return <Building2 size={size} />;
  }
};

const priorityConfig = {
  red:   { label: 'Overdue',   bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    bar: 'bg-rose-500',    dot: 'bg-rose-500',    badge: 'bg-rose-100 text-rose-700 border-rose-200' },
  amber: { label: 'Upcoming',  bg: 'bg-amber-100',  border: 'border-amber-200',   text: 'text-amber-700',   bar: 'bg-amber-500',   dot: 'bg-amber-500',   badge: 'bg-amber-200 text-amber-800 border-amber-300' },
  green: { label: 'Scheduled', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', bar: 'bg-emerald-500', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};

const overdueRiskConfig: Record<string, typeof priorityConfig.red> = {
  HIGH:   { label: 'Overdue', bg: 'bg-rose-100',   border: 'border-rose-500',   text: 'text-rose-800',   bar: 'bg-rose-700',   dot: 'bg-rose-700',   badge: 'bg-rose-200 text-rose-900 border-rose-400' },
  MEDIUM: { label: 'Overdue', bg: 'bg-orange-50',  border: 'border-orange-300', text: 'text-orange-700', bar: 'bg-orange-500', dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700 border-orange-200' },
  LOW:    { label: 'Overdue', bg: 'bg-yellow-50',  border: 'border-yellow-300', text: 'text-yellow-700', bar: 'bg-yellow-500', dot: 'bg-yellow-500', badge: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
};

const DERIVE_ONGOING_RE = /on.?going|continuous|continual|continued|continuing|rolling|recurring|recurrent|regular|permanent|indefinite|open.?ended|as.?required|as.?needed|periodic|routine|always|review/i;
const DERIVE_IMMEDIATE_RE = /\b(immediately?|urgent(ly)?|asap|a\.?s\.?a\.?p\.?|as\s+soon\s+as\s+(possible|practicable)|right\s+away|straight\s+away|without\s+delay|at\s+once|now|today)\b/i;

function derivePriority(action: Action): { priority: Priority; label: string } {
  if (action.status === 'resolved' || action.status === 'archived') return { priority: 'green', label: action.status === 'archived' ? 'Archived' : 'Resolved' };
  const today = new Date().toLocaleDateString('en-CA');
  const date = action.date;
  const isOngoing = !!date && DERIVE_ONGOING_RE.test(date);
  if (date && !isOngoing && DERIVE_IMMEDIATE_RE.test(date)) return { priority: 'red', label: 'Immediate' };
  const hasSpecificDate = !!date && !isOngoing && /^\d{4}-\d{2}-\d{2}$/.test(date);
  if (hasSpecificDate) {
    if (date < today) return { priority: 'red', label: 'Overdue' };
    const daysAway = Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
    if (daysAway <= 30) return { priority: 'amber', label: 'Upcoming' };
    return { priority: 'green', label: 'Scheduled' };
  }
  // Relative date stored literally (e.g. "1 Month", "6 Weeks") — resolve using issueDate as base
  if (date && !isOngoing) {
    const lower = date.toLowerCase();
    const n = (pat: RegExp) => { const m = lower.match(pat); return m ? parseInt(m[1]) : 0; };
    const months = n(/(\d+)\s*month/); const weeks = n(/(\d+)\s*week/);
    const days = n(/(\d+)\s*day/); const years = n(/(\d+)\s*year/);
    if (months || weeks || days || years) {
      const base = action.issueDate ? new Date(action.issueDate + 'T00:00:00') : new Date();
      if (months) base.setMonth(base.getMonth() + months);
      else if (weeks) base.setDate(base.getDate() + weeks * 7);
      else if (days) base.setDate(base.getDate() + days);
      else base.setFullYear(base.getFullYear() + years);
      const resolved = base.toLocaleDateString('en-CA');
      if (resolved < today) return { priority: 'red', label: 'Overdue' };
      const daysAway = Math.ceil((base.getTime() - Date.now()) / 86400000);
      if (daysAway <= 30) return { priority: 'amber', label: 'Upcoming' };
      return { priority: 'green', label: 'Scheduled' };
    }
  }
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const lastUpdated = action.updatedAt?.slice(0, 10) ?? null;
  if (lastUpdated && lastUpdated < sixMonthsAgo) return { priority: 'amber', label: 'Review Due' };
  return { priority: 'green', label: 'Review' };
}

const StatusBadge = ({ type, count }: { type: Priority; count: number }) => {
  const c = priorityConfig[type];
  return (
    <div className={`px-2 py-1 rounded-lg border text-[10px] font-black flex items-center gap-1.5 ${c.badge}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />{count} {type.toUpperCase()}
    </div>
  );
};

// ─── Score colour thresholds (Green ≥85%, Amber ≥50%, Red <50%) ──────────────
const ONGOING_RE = /on.?going|continuous|continual|continued|continuing|rolling|recurring|recurrent|regular|permanent|indefinite|open.?ended|as.?required|as.?needed|periodic|routine|always|review/i;
const IMMEDIATE_RE = /\b(immediately?|urgent(ly)?|asap|a\.?s\.?a\.?p\.?|as\s+soon\s+as\s+(possible|practicable)|right\s+away|straight\s+away|without\s+delay|at\s+once|now|today)\b/i;

const computeActionProgress = (actions: Action[]): number => {
  if (actions.length === 0) return 100;
  const today = new Date().toLocaleDateString('en-CA');
  let onTrackPoints = 0, totalPoints = 0;
  for (const a of actions) {
    const d = a.date ?? null;
    const isResolved = a.status === 'resolved' || a.status === 'pending_review' || a.status === 'archived';
    const isImmediate = !isResolved && !!d && IMMEDIATE_RE.test(d) && !ONGOING_RE.test(d);
    const isOverdue = !isResolved && !isImmediate && !!d && !ONGOING_RE.test(d) && /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today;
    const isUpcoming = !isResolved && !isImmediate && !isOverdue && !!d && !ONGOING_RE.test(d) && /^\d{4}-\d{2}-\d{2}$/.test(d)
      && Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) <= 30;
    const w = (isOverdue || isImmediate) ? 2 : 1;
    if (isResolved || (!isOverdue && !isImmediate && !isUpcoming)) onTrackPoints += w;
    totalPoints += w;
  }
  return totalPoints === 0 ? 100 : Math.round((onTrackPoints / totalPoints) * 100);
};

const scoreColor = (score: number) => {
  if (score >= 85) return { text: 'text-emerald-600', bar: 'bg-emerald-500', ring: '#10b981' };
  if (score >= 50) return { text: 'text-amber-500',   bar: 'bg-amber-400',   ring: '#f59e0b' };
  return               { text: 'text-rose-600',       bar: 'bg-rose-500',    ring: '#f43f5e' };
};

const InlineTip = ({ text }: { text: string }) => (
  <span className="relative ml-1 inline-flex items-center">
    <span className="text-slate-400 text-[8px] font-black cursor-default select-none leading-none">?</span>
    <span className="pointer-events-none absolute top-full left-0 mt-1.5 w-52 rounded-lg bg-slate-500 text-white text-xs font-normal normal-case tracking-normal leading-snug px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-lg text-left">
      {text}
    </span>
  </span>
);



const ComplianceRing = ({ score, size = 56, percent = false }: { score: number; size?: number; percent?: boolean }) => {
  const r = 20; const circ = 2 * Math.PI * r; const offset = circ - (score / 100) * circ;
  const color = scoreColor(score).ring;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r={r} stroke="#f1f5f9" strokeWidth="5" fill="none" />
      <circle cx="24" cy="24" r={r} stroke={color} strokeWidth="5" fill="none" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 24 24)" style={{ transition: 'stroke-dashoffset 1s ease' }} />
      {percent
        ? <text x="24" y="29" textAnchor="middle" fontWeight="900" fill={color}><tspan fontSize="12">{score}</tspan><tspan fontSize="8" dy="-1">%</tspan></text>
        : <text x="24" y="28" textAnchor="middle" fontSize="10" fontWeight="900" fill={color}>{score}</text>
      }
    </svg>
  );
};

// ─── Score Explanation Modal ───────────────────────────────────────────────────
const ScoreExplanationModal = ({ card, onClose }: { card: 'implementation' | 'iag' | 'documentation'; onClose: () => void }) => {
  const content = {
    implementation: {
      title: 'Compliance Score Explanation',
      color: 'bg-indigo-600',
      body: (
        <>
          <p className="text-[11px] font-black uppercase tracking-widest text-indigo-600 mb-1">Actions Progress</p>
          <p className="text-sm text-slate-600 leading-relaxed">This measures how well your compliance actions are being managed. The score reflects what percentage of your actions are <strong>on track</strong> — not overdue and not imminently due.</p>
          <p className="text-sm text-slate-600 leading-relaxed mt-3">Not all actions carry equal weight. <strong>Overdue</strong> actions count 2× against your score, while upcoming and scheduled actions count equally. Resolving overdue items has the biggest positive impact.</p>
          <p className="text-sm text-slate-500 mt-3 font-mono bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">Score = on-track weight ÷ total weight × 100</p>
          <p className="text-[11px] font-black uppercase tracking-widest text-indigo-600 mt-5 mb-1">Risk Health</p>
          <p className="text-sm text-slate-600 leading-relaxed">Breaks the score down by risk level — HIGH, MEDIUM, and LOW. It shows how many actions in each category are on track, so you can see at a glance whether your most critical risks are being managed.</p>
          <div className="mt-4 space-y-2">
            {[{ label: '85% – 100%', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', desc: 'Well managed — actions planned and on schedule.' }, { label: '50% – 84%', color: 'bg-amber-100 text-amber-700 border-amber-200', desc: 'Attention needed — overdue or urgent actions present.' }, { label: '0% – 49%', color: 'bg-rose-100 text-rose-700 border-rose-200', desc: 'High risk — significant overdue actions require immediate attention.' }].map(t => (
              <div key={t.label} className={`flex items-start gap-3 text-xs font-bold px-3 py-2 rounded-xl border ${t.color}`}><span className="shrink-0">{t.label}</span><span className="font-normal">{t.desc}</span></div>
            ))}
          </div>
        </>
      ),
    },
    iag: {
      title: 'Industry Alignment Score',
      color: 'bg-violet-600',
      body: (
        <>
          <p className="text-sm text-slate-600 leading-relaxed">This measures how well the services you have contracted match what is typically required for this type of site. Each service is marked as <strong>Mandatory</strong> (legally required) or <strong>Recommended</strong> (best practice).</p>
          <p className="text-sm text-slate-600 leading-relaxed mt-3">If any mandatory service is not covered, the <strong>Mandatory</strong> badge highlights in red — because these carry legal risk. The overall score still reflects the percentage of all requirements contracted.</p>
          <p className="text-sm text-slate-500 mt-3 font-mono bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">Score = contracted services ÷ total requirements × 100</p>
          <div className="mt-4 space-y-2">
            {[{ label: '85% – 100%', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', desc: 'Strong coverage for your site type.' }, { label: '50% – 84%', color: 'bg-amber-100 text-amber-700 border-amber-200', desc: 'Coverage gaps identified.' }, { label: '0% – 49%', color: 'bg-rose-100 text-rose-700 border-rose-200', desc: 'Significant gaps — review recommended.' }].map(t => (
              <div key={t.label} className={`flex items-start gap-3 text-xs font-bold px-3 py-2 rounded-xl border ${t.color}`}><span className="shrink-0">{t.label}</span><span className="font-normal">{t.desc}</span></div>
            ))}
          </div>
        </>
      ),
    },
    documentation: {
      title: 'Document Management',
      color: 'bg-amber-500',
      body: (
        <>
          <p className="text-sm text-slate-600 leading-relaxed">This measures how current your documents are. A document is considered current if its review date has not yet passed.</p>
          <p className="text-sm text-slate-600 leading-relaxed mt-3">Documents expiring within 30 days are flagged with an amber warning but still count as current — the score drops only when the review date actually passes.</p>
          <p className="text-sm text-slate-500 mt-3 font-mono bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">Score = current documents ÷ total documents × 100</p>
          <div className="mt-4 space-y-2">
            {[{ label: '85% – 100%', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', desc: 'Records are up to date.' }, { label: '50% – 84%', color: 'bg-amber-100 text-amber-700 border-amber-200', desc: 'Several documents need review.' }, { label: '0% – 49%', color: 'bg-rose-100 text-rose-700 border-rose-200', desc: 'Majority of records out of date.' }].map(t => (
              <div key={t.label} className={`flex items-start gap-3 text-xs font-bold px-3 py-2 rounded-xl border ${t.color}`}><span className="shrink-0">{t.label}</span><span className="font-normal">{t.desc}</span></div>
            ))}
          </div>
        </>
      ),
    },
  }[card];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className={`${content.color} px-6 py-4 flex items-center justify-between`}>
          <h2 className="font-black text-white text-sm uppercase tracking-widest">{content.title}</h2>
          <button onClick={onClose} title="Dismiss" className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-6">{content.body}</div>
        <div className="px-6 pb-6"><button onClick={onClose} title="Dismiss" className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[11px] uppercase tracking-widest rounded-xl transition-colors">Got it</button></div>
      </div>
    </div>
  );
};

const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function buildOfficeUri(basePath: string, folderPath: string, fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const scheme = ext === 'docx' || ext === 'doc' ? 'ms-word'
               : ext === 'xlsx' || ext === 'xls' ? 'ms-excel'
               : ext === 'pptx' || ext === 'ppt' ? 'ms-powerpoint'
               : null;
  if (!scheme) return null;
  // Normalise base path separators to forward slashes, strip trailing slash
  const base = basePath.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = [base, ...folderPath.split('/').filter(Boolean), fileName];
  const encode = (s: string) => s.replace(/ /g, '%20').replace(/&/g, '%26').replace(/#/g, '%23');
  if (base.startsWith('//')) {
    // UNC path (//Paul/Workplace/Customer Documents) — convert to drive letter path.
    // Drive-letter file:/// URIs reduce Word's network security prompting.
    // Use stored drive letter from auto-detect (default W: if not set).
    const driveLetter = (typeof window !== 'undefined' ? localStorage.getItem('dattoDriveLetter') : null) || 'W';
    const afterWorkplace = base.replace(/^\/\/[^/]+\/Workplace/i, '') || '';
    const drivePath = `${driveLetter}:${afterWorkplace}`; // e.g. W:/Customer Documents
    const driveParts = [drivePath, ...folderPath.split('/').filter(Boolean), fileName];
    return `${scheme}:ofe|u|file:///${driveParts.map(encode).join('/')}`;
  }
  // Local drive path (W:/Customer Documents or similar) — use as-is
  return `${scheme}:ofe|u|file:///${parts.map(encode).join('/')}`;
}
const toUKDate = (iso: string) => { if (!isIsoDate(iso)) return iso; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };
function apiErr(data: any, fallback: string): string {
  const base = (data?.error as string | undefined) ?? fallback;
  const raw = data?.detail;
  if (!raw) return base;
  const d = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return `${base} — ${d.length > 300 ? d.slice(0, 300) + '…' : d}`;
}
function highlight(text: string | null | undefined, query: string): React.ReactNode {
  if (!query.trim() || !text) return text ?? '';
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5">{part}</mark>
      : part
  );
}
const daysLate = (resolvedDate: string, dueDate: string): number => {
  if (!isIsoDate(resolvedDate) || !isIsoDate(dueDate)) return 0;
  return Math.round((new Date(resolvedDate + 'T00:00:00').getTime() - new Date(dueDate + 'T00:00:00').getTime()) / 86400000);
};

function getFileHref(file: DattoItem, folderPath: string, role: string, userId?: string, siteId?: string): string {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const officeExts = ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'];
  if ((role === 'advisor' || role === 'superadmin') && officeExts.includes(ext)) {
    const basePath = typeof window !== 'undefined' ? (localStorage.getItem('dattoBasePath') || 'W:/Customer Documents') : 'W:/Customer Documents';
    const uri = buildOfficeUri(basePath, folderPath, file.name);
    if (uri) return uri;
  }
  // Clients always get PDF via viewer — never raw Office files
  if (role === 'client') {
    const activitySuffix = userId ? `&userId=${encodeURIComponent(userId)}${siteId ? `&siteId=${encodeURIComponent(siteId)}` : ''}` : '';
    return `/viewer?fileId=${file.id}&fileName=${encodeURIComponent(file.name)}&role=${role}${activitySuffix}`;
  }
  return `/api/datto/file?fileId=${file.id}&fileName=${encodeURIComponent(file.name)}`;
}

function fileTypeBadge(name: string): { label: string; cls: string } {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return { label: 'PDF', cls: 'bg-rose-100 text-rose-700' };
  if (ext === 'docx') return { label: 'DOCX', cls: 'bg-blue-100 text-blue-700' };
  if (ext === 'doc') return { label: 'DOC', cls: 'bg-blue-200 text-blue-800' };
  if (ext === 'xlsx' || ext === 'xls') return { label: 'XLS', cls: 'bg-emerald-100 text-emerald-700' };
  if (ext === 'pptx' || ext === 'ppt') return { label: 'PPT', cls: 'bg-orange-100 text-orange-700' };
  return { label: ext.toUpperCase() || 'FILE', cls: 'bg-slate-100 text-slate-500' };
}

// ─── Action Card ──────────────────────────────────────────────────────────────
type ReadDiff = { actionText: string; responsiblePerson: string; targetDate: string; completedDate: string };
const ActionCard = ({ action, isResolved, onToggleResolve, onAddNote, onDelete, onUpdateIssueDate, onUpdateField, onClientSubmit, onClientWithdraw, onAdvisorConfirm, onAdvisorReject, onApplyFromWord, onRestore, role, canDelete, expanded, onExpand, siteId, userId, onFlash, searchQuery }: {
  action: Action; isResolved: boolean; onToggleResolve: (id: string) => void; onAddNote: (id: string, note: string) => void; onDelete?: (id: string) => void; onUpdateIssueDate?: (id: string, date: string | null) => void; onUpdateField?: (id: string, updates: { date?: string; who?: string; action?: string }) => void; onClientSubmit?: (id: string) => void; onClientWithdraw?: (id: string) => void; onAdvisorConfirm?: (id: string) => void; onAdvisorReject?: (id: string, note: string) => void; onApplyFromWord?: (id: string, diff: ReadDiff) => void; onRestore?: (id: string) => void; role: string; canDelete?: boolean; expanded: boolean; onExpand: () => void; siteId?: string; userId?: string; onFlash?: (msg: string) => void; searchQuery?: string;
}) => {
  const [noteText, setNoteText] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [editingIssueDate, setEditingIssueDate] = useState(false);
  const [issueDateInput, setIssueDateInput] = useState(action.issueDate || '');
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [dueDateInput, setDueDateInput] = useState(action.date || '');
  const [editingWho, setEditingWho] = useState(false);
  const [whoInput, setWhoInput] = useState(action.who || '');
  const [editingAction, setEditingAction] = useState(false);
  const [actionInput, setActionInput] = useState(action.action || '');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [readDiff, setReadDiff] = useState<ReadDiff | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [evidence, setEvidence] = useState<ActionEvidence[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [draggingEvidence, setDraggingEvidence] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const today = new Date().toLocaleDateString('en-CA');

  React.useEffect(() => {
    if (!expanded) return;
    setEvidenceLoading(true);
    fetch(`/api/actions/${action.id}/evidence`)
      .then(r => r.json())
      .then(d => setEvidence(d.evidence ?? []))
      .catch(() => {})
      .finally(() => setEvidenceLoading(false));
  }, [expanded, action.id]);
  const isOngoing = !!action.date && ONGOING_RE.test(action.date);
  const isOverdue = !isResolved && !isOngoing && !!action.date && action.date < today;
  const { priority: derivedPriority, label: derivedLabel } = derivePriority(action);
  const cfg = (!isResolved && derivedPriority === 'red' && action.riskLevel && overdueRiskConfig[action.riskLevel])
    ? overdueRiskConfig[action.riskLevel]
    : priorityConfig[derivedPriority];

  const canSync = !!(action.source_document_id && action.sourceFolderId && action.hazardRef);

  const doSync = async (completedDateOverride?: string) => {
    if (!canSync) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/datto/file/writeback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: action.source_document_id,
          folderId: action.sourceFolderId,
          fileName: action.source,
          hazardRef: action.hazardRef,
          actionText: action.action,
          responsiblePerson: action.who || undefined,
          targetDate: action.date ? toUKDate(action.date) : undefined,
          completedDate: (() => { const d = completedDateOverride ?? action.resolvedDate ?? null; return d ? toUKDate(d) : undefined; })(),
        }),
      });
      const data = await res.json();
      if (res.ok) setSyncResult({ ok: true, msg: 'Word document updated.' });
      else setSyncResult({ ok: false, msg: `${data.error || 'Sync failed.'}${data.detail ? ` — ${data.detail}` : ''}${data.status ? ` (HTTP ${data.status})` : ''}` });
    } catch {
      setSyncResult({ ok: false, msg: 'Network error.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncToDoc = async () => {
    if (!window.confirm('This will write the current portal values to the original Word document in Datto. Continue?')) return;
    doSync();
  };

  const handleReadFromWord = async () => {
    setReading(true);
    setSyncResult(null);
    setReadDiff(null);
    try {
      const res = await fetch('/api/datto/file/readback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: action.source_document_id, hazardRef: action.hazardRef }),
      });
      const data = await res.json();
      if (!res.ok) { setSyncResult({ ok: false, msg: apiErr(data, 'Read failed.') }); return; }
      setReadDiff(data as ReadDiff);
    } catch {
      setSyncResult({ ok: false, msg: 'Network error.' });
    } finally {
      setReading(false);
    }
  };

  const uploadEvidenceFile = async (file: File) => {
    if (!siteId) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('siteId', siteId);
    if (userId) fd.append('userId', userId);
    if (action.sourceFolderId) fd.append('sourceFolderId', action.sourceFolderId);
    if (action.sourceFolderPath) fd.append('sourceFolderPath', action.sourceFolderPath);
    if (action.hazardRef) fd.append('hazardRef', action.hazardRef);
    if (action.source_document_id) fd.append('sourceDocumentId', action.source_document_id);
    if (action.source) fd.append('sourceDocumentName', action.source);
    const res = await fetch(`/api/actions/${action.id}/evidence`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { onFlash?.(apiErr(data, 'Upload failed')); return; }
    setEvidence(prev => [...prev, data.evidence]);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !siteId) return;
    setUploading(true);
    try { for (const file of Array.from(files)) await uploadEvidenceFile(file); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const handleDeleteEvidence = async (ev: ActionEvidence) => {
    if (!window.confirm(`Remove "${ev.fileName}" from this action?`)) return;
    const res = await fetch(`/api/actions/${action.id}/evidence?evidenceId=${ev.id}`, { method: 'DELETE' });
    if (res.ok) setEvidence(prev => prev.filter(e => e.id !== ev.id));
    else onFlash?.('Delete failed — try again.');
  };

  const openEvidence = async (ev: ActionEvidence) => {
    // Advisors: open via W: drive if file is in Datto and folder path is known
    if ((role === 'advisor' || role === 'superadmin') && ev.dattoFileId && action.sourceFolderPath) {
      const href = getFileHref(
        { id: ev.dattoFileId, name: ev.fileName, type: 'file' },
        `${action.sourceFolderPath ? action.sourceFolderPath.split('/').slice(0, -1).join('/') : ''}/Evidence`,
        role
      );
      if (href) { window.location.href = href; return; }
    }
    // Clients: force download. Advisors without W: drive path: open in new tab.
    const isClient = role === 'client';
    const res = await fetch(`/api/actions/${action.id}/evidence?signedUrl=${ev.id}${isClient ? '&download=true' : ''}`);
    const data = await res.json();
    if (res.ok && data.url) {
      if (isClient) {
        const a = document.createElement('a');
        a.href = data.url; a.download = ev.fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      } else {
        window.open(data.url, '_blank');
      }
    } else { console.error('[openEvidence]', data.error); onFlash?.('Could not open file — try again.'); }
  };

  const handleResolve = () => {
    const resolving = !isResolved;
    onToggleResolve(action.id);
    if (resolving && canSync) {
      const today = new Date().toLocaleDateString('en-CA');
      doSync(today);
    }
  };

  const docLinkEl = action.source ? (
    (role === 'advisor' || role === 'superadmin') && action.sourceFolderPath ? (() => {
      const href = getFileHref({ id: action.source_document_id || '', name: action.source, type: 'file' }, action.sourceFolderPath!, role);
      const cls = 'flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex-shrink-0';
      return href.startsWith('ms-')
        ? <a href={href} className={cls}><ExternalLink size={12} className="text-indigo-500 flex-shrink-0" /><span className="font-normal text-slate-400">Open Document:</span>{action.source}</a>
        : <a href={href} target="_blank" rel="noopener noreferrer" className={cls}><ExternalLink size={12} className="text-indigo-500 flex-shrink-0" /><span className="font-normal text-slate-400">Open Document:</span>{action.source}</a>;
    })()
    : role === 'client' && action.source_document_id ? (() => {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(action.source_document_id!);
      const viewerHref = isUUID
        ? `/viewer?docId=${action.source_document_id}&fileName=${encodeURIComponent(action.source)}&role=${role}`
        : `/viewer?fileId=${action.source_document_id}&fileName=${encodeURIComponent(action.source)}&role=${role}`;
      return <a href={viewerHref} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex-shrink-0"><ExternalLink size={12} className="text-indigo-500 flex-shrink-0" /><span className="font-normal text-slate-400">Open Document:</span>{action.source}</a>;
    })()
    : <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 flex-shrink-0"><File size={12} className="text-slate-400 flex-shrink-0" /><span className="font-normal text-slate-400">Document:</span>{action.source}</span>
  ) : null;

  const isArchived = action.status === 'archived';
  return (
    <div className={`rounded-lg border transition-all duration-300 overflow-hidden ${isArchived ? 'bg-slate-50 border-slate-200 opacity-60' : action.status === 'pending_review' ? 'bg-amber-50/60 border-amber-200' : action.status === 'open' && action.reviewNote ? 'bg-rose-50/60 border-rose-200' : `${cfg.bg} ${cfg.border}`}`}>
      <div className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-3 cursor-pointer" onClick={onExpand}>
        <div className={`w-1.5 rounded-full self-stretch hidden md:block flex-shrink-0 ${cfg.bar}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className={`font-bold text-[12px] leading-snug ${isResolved ? 'text-slate-400' : 'text-slate-900'}`}>{highlight((action.source || action.action).replace(/\.[^.]+$/, ''), searchQuery ?? '')}</span>
              {action.hazardRef && <><span className="text-slate-300 text-[11px]">|</span><span className="text-[12px] font-bold text-violet-500 flex-shrink-0">Hazard No. {highlight(action.hazardRef, searchQuery ?? '')}</span></>}
              {action.issueDate && <><span className="text-slate-300 text-[11px]">|</span><span className="text-[12px] font-medium text-slate-500 flex-shrink-0"><span className="text-slate-400 font-normal">Issued: </span>{toUKDate(action.issueDate)}</span></>}
              {action.date && !isResolved && (
                <>
                  <span className="text-slate-300 text-[11px]">|</span>
                  <span className="text-[12px] font-medium text-slate-500 flex-shrink-0"><span className="text-slate-400 font-normal">Due: </span>{toUKDate(action.date)}</span>
                </>
              )}
              {action.resolvedDate && (
                <>
                  <span className="text-slate-300 text-[11px]">|</span>
                  <span className="text-[12px] font-medium text-emerald-600 flex-shrink-0">
                    <span className="text-slate-500 font-bold">Resolved: </span>{toUKDate(action.resolvedDate)}
                    {(() => { const d = (action.date && isIsoDate(action.resolvedDate) && isIsoDate(action.date)) ? daysLate(action.resolvedDate, action.date) : 0; return d > 30 ? <span className="text-amber-600 font-semibold ml-1">({d} days late)</span> : null; })()}
                  </span>
                </>
              )}
              {(action as any).isSuggested &&<span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border border-violet-200 text-violet-600 bg-violet-50 flex-shrink-0">AI Suggested</span>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {action.riskLevel && (() => {
                const riskDarkCls = action.riskLevel === 'HIGH' ? 'bg-rose-600 text-white border-rose-700'
                  : action.riskLevel === 'MEDIUM' ? 'bg-orange-200 text-orange-800 border-orange-300'
                  : 'bg-emerald-200 text-emerald-800 border-emerald-300';
                return <span className={`text-[10px] font-black uppercase w-28 py-1 rounded-full border text-center ${riskDarkCls}`}>{action.riskLevel} Risk</span>;
              })()}
              {isArchived ? (
                <span className="text-[10px] font-black uppercase w-28 py-1 rounded-full border text-center bg-slate-100 border-slate-300 text-slate-500 flex items-center justify-center gap-1"><Archive size={9} />Archived</span>
              ) : action.status === 'open' && action.reviewNote ? (
                <span className="text-[10px] font-black uppercase w-28 py-1 rounded-full border text-center bg-rose-100 border-rose-300 text-rose-700 flex items-center justify-center gap-1"><X size={9} />Returned</span>
              ) : action.status === 'pending_review' ? (
                <span className="text-[10px] font-black uppercase w-28 py-1 rounded-full border text-center bg-amber-100 border-amber-300 text-amber-700 flex items-center justify-center gap-1"><Clock size={9} />Pending</span>
              ) : isResolved ? (
                <span className="text-[10px] font-black uppercase w-28 py-1 rounded-full border text-center bg-white border-slate-200 text-slate-400">Resolved</span>
              ) : isOngoing ? (
                <span className="text-[10px] font-black uppercase w-28 py-1 rounded-full border text-center bg-emerald-50 border-emerald-200 text-emerald-700">Ongoing</span>
              ) : (
                (() => {
                  const dueLightCls = derivedPriority === 'red' ? 'bg-rose-200 text-rose-700 border-rose-300'
                    : derivedPriority === 'amber' ? 'bg-amber-200 text-amber-800 border-amber-300'
                    : 'bg-emerald-50 text-emerald-500 border-emerald-100';
                  return <span className={`text-[10px] font-black uppercase w-28 py-1 rounded-full border text-center ${dueLightCls}`}>{derivedLabel}</span>;
                })()
              )}
            </div>
          </div>
          {action.contractor && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <span className="flex items-center gap-1.5"><HardHat size={12} /><span className="text-slate-700">{action.contractor}</span></span>
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-white/60 bg-white/60 backdrop-blur-sm px-6 py-4 space-y-3">
          {/* Top row: issue date + due date + responsible person left, view doc link right */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 flex-wrap text-[12px] font-medium text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="text-slate-500 font-normal text-[11px] uppercase tracking-wider">Issued:</span>
                <span>
                  {action.issueDate ? toUKDate(action.issueDate) : <span className="text-slate-300 font-normal italic text-xs">not set</span>}
                </span>
              </span>
              {!isResolved && <><span className="text-slate-300">|</span><span className="flex items-center gap-1"><span className="text-slate-500 font-normal">Due Date: </span>{role === 'advisor' ? (editingDueDate ? (<input type={dueDateInput && !isIsoDate(dueDateInput) ? 'text' : 'date'} value={dueDateInput} autoFocus onClick={e => e.stopPropagation()} onChange={e => setDueDateInput(e.target.value)} onBlur={() => { setEditingDueDate(false); onUpdateField?.(action.id, { date: dueDateInput }); }} onKeyDown={e => { if (e.key === 'Enter') { setEditingDueDate(false); onUpdateField?.(action.id, { date: dueDateInput }); } if (e.key === 'Escape') { setDueDateInput(action.date || ''); setEditingDueDate(false); } }} className="text-sm font-bold text-slate-700 border-b border-indigo-400 outline-none bg-transparent" />) : (<span onClick={e => { e.stopPropagation(); setDueDateInput(action.date || ''); setEditingDueDate(true); }} className={`cursor-pointer hover:text-indigo-600 hover:underline decoration-dotted ${!action.date ? 'text-amber-400 italic text-xs font-normal' : ''}`} title="Click to edit due date">{action.date ? toUKDate(action.date) : 'no date — click to set'}</span>)) : (<span>{action.date ? toUKDate(action.date) : '—'}</span>)}</span></>}
              {action.resolvedDate && <><span className="text-slate-300">|</span><span className="text-emerald-600"><span className="text-slate-500 font-bold">Resolved: </span>{toUKDate(action.resolvedDate)}{(() => { const d = (action.date && isIsoDate(action.resolvedDate) && isIsoDate(action.date)) ? daysLate(action.resolvedDate, action.date) : 0; return d > 30 ? <span className="text-amber-600 font-semibold ml-1">({d} days late)</span> : null; })()}</span></>}
              <><span className="text-slate-300">|</span><span className="flex items-center gap-1"><span className="text-slate-500 font-normal">Responsibility: </span>{role === 'advisor' ? (editingWho ? (<input type="text" value={whoInput} autoFocus onClick={e => e.stopPropagation()} onChange={e => setWhoInput(e.target.value)} onBlur={() => { setEditingWho(false); onUpdateField?.(action.id, { who: whoInput }); }} onKeyDown={e => { if (e.key === 'Enter') { setEditingWho(false); onUpdateField?.(action.id, { who: whoInput }); } if (e.key === 'Escape') { setWhoInput(action.who || ''); setEditingWho(false); } }} className="text-sm font-bold text-slate-700 border-b border-indigo-400 outline-none bg-transparent w-40" />) : (<span onClick={e => { e.stopPropagation(); setWhoInput(action.who || ''); setEditingWho(true); }} className={`cursor-pointer hover:text-indigo-600 hover:underline decoration-dotted ${!action.who ? 'text-amber-400 italic text-xs font-normal' : ''}`} title="Click to edit responsible person">{action.who ? highlight(action.who, searchQuery ?? '') : 'not set — click to add'}</span>)) : (<span>{highlight(action.who, searchQuery ?? '')}</span>)}</span></>
            </div>
            {canDelete && onDelete && (
              <button onClick={e => { e.stopPropagation(); if (confirm('Delete this action? This cannot be undone.')) onDelete(action.id); }} title="Permanently delete this action from the portal" className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-400 transition-colors flex-shrink-0">
                <Trash2 size={11} />Delete from portal database
              </button>
            )}
          </div>
          {/* Contractor + regulation row */}
          {(action.contractor || action.regulation) && (
            <div className="flex flex-wrap gap-6">
              {action.contractor && <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-0.5">Contractor</p><p className="text-sm font-bold text-slate-700">{action.contractor}</p></div>}
              {action.regulation && <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-0.5">Regulation</p><p className="text-sm font-bold text-slate-700">{action.regulation}</p></div>}
            </div>
          )}
          {/* Hazard & Existing Controls */}
          {(action.hazard || action.existingControls) && (
            <div className="space-y-2 pl-1">
              {action.hazard && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-600 mb-0.5">
                    {action.hazardRef ? `Hazard No. ${action.hazardRef}` : 'Hazard'}
                  </p>
                  {formatExtractedText(action.hazard)}
                </div>
              )}
              {action.existingControls && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-600 mb-0.5">Existing Measures</p>
                  {formatExtractedText(action.existingControls)}
                </div>
              )}
            </div>
          )}
          {(action.action || role === 'advisor') && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-rose-600 mb-0.5">Action Required</p>
              {role === 'advisor' ? (editingAction ? (
                <textarea value={actionInput} autoFocus rows={3} onClick={e => e.stopPropagation()} onChange={e => setActionInput(e.target.value)} onBlur={() => { setEditingAction(false); onUpdateField?.(action.id, { action: actionInput }); }} onKeyDown={e => { if (e.key === 'Escape') { setActionInput(action.action || ''); setEditingAction(false); } }} className="text-[12px] text-slate-700 border-b border-indigo-400 outline-none bg-transparent w-full resize-none" />
              ) : (
                <p onClick={e => { e.stopPropagation(); setActionInput(action.action || ''); setEditingAction(true); }} className="text-[12px] text-slate-700 cursor-pointer hover:text-indigo-600 hover:underline decoration-dotted" title="Click to edit action text">{highlight(action.action, searchQuery ?? '')}</p>
              )) : (
                <p className="text-[12px] text-slate-700">{highlight(action.action, searchQuery ?? '')}</p>
              )}
            </div>
          )}
          {action.reviewNote && action.status === 'open' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
              <AlertCircle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-amber-700 mb-0.5">Advisor Note</p>
                <p className="text-[12px] text-amber-800">{action.reviewNote}</p>
              </div>
            </div>
          )}
          <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Requirement Detail</p><p className="text-sm text-slate-700 leading-relaxed">{action.description}</p></div>
          {/* AI Suggestion mini-card — only shown when there's a regulation to display */}
          {action.regulation && (
            <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3 space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-violet-500 flex items-center gap-1.5">
                <Sparkles size={10} />AI Suggestion
              </span>
              <p className="text-[11px] text-slate-600"><span className="font-black">Regulation:</span> {action.regulation}</p>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 flex items-center gap-1.5"><MessageSquare size={11} />Advisor Notes</p>
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 min-h-[48px]">{action.notes || <span className="text-slate-300 italic">No notes added.</span>}</div>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5"><Paperclip size={11} />Evidence</span>
                {action.source && (
                  <a href={`/api/actions/${action.id}/evidence-form`} download className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-indigo-400 hover:text-indigo-600 transition-colors">
                    <FileText size={10} />Download Acknowledgement Form
                  </a>
                )}
              </p>
              <div
                onClick={() => !uploading && fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDraggingEvidence(true); }}
                onDragEnter={e => { e.preventDefault(); setDraggingEvidence(true); }}
                onDragLeave={() => setDraggingEvidence(false)}
                onDrop={async e => { e.preventDefault(); setDraggingEvidence(false); const files = e.dataTransfer.files; if (!files?.length || uploading) return; setUploading(true); try { for (const file of Array.from(files)) await uploadEvidenceFile(file); } finally { setUploading(false); } }}
                className={`rounded-xl border border-dashed px-4 py-3 flex items-center justify-center gap-2 cursor-pointer transition-colors ${draggingEvidence ? 'border-indigo-400 bg-indigo-50' : 'bg-white border-slate-200 hover:border-indigo-300 group'}`}
              >
                {uploading ? <span className="text-xs text-slate-400">Uploading…</span> : draggingEvidence ? <><Plus size={14} className="text-indigo-400" /><span className="text-xs font-bold text-indigo-600">Drop to upload</span></> : <><Plus size={14} className="text-slate-300 group-hover:text-indigo-400" /><span className="text-xs font-bold text-slate-300 group-hover:text-indigo-400">Upload Evidence</span></>}
              </div>
              <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc,.jpg,.jpeg,.png" multiple className="hidden" onChange={handleFileSelect} />
              {evidenceLoading && <p className="text-[11px] text-slate-400 mt-2 text-center">Loading…</p>}
              {evidence.length > 0 && (
                <div className="mt-2 space-y-1">
                  {(() => {
                    const nameCounts: Record<string, number> = {};
                    const nameDateCounts: Record<string, number> = {};
                    const nameDateIdx: Record<string, number> = {};
                    evidence.forEach(ev => {
                      nameCounts[ev.fileName] = (nameCounts[ev.fileName] ?? 0) + 1;
                      const d = toUKDate(ev.uploadedAt ?? '');
                      const k = `${ev.fileName}::${d}`;
                      nameDateCounts[k] = (nameDateCounts[k] ?? 0) + 1;
                    });
                    return evidence.map(ev => {
                      const ext = ev.fileName.includes('.') ? ev.fileName.slice(ev.fileName.lastIndexOf('.')) : '';
                      const base = ev.fileName.slice(0, ev.fileName.length - ext.length);
                      const d = toUKDate(ev.uploadedAt ?? '');
                      const k = `${ev.fileName}::${d}`;
                      let displayName = ev.fileName;
                      if (nameCounts[ev.fileName] > 1) {
                        if (nameDateCounts[k] > 1) {
                          nameDateIdx[k] = (nameDateIdx[k] ?? 0) + 1;
                          displayName = `${base} (${d} ${nameDateIdx[k]})${ext}`;
                        } else {
                          displayName = `${base} (${d})${ext}`;
                        }
                      }
                      return (
                    <div key={ev.id} className="flex items-center gap-2 py-0.5">
                      <Paperclip size={11} className="text-slate-400 flex-shrink-0" />
                      <button onClick={() => openEvidence(ev)} title="View evidence file" className="text-[12px] text-indigo-600 hover:underline flex-1 text-left truncate">{displayName}</button>
                      {ev.fileSizeBytes && <span className="text-[10px] text-slate-400 flex-shrink-0">{Math.round(ev.fileSizeBytes / 1024)}KB</span>}
                      {(role === 'advisor' || role === 'superadmin' || ev.uploadedBy === userId) && (
                        <button onClick={() => handleDeleteEvidence(ev)} title="Remove this evidence file" className="text-slate-300 hover:text-rose-400 flex-shrink-0 ml-1"><X size={12} /></button>
                      )}
                    </div>
                      );
                    });
                  })()}
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                {isArchived ? (
                  <div className="space-y-2">
                    <div className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 text-xs flex items-start gap-2">
                      <Archive size={13} className="flex-shrink-0 mt-0.5 text-slate-400" />
                      <span>This action was closed when its source document was archived. It was not manually resolved.</span>
                    </div>
                    {(role === 'advisor' || role === 'superadmin') && onRestore && (
                      <button onClick={e => { e.stopPropagation(); onRestore(action.id); }} title="Restore this action to open status in the portal" className="w-full px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider border border-slate-200 text-slate-400 hover:border-indigo-200 hover:text-indigo-500 bg-white flex items-center justify-center gap-2">
                        <RotateCcw size={13} />Restore Action
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {action.status === 'pending_review' && role === 'client' && (
                      <>
                        <div className="w-full px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center gap-2">
                          <Clock size={13} />Awaiting Confirmation
                        </div>
                        <button onClick={e => { e.stopPropagation(); onClientWithdraw?.(action.id); }} title="Withdraw submission — return action to in-progress" className="w-full px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider border border-slate-200 text-slate-400 hover:border-rose-200 hover:text-rose-400 bg-white flex items-center justify-center gap-2"><X size={13} />Withdraw</button>
                      </>
                    )}
                    {action.status === 'pending_review' && (role === 'advisor' || role === 'superadmin') && (
                      <>
                        <button onClick={e => { e.stopPropagation(); onAdvisorConfirm?.(action.id); if (canSync) { doSync(new Date().toLocaleDateString('en-CA')); } }} title="Confirm this action is resolved in the portal" className="w-full px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider active:scale-95 bg-emerald-600 text-white hover:bg-emerald-700 flex items-center justify-center gap-2"><CheckCircle size={13} />Confirm Resolved</button>
                        {showRejectInput ? (
                          <div className="space-y-2">
                            <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} placeholder="Reason for rejection…" rows={2} className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-rose-200 resize-none bg-white" />
                            <div className="flex gap-2">
                              <button onClick={e => { e.stopPropagation(); onAdvisorReject?.(action.id, rejectNote); setRejectNote(''); setShowRejectInput(false); }} title="Send back to client with this note" className="flex-1 px-4 py-2 rounded-xl font-black text-xs uppercase bg-rose-600 text-white hover:bg-rose-700 flex items-center justify-center gap-2"><X size={13} />Send Back</button>
                              <button onClick={() => { setShowRejectInput(false); setRejectNote(''); }} title="Cancel rejection" className="px-4 py-2 rounded-xl font-black text-xs bg-white border border-slate-200 text-slate-400">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={e => { e.stopPropagation(); setShowRejectInput(true); }} title="Reject — send back to client with a note" className="w-full px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider border border-rose-200 text-rose-500 hover:bg-rose-50 flex items-center justify-center gap-2"><X size={13} />Reject</button>
                        )}
                      </>
                    )}
                    {action.status !== 'pending_review' && role === 'client' && !isResolved && (
                      <button onClick={e => { e.stopPropagation(); onClientSubmit?.(action.id); }} title="Submit this action for advisor review" className="w-full px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider active:scale-95 shadow-sm bg-slate-900 text-white hover:bg-indigo-700 flex items-center justify-center gap-2"><Clock size={13} />Submit for Review</button>
                    )}
                    {action.status !== 'pending_review' && role === 'client' && isResolved && (
                      <div className="w-full px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider bg-white border border-slate-200 text-slate-400 flex items-center justify-center gap-2"><CheckCircle size={13} />Confirmed</div>
                    )}
                    {action.status !== 'pending_review' && (role === 'advisor' || role === 'superadmin') && (
                      <>
                        <button onClick={handleResolve} title={isResolved ? 'Undo — reopen this action in the portal' : 'Mark this action as resolved in the portal'} className={`w-full px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider active:scale-95 shadow-sm flex items-center justify-center gap-2 ${isResolved ? 'bg-white border border-slate-200 text-slate-400 hover:border-rose-200 hover:text-rose-400' : 'bg-slate-900 text-white hover:bg-indigo-700'}`}>
                          {isResolved ? <><X size={13} />Undo Resolve</> : <><CheckCircle size={13} />Mark as Resolved</>}
                        </button>
                        {!isResolved && <p className="text-[11px] text-slate-400 italic mt-1.5 text-center">Add a note or upload evidence to demonstrate how this was resolved.</p>}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          {showNoteInput ? (
            <div className="flex gap-2 items-start">
              <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a progress note…" rows={2} className="flex-1 text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none bg-white" />
              <div className="flex flex-col gap-2">
                <button onClick={() => { onAddNote(action.id, noteText); setNoteText(''); setShowNoteInput(false); }} title="Save note to this action" className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700">Save</button>
                <button onClick={() => setShowNoteInput(false)} title="Cancel without saving" className="px-4 py-2.5 bg-white border border-slate-200 text-slate-400 rounded-xl text-xs font-black">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowNoteInput(true)} title="Add a progress note to this action" className="text-[11px] font-black uppercase tracking-wider text-indigo-500 hover:text-indigo-700 flex items-center gap-1.5"><Plus size={13} />Add Note</button>
          )}
          {/* Sync Doc */}
          {canSync && (role === 'advisor' || role === 'superadmin') && (
            <div className="flex flex-col gap-2 pt-1 border-t border-slate-100">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sync Doc:</span>
                <button
                  onClick={handleSyncToDoc}
                  disabled={syncing || reading}
                  title="Push portal values into the Word document (doc updated)"
                  className="text-[11px] font-black uppercase tracking-wider text-emerald-600 hover:text-emerald-800 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                  {syncing ? 'Writing…' : 'Write to Word'}
                </button>
                <span className="text-slate-200">|</span>
                <button
                  onClick={handleReadFromWord}
                  disabled={reading || syncing}
                  title="Pull values from the Word document and preview changes (doc unaffected)"
                  className="text-[11px] font-black uppercase tracking-wider text-indigo-500 hover:text-indigo-700 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw size={13} className={reading ? 'animate-spin' : ''} />
                  {reading ? 'Reading…' : 'Read from Word'}
                </button>
                {syncResult && (
                  <span className={`text-[11px] font-bold ${syncResult.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {syncResult.msg}
                  </span>
                )}
                {docLinkEl && <div className="ml-auto">{docLinkEl}</div>}
              </div>
              <p className="text-[10px] text-slate-400"><span className="font-bold">Write to Word</span> — pushes portal values into the source Word document.</p>
              <p className="text-[10px] text-slate-400"><span className="font-bold">Read from Word</span> — pulls values from the Word document and shows a diff before applying.</p>
              {readDiff && (() => {
                const portalVals = {
                  actionText: action.action || '',
                  responsiblePerson: action.who || '',
                  targetDate: action.date ? toUKDate(action.date) : '',
                  completedDate: action.resolvedDate ? toUKDate(action.resolvedDate) : '',
                };
                const fields: { label: string; key: keyof ReadDiff }[] = [
                  { label: 'Action Text',        key: 'actionText' },
                  { label: 'Responsible Person', key: 'responsiblePerson' },
                  { label: 'Target Date',        key: 'targetDate' },
                  { label: 'Completed Date',     key: 'completedDate' },
                ];
                const hasDiffs = fields.some(f => readDiff[f.key] !== portalVals[f.key]);
                return (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Word Document vs Portal</p>
                    <div className="space-y-1.5">
                      {fields.map(({ label, key }) => {
                        const wordVal = readDiff[key];
                        const portalVal = portalVals[key];
                        const differs = wordVal !== portalVal;
                        return (
                          <div key={key} className={`rounded-lg px-3 py-2 ${differs ? 'bg-amber-50 border border-amber-200' : 'bg-white border border-slate-100'}`}>
                            <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5">{label}</p>
                            {differs ? (
                              <div className="space-y-0.5 mt-0.5">
                                <p className="text-[11px] text-rose-400">{portalVal || <em>empty</em>}</p>
                                <p className="text-[11px] text-emerald-700 font-bold">{wordVal || <em className="font-normal">empty</em>} <span className="text-[9px] font-black uppercase tracking-wider text-emerald-500">(new)</span></p>
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-500 mt-0.5">{wordVal || <em className="text-slate-300">empty</em>} <span className="text-emerald-500">✓</span></p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {hasDiffs ? (
                      <div className="flex gap-2">
                        <button onClick={() => { onApplyFromWord?.(action.id, readDiff); setReadDiff(null); }} title="Update portal with Word document values" className="flex-1 px-3 py-2 rounded-xl font-black text-xs uppercase tracking-wider bg-indigo-600 text-white hover:bg-indigo-700 flex items-center justify-center gap-1.5"><RefreshCw size={11} />Apply Word Values</button>
                        <button onClick={() => setReadDiff(null)} title="Dismiss — keep portal values unchanged" className="px-3 py-2 rounded-xl font-black text-xs uppercase bg-white border border-slate-200 text-slate-400 hover:text-slate-600">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-emerald-600 font-bold">Word document matches portal — nothing to apply.</p>
                        <button onClick={() => setReadDiff(null)} title="Dismiss — portal already matches Word" className="text-[10px] font-black uppercase text-slate-400 hover:text-slate-600">Dismiss</button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          {docLinkEl && !canSync && (
            <div className="flex justify-end pt-1 border-t border-slate-100">
              {docLinkEl}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Datto Helpers ────────────────────────────────────────────────────────────
function normaliseItems(raw: any): DattoItem[] {
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.children) ? raw.children : Array.isArray(raw?.items) ? raw.items : [];
  return list.map((item: any) => ({
    ...item,
    id: String(item.id ?? item.fileId ?? item.folderId ?? ''),
    name: item.name ?? item.fileName ?? item.folderName ?? 'Unnamed',
    type: (item.type === 'folder' || item.type === 'FOLDER' || item.isDirectory === true || item.folderType !== undefined || item.childCount !== undefined) ? 'folder' : 'file',
  }));
}

// ─── Datto File Browser (for selecting documents) ─────────────────────────────
const DattoFileBrowser = ({ rootFolderId, siteName, onSelect, onClose }: {
  rootFolderId: string; siteName: string; onSelect: (name: string, id: string) => void; onClose: () => void;
}) => {
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([{ id: rootFolderId, name: siteName }]);
  const [items, setItems] = useState<DattoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const current = breadcrumbs[breadcrumbs.length - 1];

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setApiError('');
      try {
        const res = await fetch(`/api/datto?folderId=${current.id}`);
        if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || `HTTP ${res.status}`); }
        const raw = await res.json();
        if (!cancelled) setItems(normaliseItems(raw));
      } catch (e: any) { if (!cancelled) setApiError(e.message ?? 'Unknown error'); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [current.id]);

  const folders = items.filter(i => i.type === 'folder');
  const files = items.filter(i => i.type === 'file' && !i.name.toLowerCase().includes('draft'));

  return (
    <div className="border border-indigo-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="bg-indigo-600 px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] font-black text-white uppercase tracking-widest flex items-center gap-2"><FolderOpen size={13} />Browse Documents</span>
        <button onClick={onClose} title="Close browser" className="text-indigo-200 hover:text-white"><X size={15} /></button>
      </div>
      <div className="bg-slate-50 border-b border-slate-100 px-4 py-2 flex items-center gap-1 flex-wrap min-h-[36px]">
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={`${crumb.id}-${i}`}>
            {i > 0 && <ChevronRight size={10} className="text-slate-300" />}
            <button onClick={() => setBreadcrumbs(prev => prev.slice(0, i + 1))} title="Go to this folder" className={`text-[10px] font-black truncate max-w-[120px] ${i === breadcrumbs.length - 1 ? 'text-indigo-700 cursor-default' : 'text-indigo-500 hover:underline'}`}>{crumb.name}</button>
          </React.Fragment>
        ))}
      </div>
      <div className="max-h-56 overflow-y-auto">
        {loading && <div className="p-6 text-center text-[11px] font-black text-slate-400 animate-pulse">Loading…</div>}
        {!loading && apiError && <div className="p-4"><div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-bold text-rose-700">⚠ {apiError}</div></div>}
        {!loading && !apiError && items.length === 0 && <div className="p-6 text-center text-xs font-bold text-slate-400">Empty folder.</div>}
        {!loading && !apiError && (<>
          {folders.map(item => (
            <button key={item.id} onClick={() => setBreadcrumbs(prev => [...prev, { id: item.id, name: item.name }])} title="Open this folder" className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50 group border-b border-slate-50 text-left">
              <Folder size={14} className="text-amber-400 flex-shrink-0" /><span className="text-xs font-bold text-slate-700 group-hover:text-amber-700 flex-1 truncate">{item.name}</span><ChevronRight size={12} className="text-slate-300" />
            </button>
          ))}
          {files.map(item => (
            <button key={item.id} onClick={() => onSelect(item.name, item.id)} title="Use this document as the source" className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-indigo-50 group border-b border-slate-50 text-left">
              <File size={14} className="text-indigo-400 flex-shrink-0" /><span className="text-xs font-bold text-slate-700 group-hover:text-indigo-700 flex-1 truncate">{item.name}</span>
              <span className="text-[10px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded group-hover:bg-indigo-100">Select</span>
            </button>
          ))}
        </>)}
      </div>
      <div className="bg-slate-50 border-t border-slate-100 px-4 py-2 flex items-center justify-between">
        <span className="text-[10px] text-slate-400">{!loading && !apiError && `${folders.length} folders, ${files.length} files`}</span>
        <button onClick={onClose} title="Close without selecting" className="text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase">Cancel</button>
      </div>
    </div>
  );
};

// ─── Datto Folder Picker (for selecting folders) ──────────────────────────────
// onNavigate fires every time user moves to a new folder — lets parent track current position
const DattoFolderPicker = ({ startFolderId = DATTO_ROOT_ID, startFolderName = 'Customer Documents', onSelect, onNavigate, onClose }: {
  startFolderId?: string; startFolderName?: string;
  onSelect: (name: string, id: string, path: string) => void;
  onNavigate?: (name: string, id: string) => void;
  onClose: () => void;
}) => {
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([{ id: startFolderId, name: startFolderName }]);
  const [items, setItems] = useState<DattoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const current = breadcrumbs[breadcrumbs.length - 1];

  // Resolve actual Datto folder name for startFolderId (may differ from Supabase org name)
  useEffect(() => {
    if (startFolderId === DATTO_ROOT_ID) return;
    fetch(`/api/datto?folderId=${DATTO_ROOT_ID}`)
      .then(r => r.json())
      .then(data => {
        const match = normaliseItems(data).find((i: DattoItem) => i.id === startFolderId);
        if (match) setBreadcrumbs([{ id: startFolderId, name: match.name }]);
      })
      .catch(() => {});
  }, [startFolderId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setApiError('');
      try {
        const res = await fetch(`/api/datto?folderId=${current.id}`);
        if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || `HTTP ${res.status}`); }
        const raw = await res.json();
        if (!cancelled) setItems(normaliseItems(raw));
      } catch (e: any) { if (!cancelled) setApiError(e.message ?? 'Unknown error'); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    // Notify parent of current position whenever folder changes
    if (onNavigate) onNavigate(current.name, current.id);
    return () => { cancelled = true; };
  }, [current.id]);

  const navigateTo = (name: string, id: string) => {
    setBreadcrumbs(prev => [...prev, { id, name }]);
  };

  const folders = items.filter(i => i.type === 'folder');

  return (
    <div className="border border-indigo-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="bg-indigo-600 px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] font-black text-white uppercase tracking-widest flex items-center gap-2"><FolderOpen size={13} />Select Folder</span>
        <button onClick={onClose} title="Close without selecting" className="text-indigo-200 hover:text-white"><X size={15} /></button>
      </div>
      <div className="bg-slate-50 border-b border-slate-100 px-4 py-2 flex items-center gap-1 flex-wrap">
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={`${crumb.id}-${i}`}>
            {i > 0 && <ChevronRight size={10} className="text-slate-300" />}
            <button onClick={() => setBreadcrumbs(prev => prev.slice(0, i + 1))} title="Go to this folder" className={`text-[10px] font-black truncate max-w-[120px] ${i === breadcrumbs.length - 1 ? 'text-indigo-700 cursor-default' : 'text-indigo-500 hover:underline'}`}>{crumb.name}</button>
          </React.Fragment>
        ))}
      </div>
      <div className="max-h-48 overflow-y-auto">
        {loading && <div className="p-4 text-center text-[11px] font-black text-slate-400 animate-pulse">Loading…</div>}
        {!loading && apiError && <div className="p-4 text-xs font-bold text-rose-600">{apiError}</div>}
        {!loading && !apiError && folders.length === 0 && <div className="p-4 text-center text-xs font-bold text-slate-400">No subfolders here</div>}
        {!loading && !apiError && folders.map(item => (
          <div key={item.id} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50 group border-b border-slate-50">
            <Folder size={14} className="text-amber-400 flex-shrink-0" />
            <button onClick={() => {
              const path = startFolderId === DATTO_ROOT_ID
                ? breadcrumbs.slice(1).map(b => b.name).join('/') + (breadcrumbs.length > 1 ? '/' : '') + item.name
                : breadcrumbs.map(b => b.name).join('/') + '/' + item.name;
              onSelect(item.name, item.id, path);
            }} title="Select this folder" className="text-xs font-bold text-slate-700 group-hover:text-amber-700 flex-1 truncate text-left">{item.name}</button>
            <button onClick={() => navigateTo(item.name, item.id)} className="text-slate-300 hover:text-indigo-500 flex-shrink-0 p-1" title="Open subfolder"><ChevronRight size={12} /></button>
          </div>
        ))}
      </div>
      <div className="bg-slate-50 border-t border-slate-100 px-4 py-2 flex justify-end">
        <button onClick={onClose} title="Close without selecting" className="text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase">Cancel</button>
      </div>
    </div>
  );
};

// ─── Folder Picker Field ──────────────────────────────────────────────────────
const FIELD_INPUT_CLASS = 'w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white';
const FIELD_LABEL_CLASS = 'text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block';
const FolderPickerField = ({ folderId, folderName, showPicker, onOpenPicker, onSelectFolder, onNavigate, orgForPicker, labelText, labelHint }: any) => (
  <div>
    <label className={FIELD_LABEL_CLASS}>{labelText}{labelHint && <span className="ml-2 text-indigo-400 normal-case font-bold tracking-normal">— {labelHint}</span>}</label>
    {showPicker ? (
      <DattoFolderPicker
        startFolderId={orgForPicker?.datto_folder_id || DATTO_ROOT_ID}
        startFolderName={orgForPicker?.name || 'Customer Documents'}
        onSelect={onSelectFolder}
        onNavigate={onNavigate}
        onClose={() => onOpenPicker(false)}
      />
    ) : (
      <div onClick={() => onOpenPicker(true)} className={`${FIELD_INPUT_CLASS} flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-300`}>
        {folderName
          ? <span className="flex items-center gap-2 text-indigo-700 font-bold"><Folder size={14} className="text-amber-400" />{folderName}{folderId && <span className="text-slate-400 font-normal text-xs">({folderId})</span>}</span>
          : <span className="text-slate-400">Click to browse Datto folders…</span>}
        <FolderOpen size={16} className="text-slate-300" />
      </div>
    )}
  </div>
);

// ─── Add Action Form ──────────────────────────────────────────────────────────
type RiskLevel = 'high' | 'medium' | 'low';
function normaliseRiskLevel(raw: string): RiskLevel | null {
  const n = raw.toLowerCase().trim();
  // Numeric score — extract trailing number from "12", "3×4=12", "Risk: 16"
  const numMatch = n.match(/(?:^|[=:\s])(\d+)\s*$/) ?? n.match(/^(\d+)$/);
  if (numMatch) {
    const score = parseInt(numMatch[1], 10);
    return score >= 16 ? 'high' : score >= 9 ? 'medium' : 'low';
  }
  // Text HIGH — includes fire RA "critical"/"substantial", extended "very high"/"extreme"
  if (/critical|extreme|intolerable|substantial|very.?high|high/.test(n) || n === 'h') return 'high';
  // Text MEDIUM — includes fire RA "moderate"/"significant"
  if (/significant|moderate|med/.test(n) || n === 'm') return 'medium';
  // Text LOW — includes fire RA "tolerable"/"trivial"/"negligible"
  if (/tolerable|trivial|negligible|low|none/.test(n) || n === 'l') return 'low';
  return null;
}

const AddActionForm = ({ site, onSave, onCancel }: { site: Site; onSave: (action: Action) => void; onCancel: () => void }) => {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [who, setWho] = useState(''); const [contractor, setContractor] = useState('');
  const [regulation, setRegulation] = useState(''); const [dueDate, setDueDate] = useState('');
  const [sourceDocName, setSourceDocName] = useState(''); const [sourceDocId, setSourceDocId] = useState('');
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  // Hazard register state
  const [hazardRef, setHazardRef] = useState('');
  const [riskRating, setRiskRating] = useState<RiskLevel | null>(null);
  const [riskRatingOverridden, setRiskRatingOverridden] = useState(false);
  const [hazardOptions, setHazardOptions] = useState<{ ref: string; description: string; descriptionPreview: string; existingControls?: string; riskRating?: string }[]>([]);
  const [hazardsLoading, setHazardsLoading] = useState(false);
  const [hazardDescription, setHazardDescription] = useState('');
  const [hazardExistingControls, setHazardExistingControls] = useState('');

  const riskLevelMap: Record<RiskLevel, string> = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };

  const handleHazardSelect = (ref: string) => {
    setHazardRef(ref);
    const hazard = hazardOptions.find(h => h.ref === ref);
    if (hazard) {
      setHazardDescription(hazard.description);
      setHazardExistingControls(hazard.existingControls ?? '');
      if (!riskRatingOverridden && hazard.riskRating) {
        setRiskRating(normaliseRiskLevel(hazard.riskRating));
      }
    } else {
      setHazardDescription('');
      setHazardExistingControls('');
    }
  };

  const handleDocSelect = (name: string, id: string) => {
    setSourceDocName(name);
    setSourceDocId(id);
    setShowFileBrowser(false);
    setHazardOptions([]);
    setHazardRef('');
    setHazardDescription('');
    setHazardExistingControls('');
    setRiskRatingOverridden(false);
    if (name.toLowerCase().endsWith('.docx')) {
      setHazardsLoading(true);
      fetch(`/api/datto/file/hazards?fileId=${id}`)
        .then(r => r.json())
        .then(data => { if (data.hazards?.length > 0) setHazardOptions(data.hazards); })
        .catch(() => {})
        .finally(() => setHazardsLoading(false));
    }
  };

  const handleClearDoc = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSourceDocName(''); setSourceDocId('');
    setHazardOptions([]); setHazardRef('');
    setHazardDescription(''); setHazardExistingControls('');
    setRiskRating(null); setRiskRatingOverridden(false);
  };

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    if (!dueDate) { setError('Target date is required'); return; }
    if (!riskRating) { setError('Risk rating is required'); return; }
    setSaving(true); setError('');
    const { data, error: err } = await supabase.from('actions').insert({
      site_id: site.id, title: title.trim(), description: description.trim(), priority: 'green', status: 'open',
      regulation: regulation.trim(), contractor: contractor.trim() || null, due_date: dueDate,
      source_document_name: sourceDocName || null, source_document_id: sourceDocId || null,
      responsible_person: who.trim() || null,
      hazard_ref: hazardRef.trim() || null,
      hazard: hazardDescription.trim() || null,
      existing_controls: hazardExistingControls.trim() || null,
      risk_rating: riskRating ? riskLevelMap[riskRating] : null,
      risk_level: riskRating ? riskLevelMap[riskRating] : null,
    }).select().single();
    if (err) { setError('Failed to save. Please try again.'); setSaving(false); return; }
    onSave({
      id: data.id, action: data.title, description: data.description || '', date: data.due_date,
      site: site.name, who: data.responsible_person || '', contractor: data.contractor || '',
      source: data.source_document_name || '', source_document_id: data.source_document_id || '',
      priority: 'green' as Priority, regulation: data.regulation || '',
      notes: '', status: 'open',
      hazardRef: data.hazard_ref || null, hazard: data.hazard || null,
      existingControls: data.existing_controls || null,
      riskRating: data.risk_rating || null, riskLevel: data.risk_level || null,
      resolvedDate: null, sourceFolderId: null,
    });
    setSaving(false);
  };

  const inputClass = 'w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white';
  const labelClass = 'text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block';

  return (
    <div className="bg-white rounded-lg border border-indigo-200 shadow-lg overflow-hidden">
      <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between">
        <h3 className="font-black text-white uppercase tracking-widest text-sm">Add New Action</h3>
        <button onClick={onCancel} title="Close without saving" className="text-indigo-200 hover:text-white"><X size={18} /></button>
      </div>
      <div className="p-6 space-y-5">
        {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold px-4 py-3 rounded-xl">{error}</div>}
        <div><label className={labelClass}>Action Required *</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Describe the action required..." className={inputClass} /></div>
        <div><label className={labelClass}>Detail / Context</label><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Additional detail..." rows={3} className={`${inputClass} resize-none`} /></div>
        <div>
          <label className={labelClass}>Target Date *</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputClass} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={labelClass}>Person Responsible</label><input value={who} onChange={e => setWho(e.target.value)} placeholder="e.g. Factory Manager" className={inputClass} /></div>
          <div><label className={labelClass}>Contractor</label><input value={contractor} onChange={e => setContractor(e.target.value)} placeholder="e.g. SafeGuard Engineering Ltd" className={inputClass} /></div>
        </div>
        <div><label className={labelClass}>Regulation / Legislation</label><input value={regulation} onChange={e => setRegulation(e.target.value)} placeholder="e.g. PUWER 1998, Reg. 11" className={inputClass} /></div>
        <div>
          <label className={labelClass}>Source Document{site.datto_folder_id ? <span className="ml-2 text-indigo-400 normal-case font-bold tracking-normal">— click to browse Datto</span> : <span className="ml-2 text-slate-300 normal-case font-bold tracking-normal">— no Datto folder linked</span>}</label>
          {showFileBrowser && site.datto_folder_id ? (
            <DattoFileBrowser rootFolderId={site.datto_folder_id} siteName={site.name} onSelect={handleDocSelect} onClose={() => setShowFileBrowser(false)} />
          ) : (
            <div onClick={() => site.datto_folder_id && setShowFileBrowser(true)} className={`${inputClass} flex items-center justify-between gap-2 ${site.datto_folder_id ? 'cursor-pointer hover:border-indigo-300' : 'cursor-not-allowed opacity-60'}`}>
              {sourceDocName ? <><span className="flex items-center gap-2 text-indigo-700 font-bold truncate"><File size={14} className="text-indigo-400 flex-shrink-0" />{sourceDocName}</span><button onClick={handleClearDoc} title="Clear selected document" className="text-slate-300 hover:text-rose-400"><X size={14} /></button></> : <><span className="text-slate-400">{site.datto_folder_id ? 'Click to browse documents…' : 'No Datto folder linked'}</span><FolderOpen size={16} className="text-slate-300" /></>}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>
              Hazard Ref
              {hazardsLoading && <span className="ml-2 text-indigo-400 normal-case font-bold tracking-normal animate-pulse">— reading hazard register…</span>}
            </label>
            {hazardOptions.length > 0 ? (
              <select value={hazardRef} onChange={e => handleHazardSelect(e.target.value)} className={inputClass}>
                <option value="">— Select hazard ref —</option>
                {hazardOptions.map(h => (
                  <option key={h.ref} value={h.ref}>{h.ref}{h.descriptionPreview ? ` — ${h.descriptionPreview}` : ''}</option>
                ))}
              </select>
            ) : (
              <input value={hazardRef} onChange={e => setHazardRef(e.target.value)} placeholder="e.g. 1.3" className={inputClass} />
            )}
          </div>
          <div>
            <label className={labelClass}>Risk Rating</label>
            <div className="flex gap-2">
              {([{ val: 'high', label: 'High', active: 'bg-rose-600 text-white border-rose-600' }, { val: 'medium', label: 'Medium', active: 'bg-amber-500 text-white border-amber-500' }, { val: 'low', label: 'Low', active: 'bg-emerald-600 text-white border-emerald-600' }] as const).map(r => (
                <button key={r.val} type="button" onClick={() => { setRiskRating(r.val); setRiskRatingOverridden(true); }} title={`Set risk rating to ${r.label}`} className={`flex-1 py-2.5 rounded-xl text-[11px] font-black border transition-all ${riskRating === r.val ? r.active : 'bg-white text-slate-500 border-slate-200'}`}>{r.label}</button>
              ))}
            </div>
          </div>
        </div>
        {hazardDescription && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-violet-500">From Document</p>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Hazard</p>
              {formatExtractedText(hazardDescription)}
            </div>
            {hazardExistingControls && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Existing Controls</p>
                {formatExtractedText(hazardExistingControls)}
              </div>
            )}
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} title="Save new action to the portal" className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-black text-sm uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save Action'}</button>
          <button onClick={onCancel} title="Cancel without saving" className="px-6 py-3 bg-white border border-slate-200 text-slate-500 rounded-xl font-black text-sm uppercase tracking-wider hover:bg-slate-50">Cancel</button>
        </div>
      </div>
    </div>
  );
};

// ─── Document Card ────────────────────────────────────────────────────────────
const DocumentCard = ({ doc, role, userId, actions, onDelete, onRename, onToggleAction, expanded, onExpand, onDattoRetry, siteFolderPath }: {
  doc: SiteDocument; role: string; userId: string | null; actions: Action[];
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onToggleAction: (id: string, resolved: boolean) => void;
  expanded: boolean; onExpand: () => void;
  onDattoRetry?: (docId: string, newFileId: string) => void;
  siteFolderPath?: string | null;
}) => {
  const [editingName, setEditingName] = useState(false);
  // Tracks whether we're in the 3-minute "sync in progress" window for this doc
  const [isFresh, setIsFresh] = useState(() => {
    if (!doc.client_provided || doc.datto_file_id) return false;
    return (Date.now() - new Date(doc.uploaded_at).getTime()) < 3 * 60 * 1000;
  });
  useEffect(() => {
    if (!doc.client_provided || doc.datto_file_id || !isFresh) return;
    const remaining = 3 * 60 * 1000 - (Date.now() - new Date(doc.uploaded_at).getTime());
    if (remaining <= 0) { setIsFresh(false); return; }
    const t = setTimeout(() => setIsFresh(false), remaining);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.uploaded_at, doc.client_provided, doc.datto_file_id]);
  const [dattoRetrying, setDattoRetrying] = useState(false);
  const [dattoRetryError, setDattoRetryError] = useState(false);
  const [dattoRetryMsg, setDattoRetryMsg] = useState<string | null>(null);
  const [dattoReuploading, setDattoReuploading] = useState(false);
  const [dattoReuploadError, setDattoReuploadError] = useState(false);
  const reuploadInputRef = React.useRef<HTMLInputElement>(null);

  const handleReuploadFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setDattoReuploading(true);
    setDattoReuploadError(false);
    try {
      const form = new FormData();
      form.append('documentId', doc.id);
      form.append('file', file, file.name);
      const res = await fetch('/api/documents/datto-reupload', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok && data.dattoFileId) {
        onDattoRetry?.(doc.id, data.dattoFileId);
        setDattoRetryError(false);
        setDattoRetryMsg(null);
      } else {
        setDattoReuploadError(true);
      }
    } catch {
      setDattoReuploadError(true);
    } finally {
      setDattoReuploading(false);
    }
  };

  const handleDattoRetry = async () => {
    setDattoRetrying(true);
    setDattoRetryError(false);
    setDattoRetryMsg(null);
    try {
      const res = await fetch('/api/documents/datto-retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: doc.id }) });
      const data = await res.json();
      if (data.found && data.dattoFileId) {
        onDattoRetry?.(doc.id, data.dattoFileId);
      } else {
        setDattoRetryError(true);
        const needsReupload = data.reason === 'storage_missing' || data.reason === 'upload_failed' || data.reason === 'no_id_after_upload' || data.reason === 'not_in_folder';
        setDattoRetryMsg(needsReupload ? 'reupload' : 'error');
      }
    } catch {
      setDattoRetryError(true);
      setDattoRetryMsg('error');
    } finally {
      setDattoRetrying(false);
    }
  };
  const [nameInput, setNameInput] = useState(doc.document_name || doc.file_name || '');
  const today = new Date().toLocaleDateString('en-CA');
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const expStatus = doc.expiry_date ? (doc.expiry_date < today ? 'expired' : doc.expiry_date <= soon ? 'expiring' : 'valid') : 'none';
  const openActions = actions.filter(a => a.status !== 'resolved');
  const resolvedActions = actions.filter(a => a.status === 'resolved');
  const isAdvisorRole = role === 'advisor' || role === 'superadmin';
  const docExt = (doc.file_name ?? '').split('.').pop()?.toLowerCase() || '';
  const officeExts = ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'];
  let advisorOfficeHref: string | null = null;
  if (isAdvisorRole && officeExts.includes(docExt) && doc.datto_file_id && siteFolderPath) {
    const basePath = typeof window !== 'undefined' ? (localStorage.getItem('dattoBasePath') || 'W:/Customer Documents') : 'W:/Customer Documents';
    advisorOfficeHref = buildOfficeUri(basePath, `${siteFolderPath}/Client Provided Documents`, doc.file_name ?? '');
  }
  const viewHref = advisorOfficeHref
    ?? (doc.datto_file_id
      ? `/viewer?fileId=${doc.datto_file_id}&fileName=${encodeURIComponent(doc.file_name ?? '')}&role=${role}`
      : doc.client_provided
      ? `/viewer?docId=${doc.id}&fileName=${encodeURIComponent(doc.file_name ?? '')}&role=${role}`
      : null);

  // Card colours: expiry status takes precedence; client-provided defaults to amber
  const cardCls = expStatus === 'expired'  ? 'bg-rose-50/60 border-rose-200'
                : expStatus === 'expiring' ? 'bg-amber-50/60 border-amber-200'
                : expStatus === 'valid'    ? 'bg-emerald-50/40 border-emerald-200'
                : doc.client_provided     ? 'bg-amber-50/60 border-amber-200'
                : 'bg-white border-slate-200';
  const headerCls = expStatus === 'expired'  ? 'bg-rose-100/70'
                  : expStatus === 'expiring' ? 'bg-amber-100/70'
                  : expStatus === 'valid'    ? 'bg-emerald-100/50'
                  : doc.client_provided     ? 'bg-amber-100/70'
                  : 'bg-slate-50';
  const barCls  = expStatus === 'expired'  ? 'bg-rose-400'
                : expStatus === 'expiring' ? 'bg-amber-400'
                : expStatus === 'valid'    ? 'bg-emerald-400'
                : doc.client_provided     ? 'bg-amber-400'
                : 'bg-slate-300';

  return (
    <div className={`rounded-lg border transition-all duration-300 overflow-hidden ${cardCls}`}>
      {/* ── Header row ── */}
      <div className={`px-4 py-3 flex flex-col md:flex-row md:items-center gap-3 cursor-pointer ${headerCls}`} onClick={() => { if (!editingName) onExpand(); }}>
        <div className={`w-1.5 rounded-full self-stretch hidden md:block flex-shrink-0 ${barCls}`} />

        {/* Name + inline meta */}
        <div className="flex-1 min-w-0" onClick={e => editingName && e.stopPropagation()}>
          {editingName ? (
            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <input
                className="text-sm font-black text-slate-900 border border-indigo-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                autoFocus
              />
              <button onClick={() => { onRename(doc.id, nameInput); setEditingName(false); }} className="text-[10px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-100 whitespace-nowrap">Save</button>
              <button onClick={() => setEditingName(false)} className="text-[10px] font-black text-slate-400 hover:text-slate-600 whitespace-nowrap">Cancel</button>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                {doc.client_provided && <span title="Client provided"><Upload size={12} className="text-amber-500 flex-shrink-0" /></span>}
                <input ref={reuploadInputRef} type="file" className="hidden" onChange={handleReuploadFileChange} />
                {doc.client_provided && !doc.datto_file_id && (() => {
                  if (isFresh) return <span title="Syncing to Datto — this can take a few minutes" className="flex items-center gap-1 text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md flex-shrink-0"><RefreshCw size={9} className="animate-spin" />Datto sync…</span>;
                  if (dattoRetryError && dattoRetryMsg === 'reupload') {
                    return (
                      <button
                        onClick={e => { e.stopPropagation(); if (!dattoReuploading) reuploadInputRef.current?.click(); }}
                        disabled={dattoReuploading}
                        title={dattoReuploadError ? 'Upload failed — try again' : 'File missing from Datto — click to select and re-upload'}
                        className={`flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-md flex-shrink-0 border transition-colors ${dattoReuploadError ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100' : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'}`}
                      >
                        {dattoReuploading ? <><RefreshCw size={9} className="animate-spin" />Uploading…</> : dattoReuploadError ? <><AlertCircle size={9} />Upload failed — retry</> : <><Upload size={9} />Re-upload needed</>}
                      </button>
                    );
                  }
                  return (
                    <button
                      onClick={e => { e.stopPropagation(); handleDattoRetry(); }}
                      disabled={dattoRetrying}
                      title={dattoRetryError ? 'Could not sync to Datto — check connection and try again' : 'File not synced to Datto — click to retry'}
                      className={`flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-md flex-shrink-0 border transition-colors ${dattoRetryError ? 'bg-rose-50 border-rose-200 text-rose-500' : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-600'}`}
                    >
                      <RefreshCw size={9} className={dattoRetrying ? 'animate-spin' : ''} />
                      {dattoRetrying ? 'Syncing…' : dattoRetryError ? 'Sync failed' : 'Not in Datto'}
                    </button>
                  );
                })()}
                <span className="font-bold text-[12px] leading-snug text-slate-900">{doc.document_name || doc.file_name}</span>
                <span className="text-slate-300 text-[11px]">|</span>
                <span className="text-[11px] font-medium text-slate-400 flex-shrink-0">Uploaded {new Date(doc.uploaded_at).toLocaleDateString('en-GB')}</span>
                {doc.document_type && <><span className="text-slate-300 text-[11px]">|</span><span className="text-[11px] font-bold text-slate-500">{doc.document_type}</span></>}
                {doc.issue_date && <><span className="text-slate-300 text-[11px]">|</span><span className="text-[12px] font-medium text-slate-500 flex-shrink-0"><span className="text-slate-400 font-normal">Issued: </span>{fmt(doc.issue_date)}</span></>}
                {doc.expiry_date && <><span className="text-slate-300 text-[11px]">|</span><span className="text-[12px] font-medium text-slate-500 flex-shrink-0"><span className="text-slate-400 font-normal">Expires: </span>{fmt(doc.expiry_date)}</span></>}
                {role === 'client' && (
                  <button onClick={e => { e.stopPropagation(); setEditingName(true); }} className="p-0.5 text-slate-300 hover:text-amber-500 rounded flex-shrink-0" title="Rename">
                    <Pencil size={10} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {expStatus === 'expired'  && <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border bg-rose-50 border-rose-200 text-rose-700">Expired</span>}
                {expStatus === 'expiring' && <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border bg-amber-50 border-amber-200 text-amber-700">Expiring Soon</span>}
                {expStatus === 'valid'    && <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-700">Valid</span>}
                {viewHref && (
                  <a href={viewHref} target={advisorOfficeHref ? undefined : '_blank'} rel={advisorOfficeHref ? undefined : 'noopener noreferrer'} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline" title="Open document">
                    <ExternalLink size={12} className="text-indigo-500 flex-shrink-0" />Open
                  </a>
                )}
                {role === 'client' && (
                  <button onClick={e => { e.stopPropagation(); if (window.confirm('Delete this document? This cannot be undone.')) onDelete(doc.id); }} className="p-1.5 rounded-lg border border-rose-200 text-rose-400 hover:text-rose-600 hover:border-rose-400 hover:bg-rose-50 transition-colors" title="Delete">
                    <Trash2 size={14} />
                  </button>
                )}
                {openActions.length > 0 && <span className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200">{openActions.length} action{openActions.length !== 1 ? 's' : ''}</span>}
                {resolvedActions.length > 0 && openActions.length === 0 && <span className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200">{resolvedActions.length} resolved</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <div className="border-t border-white/60 bg-white/60 backdrop-blur-sm px-6 py-4 space-y-3">
          {/* Dates + people */}
          {(doc.issue_date || doc.expiry_date || (doc.people_mentioned && doc.people_mentioned.length > 0)) && (
            <div className="flex items-center gap-4 flex-wrap text-[12px] font-medium text-slate-600">
              {doc.issue_date && <span><span className="text-slate-500 font-normal text-[11px] uppercase tracking-wider">Issued: </span>{fmt(doc.issue_date)}</span>}
              {doc.expiry_date && <><span className="text-slate-300">|</span><span><span className="text-slate-500 font-normal text-[11px] uppercase tracking-wider">Expires: </span>{fmt(doc.expiry_date)}</span></>}
              {doc.people_mentioned && doc.people_mentioned.length > 0 && (
                <><span className="text-slate-300">|</span><span className="flex items-center gap-1"><Users size={11} className="text-slate-400" />{doc.people_mentioned.join(', ')}</span></>
              )}
            </div>
          )}

          {/* Notes */}
          {doc.notes && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Notes</p>
              <p className="text-sm text-slate-700 leading-relaxed">{doc.notes}</p>
            </div>
          )}

          {/* Actions */}
          {actions.length === 0 ? (
            <p className="text-[11px] text-slate-400 font-bold">No actions identified from this document.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{actions.length} action{actions.length !== 1 ? 's' : ''} from this document</p>
              {actions.map(a => {
                const cfg = priorityConfig[a.priority as Priority] ?? priorityConfig.green;
                const isResolved = a.status === 'resolved';
                return (
                  <div key={a.id} className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${cfg.bg} ${cfg.border}`}>
                    <div className={`w-1 rounded-full self-stretch flex-shrink-0 mt-0.5 ${cfg.bar}`} style={{ minHeight: 28 }} />
                    <div className="flex-1 min-w-0 space-y-1">
                      {a.hazard && <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{a.hazard}</p>}
                      <p className={`text-[12px] font-bold leading-snug ${isResolved ? 'text-slate-400' : 'text-slate-800'}`}>{a.action}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {!isResolved && <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${cfg.badge}`}>{cfg.label}</span>}
                        {(a as any).isSuggested && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded border border-violet-200 text-violet-600 bg-violet-50">AI Suggested</span>}
                        {a.date && <span className="text-[9px] font-bold text-slate-500 flex items-center gap-1"><Clock size={9} />Due: {a.date}</span>}
                        {a.who && <span className="text-[9px] font-bold text-slate-500 flex items-center gap-1"><User size={9} />{a.who}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => onToggleAction(a.id, !isResolved)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-lg font-black text-[9px] uppercase tracking-wider ${isResolved ? 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600' : 'bg-slate-900 text-white hover:bg-indigo-700'}`}
                    >
                      {isResolved ? 'Undo' : 'Resolve'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      )}
    </div>
  );
};

// ─── Upload Modal ─────────────────────────────────────────────────────────────
const smartTitleCase = (filename: string): string => {
  const noExt = filename.replace(/\.[^.]+$/, '');
  const words = noExt.replace(/[_-]/g, ' ').split(/\s+/).filter(Boolean);
  return words.map(word => {
    // Leave ALL-CAPS acronyms (COSHH, ISO, GDPR) and words containing digits (years, dates) untouched
    if (/\d/.test(word) || (word === word.toUpperCase() && word.length > 1)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
};

const UploadModal = ({ site, userId, onClose, onSaved, initialFiles, skipAI }: {
  site: Site; userId: string | null;
  onClose: () => void; onSaved: (doc: SiteDocument, newCompliance: number | null, replacedId?: string, dattoPending?: boolean) => void;
  initialFiles?: File[]; skipAI?: boolean;
}) => {
  type FileStatus = 'pending' | 'uploading' | 'extracting' | 'done' | 'error';
  type FileItem = {
    file: File; status: FileStatus; error?: string; documentId?: string; dattoFileId?: string; noFolder?: boolean;
    duplicateId?: string; duplicateDattoFileId?: string;
    docName: string; docType: string; issueDate: string; expiryDate: string; people: string; notes: string;
    actions: { description: string; dueDate: string | null; responsiblePerson: string | null; priority: string | null; selected: boolean }[];
  };
  type Step = 'select' | 'processing' | 'review';

  const [step, setStep] = useState<Step>('select');
  const [items, setItems] = useState<FileItem[]>([]);
  const [processingIdx, setProcessingIdx] = useState(0);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const inputClass = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white';
  const labelClass = 'text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block';
  const today = new Date().toLocaleDateString('en-CA');

  const updateItem = (idx: number, patch: Partial<FileItem>) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));

  const processFiles = async (files: File[]) => {
    const initial: FileItem[] = files.map(f => ({
      file: f, status: 'pending',
      docName: f.name.replace(/\.[^.]+$/, ''),
      docType: '', issueDate: '', expiryDate: '', people: '', notes: '', actions: [],
    }));
    setItems(initial);
    setStep('processing');

    for (let idx = 0; idx < initial.length; idx++) {
      setProcessingIdx(idx);

      // Upload
      updateItem(idx, { status: 'uploading' });
      const formData = new FormData();
      formData.append('file', files[idx]);
      formData.append('siteId', site.id);
      if (userId) formData.append('userId', userId);
      const uploadRes = await fetch('/api/documents/upload', { method: 'POST', body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) { updateItem(idx, { status: 'error', error: uploadData.error ?? 'Upload failed' }); continue; }
      updateItem(idx, {
        documentId: uploadData.documentId,
        duplicateId: uploadData.duplicateId ?? undefined,
        duplicateDattoFileId: uploadData.duplicateDattoFileId ?? undefined,
      });

      // AI extract — skip for view-only client uploads
      if (skipAI) { updateItem(idx, { status: 'done' }); continue; }
      updateItem(idx, { status: 'extracting' });
      const f = files[idx];
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      try {
        let aiBody: Record<string, string> = {};
        if (['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = ''; for (let b = 0; b < bytes.byteLength; b++) bin += String.fromCharCode(bytes[b]);
          const mime: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
          aiBody = { fileBase64: btoa(bin), mimeType: mime[ext] ?? 'application/pdf', docName: f.name };
        } else if (ext === 'docx') {
          const buf = await f.arrayBuffer();
          const extracted = await mammoth.convertToHtml({ arrayBuffer: buf });
          aiBody = { text: extracted.value.replace(/<[^>]+>/g, ' '), docName: f.name };
        }
        if (Object.keys(aiBody).length > 0) {
          const aiRes = await fetch('/api/ai-extract-document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(aiBody) });
          if (aiRes.ok) {
            const d = await aiRes.json();
            updateItem(idx, {
              status: 'done',
              docName: smartTitleCase(f.name),
              docType: d.documentType ?? '',
              issueDate: d.issueDate ?? '',
              expiryDate: d.expiryDate ?? '',
              people: (d.peopleMentioned ?? []).join(', '),
              actions: (d.actions ?? []).map((a: any) => ({ ...a, suggested: a.suggested ?? false, selected: true })),
            });
            continue;
          }
        }
      } catch { /* fall through */ }
      updateItem(idx, { status: 'done' });
    }

    setExpandedIdx(0);
    setStep('review');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    processFiles(files);
  };

  useEffect(() => { if (initialFiles?.length) processFiles(initialFiles); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    const priorityMap: Record<string, string> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'green' };
    let lastDoc: SiteDocument | null = null;
    let lastCompliance: number | null = null;

    try {
    for (const item of items.filter(it => it.status === 'done' && it.documentId)) {
      // Upload to Datto now that we know the user's choice
      // If there's a duplicate (replace or keep both), rename old file to v(n) date first
      const dattoForm = new FormData();
      dattoForm.append('file', item.file);
      dattoForm.append('documentId', item.documentId!);
      if (item.duplicateId && item.duplicateDattoFileId) {
        dattoForm.append('oldDattoFileId', item.duplicateDattoFileId);
      }
      const dattoRes = await fetch('/api/documents/datto-link', { method: 'POST', body: dattoForm });
      const dattoData = await dattoRes.json().catch(() => ({}));
      if (!dattoRes.ok) {
        setSaveError(dattoData.error ?? 'Failed to upload file to Datto. Please try again.');
        setSaving(false);
        return;
      }
      const dattoFileId = dattoData.dattoFileId ?? null;

      // If replacing, delete old Supabase record (Datto rename already handled by datto-link)
      // Always replace old record — versioning is handled in Datto by datto-link
      if (item.duplicateId) {
        await fetch('/api/documents', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId: item.duplicateId, skipDattoRename: true }),
        });
      }

      await fetch('/api/documents', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: item.documentId,
          document_name: item.docName || item.file.name,
          document_type: item.docType || null,
          issue_date: item.issueDate || null,
          expiry_date: item.expiryDate || null,
          people_mentioned: item.people.split(',').map((s: string) => s.trim()).filter(Boolean),
          notes: item.notes || null,
          source_document_id: dattoFileId ?? null,
          actions: item.actions.filter((x: any) => x.selected).map((a: any) => ({
            description: a.description,
            dueDate: a.dueDate ?? null,
            responsiblePerson: a.responsiblePerson ?? null,
            priority: a.priority ?? null,
            sourceDocumentName: item.file.name,
            suggested: a.suggested ?? false,
          })),
        }),
      });
      const { data: doc } = await supabase.from('site_documents').select('*').eq('id', item.documentId).single();
      if (doc) { lastDoc = doc; onSaved(doc, null, item.duplicateId, dattoFileId === null); }
    }
    const { data: siteData } = await supabase.from('sites').select('compliance_score').eq('id', site.id).single();
    lastCompliance = siteData?.compliance_score ?? null;
    if (lastDoc) onSaved(lastDoc, lastCompliance);
    setSaving(false);
    onClose();
    } catch (err: any) {
      setSaveError(err?.message ?? 'Connection error — please try again.');
      setSaving(false);
    }
  };

  const doneCount = items.filter(it => it.status === 'done').length;
  const errorCount = items.filter(it => it.status === 'error').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl overflow-hidden">
        <div className="bg-amber-500 px-6 py-4 flex items-center justify-between">
          <h2 className="font-black text-white text-sm uppercase tracking-widest flex items-center gap-2">
            <Upload size={14} />Upload Documents
          </h2>
          <button onClick={onClose} title="Close without saving" className="text-amber-200 hover:text-white"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {step === 'select' && (
            <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-slate-200 rounded-lg py-14 cursor-pointer hover:border-amber-300 hover:bg-amber-50 transition-colors">
              <Upload size={28} className="text-slate-300" />
              <span className="text-sm font-black text-slate-500">Click to select files</span>
              <span className="text-[11px] text-slate-400">PDF, DOCX, XLSX, JPG, PNG — multiple files supported</span>
              <input type="file" accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png" multiple className="hidden" onChange={handleFileChange} />
            </label>
          )}

          {step === 'processing' && (
            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3">
                Processing {processingIdx + 1} of {items.length}…
              </p>
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <div className="flex-shrink-0">
                    {it.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-slate-300" />}
                    {(it.status === 'uploading' || it.status === 'extracting') && <Sparkles size={16} className="text-amber-400 animate-pulse" />}
                    {it.status === 'done' && <CheckCircle size={16} className="text-emerald-500" />}
                    {it.status === 'error' && <AlertCircle size={16} className="text-rose-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-slate-700 truncate">{it.file.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {it.status === 'pending' ? 'Waiting…' : it.status === 'uploading' ? 'Uploading…' : it.status === 'extracting' ? 'Analysing…' : it.status === 'done' ? 'Ready' : it.error ?? 'Failed'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-3">
              {errorCount > 0 && <div className="px-4 py-2.5 bg-rose-50 border border-rose-200 rounded-xl text-[11px] font-bold text-rose-700">⚠ {errorCount} file{errorCount !== 1 ? 's' : ''} failed to upload and will be skipped.</div>}
              {items.map((it, idx) => (
                <div key={idx} className={`border rounded-lg overflow-hidden ${it.status === 'error' ? 'border-rose-200 opacity-50' : 'border-slate-200'}`}>
                  <button
                    onClick={() => setExpandedIdx(prev => prev === idx ? null : idx)}
                    title="Expand to review and edit document details"
                    className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                  >
                    <div className="flex-shrink-0">
                      {it.status === 'done' && <CheckCircle size={14} className="text-emerald-500" />}
                      {it.status === 'error' && <AlertCircle size={14} className="text-rose-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-black text-slate-700 truncate">{it.docName || it.file.name}</p>
                      {it.docType && <p className="text-[10px] text-slate-400">{it.docType}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {it.expiryDate && it.expiryDate < today && <span className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-lg">Expired</span>}
                      <ChevronDown size={14} className={`text-slate-400 transition-transform ${expandedIdx === idx ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {it.duplicateId && (
                    <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-200">
                      <p className="text-[11px] font-bold text-amber-700">⚠ A previous version exists and will be archived in Datto.</p>
                    </div>
                  )}
                  {expandedIdx === idx && it.status !== 'error' && (
                    <div className="px-4 py-4 space-y-3 border-t border-slate-100">
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className={labelClass}>Document Name</label><input value={it.docName} onChange={e => updateItem(idx, { docName: e.target.value })} className={inputClass} /></div>
                        <div><label className={labelClass}>Document Type</label><input value={it.docType} onChange={e => updateItem(idx, { docType: e.target.value })} className={inputClass} placeholder="Certificate, Training Record…" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className={labelClass}>Issue Date</label><input type="date" value={it.issueDate} onChange={e => updateItem(idx, { issueDate: e.target.value })} className={inputClass} /></div>
                        <div><label className={labelClass}>Expiry Date</label><input type="date" value={it.expiryDate} onChange={e => updateItem(idx, { expiryDate: e.target.value })} className={`${inputClass} ${it.expiryDate && it.expiryDate < today ? 'border-amber-400 bg-amber-50' : ''}`} /></div>
                      </div>
                      <div><label className={labelClass}>People Mentioned</label><input value={it.people} onChange={e => updateItem(idx, { people: e.target.value })} className={inputClass} placeholder="Comma-separated names" /></div>
                      <div><label className={labelClass}>Notes</label><textarea value={it.notes} onChange={e => updateItem(idx, { notes: e.target.value })} rows={2} className={`${inputClass} resize-none`} /></div>
                      {it.actions.length > 0 && (() => {
                        const found = it.actions.filter((a: any) => !a.suggested);
                        const suggested = it.actions.filter((a: any) => a.suggested);
                        const priorityBadge: Record<string, string> = { HIGH: 'bg-rose-50 border-rose-200 text-rose-700', MEDIUM: 'bg-amber-50 border-amber-200 text-amber-700', LOW: 'bg-emerald-50 border-emerald-200 text-emerald-700' };
                        const renderAction = (a: any, ai: number, globalIdx: number) => (
                          <label key={ai} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${a.selected ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 hover:bg-slate-50'}`}>
                            <input type="checkbox" checked={a.selected} onChange={() => updateItem(idx, { actions: it.actions.map((x: any, j: number) => j === globalIdx ? { ...x, selected: !x.selected } : x) })} className="mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0 space-y-1">
                              <p className="text-[11px] font-bold text-slate-800">{a.description}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {a.priority && <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${priorityBadge[a.priority] ?? ''}`}>{a.priority}</span>}
                                {a.dueDate && <span className="text-[9px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">Due {new Date(a.dueDate + 'T00:00:00').toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</span>}
                                {a.responsiblePerson && <span className="text-[9px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">{a.responsiblePerson}</span>}
                              </div>
                            </div>
                          </label>
                        );
                        return (
                          <div className="space-y-3">
                            {found.length > 0 && (
                              <div>
                                <label className={labelClass}>Actions Found ({found.filter((a: any) => a.selected).length} of {found.length} selected)</label>
                                <div className="space-y-1.5">{found.map((a: any, ai: number) => renderAction(a, ai, it.actions.indexOf(a)))}</div>
                              </div>
                            )}
                            {suggested.length > 0 && (
                              <div>
                                <label className={labelClass}>AI Suggested Actions ({suggested.filter((a: any) => a.selected).length} of {suggested.length} selected)</label>
                                <div className="space-y-1.5">{suggested.map((a: any, ai: number) => renderAction(a, ai, it.actions.indexOf(a)))}</div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {step === 'review' && (
          <div className="border-t border-slate-100 px-6 py-4 flex items-center gap-3">
            <span className="text-[11px] font-bold flex-1">
              {saveError ? <span className="text-rose-600">{saveError}</span> : <span className="text-slate-400">{doneCount} document{doneCount !== 1 ? 's' : ''} ready</span>}
            </span>
            <button onClick={onClose} title="Cancel without saving" className="px-5 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl font-black text-[11px] uppercase tracking-wider hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave} disabled={saving || doneCount === 0} title="Save documents to the portal" className="px-6 py-2.5 bg-amber-500 text-white rounded-xl font-black text-[11px] uppercase tracking-wider hover:bg-amber-600 disabled:opacity-50">{saving ? 'Saving…' : `Save ${doneCount > 1 ? `All ${doneCount}` : 'Document'}`}</button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── General Evidence Upload Modal ───────────────────────────────────────────
const GeneralUploadModal = ({ siteId, userId, onClose, onUploaded, initialFiles }: {
  siteId: string; userId: string | null; onClose: () => void; onUploaded: (upload: any) => void;
  initialFiles?: File[];
}) => {
  type FileItem = { file: File; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string };
  const [items, setItems] = useState<FileItem[]>([]);
  const [notes, setNotes] = useState('');
  const [notesError, setNotesError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const initialFilesApplied = React.useRef(false);

  const handleFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    setItems(prev => [...prev, ...Array.from(files).map(file => ({ file, status: 'pending' as const }))]);
  };

  useEffect(() => {
    if (initialFiles?.length && !initialFilesApplied.current) {
      initialFilesApplied.current = true;
      handleFiles(initialFiles);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async () => {
    if (!items.length) return;
    if (!notes.trim()) { setNotesError(true); return; }
    setNotesError(false);
    setUploading(true);
    const results: any[] = [];
    for (let i = 0; i < items.length; i++) {
      setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'uploading' } : it));
      const fd = new FormData();
      fd.append('file', items[i].file);
      fd.append('siteId', siteId);
      if (userId) fd.append('userId', userId);
      fd.append('notes', notes);
      const res = await fetch('/api/client-uploads', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'error', error: data.error ?? 'Upload failed' } : it));
      } else {
        setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'done' } : it));
        results.push(data.upload);
      }
    }
    setUploading(false);
    if (results.length > 0) {
      results.forEach(u => onUploaded(u));
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between">
          <h2 className="font-black text-white text-sm uppercase tracking-widest flex items-center gap-2"><Paperclip size={14} />Upload Evidence</h2>
          <button onClick={onClose} className="text-indigo-200 hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-slate-500">Upload files to be reviewed by your advisor.</p>
          <div
            onClick={() => uploadInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragEnter={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
            className={`border-2 border-dashed rounded-lg cursor-pointer transition-colors select-none ${dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'} ${items.length === 0 ? 'py-12 flex flex-col items-center justify-center gap-3' : 'py-3 px-4 flex items-center justify-center gap-2'}`}
          >
            {items.length === 0 ? (
              <>
                <Paperclip size={24} className={dragging ? 'text-indigo-400' : 'text-slate-300'} />
                <span className="text-sm font-black text-slate-500">{dragging ? 'Drop files to upload' : 'Click or drag files here'}</span>
                <span className="text-[11px] text-slate-400">PDF, DOCX, JPG, PNG — multiple files supported</span>
              </>
            ) : (
              <>
                <Plus size={14} className={dragging ? 'text-indigo-400' : 'text-slate-400'} />
                <span className="text-xs font-bold text-slate-400">{dragging ? 'Drop to add' : 'Add more files'}</span>
              </>
            )}
            <input ref={uploadInputRef} type="file" accept=".pdf,.docx,.doc,.jpg,.jpeg,.png" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
          </div>
          {items.length > 0 && (
            <div className="space-y-1">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-lg px-3 py-2">
                  <FileText size={13} className="text-indigo-400 flex-shrink-0" />
                  <span className="text-xs font-bold text-slate-700 flex-1 truncate">{it.file.name}</span>
                  {it.status === 'pending' && !uploading && <button onClick={e => { e.stopPropagation(); setItems(prev => prev.filter((_, idx) => idx !== i)); }} className="text-slate-300 hover:text-rose-400 p-0.5 flex-shrink-0"><X size={12} /></button>}
                  {it.status === 'uploading' && <span className="text-[10px] text-slate-400 animate-pulse">Uploading…</span>}
                  {it.status === 'done' && <CheckCircle size={13} className="text-emerald-500 flex-shrink-0" />}
                  {it.status === 'error' && <span className="text-[10px] text-rose-600">{it.error}</span>}
                </div>
              ))}
            </div>
          )}
          <div>
            <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider mb-1">Notes <span className="text-rose-500">*</span></label>
            <textarea value={notes} onChange={e => { setNotes(e.target.value); if (e.target.value.trim()) setNotesError(false); }} placeholder="Describe what these files relate to…" rows={3} className={`w-full border rounded-lg px-3 py-2 text-xs text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 ${notesError ? 'border-rose-400 bg-rose-50' : 'border-slate-200'}`} />
            {notesError && <p className="text-[11px] text-rose-600 mt-1 font-bold">Please add a note so your advisor knows what this relates to.</p>}
          </div>
        </div>
        <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-slate-50">Cancel</button>
          <button onClick={handleUpload} disabled={uploading || items.length === 0} className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50">
            {uploading ? 'Uploading…' : `Upload ${items.length > 1 ? `${items.length} Files` : 'File'}`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Site Documents Tab ────────────────────────────────────────────────────────
const SiteDocumentsTab = ({ site, profile, userId, onComplianceUpdate, onActionsAdded, onDocumentDeleted }: {
  site: Site; profile: Profile; userId: string | null; onComplianceUpdate: (score: number) => void; onActionsAdded?: (actions: Action[]) => void; onDocumentDeleted?: (docId: string) => void;
}) => {
  type ClientUploadRow = { id: string; file_name: string; file_size_bytes: number | null; notes: string | null; status: string; uploaded_at: string; review_note: string | null; action_id: string | null; hidden?: boolean; datto_file_id: string | null };
  const [documents, setDocuments] = useState<SiteDocument[]>([]);
  const [docActions, setDocActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showGeneralUpload, setShowGeneralUpload] = useState(false);
  const [generalUploads, setGeneralUploads] = useState<ClientUploadRow[]>([]);
  const [uploadWorking, setUploadWorking] = useState<Set<string>>(new Set());
  const [selectedUploadIds, setSelectedUploadIds] = useState<Set<string>>(new Set());
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'docs' | 'evidence' | null>(null);
  const [dragOverDocs, setDragOverDocs] = useState(false);
  const [dragOverEvidence, setDragOverEvidence] = useState(false);
  const [droppedDocsFiles, setDroppedDocsFiles] = useState<File[]>([]);
  const [droppedEvidenceFiles, setDroppedEvidenceFiles] = useState<File[]>([]);
  const [docsSearch, setDocsSearch] = useState('');
  const [evidenceSearch, setEvidenceSearch] = useState('');
  const retryTimers = React.useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => { retryTimers.current.forEach(clearTimeout); }, []);

  const scheduleDattoRetry = (docId: string, attempt = 0) => {
    const delays = [30_000, 90_000, 300_000];
    if (attempt >= delays.length) return;
    const t = setTimeout(async () => {
      const res = await fetch('/api/documents/datto-retry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: docId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.found && data.dattoFileId) {
        setDocuments(prev => prev.map(d => d.id === docId ? { ...d, datto_file_id: data.dattoFileId } : d));
      } else {
        scheduleDattoRetry(docId, attempt + 1);
      }
    }, delays[attempt]);
    retryTimers.current.push(t);
  };

  const refreshUploads = () => {
    const params = new URLSearchParams({ siteId: site.id, role: profile.role });
    if (userId) params.set('userId', userId);
    fetch(`/api/client-uploads?${params}`)
      .then(r => r.json())
      .then(d => { setGeneralUploads(d.uploads ?? []); })
      .catch(() => {});
  };

  useEffect(() => { refreshUploads(); }, [site.id, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    fetch(`/api/documents?siteId=${site.id}`)
      .then(r => r.json())
      .then(async d => {
        const docs = d.documents ?? [];
        setDocuments(docs);
        if (docs.length > 0) {
          const ids = docs.map((doc: SiteDocument) => doc.id);
          const { data, error } = await supabase.from('actions').select('*').in('site_document_id', ids);
          console.log('[docActions] ids:', ids, 'found:', data?.length ?? 0, 'error:', error);
          setDocActions((data ?? []).map((a: any) => ({
            id: a.id, action: a.title, description: a.description ?? '', date: a.due_date ?? '',
            site: a.site_id, who: a.responsible_person ?? '', source: a.source_document_name ?? '',
            source_document_id: a.source_document_id ?? undefined, priority: a.priority ?? 'green',
            regulation: '', notes: '', status: a.status ?? 'open', hazardRef: a.hazard_ref ?? null,
            hazard: a.hazard ?? null, existingControls: a.existing_controls ?? null,
            resolvedDate: a.resolved_date ?? null, sourceFolderId: a.source_folder_id ?? null,
            _siteDocumentId: a.site_document_id ?? null,
          } as any)));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [site.id]);

  const handleToggleAction = async (id: string, resolved: boolean) => {
    const status = resolved ? 'resolved' : 'open';
    const resolvedDate = resolved ? new Date().toISOString().slice(0, 10) : null;
    await supabase.from('actions').update({ status, resolved_date: resolvedDate }).eq('id', id);
    setDocActions(prev => prev.map(a => a.id === id ? { ...a, status: status as ActionStatus, resolvedDate } : a));
  };

  const handleDelete = async (id: string) => {
    const res = await fetch('/api/documents', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: id }) });
    setDocuments(prev => prev.filter(d => d.id !== id));
    setDocActions(prev => prev.filter(a => (a as any)._siteDocumentId !== id));
    onDocumentDeleted?.(id);
    const { data } = await supabase.from('sites').select('compliance_score').eq('id', site.id).single();
    if (data?.compliance_score != null) onComplianceUpdate(data.compliance_score);
    if (!res.ok) console.error('[delete] API returned non-ok:', res.status);
  };

  const handleRename = async (id: string, newName: string) => {
    await fetch('/api/documents', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: id, document_name: newName }),
    });
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, document_name: newName } : d));
  };

  const handleSaved = async (doc: SiteDocument, newCompliance: number | null, replacedId?: string, dattoPending?: boolean) => {
    setActiveSection('docs');
    if (dattoPending) scheduleDattoRetry(doc.id);
    setDocuments(prev => {
      const filtered = replacedId ? prev.filter(d => d.id !== replacedId) : prev;
      const idx = filtered.findIndex(d => d.id === doc.id);
      if (idx >= 0) { const u = [...filtered]; u[idx] = doc; return u; }
      return [doc, ...filtered];
    });
    if (replacedId) {
      setDocActions(prev => prev.filter(a => (a as any)._siteDocumentId !== replacedId));
      onDocumentDeleted?.(replacedId);
    }
    if (newCompliance != null) onComplianceUpdate(newCompliance);
    // Reload linked actions so newly generated ones appear
    const { data } = await supabase.from('actions').select('*').eq('site_document_id', doc.id);
    if (data) {
      const mapped = data.map((a: any) => ({
        id: a.id, action: a.title, description: a.description ?? '', date: a.due_date ?? '',
        site: site.name, who: a.responsible_person ?? '', source: a.source_document_name ?? '',
        source_document_id: a.source_document_id ?? undefined, priority: a.priority ?? 'green',
        regulation: '', notes: '', status: a.status ?? 'open', hazardRef: a.hazard_ref ?? null,
        hazard: a.hazard ?? null, existingControls: a.existing_controls ?? null,
        resolvedDate: a.resolved_date ?? null, sourceFolderId: a.source_folder_id ?? null,
        _siteDocumentId: a.site_document_id ?? null, isSuggested: a.is_suggested ?? false,
      } as any));
      setDocActions(prev => [...prev.filter(a => (a as any)._siteDocumentId !== doc.id), ...mapped]);
      onActionsAdded?.(mapped);
    }
  };

  const handleOpenUpload = (u: ClientUploadRow) => {
    const isAdvisor = profile.role === 'advisor' || profile.role === 'superadmin';
    // Advisor + Office file: always try W: drive ms- protocol (path needs only siteFolderPath)
    if (isAdvisor && site.datto_folder_path) {
      const folderPath = `${site.datto_folder_path}/Client Provided Documents`;
      const href = getFileHref({ id: u.datto_file_id ?? '', name: u.file_name, type: 'file' }, folderPath, profile.role);
      if (href.startsWith('ms-')) { window.location.href = href; return; }
    }
    // Non-Office with Datto ID: Datto API inline (PDFs open in browser)
    if (u.datto_file_id) {
      window.open(`/api/datto/file?fileId=${u.datto_file_id}&fileName=${encodeURIComponent(u.file_name)}`, '_blank');
      return;
    }
    // Fallback: Supabase signed URL (no forced download)
    fetch(`/api/client-uploads/${u.id}`).then(r => r.json()).then(d => { if (d.url) window.open(d.url, '_blank'); });
  };

  const deleteUpload = async (id: string) => {
    setUploadWorking(prev => new Set(prev).add(id));
    const res = await fetch(`/api/client-uploads/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setGeneralUploads(prev => prev.filter(u => u.id !== id));
      setSelectedUploadIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
    setUploadWorking(prev => { const s = new Set(prev); s.delete(id); return s; });
  };
  const bulkDelete = async () => {
    const targets = selectedUploadIds.size > 0
      ? generalUploads.filter(u => selectedUploadIds.has(u.id))
      : generalUploads;
    const results = await Promise.all(targets.map(u => fetch(`/api/client-uploads/${u.id}`, { method: 'DELETE' }).then(r => ({ id: u.id, ok: r.ok }))));
    const deletedIds = new Set(results.filter(r => r.ok).map(r => r.id));
    setGeneralUploads(prev => prev.filter(u => !deletedIds.has(u.id)));
    setSelectedUploadIds(new Set());
  };

  return (
    <div className="space-y-3">
      {/* Client Managed Documents */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOverDocs(true); }}
        onDragEnter={e => { e.preventDefault(); setDragOverDocs(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDocs(false); }}
        onDrop={e => { e.preventDefault(); setDragOverDocs(false); const files = Array.from(e.dataTransfer.files); if (files.length) { setDroppedDocsFiles(files); setShowUpload(true); } }}
        className={`border rounded-lg overflow-hidden transition-all ${dragOverDocs ? 'border-amber-400 ring-2 ring-amber-200' : 'border-amber-200'}`}
      >
        <button
          onClick={() => setActiveSection(p => p === 'docs' ? null : 'docs')}
          className="w-full bg-amber-100 hover:bg-amber-200/60 px-5 py-3.5 flex items-center gap-3 transition-colors"
        >
          <ChevronDown size={14} className={`text-amber-500 flex-shrink-0 transition-transform ${activeSection === 'docs' ? 'rotate-180' : ''}`} />
          <div className="flex-1 text-left min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">Client Managed Documents</p>
            <p className="text-[11px] text-amber-700/70 mt-0.5">Documents owned and managed by the client</p>
          </div>
          <span className="text-[10px] font-bold text-slate-400 mr-1 flex-shrink-0">{documents.length > 0 ? `${documents.length} file${documents.length !== 1 ? 's' : ''}` : 'No files'}</span>
          <button
            onClick={e => { e.stopPropagation(); setShowUpload(true); }}
            className="flex items-center gap-1.5 bg-amber-500 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 shadow-sm flex-shrink-0"
          >
            <Upload size={11} />Upload Client Docs
          </button>
        </button>
        {activeSection === 'docs' && (
          <div className="bg-amber-50 border-t border-amber-200 px-5 pb-4 pt-3 space-y-3">
            <div className="space-y-1">
              <p className="text-xs text-amber-800">Upload your compliance documents here — certificates, inspection reports, training records, insurance, and any other evidence relevant to your site. Uploaded documents are stored securely and our AI will automatically identify key dates and any actions required.</p>
              <p className="text-xs text-amber-800">These documents are owned and managed by the client and remain their sole responsibility to keep current and accurate.</p>
              <p className="text-xs text-amber-800">Due to varying document formats, actions identified below are generated automatically and <span className="font-black">may not be fully accurate</span> — always read the original document to verify.</p>
              <p className="text-xs text-amber-800">Any concerns should be discussed with your advisor. Issues identified may require a review of your contract and could result in an increase in contract price.</p>
            </div>
            {!loading && documents.length > 0 && (
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-400 pointer-events-none" />
                <input value={docsSearch} onChange={e => setDocsSearch(e.target.value)} placeholder="Filter by document name…" className="w-full pl-8 pr-8 py-2 border border-amber-200 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-300 placeholder:text-slate-400" />
                {docsSearch && <button onClick={() => setDocsSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={13} /></button>}
              </div>
            )}
            {loading ? (
              <div className="text-center py-8 text-slate-400 text-sm font-bold animate-pulse">Loading documents…</div>
            ) : documents.length === 0 ? (
              <div className="bg-white rounded-lg border border-amber-100 p-8 text-center"><FileCheck size={28} className="text-amber-200 mx-auto mb-2" /><p className="font-black text-slate-600 text-sm">No documents uploaded yet</p><p className="text-xs text-slate-400 mt-1">Upload certificates, training records, and compliance evidence.</p></div>
            ) : (() => {
              const filtered = docsSearch.trim() ? documents.filter(d => (d.document_name || d.file_name).toLowerCase().includes(docsSearch.toLowerCase())) : documents;
              return filtered.length === 0
                ? <p className="text-xs text-amber-700 text-center py-4">No documents match "{docsSearch}"</p>
                : <div className="space-y-2">{filtered.map(doc => <DocumentCard key={doc.id} doc={doc} role={profile.role} userId={userId} actions={docActions.filter(a => (a as any)._siteDocumentId === doc.id)} onDelete={handleDelete} onRename={handleRename} onToggleAction={handleToggleAction} expanded={expandedDocId === doc.id} onExpand={() => setExpandedDocId(prev => prev === doc.id ? null : doc.id)} onDattoRetry={(id, fileId) => setDocuments(prev => prev.map(d => d.id === id ? { ...d, datto_file_id: fileId } : d))} siteFolderPath={site.datto_folder_path ?? null} />)}</div>;
            })()}
          </div>
        )}
      </div>

      {/* Uploaded Evidence */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOverEvidence(true); }}
        onDragEnter={e => { e.preventDefault(); setDragOverEvidence(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverEvidence(false); }}
        onDrop={e => { e.preventDefault(); setDragOverEvidence(false); const files = Array.from(e.dataTransfer.files); if (files.length) { setDroppedEvidenceFiles(files); setShowGeneralUpload(true); } }}
        className={`border rounded-lg overflow-hidden transition-all ${dragOverEvidence ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-indigo-200'}`}
      >
        <button
          onClick={() => setActiveSection(p => p === 'evidence' ? null : 'evidence')}
          className="w-full bg-indigo-100 hover:bg-indigo-200/60 px-5 py-3.5 flex items-center gap-3 transition-colors"
        >
          <ChevronDown size={14} className={`text-indigo-500 flex-shrink-0 transition-transform ${activeSection === 'evidence' ? 'rotate-180' : ''}`} />
          <div className="flex-1 text-left min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Uploaded Evidence</p>
            <p className="text-[11px] text-indigo-700/70 mt-0.5">Evidence uploaded to support completion of actions</p>
          </div>
          <span className="text-[10px] font-bold text-slate-400 mr-1 flex-shrink-0">{generalUploads.length > 0 ? `${generalUploads.length} file${generalUploads.length !== 1 ? 's' : ''}` : 'No files'}</span>
          {activeSection === 'evidence' && generalUploads.length > 0 && (
            <button
              onClick={e => { e.stopPropagation(); bulkDelete(); }}
              className="flex items-center gap-1.5 bg-rose-500 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 shadow-sm flex-shrink-0"
            >
              <Trash2 size={11} />{selectedUploadIds.size > 0 ? `Delete (${selectedUploadIds.size})` : 'Delete All'}
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); setShowGeneralUpload(true); }}
            className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 shadow-sm flex-shrink-0"
          >
            <Paperclip size={11} />Upload Evidence
          </button>
        </button>
        {activeSection === 'evidence' && (
          <div className="bg-indigo-50 border-t border-indigo-200 px-5 pb-4 pt-3 space-y-3">
            <div className="space-y-1">
              <p className="text-xs text-indigo-800">Use <span className="font-black">Upload</span> to send files directly to your advisor — for example, photos of completed work, signed inspection records, training certificates, or any other confirmation that a task has been carried out.</p>
              <p className="text-xs text-indigo-800">Unlike documents uploaded via Client Managed Documents, evidence files are not scanned for actions by AI. Your advisor will review each file and either acknowledge it or link it to an existing action to support completion of the action. You will be able to see the outcome below once reviewed.</p>
              <p className="text-xs text-indigo-800">Please include a brief note with each upload describing what the file relates to so your advisor can process it quickly.</p>
            </div>
            {generalUploads.length > 0 && (
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" />
                <input value={evidenceSearch} onChange={e => setEvidenceSearch(e.target.value)} placeholder="Filter by file name…" className="w-full pl-8 pr-8 py-2 border border-indigo-200 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400" />
                {evidenceSearch && <button onClick={() => setEvidenceSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={13} /></button>}
              </div>
            )}
            {generalUploads.length === 0 ? (
              <div className="bg-white rounded-lg border border-indigo-100 p-8 text-center"><Paperclip size={28} className="text-indigo-200 mx-auto mb-2" /><p className="font-black text-slate-600 text-sm">No evidence uploaded yet</p><p className="text-xs text-slate-400 mt-1">Upload photos, certificates, or records for your advisor to review.</p></div>
            ) : (() => {
              const filtered = evidenceSearch.trim() ? generalUploads.filter(u => u.file_name.toLowerCase().includes(evidenceSearch.toLowerCase())) : generalUploads;
              return filtered.length === 0
                ? <p className="text-xs text-indigo-700 text-center py-4">No files match "{evidenceSearch}"</p>
                : <div className="space-y-1.5">
                {filtered.map(u => {
                  const statusColour = u.status === 'pending_review' ? 'bg-amber-100 text-amber-700' : u.status === 'acknowledged' ? 'bg-slate-100 text-slate-600' : 'bg-violet-100 text-violet-700';
                  const statusLabel = u.status === 'pending_review' ? 'Pending review' : u.status === 'acknowledged' ? 'Acknowledged' : 'Linked to action';
                  const busy = uploadWorking.has(u.id);
                  return (
                    <div key={u.id} className={`bg-indigo-50/40 border border-indigo-100 rounded-lg overflow-hidden ${busy ? 'opacity-40 pointer-events-none' : ''}`}>
                      <div className="bg-indigo-100/60 px-4 py-3 flex items-start gap-3">
                      <input type="checkbox" checked={selectedUploadIds.has(u.id)} onChange={() => setSelectedUploadIds(prev => { const s = new Set(prev); s.has(u.id) ? s.delete(u.id) : s.add(u.id); return s; })} className="mt-0.5 flex-shrink-0" />
                      <Paperclip size={13} className="text-indigo-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-700 truncate">{u.file_name}</p>
                        {u.notes && <p className="text-[11px] text-slate-500 mt-0.5">{u.notes}</p>}
                        {u.review_note && <p className="text-[11px] text-indigo-600 mt-0.5 font-bold">Advisor: {u.review_note}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-slate-400">{new Date(u.uploaded_at).toLocaleDateString('en-GB')}</span>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${statusColour}`}>{statusLabel}</span>
                        <button onClick={() => handleOpenUpload(u)} title="Open file" className="text-slate-300 hover:text-indigo-500 transition-colors"><ExternalLink size={12} /></button>
                        <button onClick={() => deleteUpload(u.id)} title="Delete" className="text-slate-300 hover:text-rose-500 transition-colors"><Trash2 size={12} /></button>
                      </div>
                    </div>
                    </div>
                  );
                })}
              </div>;
            })()}
          </div>
        )}
      </div>

      {showUpload && <UploadModal site={site} userId={userId} onClose={() => { setShowUpload(false); setDroppedDocsFiles([]); }} onSaved={handleSaved} initialFiles={droppedDocsFiles.length ? droppedDocsFiles : undefined} skipAI={profile.view_only} />}
      {showGeneralUpload && <GeneralUploadModal siteId={site.id} userId={userId} onClose={() => { setShowGeneralUpload(false); setDroppedEvidenceFiles([]); }} onUploaded={() => { refreshUploads(); setActiveSection('evidence'); }} initialFiles={droppedEvidenceFiles.length ? droppedEvidenceFiles : undefined} />}
    </div>
  );
};

// ─── Document Health Tab ──────────────────────────────────────────────────────
const DocHealthTab = ({ siteId, onComplianceUpdate, onJumpToActions, role, onArchive, onClone, onUnarchive }: {
  siteId: string;
  onComplianceUpdate?: (score: number) => void;
  onJumpToActions?: (docName: string) => void;
  role?: string;
  onArchive?: (docName: string, folderPath: string, issueDate: string | null, siteId: string, silent?: boolean) => Promise<{ archivedFileId?: string; originalFolderId?: string; archivedTargetPath?: string } | void>;
  onClone?: (fileId: string, docName: string, folderId: string, folderPath: string | null) => Promise<{ newFileId: string | null; newFileName: string } | void>;
  onUnarchive?: (docName: string) => void;
}) => {
  type DocRow = { docName: string; issueDate: string | null; actionCount: number; reviewDue: string | null; fileId: string | null; folderPath: string | null; folderId: string | null };
  type BulkLogEntry = { docName: string; success: boolean; error?: string; archivedFileId?: string | null; originalFolderId?: string; archivedTargetPath?: string; archiveWdrivePath?: string; cloneFileId?: string | null; cloneName?: string; cloneWdrivePath?: string; via?: string; savedRow?: DocRow; undone?: boolean };
  const [rows, setRows] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDoc, setEditingDoc] = useState<string | null>(null);
  const [reviewInput, setReviewInput] = useState('');
  const [showHelper, setShowHelper] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState<string | null>(null);
  const [archiveWithClone, setArchiveWithClone] = useState(false);
  const [archivingDoc, setArchivingDoc] = useState<string | null>(null);
  const [cloningDoc, setCloningDoc] = useState<string | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [bulkWithClone, setBulkWithClone] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');
  const [bulkLog, setBulkLog] = useState<BulkLogEntry[]>([]);
  const [showBulkLog, setShowBulkLog] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from('actions').select('source_document_name, issue_date, source_document_id, source_folder_path, source_folder_id').eq('site_id', siteId).not('source_document_name', 'is', null).is('site_document_id', null).neq('status', 'archived').neq('status', 'ai_suggested'),
      supabase.from('document_health').select('document_name, review_due').eq('site_id', siteId),
    ]).then(([actRes, healthRes]) => {
      const actions = actRes.data ?? [];
      const health = healthRes.data ?? [];
      // Group actions by source document name
      const map = new Map<string, { issueDate: string | null; count: number; fileId: string | null; folderPath: string | null; folderId: string | null }>();
      for (const a of actions) {
        const name: string = a.source_document_name;
        const existing = map.get(name);
        const d = a.issue_date as string | null;
        const fid = (a.source_document_id as string | null) ?? null;
        const fp = (a.source_folder_path as string | null) ?? null;
        const folderId = (a.source_folder_id as string | null) ?? null;
        if (!existing) {
          map.set(name, { issueDate: d, count: 1, fileId: fid, folderPath: fp, folderId });
        } else {
          map.set(name, {
            count: existing.count + 1,
            issueDate: d && (!existing.issueDate || d > existing.issueDate) ? d : existing.issueDate,
            fileId: existing.fileId ?? fid,
            folderPath: existing.folderPath ?? fp,
            folderId: existing.folderId ?? folderId,
          });
        }
      }
      const reviewMap = new Map(health.map((h: any) => [h.document_name, h.review_due as string | null]));
      const built = Array.from(map.entries()).map(([docName, v]) => ({
        docName,
        issueDate: v.issueDate,
        actionCount: v.count,
        reviewDue: reviewMap.get(docName) ?? null,
        fileId: v.fileId,
        folderPath: v.folderPath,
        folderId: v.folderId,
      }));
      // Sort: red first, then amber, then grey, then green
      const statusOrder = (r: typeof built[0]) => {
        const s = docStatus(r.issueDate, r.reviewDue, new Date().toISOString().slice(0, 10));
        return s === 'red' ? 0 : s === 'amber' ? 1 : s === 'grey' ? 2 : 3;
      };
      built.sort((a, b) => statusOrder(a) - statusOrder(b));

      // Auto-populate review_due = issue_date + 1 year for docs with no date set
      const toBackfill = built.filter(r => r.issueDate && !r.reviewDue);
      // Compute compliance score client-side and update card immediately
      const todayStr = new Date().toISOString().slice(0, 10);
      if (built.length > 0) {
        const pts = built.reduce((sum, r) => {
          const s = docStatus(r.issueDate, r.reviewDue, todayStr);
          return sum + (s === 'green' ? 100 : s === 'amber' ? 95 : s === 'red' ? 0 : 50);
        }, 0);
        const score = Math.round(pts / (built.length * 100) * 100);
        onComplianceUpdate?.(score);
      }

      // Backfill missing review_due dates + persist score to DB
      if (toBackfill.length > 0) {
        const upserts = toBackfill.map(r => {
          const d = new Date(r.issueDate! + 'T00:00:00');
          d.setFullYear(d.getFullYear() + 1);
          const reviewDue = d.toISOString().slice(0, 10);
          r.reviewDue = reviewDue;
          return { site_id: siteId, document_name: r.docName, review_due: reviewDue };
        });
        supabase.from('document_health').upsert(upserts, { onConflict: 'site_id,document_name' })
          .then(() => fetch('/api/actions/recalc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: siteId }) }).catch(() => {}));
      } else {
        fetch('/api/actions/recalc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: siteId }) }).catch(() => {});
      }

      setRows(built);
    }).finally(() => setLoading(false));
  }, [siteId]);

  const today = new Date().toLocaleDateString('en-CA');
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const ageLabel = (d: string) => {
    const months = Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24 * 30.5));
    if (months < 1) return 'this month';
    if (months < 12) return `${months}mo ago`;
    const yrs = Math.floor(months / 12); const rem = months % 12;
    return rem > 0 ? `${yrs}y ${rem}mo ago` : `${yrs}y ago`;
  };

  function docStatus(issueDate: string | null, reviewDue: string | null, today: string): 'red' | 'amber' | 'green' | 'grey' {
    if (reviewDue) {
      const days = Math.ceil((new Date(reviewDue + 'T00:00:00').getTime() - Date.now()) / 86400000);
      if (reviewDue < today) return 'red';
      if (days <= 30) return 'amber';
      return 'green';
    }
    if (!issueDate) return 'grey';
    const months = Math.floor((Date.now() - new Date(issueDate + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24 * 30.5));
    if (months > 24) return 'red';
    if (months > 12) return 'amber';
    return 'green';
  }

  const statusBadge = (s: 'red' | 'amber' | 'green' | 'grey', reviewDue: string | null) => {
    if (s === 'red') return <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">{reviewDue ? 'Review Overdue' : 'Review Overdue'}</span>;
    if (s === 'amber') return <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">{reviewDue ? 'Due Soon' : 'Review Recommended'}</span>;
    if (s === 'grey') return <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Date Unknown</span>;
    return <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">Current</span>;
  };

  const handleSaveReviewDue = async (docName: string, date: string | null) => {
    setEditingDoc(null);
    await supabase.from('document_health').upsert(
      { site_id: siteId, document_name: docName, review_due: date || null },
      { onConflict: 'site_id,document_name' }
    );
    const updatedRows = rows.map(r => r.docName === docName ? { ...r, reviewDue: date || null } : r);
    setRows(updatedRows);
    // Compute score client-side from updated rows and update card immediately
    const todayStr = new Date().toISOString().slice(0, 10);
    if (updatedRows.length > 0) {
      const pts = updatedRows.reduce((sum, r) => {
        const s = docStatus(r.issueDate, r.reviewDue, todayStr);
        return sum + (s === 'green' ? 100 : s === 'amber' ? 95 : s === 'red' ? 0 : 50);
      }, 0);
      onComplianceUpdate?.(Math.round(pts / (updatedRows.length * 100) * 100));
    }
    // Persist to DB in background
    fetch('/api/actions/recalc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: siteId }) }).catch(() => {});
  };

  const counts = { red: rows.filter(r => docStatus(r.issueDate, r.reviewDue, today) === 'red').length, amber: rows.filter(r => docStatus(r.issueDate, r.reviewDue, today) === 'amber').length, green: rows.filter(r => docStatus(r.issueDate, r.reviewDue, today) === 'green').length, grey: rows.filter(r => docStatus(r.issueDate, r.reviewDue, today) === 'grey').length };

  const allSelected = rows.length > 0 && rows.every(r => selectedDocs.has(r.docName));
  const someSelected = selectedDocs.size > 0;
  const selectedRows = rows.filter(r => selectedDocs.has(r.docName));
  const hasCloneable = someSelected && selectedRows.every(r => r.fileId && r.folderId && r.docName.toLowerCase().endsWith('.docx'));
  const toggleDoc = (name: string) => setSelectedDocs(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const toggleAll = () => setSelectedDocs(allSelected ? new Set() : new Set(rows.map(r => r.docName)));

  const runBulkArchive = async (withClone: boolean) => {
    if (!onArchive) return;
    setShowBulkConfirm(false);
    setBulkRunning(true);
    const log: BulkLogEntry[] = [];
    const selected = rows.filter(r => selectedDocs.has(r.docName));
    for (let i = 0; i < selected.length; i++) {
      const row = selected[i];
      setBulkProgress(`${i + 1} / ${selected.length}: ${row.docName.replace(/\.[^.]+$/, '')}`);
      try {
        let cloneFileId: string | null = null;
        let cloneName: string | undefined;
        let cloneVia: string | undefined;
        let cloneWdrivePath: string | undefined;
        if (withClone && onClone && row.fileId && row.folderId && row.docName.toLowerCase().endsWith('.docx')) {
          const cloneResult = await onClone(row.fileId, row.docName, row.folderId, row.folderPath);
          cloneFileId = (cloneResult as any)?.newFileId ?? null;
          cloneName = (cloneResult as any)?.newFileName ?? undefined;
          cloneVia = (cloneResult as any)?.via ?? undefined;
          cloneWdrivePath = (cloneResult as any)?.wdrivePath ?? undefined;
        }
        const result = await onArchive(row.docName, row.folderPath ?? '', row.issueDate, siteId, true);
        const r = result as { archivedFileId?: string; originalFolderId?: string; archivedTargetPath?: string; wdrivePath?: string; via?: string } | undefined;
        log.push({ docName: row.docName, success: true, archivedFileId: r?.archivedFileId, originalFolderId: r?.originalFolderId, archivedTargetPath: r?.archivedTargetPath, archiveWdrivePath: r?.wdrivePath, cloneFileId, cloneName, cloneWdrivePath, via: cloneVia ?? r?.via, savedRow: row });
        setRows(prev => prev.filter(p => p.docName !== row.docName));
      } catch (err: any) {
        log.push({ docName: row.docName, success: false, error: err.message ?? 'Failed', savedRow: row });
      }
    }
    setSelectedDocs(new Set());
    setBulkRunning(false);
    setBulkProgress('');
    setBulkLog(log);
    setShowBulkLog(true);
  };

  const undoBulkEntry = async (entry: BulkLogEntry, idx: number) => {
    if (entry.undone || (!entry.archivedFileId && !entry.cloneFileId)) return;
    if (entry.archivedFileId && entry.originalFolderId) {
      const res = await fetch('/api/datto/unarchive-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivedFileId: entry.archivedFileId, originalFolderId: entry.originalFolderId, originalFileName: entry.savedRow?.docName ?? entry.docName }),
      });
      const data = await res.json();
      if (!res.ok) { alert(apiErr(data, 'Undo failed')); return; }
      await supabase.from('actions').update({ status: 'open', resolved_date: null }).eq('site_id', siteId).eq('source_document_name', entry.savedRow?.docName ?? entry.docName);
      if (entry.savedRow) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const statusOrder = (r: DocRow) => { const s = docStatus(r.issueDate, r.reviewDue, todayStr); return s === 'red' ? 0 : s === 'amber' ? 1 : s === 'grey' ? 2 : 3; };
        setRows(prev => [...prev, entry.savedRow!].sort((a, b) => statusOrder(a) - statusOrder(b)));
      }
      onUnarchive?.(entry.savedRow?.docName ?? entry.docName);
    }
    if (entry.cloneFileId) {
      await fetch('/api/datto/delete-file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: entry.cloneFileId }),
      });
    }
    setBulkLog(prev => prev.map((e, i) => i === idx ? { ...e, undone: true } : e));
  };

  const doArchive = async (row: typeof rows[0], withClone = false) => {
    if (!onArchive) return;
    setConfirmingArchive(null);
    setArchivingDoc(row.docName);
    try {
      let cloneFileId: string | null = null;
      let cloneName: string | undefined;
      let cloneVia: string | undefined;
      let cloneWdrivePath: string | undefined;
      if (withClone && onClone && row.fileId && row.folderId) {
        const cloneResult = await onClone(row.fileId, row.docName, row.folderId, row.folderPath);
        cloneFileId = (cloneResult as any)?.newFileId ?? null;
        cloneName = (cloneResult as any)?.newFileName ?? undefined;
        cloneVia = (cloneResult as any)?.via ?? undefined;
        cloneWdrivePath = (cloneResult as any)?.wdrivePath ?? undefined;
      }
      const result = await onArchive(row.docName, row.folderPath ?? '', row.issueDate, siteId, true);
      const r = result as { archivedFileId?: string; originalFolderId?: string; archivedTargetPath?: string; wdrivePath?: string; via?: string } | undefined;
      setRows(prev => prev.filter(p => p.docName !== row.docName));
      setBulkLog([{ docName: row.docName, success: true, archivedFileId: r?.archivedFileId, originalFolderId: r?.originalFolderId, archivedTargetPath: r?.archivedTargetPath, archiveWdrivePath: r?.wdrivePath, cloneFileId, cloneName, cloneWdrivePath, via: cloneVia ?? r?.via, savedRow: row }]);
    } catch (err: any) {
      setBulkLog([{ docName: row.docName, success: false, error: err.message ?? 'Failed', savedRow: row }]);
    } finally {
      setArchivingDoc(null);
      setShowBulkLog(true);
    }
  };

  const doClone = async (row: typeof rows[0]) => {
    if (!onClone || !row.fileId || !row.folderId) return;
    setCloningDoc(row.docName);
    try {
      const result = await onClone(row.fileId, row.docName, row.folderId, row.folderPath);
      const cloneFileId = (result as any)?.newFileId ?? null;
      const cloneName = (result as any)?.newFileName ?? row.docName;
      const via = (result as any)?.via ?? undefined;
      const cloneWdrivePath = (result as any)?.wdrivePath ?? undefined;
      setBulkLog([{ docName: row.docName, success: true, cloneFileId, cloneName, cloneWdrivePath, via, savedRow: row }]);
    } catch (err: any) {
      setBulkLog([{ docName: row.docName, success: false, error: err.message ?? 'Failed', savedRow: row }]);
    } finally {
      setCloningDoc(null);
      setShowBulkLog(true);
    }
  };

  if (loading) return <div className="py-8 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div>;

  return (
    <div className="space-y-3">
      {/* Helper text */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <button onClick={() => setShowHelper(h => !h)} title="How document health scores are calculated" className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors">
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><AlertCircle size={13} className="text-slate-400" />How document health is calculated</span>
          <ChevronDown size={14} className={`text-slate-400 transition-transform ${showHelper ? 'rotate-180' : ''}`} />
        </button>
        {showHelper && (
          <div className="px-5 pb-4 space-y-2 border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-600">Documents are grouped from your AI-synced Risk Assessments. The <span className="font-bold">Last Assessed</span> date is extracted automatically by AI from each document — it reflects when the assessment was last completed, not when the file was uploaded to Datto.</p>
            <p className="text-xs text-slate-600"><span className="font-bold">Review Due</span> is set automatically to 1 year from the Last Assessed date. You can override this per document to reflect the actual risk level and review frequency required. When set, the status is driven by that date. When not set, status is based on the age of the last assessment.</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2">
              <p className="text-xs text-slate-500 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />Review due more than 30 days away — Current</p>
              <p className="text-xs text-slate-500 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />Review due within 30 days — Due Soon</p>
              <p className="text-xs text-slate-500 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" />Review date has passed — Overdue</p>
              <p className="text-xs text-slate-500 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-slate-400 flex-shrink-0" />Assessment date not yet known — re-sync to extract</p>
            </div>
            <p className="text-xs text-slate-400 mt-1 italic">These thresholds are a guide only. Review frequency should reflect the risk level of each assessment — high-risk COSHH may need annual review; a low-risk general RA may be appropriate every 3 years.</p>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-amber-500 px-6 py-4 flex items-center justify-between">
          <h3 className="font-black text-white uppercase tracking-widest text-sm flex items-center gap-2"><FileCheck size={14} />Document Management — {rows.length} assessed document{rows.length !== 1 ? 's' : ''}</h3>
          <div className="flex items-center gap-3 text-[11px] font-bold">
            {counts.red > 0 && <span className="text-white">{counts.red} overdue</span>}
            {counts.amber > 0 && <span className="text-amber-100">{counts.amber} review due</span>}
            {counts.grey > 0 && <span className="text-amber-200">{counts.grey} unknown</span>}
            {counts.green > 0 && <span className="text-amber-200">{counts.green} current</span>}
          </div>
        </div>
        {someSelected && !bulkRunning && !showBulkConfirm && (
          <div className="bg-amber-50 border-b border-amber-200 px-5 py-2.5 flex items-center gap-3">
            <span className="text-[12px] font-bold text-amber-800 flex-1">{selectedDocs.size} document{selectedDocs.size !== 1 ? 's' : ''} selected</span>
            {onArchive && <button onClick={() => { setBulkWithClone(false); setShowBulkConfirm(true); }} title="Move selected documents to Z-Archived in Datto and remove their portal actions" className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[11px] font-black hover:bg-amber-600"><Archive size={11} />Archive</button>}
            {onArchive && hasCloneable && <button onClick={() => { setBulkWithClone(true); setShowBulkConfirm(true); }} title="Archive selected and create blank clones for new assessments" className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 text-white rounded-lg text-[11px] font-black hover:bg-indigo-600"><Copy size={11} />Archive + Clone</button>}
            <button onClick={() => setSelectedDocs(new Set())} title="Clear document selection" className="text-[11px] font-bold text-slate-500 hover:text-slate-700">Clear</button>
          </div>
        )}
        {showBulkConfirm && (
          <div className="bg-amber-100 border-b border-amber-200 px-5 py-2.5 flex items-center gap-3">
            <span className="flex-1 text-[12px] font-medium text-amber-900">Archive {selectedDocs.size} document{selectedDocs.size !== 1 ? 's' : ''}?{bulkWithClone ? ' A blank clone will be created for each.' : ' They will be moved to Z-Archived Documents.'}</span>
            <button onClick={() => runBulkArchive(bulkWithClone)} title="Confirm bulk archive" className="px-3 py-1.5 bg-amber-500 text-white rounded-lg font-black text-[11px] hover:bg-amber-600">Confirm</button>
            <button onClick={() => setShowBulkConfirm(false)} title="Cancel" className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg font-black text-[11px] hover:bg-slate-50">Cancel</button>
          </div>
        )}
        {bulkRunning && (
          <div className="bg-violet-50 border-b border-violet-100 px-5 py-2.5">
            <p className="text-[11px] font-bold text-violet-700 animate-pulse">Archiving… {bulkProgress}</p>
          </div>
        )}
        {rows.length === 0 ? (
          <div className="p-12 text-center"><FileText size={28} className="text-slate-300 mx-auto mb-3" /><p className="font-black text-slate-700 text-sm">No AI-synced documents found for this site</p><p className="text-sm text-slate-400 mt-1">Run an AI sync to populate document health data.</p></div>
        ) : (
          <table className="w-full text-left">
            <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-3 py-3 w-[4%]"><input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }} onChange={toggleAll} className="accent-indigo-600 cursor-pointer" disabled={bulkRunning} /></th><th className="px-4 py-3 w-[32%]">Document</th><th className="px-3 py-3 w-[16%]">Last Assessed</th><th className="px-3 py-3 w-[13%]">Review Due</th><th className="px-3 py-3 w-[14%]">Status</th><th className="px-3 py-3 w-[8%] text-center">Actions</th><th className="px-3 py-3 w-[13%]"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(row => {
                const s = docStatus(row.issueDate, row.reviewDue, today);
                const isArchiving = archivingDoc === row.docName;
                const isCloning = cloningDoc === row.docName;
                const isConfirming = confirmingArchive === row.docName;
                const isDocx = row.docName.toLowerCase().endsWith('.docx');
                return (
                  <React.Fragment key={row.docName}>
                  <tr className={s === 'red' ? 'bg-rose-50/40' : s === 'amber' ? 'bg-amber-50/30' : ''}>
                    <td className="px-3 py-3.5">
                      <input type="checkbox" checked={selectedDocs.has(row.docName)} onChange={() => toggleDoc(row.docName)} className="accent-indigo-600 cursor-pointer" disabled={bulkRunning} />
                    </td>
                    <td className="px-4 py-3.5 text-sm max-w-xs">
                      <button
                        onClick={() => onJumpToActions?.(row.docName)}
                        className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline truncate w-full text-left block"
                        title={`View actions for: ${row.docName.replace(/\.[^.]+$/, '')}`}
                      >
                        {row.docName.replace(/\.[^.]+$/, '')}
                      </button>
                    </td>
                    <td className="px-3 py-3.5 text-[13px] text-slate-600">
                      {row.issueDate
                        ? <span>{fmt(row.issueDate)} <span className="text-slate-400 text-[11px]">({ageLabel(row.issueDate)})</span></span>
                        : <span className="text-slate-300 text-[11px]">Not known</span>}
                    </td>
                    <td className="px-3 py-3.5">
                      {editingDoc === row.docName ? (
                        <input
                          type="date"
                          autoFocus
                          value={reviewInput}
                          onChange={e => setReviewInput(e.target.value)}
                          onBlur={() => handleSaveReviewDue(row.docName, reviewInput)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveReviewDue(row.docName, reviewInput); if (e.key === 'Escape') setEditingDoc(null); }}
                          className="text-[13px] border-b border-indigo-400 outline-none bg-transparent text-slate-700"
                        />
                      ) : (
                        <span
                          onClick={() => { setEditingDoc(row.docName); setReviewInput(row.reviewDue || ''); }}
                          className="text-[13px] text-slate-600 cursor-pointer hover:text-indigo-600 hover:underline decoration-dotted"
                          title="Click to set review due date"
                        >
                          {row.reviewDue ? fmt(row.reviewDue) : <span className="text-slate-300 text-[11px] italic">Set date…</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3.5">{statusBadge(s, row.reviewDue)}</td>
                    <td className="px-3 py-3.5 text-center text-[11px] font-bold text-slate-400">{row.actionCount}</td>
                    <td className="px-3 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {row.fileId && (() => {
                          const href = getFileHref({ id: row.fileId!, name: row.docName, type: 'file' }, row.folderPath || '', role ?? 'advisor');
                          const isOffice = href.startsWith('ms-');
                          return (
                            <a href={href} target={isOffice ? undefined : '_blank'} rel={isOffice ? undefined : 'noopener noreferrer'} className="text-slate-400 hover:text-indigo-500 transition-colors" title={isOffice ? 'Open in Word/Excel' : 'Open document'} onClick={e => e.stopPropagation()}>
                              <ExternalLink size={13} />
                            </a>
                          );
                        })()}
                        {onArchive && row.folderPath && (
                          <button onClick={() => { setArchiveWithClone(false); setConfirmingArchive(isConfirming ? null : row.docName); }} disabled={isArchiving} title="Archive this document" className={`transition-colors ${isArchiving ? 'text-amber-500 animate-pulse' : isConfirming ? 'text-amber-600' : 'text-slate-400 hover:text-amber-500'} disabled:opacity-40`}>
                            <Archive size={13} />
                          </button>
                        )}
                        {onClone && row.fileId && row.folderId && isDocx && (
                          <button onClick={() => doClone(row)} disabled={isCloning} title="Clone blank copy" className={`transition-colors ${isCloning ? 'text-indigo-500 animate-pulse' : 'text-slate-400 hover:text-indigo-500'} disabled:opacity-40`}>
                            <Copy size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isConfirming && (
                    <tr className="bg-amber-50">
                      <td colSpan={7} className="px-5 py-2.5">
                        <div className="flex items-center gap-3 text-[12px]">
                          <span className="flex-1 text-amber-800 font-medium">Move to Z-Archived Documents and remove all actions for this document?</span>
                          {onClone && row.fileId && row.folderId && isDocx && (
                            <label className="flex items-center gap-1.5 text-[11px] font-bold text-amber-800 cursor-pointer select-none">
                              <input type="checkbox" checked={archiveWithClone} onChange={e => setArchiveWithClone(e.target.checked)} className="accent-indigo-600" />
                              Clone existing
                            </label>
                          )}
                          <button onClick={() => doArchive(row, archiveWithClone)} title="Confirm archive — moves document in Datto and removes portal actions" className="px-3 py-1 bg-amber-500 text-white rounded-lg font-black text-[11px] hover:bg-amber-600">Confirm</button>
                          <button onClick={() => setConfirmingArchive(null)} title="Cancel" className="px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg font-black text-[11px] hover:bg-slate-50">Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {showBulkLog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: '80vh' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-black text-slate-800 text-sm uppercase tracking-widest flex items-center gap-2"><Archive size={14} />Archive Log</h3>
              <button onClick={() => setShowBulkLog(false)} title="Close log" className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
              {bulkLog.map((entry, idx) => (
                <div key={entry.docName} className={`px-5 py-3 flex items-center gap-3 ${entry.undone ? 'opacity-40' : ''}`}>
                  {entry.success
                    ? <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                    : <X size={14} className="text-rose-500 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-slate-700 truncate">{entry.docName.replace(/\.[^.]+$/, '')}</p>
                    {entry.success && !entry.undone && entry.archivedTargetPath && (
                      <p className="text-[11px] text-slate-400 break-all">
                        Archived → {entry.archiveWdrivePath ?? entry.archivedTargetPath}
                      </p>
                    )}
                    {entry.success && !entry.undone && entry.cloneName && (
                      <p className="text-[11px] text-indigo-500 break-all">
                        Clone → {entry.cloneWdrivePath ?? entry.cloneName.replace(/\.[^.]+$/, '')}
                      </p>
                    )}
                    {entry.success && !entry.undone && !entry.archivedTargetPath && !entry.cloneName && (
                      <p className="text-[11px] text-emerald-500">Done</p>
                    )}
                    {entry.error && <p className="text-[11px] text-rose-500 break-words">{entry.error}</p>}
                    {entry.undone && <p className="text-[11px] text-slate-400 italic">Restored to original location</p>}
                  </div>
                  {entry.success && !entry.undone && (entry.archivedFileId || entry.cloneFileId) && (
                    <button onClick={() => undoBulkEntry(entry, idx)} title="Restore document to its original location (doc unaffected in portal)" className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex-shrink-0">
                      <RotateCcw size={11} />Undo
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-slate-100 flex justify-end">
              <button onClick={() => setShowBulkLog(false)} className="px-5 py-2 bg-slate-800 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-slate-700">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SyncLogsTab = () => {
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('sync_log').select('*').order('started_at', { ascending: false }).limit(50)
      .then(({ data }) => { setSyncLogs(data ?? []); setLoading(false); });
  }, []);

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const dur = (s: number | null) => s == null ? '—' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black text-slate-800">Sync Run History</h3>
        <span className="text-[10px] text-slate-400 font-bold">Last 50 runs</span>
      </div>
      {loading ? (
        <div className="text-xs text-slate-400 font-bold animate-pulse">Loading…</div>
      ) : syncLogs.length === 0 ? (
        <div className="text-xs text-slate-400 font-bold">No sync runs recorded yet. The next cron run or manual sync will appear here.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2.5 font-black text-slate-500 text-[10px] uppercase tracking-wider">Started</th>
                <th className="text-left px-4 py-2.5 font-black text-slate-500 text-[10px] uppercase tracking-wider">Trigger</th>
                <th className="text-left px-4 py-2.5 font-black text-slate-500 text-[10px] uppercase tracking-wider">Sites</th>
                <th className="text-left px-4 py-2.5 font-black text-slate-500 text-[10px] uppercase tracking-wider">New Actions</th>
                <th className="text-left px-4 py-2.5 font-black text-slate-500 text-[10px] uppercase tracking-wider">Updated</th>
                <th className="text-left px-4 py-2.5 font-black text-slate-500 text-[10px] uppercase tracking-wider">Duration</th>
                <th className="text-left px-4 py-2.5 font-black text-slate-500 text-[10px] uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {syncLogs.map(log => {
                const hasErrors = Array.isArray(log.errors) && log.errors.length > 0;
                const inProgress = !log.completed_at;
                const expanded = expandedLog === log.id;
                return (
                  <React.Fragment key={log.id}>
                    <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpandedLog(expanded ? null : log.id)}>
                      <td className="px-4 py-3 text-slate-700 font-bold">{fmt(log.started_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${log.trigger === 'cron' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                          {log.trigger}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{log.sites_processed ?? 0} / {log.sites_attempted ?? 0}</td>
                      <td className="px-4 py-3 text-violet-700 font-bold">{log.new_suggestions ?? 0}</td>
                      <td className="px-4 py-3 text-slate-500">{log.updated ?? 0}</td>
                      <td className="px-4 py-3 text-slate-500">{dur(log.duration_seconds)}</td>
                      <td className="px-4 py-3">
                        {inProgress ? (
                          <span className="flex items-center gap-1 text-violet-600 font-bold text-[10px]"><RefreshCw size={10} className="animate-spin" />Running</span>
                        ) : hasErrors ? (
                          <span className="text-rose-600 font-black text-[10px] uppercase tracking-wider">Errors</span>
                        ) : (
                          <span className="text-emerald-600 font-black text-[10px] uppercase tracking-wider">Done</span>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={7} className="px-4 pb-4 bg-slate-50">
                          {Array.isArray(log.site_results) && log.site_results.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {(log.site_results as any[]).map((r: any, i: number) => (
                                <div key={i} className="flex items-center gap-3 text-[11px]">
                                  <span className={r.errors?.length ? 'text-rose-500' : 'text-emerald-500'}>{r.errors?.length ? '✗' : '✓'}</span>
                                  <span className="font-bold text-slate-700 w-48 truncate">{r.name}</span>
                                  <span className="text-slate-500">{r.processed} doc{r.processed !== 1 ? 's' : ''}</span>
                                  {r.newPending > 0 && <span className="text-violet-600 font-bold">+{r.newPending} new</span>}
                                  {r.updated > 0 && <span className="text-slate-400">{r.updated} updated</span>}
                                  {r.errors?.map((e: string, j: number) => <span key={j} className="text-rose-500 truncate max-w-xs">{e}</span>)}
                                </div>
                              ))}
                            </div>
                          )}
                          {hasErrors && (
                            <div className="mt-2 space-y-1">
                              {(log.errors as string[]).map((e: string, i: number) => (
                                <div key={i} className="text-[11px] text-rose-600 font-bold">{e}</div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Superadmin Panel ─────────────────────────────────────────────────────────
const SuperadminPanel = ({ onViewSite, onViewOrg, onSyncSite }: { onViewSite: (site: any, role: 'advisor' | 'client', tab?: 'actions' | 'documents' | 'dochealth' | 'iag' | 'files') => void; onViewOrg: (orgSites: any[], orgId: string, role: 'advisor' | 'client') => void; onSyncSite?: (site: any) => Promise<void> }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('organisations');
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [flashError, setFlashError] = useState('');
  const [flashSuccess, setFlashSuccess] = useState('');
  const [selectedOrgFilter, setSelectedOrgFilter] = useState('');

  // Create form visibility
  const [showOrgForm, setShowOrgForm] = useState(false);
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [showAssignForm, setShowAssignForm] = useState(false);

  // Edit state — which row is being edited
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [syncConfigSite, setSyncConfigSite] = useState<Site | null>(null);

  // Edit form values — org
  const [editOrgName, setEditOrgName] = useState('');
  const [editOrgFolderId, setEditOrgFolderId] = useState('');
  const [editOrgFolderName, setEditOrgFolderName] = useState('');
  const [editOrgLogoUrl, setEditOrgLogoUrl] = useState('');
  const [orgLogoUploading, setOrgLogoUploading] = useState(false);
  const [showEditOrgPicker, setShowEditOrgPicker] = useState(false);

  // Edit form values — site
  const [editSiteName, setEditSiteName] = useState('');
  const [editSiteType, setEditSiteType] = useState('');
  const [editSiteFolderId, setEditSiteFolderId] = useState('');
  const [editSiteFolderName, setEditSiteFolderName] = useState('');
  const [editSiteFolderPath, setEditSiteFolderPath] = useState('');
  const [showEditSitePicker, setShowEditSitePicker] = useState(false);
  const [editSiteAdvisorId, setEditSiteAdvisorId] = useState('');
  const [editSiteEmployeeCount, setEditSiteEmployeeCount] = useState<string>('');
  const [editSiteLogoUrl, setEditSiteLogoUrl] = useState('');
  const [editSiteLogoUploading, setEditSiteLogoUploading] = useState(false);
  const [siteServices, setSiteServices] = useState<any[]>([]);
  const [siteServicesLoading, setSiteServicesLoading] = useState(false);

  // Create form — org
  const [orgName, setOrgName] = useState('');
  const [orgAdvisorId, setOrgAdvisorId] = useState('');
  const [orgFolderId, setOrgFolderId] = useState('');
  const [orgFolderName, setOrgFolderName] = useState('');
  const [showOrgFolderPicker, setShowOrgFolderPicker] = useState(false);
  // Track current position in picker so Create uses it even if not explicitly selected
  const [orgPickerCurrentId, setOrgPickerCurrentId] = useState('');
  const [orgPickerCurrentName, setOrgPickerCurrentName] = useState('');

  // Create form — site
  const [siteName, setSiteName] = useState('');
  const [siteType, setSiteType] = useState('OFFICE');
  const [siteTypeOther, setSiteTypeOther] = useState('');
  const [editSiteTypeOther, setEditSiteTypeOther] = useState('');
  const [siteOrgId, setSiteOrgId] = useState('');
  const [siteAdvisorId, setSiteAdvisorId] = useState('');
  const [siteFolderId, setSiteFolderId] = useState('');
  const [siteFolderName, setSiteFolderName] = useState('');
  const [siteFolderPath, setSiteFolderPath] = useState('');
  const [showSiteFolderPicker, setShowSiteFolderPicker] = useState(false);
  const [sitePickerCurrentId, setSitePickerCurrentId] = useState('');
  const [sitePickerCurrentName, setSitePickerCurrentName] = useState('');

  // Create form — user
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [showUserPassword, setShowUserPassword] = useState(false);
  const [userFullName, setUserFullName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [userRole, setUserRole] = useState<'advisor' | 'client'>('advisor');
  const [userViewOnly, setUserViewOnly] = useState(false);
  const [userOrgId, setUserOrgId] = useState('');
  const [userSiteIds, setUserSiteIds] = useState<string[]>([]);

  // Assignment search state
  const [orgAdvisorSearch, setOrgAdvisorSearch] = useState('');
  const [orgClientSearch, setOrgClientSearch] = useState('');
  const [siteAdvisorSearch, setSiteAdvisorSearch] = useState('');
  const [siteClientSearch, setSiteClientSearch] = useState('');

  // Create form — advisor→org assignment (kept for handler compat)
  const [assignAdvisorId, setAssignAdvisorId] = useState('');
  const [assignOrgId, setAssignOrgId] = useState('');

  // Create form — advisor→site assignment
  const [showAdvisorSiteForm, setShowAdvisorSiteForm] = useState(false);
  const [assignAdvisorSiteAdvisorId, setAssignAdvisorSiteAdvisorId] = useState('');
  const [assignAdvisorSiteId, setAssignAdvisorSiteId] = useState('');

  // Create form — client→site assignment
  const [showClientSiteForm, setShowClientSiteForm] = useState(false);
  const [assignClientId, setAssignClientId] = useState('');
  const [assignClientSiteId, setAssignClientSiteId] = useState('');

  // User row expansion (client site management)
  const [expandingUserId, setExpandingUserId] = useState<string | null>(null);
  const [userActivityMap, setUserActivityMap] = useState<Record<string, any[]>>({});
  const [userActivityLoading, setUserActivityLoading] = useState<Record<string, boolean>>({});
  const [adminSetPwUser, setAdminSetPwUser] = useState<{ id: string; email: string } | null>(null);
  const [adminSetPwValue, setAdminSetPwValue] = useState('');
  const [adminSetPwLoading, setAdminSetPwLoading] = useState(false);
  const [adminWelcomeUser, setAdminWelcomeUser] = useState<{ id: string; email: string; name: string | null } | null>(null);
  const [adminWelcomePw, setAdminWelcomePw] = useState('');
  const [adminWelcomeAdvisor, setAdminWelcomeAdvisor] = useState('Paul Johnson');
  const [adminWelcomeLoading, setAdminWelcomeLoading] = useState(false);
  const [showAdminWelcomePw, setShowAdminWelcomePw] = useState(false);
  const [adminWelcomeCc, setAdminWelcomeCc] = useState<string[]>([]);
  const [adminWelcomeCcCustom, setAdminWelcomeCcCustom] = useState('');
  const [showAdminSetPw, setShowAdminSetPw] = useState(false);
  const [adminRenameUser, setAdminRenameUser] = useState<{ id: string; email: string; currentName: string; currentPhone: string } | null>(null);
  const [adminRenameValue, setAdminRenameValue] = useState('');
  const [adminRenamePhoneValue, setAdminRenamePhoneValue] = useState('');
  const [userSiteSearch, setUserSiteSearch] = useState('');
  const [userFilterOrg, setUserFilterOrg] = useState('');
  const [userFilterSite, setUserFilterSite] = useState('');

  // Assignment data
  const [clientSiteAssignments, setClientSiteAssignments] = useState<any[]>([]);
  const [advisorSiteAssignments, setAdvisorSiteAssignments] = useState<any[]>([]);

  // Background sync
  const [bgSyncRunning, setBgSyncRunning] = useState(false);
  const [bgSyncStatus, setBgSyncStatus] = useState('');
  const [bgSyncStats, setBgSyncStats] = useState<{ processed: number; newPending: number; updated: number } | null>(null);
  const [quickSyncModalSites, setQuickSyncModalSites] = useState<{ id: string; name: string }[] | null>(null);
  const [syncModalMinimised, setSyncModalMinimised] = useState(false);

  // Requirements tab state
  const [reqSiteType, setReqSiteType] = useState('OFFICE');
  const [requirements, setRequirements] = useState<any[]>([]);
  const [reqLoading, setReqLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatePreview, setGeneratePreview] = useState<any[] | null>(null);
  const [editingReqId, setEditingReqId] = useState<string | null>(null);
  const [editReqName, setEditReqName] = useState('');
  const [editReqDesc, setEditReqDesc] = useState('');
  const [editReqMandatory, setEditReqMandatory] = useState(false);
  const [editReqLegal, setEditReqLegal] = useState('');
  const [showAddReqForm, setShowAddReqForm] = useState(false);
  const [newReqName, setNewReqName] = useState('');
  const [newReqDesc, setNewReqDesc] = useState('');
  const [newReqMandatory, setNewReqMandatory] = useState(false);
  const [newReqLegal, setNewReqLegal] = useState('');

  // Usage & Costs state
  const [usageData, setUsageData] = useState<any>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageDays, setUsageDays] = useState(30);

  // Data Health state
  const [dhResults, setDhResults] = useState<any[] | null>(null);
  const [dhLoading, setDhLoading] = useState(false);
  const [dhRepairing, setDhRepairing] = useState<string | null>(null);
  const [dhMessage, setDhMessage] = useState<string | null>(null);
  const [dhSyncingIds, setDhSyncingIds] = useState<Set<string>>(new Set());
  const [dhSyncedIds, setDhSyncedIds] = useState<Set<string>>(new Set());

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { if (activeTab === 'requirements') loadRequirements(reqSiteType); }, [activeTab, reqSiteType]);
  useEffect(() => { if (activeTab === 'usage') loadUsage(); }, [activeTab, usageDays]);

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([loadOrgs(), loadSites(), loadUsers(), loadAssignments(), loadClientSiteAssignments(), loadAdvisorSiteAssignments()]);
    setLoading(false);
  };

  const loadOrgs = async () => { const { data } = await supabase.from('organisations').select('*').order('name'); if (data) setOrganisations(data); };
  const loadSites = async () => { const { data } = await supabase.from('sites').select('*, organisations(name)').order('name'); if (data) setSites(data); };
  const loadClientSiteAssignments = async () => { const { data } = await supabase.from('client_site_assignments').select('*, sites(name)').order('created_at'); if (data) setClientSiteAssignments(data); };
  const loadAdvisorSiteAssignments = async () => { const { data } = await supabase.from('advisor_site_assignments').select('*, sites(name)').order('created_at'); if (data) setAdvisorSiteAssignments(data); };

  const loadUsage = async () => {
    setUsageLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) { setUsageLoading(false); return; }
    const res = await fetch(`/api/admin/usage?userId=${userId}&days=${usageDays}`);
    if (res.ok) setUsageData(await res.json());
    setUsageLoading(false);
  };

  const loadUserActivity = async (targetUserId: string) => {
    setUserActivityLoading(prev => ({ ...prev, [targetUserId]: true }));
    const { data: { session } } = await supabase.auth.getSession();
    const callerId = session?.user?.id;
    if (!callerId) { setUserActivityLoading(prev => ({ ...prev, [targetUserId]: false })); return; }
    const res = await fetch(`/api/activity?userId=${targetUserId}&callerId=${callerId}`);
    const data = await res.json().catch(() => ({}));
    setUserActivityMap(prev => ({ ...prev, [targetUserId]: data.events ?? [] }));
    setUserActivityLoading(prev => ({ ...prev, [targetUserId]: false }));
  };

  const loadDataHealth = async () => {
    setDhLoading(true);
    setDhMessage(null);
    setDhSyncedIds(new Set());
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) { setDhLoading(false); return; }
    const res = await fetch(`/api/admin/data-health?userId=${userId}`);
    if (res.ok) { const d = await res.json(); setDhResults(d.checks); }
    setDhLoading(false);
  };

  const runRepair = async (repairId: string) => {
    setDhRepairing(repairId);
    setDhMessage(null);
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) { setDhRepairing(null); return; }
    const res = await fetch(`/api/admin/data-health?userId=${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repair: repairId }),
    });
    const d = await res.json().catch(() => ({}));
    setDhMessage(res.ok ? (d.detail ?? 'Done') : (d.error ?? 'Repair failed'));
    setDhRepairing(null);
    await loadDataHealth();
  };

  const handleQuickSyncSite = (site: any) => {
    if (!site.datto_folder_id) return;
    setQuickSyncModalSites([{ id: site.id, name: site.name }]);
  };

  const handleQuickSyncOrg = (orgId: string) => {
    const orgSitesList = sites.filter(s => s.organisation_id === orgId && s.datto_folder_id);
    if (!orgSitesList.length) return;
    setQuickSyncModalSites(orgSitesList.map(s => ({ id: s.id, name: s.name })));
  };

  const syncSiteFromDH = async (siteId: string) => {
    setDhSyncingIds(prev => new Set([...prev, siteId]));
    setDhMessage(null);
    await onSyncSite?.(sites.find(s => s.id === siteId));
    // Stamp any remaining version-0 actions for this site — catches docs that errored
    // or weren't matched during the sync loop but were still processed by the sync run.
    await supabase.from('actions')
      .update({ extraction_version: CURRENT_EXTRACTION_VERSION })
      .eq('site_id', siteId)
      .eq('extraction_version', 0);
    setDhSyncingIds(prev => { const n = new Set(prev); n.delete(siteId); return n; });
    setDhSyncedIds(prev => new Set([...prev, siteId]));
    await loadDataHealth();
  };

  const loadRequirements = async (siteType: string) => {
    setReqLoading(true);
    const res = await fetch(`/api/requirements?siteType=${siteType}`);
    if (res.ok) setRequirements(await res.json());
    setReqLoading(false);
  };

  const handleGenerateRequirements = async () => {
    setGenerating(true); setGeneratePreview(null);
    const res = await fetch('/api/requirements/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteType: reqSiteType }) });
    if (res.ok) { const { requirements: gen } = await res.json(); setGeneratePreview(gen.map((r: any) => ({ ...r, selected: true }))); }
    else { const data = await res.json().catch(() => ({})); flash(`AI generation failed: ${data.error || res.statusText}`, true); }
    setGenerating(false);
  };

  const handleConfirmGenerate = async () => {
    if (!generatePreview) return;
    const selected = generatePreview.filter((r: any) => r.selected);
    if (selected.length === 0) { flash('Select at least one requirement', true); return; }
    // Delete existing for this type then insert selected only
    const existing = requirements.map(r => r.id);
    await Promise.all(existing.map(id => fetch(`/api/requirements?id=${id}`, { method: 'DELETE' })));
    await Promise.all(selected.map((r: any, i: number) => fetch('/api/requirements', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_type: reqSiteType, requirement_name: r.requirement_name, description: r.description, is_mandatory: r.is_mandatory, legal_basis: r.legal_basis, ai_generated: true, display_order: i }),
    })));
    setGeneratePreview(null);
    flash('Requirements updated and applied to all matching sites!');
    loadRequirements(reqSiteType);
  };

  const handleAddRequirement = async () => {
    if (!newReqName.trim()) { flash('Name required', true); return; }
    await fetch('/api/requirements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_type: reqSiteType, requirement_name: newReqName.trim(), description: newReqDesc.trim() || null, is_mandatory: newReqMandatory, legal_basis: newReqLegal.trim() || null, ai_generated: false, display_order: requirements.length }) });
    setNewReqName(''); setNewReqDesc(''); setNewReqMandatory(false); setNewReqLegal(''); setShowAddReqForm(false);
    flash('Requirement added');
    loadRequirements(reqSiteType);
  };

  const handleUpdateRequirement = async (id: string) => {
    await fetch('/api/requirements', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, requirement_name: editReqName, description: editReqDesc || null, is_mandatory: editReqMandatory, legal_basis: editReqLegal || null }) });
    setEditingReqId(null);
    flash('Requirement updated');
    loadRequirements(reqSiteType);
  };

  const handleDeleteRequirement = async (id: string) => {
    if (!confirm('Remove this requirement? It will be removed from all sites of this type.')) return;
    await fetch(`/api/requirements?id=${id}`, { method: 'DELETE' });
    flash('Requirement removed');
    loadRequirements(reqSiteType);
  };
  const loadUsers = async () => { const res = await fetch('/api/admin/users'); if (res.ok) setUsers(await res.json()); };
  const loadAssignments = async () => { const { data } = await supabase.from('advisor_organisations').select('*, organisations(name)').order('created_at'); if (data) setAssignments(data); };

  const flash = (msg: string, isError = false) => {
    if (isError) { setFlashError(msg); setTimeout(() => setFlashError(''), 4000); }
    else { setFlashSuccess(msg); setTimeout(() => setFlashSuccess(''), 3000); }
  };

  // ── Create handlers ──
  const handleCreateOrg = async () => {
    if (!orgName.trim()) { flash('Name is required', true); return; }
    const finalId = orgFolderId || (showOrgFolderPicker ? orgPickerCurrentId : '');
    const { data: newOrg, error } = await supabase.from('organisations').insert({ name: orgName.trim(), datto_folder_id: finalId || null, datto_folder_name: orgFolderName || null }).select().single();
    if (error) { flash(error.message, true); return; }
    if (orgAdvisorId && newOrg) {
      await supabase.from('advisor_organisations').insert({ advisor_id: orgAdvisorId, organisation_id: newOrg.id });
    }
    flash('Organisation created!');
    setOrgName(''); setOrgAdvisorId(''); setOrgFolderId(''); setOrgFolderName(''); setShowOrgFolderPicker(false); setShowOrgForm(false);
    loadOrgs(); loadAssignments();
  };

  const handleCreateSite = async () => {
    if (!siteName.trim()) { flash('Name is required', true); return; }
    if (!siteOrgId) { flash('Organisation is required', true); return; }
    const finalId = siteFolderId || (showSiteFolderPicker ? sitePickerCurrentId : '');
    if (!finalId) { flash('Datto folder is required — select the site\'s H&S document folder before saving.', true); return; }
    const typeValue = siteType === 'OTHER' ? (siteTypeOther.trim() || 'OTHER') : siteType;
    const { data: newSite, error } = await supabase.from('sites').insert({ name: siteName.trim(), type: typeValue, organisation_id: siteOrgId, datto_folder_id: finalId || null, datto_folder_path: siteFolderPath || null, advisor_id: siteAdvisorId || null, compliance_score: 0, trend: 0 }).select('id').single();
    if (error) { flash(error.message, true); return; }
    if (siteFolderPath) fetch('/api/datto/setup-site-folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderPath: siteFolderPath, siteId: newSite?.id }) });
    flash('Site created!');
    setSiteName(''); setSiteType('OFFICE'); setSiteTypeOther(''); setSiteOrgId(''); setSiteAdvisorId(''); setSiteFolderId(''); setSiteFolderName(''); setSiteFolderPath(''); setShowSiteFolderPicker(false); setShowSiteForm(false);
    loadSites();
  };

  const handleCreateUser = async () => {
    if (!userEmail.trim()) { flash('Email is required', true); return; }
    if (!userPassword.trim()) { flash('Password is required', true); return; }
    if (userRole === 'client' && !userOrgId) { flash('Organisation is required for client users', true); return; }
    const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userEmail.trim(), password: userPassword, role: userRole, organisation_id: userOrgId || null, site_ids: userSiteIds, full_name: userFullName.trim() || null, phone: userPhone.trim() || null, view_only: userRole === 'client' ? userViewOnly : undefined }) });
    const data = await res.json();
    if (!res.ok) { flash(apiErr(data, 'Create user failed'), true); return; }
    flash('User created!'); setUserEmail(''); setUserPassword(''); setUserFullName(''); setUserPhone(''); setUserRole('advisor'); setUserViewOnly(false); setUserOrgId(''); setUserSiteIds([]); setShowUserPassword(false); setShowUserForm(false); loadUsers(); loadClientSiteAssignments();
  };

  const handleCreateAssignment = async () => {
    if (!assignAdvisorId) { flash('Advisor is required', true); return; }
    if (!assignOrgId) { flash('Organisation is required', true); return; }
    const { error } = await supabase.from('advisor_organisations').insert({ advisor_id: assignAdvisorId, organisation_id: assignOrgId });
    if (error) { flash(error.message, true); return; }
    flash('Assignment created!'); setAssignAdvisorId(''); setAssignOrgId(''); setShowAssignForm(false); loadAssignments();
  };

  const handleAddOrgClient = async (orgId: string, userId: string) => {
    const res = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, organisation_id: orgId }) });
    if (!res.ok) { const d = await res.json(); flash(apiErr(d, 'Failed to assign user'), true); return; }
    flash('Client assigned to organisation'); setOrgClientSearch(''); loadUsers();
  };

  const handleRemoveOrgClient = async (userId: string) => {
    const res = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, organisation_id: null }) });
    if (!res.ok) { const d = await res.json(); flash(apiErr(d, 'Failed to remove user'), true); return; }
    flash('Client removed from organisation'); loadUsers();
  };

  const handleSetViewOnly = async (userId: string, viewOnly: boolean) => {
    await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, view_only: viewOnly }) });
    loadUsers();
  };
  const handleSetReceiveEmails = async (userId: string, receiveEmails: boolean) => {
    await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, receive_emails: receiveEmails }) });
    loadUsers();
  };

  const handleAddOrgAdvisor = async (orgId: string, advisorId: string) => {
    const { error } = await supabase.from('advisor_organisations').insert({ advisor_id: advisorId, organisation_id: orgId });
    if (error) { flash(error.message, true); return; }
    setOrgAdvisorSearch(''); loadAssignments();
  };

  const handleAddSiteAdvisor = async (siteId: string, advisorId: string) => {
    const { error } = await supabase.from('advisor_site_assignments').insert({ advisor_id: advisorId, site_id: siteId });
    if (error) { flash(error.message, true); return; }
    setSiteAdvisorSearch(''); loadAdvisorSiteAssignments();
  };

  const handleAddSiteClient = async (siteId: string, clientId: string) => {
    const { error } = await supabase.from('client_site_assignments').insert({ client_user_id: clientId, site_id: siteId });
    if (error) { flash(error.message, true); return; }
    setSiteClientSearch(''); loadClientSiteAssignments();
  };

  const handleCreateAdvisorSiteAssignment = async () => {
    if (!assignAdvisorSiteAdvisorId || !assignAdvisorSiteId) { flash('Advisor and site are required', true); return; }
    const { error } = await supabase.from('advisor_site_assignments').insert({ advisor_id: assignAdvisorSiteAdvisorId, site_id: assignAdvisorSiteId });
    if (error) { flash(error.message, true); return; }
    flash('Assignment created!'); setAssignAdvisorSiteAdvisorId(''); setAssignAdvisorSiteId(''); setShowAdvisorSiteForm(false); loadAdvisorSiteAssignments();
  };

  const handleCreateClientSiteAssignment = async () => {
    if (!assignClientId || !assignClientSiteId) { flash('Client and site are required', true); return; }
    const { error } = await supabase.from('client_site_assignments').insert({ client_user_id: assignClientId, site_id: assignClientSiteId });
    if (error) { flash(error.message, true); return; }
    flash('Assignment created!'); setAssignClientId(''); setAssignClientSiteId(''); setShowClientSiteForm(false); loadClientSiteAssignments();
  };

  const handleDeleteAdvisorSiteAssignment = async (id: string) => {
    await supabase.from('advisor_site_assignments').delete().eq('id', id);
    flash('Assignment removed'); loadAdvisorSiteAssignments();
  };

  const handleDeleteClientSiteAssignment = async (id: string) => {
    await supabase.from('client_site_assignments').delete().eq('id', id);
    flash('Assignment removed'); loadClientSiteAssignments();
  };

  // ── Edit handlers ──
  const startEditOrg = (org: Organisation) => {
    setEditingOrgId(org.id); setEditOrgName(org.name);
    setEditOrgFolderId(org.datto_folder_id || '');
    setEditOrgFolderName(org.datto_folder_name || '');
    setEditOrgLogoUrl(org.logo_url || '');
    setShowEditOrgPicker(false);
  };

  const handleUpdateOrg = async (id: string) => {
    if (!editOrgName.trim()) { flash('Name is required', true); return; }
    const finalId = editOrgFolderId || (showEditOrgPicker ? editOrgFolderId : '');
    const { error } = await supabase.from('organisations').update({ name: editOrgName.trim(), datto_folder_id: finalId || null, datto_folder_name: editOrgFolderName || null, logo_url: editOrgLogoUrl || null }).eq('id', id);
    if (error) { flash(error.message, true); return; }
    flash('Organisation updated!'); setEditingOrgId(null); setShowEditOrgPicker(false); loadOrgs();
  };

  const startEditSite = async (site: any) => {
    setEditingSiteId(site.id); setEditSiteName(site.name);
    const knownType = SITE_TYPES.includes(site.type);
    setEditSiteType(knownType ? site.type : 'OTHER');
    setEditSiteTypeOther(knownType ? '' : site.type);
    setEditSiteFolderId(site.datto_folder_id || ''); setEditSiteFolderPath(site.datto_folder_path || '');
    const siteFolderDisplayName = site.datto_folder_path ? site.datto_folder_path.split('/').filter(Boolean).pop() || site.datto_folder_path : (site.datto_folder_id ? `ID: ${site.datto_folder_id}` : '');
    setEditSiteFolderName(siteFolderDisplayName);
    const orgAdvisorId = assignments.find((a: any) => a.organisation_id === site.organisation_id)?.advisor_id || '';
    setEditSiteAdvisorId(site.advisor_id || orgAdvisorId);
    setEditSiteEmployeeCount(site.employee_count != null ? String(site.employee_count) : '');
    setEditSiteLogoUrl(site.logo_url || '');
    setShowEditSitePicker(false);
    // Load services purchased for this site
    setSiteServicesLoading(true);
    const res = await fetch(`/api/sites/${site.id}/services`);
    if (res.ok) setSiteServices(await res.json());
    else setSiteServices([]);
    setSiteServicesLoading(false);
  };

  const handleUpdateSite = async (id: string) => {
    if (!editSiteName.trim()) { flash('Name is required', true); return; }
    const finalId = editSiteFolderId || (showEditSitePicker ? editSiteFolderId : '');
    if (!finalId) { flash('Datto folder is required — select the site\'s H&S document folder before saving.', true); return; }
    const editTypeValue = editSiteType === 'OTHER' ? (editSiteTypeOther.trim() || 'OTHER') : editSiteType;
    const empCount = editSiteEmployeeCount !== '' ? parseInt(editSiteEmployeeCount, 10) : null;
    const { error } = await supabase.from('sites').update({ name: editSiteName.trim(), type: editTypeValue, datto_folder_id: finalId || null, datto_folder_path: editSiteFolderPath || null, advisor_id: editSiteAdvisorId || null, employee_count: empCount, logo_url: editSiteLogoUrl || null }).eq('id', id);
    if (error) { flash(error.message, true); return; }
    if (editSiteFolderPath) fetch('/api/datto/setup-site-folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderPath: editSiteFolderPath, siteId: id }) });
    flash('Site updated!'); setEditingSiteId(null); setShowEditSitePicker(false); setSiteServices([]); loadSites();
  };

  // ── Delete handlers ──
  const handleDeleteOrg = async (id: string) => { if (!confirm('Delete this organisation? All its sites and actions will also be deleted.')) return; await supabase.from('organisations').delete().eq('id', id); flash('Organisation deleted'); loadOrgs(); loadSites(); };
  const handleDeleteSite = async (id: string) => { if (!confirm('Delete this site? All its actions will also be deleted.')) return; await supabase.from('sites').delete().eq('id', id); flash('Site deleted'); loadSites(); };
  const handleClearSiteActions = async (id: string, name: string) => {
    if (!confirm(`Clear ALL actions and evidence for "${name}"?\n\nThe site, its documents, and settings will be kept. This cannot be undone.`)) return;
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) { flash('Not authenticated', true); return; }
    const res = await fetch(`/api/admin/sites/${id}/actions?userId=${userId}`, { method: 'DELETE' });
    const json = await res.json();
    if (!res.ok) { flash(json.error ?? 'Failed to clear actions', true); return; }
    flash(`Cleared ${json.deleted.actions} action${json.deleted.actions !== 1 ? 's' : ''} and ${json.deleted.evidence} evidence record${json.deleted.evidence !== 1 ? 's' : ''}`);
  };
  const handleDeleteUser = async (id: string) => {
    const [{ count: siteCount }, { count: uploadCount }, { count: advisorSiteCount }, { count: advisorOrgCount }] = await Promise.all([
      supabase.from('client_site_assignments').select('id', { count: 'exact', head: true }).eq('client_user_id', id),
      supabase.from('client_uploads').select('id', { count: 'exact', head: true }).eq('uploaded_by', id),
      supabase.from('advisor_site_assignments').select('id', { count: 'exact', head: true }).eq('advisor_id', id),
      supabase.from('advisor_organisations').select('id', { count: 'exact', head: true }).eq('advisor_id', id),
    ]);
    const warnings: string[] = [];
    if ((siteCount ?? 0) > 0) warnings.push(`${siteCount} site assignment${siteCount !== 1 ? 's' : ''}`);
    if ((uploadCount ?? 0) > 0) warnings.push(`${uploadCount} uploaded file${uploadCount !== 1 ? 's' : ''}`);
    if ((advisorSiteCount ?? 0) > 0) warnings.push(`${advisorSiteCount} advisor site assignment${advisorSiteCount !== 1 ? 's' : ''}`);
    if ((advisorOrgCount ?? 0) > 0) warnings.push(`${advisorOrgCount} organisation assignment${advisorOrgCount !== 1 ? 's' : ''}`);
    const msg = warnings.length > 0
      ? `This user has ${warnings.join(', ')}. All associated data will be permanently deleted.\n\nAre you sure?`
      : 'Delete this user? This cannot be undone.';
    if (!confirm(msg)) return;
    const res = await fetch('/api/admin/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); flash(apiErr(d, 'Delete failed'), true); return; }
    flash('User deleted'); loadUsers();
  };
  const handleDeleteAssignment = async (id: string) => { if (!confirm('Remove this assignment?')) return; await supabase.from('advisor_organisations').delete().eq('id', id); flash('Assignment removed'); loadAssignments(); };

  const advisors = users.filter(u => u.profile?.role === 'advisor');
  const filteredSites = selectedOrgFilter ? sites.filter(s => s.organisation_id === selectedOrgFilter) : sites;
  const selectedOrgForSitePicker = organisations.find(o => o.id === siteOrgId);

  const inputClass = 'w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white';
  const labelClass = 'text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block';

  const tabs: { key: AdminTab; label: string; icon: React.ReactNode }[] = [
    { key: 'organisations', label: 'Organisations', icon: <Building2 size={14} /> },
    { key: 'sites', label: 'Sites', icon: <Factory size={14} /> },
    { key: 'users', label: 'Users', icon: <User size={14} /> },
    { key: 'requirements', label: 'Industry Standards', icon: <Shield size={14} /> },
    { key: 'usage', label: 'Usage & Costs', icon: <BarChart3 size={14} /> },
    { key: 'data-health', label: 'Data Health', icon: <Database size={14} /> },
    { key: 'sync-logs', label: 'Sync Logs', icon: <RefreshCw size={14} /> },
  ];

  // Reusable folder picker field

  const filteredUsers = users.filter(user => {
    const role = user.profile?.role;
    if (userFilterOrg) {
      if (role === 'superadmin') return false;
      if (role === 'client' && user.profile?.organisation_id !== userFilterOrg) return false;
      if (role === 'advisor' && !assignments.some((a: any) => a.advisor_id === user.id && a.organisation_id === userFilterOrg)) return false;
    }
    if (userFilterSite) {
      const site = sites.find((s: any) => s.id === userFilterSite);
      if (!site) return false;
      if (role === 'superadmin') return false;
      if (role === 'client') {
        const hasSpecific = clientSiteAssignments.some((a: any) => a.client_user_id === user.id);
        if (hasSpecific) {
          if (!clientSiteAssignments.some((a: any) => a.client_user_id === user.id && a.site_id === userFilterSite)) return false;
        } else {
          if (user.profile?.organisation_id !== site.organisation_id) return false;
        }
      }
      if (role === 'advisor' && !assignments.some((a: any) => a.advisor_id === user.id && a.organisation_id === site.organisation_id)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 rounded-xl p-6 md:p-10 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500 rounded-full -mr-32 -mt-32 blur-[100px] opacity-20 pointer-events-none" />
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-300">System Administration</span>
              <h2 className="text-2xl md:text-4xl font-black tracking-tighter mt-2">Superadmin Panel</h2>
              <p className="text-indigo-300 mt-2 text-sm">Manage organisations, sites, users and advisor assignments.</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={async () => {
                  setBgSyncRunning(true);
                  setBgSyncStats(null);
                  setBgSyncStatus('Starting…');
                  try {
                    const res = await fetch('/api/sync/stream', {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SYNC_SECRET}`, 'Content-Type': 'application/json' },
                    });
                    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
                    const reader = res.body.getReader();
                    const dec = new TextDecoder();
                    let buf = '';
                    let totalProcessed = 0; let totalNewPending = 0; let totalUpdated = 0;
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;
                      buf += dec.decode(value, { stream: true });
                      const lines = buf.split('\n'); buf = lines.pop() ?? '';
                      for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                          const e = JSON.parse(line) as any;
                          if (e.type === 'scan') setBgSyncStatus(`Scanning ${e.siteName}…`);
                          else if (e.type === 'docs_found') setBgSyncStatus(`${e.siteName}: ${e.count} doc${e.count !== 1 ? 's' : ''} to process`);
                          else if (e.type === 'doc_start') setBgSyncStatus(`${e.siteName}: ${e.docName} (${e.index + 1}/${e.total})`);
                          else if (e.type === 'doc_done') {
                            totalNewPending += e.newPending ?? 0; totalUpdated += e.updated ?? 0;
                            setBgSyncStats({ processed: e.index + 1, newPending: totalNewPending, updated: totalUpdated });
                            setBgSyncStatus(`${e.siteName}: ${e.docName} ✓`);
                          } else if (e.type === 'site_done' && e.siteName === '__all__') {
                            totalProcessed = e.processed ?? totalProcessed;
                            setBgSyncStatus(`Sync complete`);
                            setBgSyncStats({ processed: totalProcessed, newPending: e.newPending ?? totalNewPending, updated: e.updated ?? totalUpdated });
                          }
                        } catch { /* malformed line */ }
                      }
                    }
                  } catch (err: any) {
                    setBgSyncStatus(`Error: ${err.message}`);
                  } finally {
                    setBgSyncRunning(false);
                  }
                }}
                disabled={bgSyncRunning}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white rounded-xl text-[11px] font-black uppercase tracking-wider border border-white/20 transition-all"
              >
                <RefreshCw size={13} className={bgSyncRunning ? 'animate-spin' : ''} />
                {bgSyncRunning ? 'Syncing…' : 'Run Background Sync'}
              </button>
              {!bgSyncRunning && !bgSyncStatus && <p className="text-[10px] text-indigo-300 max-w-[220px] text-right leading-tight">Incremental only — new &amp; modified docs. Use <RefreshCw size={9} className="inline" /> per site for a full re-sync.</p>}
              {bgSyncStatus && <p className="text-[11px] text-indigo-200 max-w-[260px] text-right leading-tight">{bgSyncStatus}</p>}
              {bgSyncStats && <p className="text-[10px] text-indigo-300 max-w-[260px] text-right leading-tight">{bgSyncStats.processed} doc{bgSyncStats.processed !== 1 ? 's' : ''} · {bgSyncStats.newPending} new pending · {bgSyncStats.updated} updated</p>}
            </div>
          </div>
        </div>
      </div>

      {flashError && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold px-4 py-3 rounded-xl">{flashError}</div>}
      {flashSuccess && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-bold px-4 py-3 rounded-xl">✓ {flashSuccess}</div>}

      <div className="flex border-b border-slate-200 gap-4 overflow-x-auto">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key); setEditingOrgId(null); setEditingSiteId(null); setExpandingUserId(null); setShowEditOrgPicker(false); setShowEditSitePicker(false); setOrgAdvisorSearch(''); setOrgClientSearch(''); setSiteAdvisorSearch(''); setSiteClientSearch(''); setUserSiteSearch(''); }}
            className={`pb-4 px-1 text-[11px] font-black uppercase tracking-widest flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${activeTab === tab.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ── ORGANISATIONS TAB ── */}
      {activeTab === 'organisations' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">{organisations.length} Organisation{organisations.length !== 1 ? 's' : ''}</h3>
            <button onClick={() => setShowOrgForm(v => !v)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700" title="Add a new organisation"><Plus size={13} />Add Organisation</button>
          </div>

          {showOrgForm && (
            <div className="bg-white border border-indigo-200 rounded-lg p-6 space-y-4">
              <h4 className="font-black text-slate-900 text-sm uppercase tracking-widest">New Organisation</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className={labelClass}>Organisation Name *</label><input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="e.g. Precision Engineering Ltd" className={inputClass} /></div>
                <div><label className={labelClass}>Assigned Advisor</label>
                  <select value={orgAdvisorId} onChange={e => setOrgAdvisorId(e.target.value)} className={inputClass}>
                    <option value="">No advisor</option>
                    {advisors.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
                  </select>
                </div>
              </div>
              <FolderPickerField
                folderId={orgFolderId} folderName={orgFolderName} showPicker={showOrgFolderPicker}
                onOpenPicker={(v: boolean) => setShowOrgFolderPicker(v)}
                onSelectFolder={(name: string, id: string, _path: string) => { setOrgFolderName(name); setOrgFolderId(id); setShowOrgFolderPicker(false); }}
                onNavigate={(name: string, id: string) => { setOrgPickerCurrentName(name); setOrgPickerCurrentId(id); }}
                orgForPicker={null} labelText="Datto Root Folder" labelHint="browse to select the client folder in Datto"
              />
              <div className="flex gap-3">
                <button onClick={handleCreateOrg} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700" title="Create this organisation in the portal">Create Organisation</button>
                <button onClick={() => { setShowOrgForm(false); setShowOrgFolderPicker(false); }} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider" title="Cancel without saving">Cancel</button>
              </div>
            </div>
          )}

          {loading ? <div className="py-12 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div>
            : organisations.length === 0 ? (
              <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
                <Building2 size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="font-black text-slate-700">No organisations yet</p>
                <p className="text-sm text-slate-400 mt-1">Add your first client organisation above.</p>
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                  <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-6 py-3">Logo</th><th className="px-6 py-3">Name</th><th className="px-6 py-3">Advisor</th><th className="px-6 py-3">Datto Folder</th><th className="px-6 py-3">Sites</th><th className="px-6 py-3"></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {organisations.map(org => (
                      <React.Fragment key={org.id}>
                        <tr className={`cursor-pointer select-none ${editingOrgId === org.id ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`} onClick={() => editingOrgId === org.id ? (setEditingOrgId(null), setShowEditOrgPicker(false), setOrgAdvisorSearch(''), setOrgClientSearch(''), setExpandingUserId(null)) : (startEditOrg(org), setExpandingUserId(null))}>
                          <td className="px-6 py-4">
                            {org.logo_url
                              ? <div className="bg-white border border-slate-100 rounded-lg p-1 w-16 h-8 flex items-center justify-center"><img src={org.logo_url} alt="" className="max-h-6 max-w-full object-contain" /></div>
                              : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          <td className="px-6 py-4 font-bold text-slate-800">
                            <button onClick={e => { e.stopPropagation(); setSelectedOrgFilter(org.id); setActiveTab('sites'); setEditingOrgId(null); setEditingSiteId(null); setShowEditOrgPicker(false); }} className="hover:text-indigo-600 hover:underline text-left" title="View this organisation's sites">{org.name}</button>
                            {(() => { const orgSites = sites.filter(s => s.organisation_id === org.id); if (orgSites.length === 0) return null; return (
                              <div className="flex gap-2 mt-0.5">
                                <button onClick={e => { e.stopPropagation(); onViewOrg(orgSites, org.id, 'advisor'); }} className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 hover:underline" title="Switch to advisor view for this organisation">View as advisor</button>
                                <span className="text-slate-300 text-[10px]">|</span>
                                <button onClick={e => { e.stopPropagation(); onViewOrg(orgSites, org.id, 'client'); }} className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 hover:underline" title="Switch to client view for this organisation">View as client</button>
                              </div>
                            ); })()}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-600">{(() => { const a = assignments.find((a: any) => a.organisation_id === org.id); return a ? (advisors.find(adv => adv.id === a.advisor_id)?.email || '—') : <span className="text-slate-300">Unassigned</span>; })()}</td>
                          <td className="px-6 py-4 text-xs">{org.datto_folder_id ? (
                            <span className="flex flex-col gap-0.5">
                              {org.datto_folder_name && <span className="font-bold text-slate-700 flex items-center gap-1"><Folder size={11} className="text-amber-400 shrink-0" />{org.datto_folder_name}</span>}
                              <span className="font-mono text-amber-600">{org.datto_folder_id}</span>
                            </span>
                          ) : <span className="text-slate-300">Not set</span>}</td>
                          <td className="px-6 py-4 text-sm font-bold text-slate-600">{sites.filter(s => s.organisation_id === org.id).length}</td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {sites.some(s => s.organisation_id === org.id && s.datto_folder_id) && (
                                <button
                                  onClick={e => { e.stopPropagation(); handleQuickSyncOrg(org.id); }}
                                  disabled={!!quickSyncModalSites}
                                  className="text-violet-400 hover:text-violet-600 p-1.5 rounded-lg hover:bg-violet-50 disabled:opacity-40"
                                  title="Run AI sync for all sites in this org"
                                ><RefreshCw size={14} /></button>
                              )}
                              <button onClick={e => { e.stopPropagation(); handleDeleteOrg(org.id); }} className="text-rose-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50" title="Permanently delete this organisation from the portal"><X size={14} /></button>
                            </div>
                          </td>
                        </tr>
                        {editingOrgId === org.id && (
                          <tr><td colSpan={5} className="px-6 py-4 bg-indigo-50/50 border-b border-indigo-100">
                            <div className="space-y-3">
                              <h5 className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Edit Organisation</h5>
                              <div className="grid grid-cols-2 gap-6">
                                {/* Left: fields + save */}
                                <div className="space-y-3">
                                  <div><label className={labelClass}>Name</label><input value={editOrgName} onChange={e => setEditOrgName(e.target.value)} className={inputClass} /></div>
                                  <div>
                                    <label className={labelClass}>Datto Folder</label>
                                    {showEditOrgPicker ? (
                                      <DattoFolderPicker startFolderId={DATTO_ROOT_ID} startFolderName="Customer Documents"
                                        onSelect={(name, id, _path) => { setEditOrgFolderName(name); setEditOrgFolderId(id); setShowEditOrgPicker(false); }}
                                        onNavigate={(name, id) => { setEditOrgFolderName(name); setEditOrgFolderId(id); }}
                                        onClose={() => setShowEditOrgPicker(false)} />
                                    ) : (
                                      <div onClick={() => setShowEditOrgPicker(true)} className={`${inputClass} flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-300 min-h-[42px]`}>
                                        {editOrgFolderName && editOrgFolderName !== `ID: ${editOrgFolderId}` ? (
                                          <span className="flex flex-col gap-0.5 min-w-0">
                                            <span className="flex items-center gap-1.5 text-indigo-700 font-bold text-sm truncate"><Folder size={13} className="text-amber-400 shrink-0" />{editOrgFolderName}</span>
                                            {editOrgFolderId && <span className="text-[10px] font-mono text-slate-400 pl-5 truncate">{editOrgFolderId}</span>}
                                          </span>
                                        ) : editOrgFolderId ? (
                                          <span className="flex items-center gap-1.5 text-amber-600 font-mono text-xs"><Folder size={13} className="text-amber-400 shrink-0" />{editOrgFolderId}</span>
                                        ) : (
                                          <span className="text-slate-400 text-sm">Click to browse…</span>
                                        )}
                                        <FolderOpen size={16} className="text-slate-300 shrink-0" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    <button onClick={() => handleUpdateOrg(org.id)} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700" title="Save organisation changes">Save Changes</button>
                                    <button onClick={() => { setEditingOrgId(null); setShowEditOrgPicker(false); setOrgAdvisorSearch(''); setOrgClientSearch(''); }} className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider" title="Cancel without saving">Cancel</button>
                                  </div>
                                </div>
                                {/* Right: logo + user assignment */}
                                <div className="space-y-4">
                                  <div>
                                    <label className={labelClass}>Logo <span className="font-normal text-slate-400 normal-case tracking-normal">PNG/JPG/SVG · max 500KB</span></label>
                                    <div className="flex items-center gap-3">
                                      {editOrgLogoUrl && (
                                        <div className="bg-white border border-slate-200 rounded-xl p-2 flex items-center justify-center h-12 w-32 shrink-0">
                                          <img src={editOrgLogoUrl} alt="logo" className="max-h-8 max-w-full object-contain" />
                                        </div>
                                      )}
                                      <label className={`cursor-pointer px-3 py-2 bg-white border border-slate-200 rounded-xl text-[11px] font-black uppercase tracking-wider text-slate-500 hover:border-indigo-300 hover:text-indigo-600 ${orgLogoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                                        {orgLogoUploading ? 'Uploading…' : editOrgLogoUrl ? 'Replace' : 'Upload Logo'}
                                        <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden" onChange={async e => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;
                                          if (file.size > 500_000) { flash('Logo must be under 500KB', true); return; }
                                          setOrgLogoUploading(true);
                                          const ext = file.name.split('.').pop();
                                          const path = `${org.id}.${ext}`;
                                          const { error: upErr } = await supabase.storage.from('org-logos').upload(path, file, { upsert: true });
                                          if (upErr) { flash(upErr.message, true); setOrgLogoUploading(false); return; }
                                          const { data: { publicUrl } } = supabase.storage.from('org-logos').getPublicUrl(path);
                                          setEditOrgLogoUrl(publicUrl);
                                          setOrgLogoUploading(false);
                                        }} />
                                      </label>
                                      {editOrgLogoUrl && (
                                        <button onClick={async () => {
                                          const ext = editOrgLogoUrl.split('/').pop()?.split('?')[0]?.split('.').pop();
                                          await supabase.storage.from('org-logos').remove([`${org.id}.${ext}`]);
                                          setEditOrgLogoUrl('');
                                        }} className="text-rose-400 hover:text-rose-600 text-[11px] font-black uppercase">Remove</button>
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <label className={labelClass}>Advisors</label>
                                    <div className="space-y-1 mb-2">
                                      {assignments.filter((a: any) => a.organisation_id === org.id).map((a: any) => (
                                        <div key={a.id} className="flex items-center justify-between px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-sm">
                                          <span className="font-bold text-slate-700">{users.find(u => u.id === a.advisor_id)?.email || a.advisor_id}</span>
                                          <button onClick={() => handleDeleteAssignment(a.id)} className="text-rose-400 hover:text-rose-600 p-0.5 rounded" title="Remove this advisor from the organisation"><X size={13} /></button>
                                        </div>
                                      ))}
                                      {assignments.filter((a: any) => a.organisation_id === org.id).length === 0 && <p className="text-xs text-slate-400">No advisors assigned</p>}
                                    </div>
                                    <div className="relative">
                                      <input value={orgAdvisorSearch} onChange={e => setOrgAdvisorSearch(e.target.value)} placeholder="Search by email to add…" className={`${inputClass} text-xs`} />
                                      {orgAdvisorSearch && (
                                        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                                          {advisors.filter(a => a.email.toLowerCase().includes(orgAdvisorSearch.toLowerCase()) && !assignments.some((as: any) => as.organisation_id === org.id && as.advisor_id === a.id)).slice(0, 5).map(a => (
                                            <button key={a.id} onClick={() => handleAddOrgAdvisor(org.id, a.id)} className="w-full text-left px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700" title="Add this advisor to the organisation">{a.email}</button>
                                          ))}
                                          {advisors.filter(a => a.email.toLowerCase().includes(orgAdvisorSearch.toLowerCase()) && !assignments.some((as: any) => as.organisation_id === org.id && as.advisor_id === a.id)).length === 0 && <p className="px-4 py-2.5 text-sm text-slate-400">No matches</p>}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <label className={labelClass}>Client Users <span className="text-slate-400 font-normal normal-case tracking-normal">(all org sites by default)</span></label>
                                    <div className="space-y-1 mb-2">
                                      {users.filter(u => u.profile?.role === 'client' && u.profile?.organisation_id === org.id).map(u => {
                                        const orgSites = sites.filter(s => s.organisation_id === org.id);
                                        const assignedSiteIds = new Set(clientSiteAssignments.filter(a => a.client_user_id === u.id).map((a: any) => a.site_id));
                                        const isExpanded = expandingUserId === u.id;
                                        return (
                                          <div key={u.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                                            <div className="flex items-center justify-between px-3 py-1.5 text-sm">
                                              <button onClick={() => setExpandingUserId(isExpanded ? null : u.id)} className="flex items-center gap-1.5 font-bold text-slate-700 hover:text-indigo-600 text-left" title="Expand to manage site access">
                                                <ChevronRight size={12} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                                {u.email}
                                                {assignedSiteIds.size > 0 && <span className="text-[10px] font-black text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-full">{assignedSiteIds.size} site{assignedSiteIds.size !== 1 ? 's' : ''}</span>}
                                              </button>
                                              <div className="flex items-center gap-3">
                                                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 cursor-pointer select-none">
                                                  <input type="checkbox" checked={!!u.profile?.view_only} onChange={e => handleSetViewOnly(u.id, e.target.checked)} className="accent-indigo-600" />
                                                  Viewer only
                                                </label>
                                                <button onClick={() => handleRemoveOrgClient(u.id)} className="text-rose-400 hover:text-rose-600 p-0.5 rounded" title="Remove this client from the organisation"><X size={13} /></button>
                                              </div>
                                            </div>
                                            {isExpanded && (
                                              <div className="border-t border-slate-100 px-3 py-2 bg-slate-50 space-y-1">
                                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">Site access {assignedSiteIds.size === 0 ? '— all sites (default)' : '— restricted to checked'}</p>
                                                {orgSites.map(s => {
                                                  const assigned = assignedSiteIds.has(s.id);
                                                  const assignment = clientSiteAssignments.find((a: any) => a.client_user_id === u.id && a.site_id === s.id);
                                                  return (
                                                    <label key={s.id} className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer hover:text-indigo-600">
                                                      <input type="checkbox" checked={assigned} className="accent-indigo-600"
                                                        onChange={async e => {
                                                          if (e.target.checked) { await handleAddSiteClient(s.id, u.id); }
                                                          else if (assignment) { await handleDeleteClientSiteAssignment(assignment.id); }
                                                        }}
                                                      />
                                                      {s.name}
                                                    </label>
                                                  );
                                                })}
                                                {orgSites.length === 0 && <p className="text-xs text-slate-400">No sites in this org</p>}
                                                <div className="pt-2 mt-2 border-t border-slate-200">
                                                  <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer select-none">
                                                    <input type="checkbox" checked={u.profile?.receive_emails !== false} onChange={e => handleSetReceiveEmails(u.id, e.target.checked)} className="accent-indigo-600" />
                                                    Send email notifications
                                                  </label>
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                      {users.filter(u => u.profile?.role === 'client' && u.profile?.organisation_id === org.id).length === 0 && <p className="text-xs text-slate-400">No client users assigned</p>}
                                    </div>
                                    <div className="relative">
                                      <input value={orgClientSearch} onChange={e => setOrgClientSearch(e.target.value)} placeholder="Search by email to add…" className={`${inputClass} text-xs`} />
                                      {orgClientSearch && (
                                        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                                          {users.filter(u => u.profile?.role === 'client' && u.email.toLowerCase().includes(orgClientSearch.toLowerCase()) && u.profile?.organisation_id !== org.id).slice(0, 5).map(u => (
                                            <button key={u.id} onClick={() => handleAddOrgClient(org.id, u.id)} className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700" title="Add this client to the organisation">{u.email}</button>
                                          ))}
                                          {users.filter(u => u.profile?.role === 'client' && u.email.toLowerCase().includes(orgClientSearch.toLowerCase()) && u.profile?.organisation_id !== org.id).length === 0 && <p className="px-4 py-2 text-sm text-slate-400">No matches</p>}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td></tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {/* ── SITES TAB ── */}
      {activeTab === 'sites' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">{filteredSites.length} Site{filteredSites.length !== 1 ? 's' : ''}</h3>
              <select value={selectedOrgFilter} onChange={e => setSelectedOrgFilter(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 focus:outline-none bg-white">
                <option value="">All Organisations</option>
                {organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </div>
            <button onClick={() => setShowSiteForm(v => !v)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700" title="Add a new site"><Plus size={13} />Add Site</button>
          </div>

          {showSiteForm && (
            <div className="bg-white border border-indigo-200 rounded-lg p-6 space-y-4">
              <h4 className="font-black text-slate-900 text-sm uppercase tracking-widest">New Site</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><label className={labelClass}>Site Name *</label><input value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="e.g. Main Assembly Factory" className={inputClass} /></div>
                <div>
                  <label className={labelClass}>Organisation *</label>
                  <select value={siteOrgId} onChange={e => { setSiteOrgId(e.target.value); setSiteFolderId(''); setSiteFolderName(''); }} className={inputClass}>
                    <option value="">Select organisation…</option>
                    {organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Assigned Advisor</label>
                  <select value={siteAdvisorId} onChange={e => setSiteAdvisorId(e.target.value)} className={inputClass}>
                    <option value="">No advisor</option>
                    {advisors.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Site Type</label>
                <div className="flex gap-2 flex-wrap">
                  {SITE_TYPES.map(t => <button key={t} onClick={() => setSiteType(t)} className={`px-3 py-2 rounded-xl text-[11px] font-black border transition-all ${siteType === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>{getSiteLabel(t)}</button>)}
                </div>
                {siteType === 'OTHER' && (
                  <input value={siteTypeOther} onChange={e => setSiteTypeOther(e.target.value)} placeholder="Describe the site type…" className={`${inputClass} mt-2`} />
                )}
              </div>
              <FolderPickerField
                folderId={siteFolderId} folderName={siteFolderName} showPicker={showSiteFolderPicker}
                onOpenPicker={(v: boolean) => setShowSiteFolderPicker(v)}
                onSelectFolder={(name: string, id: string, _path: string) => { setSiteFolderName(name); setSiteFolderId(id); setSiteFolderPath(_path); setShowSiteFolderPicker(false); }}
                onNavigate={(name: string, id: string) => { setSitePickerCurrentName(name); setSitePickerCurrentId(id); }}
                orgForPicker={selectedOrgForSitePicker} labelText="Datto Folder" labelHint="optional — if blank, uses the organisation folder"
              />
              <div className="flex gap-3">
                <button onClick={handleCreateSite} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700" title="Create this site in the portal">Create Site</button>
                <button onClick={() => { setShowSiteForm(false); setShowSiteFolderPicker(false); }} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider" title="Cancel without saving">Cancel</button>
              </div>
            </div>
          )}

          {loading ? <div className="py-12 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div>
            : filteredSites.length === 0 ? (
              <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
                <Factory size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="font-black text-slate-700">No sites yet</p>
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                  <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-6 py-3">Site</th><th className="px-6 py-3">Organisation</th><th className="px-6 py-3">Advisor</th><th className="px-6 py-3">Type</th><th className="px-6 py-3">Datto Folder</th><th className="px-6 py-3"></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSites.map(site => (
                      <React.Fragment key={site.id}>
                        <tr className={`cursor-pointer select-none ${editingSiteId === site.id ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`} onClick={() => editingSiteId === site.id ? (setEditingSiteId(null), setShowEditSitePicker(false), setSiteServices([]), setSiteAdvisorSearch(''), setSiteClientSearch('')) : startEditSite(site)}>
                          <td className="px-6 py-4 font-bold text-slate-800">
                            {site.name}
                            <div className="flex gap-2 mt-0.5">
                              <button onClick={e => { e.stopPropagation(); onViewSite(site, 'advisor'); }} className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 hover:underline" title="Switch to advisor view for this site">View as advisor</button>
                              <span className="text-slate-300 text-[10px]">|</span>
                              <button onClick={e => { e.stopPropagation(); onViewSite(site, 'client'); }} className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 hover:underline" title="Switch to client view for this site">View as client</button>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-500">{site.organisations?.name || '—'}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{(() => { const orgAdvisorId = assignments.find((a: any) => a.organisation_id === site.organisation_id)?.advisor_id; const effectiveId = site.advisor_id || orgAdvisorId; const advisor = effectiveId ? advisors.find(a => a.id === effectiveId) : null; return advisor ? <span className={site.advisor_id ? '' : 'text-slate-400 italic'}>{advisor.email}{!site.advisor_id && ' (org)'}</span> : <span className="text-slate-300">Unassigned</span>; })()}</td>
                          <td className="px-6 py-4"><span className="text-[10px] font-black uppercase tracking-wider text-slate-500 bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg">{getSiteLabel(site.type)}</span></td>
                          <td className="px-6 py-4 text-xs">
                            {site.datto_folder_id ? (
                              <span className="flex flex-col gap-0.5">
                                {site.datto_folder_path && <span className="font-bold text-slate-700 flex items-center gap-1"><Folder size={11} className="text-amber-400 shrink-0" />{site.datto_folder_path.split('/').filter(Boolean).pop() || site.datto_folder_path}</span>}
                                <span className="font-mono text-amber-600">{site.datto_folder_id}</span>
                              </span>
                            ) : <span className="text-slate-300 italic">Uses org folder</span>}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {site.datto_folder_id && (
                                <>
                                  <button
                                    onClick={e => { e.stopPropagation(); handleQuickSyncSite(site); }}
                                    disabled={!!quickSyncModalSites}
                                    className="text-violet-400 hover:text-violet-600 p-1.5 rounded-lg hover:bg-violet-50 disabled:opacity-40"
                                    title="Run AI sync now"
                                  ><RefreshCw size={14} /></button>
                                  <button
                                    onClick={e => { e.stopPropagation(); setSyncConfigSite({ ...site, excluded_datto_folder_ids: site.excluded_datto_folder_ids ?? [] }); }}
                                    className="text-violet-400 hover:text-violet-600 p-1.5 rounded-lg hover:bg-violet-50"
                                    title="Configure sync folders"
                                  ><Settings size={14} /></button>
                                </>
                              )}
                              <button onClick={e => { e.stopPropagation(); handleClearSiteActions(site.id, site.name); }} className="text-amber-400 hover:text-amber-600 p-1.5 rounded-lg hover:bg-amber-50" title="Clear all actions and evidence for this site (keeps site, documents and settings)"><Trash2 size={14} /></button>
                              <button onClick={e => { e.stopPropagation(); handleDeleteSite(site.id); }} className="text-rose-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50" title="Permanently delete this site from the portal"><X size={14} /></button>
                            </div>
                          </td>
                        </tr>
                        {editingSiteId === site.id && (
                          <tr><td colSpan={6} className="px-6 py-4 bg-indigo-50/50 border-b border-indigo-100">
                            <div className="space-y-3">
                              <h5 className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Edit Site</h5>
                              <div className="grid grid-cols-2 gap-6">
                                {/* Left: fields */}
                                <div className="space-y-3">
                                  <div><label className={labelClass}>Name</label><input value={editSiteName} onChange={e => setEditSiteName(e.target.value)} className={inputClass} /></div>
                                  <div className="grid grid-cols-2 gap-3">
                                    <div>
                                      <label className={labelClass}>Type</label>
                                      <select value={editSiteType} onChange={e => setEditSiteType(e.target.value)} className={inputClass}>
                                        {SITE_TYPES.map(t => <option key={t} value={t}>{getSiteLabel(t)}</option>)}
                                      </select>
                                      {editSiteType === 'OTHER' && (
                                        <input value={editSiteTypeOther} onChange={e => setEditSiteTypeOther(e.target.value)} placeholder="Describe the site type…" className={`${inputClass} mt-2`} />
                                      )}
                                    </div>
                                    <div><label className={labelClass}>Employees</label><input type="number" min="1" value={editSiteEmployeeCount} onChange={e => setEditSiteEmployeeCount(e.target.value)} placeholder="e.g. 25" className={inputClass} /></div>
                                  </div>
                                  <div>
                                    <label className={labelClass}>Datto Folder</label>
                                    {showEditSitePicker ? (
                                      <DattoFolderPicker
                                        startFolderId={organisations.find(o => o.id === site.organisation_id)?.datto_folder_id || DATTO_ROOT_ID}
                                        startFolderName={organisations.find(o => o.id === site.organisation_id)?.name || 'Customer Documents'}
                                        onSelect={(name, id, path) => { setEditSiteFolderName(name); setEditSiteFolderId(id); setEditSiteFolderPath(path); setShowEditSitePicker(false); }}
                                        onNavigate={(name, id) => { setEditSiteFolderName(name); setEditSiteFolderId(id); }}
                                        onClose={() => setShowEditSitePicker(false)} />
                                    ) : (
                                      <div onClick={() => setShowEditSitePicker(true)} className={`${inputClass} flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-300 min-h-[42px]`}>
                                        {editSiteFolderName ? (
                                          <span className="flex flex-col gap-0.5 min-w-0">
                                            <span className="flex items-center gap-1.5 text-indigo-700 font-bold text-sm truncate"><Folder size={13} className="text-amber-400 shrink-0" />{editSiteFolderName}</span>
                                            {editSiteFolderId && <span className="text-[10px] font-mono text-slate-400 pl-5 truncate">{editSiteFolderId}</span>}
                                          </span>
                                        ) : (
                                          <span className="text-slate-400 text-sm">Click to browse…</span>
                                        )}
                                        <FolderOpen size={16} className="text-slate-300 shrink-0" />
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {/* Right: logo + user assignment */}
                                <div className="space-y-4">
                                  <div>
                                    <label className={labelClass}>Site Logo <span className="font-normal text-slate-400 normal-case tracking-normal">PNG/JPG/SVG · max 500KB · overrides org logo</span></label>
                                    <div className="flex items-center gap-3">
                                      {editSiteLogoUrl && (
                                        <div className="bg-white border border-slate-200 rounded-xl p-2 flex items-center justify-center h-12 w-32 shrink-0">
                                          <img src={editSiteLogoUrl} alt="logo" className="max-h-8 max-w-full object-contain" />
                                        </div>
                                      )}
                                      <label className={`cursor-pointer px-3 py-2 bg-white border border-slate-200 rounded-xl text-[11px] font-black uppercase tracking-wider text-slate-500 hover:border-indigo-300 hover:text-indigo-600 ${editSiteLogoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                                        {editSiteLogoUploading ? 'Uploading…' : editSiteLogoUrl ? 'Replace' : 'Upload Logo'}
                                        <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden" onChange={async e => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;
                                          if (file.size > 500_000) { flash('Logo must be under 500KB', true); return; }
                                          setEditSiteLogoUploading(true);
                                          const ext = file.name.split('.').pop();
                                          const path = `sites/${editingSiteId}.${ext}`;
                                          const { error: upErr } = await supabase.storage.from('org-logos').upload(path, file, { upsert: true });
                                          if (upErr) { flash(upErr.message, true); setEditSiteLogoUploading(false); return; }
                                          const { data: { publicUrl } } = supabase.storage.from('org-logos').getPublicUrl(path);
                                          setEditSiteLogoUrl(publicUrl);
                                          setEditSiteLogoUploading(false);
                                        }} />
                                      </label>
                                      {editSiteLogoUrl && (
                                        <button onClick={async () => {
                                          const ext = editSiteLogoUrl.split('/').pop()?.split('?')[0]?.split('.').pop();
                                          await supabase.storage.from('org-logos').remove([`sites/${editingSiteId}.${ext}`]);
                                          setEditSiteLogoUrl('');
                                        }} className="text-rose-400 hover:text-rose-600 text-[11px] font-black uppercase">Remove</button>
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <label className={labelClass}>Advisors</label>
                                    <div className="space-y-1 mb-1.5">
                                      {advisorSiteAssignments.filter((a: any) => a.site_id === site.id).map((a: any) => (
                                        <div key={a.id} className="flex items-center justify-between px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-sm">
                                          <span className="font-bold text-slate-700">{users.find(u => u.id === a.advisor_id)?.email || a.advisor_id}</span>
                                          <button onClick={() => handleDeleteAdvisorSiteAssignment(a.id)} className="text-rose-400 hover:text-rose-600 p-0.5 rounded" title="Remove this advisor from the site"><X size={13} /></button>
                                        </div>
                                      ))}
                                      {advisorSiteAssignments.filter((a: any) => a.site_id === site.id).length === 0 && <p className="text-[11px] text-slate-400">No advisors assigned</p>}
                                    </div>
                                    <div className="relative">
                                      <input value={siteAdvisorSearch} onChange={e => setSiteAdvisorSearch(e.target.value)} placeholder="Search to add…" className={`${inputClass} text-xs`} />
                                      {siteAdvisorSearch && (
                                        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                                          {advisors.filter(a => a.email.toLowerCase().includes(siteAdvisorSearch.toLowerCase()) && !advisorSiteAssignments.some((as: any) => as.site_id === site.id && as.advisor_id === a.id)).slice(0, 5).map(a => (
                                            <button key={a.id} onClick={() => handleAddSiteAdvisor(site.id, a.id)} className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700" title="Add this advisor to the site">{a.email}</button>
                                          ))}
                                          {advisors.filter(a => a.email.toLowerCase().includes(siteAdvisorSearch.toLowerCase()) && !advisorSiteAssignments.some((as: any) => as.site_id === site.id && as.advisor_id === a.id)).length === 0 && <p className="px-4 py-2 text-sm text-slate-400">No matches</p>}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <label className={labelClass}>Client Users <span className="text-slate-400 font-normal normal-case tracking-normal">(restricts to this site only)</span></label>
                                    <div className="space-y-1 mb-1.5">
                                      {clientSiteAssignments.filter((a: any) => a.site_id === site.id).map((a: any) => (
                                        <div key={a.id} className="flex items-center justify-between px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-sm">
                                          <span className="font-bold text-slate-700">{users.find(u => u.id === a.client_user_id)?.email || a.client_user_id}</span>
                                          <button onClick={() => handleDeleteClientSiteAssignment(a.id)} className="text-rose-400 hover:text-rose-600 p-0.5 rounded" title="Remove this client from this site"><X size={13} /></button>
                                        </div>
                                      ))}
                                      {clientSiteAssignments.filter((a: any) => a.site_id === site.id).length === 0 && <p className="text-[11px] text-slate-400">No specific clients assigned</p>}
                                    </div>
                                    <div className="relative">
                                      <input value={siteClientSearch} onChange={e => setSiteClientSearch(e.target.value)} placeholder="Search by email to add…" className={`${inputClass} text-xs`} />
                                      {siteClientSearch && (
                                        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                                          {users.filter((u: any) => u.profile?.role === 'client' && u.email.toLowerCase().includes(siteClientSearch.toLowerCase()) && !clientSiteAssignments.some((a: any) => a.site_id === site.id && a.client_user_id === u.id)).slice(0, 5).map((u: any) => (
                                            <button key={u.id} onClick={() => handleAddSiteClient(site.id, u.id)} className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700" title="Restrict this client to this site">{u.email}</button>
                                          ))}
                                          {users.filter((u: any) => u.profile?.role === 'client' && u.email.toLowerCase().includes(siteClientSearch.toLowerCase()) && !clientSiteAssignments.some((a: any) => a.site_id === site.id && a.client_user_id === u.id)).length === 0 && <p className="px-4 py-2 text-sm text-slate-400">No matches</p>}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Services Purchased */}
                              {siteServicesLoading ? (
                                <div className="py-4 text-[11px] text-slate-400 font-bold animate-pulse">Loading services…</div>
                              ) : siteServices.length > 0 ? (
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <label className={labelClass}>Contracted Services <span className="text-slate-300 font-normal">(based on {SITE_TYPE_LABELS[editSiteType] || editSiteType} requirements)</span></label>
                                    {(() => { const purchased = siteServices.filter(s => s.purchased).length; const pct = Math.round((purchased / siteServices.length) * 100); const c = scoreColor(pct); return <span className={`text-[11px] font-black ${c.text}`}>IAG: {pct}%</span>; })()}
                                  </div>
                                  <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                                    {siteServices.map(svc => (
                                      <div key={svc.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50">
                                        <input type="checkbox" id={`svc-${svc.id}`} checked={svc.purchased} onChange={e => {
                                          const newVal = e.target.checked;
                                          setSiteServices(prev => prev.map(s => s.id === svc.id ? { ...s, purchased: newVal } : s));
                                        }} className="rounded" />
                                        <label htmlFor={`svc-${svc.id}`} className="flex-1 text-xs font-bold text-slate-700 cursor-pointer">{svc.requirement_name}</label>
                                        {svc.is_mandatory
                                          ? <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">Mandatory</span>
                                          : <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200">Recommended</span>
                                        }
                                      </div>
                                    ))}
                                  </div>
                                  {siteServices.some(s => s.is_mandatory && !s.purchased) && (
                                    <p className="text-[11px] font-bold text-rose-600 mt-1.5 flex items-center gap-1.5"><AlertCircle size={12} />{siteServices.filter(s => s.is_mandatory && !s.purchased).length} mandatory service(s) not covered — IAG score will show Red</p>
                                  )}
                                </div>
                              ) : null}
                              {!siteServicesLoading && (
                                <div className="flex gap-2 pt-1">
                                  <button onClick={async () => {
                                    await handleUpdateSite(site.id);
                                    if (siteServices.length > 0) await Promise.all(siteServices.map(svc => fetch(`/api/sites/${site.id}/services`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requirementId: svc.id, purchased: svc.purchased }) })));
                                  }} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700" title="Save site changes">Save Changes</button>
                                  <button onClick={() => { setEditingSiteId(null); setShowEditSitePicker(false); setSiteServices([]); setSiteAdvisorSearch(''); setSiteClientSearch(''); }} className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider" title="Cancel without saving">Cancel</button>
                                </div>
                              )}
                            </div>
                          </td></tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {/* ── USERS TAB ── */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">
              {filteredUsers.length}{filteredUsers.length !== users.length ? ` / ${users.length}` : ''} User{users.length !== 1 ? 's' : ''}
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={userFilterOrg} onChange={e => { setUserFilterOrg(e.target.value); setUserFilterSite(''); }} className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="">All organisations</option>
                {organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
              <select value={userFilterSite} onChange={e => setUserFilterSite(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="">All sites</option>
                {(userFilterOrg ? sites.filter((s: any) => s.organisation_id === userFilterOrg) : sites).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {(userFilterOrg || userFilterSite) && <button onClick={() => { setUserFilterOrg(''); setUserFilterSite(''); }} className="text-xs text-slate-400 hover:text-slate-600 font-bold px-2 py-2 rounded-lg hover:bg-slate-100" title="Clear filters">Clear</button>}
              <button onClick={() => setShowUserForm(v => !v)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700" title="Add a new user account"><Plus size={13} />Add User</button>
            </div>
          </div>
          {showUserForm && (
            <div className="bg-white border border-indigo-200 rounded-lg p-6 space-y-4">
              <h4 className="font-black text-slate-900 text-sm uppercase tracking-widest">New User</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className={labelClass}>Email *</label><input type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)} autoComplete="off" placeholder="user@company.com" className={inputClass} /></div>
                <div><label className={labelClass}>Password *</label><div className="relative"><input type={showUserPassword ? 'text' : 'password'} value={userPassword} onChange={e => setUserPassword(e.target.value)} autoComplete="new-password" placeholder="Min 8 characters" className={`${inputClass} pr-10`} /><button type="button" onClick={() => setShowUserPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{showUserPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className={labelClass}>Full Name</label><input type="text" value={userFullName} onChange={e => setUserFullName(e.target.value)} placeholder="e.g. Jane Smith" className={inputClass} /></div>
                <div><label className={labelClass}>Phone <span className="text-slate-300 font-normal normal-case tracking-normal">(optional)</span></label><input type="tel" value={userPhone} onChange={e => setUserPhone(e.target.value)} placeholder="e.g. 07700 900000" className={inputClass} /></div>
              </div>
              <div>
                <label className={labelClass}>Role *</label>
                <div className="flex gap-2">
                  {(['advisor', 'client'] as const).map(r => <button key={r} onClick={() => setUserRole(r)} className={`flex-1 py-2.5 rounded-xl text-[11px] font-black border transition-all capitalize ${userRole === r ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200'}`}>{r}</button>)}
                </div>
              </div>
              {userRole === 'client' && (
                <>
                  <div>
                    <label className={labelClass}>Organisation *</label>
                    <select value={userOrgId} onChange={e => { setUserOrgId(e.target.value); setUserSiteIds([]); }} className={inputClass}>
                      <option value="">Select organisation…</option>
                      {organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
                    </select>
                  </div>
                  {userOrgId && (
                    <div>
                      <label className={labelClass}>Restrict to specific sites <span className="text-slate-400 font-normal normal-case">(leave empty to allow all sites in org)</span></label>
                      <div className="border border-slate-200 rounded-xl p-3 space-y-1.5 max-h-40 overflow-y-auto">
                        {sites.filter((s: any) => s.organisation_id === userOrgId).map((s: any) => (
                          <label key={s.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                            <input type="checkbox" checked={userSiteIds.includes(s.id)}
                              onChange={e => setUserSiteIds(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))}
                              className="rounded border-slate-300" />
                            {s.name}
                          </label>
                        ))}
                        {sites.filter((s: any) => s.organisation_id === userOrgId).length === 0 && <p className="text-xs text-slate-400">No sites in this organisation yet</p>}
                      </div>
                    </div>
                  )}
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input type="checkbox" checked={userViewOnly} onChange={e => setUserViewOnly(e.target.checked)} className="accent-indigo-600 rounded" />
                  <span className="text-sm font-bold text-slate-700">View only <span className="text-slate-400 font-normal">(read-only access — documents &amp; compliance only)</span></span>
                </label>
                </>
              )}
              <div className="flex gap-3">
                <button onClick={handleCreateUser} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700" title="Create this user account">Create User</button>
                <button onClick={() => setShowUserForm(false)} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider" title="Cancel without saving">Cancel</button>
              </div>
            </div>
          )}
          {loading ? <div className="py-12 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div> : (
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-left">
                <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-6 py-3">Email</th><th className="px-6 py-3">Role</th><th className="px-6 py-3">Organisation</th><th className="px-6 py-3">Sites</th><th className="px-6 py-3"></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map(user => {
                    const isClient = user.profile?.role === 'client';
                    const userAssignments = clientSiteAssignments.filter((a: any) => a.client_user_id === user.id);
                    const isExpanded = expandingUserId === user.id;
                    return (
                      <React.Fragment key={user.id}>
                        <tr className={`${isClient ? 'cursor-pointer select-none' : ''} ${isExpanded ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`} onClick={isClient ? () => { const newExpanded = isExpanded ? null : user.id; setExpandingUserId(newExpanded); setUserSiteSearch(''); if (newExpanded && !userActivityMap[user.id]) loadUserActivity(user.id); } : undefined}>
                          <td className="px-6 py-4">
                            <span className="font-bold text-slate-800">{user.profile?.full_name || user.email}</span>
                            {user.profile?.full_name && <span className="block text-xs text-slate-400">{user.email}</span>}
                          </td>
                          <td className="px-6 py-4"><span className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg border ${user.profile?.role === 'superadmin' ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : user.profile?.role === 'advisor' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}`}>{user.profile?.role || 'unknown'}</span></td>
                          <td className="px-6 py-4 text-sm text-slate-500">{
                            user.profile?.role === 'advisor'
                              ? (() => { const orgNames = assignments.filter((a: any) => a.advisor_id === user.id).map((a: any) => a.organisations?.name || organisations.find(o => o.id === a.organisation_id)?.name).filter(Boolean); return orgNames.length ? orgNames.join(', ') : '—'; })()
                              : user.profile?.organisation_id ? organisations.find(o => o.id === user.profile.organisation_id)?.name || '—' : '—'
                          }</td>
                          <td className="px-6 py-4 text-sm text-slate-500">
                            {isClient ? (
                              userAssignments.length > 0
                                ? <span className="text-xs font-bold text-slate-700">{userAssignments.map((a: any) => a.sites?.name || a.site_id).join(', ')}</span>
                                : <span className="text-xs text-emerald-600 font-bold">All org sites</span>
                            ) : '—'}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {user.profile?.role !== 'superadmin' && <button onClick={e => { e.stopPropagation(); setAdminWelcomeUser({ id: user.id, email: user.email, name: user.profile?.full_name || null }); setAdminWelcomePw(user.user_metadata?.welcome_password ?? ''); setShowAdminWelcomePw(false); }} className="text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50" title="Send welcome email"><Mail size={14} /></button>}
                              {isClient && <button onClick={e => { e.stopPropagation(); setUserRole('client'); setUserOrgId(user.profile?.organisation_id || ''); setUserSiteIds(clientSiteAssignments.filter((a: any) => a.client_user_id === user.id).map((a: any) => a.site_id)); setUserViewOnly(user.profile?.view_only || false); setUserEmail(''); setUserPassword(''); setUserFullName(''); setUserPhone(''); setShowUserForm(true); }} className="text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50" title="Duplicate user — copies org & site access"><Copy size={14} /></button>}
                              {user.profile?.role !== 'superadmin' && <button onClick={e => { e.stopPropagation(); setAdminRenameUser({ id: user.id, email: user.email, currentName: user.profile?.full_name || '', currentPhone: user.profile?.phone || '' }); setAdminRenameValue(user.profile?.full_name || ''); setAdminRenamePhoneValue(user.profile?.phone || ''); }} className="text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50" title="Set display name"><Pencil size={14} /></button>}
                              {user.profile?.role !== 'superadmin' && <button onClick={e => { e.stopPropagation(); setAdminSetPwUser({ id: user.id, email: user.email }); setAdminSetPwValue(''); }} className="text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50" title="Set password"><KeyRound size={14} /></button>}
                              {user.profile?.role !== 'superadmin' && <button onClick={e => { e.stopPropagation(); handleDeleteUser(user.id); }} className="text-rose-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50" title="Permanently delete this user account"><X size={14} /></button>}
                            </div>
                          </td>
                        </tr>
                        {isClient && isExpanded && (
                          <tr className="bg-slate-50 border-t border-indigo-100">
                            <td colSpan={5} className="px-8 py-4">
                              <div className="max-w-md space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Site Access</p>
                                {userAssignments.length === 0 && (
                                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold mb-2">
                                    <span>Default: all sites in organisation. Add specific sites below to restrict access.</span>
                                  </div>
                                )}
                                {userAssignments.map((a: any) => (
                                  <div key={a.id} className="flex items-center justify-between px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-sm">
                                    <span className="font-bold text-slate-700">{a.sites?.name || a.site_id}</span>
                                    <button onClick={() => handleDeleteClientSiteAssignment(a.id)} className="text-rose-400 hover:text-rose-600 p-0.5 rounded" title="Remove restriction"><X size={13} /></button>
                                  </div>
                                ))}
                                <div className="relative pt-1">
                                  <input value={userSiteSearch} onChange={e => setUserSiteSearch(e.target.value)} placeholder="Search to restrict to a site…" className={`${inputClass} text-xs`} />
                                  {userSiteSearch && (
                                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                                      {sites.filter((s: any) => s.name.toLowerCase().includes(userSiteSearch.toLowerCase()) && !userAssignments.some((a: any) => a.site_id === s.id)).slice(0, 5).map((s: any) => (
                                        <button key={s.id} onClick={() => { handleAddSiteClient(s.id, user.id); setUserSiteSearch(''); }} className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700" title="Restrict this user to this site">{s.name}</button>
                                      ))}
                                      {sites.filter((s: any) => s.name.toLowerCase().includes(userSiteSearch.toLowerCase()) && !userAssignments.some((a: any) => a.site_id === s.id)).length === 0 && <p className="px-4 py-2 text-sm text-slate-400">No matches</p>}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Email notifications */}
                              <div className="mt-4 pt-4 border-t border-slate-200">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Notifications</p>
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer select-none">
                                  <input type="checkbox" checked={user.profile?.receive_emails !== false} onChange={e => handleSetReceiveEmails(user.id, e.target.checked)} className="accent-indigo-600" />
                                  Send email notifications to this user
                                </label>
                              </div>

                              {/* Recent Activity */}
                              <div className="mt-5 pt-4 border-t border-slate-200">
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Recent Activity</p>
                                  {userActivityMap[user.id]?.length > 0 && (
                                    <a
                                      href={`/api/activity?userId=${user.id}&callerId=${user.id}&format=csv`}
                                      onClick={async e => {
                                        e.preventDefault();
                                        const { data: { session } } = await supabase.auth.getSession();
                                        const callerId = session?.user?.id ?? '';
                                        window.location.href = `/api/activity?userId=${user.id}&callerId=${callerId}&format=csv`;
                                      }}
                                      className="text-[10px] font-black text-indigo-500 hover:text-indigo-700 uppercase tracking-widest"
                                    >
                                      Export CSV
                                    </a>
                                  )}
                                </div>
                                {userActivityLoading[user.id] ? (
                                  <div className="text-xs text-slate-400 font-bold animate-pulse py-2">Loading…</div>
                                ) : !userActivityMap[user.id] ? (
                                  <div className="text-xs text-slate-400 py-2">No data loaded.</div>
                                ) : userActivityMap[user.id].length === 0 ? (
                                  <div className="text-xs text-slate-400 py-2">No activity recorded for this user.</div>
                                ) : (
                                  <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                                    {userActivityMap[user.id].slice(0, 50).map((ev: any) => {
                                      const actionLabel: Record<string, string> = {
                                        document_viewed:   'Viewed',
                                        file_uploaded:     'Uploaded file',
                                        evidence_uploaded: 'Uploaded evidence',
                                        login:             'Logged in',
                                      };
                                      return (
                                        <div key={ev.id} className="flex items-center gap-2 py-1.5 px-3 bg-slate-50 rounded-xl text-xs">
                                          <span className="font-bold text-slate-600 shrink-0">{actionLabel[ev.action] ?? ev.action}</span>
                                          {ev.resource_name && <span className="text-slate-400 truncate flex-1">{ev.resource_name}</span>}
                                          <span className="text-slate-300 font-medium shrink-0 tabular-nums ml-auto">
                                            {new Date(ev.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── ASSIGNMENTS TAB ── */}
      {/* ── INDUSTRY STANDARD REQUIREMENTS TAB ── */}
      {activeTab === 'requirements' && (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between items-start gap-4">
            <div>
              <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm mb-2">Industry Standard Requirements</h3>
              <div className="flex items-center gap-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Site Type</label>
                <select value={reqSiteType} onChange={e => { setReqSiteType(e.target.value); setGeneratePreview(null); }}
                  className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none bg-white">
                  {SITE_TYPES.filter(t => t !== 'OTHER').map(t => <option key={t} value={t}>{SITE_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAddReqForm(v => !v)} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-slate-50" title="Add a requirement manually"><Plus size={13} />Add Requirement</button>
              <button onClick={handleGenerateRequirements} disabled={generating}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-700 disabled:opacity-50" title="Generate requirements for this site type using AI">
                <Sparkles size={13} />{generating ? 'Generating…' : 'Generate with AI'}
              </button>
            </div>
          </div>

          {/* AI disclaimer */}
          <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 font-bold">AI-generated industry standards — please verify mandatory requirements before publishing to sites. Mandatory flags should reflect current UK legislation.</p>
          </div>

          {/* Add requirement form */}
          {showAddReqForm && (
            <div className="bg-white border border-indigo-200 rounded-lg p-6 space-y-4">
              <h4 className="font-black text-slate-900 text-sm uppercase tracking-widest">New Requirement</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className={labelClass}>Requirement Name *</label><input value={newReqName} onChange={e => setNewReqName(e.target.value)} placeholder="e.g. Fire Risk Assessment" className={inputClass} /></div>
                <div><label className={labelClass}>Description</label><input value={newReqDesc} onChange={e => setNewReqDesc(e.target.value)} placeholder="Brief description" className={inputClass} /></div>
                <div><label className={labelClass}>Legal Basis (if mandatory)</label><input value={newReqLegal} onChange={e => setNewReqLegal(e.target.value)} placeholder="e.g. Fire Safety Order 2005" className={inputClass} /></div>
                <div className="flex items-center gap-3 pt-6"><input type="checkbox" id="newMandatory" checked={newReqMandatory} onChange={e => setNewReqMandatory(e.target.checked)} className="rounded" /><label htmlFor="newMandatory" className="text-sm font-bold text-slate-700">Mandatory (legally required)</label></div>
              </div>
              <div className="flex gap-3">
                <button onClick={handleAddRequirement} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700" title="Save this requirement to the portal">Add Requirement</button>
                <button onClick={() => setShowAddReqForm(false)} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider" title="Cancel without saving">Cancel</button>
              </div>
            </div>
          )}

          {/* AI generate preview */}
          {generatePreview && (
            <div className="bg-white border border-violet-200 rounded-lg overflow-hidden">
              <div className="bg-violet-600 px-6 py-4 flex items-center justify-between">
                <h4 className="font-black text-white text-sm uppercase tracking-widest flex items-center gap-2"><Sparkles size={14} />Review AI-Generated Requirements</h4>
                <button onClick={() => setGeneratePreview(null)} className="text-violet-200 hover:text-white" title="Dismiss AI preview"><X size={18} /></button>
              </div>
              <div className="px-6 pt-4 flex items-center justify-between">
                <p className="text-[11px] text-slate-500 font-bold">Select the requirements to add. These will replace existing requirements for {SITE_TYPE_LABELS[reqSiteType]}.</p>
                <button onClick={() => { const allSelected = generatePreview.every((r: any) => r.selected); setGeneratePreview(generatePreview.map((r: any) => ({ ...r, selected: !allSelected }))); }} className="text-[11px] font-black text-violet-600 hover:text-violet-800 shrink-0 ml-4" title="Toggle selection for all requirements">
                  {generatePreview.every((r: any) => r.selected) ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto mt-3">
                {generatePreview.map((r: any, i: number) => (
                  <div key={i} className={`px-6 py-3 flex items-start gap-3 cursor-pointer hover:bg-slate-50 ${!r.selected ? 'opacity-50' : ''}`} onClick={() => setGeneratePreview(generatePreview.map((x: any, j: number) => j === i ? { ...x, selected: !x.selected } : x))}>
                    <input type="checkbox" checked={r.selected} onChange={() => {}} className="mt-0.5 rounded shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2"><span className="text-sm font-bold text-slate-800">{r.requirement_name}</span>{r.is_mandatory && <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">Mandatory</span>}</div>
                      {r.description && <p className="text-[11px] text-slate-500 mt-0.5">{r.description}</p>}
                      {r.legal_basis && <p className="text-[10px] text-slate-400 font-mono mt-0.5">{r.legal_basis}</p>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-6 py-4 flex items-center gap-3 border-t border-slate-100">
                <button onClick={handleConfirmGenerate} className="px-6 py-2.5 bg-violet-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-700" title="Save selected requirements to the portal">Save {generatePreview.filter((r: any) => r.selected).length} Requirement{generatePreview.filter((r: any) => r.selected).length !== 1 ? 's' : ''}</button>
                <button onClick={() => setGeneratePreview(null)} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider" title="Cancel without saving">Cancel</button>
              </div>
            </div>
          )}

          {/* Existing requirements list */}
          {reqLoading ? <div className="py-8 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div>
          : requirements.length === 0 ? (
            <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
              <Shield size={32} className="text-slate-300 mx-auto mb-3" />
              <p className="font-black text-slate-700">No requirements set for {SITE_TYPE_LABELS[reqSiteType]}</p>
              <p className="text-sm text-slate-400 mt-1">Use "Generate with AI" to create a starting list, or add manually.</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-left">
                <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-6 py-3">Requirement</th><th className="px-6 py-3">Status</th><th className="px-6 py-3">Legal Basis</th><th className="px-6 py-3"></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {requirements.map(req => (
                    <React.Fragment key={req.id}>
                      <tr className={`cursor-pointer select-none ${editingReqId === req.id ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`} onClick={() => editingReqId === req.id ? setEditingReqId(null) : (setEditingReqId(req.id), setEditReqName(req.requirement_name), setEditReqDesc(req.description || ''), setEditReqMandatory(req.is_mandatory), setEditReqLegal(req.legal_basis || ''))}>
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-800 text-sm">{req.requirement_name}</p>
                          {req.description && <p className="text-[11px] text-slate-400 mt-0.5">{req.description}</p>}
                        </td>
                        <td className="px-6 py-4">{req.is_mandatory ? <span className="text-[10px] font-black uppercase px-2 py-1 rounded-full bg-rose-100 text-rose-700 border border-rose-200">Mandatory</span> : <span className="text-[10px] font-black uppercase px-2 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Recommended</span>}</td>
                        <td className="px-6 py-4 text-[11px] text-slate-400 font-mono">{req.legal_basis || '—'}</td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={e => { e.stopPropagation(); handleDeleteRequirement(req.id); }} className="text-rose-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50" title="Permanently delete this requirement"><X size={14} /></button>
                        </td>
                      </tr>
                      {editingReqId === req.id && (
                        <tr><td colSpan={4} className="px-6 py-4 bg-indigo-50/50 border-b border-indigo-100">
                          <div className="space-y-3">
                            <h5 className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Edit Requirement</h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div><label className={labelClass}>Name</label><input value={editReqName} onChange={e => setEditReqName(e.target.value)} className={inputClass} /></div>
                              <div><label className={labelClass}>Description</label><input value={editReqDesc} onChange={e => setEditReqDesc(e.target.value)} className={inputClass} /></div>
                              <div><label className={labelClass}>Legal Basis</label><input value={editReqLegal} onChange={e => setEditReqLegal(e.target.value)} className={inputClass} /></div>
                              <div className="flex items-center gap-3 pt-6"><input type="checkbox" id={`mand-${req.id}`} checked={editReqMandatory} onChange={e => setEditReqMandatory(e.target.checked)} className="rounded" /><label htmlFor={`mand-${req.id}`} className="text-sm font-bold text-slate-700">Mandatory</label></div>
                            </div>
                            <div className="flex gap-3"><button onClick={() => handleUpdateRequirement(req.id)} className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700" title="Save requirement changes">Save</button><button onClick={() => setEditingReqId(null)} className="px-5 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider" title="Cancel without saving">Cancel</button></div>
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── USAGE & COSTS TAB ── */}
      {activeTab === 'usage' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-black text-slate-800">Usage & Costs</h3>
              <p className="text-xs text-slate-400 mt-0.5">AI API token usage and estimated spend</p>
            </div>
            <div className="flex items-center gap-2">
              {[7, 30, 90].map(d => (
                <button key={d} onClick={() => setUsageDays(d)} className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest border transition-colors ${usageDays === d ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`}>{d}d</button>
              ))}
              <button onClick={loadUsage} disabled={usageLoading} className="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest border border-slate-200 bg-white text-slate-500 hover:border-indigo-300 disabled:opacity-50">
                <RefreshCw size={12} className={usageLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {usageLoading && <div className="text-center py-12 text-slate-400 text-sm font-bold">Loading usage data…</div>}

          {!usageLoading && usageData && (() => {
            const USD_TO_GBP = 0.79; // update as needed
            const gbp = (usd: number) => `£${(usd * USD_TO_GBP).toFixed(4)}`;
            const usd = (u: number) => `$${u.toFixed(4)}`;
            const { totals, daily, orgs, recent, cloudconvertCredits, cloudconvertMonthly } = usageData;
            const gemini = totals?.gemini ?? {};
            const claude = totals?.claude ?? {};
            const cc = totals?.cloudconvert ?? {};
            const totalCost = (gemini.costUsd ?? 0) + (claude.costUsd ?? 0);
            const maxDayCost = daily.length ? Math.max(...daily.map((d: any) => (d.gemini ?? 0) + (d.claude ?? 0)), 0.000001) : 0.000001;
            const thisMonth = new Date().toISOString().slice(0, 7);
            const ccThisMonth = (cloudconvertMonthly ?? []).find((m: any) => m.month === thisMonth)?.count ?? 0;
            const ccLastMonth = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); const m = d.toISOString().slice(0, 7); return (cloudconvertMonthly ?? []).find((x: any) => x.month === m)?.count ?? 0; })();

            return (
              <div className="space-y-6">
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'Gemini (MTD)', costUsd: gemini.costUsd ?? 0, sub: `${((gemini.inputTokens ?? 0) + (gemini.outputTokens ?? 0)).toLocaleString()} tokens`, color: 'text-indigo-600', isCC: false },
                    { label: 'Claude (MTD)', costUsd: claude.costUsd ?? 0, sub: `${((claude.inputTokens ?? 0) + (claude.outputTokens ?? 0)).toLocaleString()} tokens`, color: 'text-violet-600', isCC: false },
                    { label: 'CloudConvert (credits)', costUsd: null, sub: `${ccLastMonth} last month`, color: 'text-amber-600', isCC: true },
                    { label: 'Total AI Cost', costUsd: totalCost, sub: `${(gemini.count ?? 0) + (claude.count ?? 0)} AI calls`, color: 'text-slate-800', isCC: false },
                  ].map(card => (
                    <div key={card.label} className="bg-white border border-slate-200 rounded-lg p-5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{card.label}</p>
                      {card.isCC ? (
                        <div className="mt-1">
                          <p className={`text-xl font-black ${card.color}`}>{ccThisMonth} <span className="text-sm font-bold text-slate-400">used this month</span></p>
                          {cloudconvertCredits !== null && <p className="text-[11px] text-slate-400 font-mono">{cloudconvertCredits} credits remaining</p>}
                        </div>
                      ) : (
                        <>
                          <p className={`text-xl font-black mt-1 ${card.color}`}>{usd(card.costUsd!)}</p>
                          <p className="text-[11px] text-slate-400 font-mono">{gbp(card.costUsd!)} <span className="text-[9px] uppercase tracking-widest">est.</span></p>
                        </>
                      )}
                      <p className="text-[11px] text-slate-400 mt-0.5">{card.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Daily bar chart */}
                {daily.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-lg p-6">
                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-4">Daily cost — last {usageDays} days</h4>
                    <div className="flex items-end gap-1 h-32">
                      {daily.map((d: any) => {
                        const geminiH = Math.round(((d.gemini ?? 0) / maxDayCost) * 100);
                        const claudeH = Math.round(((d.claude ?? 0) / maxDayCost) * 100);
                        return (
                          <div key={d.date} className="flex-1 flex flex-col items-center gap-0 justify-end min-w-0" title={`${d.date}\nGemini: ${gbp(d.gemini ?? 0)} (${usd(d.gemini ?? 0)})\nClaude: ${gbp(d.claude ?? 0)} (${usd(d.claude ?? 0)})`}>
                            {claudeH > 0 && <div className="w-full bg-violet-400 rounded-t" style={{ height: `${claudeH}%` }} />}
                            {geminiH > 0 && <div className={`w-full bg-indigo-400 ${claudeH === 0 ? 'rounded-t' : ''}`} style={{ height: `${geminiH}%` }} />}
                            {geminiH === 0 && claudeH === 0 && <div className="w-full bg-slate-100 rounded-t" style={{ height: '2px' }} />}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between mt-2">
                      <span className="text-[10px] text-slate-400">{daily[0]?.date}</span>
                      <div className="flex items-center gap-3 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-indigo-400" />Gemini</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-violet-400" />Claude</span>
                      </div>
                      <span className="text-[10px] text-slate-400">{daily[daily.length - 1]?.date}</span>
                    </div>
                  </div>
                )}

                {/* CloudConvert monthly breakdown */}
                {cloudconvertMonthly?.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-lg p-6">
                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-4">CloudConvert credits used — last 12 months</h4>
                    <div className="flex items-end gap-2 h-24 mb-3">
                      {(() => {
                        const maxCount = Math.max(...cloudconvertMonthly.map((m: any) => m.count), 1);
                        return cloudconvertMonthly.map((m: any) => {
                          const h = Math.round((m.count / maxCount) * 100);
                          const label = new Date(m.month + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
                          const isCurrent = m.month === thisMonth;
                          return (
                            <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${label}: ${m.count} conversion${m.count !== 1 ? 's' : ''}`}>
                              <span className="text-[9px] font-black text-slate-500">{m.count}</span>
                              <div className={`w-full rounded-t ${isCurrent ? 'bg-amber-500' : 'bg-amber-200'}`} style={{ height: `${Math.max(h, 4)}%` }} />
                              <span className={`text-[9px] font-bold truncate w-full text-center ${isCurrent ? 'text-amber-600' : 'text-slate-400'}`}>{label}</span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                    {cloudconvertCredits !== null && (
                      <p className="text-[11px] text-slate-400 mt-2">Balance: <span className="font-black text-slate-600">{cloudconvertCredits} credits remaining</span></p>
                    )}
                  </div>
                )}

                {/* Per-org table */}
                {orgs.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100">
                      <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Per organisation</h4>
                    </div>
                    <table className="w-full text-left">
                      <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100">
                        <th className="px-6 py-3">Organisation</th>
                        <th className="px-6 py-3 text-right">Gemini</th>
                        <th className="px-6 py-3 text-right">Claude</th>
                        <th className="px-6 py-3 text-right">CC conv.</th>
                        <th className="px-6 py-3 text-right">Total</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {orgs.map((org: any) => (
                          <tr key={org.name} className="hover:bg-slate-50">
                            <td className="px-6 py-3 text-sm font-bold text-slate-700">{org.name}</td>
                            <td className="px-6 py-3 text-right text-sm font-mono"><span className="text-slate-700">{usd(org.gemini)}</span><span className="text-slate-400 text-[10px] ml-1">{gbp(org.gemini)} est.</span></td>
                            <td className="px-6 py-3 text-right text-sm font-mono"><span className="text-slate-700">{usd(org.claude)}</span><span className="text-slate-400 text-[10px] ml-1">{gbp(org.claude)} est.</span></td>
                            <td className="px-6 py-3 text-right text-sm text-slate-500 font-mono">{org.cloudconvert}</td>
                            <td className="px-6 py-3 text-right text-sm font-black font-mono"><span className="text-slate-800">{usd(org.total)}</span><span className="text-slate-400 text-[10px] ml-1">{gbp(org.total)} est.</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Recent calls */}
                {recent.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100">
                      <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Recent calls (last 50)</h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100">
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Service</th>
                          <th className="px-4 py-3">Operation</th>
                          <th className="px-4 py-3">Site</th>
                          <th className="px-4 py-3 text-right">In</th>
                          <th className="px-4 py-3 text-right">Out</th>
                          <th className="px-4 py-3 text-right">Cost</th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {recent.map((row: any) => (
                            <tr key={row.id ?? row.created_at} className="hover:bg-slate-50">
                              <td className="px-4 py-2.5 text-[11px] text-slate-400 font-mono whitespace-nowrap">{row.created_at?.slice(0, 16).replace('T', ' ')}</td>
                              <td className="px-4 py-2.5"><span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${row.service === 'gemini' ? 'bg-indigo-100 text-indigo-700' : row.service === 'claude' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'}`}>{row.service}</span></td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-500">{row.operation ?? '—'}</td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-500 truncate max-w-[140px]">{(row as any).sites?.name ?? row.metadata?.docName ?? '—'}</td>
                              <td className="px-4 py-2.5 text-right text-[11px] font-mono text-slate-400">{row.input_tokens?.toLocaleString() ?? '—'}</td>
                              <td className="px-4 py-2.5 text-right text-[11px] font-mono text-slate-400">{row.output_tokens?.toLocaleString() ?? '—'}</td>
                              <td className="px-4 py-2.5 text-right text-[11px] font-mono">{row.cost_usd ? <><span className="text-slate-700">{usd(parseFloat(row.cost_usd))}</span><span className="text-slate-400 text-[10px] ml-1">{gbp(parseFloat(row.cost_usd))} est.</span></> : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {!usageLoading && !usageData && (
            <div className="text-center py-12 text-slate-400 text-sm">No usage data found.</div>
          )}
        </div>
      )}

      {/* ── DATA HEALTH TAB ── */}
      {activeTab === 'data-health' && (() => {
        // Per-check config: how each non-fixable issue is resolved
        const checkConfig: Record<string, { kind: 'sync' | 'navigate'; tab?: 'actions' | 'documents'; actionLabel: string }> = {
          outdated_extraction:   { kind: 'sync',     actionLabel: 'Sync All' },
          never_synced_sites:    { kind: 'sync',     actionLabel: 'Run Sync' },
          missing_folder_path:   { kind: 'sync',     actionLabel: 'Sync to fix paths' },
          unscanned_docs:        { kind: 'navigate', tab: 'documents', actionLabel: 'Open → Documents' },
          missing_datto_ids:     { kind: 'navigate', tab: 'documents', actionLabel: 'Open → Documents' },
        };
        const severityColors = {
          error:   { border: 'border-rose-200',  bg: 'bg-rose-50',  dot: 'bg-rose-500',   badge: 'bg-rose-100 text-rose-700' },
          warning: { border: 'border-amber-200', bg: 'bg-amber-50', dot: 'bg-amber-400',  badge: 'bg-amber-100 text-amber-700' },
          info:    { border: 'border-blue-200',  bg: 'bg-blue-50',  dot: 'bg-blue-400',   badge: 'bg-blue-100 text-blue-700' },
          ok:      { border: 'border-slate-200', bg: 'bg-white',    dot: 'bg-emerald-400', badge: 'bg-emerald-100 text-emerald-700' },
        };
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-lg font-black text-slate-800">Data Health</h3>
                <p className="text-xs text-slate-400 mt-0.5">Detect and repair stale, incomplete, or inconsistent database records</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {dhResults && !dhLoading && (
                  <button onClick={() => runRepair('all_safe')} disabled={!!dhRepairing} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2">
                    <CheckCircle size={13} />Auto-fix all safe issues
                  </button>
                )}
                <button onClick={loadDataHealth} disabled={dhLoading} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                  <RefreshCw size={13} className={dhLoading ? 'animate-spin' : ''} />{dhLoading ? 'Running…' : dhResults ? 'Re-run' : 'Run health check'}
                </button>
              </div>
            </div>

            {dhMessage && (
              <div className={`px-4 py-3 rounded-xl text-sm font-bold border ${dhMessage.toLowerCase().includes('fail') || dhMessage.toLowerCase().includes('error') ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                {dhMessage}
              </div>
            )}

            {!dhResults && !dhLoading && (
              <div className="text-center py-16 text-slate-400">
                <Database size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-bold">Run a health check to detect stale or inconsistent records</p>
                <p className="text-xs mt-1">Checks for orphaned actions, incomplete AI extractions, archive mismatches, and more</p>
              </div>
            )}

            {dhResults && (
              <div className="space-y-3">
                {dhResults.map(check => {
                  const isOk = check.severity === 'ok';
                  const c = severityColors[check.severity as keyof typeof severityColors] ?? severityColors.ok;
                  const cfg = checkConfig[check.id];
                  return (
                    <div key={check.id} className={`border rounded-xl overflow-hidden ${c.border} ${isOk ? '' : c.bg}`}>
                      <div className="p-4 space-y-3">
                        {/* Header row */}
                        <div className="flex items-start gap-3">
                          <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="font-black text-slate-800 text-sm">{check.label}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${c.badge}`}>
                                {isOk ? 'All clear' : `${check.count} ${check.countUnit ?? 'issue'}${check.count !== 1 ? 's' : ''}`}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{check.description}</p>
                          </div>
                          {/* Top-right: fix button for auto-fixable */}
                          {!isOk && check.fixable && (
                            <button
                              onClick={() => runRepair(check.id)}
                              disabled={!!dhRepairing}
                              className="flex-shrink-0 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-black uppercase tracking-wider text-slate-600 hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {dhRepairing === check.id ? <RefreshCw size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                              {check.fixLabel}
                            </button>
                          )}
                        </div>

                        {/* Per-site action buttons for non-fixable issues */}
                        {!isOk && !check.fixable && cfg && check.details.length > 0 && (
                          <div className="ml-5 flex flex-wrap gap-2">
                            {check.details.map((d: any) => {
                              const matchSite = sites.find(s => s.id === d.site_id);
                              const isSyncing = dhSyncingIds.has(d.site_id);
                              const isSynced  = dhSyncedIds.has(d.site_id);
                              const label = `${d.org_name ? `${d.org_name} › ` : ''}${d.site_name}`;
                              if (cfg.kind === 'sync') {
                                return (
                                  <button
                                    key={d.site_id}
                                    disabled={isSyncing || !matchSite}
                                    onClick={() => syncSiteFromDH(d.site_id)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-black uppercase tracking-wider transition-colors disabled:opacity-60 ${isSynced ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-600 hover:border-violet-400 hover:text-violet-700'}`}
                                  >
                                    {isSyncing ? <RefreshCw size={11} className="animate-spin" /> : isSynced ? <CheckCircle size={11} /> : <Zap size={11} />}
                                    {cfg.actionLabel}: {label}
                                    {!isSynced && <span className="text-slate-400 font-normal">— {d.count} {check.countUnit ?? 'issue'}{d.count !== 1 ? 's' : ''}</span>}
                                  </button>
                                );
                              } else {
                                return (
                                  <button
                                    key={d.site_id}
                                    disabled={!matchSite}
                                    onClick={() => matchSite && onViewSite(matchSite, 'advisor', cfg.tab)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-black uppercase tracking-wider text-slate-600 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-60"
                                  >
                                    <ExternalLink size={11} />{cfg.actionLabel}: {label} <span className="text-slate-400 font-normal">— {d.count} {check.countUnit ?? 'issue'}{d.count !== 1 ? 's' : ''}</span>
                                  </button>
                                );
                              }
                            })}
                            {check.details.length > 12 && (
                              <span className="text-[10px] text-slate-400 px-2 py-1.5 font-bold self-center">+{check.details.length - 12} more</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {activeTab === 'sync-logs' && <SyncLogsTab />}

      {syncConfigSite && (
        <SyncConfigModal
          site={syncConfigSite}
          onClose={() => setSyncConfigSite(null)}
          onSave={(siteId, includedIds) => {
            setSites(prev => prev.map(s => s.id === siteId ? { ...s, included_datto_folder_ids: includedIds, excluded_datto_folder_ids: [] } : s));
            setSyncConfigSite(null);
          }}
        />
      )}

      {quickSyncModalSites && (
        <div className={syncModalMinimised ? 'hidden' : ''}>
          <SyncProgressModal
            sites={quickSyncModalSites}
            onClose={() => { setQuickSyncModalSites(null); setSyncModalMinimised(false); }}
            onMinimise={() => setSyncModalMinimised(true)}
            onViewSite={siteId => { onViewSite(sites.find(s => s.id === siteId) ?? sites[0], 'advisor'); setQuickSyncModalSites(null); setSyncModalMinimised(false); }}
          />
        </div>
      )}
      {quickSyncModalSites && syncModalMinimised && (
        <button
          onClick={() => setSyncModalMinimised(false)}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-violet-700 text-white px-4 py-2.5 rounded-xl shadow-2xl text-[11px] font-black uppercase tracking-widest hover:bg-violet-800 transition-colors"
          title="Show sync progress"
        >
          <RefreshCw size={12} className="animate-spin" />AI Sync running…
        </button>
      )}

      {/* Admin rename user modal */}
      {adminRenameUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-black text-slate-900 text-base mb-1">Edit contact info</h3>
            <p className="text-xs text-slate-400 mb-4">{adminRenameUser.email}</p>
            <div className="space-y-3">
              <div><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Full Name</label><input type="text" value={adminRenameValue} onChange={e => setAdminRenameValue(e.target.value)} placeholder="e.g. Jane Smith" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
              <div><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Phone <span className="font-normal normal-case tracking-normal text-slate-300">(optional)</span></label><input type="tel" value={adminRenamePhoneValue} onChange={e => setAdminRenamePhoneValue(e.target.value)} placeholder="e.g. 07700 900000" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
              <div className="pt-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Notifications</label>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer select-none">
                  <input type="checkbox" checked={users.find(u => u.id === adminRenameUser.id)?.profile?.receive_emails !== false} onChange={e => handleSetReceiveEmails(adminRenameUser.id, e.target.checked)} className="accent-indigo-600" />
                  Send email notifications
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => { setAdminRenameUser(null); setAdminRenameValue(''); setAdminRenamePhoneValue(''); }} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-[11px] font-black uppercase tracking-wider text-slate-500 hover:bg-slate-50" title="Cancel without saving">Cancel</button>
              <button onClick={async () => {
                const res = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: adminRenameUser.id, full_name: adminRenameValue.trim() || null, phone: adminRenamePhoneValue.trim() || null }) });
                if (!res.ok) { const d = await res.json().catch(() => ({})); flash(apiErr(d, 'Failed to update contact info'), true); return; }
                setAdminRenameUser(null); setAdminRenameValue(''); setAdminRenamePhoneValue(''); flash('Contact info updated'); loadUsers();
              }} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700" title="Save contact info">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Admin set password modal */}
      {adminWelcomeUser && (() => {
        const recipientProfile = users.find((u: any) => u.id === adminWelcomeUser.id);
        const recipientOrgId = recipientProfile?.profile?.organisation_id ?? null;
        const recipientSiteIds: string[] = clientSiteAssignments.filter((a: any) => a.client_user_id === adminWelcomeUser.id).map((a: any) => a.site_id);
        const advisorUsers = users.filter((u: any) => u.profile?.role === 'advisor' && u.email && u.id !== adminWelcomeUser.id);
        const orgSiteUsers = users.filter((u: any) => {
          if (!u.email || u.id === adminWelcomeUser.id || u.profile?.role === 'superadmin' || u.profile?.role === 'advisor') return false;
          if (recipientOrgId && u.profile?.organisation_id === recipientOrgId) return true;
          if (recipientSiteIds.length && clientSiteAssignments.some((a: any) => a.client_user_id === u.id && recipientSiteIds.includes(a.site_id))) return true;
          return false;
        });
        const storedPw = recipientProfile?.user_metadata?.welcome_password ?? '';
        const closeWelcome = () => { setAdminWelcomeUser(null); setAdminWelcomePw(''); setAdminWelcomeCc([]); setAdminWelcomeCcCustom(''); };
        const CcCheckboxList = ({ users: list }: { users: any[] }) => (
          <div className="border border-slate-200 rounded-xl p-2.5 space-y-1.5 max-h-32 overflow-y-auto">
            {list.map((u: any) => (
              <label key={u.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer px-1">
                <input type="checkbox" checked={adminWelcomeCc.includes(u.email)} onChange={e => setAdminWelcomeCc(prev => e.target.checked ? [...prev, u.email] : prev.filter(x => x !== u.email))} className="accent-indigo-600 rounded" />
                <span className="font-medium">{u.profile?.full_name || u.email}</span>
                {u.profile?.full_name && <span className="text-slate-400 text-xs">{u.email}</span>}
              </label>
            ))}
          </div>
        );
        return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="font-black text-slate-900 text-base mb-1">Send Welcome Email</h3>
            <p className="text-xs text-slate-400 mb-4">{adminWelcomeUser.email}{adminWelcomeUser.name ? ` · ${adminWelcomeUser.name}` : ''}</p>
            <div className="space-y-3">
              <div><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Advisor Name</label><input type="text" value={adminWelcomeAdvisor} onChange={e => setAdminWelcomeAdvisor(e.target.value)} placeholder="e.g. Paul Johnson" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">
                  Password <span className="font-normal normal-case tracking-normal text-slate-300">(also resets account password)</span>
                </label>
                <div className="relative"><Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" /><input type={showAdminWelcomePw ? 'text' : 'password'} value={adminWelcomePw} onChange={e => setAdminWelcomePw(e.target.value)} autoComplete="new-password" placeholder="Min. 8 characters" className="w-full pl-9 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /><button type="button" onClick={() => setShowAdminWelcomePw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{showAdminWelcomePw ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>
                {storedPw && adminWelcomePw === storedPw && !showAdminWelcomePw && <p className="text-[11px] text-amber-500 mt-1">Pre-filled from last welcome email — confirm or change before sending.</p>}
              </div>
              {advisorUsers.length > 0 && (
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">CC Advisors</label>
                  <CcCheckboxList users={advisorUsers} />
                </div>
              )}
              {orgSiteUsers.length > 0 && (
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">CC Organisation / Site Users</label>
                  <CcCheckboxList users={orgSiteUsers} />
                </div>
              )}
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">CC Other <span className="font-normal normal-case tracking-normal text-slate-300">(comma-separated)</span></label>
                <input type="text" value={adminWelcomeCcCustom} onChange={e => setAdminWelcomeCcCustom(e.target.value)} placeholder="e.g. manager@company.com" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={closeWelcome} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-[11px] font-black uppercase tracking-wider text-slate-500 hover:bg-slate-50" title="Cancel">Cancel</button>
              <button disabled={adminWelcomeLoading} onClick={async () => {
                if (!adminWelcomeAdvisor.trim()) { flash('Enter an advisor name', true); return; }
                if (adminWelcomePw.length < 8) { flash('Password must be at least 8 characters', true); return; }
                const customCc = adminWelcomeCcCustom.split(',').map(s => s.trim()).filter(Boolean);
                const allCc = [...adminWelcomeCc, ...customCc];
                setAdminWelcomeLoading(true);
                const res = await fetch(`/api/admin/users/${adminWelcomeUser.id}/welcome`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ advisorName: adminWelcomeAdvisor.trim(), password: adminWelcomePw, cc: allCc }) });
                setAdminWelcomeLoading(false);
                if (!res.ok) { const d = await res.json().catch(() => ({})); flash(d.error || 'Failed to send welcome email', true); return; }
                closeWelcome(); flash('Welcome email sent');
              }} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50" title="Send welcome email to this user">{adminWelcomeLoading ? 'Sending…' : 'Send Welcome Email'}</button>
            </div>
          </div>
        </div>
        );
      })()}
      {adminSetPwUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-black text-slate-900 text-base mb-1">Set password</h3>
            <p className="text-xs text-slate-400 mb-4">{adminSetPwUser.email}</p>
            {flashError && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold px-3 py-2 rounded-xl mb-3">{flashError}</div>}
            <div><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">New Password</label><div className="relative"><Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" /><input type={showAdminSetPw ? 'text' : 'password'} value={adminSetPwValue} onChange={e => setAdminSetPwValue(e.target.value)} onKeyDown={async e => { if (e.key === 'Enter') { /* submit */ } }} autoComplete="new-password" placeholder="Min. 8 characters" className="w-full pl-9 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /><button type="button" onClick={() => setShowAdminSetPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{showAdminSetPw ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => { setAdminSetPwUser(null); setAdminSetPwValue(''); setShowAdminSetPw(false); }} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-[11px] font-black uppercase tracking-wider text-slate-500 hover:bg-slate-50" title="Cancel without saving">Cancel</button>
              <button disabled={adminSetPwLoading} onClick={async () => {
                if (adminSetPwValue.length < 8) { flash('Password must be at least 8 characters', true); return; }
                setAdminSetPwLoading(true);
                const res = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: adminSetPwUser.id, newPassword: adminSetPwValue }) });
                setAdminSetPwLoading(false);
                if (!res.ok) { const d = await res.json().catch(() => ({})); flash(apiErr(d, 'Failed to set password'), true); return; }
                setAdminSetPwUser(null); setAdminSetPwValue(''); setShowAdminSetPw(false); flash('Password updated');
              }} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50" title="Set new password for this user">{adminSetPwLoading ? 'Saving…' : 'Set Password'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sync Config Modal ────────────────────────────────────────────────────────
const FolderCheckboxTree = ({ folderId, folderName, depth, includedIds, onToggle, onFolderLoaded }: {
  folderId: string; folderName: string; depth: number;
  includedIds: Set<string>; onToggle: (id: string, name: string) => void;
  onFolderLoaded: (parentId: string, children: { id: string; name: string }[]) => void;
}) => {
  const [expanded, setExpanded] = useState(true);
  const [children, setChildren] = useState<DattoItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const isIncluded = includedIds.has(folderId);

  const loadChildren = async () => {
    if (children !== null) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/datto?folderId=${folderId}`);
      const raw = await res.json();
      const items = normaliseItems(raw);
      const folders = items.filter((i: DattoItem) => i.type === 'folder');
      setChildren(folders);
      setFileCount(items.filter((i: DattoItem) => i.type === 'file').length);
      onFolderLoaded(folderId, folders.map((f: DattoItem) => ({ id: f.id, name: f.name })));
    } catch { /* silent */ }
    setLoading(false);
  };

  const handleExpand = () => {
    if (!expanded) loadChildren();
    setExpanded(v => !v);
  };

  useEffect(() => { loadChildren(); }, []);

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <div className="flex items-center gap-2 py-1.5">
        <button onClick={handleExpand} className="w-4 h-4 flex items-center justify-center text-slate-300 hover:text-slate-500 flex-shrink-0">
          {loading ? <span className="text-[9px] animate-pulse">…</span> : expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <input type="checkbox" checked={isIncluded} onChange={() => onToggle(folderId, folderName)} className="w-3.5 h-3.5 flex-shrink-0 accent-violet-600" />
        <Folder size={13} className={isIncluded ? 'text-amber-400 flex-shrink-0' : 'text-slate-300 flex-shrink-0'} />
        <span className={`text-xs font-bold flex-1 truncate ${isIncluded ? 'text-slate-700' : 'text-slate-400'}`}>{folderName}</span>
        {children !== null && children.length > 0 && (
          <span className="text-[10px] text-slate-400 font-bold bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">{children.length} folder{children.length !== 1 ? 's' : ''}</span>
        )}
        {fileCount !== null && (
          <span className="text-[10px] text-slate-400 font-bold bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
        )}
      </div>
      {expanded && children !== null && children.map(child => (
        <FolderCheckboxTree key={child.id} folderId={child.id} folderName={child.name} depth={depth + 1} includedIds={includedIds} onToggle={onToggle} onFolderLoaded={onFolderLoaded} />
      ))}
    </div>
  );
};

const DattoPathModal = ({ userId, currentPath, onClose, onSave }: {
  userId: string; currentPath: string; onClose: () => void; onSave: (path: string) => void;
}) => {
  const [path, setPath] = useState(currentPath || 'W:/Customer Documents');
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detectError, setDetectError] = useState('');

  const handleDetect = async () => {
    setDetecting(true); setDetectError('');
    try {
      const res = await fetch('/api/datto/resolve-drive-path');
      const json = await res.json();
      if (json.path) {
        setPath(json.path);
        if (json.driveLetter) localStorage.setItem('dattoDriveLetter', json.driveLetter);
      } else { setDetectError(json.error || 'Could not detect path'); }
    } catch { setDetectError('Detection failed'); }
    finally { setDetecting(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, datto_base_path: path }),
    });
    setSaving(false);
    onSave(path);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h2 className="font-black text-slate-900 text-base mb-1">Word Document Path</h2>
        <p className="text-[11px] text-slate-500 mb-5 leading-relaxed">
          The path used to open Word documents from your Datto drive. Click <strong>Detect</strong> to auto-fill from your local Datto drive mapping, or enter it manually.
        </p>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={path}
            onChange={e => setPath(e.target.value)}
            className="flex-1 text-[12px] font-mono border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="W:/Customer Documents"
          />
          <button
            onClick={handleDetect}
            disabled={detecting}
            className="px-3 py-2 text-[11px] font-black uppercase tracking-widest bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {detecting ? '…' : 'Detect'}
          </button>
        </div>
        {detectError && <p className="text-[11px] text-rose-600 mb-3">{detectError}</p>}
        <p className="text-[10px] text-slate-400 mb-5">
          If your Office Trusted Location shows a <code>\\MachineName\Workplace\...</code> UNC path, enter that here instead of <code>W:/</code>.
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-[11px] font-black uppercase tracking-widest bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

const fmtDate = (d: string | null) => {
  if (!d) return null;
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
  return d;
};

// ─── Client Uploads Panel (advisor review) ───────────────────────────────────
const ClientUploadsPanel = ({ siteId, siteName, siteFolderPath, userId, onClose, onCountChange }: {
  siteId: string; siteName: string; siteFolderPath?: string | null; userId: string; onClose: () => void; onCountChange: (n: number) => void;
}) => {
  type Upload = { id: string; file_name: string; file_size_bytes: number | null; notes: string | null; uploaded_at: string; uploaded_by: string | null; uploaderName: string; status: string; review_note: string | null; action_id: string | null; datto_file_id: string | null };
  type SiteAction = { id: string; title: string; hazard_ref: string | null; due_date: string | null; source_document_name: string | null };
  type ClientDoc = { id: string; document_name: string | null; file_name: string; file_size_bytes: number | null; created_at: string; uploaderName: string };

  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [noteExpanded, setNoteExpanded] = useState<Record<string, boolean>>({});
  const [noteText, setNoteText] = useState<Record<string, string>>({});
  const [linkExpanded, setLinkExpanded] = useState<Record<string, boolean>>({});
  const [actionSearch, setActionSearch] = useState<Record<string, string>>({});
  const [expandedDocName, setExpandedDocName] = useState<Record<string, string | null>>({});
  const [siteActions, setSiteActions] = useState<SiteAction[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [dbCount, setDbCount] = useState(0);
  const [pendingActions, setPendingActions] = useState<Record<string, string>>({});
  const [acknowledgedSet, setAcknowledgedSet] = useState<Set<string>>(new Set());
  const [clientDocs, setClientDocs] = useState<ClientDoc[]>([]);
  const [dismissedDocs, setDismissedDocs] = useState<Set<string>>(new Set());
  const [rejectExpanded, setRejectExpanded] = useState<Record<string, boolean>>({});
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    fetch(`/api/client-uploads?siteId=${siteId}&role=advisor`)
      .then(r => r.json())
      .then(async d => {
        const pending = (d.uploads ?? []).filter((u: any) => u.status === 'pending_review');
        const uploaderIds = [...new Set(pending.map((u: any) => u.uploaded_by).filter(Boolean))] as string[];
        let nameMap: Record<string, string> = {};
        if (uploaderIds.length > 0) {
          const res = await fetch(`/api/user-names?ids=${uploaderIds.join(',')}`);
          if (res.ok) nameMap = await res.json();
        }
        const enriched: Upload[] = pending.map((u: any) => ({ ...u, uploaderName: (u.uploaded_by ? nameMap[u.uploaded_by] : null) ?? 'Unknown' }));
        setUploads(enriched);
        setDbCount(enriched.length);
        onCountChange(enriched.length);

        // Load client-managed documents (client_provided = true) for info display
        const { data: docsData } = await supabase
          .from('site_documents')
          .select('id, document_name, file_name, file_size_bytes, created_at, uploaded_by')
          .eq('site_id', siteId)
          .eq('client_provided', true)
          .order('created_at', { ascending: false });
        const docRows = docsData ?? [];
        const missingIds = [...new Set(docRows.map((dd: any) => dd.uploaded_by).filter(Boolean) as string[])].filter((id: string) => !nameMap[id]);
        if (missingIds.length) {
          const r = await fetch(`/api/user-names?ids=${missingIds.join(',')}`);
          if (r.ok) Object.assign(nameMap, await r.json());
        }
        setClientDocs(docRows.map((dd: any) => ({
          id: dd.id, document_name: dd.document_name ?? null, file_name: dd.file_name,
          file_size_bytes: dd.file_size_bytes ?? null, created_at: dd.created_at,
          uploaderName: (dd.uploaded_by ? nameMap[dd.uploaded_by] : null) ?? 'Client',
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [siteId]);

  useEffect(() => { onCountChange(dbCount); }, [dbCount]);

  const fetchActions = async () => {
    if (siteActions.length > 0) return;
    setActionsLoading(true);
    const { data } = await supabase.from('actions').select('id, title, hazard_ref, due_date, source_document_name')
      .eq('site_id', siteId).in('status', ['open', 'pending_review']).order('source_document_name, title');
    setSiteActions((data ?? []).map(a => ({ id: a.id, title: a.title, hazard_ref: a.hazard_ref ?? null, due_date: a.due_date ?? null, source_document_name: a.source_document_name ?? null })));
    setActionsLoading(false);
  };

  const remove = (id: string) => {
    setDbCount(prev => Math.max(0, prev - 1));
    setUploads(prev => prev.filter(u => u.id !== id));
    setPendingActions(prev => { const n = { ...prev }; delete n[id]; return n; });
    setAcknowledgedSet(prev => { const s = new Set(prev); s.delete(id); return s; });
  };

  const handleAcknowledge = async (uploadId: string) => {
    setWorking(prev => new Set(prev).add(uploadId));
    const res = await fetch(`/api/client-uploads/${uploadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'acknowledge', reviewedBy: userId, reviewNote: noteText[uploadId] || null }),
    });
    if (res.ok) remove(uploadId);
    setWorking(prev => { const s = new Set(prev); s.delete(uploadId); return s; });
  };

  const handleLink = async (uploadId: string, actionId: string) => {
    setWorking(prev => new Set(prev).add(uploadId));
    const res = await fetch(`/api/client-uploads/${uploadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'link', actionId, reviewedBy: userId, reviewNote: noteText[uploadId] || null }),
    });
    if (res.ok) remove(uploadId);
    setWorking(prev => { const s = new Set(prev); s.delete(uploadId); return s; });
  };

  const handleSubmit = async (uploadId: string) => {
    const actionId = pendingActions[uploadId];
    if (actionId) {
      await handleLink(uploadId, actionId);
    } else {
      await handleAcknowledge(uploadId);
    }
  };

  const handleReject = async (uploadId: string) => {
    setWorking(prev => new Set(prev).add(uploadId));
    const res = await fetch(`/api/client-uploads/${uploadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', reviewedBy: userId, reviewNote: rejectNote[uploadId] || null }),
    });
    if (res.ok) remove(uploadId);
    setWorking(prev => { const s = new Set(prev); s.delete(uploadId); return s; });
  };

  const handleOpen = (upload: Upload) => {
    // Office files: always try W: drive via ms- protocol — path only needs siteFolderPath, not datto_file_id
    if (siteFolderPath) {
      const folderPath = `${siteFolderPath}/Client Provided Documents`;
      const href = getFileHref({ id: upload.datto_file_id ?? '', name: upload.file_name, type: 'file' }, folderPath, 'advisor');
      if (href.startsWith('ms-')) { window.location.href = href; return; }
    }
    // Non-Office with Datto ID: stream via Datto API inline (PDFs open in browser)
    if (upload.datto_file_id) {
      window.open(`/api/datto/file?fileId=${upload.datto_file_id}&fileName=${encodeURIComponent(upload.file_name)}`, '_blank');
      return;
    }
    // Fallback: Supabase signed URL — no forced download (PDFs open inline)
    fetch(`/api/client-uploads/${upload.id}`).then(r => r.json()).then(d => { if (d.url) window.open(d.url, '_blank'); });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-[75vw] max-w-5xl flex flex-col max-h-[75vh]">
        <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between flex-shrink-0 rounded-t-xl">
          <div>
            <h2 className="font-black text-white text-sm uppercase tracking-widest flex items-center gap-2">
              <Paperclip size={14} />Client Uploads
              {dbCount > 0 && <span className="bg-white/20 text-white text-[10px] font-black px-2 py-0.5 rounded-full">{dbCount}</span>}
            </h2>
            <p className="text-indigo-200 text-[11px] mt-0.5">{siteName} — review, acknowledge, or link to an existing action</p>
          </div>
          <button onClick={onClose} className="text-indigo-200 hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && <div className="p-8 text-center text-sm font-bold text-slate-400 animate-pulse">Loading uploads…</div>}

          {/* ── Section 1: Evidence Uploads (pending review) ── */}
          {!loading && (
            <div className="px-5 py-2.5 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2 sticky top-0 z-10">
              <Paperclip size={12} className="text-indigo-500 flex-shrink-0" />
              <span className="text-[10px] font-black text-indigo-700 uppercase tracking-widest">Evidence Uploads</span>
              <span className="text-[10px] text-indigo-500">— files submitted by client, awaiting review</span>
              {uploads.length > 0 && <span className="ml-auto text-[10px] font-black bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded-full">{uploads.length} to review</span>}
            </div>
          )}
          {!loading && uploads.length === 0 && (
            <div className="px-5 py-4 flex items-center gap-2 text-[11px] text-slate-400">
              <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
              All reviewed — nothing awaiting action
            </div>
          )}
          {!loading && uploads.map(upload => (
            <div key={upload.id} className={`border-b border-slate-100 last:border-b-0 transition-colors hover:bg-slate-50/60 ${working.has(upload.id) ? 'opacity-40 pointer-events-none' : ''}`}>
              {/* File info */}
              <div className="px-5 pt-4 pb-3 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Paperclip size={12} className="text-indigo-400 flex-shrink-0" />
                  <span className="text-xs font-black text-slate-700">{upload.file_name}</span>
                  {upload.file_size_bytes && <span className="text-[10px] text-slate-400">{(upload.file_size_bytes / 1024).toFixed(0)} KB</span>}
                  <span className="text-[10px] text-slate-400">{new Date(upload.uploaded_at).toLocaleDateString('en-GB')}</span>
                </div>
                <p className="text-[11px] text-slate-500">From: <span className="font-bold">{upload.uploaderName}</span></p>
                {upload.notes && <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded px-2 py-1">{upload.notes}</p>}

                {/* Advisor note textarea */}
                {noteExpanded[upload.id] && (
                  <textarea
                    value={noteText[upload.id] ?? ''}
                    onChange={e => setNoteText(prev => ({ ...prev, [upload.id]: e.target.value }))}
                    placeholder="Add a note to the client (optional)…"
                    rows={2}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-1"
                  />
                )}
                {/* Reject note textarea */}
                {rejectExpanded[upload.id] && (
                  <div className="mt-1 border border-rose-200 rounded-lg bg-rose-50 p-2 space-y-1.5">
                    <textarea
                      value={rejectNote[upload.id] ?? ''}
                      onChange={e => setRejectNote(prev => ({ ...prev, [upload.id]: e.target.value }))}
                      placeholder="Reason for returning (optional)…"
                      rows={2}
                      className="w-full border border-rose-200 rounded px-2 py-1 text-[11px] resize-none focus:outline-none focus:ring-2 focus:ring-rose-300 bg-white"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setRejectExpanded(prev => ({ ...prev, [upload.id]: false }))} className="px-2.5 py-1 border border-slate-200 rounded text-[10px] font-black text-slate-500 bg-white hover:bg-slate-50">Cancel</button>
                      <button onClick={() => handleReject(upload.id)} className="px-2.5 py-1 bg-rose-600 text-white rounded text-[10px] font-black hover:bg-rose-700">Confirm Return</button>
                    </div>
                  </div>
                )}

                {/* Link to action picker */}
                {linkExpanded[upload.id] && (
                  <div className="mt-1 border border-slate-200 rounded-lg overflow-hidden">
                    {actionsLoading ? (
                      <div className="p-3 text-[11px] text-slate-400 animate-pulse">Loading actions…</div>
                    ) : siteActions.length === 0 ? (
                      <div className="p-3 text-[11px] text-slate-400">No open actions for this site</div>
                    ) : (() => {
                      const query = (actionSearch[upload.id] ?? '').toLowerCase();
                      const filtered = siteActions.filter(a =>
                        !query || (a.source_document_name ?? '').toLowerCase().includes(query)
                      );
                      const groups: Record<string, SiteAction[]> = {};
                      for (const a of filtered) {
                        const doc = a.source_document_name ?? 'No document';
                        if (!groups[doc]) groups[doc] = [];
                        groups[doc].push(a);
                      }
                      return (
                        <>
                          <div className="p-1.5 bg-slate-50 border-b border-slate-200">
                            <input
                              type="text"
                              placeholder="Search by document name…"
                              value={actionSearch[upload.id] ?? ''}
                              onChange={e => setActionSearch(prev => ({ ...prev, [upload.id]: e.target.value }))}
                              className="w-full text-[11px] px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                              autoFocus
                            />
                          </div>
                          <div className="max-h-52 overflow-y-auto">
                            {filtered.length === 0 ? (
                              <p className="p-3 text-[11px] text-slate-400 text-center">No actions match</p>
                            ) : Object.entries(groups).map(([docName, actions]) => {
                              const isOpen = query ? true : expandedDocName[upload.id] === docName;
                              return (
                                <div key={docName}>
                                  <button
                                    className="w-full px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-[10px] font-black text-slate-700 uppercase tracking-wider sticky top-0 flex items-center gap-1.5 transition-colors"
                                    onClick={() => setExpandedDocName(prev => ({ ...prev, [upload.id]: prev[upload.id] === docName ? null : docName }))}
                                  >
                                    <ChevronRight size={10} className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                                    <span className="flex-1 text-left truncate" title={docName}>{docName}</span>
                                    <span className="text-slate-400 font-normal normal-case tracking-normal">{actions.length}</span>
                                  </button>
                                  {isOpen && actions.map(a => (
                                    <button
                                      key={a.id}
                                      onClick={() => {
                                        setPendingActions(prev => ({ ...prev, [upload.id]: a.id }));
                                        setAcknowledgedSet(prev => new Set(prev).add(upload.id));
                                        setLinkExpanded(prev => ({ ...prev, [upload.id]: false }));
                                      }}
                                      className={`w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-indigo-50 transition-colors border-b border-slate-50 last:border-b-0 ${pendingActions[upload.id] === a.id ? 'bg-violet-50' : ''}`}
                                    >
                                      {a.hazard_ref && (
                                        <span className="bg-slate-200 text-slate-600 text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5">{a.hazard_ref}</span>
                                      )}
                                      <span className="flex-1 text-[11px] text-slate-700 leading-snug">{a.title}</span>
                                      {a.due_date && (
                                        <span className="text-[10px] text-slate-400 flex-shrink-0 mt-0.5">{a.due_date}</span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Action button row */}
              <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/40 flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => { setLinkExpanded(prev => ({ ...prev, [upload.id]: !prev[upload.id] })); fetchActions(); }}
                  className={`flex items-center gap-1 border rounded-lg text-[10px] font-black px-2.5 py-1 transition-colors ${pendingActions[upload.id] ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-300'}`}
                >
                  {pendingActions[upload.id] ? (() => { const a = siteActions.find(x => x.id === pendingActions[upload.id]); return <>✓ {a ? `${a.hazard_ref ? `[${a.hazard_ref}] ` : ''}${a.title}` : 'Action linked'}</>; })() : 'Link to action'}
                </button>
                <button
                  onClick={() => setAcknowledgedSet(prev => { const s = new Set(prev); if (s.has(upload.id)) s.delete(upload.id); else s.add(upload.id); return s; })}
                  className={`border rounded-lg text-[10px] font-black px-2.5 py-1 transition-colors ${acknowledgedSet.has(upload.id) ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'border-slate-300 text-slate-500 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700'}`}
                >{acknowledgedSet.has(upload.id) ? '✓ Acknowledged' : 'Acknowledge'}</button>
                <button onClick={() => handleOpen(upload)} className="flex items-center gap-1 border border-slate-200 text-slate-500 rounded-lg text-[10px] font-black px-2.5 py-1 hover:bg-slate-100 transition-colors"><ExternalLink size={10} />Open</button>
                {!noteExpanded[upload.id] && (
                  <button onClick={() => setNoteExpanded(prev => ({ ...prev, [upload.id]: true }))} className="flex items-center gap-1 border border-slate-200 text-slate-500 rounded-lg text-[10px] font-black px-2.5 py-1 hover:bg-slate-100 transition-colors">+ Note</button>
                )}
                <button
                  onClick={() => setRejectExpanded(prev => ({ ...prev, [upload.id]: !prev[upload.id] }))}
                  className={`flex items-center gap-1 border rounded-lg text-[10px] font-black px-2.5 py-1 transition-colors ${rejectExpanded[upload.id] ? 'bg-rose-50 border-rose-300 text-rose-700' : 'border-rose-200 text-rose-500 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700'}`}
                >Return</button>
                <button
                  onClick={async () => {
                    await fetch(`/api/client-uploads/${upload.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'hide' }) });
                    remove(upload.id);
                  }}
                  title="Hide from list"
                  className="flex items-center gap-1 border border-slate-200 rounded-lg text-[10px] font-black px-2.5 py-1 text-slate-400 hover:text-slate-600 hover:bg-white transition-colors"
                ><EyeOff size={10} />Hide</button>
                <button
                  onClick={() => handleSubmit(upload.id)}
                  disabled={!acknowledgedSet.has(upload.id)}
                  className="ml-auto border rounded-lg text-[10px] font-black px-2.5 py-1 transition-colors bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed"
                >Submit</button>
              </div>
            </div>
          ))}

          {/* ── Section 2: Client Managed Documents (site_documents, informational) ── */}
          {!loading && (
            <div className="px-5 py-2.5 bg-amber-50 border-t border-b border-amber-200 flex items-center gap-2 sticky top-0 z-10">
              <FileText size={12} className="text-amber-500 flex-shrink-0" />
              <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Client Managed Documents</span>
              <span className="text-[10px] text-amber-600">— client's own uploads, no action required</span>
              {clientDocs.filter(d => !dismissedDocs.has(d.id)).length > 0 && <span className="ml-auto text-[10px] font-black bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">{clientDocs.filter(d => !dismissedDocs.has(d.id)).length} file{clientDocs.filter(d => !dismissedDocs.has(d.id)).length !== 1 ? 's' : ''}</span>}
            </div>
          )}
          {!loading && clientDocs.filter(d => !dismissedDocs.has(d.id)).length === 0 && (
            <div className="px-5 py-4 text-[11px] text-slate-400">No client managed documents</div>
          )}
          {!loading && clientDocs.filter(d => !dismissedDocs.has(d.id)).length > 0 && (
            <>
              {clientDocs.filter(d => !dismissedDocs.has(d.id)).map(doc => (
                <div key={doc.id} className="p-5 border-b border-amber-100 last:border-b-0 bg-amber-50/40 hover:bg-amber-50/70 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <FileText size={12} className="text-amber-400 flex-shrink-0" />
                        <span className="text-xs font-black text-slate-700 truncate">{doc.document_name || doc.file_name}</span>
                        {doc.file_size_bytes && <span className="text-[10px] text-slate-400">{(doc.file_size_bytes / 1024).toFixed(0)} KB</span>}
                        <span className="text-[10px] text-slate-400">{new Date(doc.created_at).toLocaleDateString('en-GB')}</span>
                        <span className="text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">Client Managed</span>
                      </div>
                      <p className="text-[11px] text-slate-500">Uploaded by: <span className="font-bold">{doc.uploaderName}</span></p>
                      <p className="text-[11px] text-amber-700/80 italic">This document is owned and managed by the client — no advisor action needed.</p>
                    </div>
                    <button
                      onClick={() => setDismissedDocs(prev => new Set(prev).add(doc.id))}
                      title="Dismiss from this view"
                      className="border border-slate-200 rounded-lg text-[10px] font-black px-2.5 py-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1 flex-shrink-0"
                    ><X size={10} />Dismiss</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex justify-end flex-shrink-0 rounded-b-xl">
          <button onClick={onClose} className="px-5 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>
  );
};

const AiSuggestionsPanel = ({ siteId, siteName, onClose, onCountChange, onActionAccepted }: {
  siteId: string;
  siteName: string;
  onClose: () => void;
  onCountChange: (remaining: number) => void;
  onActionAccepted: (action: any) => void;
}) => {
  type Suggestion = {
    id: string; title: string; hazard_ref: string | null; hazard: string | null;
    existing_controls: string | null; risk_level: string | null; risk_rating: string | null;
    source_document_name: string; source_document_id: string | null; source_folder_path: string | null;
    due_date: string | null; responsible_person: string | null; issue_date: string | null; regulation: string | null;
  };
  type ItemEdits = { title: string; risk_level: string; due_date: string; responsible_person: string };
  type DocGroup = { docName: string; items: Suggestion[] };

  const [groups, setGroups] = useState<DocGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemEdits, setItemEdits] = useState<Record<string, ItemEdits>>({});
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [allSkipped, setAllSkipped] = useState(false);
  const [resolveExpanded, setResolveExpanded] = useState<Record<string, boolean>>({});
  const [resolveDates, setResolveDates] = useState<Record<string, string>>({});
  const titleRefs = useRef<Record<string, HTMLTextAreaElement>>({});
  type LogEntry = { action: 'accepted' | 'resolved' | 'skipped' | 'rejected'; docName: string; title: string };
  const [sessionLog, setSessionLog] = useState<LogEntry[]>([]);
  const [logExpanded, setLogExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [existingCounts, setExistingCounts] = useState<Record<string, number>>({});
  const [dbCount, setDbCount] = useState(0);

  const totalRemaining = allSkipped ? 0 : groups.reduce((s, g) => s + g.items.filter(i => !skipped.has(i.id)).length, 0);

  useEffect(() => { onCountChange(dbCount); }, [dbCount]);

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: existingData }] = await Promise.all([
      supabase.from('actions')
        .select('id, title, hazard_ref, hazard, existing_controls, risk_level, risk_rating, source_document_name, source_document_id, source_folder_path, due_date, responsible_person, issue_date, regulation')
        .eq('site_id', siteId).eq('status', 'ai_suggested').order('source_document_name'),
      supabase.from('actions')
        .select('source_document_name')
        .eq('site_id', siteId).neq('status', 'ai_suggested').neq('status', 'rejected'),
    ]);
    const map = new Map<string, Suggestion[]>();
    const edits: Record<string, ItemEdits> = {};
    for (const a of (data ?? [])) {
      const doc = a.source_document_name ?? 'Unknown document';
      if (!map.has(doc)) map.set(doc, []);
      map.get(doc)!.push(a as Suggestion);
      edits[a.id] = { title: a.title, risk_level: a.risk_level ?? '', due_date: a.due_date ?? '', responsible_person: a.responsible_person ?? '' };
    }
    const counts: Record<string, number> = {};
    for (const a of (existingData ?? [])) {
      const doc = a.source_document_name ?? 'Unknown document';
      counts[doc] = (counts[doc] ?? 0) + 1;
    }
    const sortHazardRef = (a: string | null, b: string | null) => {
      const numA = a && /^\d+$/.test(a.trim()) ? parseInt(a.trim(), 10) : Infinity;
      const numB = b && /^\d+$/.test(b.trim()) ? parseInt(b.trim(), 10) : Infinity;
      if (numA !== numB) return numA - numB;
      return (a ?? '').localeCompare(b ?? '');
    };
    const newGroups = Array.from(map.entries()).map(([docName, items]) => ({
      docName,
      items: items.sort((a, b) => sortHazardRef(a.hazard_ref, b.hazard_ref)),
    }));
    setGroups(newGroups);
    setItemEdits(edits);
    setExistingCounts(counts);
    setCollapsed(Object.fromEntries(newGroups.map(g => [g.docName, true])));
    setDbCount(data?.length ?? 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const remove = (id: string) => {
    setDbCount(prev => Math.max(0, prev - 1));
    setGroups(prev => {
      const next = prev.map(g => ({ ...g, items: g.items.filter(i => i.id !== id) })).filter(g => g.items.length > 0);
      return next;
    });
  };

  const getItemInfo = (id: string) => {
    for (const g of groups) {
      const item = g.items.find(i => i.id === id);
      if (item) return { docName: g.docName, title: itemEdits[id]?.title || item.title };
    }
    return null;
  };

  const accept = async (id: string) => {
    setWorking(prev => new Set([...prev, id]));
    const edits = itemEdits[id];
    const info = getItemInfo(id);
    const updates: Record<string, any> = { status: 'open', is_suggested: false };
    let finalTitle = info?.title ?? '';
    if (edits) {
      const titleVal = titleRefs.current[id]?.value ?? edits.title;
      if (titleVal) { updates.title = titleVal; finalTitle = titleVal; }
      if (edits.risk_level) updates.risk_level = edits.risk_level;
      updates.due_date = edits.due_date || null;
      updates.responsible_person = edits.responsible_person || null;
    }
    const { error, data } = await supabase.from('actions').update(updates).eq('id', id).select().single();
    if (!error && data) {
      if (info) setSessionLog(prev => [...prev, { action: 'accepted', docName: info.docName, title: finalTitle }]);
      onActionAccepted(data); remove(id);
    }
    setWorking(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const markResolved = async (id: string) => {
    setWorking(prev => new Set([...prev, id]));
    const info = getItemInfo(id);
    const resolvedDate = resolveDates[id] ?? new Date().toISOString().slice(0, 10);
    await supabase.from('actions').update({ status: 'resolved', is_suggested: false, resolved_date: resolvedDate }).eq('id', id);
    if (info) setSessionLog(prev => [...prev, { action: 'resolved', docName: info.docName, title: info.title }]);
    remove(id);
    setWorking(prev => { const n = new Set(prev); n.delete(id); return n; });
    setResolveExpanded(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const reject = async (id: string) => {
    setWorking(prev => new Set([...prev, id]));
    const info = getItemInfo(id);
    await supabase.from('actions').delete().eq('id', id);
    if (info) setSessionLog(prev => [...prev, { action: 'rejected', docName: info.docName, title: info.title }]);
    remove(id);
    setWorking(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const skip = (id: string) => {
    const info = getItemInfo(id);
    if (info) setSessionLog(prev => [...prev, { action: 'skipped', docName: info.docName, title: info.title }]);
    setSkipped(prev => new Set([...prev, id]));
  };

  const acceptAll = async (docName: string) => {
    const group = groups.find(g => g.docName === docName);
    if (!group) return;
    for (const item of group.items) if (!skipped.has(item.id)) await accept(item.id);
  };

  const resolveAll = async (docName: string) => {
    const group = groups.find(g => g.docName === docName);
    if (!group) return;
    const today = new Date().toISOString().slice(0, 10);
    for (const item of group.items) if (!skipped.has(item.id)) {
      setWorking(prev => new Set([...prev, item.id]));
      await supabase.from('actions').update({ status: 'resolved', is_suggested: false, resolved_date: resolveDates[item.id] ?? today }).eq('id', item.id);
      remove(item.id);
      setWorking(prev => { const n = new Set(prev); n.delete(item.id); return n; });
    }
  };

  const skipAll = (docName: string) => {
    const group = groups.find(g => g.docName === docName);
    if (!group) return;
    setSkipped(prev => new Set([...prev, ...group.items.map(i => i.id)]));
  };

  const rejectAll = async (docName: string) => {
    const group = groups.find(g => g.docName === docName);
    if (!group) return;
    for (const item of group.items) if (!skipped.has(item.id)) await reject(item.id);
  };

  const updateEdit = (id: string, field: keyof ItemEdits, value: string) => {
    setItemEdits(prev => ({ ...prev, [id]: { ...(prev[id] ?? { title: '', risk_level: '', due_date: '', responsible_person: '' }), [field]: value } }));
  };

  const riskCls = (level: string | null | undefined) =>
    level === 'HIGH' ? 'bg-rose-100 text-rose-700 border-rose-200' :
    level === 'MEDIUM' ? 'bg-amber-100 text-amber-700 border-amber-200' :
    level === 'LOW' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
    'bg-slate-100 text-slate-600 border-slate-200';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-[90vw] flex flex-col max-h-[92vh]">
      {/* Header — violet to match existing advisor panel */}
      <div className="bg-violet-600 px-6 py-4 flex items-center justify-between flex-shrink-0 rounded-t-xl">
        <div>
          <h2 className="font-black text-white text-sm uppercase tracking-widest flex items-center gap-2">
            <Sparkles size={14} />AI Extracted Actions
            {totalRemaining > 0 && <span className="bg-white/20 text-white text-[10px] font-black px-2 py-0.5 rounded-full">{totalRemaining}</span>}
          </h2>
          <p className="text-violet-200 text-[11px] mt-0.5">{siteName} — review and accept, resolve, skip or reject each suggestion</p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && groups.length > 1 && (
            <>
              <button onClick={() => setCollapsed(Object.fromEntries(groups.map(g => [g.docName, true])))} className="px-3 py-1.5 border border-violet-400 text-violet-100 rounded-lg text-[11px] font-black hover:bg-violet-500 transition-colors">Collapse all</button>
              <button onClick={() => setCollapsed({})} className="px-3 py-1.5 border border-violet-400 text-violet-100 rounded-lg text-[11px] font-black hover:bg-violet-500 transition-colors">Expand all</button>
            </>
          )}
          {!loading && totalRemaining > 0 && (
            <button
              onClick={() => setAllSkipped(true)}
              title="Hide all suggestions for this session — no portal changes saved"
              className="px-3 py-1.5 border border-violet-400 text-violet-100 rounded-lg text-[11px] font-black hover:bg-violet-500 transition-colors">
              Skip all
            </button>
          )}
          <button onClick={onClose} title="Close panel" className="text-violet-200 hover:text-white"><X size={18} /></button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && <div className="p-8 text-center text-sm font-bold text-slate-400 animate-pulse">Loading suggestions…</div>}
        {!loading && groups.length === 0 && (
          <div className="p-12 text-center">
            <CheckCircle size={32} className="text-emerald-400 mx-auto mb-3" />
            <p className="font-black text-slate-700 text-sm">All suggestions reviewed</p>
            <p className="text-sm text-slate-400 mt-1">Accepted actions are now in the main list.</p>
          </div>
        )}
        {!loading && groups.map(group => {
          const visibleItems = allSkipped ? [] : group.items.filter(i => !skipped.has(i.id));
          if (!visibleItems.length) return null;
          return (
            <div key={group.docName} className="border-b border-slate-200 last:border-b-0">
              {/* Doc group header */}
              <div
                className="bg-slate-200 border-b border-slate-300 flex items-center cursor-pointer select-none hover:bg-slate-250 transition-colors"
                onClick={() => setCollapsed(prev => ({ ...prev, [group.docName]: !prev[group.docName] }))}>
                <div className="flex items-center gap-2 flex-1 px-5 py-2.5 min-w-0">
                  {collapsed[group.docName] ? <ChevronRight size={12} className="text-slate-400 flex-shrink-0" /> : <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />}
                  <FileText size={11} className="text-violet-500 flex-shrink-0" />
                  <span className="text-[11px] font-black text-slate-700 truncate">{group.docName}</span>
                  <span className="text-[10px] font-bold text-slate-500 flex-shrink-0">{visibleItems.length} to review</span>
                  {existingCounts[group.docName] > 0 && (
                    <span className="text-[10px] font-bold text-emerald-600 flex-shrink-0">{existingCounts[group.docName]} already added</span>
                  )}
                </div>
                {!collapsed[group.docName] && (
                  <div className="flex items-center gap-2 pr-5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <button onClick={() => acceptAll(group.docName)} title="Add all actions to the portal" className="border border-slate-300 rounded-lg text-[10px] font-black px-2.5 py-1 text-slate-500 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 transition-colors">Accept all</button>
                    <button onClick={() => resolveAll(group.docName)} title="Mark all actions as resolved in the portal (docs unaffected)" className="border border-slate-300 rounded-lg text-[10px] font-black px-2.5 py-1 text-slate-500 hover:bg-slate-100 hover:border-slate-400 hover:text-slate-700 transition-colors">Resolve all</button>
                    <button onClick={() => skipAll(group.docName)} title="Hide all for this session — no portal changes saved" className="border border-slate-300 rounded-lg text-[10px] font-black px-2.5 py-1 text-slate-500 hover:bg-slate-100 hover:border-slate-400 hover:text-slate-700 transition-colors">Skip all</button>
                    <button onClick={() => rejectAll(group.docName)} title="Permanently delete all actions from the portal (docs unaffected)" className="border border-slate-300 rounded-lg text-[10px] font-black px-2.5 py-1 text-slate-500 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600 transition-colors">Reject all</button>
                  </div>
                )}
              </div>

              {/* Items */}
              {!collapsed[group.docName] && visibleItems.map(item => {
                const edits = itemEdits[item.id] ?? { title: item.title, risk_level: item.risk_level ?? '', due_date: item.due_date ?? '', responsible_person: item.responsible_person ?? '' };
                return (
                  <div key={item.id} className={`p-5 transition-colors hover:bg-slate-50 border-b border-slate-300 last:border-b-0 ${working.has(item.id) ? 'opacity-40 pointer-events-none' : ''}`}>
                    <div className="flex gap-4 items-start">
                      <div className="flex-1 min-w-0 space-y-2">
                        {/* Per-item breadcrumb: doc name + open link | Hazard No | Issued | Due */}
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 pb-2 border-b border-slate-100">
                          <span className="text-[11px] font-black text-slate-600">{item.source_document_name}</span>
                          {item.hazard_ref && <><span className="text-slate-300 text-[10px]">|</span><span className="text-[10px] font-bold text-slate-500">Hazard No. {item.hazard_ref}</span></>}
                          {item.issue_date && <><span className="text-slate-300 text-[10px]">|</span><span className="text-[10px] font-bold text-slate-400">Issued: {fmtDate(item.issue_date)}</span></>}
                          {edits.due_date && <><span className="text-slate-300 text-[10px]">|</span><span className="text-[10px] font-bold text-slate-400">Due: {fmtDate(edits.due_date)}</span></>}
                        </div>
                        {/* Hazard description + existing controls with column layout */}
                        {(item.hazard || item.existing_controls) && (
                          <div className="space-y-2 pl-1">
                            {item.hazard && (
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-700 mb-0.5">Hazard</p>
                                {formatExtractedText(item.hazard)}
                              </div>
                            )}
                            {item.existing_controls && (
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-700 mb-0.5">Existing Measures</p>
                                {formatExtractedText(item.existing_controls)}
                              </div>
                            )}
                          </div>
                        )}
                        {/* Action textarea — always editable */}
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-700">Action Required<span className="font-normal normal-case text-slate-400"> — editable</span></span>
                          <textarea
                            ref={el => { if (el) { titleRefs.current[item.id] = el; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                            defaultValue={edits.title}
                            onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                            rows={1}
                            className="w-full text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none overflow-hidden bg-white"
                          />
                        </div>
                        {/* Controls row */}
                        <div className="flex flex-wrap gap-3 items-end">
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 pl-3">Due Date</span>
                            <input
                              type="date"
                              value={edits.due_date}
                              onChange={e => updateEdit(item.id, 'due_date', e.target.value)}
                              className={`px-3 py-1.5 border rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 bg-white ${!edits.due_date ? 'border-amber-300 focus:ring-amber-200' : 'border-slate-200 focus:ring-violet-300'}`}
                            />
                            {!edits.due_date && <span className="text-[10px] text-amber-500 pl-3">No date found — check document</span>}
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 pl-3">Responsible Person</span>
                            <input
                              type="text"
                              value={edits.responsible_person}
                              onChange={e => updateEdit(item.id, 'responsible_person', e.target.value)}
                              placeholder="e.g. Site Manager"
                              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white w-44"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 pl-3">Risk Rating</span>
                            <select
                              value={edits.risk_level}
                              onChange={e => updateEdit(item.id, 'risk_level', e.target.value)}
                              className={`px-3 py-1.5 border rounded-lg text-xs font-black focus:outline-none focus:ring-2 focus:ring-violet-300 ${riskCls(edits.risk_level || null)}`}
                            >
                              <option value="">— not set</option>
                              <option value="HIGH">High</option>
                              <option value="MEDIUM">Medium</option>
                              <option value="LOW">Low</option>
                            </select>
                          </div>
                        </div>
                        {/* AI suggestion card */}
                        {(item.risk_rating || item.regulation) && (
                          <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap gap-y-1">
                              <span className="text-[10px] font-black uppercase tracking-wider text-violet-500 flex items-center gap-1.5"><Sparkles size={10} />AI Suggestion</span>
                              {item.risk_rating && (
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${riskCls(item.risk_level)}`}>Risk: {item.risk_rating}</span>
                              )}
                            </div>
                            {item.risk_level && <p className="text-[11px] text-slate-600"><span className="font-black">Risk Level:</span> {item.risk_level}</p>}
                            {item.regulation && <p className="text-[11px] text-slate-600"><span className="font-black">Regulation:</span> {item.regulation}</p>}
                          </div>
                        )}
                        {/* Already resolved expansion */}
                        {resolveExpanded[item.id] && (
                          <div className="mt-1 pt-3 border-t border-slate-100 space-y-3">
                            <p className="text-[11px] font-black text-slate-600">Mark as already resolved</p>
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Resolved date</span>
                              <input type="date" value={resolveDates[item.id] ?? new Date().toISOString().slice(0, 10)} onChange={e => setResolveDates(prev => ({ ...prev, [item.id]: e.target.value }))} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white w-fit" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => markResolved(item.id)} className="px-4 py-1.5 bg-emerald-600 text-white rounded-xl text-[11px] font-black hover:bg-emerald-700">Confirm resolved</button>
                              <button onClick={() => setResolveExpanded(prev => ({ ...prev, [item.id]: false }))} className="px-4 py-1.5 border border-rose-200 text-rose-500 rounded-xl text-[11px] font-black hover:bg-rose-50 hover:border-rose-300">Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                      {/* Button column */}
                      <div className="flex-shrink-0 flex flex-col gap-2">
                        <button onClick={() => accept(item.id)} title="Add this action to the portal" className="px-4 py-1.5 bg-violet-600 text-white rounded-xl text-[11px] font-black hover:bg-violet-700">Accept</button>
                        <button onClick={() => { setResolveExpanded(prev => ({ ...prev, [item.id]: !prev[item.id] })); if (!resolveDates[item.id]) setResolveDates(prev => ({ ...prev, [item.id]: new Date().toISOString().slice(0, 10) })); }} title="Already completed — add as resolved in the portal (doc unaffected)" className={`border rounded-xl text-[11px] font-black px-3 py-1.5 transition-colors ${resolveExpanded[item.id] ? 'bg-slate-100 border-slate-300 text-slate-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:border-slate-300'}`}>Already Resolved</button>
                        <button onClick={() => skip(item.id)} title="Hide for now — no portal changes saved. Reappears next session." className="px-3 py-1.5 border border-slate-300 text-slate-600 rounded-xl text-[11px] font-black hover:bg-slate-50 hover:border-slate-400 flex items-center gap-1 justify-center"><ChevronRight size={10} />Skip</button>
                        <button onClick={() => reject(item.id)} title="Permanently delete from the portal (doc unaffected)" className="px-3 py-1.5 border border-rose-200 text-rose-600 rounded-xl text-[11px] font-black hover:bg-rose-50 flex items-center gap-1 justify-center"><Trash2 size={10} />Reject</button>
                        {item.source_document_id && (() => {
                          const basePath = typeof window !== 'undefined' ? (localStorage.getItem('dattoBasePath') || 'W:/Customer Documents') : 'W:/Customer Documents';
                          const uri = item.source_folder_path ? buildOfficeUri(basePath, item.source_folder_path, item.source_document_name) : null;
                          const href = uri ?? `/api/datto/file?fileId=${item.source_document_id}&fileName=${encodeURIComponent(item.source_document_name)}`;
                          return (
                            <a href={href} target={uri ? '_self' : '_blank'} rel="noopener noreferrer" className="px-3 py-1.5 border border-indigo-200 text-indigo-500 rounded-xl text-[11px] font-black hover:bg-indigo-50 hover:border-indigo-300 flex items-center gap-1 justify-center" title="Open source document locally">
                              <ExternalLink size={10} />Open doc
                            </a>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {!loading && (
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-4 flex-shrink-0 rounded-b-xl space-y-3">
          {sessionLog.length > 0 && (() => {
            const counts = { accepted: 0, resolved: 0, skipped: 0, rejected: 0 };
            for (const e of sessionLog) counts[e.action]++;
            const chips: { label: string; cls: string }[] = [
              counts.accepted > 0 ? { label: `${counts.accepted} accepted`, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' } : null,
              counts.resolved > 0 ? { label: `${counts.resolved} resolved`, cls: 'text-blue-700 bg-blue-50 border-blue-200' } : null,
              counts.skipped > 0 ? { label: `${counts.skipped} skipped`, cls: 'text-slate-600 bg-slate-100 border-slate-200' } : null,
              counts.rejected > 0 ? { label: `${counts.rejected} rejected`, cls: 'text-rose-700 bg-rose-50 border-rose-200' } : null,
            ].filter(Boolean) as { label: string; cls: string }[];
            return (
              <div>
                <button onClick={() => setLogExpanded(v => !v)} className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Session summary</span>
                  {chips.map(c => <span key={c.label} className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${c.cls}`}>{c.label}</span>)}
                  <ChevronDown size={11} className={`text-slate-400 transition-transform ${logExpanded ? '' : '-rotate-90'}`} />
                </button>
                {logExpanded && (
                  <div className="space-y-0.5 max-h-36 overflow-y-auto pr-1">
                    {sessionLog.map((e, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px]">
                        <span className={`flex-shrink-0 font-black w-16 ${e.action === 'accepted' ? 'text-emerald-600' : e.action === 'resolved' ? 'text-blue-600' : e.action === 'skipped' ? 'text-slate-400' : 'text-rose-600'}`}>{e.action}</span>
                        <span className="text-slate-600 truncate flex-1" title={e.title}>{e.title}</span>
                        <span className="text-slate-400 text-[10px] flex-shrink-0 truncate max-w-[160px]" title={e.docName}>{e.docName}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          <div className="flex items-center justify-between">
            {groups.length > 0
              ? <span className="text-[11px] font-bold text-slate-400">{totalRemaining} remaining{(() => { const n = allSkipped ? groups.reduce((s, g) => s + g.items.length, 0) : skipped.size; return n > 0 ? ` · ${n} skipped` : ''; })()}</span>
              : <span className="text-[11px] font-bold text-slate-400">All suggestions reviewed</span>
            }
            <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-slate-50">Close</button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

const SyncProgressModal = ({ sites, onClose, onMinimise, onViewSite }: {
  sites: { id: string; name: string }[];
  onClose: () => void;
  onMinimise?: () => void;
  onViewSite: (siteId: string) => void;
}) => {
  type DocLine = { siteName: string; docName: string; status: 'processing' | 'done' | 'error' | 'skipped'; newSuggestions: number; error?: string; skipped?: string };
  const [phase, setPhase] = useState<'pick' | 'running' | 'done' | 'error'>('pick');
  const [forceAll, setForceAll] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [docs, setDocs] = useState<DocLine[]>([]);
  const [summary, setSummary] = useState<{ processed: number; newSuggestions: number; updated: number; sitesWithSuggestions: { id: string; name: string; count: number }[] }>({ processed: 0, newSuggestions: 0, updated: 0, sitesWithSuggestions: [] });
  const [errorMsg, setErrorMsg] = useState('');
  const docsEndRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<(() => void) | null>(null);

  useEffect(() => { docsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [docs.length]);

  const startSync = async (force: boolean) => {
    setPhase('running');
    setStatusMsg('Connecting…');
    let cancelled = false;
    runRef.current = () => { cancelled = true; };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setPhase('error'); setErrorMsg('Not authenticated'); return; }
      let totalProcessed = 0; let totalNewSuggestions = 0; let totalUpdated = 0;
      const sitesWithSuggestions: { id: string; name: string; count: number }[] = [];

      for (const site of sites) {
        if (cancelled) break;
        setStatusMsg(`Connecting to ${site.name}…`);
        let siteNewSuggestions = 0;
        try {
          const res = await fetch('/api/sync/site', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId: site.id, forceAll: force }),
          });
          if (!res.ok || !res.body) { setDocs(prev => [...prev, { siteName: site.name, docName: site.name, status: 'error', newSuggestions: 0, error: `HTTP ${res.status}` }]); continue; }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          while (true) {
            if (cancelled) { reader.cancel(); break; }
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\n'); buf = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const e = JSON.parse(line) as any;
                if (e.type === 'scan') setStatusMsg(`Scanning ${e.siteName}…`);
                else if (e.type === 'docs_found') setStatusMsg(`${e.siteName}: ${e.count} document${e.count !== 1 ? 's' : ''} to process`);
                else if (e.type === 'doc_start') {
                  setStatusMsg(`${e.siteName}: ${e.docName} (${e.index + 1}/${e.total})`);
                  setDocs(prev => prev.some(d => d.siteName === e.siteName && d.docName === e.docName) ? prev : [...prev, { siteName: e.siteName, docName: e.docName, status: 'processing', newSuggestions: 0 }]);
                } else if (e.type === 'doc_done') {
                  const n = e.newPending ?? 0;
                  siteNewSuggestions += n; totalNewSuggestions += n; totalUpdated += e.updated ?? 0;
                  const docStatus = e.error ? 'error' : e.skipped ? 'skipped' : 'done';
                  setDocs(prev => prev.map(d => d.siteName === e.siteName && d.docName === e.docName ? { ...d, status: docStatus, newSuggestions: n, error: e.error, skipped: e.skipped } : d));
                  setSummary(prev => ({ ...prev, processed: totalProcessed, newSuggestions: totalNewSuggestions, updated: totalUpdated }));
                } else if (e.type === 'site_done') {
                  totalProcessed += e.processed ?? 0;
                }
              } catch { /* malformed */ }
            }
          }
        } catch { /* site failed */ }
        if (siteNewSuggestions > 0) sitesWithSuggestions.push({ id: site.id, name: site.name, count: siteNewSuggestions });
        setSummary({ processed: totalProcessed, newSuggestions: totalNewSuggestions, updated: totalUpdated, sitesWithSuggestions: [...sitesWithSuggestions] });
      }
      if (!cancelled) { setPhase('done'); setStatusMsg('Sync complete'); }
    } catch (err: any) {
      if (!cancelled) { setPhase('error'); setErrorMsg(err.message); }
    }
  };

  const isMultiSite = sites.length > 1;
  const siteLabel = isMultiSite ? `${sites.length} sites` : sites[0]?.name;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="bg-violet-600 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-black text-white text-sm uppercase tracking-widest flex items-center gap-2">
              <RefreshCw size={14} className={phase === 'running' ? 'animate-spin' : ''} />
              AI Sync{isMultiSite ? ` — ${sites.length} Sites` : ''}
            </h2>
            <p className="text-violet-200 text-[11px] mt-0.5">{isMultiSite ? sites.map(s => s.name).join(', ').slice(0, 60) + (sites.map(s => s.name).join(', ').length > 60 ? '…' : '') : sites[0]?.name}</p>
          </div>
          {phase === 'running'
            ? <button onClick={onMinimise} className="text-violet-200 hover:text-white" title="Minimise — sync continues in background"><Minus size={18} /></button>
            : <button onClick={onClose} className="text-violet-200 hover:text-white" title="Close"><X size={18} /></button>
          }
        </div>

        {/* Mode picker */}
        {phase === 'pick' && (
          <div className="p-6 space-y-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Choose sync mode for {siteLabel}</p>
            <div className="space-y-3">
              <button
                onClick={() => setForceAll(false)}
                className={`w-full text-left px-4 py-4 rounded-xl border-2 transition-all ${!forceAll ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${!forceAll ? 'border-violet-500' : 'border-slate-300'}`}>
                    {!forceAll && <div className="w-2 h-2 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-800">Incremental sync</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">Only processes documents that are new or have been modified since the last sync. Fast and inexpensive — use for routine updates after uploading new risk assessments.</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => setForceAll(true)}
                className={`w-full text-left px-4 py-4 rounded-xl border-2 transition-all ${forceAll ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${forceAll ? 'border-violet-500' : 'border-slate-300'}`}>
                    {forceAll && <div className="w-2 h-2 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-800">Full re-sync <span className="text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded ml-1">Slower</span></p>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">Reprocesses every document in the configured folders, regardless of when it was last synced. Use when setting up a site for the first time, after changing folder configuration, or if a previous sync produced incorrect results.</p>
                  </div>
                </div>
              </button>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-slate-50" title="Cancel without syncing">Cancel</button>
              <button onClick={() => startSync(forceAll)} className="flex-1 px-4 py-2.5 bg-violet-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-700 flex items-center justify-center gap-2" title="Run AI sync now">
                <RefreshCw size={12} />Start Sync
              </button>
            </div>
          </div>
        )}

        {/* Progress */}
        {phase !== 'pick' && (
          <>
            <div className={`px-6 py-2.5 text-[11px] font-bold flex-shrink-0 ${phase === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-violet-50 text-violet-700'} border-b border-violet-100`}>
              {phase === 'error' ? errorMsg : statusMsg}
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
              {docs.map((doc, i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-2.5">
                  <span className="flex-shrink-0 w-3.5">
                    {doc.status === 'processing' && <RefreshCw size={12} className="text-violet-400 animate-spin" />}
                    {doc.status === 'done' && <CheckCircle size={12} className="text-emerald-500" />}
                    {doc.status === 'error' && <AlertCircle size={12} className="text-rose-500" />}
                    {doc.status === 'skipped' && <span className="text-slate-300 text-[10px] leading-none">—</span>}
                  </span>
                  <span className={`flex-1 min-w-0 text-xs truncate ${doc.status === 'error' ? 'text-rose-600' : doc.status === 'skipped' ? 'text-slate-400' : 'text-slate-600'}`}>
                    {isMultiSite && <span className="text-slate-400 mr-1">{doc.siteName}:</span>}{doc.docName}
                  </span>
                  {doc.status === 'done' && doc.newSuggestions > 0 && (
                    <span className="text-[10px] font-black text-violet-600 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded-full flex-shrink-0">+{doc.newSuggestions}</span>
                  )}
                  {doc.status === 'skipped' && doc.skipped && (
                    <span className="text-[10px] text-slate-400 flex-shrink-0 max-w-[140px] truncate" title={doc.skipped}>{doc.skipped}</span>
                  )}
                  {doc.status === 'error' && doc.error && (
                    <span className="text-[10px] text-rose-500 flex-shrink-0 max-w-[120px] truncate" title={doc.error}>{doc.error}</span>
                  )}
                </div>
              ))}
              {phase === 'running' && docs.length === 0 && (
                <div className="px-6 py-4 text-[11px] text-slate-400 font-bold animate-pulse">Scanning folders…</div>
              )}
              <div ref={docsEndRef} />
            </div>
            <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
              <div className="text-[11px] text-slate-500 font-bold">
                {summary.processed > 0 && <span>{summary.processed} doc{summary.processed !== 1 ? 's' : ''} processed</span>}
                {summary.newSuggestions > 0 && <span className="text-violet-700 ml-1">· {summary.newSuggestions} new suggestion{summary.newSuggestions !== 1 ? 's' : ''}</span>}
                {summary.updated > 0 && <span className="text-slate-400 ml-1">· {summary.updated} updated</span>}
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                {phase === 'done' && summary.sitesWithSuggestions.map(s => (
                  <button key={s.id} onClick={() => { onViewSite(s.id); onClose(); }} className="px-4 py-2 bg-violet-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-700" title="Go to this site to review AI-suggested actions">
                    {isMultiSite ? `Review ${s.name} (${s.count})` : `Review ${s.count} Suggestion${s.count !== 1 ? 's' : ''}`}
                  </button>
                ))}
                <button onClick={onClose} disabled={phase === 'running'} className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-slate-50 disabled:opacity-40" title="Close sync log (doc unaffected in portal)">
                  {phase === 'running' ? 'Syncing…' : 'Close'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const SyncConfigModal = ({ site, onClose, onSave }: {
  site: Site; onClose: () => void; onSave: (siteId: string, includedIds: string[]) => void;
}) => {
  const [includedFolders, setIncludedFolders] = useState<Map<string, string>>(
    new Map((site.included_datto_folder_ids ?? []).map(id => [id, id]))
  );
  const [folderTree, setFolderTree] = useState<Map<string, { name: string; parentId: string }>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleFolderLoaded = (parentId: string, children: { id: string; name: string }[]) => {
    setFolderTree(prev => {
      const next = new Map(prev);
      children.forEach(({ id, name }) => next.set(id, { name, parentId }));
      return next;
    });
  };

  const getDescendants = (parentId: string): { id: string; name: string }[] => {
    const result: { id: string; name: string }[] = [];
    for (const [id, data] of folderTree.entries()) {
      if (data.parentId === parentId) {
        result.push({ id, name: data.name });
        result.push(...getDescendants(id));
      }
    }
    return result;
  };

  const handleToggle = (id: string, name: string) => {
    const descendants = getDescendants(id);
    setIncludedFolders(prev => {
      const next = new Map(prev);
      if (next.has(id)) {
        next.delete(id);
        descendants.forEach(d => next.delete(d.id));
      } else {
        next.set(id, name);
        descendants.forEach(d => next.set(d.id, d.name));
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setIncludedFolders(prev => {
      const next = new Map(prev);
      // Include the root folder itself
      next.set(site.datto_folder_id, site.name);
      // Include all loaded subfolders
      for (const [id, { name }] of folderTree.entries()) next.set(id, name);
      return next;
    });
  };

  const handleClearAll = () => setIncludedFolders(new Map());

  const handleSave = async () => {
    setSaving(true); setSaveError('');
    const includedArr = Array.from(includedFolders.keys());
    const { error } = await supabase.from('sites').update({ included_datto_folder_ids: includedArr, excluded_datto_folder_ids: [] }).eq('id', site.id);
    if (error) { setSaveError('Failed to save. Please try again.'); setSaving(false); return; }
    // Delete actions from folders that were just removed from the included set
    const oldIncluded = new Set((site.included_datto_folder_ids ?? []).map(String));
    const removedFolders = [...oldIncluded].filter(id => !includedArr.includes(id));
    if (removedFolders.length > 0) {
      await supabase.from('actions').delete().eq('site_id', site.id).in('source_folder_id', removedFolders);
    }
    onSave(site.id, includedArr);
    onClose();
  };

  if (!site.datto_folder_id) return null;
  const includedIds = new Set(includedFolders.keys());
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="bg-violet-600 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-black text-white text-sm uppercase tracking-widest flex items-center gap-2"><Settings size={14} />Configure AI Sync</h2>
            <p className="text-violet-200 text-[11px] mt-0.5">{site.name}</p>
          </div>
          <button onClick={onClose} className="text-violet-200 hover:text-white" title="Close without saving"><X size={18} /></button>
        </div>
        <div className="bg-violet-50 border-b border-violet-100 px-6 py-3 flex items-center justify-between gap-4">
          <p className="text-[11px] text-violet-700 font-bold">Tick folders to include in AI sync. Leave all unticked to sync everything. Use Select All then untick folders to exclude specific ones.</p>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={handleSelectAll} className="text-[10px] font-black uppercase tracking-wider text-violet-600 hover:text-violet-800 whitespace-nowrap">Select All</button>
            <span className="text-violet-300">|</span>
            <button onClick={handleClearAll} className="text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-600 whitespace-nowrap">Clear All</button>
          </div>
        </div>
        {/* Checkbox folder tree */}
        <div className="px-4 py-3 max-h-80 overflow-y-auto">
          <FolderCheckboxTree
            folderId={site.datto_folder_id}
            folderName={site.name}
            depth={0}
            includedIds={includedIds}
            onToggle={handleToggle}
            onFolderLoaded={handleFolderLoaded}
          />
        </div>
        <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            {includedFolders.size > 0 ? <span className="text-[11px] font-bold text-violet-600">{includedFolders.size} folder{includedFolders.size !== 1 ? 's' : ''} selected</span> : <span className="text-[11px] font-bold text-slate-400">No folders selected — will sync all</span>}
            {saveError && <p className="text-[11px] font-bold text-rose-600 mt-1">{saveError}</p>}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-5 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-slate-50" title="Cancel without saving">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-violet-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-700 disabled:opacity-50" title="Save folder configuration for this site">{saving ? 'Saving…' : 'Save Config'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Login Screen ─────────────────────────────────────────────────────────────
const SetPasswordModal = ({ title, onSubmit, onClose }: { title: string; onSubmit: (pw: string) => Promise<void>; onClose: () => void }) => {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false); const [err, setErr] = useState('');
  const [showPw, setShowPw] = useState(false);
  const handle = async () => {
    if (pw.length < 8) { setErr('Password must be at least 8 characters'); return; }
    if (pw !== pw2) { setErr('Passwords do not match'); return; }
    setLoading(true); setErr('');
    await onSubmit(pw);
    setLoading(false);
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm p-6">
        <h3 className="font-black text-slate-900 text-base mb-4">{title}</h3>
        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold px-3 py-2 rounded-xl mb-3">{err}</div>}
        <div className="space-y-3">
          <div><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">New Password</label><div className="relative"><Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" /><input type={showPw ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" placeholder="Min. 8 characters" className="w-full pl-9 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /><button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{showPw ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></div>
          <div><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Confirm Password</label><div className="relative"><Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" /><input type={showPw ? 'text' : 'password'} value={pw2} onChange={e => setPw2(e.target.value)} onKeyDown={e => e.key === 'Enter' && handle()} autoComplete="new-password" placeholder="Repeat password" className="w-full pl-9 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /><button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{showPw ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-[11px] font-black uppercase tracking-wider text-slate-500 hover:bg-slate-50">Cancel</button>
          <button onClick={handle} disabled={loading} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50">{loading ? 'Saving…' : 'Set Password'}</button>
        </div>
      </div>
    </div>
  );
};

const LoginScreen = ({ onLogin }: { onLogin: () => void }) => {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'forgot' | 'sent'>('login');
  const handleLogin = async () => {
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError('Invalid email or password'); setLoading(false); } else { onLogin(); }
  };
  const handleForgot = async () => {
    if (!email) { setError('Enter your email address first'); return; }
    setLoading(true); setError('');
    await fetch('/api/auth/send-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, origin: window.location.origin }) });
    setLoading(false); setMode('sent');
  };
  return (
    <div className="min-h-screen bg-indigo-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-3 bg-white rounded-lg px-5 py-3 shadow-xl inline-block"><img src="/logo-full.svg" alt="McCormack Benson Health & Safety" className="h-24 w-auto object-contain" /></div>
        </div>
        <div className="bg-white rounded-xl p-8 shadow-2xl">
          {mode === 'sent' ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mx-auto mb-4"><Mail size={22} className="text-emerald-600" /></div>
              <h2 className="text-base font-black text-slate-900 mb-2">Check your email</h2>
              <p className="text-sm text-slate-500 mb-5">If <span className="font-bold text-slate-700">{email}</span> is registered, you'll receive a reset link shortly.</p>
              <button onClick={() => { setMode('login'); setError(''); }} className="text-indigo-600 text-sm font-black hover:underline">← Back to sign in</button>
            </div>
          ) : mode === 'forgot' ? (
            <>
              <h2 className="text-lg font-black text-slate-900 mb-1">Reset your password</h2>
              <p className="text-xs text-slate-400 mb-5">Enter your email and we'll send a reset link.</p>
              {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold px-4 py-3 rounded-xl mb-4">{error}</div>}
              <div className="space-y-4">
                <div><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Email</label><div className="relative"><Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" /><input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleForgot()} placeholder="you@company.com" className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div></div>
                <button onClick={handleForgot} disabled={loading} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-black text-sm uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50">{loading ? 'Sending…' : 'Send Reset Link'}</button>
                <button onClick={() => { setMode('login'); setError(''); }} className="w-full text-slate-400 text-sm font-bold hover:text-slate-600">← Back to sign in</button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-lg font-black text-slate-900 mb-6">Sign in to your account</h2>
              {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold px-4 py-3 rounded-xl mb-4">{error}</div>}
              <div className="space-y-4">
                <div><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Email</label><div className="relative"><Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" /><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div></div>
                <div><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Password</label><div className="relative"><Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" /><input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="••••••••" className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div></div>
                <button onClick={handleLogin} disabled={loading} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-black text-sm uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50 mt-2">{loading ? 'Signing in…' : 'Sign In'}</button>
                <button onClick={() => { setMode('forgot'); setError(''); }} className="w-full text-slate-400 text-xs font-bold hover:text-slate-600 text-center">Forgot password?</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const isViewOnly = profile?.role === 'client' && profile?.view_only === true;
  const [authLoading, setAuthLoading] = useState(true);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [appFlash, setAppFlash] = useState('');
  const appFlashRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showAppFlash = (msg: string, durationMs = 3500) => { setAppFlash(msg); if (appFlashRef.current) clearTimeout(appFlashRef.current); appFlashRef.current = setTimeout(() => setAppFlash(''), durationMs); };
  const [view, setView] = useState<AppView>('portfolio');
  const [viewAsRole, setViewAsRole] = useState<'advisor' | 'client' | null>(null);
  const effectiveRole = viewAsRole ?? profile?.role ?? 'client';
  const [siteTab, setSiteTab] = useState<'actions' | 'documents' | 'dochealth' | 'iag' | 'files'>('actions');
  const effectiveSiteTab = isViewOnly && siteTab === 'actions' ? 'files' : siteTab;
  const pendingTabRef = React.useRef<typeof siteTab | null>(null);
  const [iagServices, setIagServices] = useState<any[]>([]);
  const [iagServicesLoading, setIagServicesLoading] = useState(false);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [filterOrgId, setFilterOrgId] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLastRun, setSyncLastRun] = useState('2 hours ago');
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);
  const [filterPriority, setFilterPriority] = useState<Priority | 'all' | 'open' | 'resolved' | 'pending_review' | 'rejected'>('all');
  const [showArchivedActions, setShowArchivedActions] = useState(false);
  const [actionSearch, setActionSearch] = useState('');
  const [showActionSearch, setShowActionSearch] = useState(false);
  const [actionNotes, setActionNotes] = useState<Record<string, string>>({});
  const [sites, setSites] = useState<Site[]>([]);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const clientOrg = profile?.role === 'client' ? organisations.find(o => o.id === profile?.organisation_id) ?? null : null;
  const siteOrg = selectedSite ? organisations.find(o => o.id === selectedSite.organisation_id) ?? null : clientOrg;
  const portfolioOrg = clientOrg ?? (filterOrgId ? organisations.find(o => o.id === filterOrgId) ?? null : null);
  const [allActions, setAllActions] = useState<Action[]>([]);
  const [showAddAction, setShowAddAction] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [expandedDocGroups, setExpandedDocGroups] = useState<Set<string>>(new Set());
  const pendingExpandDocRef = React.useRef<string | null>(null);
  const pathRefreshedSites = React.useRef<Set<string>>(new Set());
  const [aiSyncing, setAiSyncing] = useState(false);
  const [aiSyncProgress, setAiSyncProgress] = useState('');
  const [showAiReviewPanel, setShowAiReviewPanel] = useState(false);
  const [aiSuggestionsCount, setAiSuggestionsCount] = useState(0);
  const [showClientUploadsPanel, setShowClientUploadsPanel] = useState(false);
  const [pendingUploadsCount, setPendingUploadsCount] = useState(0);
  const [portfolioSuggestionCounts, setPortfolioSuggestionCounts] = useState<Record<string, number>>({});
  const [portfolioUploadCounts, setPortfolioUploadCounts] = useState<Record<string, number>>({});
  const [siteAdvisor, setSiteAdvisor] = useState<{ full_name: string | null; email: string; phone: string | null } | null>(null);
  const [portfolioReviewedUploadCounts, setPortfolioReviewedUploadCounts] = useState<Record<string, number>>({});
  // File browser state
  const [folderData, setFolderData] = useState<Map<string, { items: DattoItem[]; path: string }>>(new Map());
  const [loadingFolderIds, setLoadingFolderIds] = useState<Set<string>>(new Set());
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [browserRootPath, setBrowserRootPath] = useState<string>('');
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [searchFileCache, setSearchFileCache] = useState<{ siteId: string; files: (DattoItem & { folderPath: string })[] } | null>(null);
  const [sectionFiles, setSectionFiles] = useState<Map<string, (DattoItem & { parentFolderId: string; folderPath: string })[]>>(new Map());
  const [sectionLoading, setSectionLoading] = useState<Set<string>>(new Set());
  const [expandedSubfolders, setExpandedSubfolders] = useState<Set<string>>(new Set());
  const [searchLoading, setSearchLoading] = useState(false);
  const [aiStatusMessage, setAiStatusMessage] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [reviewActions, setReviewActions] = useState<ReviewAction[]>([]);
  const reviewDescRefs = useRef<Record<string, HTMLTextAreaElement>>({});
  const [reviewLog, setReviewLog] = useState<Array<{ action: 'added' | 'resolved' | 'skipped' | 'rejected'; docName: string; title: string }>>([]);
  const [reviewLogExpanded, setReviewLogExpanded] = useState(false);
  const [skippedReview, setSkippedReview] = useState<Set<string>>(new Set());
  const [unverifiedDates, setUnverifiedDates] = useState<Record<string, string>>({});
  const [resolveExpanded, setResolveExpanded] = useState<Record<string, boolean>>({});
  const [resolveDates, setResolveDates] = useState<Record<string, string>>({});
  const [resolveFiles, setResolveFiles] = useState<Record<string, File | null>>({});
  const [resolveUploading, setResolveUploading] = useState<Record<string, boolean>>({});
  const [docGroupExpanded, setDocGroupExpanded] = useState<Record<string, boolean>>({});
  const [docResolveExpanded, setDocResolveExpanded] = useState<Record<string, boolean>>({});
  const [docResolveDates, setDocResolveDates] = useState<Record<string, string>>({});
  const [docResolveFiles, setDocResolveFiles] = useState<Record<string, File[]>>({});
  const [docResolveUploading, setDocResolveUploading] = useState<Record<string, boolean>>({});
  const [bulkResolveExpanded, setBulkResolveExpanded] = useState<Record<string, boolean>>({});
  const [bulkResolveDates, setBulkResolveDates] = useState<Record<string, string>>({});
  const [bulkResolveFiles, setBulkResolveFiles] = useState<Record<string, File[]>>({});
  const [bulkResolveUploading, setBulkResolveUploading] = useState<Record<string, boolean>>({});
  const [preExEditingId, setPreExEditingId] = useState<string | null>(null);
  const [preExDateInput, setPreExDateInput] = useState('');
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showSyncConfig, setShowSyncConfig] = useState(false);
  const [scoreExplanationCard, setScoreExplanationCard] = useState<'implementation' | 'iag' | 'documentation' | null>(null);
  const [advisors, setAdvisors] = useState<{ id: string; email: string }[]>([]);
  const aiCancelledRef = React.useRef(false);
  const currentUserIdRef = React.useRef<string | null>(null);
  const loginLoggedRef   = React.useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      currentUserIdRef.current = session?.user?.id ?? null;
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') { window.location.href = '/'; return; }
      // If a different user signs in on the same tab, reload to clear all previous user's state
      if (event === 'SIGNED_IN' && currentUserIdRef.current && session?.user?.id !== currentUserIdRef.current) {
        window.location.href = '/';
        return;
      }
      currentUserIdRef.current = session?.user?.id ?? null;
      setUser(session?.user ?? null);
      if (event === 'PASSWORD_RECOVERY') setShowPasswordReset(true);
      if (event === 'SIGNED_IN' && session?.user?.id && loginLoggedRef.current !== session.user.id) {
        loginLoggedRef.current = session.user.id;
        fetch('/api/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: session.user.id, action: 'login', metadata: { email: session.user.email } }),
        }).catch(() => {});
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('*').eq('id', user.id).single().then(({ data }) => {
      if (data) {
        setProfile(data);
        if (data.datto_base_path) {
          localStorage.setItem('dattoBasePath', data.datto_base_path);
          // Derive drive letter from stored UNC path if not already cached
          if (!localStorage.getItem('dattoDriveLetter')) {
            localStorage.setItem('dattoDriveLetter', 'W');
          }
        }
        if (data.role === 'superadmin') setView('admin');
        else if (data.role === 'client' && data.view_only) { setSiteTab('files'); } // view stays 'portfolio'; sites loading auto-navigates to 'site' for single-site free clients
        else setView('portfolio');
      }
    });
    fetch('/api/admin/advisors').then(r => r.json()).then(advisors => {
      setAdvisors((advisors as any[]).map(u => ({ id: u.id, email: u.email })));
    }).catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (!user || !profile) return;
    const load = async () => {
      let orgsQuery = supabase.from('organisations').select('*');
      if (profile.role === 'advisor') {
        const { data: assignments } = await supabase.from('advisor_organisations').select('organisation_id').eq('advisor_id', user.id);
        const orgIds = (assignments || []).map((a: any) => a.organisation_id);
        if (orgIds.length === 0) { setOrganisations([]); return; }
        orgsQuery = orgsQuery.in('id', orgIds);
      } else if (profile.role === 'client') {
        if (profile.organisation_id) orgsQuery = orgsQuery.eq('id', profile.organisation_id);
        else { setOrganisations([]); return; }
      }
      const { data } = await orgsQuery;
      if (data) setOrganisations(data);
    };
    load();
  }, [user, profile]);

  useEffect(() => {
    if (!user || !profile) return;
    // For non-client roles, wait until organisations have loaded before querying sites
    if (profile.role !== 'client' && organisations.length === 0) return;
    const load = async () => {
      const orgFolderMap = new Map(organisations.map(o => [o.id, o.datto_folder_id]));
      let sitesQuery = supabase.from('sites').select('*');
      if (profile.role === 'advisor') {
        const orgIds = organisations.map(o => o.id);
        sitesQuery = sitesQuery.in('organisation_id', orgIds);
      } else if (profile.role === 'client') {
        // Use server-side API to reliably read client_site_assignments (bypasses RLS)
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? '';
        const assignedSiteIds: string[] = await fetch('/api/client-sites', {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.ok ? r.json() : []).catch(() => []);
        if (assignedSiteIds.length > 0) {
          // Specific sites assigned — restrict to those only
          sitesQuery = sitesQuery.in('id', assignedSiteIds);
        } else if (profile.organisation_id) {
          // Default: all sites in the client's organisation
          sitesQuery = sitesQuery.eq('organisation_id', profile.organisation_id);
        } else if (profile.site_id) {
          // Legacy fallback: single site on profile
          sitesQuery = sitesQuery.eq('id', profile.site_id);
        } else { setSites([]); return; }
      }
      const { data } = await sitesQuery;
      if (data) {
        const mapped: Site[] = data.map((s: any) => ({
          id: s.id, name: s.name, type: s.type, organisation_id: s.organisation_id,
          compliance: s.compliance_score ?? 0, trend: s.trend ?? 0,
          actionProgress: s.action_progress ?? 100,
          iagScore: s.iag_score ?? null,
          iagWeightedScore: s.iag_weighted_score ?? null,
          employeeCount: s.employee_count ?? null,
          red: 0, amber: 0, green: 0, lastReview: '—',
          datto_folder_id: s.datto_folder_id || orgFolderMap.get(s.organisation_id) || null,
          datto_folder_path: s.datto_folder_path || null,
          advisor_id: s.advisor_id ?? null,
          last_ai_sync: s.last_ai_sync ?? null,
          excluded_datto_folder_ids: s.excluded_datto_folder_ids ?? [],
          included_datto_folder_ids: s.included_datto_folder_ids ?? null,
          logo_url: s.logo_url ?? null,
        }));
        // Also include any sites assigned directly to this advisor
        let finalMapped = mapped;
        if (profile.role === 'advisor') {
          const { data: siteAssigns } = await supabase.from('advisor_site_assignments').select('site_id').eq('advisor_id', user.id);
          const extraIds = (siteAssigns ?? []).map((a: any) => a.site_id).filter((id: string) => !mapped.some(s => s.id === id));
          if (extraIds.length > 0) {
            const { data: extraData } = await supabase.from('sites').select('*').in('id', extraIds);
            if (extraData) {
              finalMapped = [...mapped, ...extraData.map((s: any) => ({
                id: s.id, name: s.name, type: s.type, organisation_id: s.organisation_id,
                compliance: s.compliance_score ?? 0, trend: s.trend ?? 0,
                actionProgress: s.action_progress ?? 100, iagScore: s.iag_score ?? null, iagWeightedScore: s.iag_weighted_score ?? null,
                employeeCount: s.employee_count ?? null, red: 0, amber: 0, green: 0, lastReview: '—',
                datto_folder_id: s.datto_folder_id || orgFolderMap.get(s.organisation_id) || null,
                advisor_id: s.advisor_id ?? null, last_ai_sync: s.last_ai_sync ?? null,
                excluded_datto_folder_ids: s.excluded_datto_folder_ids ?? [],
                included_datto_folder_ids: s.included_datto_folder_ids ?? null,
                logo_url: s.logo_url ?? null,
              }))];
            }
          }
        }
        setSites(finalMapped);
        if (finalMapped.length > 0 && !selectedSite) {
          setSelectedSite(finalMapped[0]); recalcActionProgress(finalMapped[0].id); refreshComplianceScore(finalMapped[0].id);
          if (finalMapped.length === 1) setView('site');
        }
      }
    };
    load();
  }, [user, profile, organisations]);

  // Fetch advisor contact details for client view
  useEffect(() => {
    if (profile?.role !== 'client' || !selectedSite) { setSiteAdvisor(null); return; }
    supabase.auth.getSession().then(({ data: { session } }) => {
      const token = session?.access_token ?? '';
      fetch(`/api/my-advisor?siteId=${selectedSite.id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => setSiteAdvisor(data))
        .catch(() => setSiteAdvisor(null));
    });
  }, [selectedSite?.id, profile?.role]);

  // Load per-site AI suggestion counts for the dashboard notification
  useEffect(() => {
    if (!user || sites.length === 0) return;
    const siteIds = sites.map(s => s.id);
    supabase.from('actions').select('site_id').in('site_id', siteIds).eq('status', 'ai_suggested')
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        for (const a of (data ?? [])) { counts[a.site_id] = (counts[a.site_id] ?? 0) + 1; }
        setPortfolioSuggestionCounts(counts);
      });
  }, [user, sites.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load per-site pending client upload counts for the dashboard notification
  useEffect(() => {
    if (!user || sites.length === 0) return;
    const siteIds = sites.map(s => s.id);
    supabase.from('client_uploads').select('site_id').in('site_id', siteIds).eq('status', 'pending_review')
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        for (const u of (data ?? [])) { counts[u.site_id] = (counts[u.site_id] ?? 0) + 1; }
        setPortfolioUploadCounts(counts);
      });
    supabase.from('client_uploads').select('site_id').in('site_id', siteIds).in('status', ['acknowledged', 'linked'])
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        for (const u of (data ?? [])) { counts[u.site_id] = (counts[u.site_id] ?? 0) + 1; }
        setPortfolioReviewedUploadCounts(counts);
      });
  }, [user, sites.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || sites.length === 0) return;
    const priorityMap: Record<string, Priority> = { critical: 'red', upcoming: 'amber', scheduled: 'green', red: 'red', amber: 'amber', green: 'green' };
    const siteIds = sites.map(s => s.id);
    supabase.from('actions').select('*').in('site_id', siteIds).neq('status', 'ai_suggested').then(async ({ data }) => {
      if (!data) return;
      const docIds = Array.from(new Set(data.map((a: any) => a.source_document_id).filter(Boolean)));
      const docMap: Record<string, string | null> = {};
      if (docIds.length > 0) {
        const { data: docs } = await supabase.from('site_documents').select('id, datto_file_id').in('datto_file_id', docIds);
        (docs ?? []).forEach((d: any) => { docMap[d.datto_file_id] = d.datto_file_id ?? null; });
      }
      setAllActions(data.filter((a: any) => !a.site_document_id).map((a: any) => ({ id: a.id, action: a.title, description: a.description || '', date: a.due_date || '', site: sites.find(s => s.id === a.site_id)?.name || '', who: a.responsible_person || '', contractor: a.contractor || '', source: a.source_document_name || '', source_document_id: a.source_document_id || '', priority: (priorityMap[a.priority] || 'green') as Priority, regulation: a.regulation || '', notes: '', status: a.status as ActionStatus, hazardRef: a.hazard_ref || null, hazard: a.hazard || null, existingControls: a.existing_controls || null, riskRating: a.risk_rating || null, riskLevel: a.risk_level || null, resolvedDate: a.resolved_date || null, sourceFolderId: a.source_folder_id || null, isSuggested: a.is_suggested ?? false, updatedAt: a.updated_at || null, sourceFolderPath: a.source_folder_path || null, issueDate: a.issue_date || null, _siteDocumentId: a.site_document_id || null, dattoFileId: a.source_document_id ? (docMap[a.source_document_id] ?? null) : null, reviewNote: a.review_note ?? null })));
    });
  }, [user, sites]);

  const handleLogout = async () => { await supabase.auth.signOut(); setUser(null); setProfile(null); setSites([]); setOrganisations([]); setSelectedSite(null); };
  const handleDattoSync = () => { setIsSyncing(true); setTimeout(() => { setIsSyncing(false); setSyncLastRun('Just now'); }, 2000); };

  const loadIagServices = async (siteId: string) => {
    setIagServicesLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/services`);
      if (res.ok) setIagServices(await res.json());
    } catch { /* session invalidated or component unmounting during logout */ }
    setIagServicesLoading(false);
  };

  const refreshComplianceScore = async (siteId: string) => {
    try {
      const [actRes, healthRes] = await Promise.all([
        supabase.from('actions').select('source_document_name, issue_date').eq('site_id', siteId).not('source_document_name', 'is', null).is('site_document_id', null).neq('status', 'ai_suggested'),
        supabase.from('document_health').select('document_name, review_due').eq('site_id', siteId),
      ]);
      const actions = actRes.data ?? [];
      const health = healthRes.data ?? [];
      const docNames = Array.from(new Set(actions.map((a: any) => a.source_document_name as string)));
      if (docNames.length === 0) return;
      const reviewMap = new Map(health.map((h: any) => [h.document_name, h.review_due as string | null]));
      const issueDateMap = new Map<string, string | null>();
      for (const a of actions) {
        const d = a.issue_date as string | null;
        const prev = issueDateMap.get(a.source_document_name);
        if (!prev || (d && d > prev)) issueDateMap.set(a.source_document_name, d);
      }
      const today = new Date().toISOString().slice(0, 10);
      const pts = docNames.reduce((sum, name) => {
        const issueDate = issueDateMap.get(name) ?? null;
        const reviewDue = reviewMap.get(name) ?? null;
        let s: string;
        if (reviewDue) {
          s = reviewDue < today ? 'red' : Math.ceil((new Date(reviewDue + 'T00:00:00').getTime() - Date.now()) / 86400000) <= 30 ? 'amber' : 'green';
        } else if (!issueDate) {
          s = 'grey';
        } else {
          const months = Math.floor((Date.now() - new Date(issueDate + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24 * 30.5));
          s = months > 24 ? 'red' : months > 12 ? 'amber' : 'green';
        }
        return sum + (s === 'green' ? 100 : s === 'amber' ? 95 : s === 'red' ? 0 : 50);
      }, 0);
      const score = Math.round(pts / (docNames.length * 100) * 100);
      setSites(prev => prev.map(s => s.id === siteId ? { ...s, compliance: score } : s));
      setSelectedSite(prev => prev?.id === siteId ? { ...prev, compliance: score } : prev);
    } catch { /* silent */ }
  };

  const recalcActionProgress = async (siteId: string) => {
    try {
      const res = await fetch('/api/actions/recalc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: siteId }) });
      if (res.ok) {
        const { action_progress } = await res.json();
        setSites(prev => prev.map(s => s.id === siteId ? { ...s, actionProgress: action_progress } : s));
        setSelectedSite(prev => prev?.id === siteId ? { ...prev, actionProgress: action_progress } : prev);
      }
    } catch { /* silent — score stays as loaded from DB */ }
  };

  // Reset file browser + actions view when switching sites
  React.useEffect(() => {
    setFolderData(new Map());
    setExpandedFolderIds(new Set());
    setFileSearchQuery('');
    setSearchFileCache(null);
    setBrowserRootPath('');
    setExpandedActionId(null);
    setExpandedDocGroups(new Set());
    setFilterPriority('all');
    setActionSearch('');
    setShowActionSearch(false);
    setSiteTab(pendingTabRef.current ?? 'actions');
    pendingTabRef.current = null;
  }, [selectedSite?.id]);

  // Auto-load services whenever the selected site changes (for Actions Score panel enrichment)
  React.useEffect(() => {
    if (selectedSite?.id) loadIagServices(selectedSite.id);
  }, [selectedSite?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load count of pending AI suggestions for the selected site
  React.useEffect(() => {
    if (!selectedSite?.id) { setAiSuggestionsCount(0); return; }
    supabase.from('actions').select('id', { count: 'exact', head: true }).eq('site_id', selectedSite.id).eq('status', 'ai_suggested')
      .then(({ count }) => setAiSuggestionsCount(count ?? 0));
  }, [selectedSite?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load count of pending client uploads for the selected site
  React.useEffect(() => {
    if (!selectedSite?.id) { setPendingUploadsCount(0); return; }
    supabase.from('client_uploads').select('id', { count: 'exact', head: true }).eq('site_id', selectedSite.id).eq('status', 'pending_review')
      .then(({ count }) => setPendingUploadsCount(count ?? 0));
  }, [selectedSite?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Background path refresh: keep source_folder_path in sync with live Datto folder names.
  // Fires once per site per session so renamed folders fix themselves without needing an AI sync.
  React.useEffect(() => {
    const site = selectedSite;
    if (!site?.id || !site.datto_folder_id || pathRefreshedSites.current.has(site.id)) return;
    const siteActions = allActions.filter(a => a.site === site.name && a.source_document_id && !a.dattoFileId);
    if (siteActions.length === 0) return;
    pathRefreshedSites.current.add(site.id);
    (async () => {
      try {
        const rootPath = await resolvePathFromRoot(site);
        const allFiles = await fetchAllFiles(site.datto_folder_id!, new Set(site.excluded_datto_folder_ids ?? []), rootPath);
        const livePathMap = new Map<string, string>(allFiles.map(f => [String(f.id), f.folderPath ?? ''] as [string, string]));
        const liveNameMap = new Map<string, string>(allFiles.map(f => [String(f.id), f.name] as [string, string]));
        const stale = siteActions.filter(a =>
          livePathMap.has(String(a.source_document_id)) && (
            livePathMap.get(String(a.source_document_id)) !== a.sourceFolderPath ||
            liveNameMap.get(String(a.source_document_id)) !== a.source
          )
        );
        if (stale.length === 0) return;
        await Promise.all(stale.map(a => {
          const updates: Record<string, string> = {};
          const newPath = livePathMap.get(String(a.source_document_id));
          const newName = liveNameMap.get(String(a.source_document_id));
          if (newPath !== undefined && newPath !== a.sourceFolderPath) updates.source_folder_path = newPath;
          if (newName !== undefined && newName !== a.source) updates.source_document_name = newName;
          return supabase.from('actions').update(updates).eq('id', a.id);
        }));
        setAllActions(prev => prev.map(a => {
          const newPath = livePathMap.get(String(a.source_document_id));
          const newName = liveNameMap.get(String(a.source_document_id));
          const pathChanged = newPath !== undefined && newPath !== a.sourceFolderPath;
          const nameChanged = newName !== undefined && newName !== a.source;
          if (!pathChanged && !nameChanged) return a;
          return { ...a, ...(pathChanged ? { sourceFolderPath: newPath! } : {}), ...(nameChanged ? { source: newName! } : {}) };
        }));
      } catch { /* silent — path refresh is best-effort */ }
    })();
  }, [selectedSite?.id, allActions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Collapse open actions when switching tabs or filters (honour pending expansion from doc-health jump)
  React.useEffect(() => {
    setExpandedActionId(null);
    if (pendingExpandDocRef.current) {
      setExpandedDocGroups(new Set([pendingExpandDocRef.current]));
      pendingExpandDocRef.current = null;
    } else {
      setExpandedDocGroups(new Set());
    }
  }, [siteTab, filterPriority]);


  // Clear search cache when leaving the files tab so next search reflects current Datto state
  React.useEffect(() => {
    if (effectiveSiteTab !== 'files') setSearchFileCache(null);
  }, [effectiveSiteTab]);

  // Init file browser when Files tab is opened (preserves state on tab toggle, only re-inits for new site)
  React.useEffect(() => {
    if (effectiveSiteTab !== 'files' || !selectedSite?.datto_folder_id) return;
    if (folderData.has(selectedSite.datto_folder_id)) return;
    setSectionFiles(new Map());
    setSectionLoading(new Set());
    setExpandedSubfolders(new Set());
    const init = async () => {
      const rootPath = await resolvePathFromRoot(selectedSite);
      setBrowserRootPath(rootPath);
      await loadFolder(selectedSite.datto_folder_id!, rootPath);
    };
    init();
  }, [effectiveSiteTab, selectedSite?.id, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleNextOccurrence = async (action: Action) => {
    const { date: dueDate, issueDate } = action;
    if (!dueDate || !issueDate || !isIsoDate(dueDate) || !isIsoDate(issueDate)
        || ONGOING_RE.test(dueDate) || ONGOING_RE.test(issueDate)) return;
    const due = new Date(dueDate + 'T00:00:00').getTime();
    const issued = new Date(issueDate + 'T00:00:00').getTime();
    const gapMs = due - issued;
    if (gapMs <= 0) return;
    const nextDue = new Date(due + gapMs).toLocaleDateString('en-CA');
    const { data, error } = await supabase.from('actions').insert({
      site_id: sites.find(s => s.name === action.site)?.id ?? null,
      title: action.action, description: action.description ?? '', priority: action.priority ?? 'green',
      status: 'open', due_date: nextDue, issue_date: dueDate, resolved_date: null, review_note: null,
      regulation: action.regulation ?? null, contractor: action.contractor ?? null,
      responsible_person: action.who ?? null, source_document_name: action.source ?? null,
      source_document_id: action.source_document_id ?? null, source_folder_id: action.sourceFolderId ?? null,
      source_folder_path: action.sourceFolderPath ?? null, hazard_ref: action.hazardRef ?? null,
      hazard: action.hazard ?? null, existing_controls: action.existingControls ?? null,
      risk_rating: action.riskRating ?? null, risk_level: action.riskLevel ?? null, is_suggested: false,
    }).select().single();
    if (error) { console.error('[scheduleNextOccurrence]', error); return; }
    if (data) {
      setAllActions(prev => [...prev, {
        id: data.id, action: action.action, description: action.description ?? '', date: nextDue,
        site: action.site, who: action.who ?? '', contractor: action.contractor ?? '',
        source: action.source ?? '', source_document_id: action.source_document_id ?? '',
        priority: action.priority ?? 'green', regulation: action.regulation ?? '', notes: '',
        status: 'open' as ActionStatus, hazardRef: action.hazardRef ?? null, hazard: action.hazard ?? null,
        existingControls: action.existingControls ?? null, riskRating: action.riskRating ?? null,
        riskLevel: action.riskLevel ?? null, resolvedDate: null, sourceFolderId: action.sourceFolderId ?? null,
        sourceFolderPath: action.sourceFolderPath ?? null, issueDate: dueDate, reviewNote: null,
        updatedAt: data.updated_at ?? null, isSuggested: false,
      }]);
      showAppFlash(`Next occurrence scheduled — due ${toUKDate(nextDue)}`);
    }
  };

  const toggleResolve = async (id: string) => {
    const isCurrentlyResolved = resolvedIds.includes(id);
    const action = allActions.find(a => a.id === id);
    setResolvedIds(prev => isCurrentlyResolved ? prev.filter(i => i !== id) : [...prev, id]);
    const today = new Date().toLocaleDateString('en-CA');
    await supabase.from('actions').update({
      status: isCurrentlyResolved ? 'open' : 'resolved',
      resolved_date: isCurrentlyResolved ? null : today,
    }).eq('id', id);
    setAllActions(prev => prev.map(a => a.id === id ? { ...a, status: isCurrentlyResolved ? 'open' : 'resolved', resolvedDate: isCurrentlyResolved ? null : today } : a));
    const siteId = sites.find(s => s.name === action?.site)?.id;
    if (siteId) recalcActionProgress(siteId);
    if (!isCurrentlyResolved && action) await scheduleNextOccurrence({ ...action, resolvedDate: today });
  };
  const handleBulkResolveActions = async (source: string, actions: typeof allActions) => {
    const unresolved = actions.filter(a => !resolvedIds.includes(a.id) && a.status !== 'resolved' && a.status !== 'archived');
    if (!unresolved.length || !selectedSite) return;
    const today = new Date().toLocaleDateString('en-CA');
    const resolvedDate = bulkResolveDates[source] || today;
    const evidenceFiles = bulkResolveFiles[source] ?? [];
    setBulkResolveUploading(prev => ({ ...prev, [source]: true }));
    const { data: { user } } = await supabase.auth.getUser();
    type SharedEv = { storagePath: string; dattoFileId: string | null; fileName: string; fileSizeBytes: number | null };
    const sharedEvidenceMap = new Map<number, SharedEv>();
    for (const action of unresolved) {
      await supabase.from('actions').update({ status: 'resolved', resolved_date: resolvedDate }).eq('id', action.id);
      setResolvedIds(prev => [...prev, action.id]);
      setAllActions(prev => prev.map(a => a.id === action.id ? { ...a, status: 'resolved' as ActionStatus, resolvedDate } : a));
      await scheduleNextOccurrence({ ...action, resolvedDate, date: action.date, issueDate: action.issueDate ?? null } as Parameters<typeof scheduleNextOccurrence>[0]);
      if (evidenceFiles.length > 0) {
        for (let i = 0; i < evidenceFiles.length; i++) {
          if (!sharedEvidenceMap.has(i)) {
            const fd = new FormData();
            fd.append('file', evidenceFiles[i]);
            fd.append('siteId', selectedSite.id);
            if (user?.id) fd.append('userId', user.id);
            if (action.source_document_id) fd.append('sourceDocumentId', action.source_document_id);
            if (action.source) fd.append('sourceDocumentName', action.source);
            if (action.sourceFolderId) fd.append('sourceFolderId', action.sourceFolderId);
            const res = await fetch(`/api/actions/${action.id}/evidence`, { method: 'POST', body: fd });
            const json = await res.json().catch(() => null);
            if (json?.evidence) sharedEvidenceMap.set(i, { storagePath: json.evidence.storagePath, dattoFileId: json.evidence.dattoFileId ?? null, fileName: json.evidence.fileName, fileSizeBytes: json.evidence.fileSizeBytes ?? null });
          } else {
            const shared = sharedEvidenceMap.get(i)!;
            await fetch(`/api/actions/${action.id}/evidence`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storage_path: shared.storagePath, datto_file_id: shared.dattoFileId, file_name: shared.fileName, file_size_bytes: shared.fileSizeBytes, site_id: selectedSite.id, user_id: user?.id || null, source_document_id: action.source_document_id || null }) });
          }
        }
      }
    }
    setBulkResolveUploading(prev => ({ ...prev, [source]: false }));
    recalcActionProgress(selectedSite.id);
    setBulkResolveExpanded(prev => { const next = { ...prev }; delete next[source]; return next; });
    setBulkResolveFiles(prev => ({ ...prev, [source]: [] }));
    setBulkResolveDates(prev => { const next = { ...prev }; delete next[source]; return next; });
  };

  const handleClientSubmit = async (id: string) => {
    const res = await fetch(`/api/actions/${id}/submit`, { method: 'POST' });
    if (!res.ok) { console.error('[handleClientSubmit] API error:', await res.text()); showAppFlash('Failed to submit — please try again.'); return; }
    setAllActions(prev => prev.map(a => a.id === id ? { ...a, status: 'pending_review' as ActionStatus, reviewNote: null } : a));
    const action = allActions.find(a => a.id === id);
    const siteId = sites.find(s => s.name === action?.site)?.id;
    if (siteId) recalcActionProgress(siteId);
  };
  const handleClientWithdraw = async (id: string) => {
    const { error } = await supabase.from('actions').update({ status: 'open', review_note: null }).eq('id', id);
    if (error) { console.error('[handleClientWithdraw] DB error:', error); showAppFlash('Failed to withdraw — please try again.'); return; }
    setAllActions(prev => prev.map(a => a.id === id ? { ...a, status: 'open' as ActionStatus, reviewNote: null } : a));
    const action = allActions.find(a => a.id === id);
    const siteId = sites.find(s => s.name === action?.site)?.id;
    if (siteId) recalcActionProgress(siteId);
  };
  const handleAdvisorConfirm = async (id: string) => {
    const today = new Date().toLocaleDateString('en-CA');
    const action = allActions.find(a => a.id === id);
    const { error } = await supabase.from('actions').update({ status: 'resolved', resolved_date: today, review_note: null }).eq('id', id);
    if (error) { console.error('[handleAdvisorConfirm] DB error:', error); showAppFlash('Failed to confirm — please try again.'); return; }
    setAllActions(prev => prev.map(a => a.id === id ? { ...a, status: 'resolved' as ActionStatus, resolvedDate: today, reviewNote: null } : a));
    setResolvedIds(prev => prev.includes(id) ? prev : [...prev, id]);
    const siteId = sites.find(s => s.name === action?.site)?.id;
    if (siteId) recalcActionProgress(siteId);
    if (action) await scheduleNextOccurrence({ ...action, resolvedDate: today });
  };
  const handleAdvisorReject = async (id: string, note: string) => {
    const action = allActions.find(a => a.id === id);
    const siteId = sites.find(s => s.name === action?.site)?.id;
    const res = await fetch(`/api/actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject', note, siteId }) });
    if (!res.ok) { showAppFlash('Failed to reject — please try again.'); return; }
    setAllActions(prev => prev.map(a => a.id === id ? { ...a, status: 'open' as ActionStatus, reviewNote: note || null } : a));
    if (siteId) recalcActionProgress(siteId);
  };
  const handleApplyFromWord = async (id: string, diff: ReadDiff) => {
    const fromUKDate = (s: string) => {
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (!m) return s;
      const [, d, mo, y] = m;
      return `${y.length === 2 ? `20${y}` : y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    };
    const updates: Record<string, string | null> = {
      ...(diff.actionText        ? { title: diff.actionText } : {}),
      responsible_person: diff.responsiblePerson || null,
      due_date:           diff.targetDate    ? fromUKDate(diff.targetDate)    : null,
      resolved_date:      diff.completedDate ? fromUKDate(diff.completedDate) : null,
    };
    const { error } = await supabase.from('actions').update(updates).eq('id', id);
    if (error) { console.error('[handleApplyFromWord] DB error:', error); showAppFlash('Failed to apply Word values — please try again.'); return; }
    setAllActions(prev => prev.map(a => a.id === id ? {
      ...a,
      ...(diff.actionText        ? { action: diff.actionText }                          : {}),
      who:         diff.responsiblePerson || a.who,
      date:        diff.targetDate    ? fromUKDate(diff.targetDate)    : a.date,
      resolvedDate: diff.completedDate ? fromUKDate(diff.completedDate) : a.resolvedDate,
    } : a));
  };
  const handleDeleteAction = async (id: string) => {
    const action = allActions.find(a => a.id === id);
    await supabase.from('actions').delete().eq('id', id);
    setAllActions(prev => prev.filter(a => a.id !== id));
    const siteId = sites.find(s => s.name === action?.site)?.id;
    if (siteId) recalcActionProgress(siteId);
  };
  const handleAddNote = (id: string, note: string) => { if (note.trim()) setActionNotes(prev => ({ ...prev, [id]: note.trim() })); };
  const handleUpdateIssueDate = async (id: string, date: string | null) => {
    await supabase.from('actions').update({ issue_date: date }).eq('id', id);
    setAllActions(prev => prev.map(a => a.id === id ? { ...a, issueDate: date } : a));
  };
  const handleUpdateActionField = async (id: string, updates: { date?: string; who?: string; action?: string }) => {
    const act = allActions.find(a => a.id === id);
    if (!act) return;
    const dbUpdates: Record<string, unknown> = {};
    if ('date' in updates) dbUpdates.due_date = updates.date || null;
    if ('who' in updates) dbUpdates.responsible_person = updates.who || null;
    if ('action' in updates) dbUpdates.title = updates.action || '';
    await supabase.from('actions').update(dbUpdates).eq('id', id);
    setAllActions(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
    if (act.hazardRef && act.source_document_id && act.sourceFolderId) {
      const merged = { ...act, ...updates };
      void fetch('/api/datto/file/writeback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: act.source_document_id,
          folderId: act.sourceFolderId,
          fileName: act.source,
          hazardRef: act.hazardRef,
          actionText: merged.action || undefined,
          responsiblePerson: merged.who || undefined,
          targetDate: merged.date ? toUKDate(merged.date) : undefined,
        }),
      });
    }
  };
  const handleSiteClick = (site: Site) => { setSelectedSite(site); setView('site'); if (isViewOnly) setSiteTab(site.datto_folder_id ? 'files' : 'documents'); recalcActionProgress(site.id); refreshComplianceScore(site.id); };
  const handleSaveSyncConfig = (siteId: string, includedIds: string[]) => {
    setSites(prev => prev.map(s => s.id === siteId ? { ...s, included_datto_folder_ids: includedIds, excluded_datto_folder_ids: [] } : s));
    setSelectedSite(prev => prev?.id === siteId ? { ...prev, included_datto_folder_ids: includedIds, excluded_datto_folder_ids: [] } : prev);
  };
  const handleActionSaved = (action: Action) => {
    setAllActions(prev => [...prev, action]);
    setShowAddAction(false);
    const siteId = sites.find(s => s.name === action.site)?.id ?? selectedSite?.id;
    if (siteId) recalcActionProgress(siteId);
  };

  const writebackActionToDoc = (ra: ReviewAction, completedDate?: string) => {
    if (!ra.hazardRef || !ra.docFileId || !ra.docFolderFileId) return;
    void fetch('/api/datto/file/writeback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: ra.docFileId,
        folderId: ra.docFolderFileId,
        fileName: ra.docName,
        hazardRef: ra.hazardRef,
        actionText: ra.description,
        responsiblePerson: ra.responsiblePerson || undefined,
        targetDate: ra.dueDate ? toUKDate(ra.dueDate) : undefined,
        completedDate: completedDate ? toUKDate(completedDate) : undefined,
      }),
    });
  };

  const handleAddReviewAction = async (actionId: string) => {
    const ra = reviewActions.find(a => a.id === actionId);
    if (!ra || !selectedSite) return;

    const description = reviewDescRefs.current[actionId]?.value ?? ra.description;
    // Dedup check: skip insert if a matching action already exists in any status.
    // Match on site + (file ID or doc name as fallback) + normalised title + hazard_ref.
    {
      let dupQuery = supabase.from('actions')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', selectedSite.id)
        .ilike('title', description.trim());
      dupQuery = ra.docFileId
        ? dupQuery.eq('source_document_id', ra.docFileId)
        : dupQuery.eq('source_document_name', ra.docName);
      dupQuery = ra.hazardRef
        ? dupQuery.eq('hazard_ref', ra.hazardRef)
        : dupQuery.is('hazard_ref', null);
      const { count: dupCount } = await dupQuery;
      if ((dupCount ?? 0) > 0) {
        setReviewActions(prev => prev.map(a => a.id === actionId ? { ...a, added: true } : a));
        return;
      }
    }

    const { data, error: insertErr } = await supabase.from('actions').insert({
      site_id: selectedSite.id,
      title: description,
      description: '',
      priority: 'green',
      status: 'open',
      due_date: ra.dueDate || null,
      source_document_name: ra.docName,
      source_document_id: ra.docFileId || null,
      source_folder_id: ra.docFolderFileId || null,
      source_folder_path: ra.docFolderPath || null,
      hazard_ref: ra.hazardRef || null,
      hazard: ra.hazard || null,
      existing_controls: ra.existingControls || null,
      risk_rating: ra.riskRating || null,
      risk_level: ra.riskLevel || null,
      regulation: ra.regulation || null,
      responsible_person: ra.responsiblePerson || null,
      issue_date: ra.documentMeta?.assessmentDate || null,
      extraction_version: CURRENT_EXTRACTION_VERSION,
    }).select().single();
    if (insertErr) {
      setAiError(`Failed to add action: ${insertErr.message}`);
      return;
    }
    // Set default review_due = issue_date + 1 year in document_health
    if (ra.documentMeta?.assessmentDate && ra.docName) {
      const d = new Date(ra.documentMeta.assessmentDate + 'T00:00:00');
      d.setFullYear(d.getFullYear() + 1);
      void supabase.from('document_health').upsert(
        { site_id: selectedSite.id, document_name: ra.docName, review_due: d.toISOString().slice(0, 10) },
        { onConflict: 'site_id,document_name', ignoreDuplicates: false }
      ).then(null, () => {});
    }
    setReviewActions(prev => prev.map(a => a.id === actionId ? { ...a, added: true, justAdded: true } : a));
    setReviewLog(prev => [...prev, { action: 'added', docName: ra.docName, title: description }]);
    if (data) {
      setAllActions(prev => [...prev, { id: data.id, action: ra.description, description: '', date: ra.dueDate || '', site: selectedSite.name, who: ra.responsiblePerson || '', contractor: '', source: ra.docName, source_document_id: ra.docFileId || '', sourceFolderId: ra.docFolderFileId || null, sourceFolderPath: ra.docFolderPath || null, priority: 'green' as Priority, regulation: ra.regulation || '', notes: '', status: 'open', resolvedDate: null, hazardRef: ra.hazardRef || null, hazard: ra.hazard || null, existingControls: ra.existingControls || null, riskRating: ra.riskRating || null, riskLevel: ra.riskLevel || null, updatedAt: data.updated_at || null, issueDate: ra.documentMeta?.assessmentDate || null }]);
      recalcActionProgress(selectedSite.id);
      writebackActionToDoc(ra);
    }
  };

  const handleAddSelectedReviewActions = async () => {
    const toAdd = reviewActions.filter(a => a.selected && !a.added && !skippedReview.has(a.id));
    for (const ra of toAdd) await handleAddReviewAction(ra.id);
  };

  const skipReviewAction = (id: string) => {
    const ra = reviewActions.find(a => a.id === id);
    if (ra) setReviewLog(prev => [...prev, { action: 'skipped', docName: ra.docName, title: reviewDescRefs.current[id]?.value || ra.description }]);
    setSkippedReview(prev => new Set([...prev, id]));
  };

  const rejectReviewAction = (id: string) => {
    const ra = reviewActions.find(a => a.id === id);
    if (ra) setReviewLog(prev => [...prev, { action: 'rejected', docName: ra.docName, title: reviewDescRefs.current[id]?.value || ra.description }]);
    setReviewActions(prev => prev.filter(a => a.id !== id));
  };

  const skipAllReviewDoc = (docFileId: string) => {
    const items = reviewActions.filter(ra => ra.docFileId === docFileId && !ra.added && !ra.isError && !ra.isUnverified && !skippedReview.has(ra.id));
    setSkippedReview(prev => { const next = new Set(prev); for (const ra of items) next.add(ra.id); return next; });
    setReviewLog(prev => [...prev, ...items.map(ra => ({ action: 'skipped' as const, docName: ra.docName, title: reviewDescRefs.current[ra.id]?.value || ra.description }))]);
  };

  const rejectAllReviewDoc = (docFileId: string) => {
    const ids = reviewActions.filter(ra => ra.docFileId === docFileId && !ra.added && !ra.isError && !ra.isUnverified && !skippedReview.has(ra.id)).map(ra => ra.id);
    for (const id of ids) rejectReviewAction(id);
  };

  const handleUnverifiedProcess = (actionId: string, assessmentDate: string) => {
    const unverified = reviewActions.find(a => a.id === actionId);
    if (!unverified?.isUnverified || !assessmentDate) return;
    const docMeta: DocumentMeta = {
      reviewDate: unverified.documentMeta?.reviewDate ?? null,
      assessor: unverified.documentMeta?.assessor ?? null,
      clientConsulted: unverified.documentMeta?.clientConsulted ?? null,
      documentType: unverified.documentMeta?.documentType ?? 'general_ra',
      assessmentDate,
    };
    const docBaseName = unverified.docName.replace(/\.[^.]+$/, '').toLowerCase();
    const promoted: ReviewAction[] = (unverified.pendingActions ?? []).map(a => {
      const alreadyAdded = allActions.some(e => {
        if (e.site !== selectedSite?.name) return false;
        if (e.source_document_id !== unverified.docFileId) {
          const eBase = (e.source ?? '').replace(/\.[^.]+$/, '').toLowerCase();
          if (eBase !== docBaseName) return false;
        }
        if (e.action === a.description) return true;
        if (textSimilarity(e.action, a.description) > 0.8) return true;
        return false;
      });
      return {
        ...a,
        dueDate: resolveDueDate(a.dueDate, a.dueDateRelative, assessmentDate),
        id: `${unverified.docFileId}-promoted-${Math.random().toString(36).slice(2)}`,
        docName: unverified.docName,
        docFileId: unverified.docFileId,
        docFolderFileId: unverified.docFolderFileId,
        docFolderPath: unverified.docFolderPath,
        documentMeta: docMeta,
        selected: !alreadyAdded,
        added: alreadyAdded,
        advisorPriority: null,
        isUnverified: false,
      };
    });
    setReviewActions(prev => [...prev.filter(a => a.id !== actionId), ...promoted]);
    setUnverifiedDates(prev => { const next = { ...prev }; delete next[actionId]; return next; });
  };

  const handleUnverifiedSkip = (actionId: string) => {
    setReviewActions(prev => prev.filter(a => a.id !== actionId));
    setUnverifiedDates(prev => { const next = { ...prev }; delete next[actionId]; return next; });
  };

  const handleMarkReviewActionResolved = async (actionId: string) => {
    const ra = reviewActions.find(a => a.id === actionId);
    if (!ra || ra.added || !selectedSite) return;
    const today = new Date().toISOString().slice(0, 10);
    const resolvedDate = resolveDates[actionId] || today;

    // Dedup check (same pattern as handleAddReviewAction)
    {
      let dupQuery = supabase.from('actions')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', selectedSite.id)
        .ilike('title', ra.description.trim());
      dupQuery = ra.docFileId
        ? dupQuery.eq('source_document_id', ra.docFileId)
        : dupQuery.eq('source_document_name', ra.docName);
      dupQuery = ra.hazardRef
        ? dupQuery.eq('hazard_ref', ra.hazardRef)
        : dupQuery.is('hazard_ref', null);
      const { count: dupCount } = await dupQuery;
      if ((dupCount ?? 0) > 0) {
        setReviewActions(prev => prev.map(a => a.id === actionId ? { ...a, added: true } : a));
        setResolveExpanded(prev => { const next = { ...prev }; delete next[actionId]; return next; });
        return;
      }
    }

    const { data, error: insertErr } = await supabase.from('actions').insert({
      site_id: selectedSite.id,
      title: ra.description,
      description: '',
      priority: 'green',
      status: 'resolved',
      resolved_date: resolvedDate,
      due_date: ra.dueDate || null,
      source_document_name: ra.docName,
      source_document_id: ra.docFileId || null,
      source_folder_id: ra.docFolderFileId || null,
      source_folder_path: ra.docFolderPath || null,
      hazard_ref: ra.hazardRef || null,
      hazard: ra.hazard || null,
      existing_controls: ra.existingControls || null,
      risk_rating: ra.riskRating || null,
      risk_level: ra.riskLevel || null,
      regulation: ra.regulation || null,
      responsible_person: ra.responsiblePerson || null,
      issue_date: ra.documentMeta?.assessmentDate || null,
      extraction_version: CURRENT_EXTRACTION_VERSION,
    }).select().single();

    if (insertErr) { setAiError(`Failed to add action: ${insertErr.message}`); return; }

    // Upload evidence if a file was selected
    const evidenceFile = resolveFiles[actionId];
    if (evidenceFile && data) {
      setResolveUploading(prev => ({ ...prev, [actionId]: true }));
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const fd = new FormData();
        fd.append('file', evidenceFile);
        fd.append('siteId', selectedSite.id);
        if (user?.id) fd.append('userId', user.id);
        if (ra.docFolderFileId) fd.append('sourceFolderId', ra.docFolderFileId);
        if (ra.hazardRef) fd.append('hazardRef', ra.hazardRef);
        if (ra.docFileId) fd.append('sourceDocumentId', ra.docFileId);
        if (ra.docName) fd.append('sourceDocumentName', ra.docName);
        await fetch(`/api/actions/${data.id}/evidence`, { method: 'POST', body: fd });
      } finally {
        setResolveUploading(prev => ({ ...prev, [actionId]: false }));
      }
    }

    setReviewActions(prev => prev.map(a => a.id === actionId ? { ...a, added: true, justAdded: true } : a));
    setReviewLog(prev => [...prev, { action: 'resolved', docName: ra.docName, title: ra.description }]);
    if (data) {
      setAllActions(prev => [...prev, { id: data.id, action: ra.description, description: '', date: ra.dueDate || '', site: selectedSite.name, who: ra.responsiblePerson || '', contractor: '', source: ra.docName, source_document_id: ra.docFileId || '', sourceFolderId: ra.docFolderFileId || null, sourceFolderPath: ra.docFolderPath || null, priority: 'green' as Priority, regulation: ra.regulation || '', notes: '', status: 'resolved', resolvedDate: resolvedDate, hazardRef: ra.hazardRef || null, hazard: ra.hazard || null, existingControls: ra.existingControls || null, riskRating: ra.riskRating || null, riskLevel: ra.riskLevel || null, updatedAt: data.updated_at || null, issueDate: ra.documentMeta?.assessmentDate || null }]);
      recalcActionProgress(selectedSite.id);
      writebackActionToDoc(ra, resolvedDate);
    }
    // Collapse and clean up
    setResolveExpanded(prev => { const next = { ...prev }; delete next[actionId]; return next; });
    setResolveFiles(prev => { const next = { ...prev }; delete next[actionId]; return next; });
    setResolveDates(prev => { const next = { ...prev }; delete next[actionId]; return next; });
  };

  const handleMarkDocAllResolved = async (docFileId: string) => {
    const docActions = reviewActions.filter(ra => ra.docFileId === docFileId && !ra.added && !ra.isError && !ra.isUnverified);
    if (!docActions.length || !selectedSite) return;
    const today = new Date().toISOString().slice(0, 10);
    const resolvedDate = docResolveDates[docFileId] || today;
    const evidenceFiles = docResolveFiles[docFileId] ?? [];
    setDocResolveUploading(prev => ({ ...prev, [docFileId]: true }));
    const { data: { user } } = await supabase.auth.getUser();
    type SharedEv = { storagePath: string; dattoFileId: string | null; fileName: string; fileSizeBytes: number | null };
    const sharedEvidenceMap = new Map<number, SharedEv>();
    for (const ra of docActions) {
      let dupQuery = supabase.from('actions').select('id', { count: 'exact', head: true }).eq('site_id', selectedSite.id).ilike('title', ra.description.trim());
      dupQuery = ra.docFileId ? dupQuery.eq('source_document_id', ra.docFileId) : dupQuery.eq('source_document_name', ra.docName);
      dupQuery = ra.hazardRef ? dupQuery.eq('hazard_ref', ra.hazardRef) : dupQuery.is('hazard_ref', null);
      const { count: dupCount } = await dupQuery;
      if ((dupCount ?? 0) > 0) { setReviewActions(prev => prev.map(a => a.id === ra.id ? { ...a, added: true } : a)); continue; }
      const { data, error: insertErr } = await supabase.from('actions').insert({
        site_id: selectedSite.id, title: ra.description, description: '', priority: 'green',
        status: 'resolved', resolved_date: resolvedDate, due_date: ra.dueDate || null,
        source_document_name: ra.docName, source_document_id: ra.docFileId || null,
        source_folder_id: ra.docFolderFileId || null, source_folder_path: ra.docFolderPath || null,
        hazard_ref: ra.hazardRef || null, hazard: ra.hazard || null, existing_controls: ra.existingControls || null,
        risk_rating: ra.riskRating || null, risk_level: ra.riskLevel || null, regulation: ra.regulation || null,
        responsible_person: ra.responsiblePerson || null, issue_date: ra.documentMeta?.assessmentDate || null,
      }).select().single();
      if (insertErr) continue;
      if (evidenceFiles.length > 0 && data) {
        for (let i = 0; i < evidenceFiles.length; i++) {
          if (!sharedEvidenceMap.has(i)) {
            const fd = new FormData();
            fd.append('file', evidenceFiles[i]);
            fd.append('siteId', selectedSite.id);
            if (user?.id) fd.append('userId', user.id);
            if (ra.docFolderFileId) fd.append('sourceFolderId', ra.docFolderFileId);
            if (ra.hazardRef) fd.append('hazardRef', ra.hazardRef);
            if (ra.docFileId) fd.append('sourceDocumentId', ra.docFileId);
            if (ra.docName) fd.append('sourceDocumentName', ra.docName);
            const res = await fetch(`/api/actions/${data.id}/evidence`, { method: 'POST', body: fd });
            const json = await res.json().catch(() => null);
            if (json?.evidence) sharedEvidenceMap.set(i, { storagePath: json.evidence.storagePath, dattoFileId: json.evidence.dattoFileId ?? null, fileName: json.evidence.fileName, fileSizeBytes: json.evidence.fileSizeBytes ?? null });
          } else {
            const shared = sharedEvidenceMap.get(i)!;
            await fetch(`/api/actions/${data.id}/evidence`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storage_path: shared.storagePath, datto_file_id: shared.dattoFileId, file_name: shared.fileName, file_size_bytes: shared.fileSizeBytes, site_id: selectedSite.id, user_id: user?.id || null, hazard_ref: ra.hazardRef || null, source_document_id: ra.docFileId || null }) });
          }
        }
      }
      setReviewActions(prev => prev.map(a => a.id === ra.id ? { ...a, added: true, justAdded: true } : a));
      setReviewLog(prev => [...prev, { action: 'resolved', docName: ra.docName, title: ra.description }]);
      if (data) {
        setAllActions(prev => [...prev, { id: data.id, action: ra.description, description: '', date: ra.dueDate || '', site: selectedSite.name, who: ra.responsiblePerson || '', contractor: '', source: ra.docName, source_document_id: ra.docFileId || '', sourceFolderId: ra.docFolderFileId || null, sourceFolderPath: ra.docFolderPath || null, priority: 'green' as Priority, regulation: ra.regulation || '', notes: '', status: 'resolved', resolvedDate: resolvedDate, hazardRef: ra.hazardRef || null, hazard: ra.hazard || null, existingControls: ra.existingControls || null, riskRating: ra.riskRating || null, riskLevel: ra.riskLevel || null, updatedAt: data.updated_at || null, issueDate: ra.documentMeta?.assessmentDate || null }]);
        writebackActionToDoc(ra, resolvedDate);
      }
    }
    setDocResolveUploading(prev => ({ ...prev, [docFileId]: false }));
    recalcActionProgress(selectedSite.id);
    setDocResolveExpanded(prev => { const next = { ...prev }; delete next[docFileId]; return next; });
    setDocResolveFiles(prev => ({ ...prev, [docFileId]: [] }));
    setDocResolveDates(prev => { const next = { ...prev }; delete next[docFileId]; return next; });
  };

  const EXCLUDED_FOLDERS = ['archive', 'evidence', 'photos', '_doc_converted_tmp', 'client provided documents', 'vault', 'z-archive manual'];
  const ROOT_FOLDER_ID = '1239993420';

  const fetchAllFiles = async (
    folderId: string,
    userExcludedIds: Set<string> = new Set(),
    currentPath = '',
    browseMode = false
  ): Promise<(DattoItem & { parentFolderId: string; folderPath: string })[]> => {
    const res = await fetch(`/api/datto?folderId=${folderId}`);
    if (!res.ok) return [];
    const raw = await res.json();
    const items = normaliseItems(raw);
    const files = items
      .filter((i: DattoItem) => i.type === 'file')
      .map((i: DattoItem) => ({ ...i, parentFolderId: folderId, folderPath: currentPath }));
    const folders = items.filter((i: DattoItem) =>
      i.type === 'folder'
      && (browseMode || !EXCLUDED_FOLDERS.includes(i.name.toLowerCase()))
      && !userExcludedIds.has(i.id)
    );
    const subFiles = await Promise.all(
      folders.map((f: DattoItem) =>
        fetchAllFiles(f.id, userExcludedIds, currentPath ? `${currentPath}/${f.name}` : f.name, browseMode)
      )
    );
    return [...files, ...subFiles.flat()];
  };

  const resolvePathFromRoot = async (site: Site): Promise<string> => {
    // Use stored path if available — avoids unreliable runtime API resolution
    if (site.datto_folder_path) return site.datto_folder_path;
    const org = organisations.find(o => o.id === site.organisation_id);
    const segments: string[] = [];
    try {
      // Client folders live under DATTO_ROOT_ID ("Customer Documents"), not ROOT_FOLDER_ID
      const customerDocsItems = normaliseItems(await (await fetch(`/api/datto?folderId=${DATTO_ROOT_ID}`)).json());
      if (org?.datto_folder_id) {
        const orgFolder = customerDocsItems.find((i: DattoItem) => i.id === org.datto_folder_id);
        if (orgFolder) {
          segments.push(orgFolder.name);
          // If site has its own distinct folder, find it within the org folder
          if (site.datto_folder_id && site.datto_folder_id !== org.datto_folder_id) {
            try {
              const orgItems = normaliseItems(await (await fetch(`/api/datto?folderId=${org.datto_folder_id}`)).json());
              const siteFolder = orgItems.find((i: DattoItem) => i.id === site.datto_folder_id);
              if (siteFolder) segments.push(siteFolder.name);
            } catch {}
          }
        }
      } else if (site.datto_folder_id) {
        // Org has no folder ID — look up the site folder directly in Customer Documents
        const siteFolder = customerDocsItems.find((i: DattoItem) => i.id === site.datto_folder_id);
        if (siteFolder) segments.push(siteFolder.name);
      }
    } catch {}
    return segments.join('/');
  };

  const loadFolder = async (folderId: string, path: string) => {
    setLoadingFolderIds(prev => { const s = new Set(prev); s.add(folderId); return s; });
    try {
      const res = await fetch(`/api/datto?folderId=${folderId}`);
      if (!res.ok) return;
      const items = normaliseItems(await res.json());
      setFolderData(prev => new Map(prev).set(folderId, { items, path }));
    } finally {
      setLoadingFolderIds(prev => { const s = new Set(prev); s.delete(folderId); return s; });
    }
  };

  const ukToIso = (raw: string): string => {
    const m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (!m) return raw;
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  };
  const resolveDueDate = (dueDate: string | null, dueDateRelative: string | null, assessmentDate: string | null): string | null => {
    if (dueDate) return ukToIso(dueDate);
    if (!dueDateRelative) return null;
    const base = assessmentDate ? new Date(assessmentDate) : new Date();
    const lower = dueDateRelative.toLowerCase();
    const n = (pattern: RegExp) => { const m = lower.match(pattern); return m ? parseInt(m[1]) : 0; };
    const months = n(/(\d+)\s*month/); const weeks = n(/(\d+)\s*week/); const days = n(/(\d+)\s*day/); const years = n(/(\d+)\s*year/);
    if (months) base.setMonth(base.getMonth() + months);
    else if (weeks) base.setDate(base.getDate() + weeks * 7);
    else if (days) base.setDate(base.getDate() + days);
    else if (years) base.setFullYear(base.getFullYear() + years);
    else return dueDateRelative; // pass through text like "Ongoing", "Continuous" etc.
    return base.toISOString().split('T')[0];
  };
  const [syncingDocId, setSyncingDocId] = useState<string | null>(null);
  const handleAiSync = async (site: Site, forceAll = false, singleFileId?: string) => {
    if (!site.datto_folder_id) return;
    aiCancelledRef.current = false;
    setAiSyncing(true);
    setAiError(null);
    setAiStatusMessage('');
    setReviewActions([]);
    setReviewLog([]);
    setReviewLogExpanded(false);
    setSkippedReview(new Set());
    setShowAiPanel(true);
    try {
      // Trigger server-side Datto existence check — removes advisor docs deleted from Datto + their actions
      await fetch(`/api/documents?siteId=${site.id}&clientProvided=false`);
      // Re-fetch allActions so duplicate detection uses current DB state, not stale mount-time state
      const priorityMap: Record<string, Priority> = { critical: 'red', upcoming: 'amber', scheduled: 'green', red: 'red', amber: 'amber', green: 'green' };
      const siteIds = [...new Set([...sites.map(s => s.id), site.id])];
      const { data: freshActionsData } = await supabase.from('actions').select('*').in('site_id', siteIds).neq('status', 'ai_suggested');
      const freshDocIds = Array.from(new Set((freshActionsData ?? []).map((a: any) => a.source_document_id).filter(Boolean)));
      const freshDocMap: Record<string, string | null> = {};
      if (freshDocIds.length > 0) {
        const { data: freshDocs } = await supabase.from('site_documents').select('id, datto_file_id').in('datto_file_id', freshDocIds);
        (freshDocs ?? []).forEach((d: any) => { freshDocMap[d.datto_file_id] = d.datto_file_id ?? null; });
      }
      const currentActions: Action[] = freshActionsData ? freshActionsData.filter((a: any) => !a.site_document_id).map((a: any) => ({ id: a.id, action: a.title, description: a.description || '', date: a.due_date || '', site: sites.find(s => s.id === a.site_id)?.name || '', who: a.responsible_person || '', contractor: a.contractor || '', source: a.source_document_name || '', source_document_id: a.source_document_id || '', priority: (priorityMap[a.priority] || 'green') as Priority, regulation: a.regulation || '', notes: '', status: a.status as ActionStatus, hazardRef: a.hazard_ref || null, hazard: a.hazard || null, existingControls: a.existing_controls || null, riskRating: a.risk_rating || null, riskLevel: a.risk_level || null, resolvedDate: a.resolved_date || null, sourceFolderId: a.source_folder_id || null, isSuggested: a.is_suggested ?? false, dattoFileId: a.source_document_id ? (freshDocMap[a.source_document_id] ?? null) : null })) : allActions;
      setAllActions(currentActions);
      setAiSyncProgress('Scanning folders…');
      const rootPath = await resolvePathFromRoot(site);
      const includedFolderIds = site.included_datto_folder_ids;
      let allItems;
      if (includedFolderIds && includedFolderIds.length > 0) {
        // Opt-in mode: walk the full tree (so subfolder paths are correct) then filter
        // to only files whose direct parent is one of the selected folder IDs.
        // Previously fetched only direct children with folderPath = rootPath, which
        // lost the subfolder path and broke the W: drive "Open Doc" link.
        const includedSet = new Set(includedFolderIds.map(String));
        const userExcludedIds = new Set(site.excluded_datto_folder_ids ?? []);
        const allFilesFromRoot = await fetchAllFiles(site.datto_folder_id, userExcludedIds, rootPath);
        allItems = allFilesFromRoot.filter(f => includedSet.has(String(f.parentFolderId)));
      } else {
        // Fallback: old exclusion model
        const userExcludedIds = new Set(site.excluded_datto_folder_ids ?? []);
        allItems = await fetchAllFiles(site.datto_folder_id, userExcludedIds, rootPath);
      }

      // Refresh stale source_folder_path for actions whose Datto folder was renamed since last sync.
      // Uses source_document_id (Datto file ID) to match actions to their current live folder path.
      {
        const livePathMap = new Map<string, string>(allItems.map(f => [String(f.id), f.folderPath ?? ''] as [string, string]));
        const liveNameMap = new Map<string, string>(allItems.map(f => [String(f.id), f.name] as [string, string]));
        const staleActions = currentActions.filter(a =>
          a.source_document_id &&
          livePathMap.has(String(a.source_document_id)) && (
            livePathMap.get(String(a.source_document_id)) !== a.sourceFolderPath ||
            liveNameMap.get(String(a.source_document_id)) !== a.source
          )
        );
        if (staleActions.length > 0) {
          await Promise.all(staleActions.map(a => {
            const updates: Record<string, string> = {};
            const newPath = livePathMap.get(String(a.source_document_id));
            const newName = liveNameMap.get(String(a.source_document_id));
            if (newPath !== undefined && newPath !== a.sourceFolderPath) updates.source_folder_path = newPath;
            if (newName !== undefined && newName !== a.source) updates.source_document_name = newName;
            return supabase.from('actions').update(updates).eq('id', a.id);
          }));
          setAllActions(prev => prev.map(a => {
            const newPath = livePathMap.get(String(a.source_document_id));
            const newName = liveNameMap.get(String(a.source_document_id));
            const pathChanged = newPath !== undefined && newPath !== a.sourceFolderPath;
            const nameChanged = newName !== undefined && newName !== a.source;
            if (!pathChanged && !nameChanged) return a;
            return { ...a, ...(pathChanged ? { sourceFolderPath: newPath! } : {}), ...(nameChanged ? { source: newName! } : {}) };
          }));
        }
      }

      const SUPPORTED_EXTS = ['.docx', '.doc', '.pdf', '.xlsx', '.xls'];
      let docxFiles = allItems.filter(i =>
        SUPPORTED_EXTS.some(ext => i.name.toLowerCase().endsWith(ext)) &&
        !i.name.toLowerCase().includes('draft')
      );

      // Deduplicate: prefer Office docs over PDFs when both exist for the same RA.
      // Pass 1 — exact stem match (same folder + same base name, different extension).
      // Pass 2 — fuzzy match: within the same folder, if a PDF shares ≥50% of its
      //           meaningful words with an Office doc, drop the PDF.
      const OFFICE_EXTS = new Set(['.docx', '.doc', '.xlsx', '.xls']);
      const stemWords = (name: string): string[] =>
        name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
      const wordOverlap = (a: string[], b: string[]): number => {
        const setB = new Set(b);
        const matches = a.filter(w => setB.has(w)).length;
        return matches / Math.min(a.length, b.length);
      };

      // Pass 1: exact stem dedup (folder + base name)
      const stemMap = new Map<string, typeof docxFiles[0]>();
      for (const f of docxFiles) {
        const stem = `${(f.folderPath ?? '').toLowerCase()}::${f.name.toLowerCase().replace(/\.[^.]+$/, '')}`;
        const ext = (f.name.toLowerCase().match(/\.[^.]+$/) ?? [''])[0];
        const prev = stemMap.get(stem);
        if (!prev) {
          stemMap.set(stem, f);
        } else {
          const prevIsOffice = OFFICE_EXTS.has((prev.name.toLowerCase().match(/\.[^.]+$/) ?? [''])[0]);
          if (!prevIsOffice && OFFICE_EXTS.has(ext)) stemMap.set(stem, f);
        }
      }
      let deduped = Array.from(stemMap.values());

      // Pass 2: fuzzy dedup — drop PDFs that overlap with an Office doc in the same folder
      const officeByFolder = new Map<string, (typeof deduped[0])[]>();
      for (const f of deduped) {
        const ext = (f.name.toLowerCase().match(/\.[^.]+$/) ?? [''])[0];
        if (!OFFICE_EXTS.has(ext)) continue;
        const folder = (f.folderPath ?? '').toLowerCase();
        if (!officeByFolder.has(folder)) officeByFolder.set(folder, []);
        officeByFolder.get(folder)!.push(f);
      }
      deduped = deduped.filter(f => {
        const ext = (f.name.toLowerCase().match(/\.[^.]+$/) ?? [''])[0];
        if (OFFICE_EXTS.has(ext)) return true; // always keep Office docs
        const folder = (f.folderPath ?? '').toLowerCase();
        const officeDocs = officeByFolder.get(folder);
        if (!officeDocs?.length) return true; // no Office docs in this folder — keep the PDF
        const pdfWords = stemWords(f.name);
        return !officeDocs.some(od => wordOverlap(pdfWords, stemWords(od.name)) >= 0.5);
      });
      docxFiles = deduped;

      // True two-way sync: remove portal actions for docs no longer present in Datto.
      // Covers AI-sync-only docs (no site_documents entry) — the site_documents cascade in
      // /api/documents handles upload-linked docs separately.
      {
        const allDattoFileIds = new Set(allItems.map((f: any) => String(f.id)));
        const uniquePortalDocIds = [
          ...new Set(
            currentActions
              .filter((a: Action) => a.source_document_id && !a.dattoFileId)
              .map((a: Action) => String(a.source_document_id))
          )
        ];
        const missingDocIds = uniquePortalDocIds.filter(id => !allDattoFileIds.has(id));
        if (missingDocIds.length > 0) {
          const missingSet = new Set(missingDocIds);
          await supabase.from('actions').delete().in('source_document_id', missingDocIds).eq('site_id', site.id);
          setAllActions(prev => prev.filter(a => !missingSet.has(String(a.source_document_id))));
        }
      }

      const THREE_YEARS_AGO = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).getTime();
      if (!forceAll && site.last_ai_sync) {
        const lastSync = new Date(site.last_ai_sync).getTime();
        docxFiles = docxFiles.filter(i => {
          const mod = i.modified || null;
          if (!mod) return true;
          return new Date(mod).getTime() > lastSync;
        });
      }
      if (!forceAll) {
        docxFiles = docxFiles.filter(i => {
          const mod = i.modified || null;
          if (!mod) return true;
          return new Date(mod).getTime() > THREE_YEARS_AGO;
        });
      }
      if (singleFileId) {
        docxFiles = docxFiles.filter(f => String(f.id) === String(singleFileId));
      }
      if (docxFiles.length === 0) {
        setAiStatusMessage(site.last_ai_sync && !forceAll ? 'No new documents since last sync. Use "Sync all" to reprocess everything.' : 'No supported documents found in this folder.');
        return;
      }
      const processDoc = async (i: number) => {
        if (aiCancelledRef.current) return;
        const doc = docxFiles[i];
        setAiSyncProgress(`Processing ${i + 1}/${docxFiles.length}: ${doc.name}`);
        try {
          const ext = doc.name.split('.').pop()?.toLowerCase() || '';
          // PDFs are fetched server-side in ai-extract via Gemini File API — skip browser download
          let buffer: ArrayBuffer = new ArrayBuffer(0);
          if (ext !== 'pdf' && ext !== 'doc') {
            const fileRes = await fetch(`/api/datto/file?fileId=${doc.id}&fileName=${encodeURIComponent(doc.name)}`);
            if (!fileRes.ok) throw new Error(`Failed to fetch ${doc.name}`);
            buffer = await fileRes.arrayBuffer();
          }

          let aiBody: Record<string, string>;
          if (ext === 'docx') {
            // Validate DOCX is a real ZIP (magic bytes PK\x03\x04)
            const magic = new Uint8Array(buffer.slice(0, 4));
            if (magic[0] !== 0x50 || magic[1] !== 0x4B || magic[2] !== 0x03 || magic[3] !== 0x04) {
              throw new Error(`${doc.name} appears corrupted (not a valid DOCX file) — re-upload a repaired version`);
            }
            const extracted = await mammoth.convertToHtml({ arrayBuffer: buffer });
            // Fix encoding artifacts but preserve HTML tags so Gemini can read table structure
            const htmlContent = extracted.value
              .replace(/â€¦/g, '…').replace(/â€™/g, '\u2019').replace(/â€œ/g, '\u201C')
              .replace(/â€/g, '\u201D').replace(/Ã©/g, 'é').replace(/Â·/g, '·').replace(/Â /g, ' ');
            if (htmlContent.trim()) {
              // Truncate if too large for Gemini (~200K token safe ceiling, accounting for HTML tag overhead)
              const MAX_HTML_CHARS = 800_000;
              const finalHtml = htmlContent.length > MAX_HTML_CHARS
                ? (() => {
                    console.warn(`[AI Sync] ${doc.name} HTML too large (${htmlContent.length} chars), truncating`);
                    const head = htmlContent.slice(0, 15_000);
                    const tail = htmlContent.slice(-(MAX_HTML_CHARS - 15_000));
                    return head + '\n<!-- [document truncated — middle section omitted for size] -->\n' + tail;
                  })()
                : htmlContent;
              aiBody = { html: finalHtml, docName: doc.name };
            } else {
              // Fallback: convert to PDF via CloudConvert, send as base64
              const convertRes = await fetch(`/api/convert?fileId=${doc.id}&fileName=${encodeURIComponent(doc.name)}&noCache=true`);
              if (!convertRes.ok) throw new Error(`Could not extract text from ${doc.name}`);
              const pdfBuffer = await convertRes.arrayBuffer();
              const bytes = new Uint8Array(pdfBuffer);
              let binary = '';
              for (let b = 0; b < bytes.byteLength; b++) binary += String.fromCharCode(bytes[b]);
              const fallbackBase64 = btoa(binary);
              if (fallbackBase64.length > 5_000_000) {
                throw new Error('Document too large for AI extraction (PDF exceeds size limit) — consider splitting it or converting to a shorter DOCX');
              }
              aiBody = { fileBase64: fallbackBase64, mimeType: 'application/pdf', docName: doc.name };
            }
          } else if (ext === 'doc') {
            throw new Error(`"${doc.name}" is in legacy .doc format — open it in Word, run the batch conversion macro or go to File → Save As → Word Document (.docx), then re-sync.`);
          } else if (ext === 'xlsx' || ext === 'xls') {
            const workbook = XLSX.read(buffer);
            const text = workbook.SheetNames.map(name =>
              `Sheet: ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`
            ).join('\n\n');
            aiBody = { text, docName: doc.name };
          } else if (ext === 'pdf') {
            // Server downloads from Datto and uploads to Gemini File API — handles any size
            aiBody = { dattoFileId: String(doc.id), mimeType: 'application/pdf', docName: doc.name };
          } else {
            throw new Error(`Unsupported file type: .${ext}`);
          }

          let aiRes = await fetch('/api/ai-extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...aiBody, siteId: site.id, organisationId: site.organisation_id }),
          });
          if (!aiRes.ok) {
            const errBody = await aiRes.json().catch(() => ({}));
            const errMsg: string = errBody.error || aiRes.statusText;
            // If token limit exceeded and we sent HTML, retry with stripped plain text
            if (/token count exceeds|input token/i.test(errMsg) && 'html' in aiBody) {
              const plainText = (aiBody as any).html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400_000);
              aiRes = await fetch('/api/ai-extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: plainText, docName: doc.name, siteId: site.id, organisationId: site.organisation_id }),
              });
              if (!aiRes.ok) {
                const retryErr = await aiRes.json().catch(() => ({}));
                throw new Error(`AI extraction failed for ${doc.name}: ${retryErr.error || aiRes.statusText}`);
              }
            } else {
              throw new Error(`AI extraction failed for ${doc.name}: ${errMsg}`);
            }
          }
          const { actions: _rawActions, documentMeta } = await aiRes.json();
          // Drop actions with blank description; move non-ISO-date text out of dueDate
          const actions = (_rawActions as any[] ?? [])
            .filter((a: any) => (a.description ?? '').toString().trim().length > 0)
            .map((a: any) => {
              const d = (a.dueDate ?? '').toString().trim();
              if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
                return { ...a, dueDate: null, dueDateRelative: a.dueDateRelative ?? d };
              }
              return a;
            });
          const documentType: DocumentMeta['documentType'] = (documentMeta as DocumentMeta)?.documentType ?? 'general_ra';

          // COSHH: controls document — generate one ongoing review action instead of an error
          if (documentType === 'coshh') {
            if (!documentMeta?.assessmentDate) {
              setReviewActions(prev => [...prev, { id: `skipped-${doc.id}`, description: '', dueDate: null, dueDateRelative: null, responsiblePerson: null, priority: null, advisorPriority: null, docName: doc.name, docFileId: doc.id, docFolderFileId: doc.parentFolderId, docFolderPath: doc.folderPath ?? '', selected: false, added: false, isError: true, errorMessage: 'No assessment date found — document appears to be an unfilled template and was skipped.', hazardRef: null, hazard: null, existingControls: null, regulation: null, riskRating: null, riskLevel: null, documentMeta: null }]);
            } else {
              setReviewActions(prev => [...prev, { id: `coshh-review-${doc.id}`, description: 'Review and update COSHH assessment — confirm controls remain adequate and substance/process has not changed', dueDate: null, dueDateRelative: 'Ongoing', responsiblePerson: null, priority: null, advisorPriority: null, hazardRef: null, hazard: 'Chemical/substance exposure', existingControls: null, regulation: 'COSHH Regulations 2002', riskRating: null, riskLevel: null, docName: doc.name, docFileId: doc.id, docFolderFileId: doc.parentFolderId, docFolderPath: doc.folderPath ?? '', selected: true, added: false, isError: false, documentMeta: documentMeta ?? null }]);
            }
            return;
          }

          // DSE: checklist — extract NO answers as actions; if all compliant generate annual review
          if (documentType === 'dse') {
            if (!documentMeta?.assessmentDate) {
              setReviewActions(prev => [...prev, { id: `skipped-${doc.id}`, description: '', dueDate: null, dueDateRelative: null, responsiblePerson: null, priority: null, advisorPriority: null, docName: doc.name, docFileId: doc.id, docFolderFileId: doc.parentFolderId, docFolderPath: doc.folderPath ?? '', selected: false, added: false, isError: true, errorMessage: 'No assessment date found — document appears to be an unfilled template and was skipped.', hazardRef: null, hazard: null, existingControls: null, regulation: null, riskRating: null, riskLevel: null, documentMeta: null }]);
              return;
            }
            if ((actions as ExtractedAction[]).length === 0) {
              setReviewActions(prev => [...prev, { id: `dse-review-${doc.id}`, description: 'Annual DSE workstation review — confirm all workstation requirements continue to be met', dueDate: null, dueDateRelative: 'Annual review', responsiblePerson: null, priority: null, advisorPriority: null, hazardRef: null, hazard: 'Display screen equipment use', existingControls: null, regulation: 'Health and Safety (Display Screen Equipment) Regulations 1992', riskRating: null, riskLevel: 'LOW', docName: doc.name, docFileId: doc.id, docFolderFileId: doc.parentFolderId, docFolderPath: doc.folderPath ?? '', selected: true, added: false, isError: false, documentMeta: documentMeta ?? null }]);
              return;
            }
            // Fall through to normal processing if Gemini found NO-answer actions
          }

          // General: no date → decide if possibly genuine or a blank template.
          // Genuine signals require name or hazard-ref evidence — pre-populated template
          // actions alone are not enough (templates often ship with example actions).
          if (!documentMeta?.assessmentDate) {
            const _trimSig = (s: string | null | undefined) => (s ?? '').trim();
            const typedActions = actions as ExtractedAction[];

            const hasAssessor       = !!_trimSig(documentMeta?.assessor);
            const hasClientName     = !!_trimSig(documentMeta?.clientConsulted);
            const hasResponsible    = typedActions.some(a => !!_trimSig(a.responsiblePerson));
            const hasHazardRef      = typedActions.some(a => !!_trimSig(a.hazardRef));
            const isGenuine         = hasAssessor || hasClientName || hasResponsible || hasHazardRef;

            const signals: string[] = [];
            if (hasAssessor)    signals.push(`Assessor: ${_trimSig(documentMeta.assessor)}`);
            if (hasClientName)  signals.push(`Person assessed: ${_trimSig(documentMeta.clientConsulted)}`);
            if (hasResponsible) {
              const names = [...new Set(typedActions.map(a => _trimSig(a.responsiblePerson)).filter(Boolean))];
              signals.push(`Responsible: ${names.slice(0, 2).join(', ')}${names.length > 2 ? '…' : ''}`);
            }
            if (hasHazardRef) {
              const refCount = typedActions.filter(a => !!_trimSig(a.hazardRef)).length;
              signals.push(`${refCount} action${refCount !== 1 ? 's' : ''} with hazard refs`);
            }

            if (isGenuine) {
              setReviewActions(prev => [...prev, {
                id: `unverified-${doc.id}`, description: '', dueDate: null, dueDateRelative: null,
                responsiblePerson: null, priority: null, advisorPriority: null,
                hazardRef: null, hazard: null, existingControls: null,
                regulation: null, riskRating: null, riskLevel: null,
                docName: doc.name, docFileId: doc.id,
                docFolderFileId: doc.parentFolderId, docFolderPath: doc.folderPath ?? '',
                selected: false, added: false, isError: false,
                isUnverified: true, unverifiedSignals: signals,
                pendingActions: actions as ExtractedAction[],
                documentMeta: documentMeta ?? null,
              }]);
            } else {
              setReviewActions(prev => [...prev, {
                id: `skipped-${doc.id}`, description: '', dueDate: null, dueDateRelative: null,
                responsiblePerson: null, priority: null, advisorPriority: null,
                docName: doc.name, docFileId: doc.id,
                docFolderFileId: doc.parentFolderId, docFolderPath: doc.folderPath ?? '',
                selected: false, added: false, isError: true,
                errorMessage: 'No assessment date found — document appears to be an unfilled template and was skipped.',
                hazardRef: null, hazard: null, existingControls: null,
                regulation: null, riskRating: null, riskLevel: null, documentMeta: null,
              }]);
            }
            return;
          }
          console.log(`[AI-SYNC] ${doc.name} — Gemini returned ${(actions as ExtractedAction[]).length} actions:`);
          (actions as ExtractedAction[]).forEach((a: ExtractedAction, i: number) => console.log(`  [${i}] hazardRef=${a.hazardRef ?? 'null'} riskRating="${a.riskRating}" riskLevel=${a.riskLevel} | "${a.description}"`));
          // For DOCX: read action plan table to enrich AI actions with hazardRefs + two-way sync
          type ReadRow = { hazardRef: string; actionText: string; responsiblePerson: string; targetDate: string; completedDate: string; riskRating: string };
          let readRows: ReadRow[] = [];
          // Also fetch structured HTML hazard descriptions from the document parser
          let parsedHazards: { ref: string; description: string; existingControls?: string }[] = [];
          if (ext === 'docx') {
            const [readResRaw, hazardsResRaw] = await Promise.all([
              fetch(`/api/datto/file/readactions?fileId=${doc.id}`).catch(() => null),
              fetch(`/api/datto/file/hazards?fileId=${doc.id}`).catch(() => null),
            ]);
            try { if (readResRaw?.ok) { const { rows } = await readResRaw.json(); if (rows) readRows = rows; } } catch { /* non-fatal */ }
            try { if (hazardsResRaw?.ok) { const { hazards } = await hazardsResRaw.json(); if (hazards?.length > 0) parsedHazards = hazards; } } catch { /* non-fatal */ }
          }
          console.log(`[AI-SYNC] ${doc.name} — readactions returned ${readRows.length} rows:`, readRows.map(r => `${r.hazardRef}:"${r.actionText}" risk="${r.riskRating}"`));

          // Enrich AI actions that lack hazardRef by matching against action plan table rows
          if (readRows.length > 0) {
            const usedRefs = new Set<string>(
              (actions as ExtractedAction[]).filter(a => a.hazardRef).map(a => a.hazardRef as string)
            );
            for (const a of actions as ExtractedAction[]) {
              if (a.hazardRef) continue;
              let bestRef: string | null = null; let bestScore = 0.8;
              for (const row of readRows) {
                if (!row.hazardRef || usedRefs.has(row.hazardRef)) continue;
                const score = textSimilarity(a.description, row.actionText);
                if (score > bestScore) { bestScore = score; bestRef = row.hazardRef; }
              }
              if (bestRef) { a.hazardRef = bestRef; usedRefs.add(bestRef); }
            }
          }
          console.log(`[AI-SYNC] ${doc.name} — after enrichment:`);
          (actions as ExtractedAction[]).forEach((a: ExtractedAction, i: number) => console.log(`  [${i}] hazardRef=${a.hazardRef ?? 'null'} | "${a.description}"`));

          const portalActionsForDoc = currentActions.filter(e => e.source_document_id === doc.id);
          console.log(`[AI-SYNC] ${doc.name} — portal actions for this doc (${portalActionsForDoc.length}):`, portalActionsForDoc.map(e => `ref=${e.hazardRef ?? 'null'} "${e.action}"`));

          // Build a lookup: hazardRef → parsed HTML description from document parser
          const parsedHazardMap = new Map(parsedHazards.map(h => [String(h.ref), h]));
          // Build a lookup: hazardRef → all readactions rows (multiple rows per ref allowed)
          const readRowsByRef = new Map<string, typeof readRows>();
          for (const r of readRows) {
            if (!r.hazardRef) continue;
            const key = String(r.hazardRef).trim();
            if (!readRowsByRef.has(key)) readRowsByRef.set(key, []);
            readRowsByRef.get(key)!.push(r);
          }
          // Find best-matching row for a hazardRef given an action text (exact → includes → first)
          const bestReadRow = (hazardRef: string | null | undefined, actionText: string | null | undefined) => {
            if (!hazardRef) return undefined;
            const rows = readRowsByRef.get(String(hazardRef).trim());
            if (!rows || rows.length === 0) return undefined;
            if (rows.length === 1) return rows[0];
            if (!actionText) return rows[0];
            const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
            const needle = norm(actionText);
            const exact = rows.find(r => norm(r.actionText) === needle);
            if (exact) return exact;
            const includes = rows.find(r => norm(r.actionText).includes(needle) || needle.includes(norm(r.actionText)));
            return includes ?? rows[0];
          };

          const newActions: ReviewAction[] = (actions as ExtractedAction[]).map((a: ExtractedAction) => {
            const parsedH = a.hazardRef ? parsedHazardMap.get(String(a.hazardRef)) : undefined;
            // Risk rating from the actions table takes precedence over Gemini's inference
            const tableRow = bestReadRow(a.hazardRef, a.description);
            const tableRiskRating = tableRow?.riskRating || null;
            const tableRiskLevel = tableRiskRating ? (normaliseRiskLevel(tableRiskRating)?.toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW' | null ?? null) : null;
            const portalActionsForRef = a.hazardRef
              ? currentActions.filter(e => e.source_document_id === doc.id && e.site === site.name && String(e.hazardRef) === String(a.hazardRef))
              : [];
            const geminiCountForRef = a.hazardRef
              ? (actions as ExtractedAction[]).filter(ga => String(ga.hazardRef) === String(a.hazardRef)).length
              : 0;
            const alreadyAdded = (() => {
              if (a.hazardRef && portalActionsForRef.length > 0) {
                // Edited action: same or fewer doc rows than portal rows for this ref → update via two-way sync
                if (geminiCountForRef <= portalActionsForRef.length) return true;
                // Extra rows beyond what's in the portal → new; but existing text matches are still duplicates
                return portalActionsForRef.some(e => e.action === a.description || textSimilarity(e.action, a.description) > 0.8);
              }
              // No hazardRef or no portal match for this ref — fall back to text matching
              // Also match across same-named documents (e.g. .docx and .pdf of same file)
              const docBaseName = doc.name.replace(/\.[^.]+$/, '').toLowerCase();
              return currentActions.some(e => {
                if (e.site !== site.name) return false;
                if (e.source_document_id !== doc.id) {
                  // Only cross-doc match if the source document has the same base name
                  const eBase = (e.source ?? '').replace(/\.[^.]+$/, '').toLowerCase();
                  if (eBase !== docBaseName) return false;
                }
                if (e.action === a.description) return true;
                if (textSimilarity(e.action, a.description) > 0.8) return true;
                return false;
              });
            })();
            console.log(`  [DUP-CHECK] "${a.description}" hazardRef=${a.hazardRef ?? 'null'} → alreadyAdded=${alreadyAdded}`);
            return {
              ...a,
              // Use document-parser HTML over Gemini plain text for structure-preserving rendering
              hazard: parsedH?.description ?? a.hazard,
              existingControls: parsedH?.existingControls ?? a.existingControls,
              // Actions-table risk rating is authoritative — overrides Gemini's inferred value
              riskRating: tableRiskRating ?? a.riskRating,
              riskLevel: tableRiskLevel ?? a.riskLevel, // prefer table-derived level; fall back to Gemini
              dueDate: resolveDueDate(a.dueDate, a.dueDateRelative, documentMeta?.assessmentDate ?? null),
              id: `${doc.id}-${Math.random().toString(36).slice(2)}`,
              docName: doc.name,
              docFileId: doc.id,
              docFolderFileId: doc.parentFolderId,
              docFolderPath: doc.folderPath ?? '',
              documentMeta: documentMeta ?? null,
              selected: !alreadyAdded,
              added: alreadyAdded,
              advisorPriority: null,
            };
          });
          if (newActions.length === 0) {
            setReviewActions(prev => [...prev, { id: `empty-${doc.id}`, description: '', dueDate: null, dueDateRelative: null, responsiblePerson: null, priority: null, advisorPriority: null, docName: doc.name, docFileId: doc.id, docFolderFileId: doc.parentFolderId, docFolderPath: doc.folderPath ?? '', selected: false, added: false, isError: true, errorMessage: 'No actions found — check the document structure is correct and re-sync.', hazardRef: null, hazard: null, existingControls: null, regulation: null, riskRating: null, riskLevel: null, documentMeta: null }]);
          } else {
            setReviewActions(prev => [...prev, ...newActions]);
          }

          // Build a stable portal-action → Word-row pairing once, shared by both aiUpdates and two-way sync.
          // This prevents the two blocks from making conflicting claims when portal action texts haven't
          // been updated yet (aiUpdates runs before two-way sync updates texts in DB).
          const normText = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
          const docActionsForDoc = currentActions.filter((a: Action) => a.source_document_id === doc.id);
          const rowPairingMap = new Map<string, typeof readRows[0]>(); // portal action id → matched Word row
          if (readRows.length > 0) {
            const claimedRowIdxByRef = new Map<string, Set<number>>();
            for (const docAction of docActionsForDoc) {
              if (!docAction.hazardRef) continue;
              const ref = String(docAction.hazardRef).trim();
              const allRows = readRowsByRef.get(ref) ?? [];
              if (allRows.length === 0) continue;
              const claimed = claimedRowIdxByRef.get(ref) ?? new Set<number>();
              const available = allRows.map((r, i) => ({ r, i })).filter(({ i }) => !claimed.has(i));
              if (available.length === 0) continue;
              let best = available[0];
              if (docAction.action && available.length > 1) {
                const needle = normText(docAction.action);
                const exact = available.find(({ r }) => normText(r.actionText) === needle);
                const sub = !exact ? available.find(({ r }) => { const h = normText(r.actionText); return h.includes(needle) || needle.includes(h); }) : undefined;
                best = exact ?? sub ?? available[0];
              }
              claimed.add(best.i);
              claimedRowIdxByRef.set(ref, claimed);
              rowPairingMap.set(docAction.id, best.r);
            }
          }

          // Update hazard/existing controls/risk from AI extraction for already-existing actions.
          // For each Gemini action (na), find the portal action whose paired Word row best matches na's text.
          const claimedPortalActionIds = new Set<string>();
          for (const na of newActions.filter(n => n.added)) {
            const candidates = docActionsForDoc.filter(a =>
              a.hazardRef === na.hazardRef && !claimedPortalActionIds.has(a.id)
            );
            if (candidates.length === 0) continue;
            // Prefer the portal action whose paired row action text matches na.description
            let existingAction = candidates[0];
            if (candidates.length > 1) {
              const needle = normText(na.description);
              const byRow = candidates.find(a => normText(rowPairingMap.get(a.id)?.actionText) === needle);
              const byRowSub = !byRow ? candidates.find(a => { const h = normText(rowPairingMap.get(a.id)?.actionText); return h.includes(needle) || needle.includes(h); }) : undefined;
              // Fall back to matching against portal action text
              const byText = (!byRow && !byRowSub) ? candidates.find(a => normText(a.action) === needle) : undefined;
              existingAction = byRow ?? byRowSub ?? byText ?? candidates[0];
            }
            claimedPortalActionIds.add(existingAction.id);
            const aiUpdates: Record<string, any> = {};
            // na.hazard/existingControls is now HTML from document parser; always update plain text, never downgrade HTML to plain text
            const existingHazardIsHtml = existingAction.hazard?.trimStart().startsWith('<');
            const existingControlsIsHtml = existingAction.existingControls?.trimStart().startsWith('<');
            const newHazardIsHtml = na.hazard?.trimStart().startsWith('<');
            const newControlsIsHtml = na.existingControls?.trimStart().startsWith('<');
            if (na.hazard && na.hazard !== existingAction.hazard && (!existingHazardIsHtml || newHazardIsHtml)) aiUpdates.hazard = na.hazard;
            if (na.existingControls && na.existingControls !== existingAction.existingControls && (!existingControlsIsHtml || newControlsIsHtml)) aiUpdates.existing_controls = na.existingControls;
            // Risk from the paired Word row (never from Gemini inference)
            const pairedRow = rowPairingMap.get(existingAction.id);
            const naTableRisk = pairedRow?.riskRating ?? bestReadRow(na.hazardRef, na.description)?.riskRating;
            if (naTableRisk && naTableRisk !== existingAction.riskRating) {
              aiUpdates.risk_rating = naTableRisk;
              const derived = normaliseRiskLevel(naTableRisk)?.toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW' | undefined;
              if (derived) aiUpdates.risk_level = derived;
            }
            if (na.docFolderPath && na.docFolderPath !== existingAction.sourceFolderPath) aiUpdates.source_folder_path = na.docFolderPath;
            if (na.documentMeta?.assessmentDate && na.documentMeta.assessmentDate !== existingAction.issueDate) aiUpdates.issue_date = na.documentMeta.assessmentDate;
            aiUpdates.extraction_version = CURRENT_EXTRACTION_VERSION;
            if (Object.keys(aiUpdates).length > 0) {
              await supabase.from('actions').update(aiUpdates).eq('id', existingAction.id);
              setAllActions((prev: Action[]) => prev.map((a: Action) => a.id === existingAction.id ? { ...a, hazard: aiUpdates.hazard ?? a.hazard, existingControls: aiUpdates.existing_controls ?? a.existingControls, riskRating: aiUpdates.risk_rating ?? a.riskRating, riskLevel: aiUpdates.risk_level ?? a.riskLevel, sourceFolderPath: aiUpdates.source_folder_path ?? a.sourceFolderPath, issueDate: aiUpdates.issue_date ?? a.issueDate } : a));
              // Update default review_due if assessment date changed
              if (aiUpdates.issue_date && na.docName && selectedSite) {
                const d = new Date(aiUpdates.issue_date + 'T00:00:00');
                d.setFullYear(d.getFullYear() + 1);
                void supabase.from('document_health').upsert(
                  { site_id: selectedSite.id, document_name: na.docName, review_due: d.toISOString().slice(0, 10) },
                  { onConflict: 'site_id,document_name', ignoreDuplicates: false }
                ).then(null, () => {});
              }
            }
          }

          // Stamp extraction_version on every action for this document regardless of match outcome,
          // so the data health check clears them all once the document has been processed.
          if (doc.id) {
            void supabase.from('actions')
              .update({ extraction_version: CURRENT_EXTRACTION_VERSION })
              .eq('source_document_id', doc.id)
              .eq('site_id', site.id)
              .lt('extraction_version', CURRENT_EXTRACTION_VERSION)
              .then(null, () => {});
          }

          // Two-way sync: update text/date/responsible on existing portal actions from Word action table.
          // Uses the same rowPairingMap computed above so pairing is consistent with aiUpdates.
          if (readRows.length > 0) {
            console.log(`[TWO-WAY] ${doc.name} — ${docActionsForDoc.length} portal actions, ${readRows.length} table rows`);
            for (const docAction of docActionsForDoc) {
              if (!docAction.hazardRef) { console.log(`[TWO-WAY] skip — no hazardRef on portal action "${docAction.action}"`); continue; }
              const docRow = rowPairingMap.get(docAction.id);
              if (!docRow) { console.log(`[TWO-WAY] no table row for hazardRef="${docAction.hazardRef}"`); continue; }
              console.log(`[TWO-WAY] ref=${docAction.hazardRef} tableDate="${docRow.targetDate}" portalDate="${docAction.date}"`);
              const updates: Partial<Action> = {};
              const supaUpdates: Record<string, any> = {};
              if (docRow.actionText && docRow.actionText !== docAction.action) { updates.action = docRow.actionText; supaUpdates.title = docRow.actionText; }
              if (docRow.responsiblePerson && docRow.responsiblePerson !== docAction.who) { updates.who = docRow.responsiblePerson; supaUpdates.responsible_person = docRow.responsiblePerson; }
              if (docRow.targetDate) {
                const normalisedDate = ukToIso(docRow.targetDate);
                const resolvedTarget = /^\d{4}-\d{2}-\d{2}$/.test(normalisedDate)
                  ? normalisedDate
                  : resolveDueDate(null, normalisedDate, documentMeta?.assessmentDate ?? docAction.issueDate ?? null);
                if (resolvedTarget && resolvedTarget !== docAction.date) { updates.date = resolvedTarget; supaUpdates.due_date = resolvedTarget; }
              }
              if (docRow.completedDate && !docAction.resolvedDate) { const isoCompleted = ukToIso(docRow.completedDate); updates.resolvedDate = isoCompleted; updates.status = 'resolved'; supaUpdates.resolved_date = isoCompleted; supaUpdates.status = 'resolved'; }
              if (Object.keys(supaUpdates).length > 0) {
                await supabase.from('actions').update(supaUpdates).eq('id', docAction.id);
                setAllActions((prev: Action[]) => prev.map((a: Action) => a.id === docAction.id ? { ...a, ...updates } : a));
                if (updates.status === 'resolved') setResolvedIds((prev: string[]) => prev.includes(docAction.id) ? prev : [...prev, docAction.id]);
              }
            }
          }
        } catch (docErr: any) {
          const rawMsg: string = docErr.message || 'Unknown error';
          const friendlyMsg = /token count exceeds|input token/i.test(rawMsg)
            ? 'Document too large for AI extraction — consider splitting it into smaller files'
            : rawMsg;
          setReviewActions(prev => [...prev, { id: `err-${doc.id}-${Math.random().toString(36).slice(2)}`, description: '', dueDate: null, dueDateRelative: null, responsiblePerson: null, priority: null, advisorPriority: null, docName: doc.name, docFileId: doc.id, docFolderFileId: doc.parentFolderId, docFolderPath: doc.folderPath ?? '', selected: false, added: false, isError: true, errorMessage: friendlyMsg, hazardRef: null, hazard: null, existingControls: null, regulation: null, riskRating: null, riskLevel: null, documentMeta: null }]);
        }
      };

      const CONCURRENCY = 2;
      for (let i = 0; i < docxFiles.length; i += CONCURRENCY) {
        if (aiCancelledRef.current) break;
        await Promise.all(
          docxFiles.slice(i, i + CONCURRENCY).map((_, offset) => processDoc(i + offset))
        );
      }
      const now = new Date().toISOString();
      await supabase.from('sites').update({ last_ai_sync: now }).eq('id', site.id);
      setSites(prev => prev.map(s => s.id === site.id ? { ...s, last_ai_sync: now } : s));
      setSelectedSite(prev => prev?.id === site.id ? { ...prev, last_ai_sync: now } : prev);
      recalcActionProgress(site.id);
    } catch (err: any) {
      setAiError(err.message || 'Sync failed');
    } finally {
      setAiSyncing(false);
      setAiSyncProgress('');
    }
  };

  const handleForceAiSync = (site: Site) => handleAiSync(site, true);
  const handleSingleDocSync = (site: Site, fileId: string) => {
    setSyncingDocId(fileId);
    handleAiSync(site, true, fileId).finally(() => setSyncingDocId(null));
  };

  const handleArchiveDoc = async (docName: string, folderPath: string, issueDate: string | null, siteId: string, silent = false): Promise<{ archivedFileId?: string; originalFolderId?: string; archivedTargetPath?: string; wdrivePath?: string; via?: string } | void> => {
    const siteName = sites.find(s => s.id === siteId)?.name;
    // Prefer fresh path from allActions — must filter by site to avoid cross-site filename collisions
    const freshPath = allActions.find(a => a.site === siteName && a.source === docName && a.sourceFolderPath)?.sourceFolderPath;
    const effectiveFolderPath = freshPath ?? folderPath;
    // Look up Datto IDs from actions — filter by site for the same reason
    const actionWithIds = allActions.find(a => a.site === siteName && a.source === docName && a.source_document_id && a.sourceFolderId);
    const fileId = actionWithIds?.source_document_id;
    const sourceFolderId = actionWithIds?.sourceFolderId;
    const site = sites.find(s => s.id === siteId);
    const siteFolderId = site?.datto_folder_id;
    const siteFolderPath = site?.datto_folder_path ?? null;
    if (!fileId || !sourceFolderId || !siteFolderId) {
      showAppFlash('Cannot archive: missing Datto file or folder ID', 6000);
      throw new Error('Cannot archive: missing Datto file or folder ID');
    }
    // Write all syncable actions back to the Word doc as resolved before the file moves
    const today = new Date().toLocaleDateString('en-CA');
    const syncable = allActions.filter(a =>
      a.source === docName && a.source_document_id && a.sourceFolderId && a.hazardRef
    );
    if (syncable.length > 0) {
      await Promise.allSettled(syncable.map(a =>
        fetch('/api/datto/file/writeback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileId: a.source_document_id,
            folderId: a.sourceFolderId,
            fileName: a.source,
            hazardRef: a.hazardRef,
            actionText: a.action,
            responsiblePerson: a.who || undefined,
            targetDate: a.date ? toUKDate(a.date) : undefined,
            completedDate: toUKDate(today),
          }),
        })
      ));
    }
    const res = await fetch('/api/datto/archive-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, fileName: docName, sourceFolderId, siteFolderId, siteFolderPath, sourceFolderPath: effectiveFolderPath }),
    });
    const data = await res.json();
    if (!res.ok) { const msg = apiErr(data, 'Archive failed'); showAppFlash(msg, 10000); throw new Error(msg); }
    await supabase.from('actions').update({ status: 'archived', resolved_date: today }).eq('site_id', siteId).eq('source_document_name', docName);
    setAllActions(prev => prev.map(a => a.source === docName ? { ...a, status: 'archived' as ActionStatus, resolvedDate: today } : a));
    recalcActionProgress(siteId);
    refreshComplianceScore(siteId);
    if (!silent) showAppFlash(`Archived to: ${data.targetPath ?? data.archivedFileName}${data.via === 'wdrive' ? ' (via W: drive)' : ''}`, 8000);
    return { archivedFileId: data.archivedFileId ?? null, originalFolderId: sourceFolderId, archivedTargetPath: data.targetPath, wdrivePath: data.wdrivePath ?? undefined, via: data.via ?? 'api' };
  };

  const handleRestoreAction = async (id: string) => {
    const { error } = await supabase.from('actions').update({ status: 'open', resolved_date: null }).eq('id', id);
    if (error) { showAppFlash('Restore failed: ' + error.message, 6000); return; }
    const siteName = allActions.find(a => a.id === id)?.site;
    setAllActions(prev => prev.map(a => a.id === id ? { ...a, status: 'open' as ActionStatus, resolvedDate: null } : a));
    const siteId = sites.find(s => s.name === siteName)?.id;
    if (siteId) { recalcActionProgress(siteId); refreshComplianceScore(siteId); }
    showAppFlash('Action restored to open.');
  };

  const handleCloneDoc = async (fileId: string, fileName: string, folderId: string, folderPath: string | null): Promise<{ newFileId: string | null; newFileName: string; via?: string; wdrivePath?: string } | void> => {
    // Use allActions to get the most current folder path/id for this file — avoids stale DocHealthTab row data
    const freshAction = allActions.find(a => a.source_document_id === fileId && a.sourceFolderPath && a.sourceFolderId);
    const effectiveFolderPath = freshAction?.sourceFolderPath ?? folderPath;
    const effectiveFolderId = freshAction?.sourceFolderId ?? folderId;
    const res = await fetch('/api/datto/clone-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, fileName, folderId: effectiveFolderId, folderPath: effectiveFolderPath }),
    });
    const data = await res.json();
    if (!res.ok) { const msg = apiErr(data, 'Clone failed'); showAppFlash(msg, 10000); throw new Error(msg); }
    showAppFlash(`Blank copy created: ${data.newFileName}${data.via === 'wdrive' ? ' (via W: drive)' : ''}`);
    return { newFileId: data.newFileId ?? null, newFileName: data.newFileName, via: data.via ?? 'api', wdrivePath: data.wdrivePath ?? undefined };
  };

  const viewSites = filterOrgId ? sites.filter(s => s.organisation_id === filterOrgId) : sites;
  const viewActions = allActions.filter(a => viewSites.some(s => s.name === a.site));
  const siteActions = selectedSite ? allActions.filter(a => a.site === selectedSite.name) : allActions;
  const isActionResolved = (a: Action) => resolvedIds.includes(a.id) || a.status === 'resolved' || a.status === 'pending_review' || a.status === 'archived';
  const searchedSiteActions = actionSearch.trim()
    ? siteActions.filter(a => {
        const q = actionSearch.toLowerCase();
        return (
          a.action?.toLowerCase().includes(q) ||
          (a.hazardRef ?? '').toLowerCase().includes(q) ||
          (a.who ?? '').toLowerCase().includes(q) ||
          (a.source ?? '').toLowerCase().includes(q) ||
          (a.hazard ?? '').toLowerCase().includes(q)
        );
      })
    : siteActions;
  const filteredActions = (
    filterPriority === 'all'          ? searchedSiteActions.filter(a => !isActionResolved(a)) :
    filterPriority === 'open'         ? searchedSiteActions.filter(a => !isActionResolved(a) && (derivePriority(a).priority === 'amber' || derivePriority(a).priority === 'green')) :
    filterPriority === 'resolved'     ? searchedSiteActions.filter(a => (a.status === 'resolved' || resolvedIds.includes(a.id)) || (showArchivedActions && a.status === 'archived')) :
    filterPriority === 'pending_review' ? searchedSiteActions.filter(a => a.status === 'pending_review') :
    filterPriority === 'rejected'     ? searchedSiteActions.filter(a => a.status === 'open' && !!a.reviewNote) :
    searchedSiteActions.filter(a => !isActionResolved(a) && derivePriority(a).priority === filterPriority)
  )
    .slice()
    .sort((a, b) => {
      const aResolved = isActionResolved(a);
      const bResolved = isActionResolved(b);
      if (aResolved !== bResolved) return aResolved ? 1 : -1;
      const tierOrder: Record<Priority, number> = { red: 0, amber: 1, green: 2 };
      const riskOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      const { priority: ap } = derivePriority(a);
      const { priority: bp } = derivePriority(b);
      if (ap !== bp) return tierOrder[ap] - tierOrder[bp];
      // Within the same priority tier, sort HIGH risk before MEDIUM before LOW
      const ar = a.riskLevel ? (riskOrder[a.riskLevel] ?? 3) : 3;
      const br = b.riskLevel ? (riskOrder[b.riskLevel] ?? 3) : 3;
      if (ar !== br) return ar - br;
      const aImmediate = !!a.date && IMMEDIATE_RE.test(a.date) && !ONGOING_RE.test(a.date);
      const bImmediate = !!b.date && IMMEDIATE_RE.test(b.date) && !ONGOING_RE.test(b.date);
      if (aImmediate !== bImmediate) return aImmediate ? -1 : 1;
      const aHasDate = !!a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date);
      const bHasDate = !!b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date);
      if (aHasDate && bHasDate) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      if (aHasDate) return -1;
      if (bHasDate) return 1;
      return (a.updatedAt || '') < (b.updatedAt || '') ? -1 : 1;
    });
  // When searching, show all matches regardless of active tab; otherwise respect tab filter
  const displayedActions = actionSearch.trim() ? searchedSiteActions : filteredActions;

  // Group by source document
  const docGroupMap = new Map<string, typeof displayedActions>();
  for (const a of displayedActions) {
    const key = a.source || 'Unknown Document';
    if (!docGroupMap.has(key)) docGroupMap.set(key, []);
    docGroupMap.get(key)!.push(a);
  }
  const docGroups = Array.from(docGroupMap.entries())
    .map(([source, actions]) => ({
      source,
      fileId: actions[0]?.source_document_id || null,
      displayName: source.replace(/\.[^.]+$/, ''),
      actions,
      hasRed: actions.some(a => derivePriority(a).priority === 'red'),
      hasImmediate: actions.some(a => !isActionResolved(a) && !!a.date && IMMEDIATE_RE.test(a.date) && !ONGOING_RE.test(a.date)),
      hasAmber: actions.some(a => derivePriority(a).priority === 'amber'),
      redCount: actions.filter(a => derivePriority(a).priority === 'red').length,
      amberCount: actions.filter(a => derivePriority(a).priority === 'amber').length,
      highRiskCount: actions.filter(a => a.riskLevel === 'HIGH' && !(a.date && ONGOING_RE.test(a.date))).length,
    }))
    .sort((a, b) => {
      if (a.hasRed !== b.hasRed) return a.hasRed ? -1 : 1;
      // Within red: HIGH risk count first
      if (a.highRiskCount !== b.highRiskCount) return b.highRiskCount - a.highRiskCount;
      // Same risk profile: immediate groups before ISO-date overdue
      if (a.hasImmediate !== b.hasImmediate) return a.hasImmediate ? -1 : 1;
      if (a.hasAmber !== b.hasAmber) return a.hasAmber ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
  const toggleDocGroup = (source: string) => {
    setExpandedDocGroups(prev => prev.has(source) ? new Set() : new Set([source]));
  };

  const openActions = searchedSiteActions.filter(a => !isActionResolved(a));
  const openCount = openActions.length;
  const resolvedCount = searchedSiteActions.filter(a => isActionResolved(a) && a.status !== 'archived').length;
  const pendingReviewCount = searchedSiteActions.filter(a => a.status === 'pending_review').length;
  const rejectedCount = searchedSiteActions.filter(a => a.status === 'open' && !!a.reviewNote).length;
  const archivedCount = searchedSiteActions.filter(a => a.status === 'archived').length;
  const filterCounts: Record<string, number> = {
    all:            openCount,
    red:            openActions.filter(a => derivePriority(a).priority === 'red').length,
    open:           openActions.filter(a => derivePriority(a).priority === 'amber' || derivePriority(a).priority === 'green').length,
    resolved:       searchedSiteActions.filter(a => a.status === 'resolved' || resolvedIds.includes(a.id)).length,
    pending_review: pendingReviewCount,
    rejected:       rejectedCount,
  };
  const isActive = (a: Action) => a.status !== 'resolved' && a.status !== 'pending_review' && a.status !== 'archived';
  const criticalCount = viewActions.filter(a => isActive(a) && derivePriority(a).priority === 'red').length;
  const upcomingCount = viewActions.filter(a => isActive(a) && derivePriority(a).priority === 'amber').length;

  if (authLoading) return <div className="min-h-screen bg-indigo-950 flex items-center justify-center"><div className="text-indigo-300 font-black text-sm uppercase tracking-widest animate-pulse">Loading…</div></div>;
  if (!user) return <LoginScreen onLogin={() => {}} />;
  if (!profile) return <div className="min-h-screen bg-indigo-950 flex items-center justify-center"><div className="text-indigo-300 font-black text-sm uppercase tracking-widest animate-pulse">Loading…</div></div>;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-indigo-100 overflow-x-hidden">
      <aside className="hidden lg:flex fixed left-0 top-0 h-full w-20 bg-indigo-950 flex-col items-center pt-4 pb-8 gap-10 text-indigo-300 z-20">
        <nav className="flex flex-col gap-6">
          {profile?.role === 'superadmin' && <button onClick={() => setView('admin')} className={`p-3 rounded-xl transition-all ${view === 'admin' ? 'bg-indigo-700 text-white shadow-inner' : 'hover:text-white hover:bg-white/5'}`} title="Admin Panel"><Shield size={22} /></button>}
          {(profile?.role === 'advisor' || (profile?.role === 'client' && sites.length > 1)) && <button onClick={() => { setView('portfolio'); setSelectedSite(null); }} className={`p-3 rounded-xl transition-all ${view === 'portfolio' ? 'bg-indigo-700 text-white shadow-inner' : 'hover:text-white hover:bg-white/5'}`} title="Dashboard"><Layout size={22} /></button>}
          {(profile?.role === 'advisor' || profile?.role === 'client') && <button onClick={() => { setView('site'); if (sites.length > 0 && !selectedSite) setSelectedSite(sites[0]); }} className={`p-3 rounded-xl transition-all ${view === 'site' ? 'bg-indigo-700 text-white shadow-inner' : 'hover:text-white hover:bg-white/5'}`} title={isViewOnly ? 'Documents' : 'Action Plans'}><FileText size={22} /></button>}
          {(profile?.role === 'advisor' || profile?.role === 'superadmin') && <button onClick={() => setShowSettings(true)} className="p-3 rounded-xl hover:text-white hover:bg-white/5" title="Settings"><Settings size={22} /></button>}
        </nav>
        <div className="mt-auto flex flex-col gap-5 items-center">
          {profile?.role === 'advisor' && <button onClick={handleDattoSync} className={`p-3 rounded-xl transition-all ${isSyncing ? 'text-white animate-spin' : 'hover:text-white hover:bg-white/5'}`} title="Sync"><RefreshCw size={22} /></button>}
          <button onClick={handleLogout} className="p-3 rounded-xl hover:text-white hover:bg-white/5" title="Sign out"><LogOut size={22} /></button>
          <div className="w-10 h-10 rounded-full bg-indigo-800 flex items-center justify-center font-black text-white text-xs border border-indigo-700">{user.email?.substring(0, 2).toUpperCase()}</div>
        </div>
      </aside>

      {/* Bottom navigation bar — tablet/mobile only */}
      <nav className="fixed bottom-0 left-0 right-0 lg:hidden flex items-center justify-around bg-indigo-950 h-16 z-20 border-t border-indigo-900 text-indigo-300">
        {profile?.role === 'superadmin' && <button onClick={() => setView('admin')} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${view === 'admin' ? 'text-white' : 'hover:text-white'}`}><Shield size={20} /><span className="text-[9px] font-black uppercase tracking-wide">Admin</span></button>}
        {(profile?.role === 'advisor' || (profile?.role === 'client' && sites.length > 1)) && <button onClick={() => { setView('portfolio'); setSelectedSite(null); }} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${view === 'portfolio' ? 'text-white' : 'hover:text-white'}`}><Layout size={20} /><span className="text-[9px] font-black uppercase tracking-wide">Dashboard</span></button>}
        {(profile?.role === 'advisor' || profile?.role === 'client') && <button onClick={() => { setView('site'); if (sites.length > 0 && !selectedSite) setSelectedSite(sites[0]); }} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${view === 'site' ? 'text-white' : 'hover:text-white'}`}><FileText size={20} /><span className="text-[9px] font-black uppercase tracking-wide">{isViewOnly ? 'Docs' : 'Actions'}</span></button>}
        {(profile?.role === 'advisor' || profile?.role === 'superadmin') && <button onClick={() => setShowSettings(true)} className="flex flex-col items-center gap-1 p-2 rounded-xl hover:text-white"><Settings size={20} /><span className="text-[9px] font-black uppercase tracking-wide">Settings</span></button>}
        <button onClick={handleLogout} className="flex flex-col items-center gap-1 p-2 rounded-xl hover:text-white"><LogOut size={20} /><span className="text-[9px] font-black uppercase tracking-wide">Sign out</span></button>
      </nav>

      <main className="lg:pl-20 pb-16 lg:pb-0">
        <header className="bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 md:px-8 py-3 md:py-4 flex items-center justify-between sticky top-0 z-10 relative">
          <div className="flex items-center gap-3">
            {view === 'site' && (profile?.role === 'advisor' || (profile?.role === 'client' && sites.length > 1)) && <button onClick={() => { setView('portfolio'); setSelectedSite(null); }} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400"><ArrowLeft size={18} /></button>}
            <img src="/logo-full.svg" alt="McCormack Benson Health & Safety" className="h-14 w-auto object-contain" />
          </div>
          <div className="flex items-center gap-5">
            <button onClick={() => setShowChangePassword(true)} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100" title="Change password"><KeyRound size={16} /></button>
            <div className="text-right hidden sm:block">
              <p className="text-xs font-black text-slate-800">{user.email}</p>
              <p className="text-[10px] text-indigo-600 font-bold uppercase tracking-widest">● {profile?.role}</p>
              {(profile?.role === 'advisor' || profile?.role === 'superadmin') && <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest flex items-center justify-end gap-1 mt-0.5"><Database size={8} />Sync: {syncLastRun}</p>}
            </div>
            {(profile?.role === 'advisor' || (profile?.role === 'client' && sites.length > 1)) && (
              <div className="hidden md:flex bg-slate-100 p-1 rounded-xl">
                <button onClick={() => { setView('portfolio'); setSelectedSite(null); }} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${view === 'portfolio' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>Sites</button>
                {!isViewOnly && <button onClick={() => { setView('site'); if (sites.length > 0 && !selectedSite) setSelectedSite(sites[0]); }} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${view === 'site' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>Action Plan</button>}
              </div>
            )}
          </div>
          {profile?.role === 'client' && siteAdvisor && (
            <p className="absolute bottom-1 right-4 md:right-8 text-[10px] text-slate-400 leading-none hidden sm:block">
              Your advisor is: {siteAdvisor.full_name && <span className="font-bold text-slate-500">{siteAdvisor.full_name}</span>}
              {siteAdvisor.full_name && ' · '}
              <a href={`mailto:${siteAdvisor.email}`} className="hover:text-indigo-500 transition-colors">{siteAdvisor.email}</a>
              {siteAdvisor.phone && <> · <a href={`tel:${siteAdvisor.phone}`} className="hover:text-indigo-500 transition-colors">{siteAdvisor.phone}</a></>}
            </p>
          )}
        </header>

        <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
          {view === 'admin' && profile?.role === 'superadmin' && <SuperadminPanel
            onSyncSite={(s) => handleForceAiSync(s)}
            onViewSite={(s, viewRole, tab) => {
              setSelectedSite({
                id: s.id, name: s.name, type: s.type ?? 'SCHOOL', organisation_id: s.organisation_id ?? null,
                compliance: s.compliance_score ?? 0, trend: s.trend ?? 0, actionProgress: s.action_progress ?? 100,
                iagScore: s.iag_score ?? null, iagWeightedScore: s.iag_weighted_score ?? null,
                employeeCount: s.employee_count ?? null, red: 0, amber: 0, green: 0, lastReview: '—',
                datto_folder_id: s.datto_folder_id ?? null, datto_folder_path: s.datto_folder_path ?? null,
                advisor_id: s.advisor_id ?? null, last_ai_sync: s.last_ai_sync ?? null,
                excluded_datto_folder_ids: s.excluded_datto_folder_ids ?? [],
                included_datto_folder_ids: s.included_datto_folder_ids ?? null,
                logo_url: s.logo_url ?? null,
              });
              setViewAsRole(viewRole);
              if (tab) setSiteTab(tab);
              setView('site');
            }}
            onViewOrg={(orgSites, orgId, viewRole) => {
              const mapped = orgSites.map((s: any) => ({
                id: s.id, name: s.name, type: s.type ?? 'SCHOOL', organisation_id: s.organisation_id ?? null,
                compliance: s.compliance_score ?? 0, trend: s.trend ?? 0, actionProgress: s.action_progress ?? 100,
                iagScore: s.iag_score ?? null, iagWeightedScore: s.iag_weighted_score ?? null,
                employeeCount: s.employee_count ?? null, red: 0, amber: 0, green: 0, lastReview: '—',
                datto_folder_id: s.datto_folder_id ?? null, datto_folder_path: s.datto_folder_path ?? null,
                advisor_id: s.advisor_id ?? null, last_ai_sync: s.last_ai_sync ?? null,
                excluded_datto_folder_ids: s.excluded_datto_folder_ids ?? [],
                included_datto_folder_ids: s.included_datto_folder_ids ?? null,
                logo_url: s.logo_url ?? null,
              }));
              setSites(mapped);
              setFilterOrgId(orgId);
              setViewAsRole(viewRole);
              setView('portfolio');
            }}
          />}

          {view === 'portfolio' && isViewOnly && (profile?.role !== 'client' || sites.length > 1) && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-950 rounded-xl p-6 md:p-10 text-white flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500 rounded-full -mr-32 -mt-32 blur-[100px] opacity-10 pointer-events-none" />
                <div className="relative z-10 flex items-center gap-5">
                  {clientOrg?.logo_url && (
                    <div className="bg-white rounded-xl px-3 py-2 flex items-center justify-center shrink-0 h-16 max-w-[160px]">
                      <img src={clientOrg.logo_url} alt={clientOrg.name} className="max-h-12 max-w-[130px] object-contain" />
                    </div>
                  )}
                  <div>
                    <h2 className="text-2xl md:text-3xl font-black tracking-tighter">{clientOrg?.name ?? 'Your Sites'}</h2>
                    <p className="text-indigo-300 mt-2 text-sm">Select a site to view your documents.</p>
                  </div>
                </div>
                <div className="bg-white/5 backdrop-blur-md rounded-lg p-4 border border-white/10 text-center min-w-[90px] relative z-10">
                  <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase tracking-widest text-indigo-300 mb-1.5"><Building2 size={12} />Sites</div>
                  <p className="text-3xl font-black text-white">{sites.length}</p>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-4">
                {sites.map(site => {
                  const lastSync = site.last_ai_sync ? new Date(site.last_ai_sync) : null;
                  const syncLabel = lastSync
                    ? (() => {
                        const diffMs = Date.now() - lastSync.getTime();
                        const diffDays = Math.floor(diffMs / 86400000);
                        if (diffDays === 0) return 'Today';
                        if (diffDays === 1) return 'Yesterday';
                        if (diffDays < 7) return `${diffDays} days ago`;
                        if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) !== 1 ? 's' : ''} ago`;
                        return lastSync.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
                      })()
                    : null;
                  return (
                    <div key={site.id} className="w-full sm:w-[420px] bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                      <div className="flex justify-end mb-4">
                        {(site.logo_url || clientOrg?.logo_url)
                          ? <img src={site.logo_url || clientOrg?.logo_url || ''} alt={site.name ?? ''} className="h-8 max-w-[130px] object-contain" />
                          : <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-400"><Building2 size={16} /></div>
                        }
                      </div>
                      <button onClick={() => { pendingTabRef.current = 'files'; setSiteTab('files'); setSelectedSite(site); setView('site'); }} className="font-black text-slate-900 text-base leading-tight hover:text-indigo-700 transition-colors text-left">{site.name}</button>
                      {syncLabel && <p className="text-[10px] text-slate-400 font-bold mt-1">Documents updated {syncLabel}</p>}
                      <div className="mt-4 border-t border-slate-100 pt-3 space-y-0.5">
                        <button onClick={() => { pendingTabRef.current = 'files'; setSiteTab('files'); setSelectedSite(site); setView('site'); }} className="w-full flex items-center gap-2 px-1 py-px text-left text-[12px] text-indigo-600 hover:text-indigo-800 font-semibold group transition-colors">
                          <Folder size={12} className="shrink-0 text-indigo-400 group-hover:text-indigo-600 transition-colors" />
                          View your H&amp;S documents
                        </button>
                        <button onClick={() => { pendingTabRef.current = 'documents'; setSiteTab('documents'); setSelectedSite(site); setView('site'); }} className="w-full flex items-center gap-2 px-1 py-px text-left text-[12px] text-amber-600 hover:text-amber-800 font-semibold group transition-colors">
                          <FileText size={12} className="shrink-0 text-amber-400 group-hover:text-amber-600 transition-colors" />
                          View your own documents
                        </button>
                        <button onClick={() => { pendingTabRef.current = 'documents'; setSiteTab('documents'); setSelectedSite(site); setView('site'); }} className="w-full flex items-center gap-2 px-1 py-px text-left text-[12px] text-emerald-600 hover:text-emerald-800 font-semibold group transition-colors">
                          <Upload size={12} className="shrink-0 text-emerald-400 group-hover:text-emerald-600 transition-colors" />
                          Upload supporting documents
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {view === 'portfolio' && !isViewOnly && (profile?.role === 'advisor' || profile?.role === 'client' || profile?.role === 'superadmin') && (profile?.role !== 'client' || sites.length > 1) && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 rounded-xl p-6 md:p-10 text-white flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 md:gap-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500 rounded-full -mr-32 -mt-32 blur-[100px] opacity-20 pointer-events-none" />
                <div className="relative z-10 flex items-center gap-5">
                  {portfolioOrg?.logo_url && (
                    <div className="bg-white rounded-xl px-3 py-2 flex items-center justify-center shrink-0 h-16 max-w-[160px]">
                      <img src={portfolioOrg.logo_url} alt={portfolioOrg.name} className="max-h-12 max-w-[130px] object-contain" />
                    </div>
                  )}
                  <div>
                    {portfolioOrg?.name
                      ? <>
                          <h2 className="text-2xl md:text-4xl font-black tracking-tighter">{portfolioOrg.name}</h2>
                          <p className="text-sm md:text-base font-black uppercase tracking-widest text-indigo-300 mt-1">Organisational Compliance</p>
                        </>
                      : <h2 className="text-2xl md:text-4xl font-black tracking-tighter">Organisational Compliance</h2>
                    }
                    <p className="text-indigo-300 mt-2 max-w-md text-sm">Real-time H&S status across all sites.</p>
                  </div>
                </div>
                <div className="flex gap-3 md:gap-4 relative z-10">
                  {[{ label: 'Overdue', value: criticalCount, color: 'text-rose-400', icon: <Zap size={14} /> }, { label: 'Upcoming', value: upcomingCount, color: 'text-amber-400', icon: <Clock size={14} /> }, { label: 'Sites', value: viewSites.length, color: 'text-indigo-300', icon: <Building2 size={14} /> }].map(stat => (
                    <div key={stat.label} className="bg-white/5 backdrop-blur-md rounded-lg p-3 md:p-5 border border-white/10 text-center min-w-[72px] md:min-w-[90px]">
                      <div className={`flex items-center justify-center gap-1 text-[10px] font-black uppercase tracking-widest opacity-70 mb-1.5 ${stat.color}`}>{stat.icon}{stat.label}</div>
                      <p className={`text-2xl md:text-4xl font-black ${stat.color}`}>{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              {/* Dashboard notification banners — advisor only */}
              {(profile?.role === 'advisor' || profile?.role === 'superadmin') && (() => {
                const hasSuggestions = Object.keys(portfolioSuggestionCounts).length > 0;
                const hasUploads = Object.keys(portfolioUploadCounts).length > 0;
                if (!hasSuggestions && !hasUploads) return null;
                const suggestionsTotal = Object.values(portfolioSuggestionCounts).reduce((s, n) => s + n, 0);
                const sitesWithSuggestions = viewSites.filter(s => (portfolioSuggestionCounts[s.id] ?? 0) > 0);
                const uploadsTotal = Object.values(portfolioUploadCounts).reduce((s, n) => s + n, 0);
                const sitesWithUploads = viewSites.filter(s => (portfolioUploadCounts[s.id] ?? 0) > 0);
                return (
                  <div className={`grid gap-4 ${hasSuggestions && hasUploads ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                    {hasSuggestions && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="bg-amber-100 rounded-lg p-2 flex-shrink-0"><Sparkles size={16} className="text-amber-600" /></div>
                          <div>
                            <p className="text-sm font-black text-amber-800">{suggestionsTotal} AI suggestion{suggestionsTotal !== 1 ? 's' : ''} awaiting review</p>
                            <p className="text-[11px] text-amber-600 mt-0.5">
                              {sitesWithSuggestions.map((s, i) => (
                                <span key={s.id}>
                                  {i > 0 && ' · '}
                                  <button onClick={() => { setSelectedSite(s); setView('site'); setShowAiReviewPanel(true); }} className="font-black hover:underline">
                                    {s.name} ({portfolioSuggestionCounts[s.id]})
                                  </button>
                                </span>
                              ))}
                            </p>
                          </div>
                        </div>
                        {sitesWithSuggestions.length === 1 && (
                          <button onClick={() => { setSelectedSite(sitesWithSuggestions[0]); setView('site'); setShowAiReviewPanel(true); }} className="px-4 py-2 bg-amber-500 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-amber-600 flex-shrink-0">Review Now</button>
                        )}
                      </div>
                    )}
                    {hasUploads && (
                      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="bg-indigo-100 rounded-lg p-2 flex-shrink-0"><Paperclip size={16} className="text-indigo-600" /></div>
                          <div>
                            <p className="text-sm font-black text-indigo-800">{uploadsTotal} client upload{uploadsTotal !== 1 ? 's' : ''} awaiting review</p>
                            <p className="text-[11px] text-indigo-600 mt-0.5">
                              {sitesWithUploads.map((s, i) => (
                                <span key={s.id}>
                                  {i > 0 && ' · '}
                                  <button onClick={() => { setSelectedSite(s); setView('site'); setShowClientUploadsPanel(true); }} className="font-black hover:underline">
                                    {s.name} ({portfolioUploadCounts[s.id]})
                                  </button>
                                </span>
                              ))}
                            </p>
                          </div>
                        </div>
                        {sitesWithUploads.length === 1 && (
                          <button onClick={() => { setSelectedSite(sitesWithUploads[0]); setView('site'); setShowClientUploadsPanel(true); }} className="px-4 py-2 bg-indigo-500 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-600 flex-shrink-0">Review Now</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Dashboard notification banners — client only */}
              {profile?.role === 'client' && (() => {
                const hasPending = Object.keys(portfolioUploadCounts).length > 0;
                const hasReviewed = Object.keys(portfolioReviewedUploadCounts).length > 0;
                if (!hasPending && !hasReviewed) return null;
                const pendingTotal = Object.values(portfolioUploadCounts).reduce((s, n) => s + n, 0);
                const sitesWithPending = viewSites.filter(s => (portfolioUploadCounts[s.id] ?? 0) > 0);
                const reviewedTotal = Object.values(portfolioReviewedUploadCounts).reduce((s, n) => s + n, 0);
                const sitesWithReviewed = viewSites.filter(s => (portfolioReviewedUploadCounts[s.id] ?? 0) > 0);
                return (
                  <div className={`grid gap-4 ${hasPending && hasReviewed ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                    {hasPending && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="bg-amber-100 rounded-lg p-2 flex-shrink-0"><Paperclip size={16} className="text-amber-600" /></div>
                          <div>
                            <p className="text-sm font-black text-amber-800">{pendingTotal} file{pendingTotal !== 1 ? 's' : ''} awaiting advisor review</p>
                            <p className="text-[11px] text-amber-600 mt-0.5">
                              {sitesWithPending.map((s, i) => (
                                <span key={s.id}>
                                  {i > 0 && ' · '}
                                  <button onClick={() => { setSelectedSite(s); setView('site'); setSiteTab('documents'); }} className="font-black hover:underline">
                                    {s.name} ({portfolioUploadCounts[s.id]})
                                  </button>
                                </span>
                              ))}
                            </p>
                          </div>
                        </div>
                        {sitesWithPending.length === 1 && (
                          <button onClick={() => { setSelectedSite(sitesWithPending[0]); setView('site'); setSiteTab('documents'); }} className="px-4 py-2 bg-amber-500 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-amber-600 flex-shrink-0">View</button>
                        )}
                      </div>
                    )}
                    {hasReviewed && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="bg-emerald-100 rounded-lg p-2 flex-shrink-0"><CheckCircle size={16} className="text-emerald-600" /></div>
                          <div>
                            <p className="text-sm font-black text-emerald-800">{reviewedTotal} upload{reviewedTotal !== 1 ? 's' : ''} reviewed by your advisor</p>
                            <p className="text-[11px] text-emerald-600 mt-0.5">
                              {sitesWithReviewed.map((s, i) => (
                                <span key={s.id}>
                                  {i > 0 && ' · '}
                                  <button onClick={() => { setSelectedSite(s); setView('site'); setSiteTab('documents'); }} className="font-black hover:underline">
                                    {s.name} ({portfolioReviewedUploadCounts[s.id]})
                                  </button>
                                </span>
                              ))}
                            </p>
                          </div>
                        </div>
                        {sitesWithReviewed.length === 1 && (
                          <button onClick={() => { setSelectedSite(sitesWithReviewed[0]); setView('site'); setSiteTab('documents'); }} className="px-4 py-2 bg-emerald-500 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-emerald-600 flex-shrink-0">View</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Org / site filter bar */}
              <div className="flex items-center gap-3 flex-wrap">
                {profile?.role === 'superadmin' && (
                  <button onClick={() => { setView('admin'); setViewAsRole(null); setFilterOrgId(''); setSites([]); }} className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors">← Back to Admin</button>
                )}
                {viewAsRole && <span className="text-[10px] font-black uppercase tracking-wider text-indigo-500 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">Viewing as {viewAsRole}</span>}
                {organisations.length > 1 && profile?.role !== 'superadmin' && (
                  <select value={filterOrgId} onChange={e => { setFilterOrgId(e.target.value); }} className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 focus:outline-none bg-white">
                    <option value="">All Organisations</option>
                    {organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                )}
                {filterOrgId && profile?.role !== 'superadmin' && <button onClick={() => setFilterOrgId('')} className="text-xs font-bold text-indigo-500 hover:text-indigo-700 flex items-center gap-1"><X size={12} />Clear filter</button>}
                {portfolioOrg?.id && (
                  <a href={`/report?type=org&orgId=${portfolioOrg.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline ml-auto">
                    <ExternalLink size={12} />H&amp;S Status Report
                  </a>
                )}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
                  <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {viewSites.map(site => {
                      const siteActions = allActions.filter(a => a.site === site.name);
                      const actionsScore = computeActionProgress(siteActions);
                      const today = new Date().toLocaleDateString('en-CA');
                      const riskTiers = (['HIGH', 'MEDIUM', 'LOW'] as const).map(tier => {
                        const forTier = siteActions.filter(a => a.riskLevel === tier);
                        const onTrackCount = forTier.filter(a => {
                          if (a.status === 'resolved' || a.status === 'pending_review') return true;
                          const d = a.date;
                          return !(d && !ONGOING_RE.test(d) && /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today);
                        }).length;
                        return { total: forTier.length, onTrack: onTrackCount, w: tier === 'HIGH' ? 3 : tier === 'MEDIUM' ? 2 : 1 };
                      });
                      const wTotal = riskTiers.reduce((s, t) => s + t.total * t.w, 0);
                      const wOnTrack = riskTiers.reduce((s, t) => s + t.onTrack * t.w, 0);
                      const riskScore = wTotal === 0 ? null : Math.round((wOnTrack / wTotal) * 100);
                      const components = ([
                        { val: actionsScore,           w: 0.4 },
                        { val: riskScore,              w: 0.4 },
                        { val: site.iagWeightedScore,  w: 0.2 },
                      ] as { val: number | null; w: number }[]).filter(c => c.val !== null) as { val: number; w: number }[];
                      const totalW = components.reduce((s, c) => s + c.w, 0);
                      const hsPerformance = components.length === 0 ? actionsScore
                        : Math.round(components.reduce((s, c) => s + c.val * c.w, 0) / totalW);
                      const bars = [
                        { label: 'H&S Performance', val: hsPerformance },
                        { label: 'Actions Progress', val: actionsScore },
                        { label: 'Risk Health', val: riskScore },
                        ...(profile?.role !== 'client' ? [{ label: 'Documents', val: site.compliance }] : []),
                      ];
                      return (
                      <div key={site.id} className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all group" onClick={() => handleSiteClick(site)}>
                        <div className="flex items-start justify-between mb-4"><div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all">{getSiteIcon(site.type)}</div><ComplianceRing score={hsPerformance} /></div>
                        <p className="font-black text-sm text-slate-800 leading-tight mb-1">{site.name}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">{site.type}</p>
                        <div className="space-y-1.5">
                          {bars.map(({ label, val }) => (
                            <div key={label}>
                              <div className="flex justify-between text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5">
                                <span>{label}</span>
                                <span>{val === null ? 'N/A' : `${val}%`}</span>
                              </div>
                              <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                {val !== null && <div className={`h-full rounded-full transition-all duration-700 ${scoreColor(val).bar}`} style={{ width: `${val}%` }} />}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 p-4 md:p-8 shadow-sm flex flex-col">
                    <h3 className="font-black text-slate-900 text-lg tracking-tight uppercase mb-6">Action Summary</h3>
                    <div className="flex-1 flex flex-col justify-center items-center">
                      {(() => {
                        const circ = 2 * Math.PI * 70;
                        const total = viewActions.length;
                        const scheduledCnt = viewActions.filter(a => isActive(a) && derivePriority(a).priority === 'green').length;
                        const segs = [
                          { count: criticalCount, color: '#f43f5e' },
                          { count: upcomingCount, color: '#fbbf24' },
                          { count: scheduledCnt, color: '#10b981' },
                        ];
                        const arcs: { color: string; len: number; startDeg: number }[] = [];
                        let cum = 0;
                        if (total > 0) {
                          for (const seg of segs) {
                            if (seg.count > 0) {
                              const len = (seg.count / total) * circ;
                              arcs.push({ color: seg.color, len, startDeg: (cum / circ) * 360 });
                              cum += len;
                            }
                          }
                        }
                        return (
                          <div className="relative w-36 h-36 flex items-center justify-center mb-6">
                            <svg className="w-full h-full -rotate-90" viewBox="0 0 160 160">
                              <circle cx="80" cy="80" r="70" stroke="#f1f5f9" strokeWidth="16" fill="none" />
                              {arcs.map((arc, i) => (
                                <circle key={i} cx="80" cy="80" r="70" stroke={arc.color} strokeWidth="16" fill="none"
                                  strokeDasharray={`${arc.len} ${circ - arc.len}`}
                                  transform={`rotate(${arc.startDeg} 80 80)`}
                                />
                              ))}
                            </svg>
                            <div className="absolute text-center"><p className="text-3xl font-black text-slate-900 leading-none">{total}</p><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Total</p></div>
                          </div>
                        );
                      })()}
                      <div className="w-full space-y-2.5">
                        {[{ label: 'Overdue', count: criticalCount, color: 'bg-rose-50 text-rose-700 border-rose-100' }, { label: 'Upcoming / Review Due', count: upcomingCount, color: 'bg-amber-50 text-amber-700 border-amber-100' }, { label: 'Scheduled / Review', count: viewActions.filter(a => isActive(a) && derivePriority(a).priority === 'green').length, color: 'bg-emerald-50 text-emerald-700 border-emerald-100' }].map(item => (
                          <div key={item.label} className={`flex items-center justify-between text-xs font-black px-4 py-2.5 rounded-xl border ${item.color}`}><span>{item.label}</span><span className="text-base font-black">{item.count}</span></div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
            </div>
          )}

          {view === 'site' && selectedSite && (
            <div className="space-y-6 animate-in slide-in-from-right-8 duration-400">
              <div className="bg-white border border-slate-200 p-4 md:p-8 rounded-lg shadow-sm relative overflow-hidden border-l-[12px] border-l-indigo-700">
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-50/40 to-transparent pointer-events-none" />
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-50/40 to-transparent pointer-events-none" />
                <div className="relative flex items-start justify-between gap-6">
                  <div>
                    <h2 className="text-lg md:text-2xl font-black text-slate-900 tracking-tight">{selectedSite.name}</h2>
                    <p className="text-slate-500 text-xs md:text-sm mt-1 flex items-center gap-1.5">
                      <span className="opacity-50">{getSiteIcon(selectedSite.type, 13)}</span>
                      {SITE_TYPE_LABELS[selectedSite.type] || selectedSite.type}
                    </p>
                    {viewSites.length > 1 && (
                      <select value={selectedSite?.id || ''} onChange={e => { const s = sites.find(s => s.id === e.target.value); if (s) handleSiteClick(s); }} className="mt-2 px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 focus:outline-none bg-white">
                        {viewSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                    {profile?.role === 'superadmin' && (
                      <div className="flex items-center gap-3 mt-2">
                        <button onClick={() => { setView('admin'); setSelectedSite(null); setViewAsRole(null); }} className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors">← Back to Admin</button>
                        {viewAsRole && <span className="text-[10px] font-black uppercase tracking-wider text-indigo-500 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">Viewing as {viewAsRole}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {(selectedSite?.logo_url || siteOrg?.logo_url) && (
                      <div className="bg-white border border-slate-200 rounded-lg px-4 py-2 flex items-center justify-center max-w-[200px]">
                        <img src={selectedSite?.logo_url || siteOrg?.logo_url || ''} alt={selectedSite?.name || siteOrg?.name} className="max-h-20 max-w-[170px] object-contain" />
                      </div>
                    )}
                    {profile?.role === 'superadmin' && selectedSite.datto_folder_id && (
                      <button
                        onClick={() => setShowSyncConfig(true)}
                        className="flex items-center gap-1.5 bg-white border border-violet-200 text-violet-700 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-violet-50"
                        title="Choose which folders to include in AI Sync"
                      >
                        <Settings size={11} />Configure Sync
                        {(selectedSite.excluded_datto_folder_ids?.length ?? 0) > 0 && (
                          <span className="bg-violet-100 text-violet-700 text-[10px] font-black px-1.5 py-0.5 rounded-full">{selectedSite.excluded_datto_folder_ids.length}</span>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {/* ── Reports ── */}
              {!isViewOnly && (
                <div className="flex flex-wrap items-center gap-3 px-1 pb-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reports:</span>
                  <a href={`/report?type=site&siteId=${selectedSite.id}`} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"><ExternalLink size={11} />Site H&amp;S Report</a>
                  <span className="text-slate-200 text-[11px]">|</span>
                  <a href={`/api/reports/actions?siteId=${selectedSite.id}`} download className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"><Download size={11} />Action Register</a>
                  <span className="text-slate-200 text-[11px]">|</span>
                  <a href={`/api/reports/documents?siteId=${selectedSite.id}`} download className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"><Download size={11} />Document Register</a>
                  {(effectiveRole === 'advisor' || effectiveRole === 'superadmin') && selectedSite.organisation_id && (
                    <>
                      <span className="text-slate-200 text-[11px]">|</span>
                      <a href={`/report?type=org&orgId=${selectedSite.organisation_id}`} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"><ExternalLink size={11} />Org H&amp;S Report</a>
                    </>
                  )}
                  {effectiveRole === 'advisor' && (
                    <div className="ml-auto flex items-center gap-1.5">
                      {pendingUploadsCount > 0 && (
                        <button
                          onClick={() => setShowClientUploadsPanel(true)}
                          title={`${pendingUploadsCount} client upload${pendingUploadsCount !== 1 ? 's' : ''} awaiting review`}
                          className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest shadow hover:bg-indigo-700 animate-pulse"
                        >
                          <Paperclip className="w-3 h-3" />
                          Client Uploads ({pendingUploadsCount})
                        </button>
                      )}
                      {aiSuggestionsCount > 0 && (
                        <button
                          onClick={() => setShowAiReviewPanel(true)}
                          title={`${aiSuggestionsCount} AI-extracted actions awaiting your review`}
                          className="flex items-center gap-1.5 bg-amber-500 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest shadow hover:bg-amber-600 animate-pulse"
                        >
                          <Sparkles className="w-3 h-3" />
                          Review Actions ({aiSuggestionsCount})
                        </button>
                      )}
                      <button
                        onClick={() => handleAiSync(selectedSite)}
                        disabled={aiSyncing || !selectedSite.datto_folder_id}
                        title={!selectedSite.datto_folder_id ? 'No Datto folder configured' : 'Sync new and modified documents only'}
                        className="flex items-center gap-1.5 bg-violet-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest shadow hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Sparkles className="w-3 h-3" />
                        {aiSyncing ? 'Syncing…' : 'AI Sync'}
                      </button>
                      <button
                        onClick={() => handleForceAiSync(selectedSite)}
                        disabled={aiSyncing || !selectedSite.datto_folder_id}
                        title={!selectedSite.datto_folder_id ? 'No Datto folder configured' : 'Reprocess all documents regardless of date (slower)'}
                        className="flex items-center gap-1.5 bg-violet-500 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest shadow hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Sync All
                      </button>
                    </div>
                  )}
                </div>
              )}
              {/* ── Score cards ── */}
              {!isViewOnly && <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
                {/* Compliance Score */}
                {(() => {
                  const siteActions = allActions.filter(a => a.site === selectedSite.name);
                  const s = computeActionProgress(siteActions);
                  const c = scoreColor(s);
                  const today = new Date().toLocaleDateString('en-CA');
                  const unresolved = siteActions.filter(a => a.status !== 'resolved' && a.status !== 'pending_review' && a.status !== 'archived');
                  const overdueCount = unresolved.filter(a => derivePriority(a).priority === 'red').length;
                  const upcomingCount = unresolved.filter(a => derivePriority(a).priority === 'amber').length;
                  const ongoingCount = unresolved.length - overdueCount - upcomingCount;
                  const riskTiers = (['HIGH', 'MEDIUM', 'LOW'] as const).map(tier => {
                    const forTier = siteActions.filter(a => a.riskLevel === tier);
                    const onTrackCount = forTier.filter(a => {
                      if (a.status === 'resolved' || a.status === 'pending_review') return true;
                      const d = a.date;
                      const isOverdue = d && !ONGOING_RE.test(d) && /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today;
                      return !isOverdue;
                    }).length;
                    const pct = forTier.length === 0 ? 0 : Math.round((onTrackCount / forTier.length) * 100);
                    return { tier, total: forTier.length, onTrack: onTrackCount, pct };
                  });
                  const hasRiskData = riskTiers.some(t => t.total > 0);
                  const weightedOnTrack = riskTiers.reduce((sum, t) => sum + t.onTrack * (t.tier === 'HIGH' ? 3 : t.tier === 'MEDIUM' ? 2 : 1), 0);
                  const weightedTotal   = riskTiers.reduce((sum, t) => sum + t.total   * (t.tier === 'HIGH' ? 3 : t.tier === 'MEDIUM' ? 2 : 1), 0);
                  const riskScore = weightedTotal === 0 ? 100 : Math.round((weightedOnTrack / weightedTotal) * 100);

                  const iagMandatoryComp = iagServices.filter(sv => sv.is_mandatory);
                  const iagRecommendedComp = iagServices.filter(sv => !sv.is_mandatory);
                  const iagMandScore = iagMandatoryComp.length === 0 ? null
                    : Math.round((iagMandatoryComp.filter(sv => sv.purchased).length / iagMandatoryComp.length) * 100);
                  const iagRecScore = iagRecommendedComp.length === 0 ? null
                    : Math.round((iagRecommendedComp.filter(sv => sv.purchased).length / iagRecommendedComp.length) * 100);
                  const iagWeightedComp =
                    iagMandScore !== null && iagRecScore !== null ? Math.round(iagMandScore * 0.8 + iagRecScore * 0.2)
                    : iagMandScore !== null ? iagMandScore
                    : iagRecScore !== null ? iagRecScore
                    : (selectedSite.iagWeightedScore ?? null);

                  const hsPerfComponents = ([
                    { val: s,               w: 0.4, label: 'ACTIONS' },
                    { val: riskScore,       w: 0.4, label: 'RISK' },
                    { val: iagWeightedComp, w: 0.2, label: 'IAG' },
                  ] as { val: number | null; w: number; label: string }[]).filter(c => c.val !== null) as { val: number; w: number; label: string }[];
                  const hsPerfTotalW = hsPerfComponents.reduce((sum, comp) => sum + comp.w, 0);
                  const hsPerf = hsPerfComponents.length === 0 ? null
                    : Math.round(hsPerfComponents.reduce((sum, comp) => sum + comp.val * comp.w, 0) / hsPerfTotalW);


                  return (
                    <div className="col-span-2 lg:col-span-3 bg-white rounded-lg border border-slate-200 shadow-sm cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all" onClick={() => setSiteTab('actions')}>
                      {/* Card header */}
                      <div className="px-5 py-2.5 border-b border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Compliance Score</p>
                          {pendingReviewCount > 0 && (
                            <>
                              <span className="text-slate-300">|</span>
                              <button onClick={e => { e.stopPropagation(); setSiteTab('actions'); setFilterPriority('pending_review'); }} className="text-[11px] font-medium text-violet-500 hover:text-violet-700 transition-colors">
                                {pendingReviewCount} Action{pendingReviewCount !== 1 ? 's' : ''} Pending Review
                              </button>
                            </>
                          )}
                          {rejectedCount > 0 && (
                            <>
                              <span className="text-slate-300">|</span>
                              <button onClick={e => { e.stopPropagation(); setSiteTab('actions'); setFilterPriority('rejected'); }} className="text-[11px] font-medium text-rose-500 hover:text-rose-700 transition-colors">
                                {rejectedCount} Action{rejectedCount !== 1 ? 's' : ''} Returned
                              </button>
                            </>
                          )}
                        </div>
                        <button onClick={e => { e.stopPropagation(); setScoreExplanationCard('implementation'); }} className="flex items-center gap-1 text-slate-300 hover:text-indigo-500 transition-colors" title="How is this calculated?"><AlertCircle size={14} /><span className="text-[9px] font-black uppercase tracking-wider">Help</span></button>
                      </div>
                      {/* Body */}
                      <div className="px-5 py-4 flex items-start gap-6">
                        <div className="flex flex-col md:flex-row items-start flex-1 md:divide-x divide-slate-100">
                        <div className="flex-1 min-w-0 pb-4 md:pb-0 md:pr-6 border-b border-slate-100 md:border-b-0">
                          <div className="group mb-2.5 cursor-default">
                            <p className="text-[11px] font-black uppercase tracking-widest text-slate-600 flex items-center">Actions Progress<InlineTip text="% of actions that are not overdue and not due within 30 days. Overdue actions are weighted more heavily." /></p>
                            <p className={`text-[11px] font-black uppercase tracking-wide ${c.text}`}>{s}% on track</p>
                          </div>
                          {unresolved.length === 0
                            ? <p className="text-[10px] font-black text-emerald-600 uppercase tracking-wider">all actions resolved</p>
                            : (
                              <div className="space-y-3 w-full">
                                {([
                                  { label: 'Overdue',   count: overdueCount,  bar: 'bg-rose-500',    text: 'text-rose-600' },
                                  { label: 'Upcoming',  count: upcomingCount, bar: 'bg-amber-400',   text: 'text-amber-600' },
                                  { label: 'Scheduled', count: ongoingCount,  bar: 'bg-emerald-500', text: 'text-emerald-600' },
                                ] as { label: string; count: number; bar: string; text: string }[]).map(row => {
                                  const pct = Math.round((row.count / unresolved.length) * 100);
                                  return (
                                    <div key={row.label}>
                                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">{row.label}</p>
                                      <div className="flex items-center gap-2">
                                        <div className="flex-1 bg-slate-100 h-4 rounded-full overflow-hidden">
                                          <div className={`h-full rounded-full ${row.bar}`} style={{ width: `${pct}%` }} />
                                        </div>
                                        <span className={`text-[10px] font-black w-5 text-right shrink-0 ${row.text}`}>{row.count}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )
                          }
                        </div>
                        {hasRiskData && (
                          <div className="flex-1 min-w-0 py-4 md:py-0 md:px-6 border-b border-slate-100 md:border-b-0">
                            <div className="group mb-2.5 cursor-default">
                              <p className="text-[11px] font-black uppercase tracking-widest text-slate-600 flex items-center">Risk Health<InlineTip text="Shows how many actions are on track within each risk level — HIGH, MEDIUM, and LOW — so you can see if your most critical risks are being managed." /></p>
                              <p className={`text-[11px] font-black uppercase tracking-wide ${scoreColor(riskScore).text}`}>{riskScore}% on track</p>
                            </div>
                            {(() => {
                              const riskTotal = riskTiers.reduce((s, t) => s + t.total, 0);
                              return (
                                <div className="space-y-3 w-full">
                                  {([
                                    { tier: 'HIGH',   label: 'High Risk',   bar: 'bg-rose-500',    text: 'text-rose-600' },
                                    { tier: 'MEDIUM', label: 'Medium Risk', bar: 'bg-orange-400',  text: 'text-orange-600' },
                                    { tier: 'LOW',    label: 'Low Risk',    bar: 'bg-emerald-500', text: 'text-emerald-600' },
                                  ] as { tier: string; label: string; bar: string; text: string }[]).map(row => {
                                    const total = riskTiers.find(t => t.tier === row.tier)?.total ?? 0;
                                    const pct = riskTotal === 0 ? 0 : Math.round((total / riskTotal) * 100);
                                    return (
                                      <div key={row.tier}>
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">{row.label}</p>
                                        <div className="flex items-center gap-2">
                                          <div className="flex-1 bg-slate-100 h-4 rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full ${row.bar}`} style={{ width: `${pct}%` }} />
                                          </div>
                                          <span className={`text-[10px] font-black w-5 text-right shrink-0 ${row.text}`}>{total}</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                        {hsPerf !== null && (
                          <div className="flex-1 min-w-0 pt-4 md:pt-0 md:pl-6">
                            <div className="group mb-2.5 cursor-default">
                              <p className="text-[11px] font-black uppercase tracking-widest text-slate-600 flex items-center">H&S Performance<InlineTip text="Composite score: Actions Progress (40%), Risk Health (40%), Industry Alignment (20%)." /></p>
                              <p className={`text-[11px] font-black uppercase tracking-wide ${scoreColor(hsPerf).text}`}>{hsPerf}% overall</p>
                            </div>
                            <div className="space-y-3 w-full">
                              {([
                                { label: 'Actions', val: hsPerfComponents.find(c => c.label === 'ACTIONS')?.val ?? null },
                                { label: 'Risk Health', val: hsPerfComponents.find(c => c.label === 'RISK')?.val ?? null },
                                { label: 'Service Cover', val: hsPerfComponents.find(c => c.label === 'IAG')?.val ?? null },
                              ] as { label: string; val: number | null }[]).filter(r => r.val !== null).map(row => {
                                const c = scoreColor(row.val!);
                                return (
                                  <div key={row.label}>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">{row.label}</p>
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 bg-slate-100 h-4 rounded-full overflow-hidden">
                                        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${row.val}%` }} />
                                      </div>
                                      <span className={`text-[10px] font-black w-7 text-right shrink-0 ${c.text}`}>{row.val}%</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        </div>{/* end columns wrapper */}
                      </div>
                    </div>
                  );
                })()}
                  {/* Right column — IAG + Doc Health stacked (advisor) / IAG full-height (client) */}
                  {(() => {
                    const iagMandatory = iagServices.filter(sv => sv.is_mandatory);
                    const iagMandatoryContracted = iagMandatory.filter(sv => sv.purchased).length;
                    const iagMandatoryTotal = iagMandatory.length;
                    const iagAllContracted = iagServices.filter(sv => sv.purchased).length;
                    const iagAllTotal = iagServices.length;
                    const iagMandatoryGap = iagMandatoryTotal > 0 && iagMandatoryContracted < iagMandatoryTotal;
                    const s = iagAllTotal > 0 ? Math.round((iagAllContracted / iagAllTotal) * 100) : (selectedSite.iagScore ?? 0);
                    const hasScore = iagAllTotal > 0 || selectedSite.iagScore !== null;
                    const docS = selectedSite.compliance;
                    const docC = scoreColor(docS);
                    const isClient = effectiveRole === 'client';
                    return (
                      <div className="col-span-2 lg:col-span-1 flex flex-col gap-3">
                        {/* IAG card */}
                        <div className={`bg-white rounded-lg border border-slate-200 shadow-sm relative cursor-pointer hover:border-violet-300 hover:shadow-md transition-all${isClient ? ' flex-1 flex flex-col' : ''}`} onClick={() => { setSiteTab('iag'); loadIagServices(selectedSite.id); }}>
                          <div className="px-5 py-2.5 border-b border-slate-100 flex items-center justify-between">
                            <div className="group flex items-center cursor-default">
                              <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Industry Alignment</p>
                              <InlineTip text="How many of your site's recommended and mandatory services are contracted, based on your industry type." />
                            </div>
                            <button onClick={e => { e.stopPropagation(); setScoreExplanationCard('iag'); }} className="flex items-center gap-1 text-slate-300 hover:text-violet-500 transition-colors" title="How is this calculated?"><AlertCircle size={14} /><span className="text-[9px] font-black uppercase tracking-wider">Help</span></button>
                          </div>
                          {isClient ? (
                            /* Client: full-height centred layout with larger donut */
                            <div className="flex-1 flex flex-col items-center justify-center px-5 py-6 gap-3">
                              {hasScore
                                ? <ComplianceRing score={s} size={72} percent />
                                : <div className="w-[72px] h-[72px] rounded-full border-4 border-slate-100 flex items-center justify-center"><span className="text-slate-300 text-sm font-black">—</span></div>
                              }
                              <div className="text-center">
                                <p className="text-[9px] text-slate-400 font-medium">coverage vs requirements</p>
                                {iagAllTotal > 0 && (
                                  <div className="flex flex-col items-center gap-1 mt-2">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${iagMandatoryGap ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>{iagMandatoryContracted}/{iagMandatoryTotal} mandatory</span>
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-500 text-[9px] font-black uppercase tracking-wider">{iagAllContracted}/{iagAllTotal} contracted</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            /* Advisor: compact horizontal — donut left, labels/pills right */
                            <div className="px-4 py-3 flex items-center gap-3">
                              <div className="shrink-0">
                                {hasScore
                                  ? <ComplianceRing score={s} size={56} percent />
                                  : <div className="w-14 h-14 rounded-full border-4 border-slate-100 flex items-center justify-center"><span className="text-slate-300 text-sm font-black">—</span></div>
                                }
                              </div>
                              <div className="flex flex-col gap-1.5 min-w-0">
                                <p className="text-[9px] text-slate-400 font-medium leading-tight">coverage vs requirements</p>
                                {iagAllTotal > 0 && (
                                  <>
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${iagMandatoryGap ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>{iagMandatoryContracted}/{iagMandatoryTotal} mandatory</span>
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-500 text-[9px] font-black uppercase tracking-wider">{iagAllContracted}/{iagAllTotal} contracted</span>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        {/* Doc Health card — advisor only, flex-1 fills remaining column height */}
                        {!isClient && (
                          <div className="flex-1 flex flex-col bg-white rounded-lg border border-slate-200 shadow-sm cursor-pointer hover:border-amber-300 hover:shadow-md transition-all" onClick={() => setSiteTab('dochealth')}>
                            <div className="px-5 py-2.5 border-b border-slate-100 flex items-center justify-between">
                              <div className="group flex items-center cursor-default">
                                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Document Management</p>
                                <InlineTip text="Percentage of required documents that are present and up to date. Managed by your advisor based on what's uploaded in the H&S documents folder." />
                              </div>
                              <button onClick={e => { e.stopPropagation(); setScoreExplanationCard('documentation'); }} className="flex items-center gap-1 text-slate-300 hover:text-amber-500 transition-colors" title="How is this calculated?"><AlertCircle size={14} /><span className="text-[9px] font-black uppercase tracking-wider">Help</span></button>
                            </div>
                            <div className="flex-1 flex items-center px-4 py-3 gap-3">
                              <div className="shrink-0">
                                <ComplianceRing score={docS} size={56} />
                              </div>
                              <div>
                                <p className={`text-2xl font-black ${docC.text}`}>{docS}%</p>
                                <p className="text-[10px] text-slate-400 font-medium mt-0.5">advisor managed</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              }
              {!isViewOnly && scoreExplanationCard && <ScoreExplanationModal card={scoreExplanationCard} onClose={() => setScoreExplanationCard(null)} />}
              {/* Site tab toggle */}
              <div className="flex flex-wrap bg-indigo-100 p-1 rounded-xl gap-0.5 w-full">
                {!isViewOnly && (() => {
                  const pendingCount = (effectiveRole === 'advisor' || effectiveRole === 'superadmin') ? siteActions.filter(a => a.status === 'pending_review').length : 0;
                  return (
                    <button onClick={() => setSiteTab('actions')} className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all whitespace-nowrap ${effectiveSiteTab === 'actions' ? 'bg-white shadow-sm text-indigo-600' : 'text-indigo-400 hover:text-indigo-600'}`}>
                      Assigned Actions
                      {pendingCount > 0 && <span className="bg-violet-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">{pendingCount}</span>}
                    </button>
                  );
                })()}
                {selectedSite.datto_folder_id && <button onClick={() => setSiteTab('files')} className={`px-4 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all whitespace-nowrap ${effectiveSiteTab === 'files' ? 'bg-white shadow-sm text-sky-600' : 'text-indigo-400 hover:text-indigo-600'}`}>H&S Documents</button>}
                <button onClick={() => setSiteTab('documents')} className={`px-4 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all whitespace-nowrap ${effectiveSiteTab === 'documents' ? 'bg-white shadow-sm text-amber-600' : 'text-indigo-400 hover:text-indigo-600'}`}>Client Documents</button>
                {!isViewOnly && <button onClick={() => { setSiteTab('iag'); loadIagServices(selectedSite.id); }} className={`px-4 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all whitespace-nowrap ${effectiveSiteTab === 'iag' ? 'bg-white shadow-sm text-violet-600' : 'text-indigo-400 hover:text-indigo-600'}`}>Industry Alignment</button>}
                {effectiveRole !== 'client' && <button onClick={() => setSiteTab('dochealth')} className={`px-4 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all whitespace-nowrap ${effectiveSiteTab === 'dochealth' ? 'bg-white shadow-sm text-amber-600' : 'text-indigo-400 hover:text-indigo-600'}`}>Management</button>}
              </div>

              {effectiveSiteTab === 'actions' && !isViewOnly && (<>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  <button onClick={() => { setActionSearch(''); setShowActionSearch(s => !s); }} className={`p-2 rounded-lg transition-colors ${showActionSearch || actionSearch ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:text-slate-600'}`} title="Search actions"><Search size={13} /></button>
                  {(showActionSearch || actionSearch) && (
                    <div className="relative flex items-center">
                      <input
                        autoFocus
                        type="text"
                        value={actionSearch}
                        onChange={e => setActionSearch(e.target.value)}
                        placeholder="Search actions…"
                        className="pl-2 pr-6 py-1 text-[11px] border border-slate-200 rounded-lg bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 focus:border-indigo-300 w-44"
                      />
                      {actionSearch && <button onClick={() => setActionSearch('')} className="absolute right-1.5 text-slate-400 hover:text-slate-600"><X size={11} /></button>}
                    </div>
                  )}
                  {(['all', 'red', 'open', 'pending_review', 'resolved'] as const).map(f => (
                    <button key={f} onClick={() => setFilterPriority(f)} className={`px-3 py-2 text-[11px] font-black uppercase tracking-wider transition-colors whitespace-nowrap ${
                      f === 'all'            ? filterPriority === f ? 'text-slate-800 underline underline-offset-4 decoration-2' : 'text-slate-400 hover:text-slate-600'
                    : f === 'red'            ? filterPriority === f ? 'text-rose-600 underline underline-offset-4 decoration-2'   : 'text-rose-400 hover:text-rose-600'
                    : f === 'open'           ? filterPriority === f ? 'text-emerald-600 underline underline-offset-4 decoration-2' : 'text-emerald-400 hover:text-emerald-600'
                    : f === 'pending_review' ? filterPriority === f ? 'text-violet-700 underline underline-offset-4 decoration-2' : 'text-violet-400 hover:text-violet-700'
                    :                         filterPriority === f ? 'text-slate-600 underline underline-offset-4 decoration-2' : 'text-slate-400 hover:text-slate-600'
                    }`}>
                      {f === 'all' ? 'All' : f === 'red' ? 'Overdue' : f === 'open' ? 'Open' : f === 'pending_review' ? 'Pending Review' : 'Resolved'} ({filterCounts[f] ?? 0})
                    </button>
                  ))}
                  {rejectedCount > 0 && (
                    <button onClick={() => setFilterPriority('rejected')} className={`px-3 py-2 text-[11px] font-black uppercase tracking-wider transition-colors whitespace-nowrap ${filterPriority === 'rejected' ? 'text-rose-600 underline underline-offset-4 decoration-2' : 'text-rose-400 hover:text-rose-600'}`}>
                      Returned ({rejectedCount})
                    </button>
                  )}
                  {filterPriority === 'resolved' && archivedCount > 0 && (
                    <button onClick={() => setShowArchivedActions(v => !v)} className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-black uppercase tracking-wider transition-colors whitespace-nowrap border rounded-lg ${showArchivedActions ? 'border-slate-300 bg-slate-100 text-slate-600' : 'border-slate-200 text-slate-400 hover:text-slate-600'}`}>
                      <Archive size={11} />Archived ({archivedCount})
                    </button>
                  )}
                  <span className="text-[11px] font-bold text-slate-400 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg whitespace-nowrap">
                    {actionSearch.trim() ? `${searchedSiteActions.length} of ${siteActions.length} matched` : `${openCount} open · ${resolvedCount} resolved`}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {effectiveRole === 'advisor' && <button onClick={() => setShowAddAction(true)} className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700 shadow-sm"><Plus size={13} />Add Action</button>}
                </div>
              </div>
              {showAddAction && selectedSite && <AddActionForm site={selectedSite} onSave={handleActionSaved} onCancel={() => setShowAddAction(false)} />}

              {/* ── AI Review Panel ── */}
              {showAiPanel && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
                <div className="bg-white rounded-xl shadow-2xl w-[90vw] flex flex-col max-h-[92vh] mt-8 mb-8">
                  <div className="bg-violet-600 px-6 py-4 flex items-center justify-between rounded-t-xl">
                    <div className="flex items-center gap-3">
                      <Sparkles className="w-4 h-4 text-violet-200" />
                      <h3 className="font-black text-white uppercase tracking-widest text-sm">AI Extracted Actions</h3>
                      {aiSyncing && <span className="text-violet-200 text-xs font-bold animate-pulse">{aiSyncProgress}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      {!aiSyncing && (
                        <button onClick={() => handleForceAiSync(selectedSite)} title="Reprocess all docs regardless of date" className="px-4 py-2 bg-violet-500 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-400">Sync all</button>
                      )}
                      {!aiSyncing && reviewActions.some(a => a.selected && !a.added && !skippedReview.has(a.id)) && (
                        <button onClick={handleAddSelectedReviewActions} title="Accept all checked actions and add them to the portal" className="px-4 py-2 bg-white text-violet-700 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-50">Accept Selected</button>
                      )}
                      {aiSyncing && <button onClick={() => { aiCancelledRef.current = true; }} className="px-3 py-1.5 bg-rose-500 text-white rounded-lg text-[11px] font-black uppercase tracking-wider hover:bg-rose-600">Cancel</button>}
                      <button onClick={() => setShowAiPanel(false)} className="text-violet-200 hover:text-white"><X size={18} /></button>
                    </div>
                  </div>
                  {aiError && <div className="px-6 py-3 bg-rose-50 border-b border-rose-200 text-rose-700 text-sm font-bold">⚠ {aiError}</div>}
                  {aiSyncing && reviewActions.length === 0 && (
                    <div className="p-8 text-center text-sm font-bold text-slate-400 animate-pulse">{aiSyncProgress || 'Processing documents…'}</div>
                  )}
                  {!aiSyncing && reviewActions.length === 0 && !aiError && (
                    <div className="p-8 text-center space-y-3">
                      <p className="text-sm font-bold text-slate-400">{aiStatusMessage || 'No actions extracted.'}</p>
                      {aiStatusMessage.includes('Sync all') && (
                        <button onClick={() => handleForceAiSync(selectedSite)} className="px-4 py-2 bg-violet-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-700">Sync all docs</button>
                      )}
                    </div>
                  )}
                  {reviewActions.length > 0 && (
                    <div className="divide-y divide-slate-100 flex-1 overflow-y-auto min-h-0">
                      {reviewActions.filter(a => a.isError).map(ra => (
                        <div key={ra.id} className="px-5 py-2.5 bg-rose-50 border-b border-rose-100 text-[11px] font-bold text-rose-600 flex items-center gap-1.5">
                          <AlertCircle size={11} className="text-rose-500 flex-shrink-0" />
                          <span><a href={getFileHref({ id: ra.docFileId ?? '', name: ra.docName ?? '', type: 'file' }, ra.docFolderPath ?? '', effectiveRole)} target={effectiveRole === 'advisor' ? undefined : '_blank'} rel="noreferrer" className="text-rose-700 underline hover:text-rose-500">{ra.docName}</a> could not be processed. <span className="font-normal text-rose-400">{ra.errorMessage}</span></span>
                        </div>
                      ))}
                      {reviewActions.some(a => a.isUnverified) && (
                        <div className="border-b border-amber-100">
                          <div className="px-5 py-2 bg-amber-100 flex items-center gap-2">
                            <AlertCircle size={11} className="text-amber-600 flex-shrink-0" />
                            <span className="text-[10px] font-black uppercase tracking-wider text-amber-700">Date confirmation required</span>
                            <span className="ml-auto text-[10px] font-bold text-amber-600">{reviewActions.filter(a => a.isUnverified).length} document{reviewActions.filter(a => a.isUnverified).length !== 1 ? 's' : ''}</span>
                          </div>
                          {reviewActions.filter(a => a.isUnverified).map(ra => (
                            <div key={ra.id} className="px-5 py-3 bg-amber-50 border-b border-amber-100 flex flex-wrap items-start gap-3">
                              <div className="flex-1 min-w-0 space-y-1">
                                <a href={getFileHref({ id: ra.docFileId ?? '', name: ra.docName ?? '', type: 'file' }, ra.docFolderPath ?? '', effectiveRole)} target={effectiveRole === 'advisor' ? undefined : '_blank'} rel="noreferrer" className="text-[11px] font-black text-amber-800 underline hover:text-amber-600 truncate block">{ra.docName}</a>
                                <p className="text-[10px] font-bold text-amber-600">{(ra.unverifiedSignals ?? []).join(' · ')}</p>
                              </div>
                              <div className="flex flex-col gap-1 flex-shrink-0">
                                <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 pl-1">Assessment date</span>
                                <input type="date" value={unverifiedDates[ra.id] ?? ''} onChange={e => setUnverifiedDates(prev => ({ ...prev, [ra.id]: e.target.value }))} className="px-3 py-1.5 border border-amber-300 rounded-lg text-xs text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-40" />
                              </div>
                              <div className="flex items-end gap-2 flex-shrink-0 pt-4">
                                <button onClick={() => handleUnverifiedProcess(ra.id, unverifiedDates[ra.id] ?? '')} disabled={!unverifiedDates[ra.id]} className="px-4 py-1.5 bg-violet-600 text-white rounded-xl text-[11px] font-black hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed">Process</button>
                                <button onClick={() => handleUnverifiedSkip(ra.id)} className="px-4 py-1.5 border border-rose-200 text-rose-500 rounded-xl text-[11px] font-black hover:bg-rose-50 hover:border-rose-300">Skip</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {(() => {
                        const justAddedActions = reviewActions.filter(a => a.justAdded);
                        const preExistingActions = reviewActions.filter(a => a.added && !a.justAdded);
                        if (justAddedActions.length === 0 && preExistingActions.length === 0) return null;
                        const justAddedDocs = Array.from(new Map(justAddedActions.map(a => [a.docFileId, a.docName])).entries());
                        const preExistingDocs = Array.from(new Map(preExistingActions.map(a => [a.docFileId, a.docName])).entries());
                        return (
                          <div className="border-b border-slate-100">
                            {justAddedDocs.map(([docFileId, docName]) => {
                              const count = justAddedActions.filter(a => a.docFileId === docFileId).length;
                              return (
                                <div key={docFileId} className="px-5 py-2 bg-green-50 flex items-center gap-2">
                                  <CheckCircle size={11} className="text-green-600 flex-shrink-0" />
                                  <span className="text-[11px] font-black text-slate-600 truncate">{docName}</span>
                                  <span className="ml-auto text-[10px] font-bold text-green-600 flex-shrink-0">{count} action{count !== 1 ? 's' : ''} added</span>
                                </div>
                              );
                            })}
                            {preExistingDocs.map(([docFileId, docName]) => {
                              const rasForDoc = preExistingActions.filter(a => a.docFileId === docFileId);
                              const matches = rasForDoc.map(ra => ({
                                ra,
                                portal: allActions.find(a => a.source_document_id === ra.docFileId && (ra.hazardRef ? a.hazardRef === ra.hazardRef : a.action === ra.description)) ?? null,
                              }));
                              const missingDate = matches.filter(m => m.portal && !m.portal.date);
                              return (
                                <div key={docFileId}>
                                  <div className="px-5 py-2 bg-slate-50 flex items-center gap-2">
                                    <CheckCircle size={11} className="text-slate-400 flex-shrink-0" />
                                    <span className="text-[11px] font-black text-slate-500 truncate">{docName}</span>
                                    <span className="ml-auto text-[10px] font-bold flex-shrink-0 flex items-center gap-3">
                                      {missingDate.length > 0 && <span className="text-amber-500">{missingDate.length} missing date</span>}
                                      <span className="text-slate-400">{rasForDoc.length} already in portal</span>
                                    </span>
                                  </div>
                                  {missingDate.map(({ portal }) => portal && (
                                    <div key={portal.id} className="px-5 py-1.5 bg-amber-50 border-t border-amber-100 flex items-center gap-3">
                                      <span className="text-[11px] text-slate-600 truncate flex-1" title={portal.action}>{portal.action}</span>
                                      {preExEditingId === portal.id ? (
                                        <input type="date" value={preExDateInput} autoFocus onClick={e => e.stopPropagation()} onChange={e => setPreExDateInput(e.target.value)} onBlur={() => { setPreExEditingId(null); if (preExDateInput) handleUpdateActionField(portal.id, { date: preExDateInput }); }} onKeyDown={e => { if (e.key === 'Enter') { setPreExEditingId(null); if (preExDateInput) handleUpdateActionField(portal.id, { date: preExDateInput }); } if (e.key === 'Escape') setPreExEditingId(null); }} className="text-xs border-b border-amber-400 outline-none bg-transparent text-amber-700 font-bold" />
                                      ) : (
                                        <span onClick={e => { e.stopPropagation(); setPreExDateInput(''); setPreExEditingId(portal.id); }} className="text-[11px] text-amber-500 font-bold cursor-pointer hover:underline flex-shrink-0">+ set due date</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      {(() => {
                        const newActions = [...reviewActions].filter(ra => !ra.added && !ra.isError && !ra.isUnverified && !skippedReview.has(ra.id));
                        const docGroups = Array.from(new Map(newActions.map(ra => [ra.docFileId, { docName: ra.docName, docFileId: ra.docFileId }])).values());
                        return docGroups.map(({ docName, docFileId }) => (
                          <div key={docFileId}>
                            <div className="bg-slate-100/80 border-b border-slate-200 flex items-center">
                              <button onClick={() => { const isOpen = docGroupExpanded[docFileId] !== false; setDocGroupExpanded(prev => ({ ...prev, [docFileId]: !isOpen })); if (isOpen) setDocResolveExpanded(prev => ({ ...prev, [docFileId]: false })); }} className="flex items-center gap-2 flex-1 px-5 py-2 text-left hover:bg-slate-200/50 transition-colors min-w-0">
                                <ChevronDown size={11} className={`text-slate-400 flex-shrink-0 transition-transform ${docGroupExpanded[docFileId] !== false ? '' : '-rotate-90'}`} />
                                <FileText size={11} className="text-violet-400 flex-shrink-0" />
                                <span className="text-[11px] font-black text-slate-600 truncate">{docName}</span>
                              </button>
                              {docGroupExpanded[docFileId] !== false && (
                                <div className="flex items-center gap-1.5 flex-shrink-0 mr-3">
                                  <button onClick={async () => { const ids = newActions.filter(ra => ra.docFileId === docFileId).map(ra => ra.id); for (const id of ids) await handleAddReviewAction(id); }} title="Accept all actions in this document" className="border border-slate-300 rounded-lg text-[10px] font-black px-2.5 py-1 text-slate-500 hover:bg-slate-200/60 transition-colors">Accept all</button>
                                  <button onClick={() => { setDocResolveExpanded(prev => ({ ...prev, [docFileId]: !prev[docFileId] })); if (!docResolveDates[docFileId]) setDocResolveDates(prev => ({ ...prev, [docFileId]: new Date().toISOString().slice(0, 10) })); }} title="Mark all actions in this document as already resolved (doc unaffected)" className={`border rounded-lg text-[10px] font-black px-2.5 py-1 transition-colors ${docResolveExpanded[docFileId] ? 'bg-slate-200 border-slate-300 text-slate-700' : 'border-slate-300 text-slate-500 hover:bg-slate-200/60'}`}>Resolve all</button>
                                  <button onClick={() => skipAllReviewDoc(docFileId)} title="Hide all actions in this document for this session (doc unaffected)" className="border border-slate-300 rounded-lg text-[10px] font-black px-2.5 py-1 text-slate-500 hover:bg-slate-200/60 transition-colors">Skip all</button>
                                  <button onClick={() => rejectAllReviewDoc(docFileId)} title="Permanently discard all actions in this document (doc unaffected)" className="border border-rose-200 rounded-lg text-[10px] font-black px-2.5 py-1 text-rose-500 hover:bg-rose-50 transition-colors">Reject all</button>
                                </div>
                              )}
                              <span className="text-[10px] font-bold text-slate-400 flex-shrink-0 pr-5">{newActions.filter(ra => ra.docFileId === docFileId).length} action{newActions.filter(ra => ra.docFileId === docFileId).length !== 1 ? 's' : ''}</span>
                            </div>
                            {docGroupExpanded[docFileId] !== false && docResolveExpanded[docFileId] && (
                              <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 space-y-3">
                                <p className="text-[11px] font-black text-slate-600">Mark all actions in this document as resolved</p>
                                <div className="flex flex-wrap gap-4 items-end">
                                  <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Resolved date</span>
                                    <input type="date" value={docResolveDates[docFileId] ?? new Date().toISOString().slice(0, 10)} onChange={e => setDocResolveDates(prev => ({ ...prev, [docFileId]: e.target.value }))} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white" />
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Evidence (optional)</span>
                                    <div className="flex items-center gap-2">
                                      <input id={`doc-resolve-file-${docFileId}`} type="file" multiple accept=".pdf,.docx,.doc,.jpg,.jpeg,.png" className="hidden" onChange={e => { const files = Array.from(e.target.files ?? []); setDocResolveFiles(prev => ({ ...prev, [docFileId]: [...(prev[docFileId] ?? []), ...files] })); e.target.value = ''; }} />
                                      <button type="button" onClick={() => document.getElementById(`doc-resolve-file-${docFileId}`)?.click()} className="px-3 py-1.5 border border-slate-200 rounded-lg text-[11px] font-black text-slate-500 hover:bg-slate-100 hover:border-slate-300">+ Select files</button>
                                      {(docResolveFiles[docFileId] ?? []).length > 0 && (
                                        <div className="flex flex-col gap-0.5">
                                          {(docResolveFiles[docFileId] ?? []).map((f, i) => (
                                            <span key={i} className="flex items-center gap-1 text-[11px] text-slate-600 font-bold">
                                              <span className="truncate max-w-[140px]">{f.name}</span>
                                              <button type="button" onClick={() => setDocResolveFiles(prev => ({ ...prev, [docFileId]: (prev[docFileId] ?? []).filter((_, j) => j !== i) }))} className="text-slate-400 hover:text-slate-600 flex-shrink-0 ml-1">×</button>
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                      {docResolveUploading[docFileId] && <span className="text-[11px] text-slate-400 italic">Uploading…</span>}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <button onClick={() => handleMarkDocAllResolved(docFileId)} disabled={docResolveUploading[docFileId]} className="px-4 py-1.5 bg-emerald-600 text-white rounded-xl text-[11px] font-black hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">Confirm all resolved</button>
                                  <button onClick={() => { setDocResolveExpanded(prev => ({ ...prev, [docFileId]: false })); setDocResolveFiles(prev => ({ ...prev, [docFileId]: [] })); }} className="px-4 py-1.5 border border-rose-200 text-rose-500 rounded-xl text-[11px] font-black hover:bg-rose-50 hover:border-rose-300">Cancel</button>
                                </div>
                              </div>
                            )}
                            {docGroupExpanded[docFileId] !== false && newActions.filter(ra => ra.docFileId === docFileId).map(ra => (
                        <div key={ra.id} className={`p-5 transition-colors hover:bg-slate-50`}>
                          <div className="flex gap-4 items-start">
                          <input type="checkbox" checked={ra.selected} onChange={e => setReviewActions(prev => prev.map(a => a.id === ra.id ? { ...a, selected: e.target.checked } : a))} disabled={ra.added} className="mt-1 w-4 h-4 accent-violet-600 flex-shrink-0" />
                          <div className="flex-1 min-w-0 space-y-2">
                            {/* Breadcrumb strip */}
                            <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 pb-2 border-b border-slate-100">
                              <span className="text-[11px] font-black text-slate-600">{ra.docName}</span>
                              {ra.hazardRef && <><span className="text-slate-300 text-[10px]">|</span><span className="text-[10px] font-bold text-slate-500">Hazard No. {ra.hazardRef}</span></>}
                              {ra.documentMeta?.assessmentDate && <><span className="text-slate-300 text-[10px]">|</span><span className="text-[10px] font-bold text-slate-400">Issued: {fmtDate(ra.documentMeta.assessmentDate)}</span></>}
                              {ra.dueDate && <><span className="text-slate-300 text-[10px]">|</span><span className="text-[10px] font-bold text-slate-400">Due: {fmtDate(ra.dueDate)}</span></>}
                            </div>
                            {/* Hazard & existing measures */}
                            {(ra.hazard || ra.existingControls) && (
                              <div className="space-y-2 pl-1">
                                {ra.hazard && (
                                  <div>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-700 mb-0.5">Hazard</p>
                                    {formatExtractedText(ra.hazard)}
                                  </div>
                                )}
                                {ra.existingControls && (
                                  <div>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-700 mb-0.5">Existing Measures</p>
                                    {formatExtractedText(ra.existingControls)}
                                  </div>
                                )}
                              </div>
                            )}
                            {/* Action description */}
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] font-black uppercase tracking-wider text-slate-700 pl-1">Action Required{!ra.added && <span className="font-normal normal-case text-slate-400"> — editable</span>}</span>
                              <textarea
                                ref={el => { if (el) { reviewDescRefs.current[ra.id] = el; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                                defaultValue={ra.description}
                                onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                                disabled={ra.added}
                                rows={1}
                                className="w-full text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none overflow-hidden bg-white disabled:bg-slate-50 disabled:text-slate-500"
                              />
                            </div>
                            {/* Controls row — labelled */}
                            <div className="flex flex-wrap gap-3 items-end">
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 pl-3">Due Date</span>
                                <input
                                  type={ra.dueDate && !isIsoDate(ra.dueDate) ? 'text' : 'date'}
                                  value={ra.dueDate || ''}
                                  onChange={e => setReviewActions(prev => prev.map(a => a.id === ra.id ? { ...a, dueDate: e.target.value || null } : a))}
                                  disabled={ra.added}
                                  className={`px-3 py-1.5 border rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 bg-white disabled:bg-slate-50 ${!ra.dueDate && !ra.added ? 'border-amber-300 focus:ring-amber-200' : 'border-slate-200 focus:ring-violet-300'}`}
                                />
                                {!ra.dueDate && !ra.added && (
                                  <span className="text-[10px] text-amber-500 pl-3">No date found — check document</span>
                                )}
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 pl-3">Responsible Person</span>
                                <input
                                  type="text"
                                  value={ra.responsiblePerson || ''}
                                  onChange={e => setReviewActions(prev => prev.map(a => a.id === ra.id ? { ...a, responsiblePerson: e.target.value || null } : a))}
                                  disabled={ra.added}
                                  placeholder="e.g. Site Manager"
                                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white disabled:bg-slate-50 w-44"
                                />
                              </div>
                              {ra.riskRating && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 pl-3">Risk Rating</span>
                                  <span className={`px-3 py-1.5 rounded-lg text-xs font-black border ${
                                    ra.riskLevel === 'HIGH' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                                    ra.riskLevel === 'MEDIUM' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                    ra.riskLevel === 'LOW' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                    'bg-slate-100 text-slate-600 border-slate-200'
                                  }`}>{ra.riskRating}</span>
                                </div>
                              )}
                              {ra.documentMeta?.assessor !== undefined && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 pl-3">Advisor</span>
                                  <select
                                    value={advisors.some(a => a.email === ra.documentMeta?.assessor) ? ra.documentMeta?.assessor : '__other__'}
                                    onChange={e => setReviewActions(prev => prev.map(a => a.id === ra.id ? { ...a, documentMeta: a.documentMeta ? { ...a.documentMeta, assessor: e.target.value } : null } : a))}
                                    disabled={ra.added}
                                    className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white disabled:bg-slate-50"
                                  >
                                    <option value="">No advisor</option>
                                    {advisors.map(a => <option key={a.id} value={a.email}>{a.email}</option>)}
                                    {ra.documentMeta?.assessor && !advisors.some(a => a.email === ra.documentMeta?.assessor) && (
                                      <option value="__other__">{ra.documentMeta.assessor}</option>
                                    )}
                                  </select>
                                </div>
                              )}
                            </div>
                            {/* AI Suggestion mini-card */}
                            {(ra.riskRating || ra.regulation) && (
                              <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3 space-y-1.5">
                                <div className="flex items-center justify-between gap-2 flex-wrap gap-y-1">
                                  <span className="text-[10px] font-black uppercase tracking-wider text-violet-500 flex items-center gap-1.5"><Sparkles size={10} />AI Suggestion</span>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {ra.riskRating && (
                                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${
                                        ra.riskLevel === 'HIGH' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                                        ra.riskLevel === 'MEDIUM' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                        ra.riskLevel === 'LOW' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                        'bg-slate-100 text-slate-600 border-slate-200'
                                      }`}>Risk: {ra.riskRating}</span>
                                    )}
                                  </div>
                                </div>
                                {ra.riskLevel && <p className="text-[11px] text-slate-600"><span className="font-black">Risk Level:</span> {ra.riskLevel}</p>}
                                {ra.regulation && <p className="text-[11px] text-slate-600"><span className="font-black">Regulation:</span> {ra.regulation}</p>}
                              </div>
                            )}
                          </div>
                          <div className="flex-shrink-0 flex flex-col gap-2">
                            {ra.added ? (
                              <span className="flex items-center gap-1.5 text-[11px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl"><CheckCircle size={12} />Added</span>
                            ) : (
                              <>
                                <button onClick={() => handleAddReviewAction(ra.id)} title="Accept this action and add it to the portal" className="px-4 py-1.5 bg-violet-600 text-white rounded-xl text-[11px] font-black hover:bg-violet-700">Accept</button>
                                <button onClick={() => { setResolveExpanded(prev => ({ ...prev, [ra.id]: !prev[ra.id] })); if (!resolveDates[ra.id]) setResolveDates(prev => ({ ...prev, [ra.id]: new Date().toISOString().slice(0, 10) })); }} title="Mark this action as already resolved (doc unaffected)" className={`border rounded-xl text-[11px] font-black px-3 py-1.5 transition-colors ${resolveExpanded[ra.id] ? 'bg-slate-100 border-slate-300 text-slate-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:border-slate-300'}`}>Already Resolved</button>
                                <button onClick={() => skipReviewAction(ra.id)} title="Hide this action for this session (doc unaffected)" className="px-3 py-1.5 border border-slate-300 text-slate-600 rounded-xl text-[11px] font-black hover:bg-slate-50 hover:border-slate-400">&rsaquo; Skip</button>
                                <button onClick={() => rejectReviewAction(ra.id)} title="Permanently discard this action (doc unaffected)" className="px-3 py-1.5 border border-rose-200 text-rose-600 rounded-xl text-[11px] font-black hover:bg-rose-50 hover:border-rose-300 flex items-center gap-1"><Trash2 size={10} />Reject</button>
                              </>
                            )}
                            {(() => {
                              const basePath = typeof window !== 'undefined' ? (localStorage.getItem('dattoBasePath') || 'W:/Customer Documents') : 'W:/Customer Documents';
                              const uri = ra.docFolderPath ? buildOfficeUri(basePath, ra.docFolderPath, ra.docName) : null;
                              const href = uri ?? `/api/datto/file?fileId=${ra.docFileId}&fileName=${encodeURIComponent(ra.docName)}`;
                              return (
                                <a href={href} target={uri ? '_self' : '_blank'} rel="noopener noreferrer"
                                  className="px-3 py-1.5 border border-indigo-200 text-indigo-500 rounded-xl text-[11px] font-black hover:bg-indigo-50 hover:border-indigo-300 flex items-center gap-1 justify-center"
                                  title="Open source document locally">
                                  <ExternalLink size={10} />Open doc
                                </a>
                              );
                            })()}
                          </div>
                          </div>
                          {resolveExpanded[ra.id] && (
                            <div className="mt-3 pt-3 border-t border-slate-100 space-y-3 ml-7">
                              <p className="text-[11px] font-black text-slate-600">Mark as already resolved</p>
                              <div className="flex flex-wrap gap-4 items-end">
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Resolved date</span>
                                  <input type="date" value={resolveDates[ra.id] ?? new Date().toISOString().slice(0, 10)} onChange={e => setResolveDates(prev => ({ ...prev, [ra.id]: e.target.value }))} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white" />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Evidence (optional)</span>
                                  <div className="flex items-center gap-2">
                                    <input id={`resolve-file-${ra.id}`} type="file" accept=".pdf,.docx,.doc,.jpg,.jpeg,.png" className="hidden" onChange={e => { const f = e.target.files?.[0] ?? null; setResolveFiles(prev => ({ ...prev, [ra.id]: f })); e.target.value = ''; }} />
                                    <button type="button" onClick={() => document.getElementById(`resolve-file-${ra.id}`)?.click()} className="px-3 py-1.5 border border-slate-200 rounded-lg text-[11px] font-black text-slate-500 hover:bg-slate-50 hover:border-slate-300">+ Select file</button>
                                    {resolveFiles[ra.id] && (
                                      <span className="flex items-center gap-1 text-[11px] text-slate-600 font-bold">
                                        <span className="truncate max-w-[120px]">{resolveFiles[ra.id]!.name}</span>
                                        <button type="button" onClick={() => setResolveFiles(prev => ({ ...prev, [ra.id]: null }))} className="text-slate-400 hover:text-slate-600 flex-shrink-0 ml-1">×</button>
                                      </span>
                                    )}
                                    {resolveUploading[ra.id] && <span className="text-[11px] text-slate-400 italic">Uploading…</span>}
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => handleMarkReviewActionResolved(ra.id)} disabled={resolveUploading[ra.id]} className="px-4 py-1.5 bg-emerald-600 text-white rounded-xl text-[11px] font-black hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">Confirm resolved</button>
                                <button onClick={() => { setResolveExpanded(prev => ({ ...prev, [ra.id]: false })); setResolveFiles(prev => ({ ...prev, [ra.id]: null })); }} className="px-4 py-1.5 border border-rose-200 text-rose-500 rounded-xl text-[11px] font-black hover:bg-rose-50 hover:border-rose-300">Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                            ))}
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                  {/* Session log footer */}
                  {reviewLog.length > 0 && (() => {
                    const added = reviewLog.filter(e => e.action === 'added').length;
                    const resolved = reviewLog.filter(e => e.action === 'resolved').length;
                    const skipped = reviewLog.filter(e => e.action === 'skipped').length;
                    const rejected = reviewLog.filter(e => e.action === 'rejected').length;
                    return (
                      <div className="border-t border-slate-100 bg-slate-50 px-6 py-4 flex-shrink-0 rounded-b-xl space-y-3">
                        <div>
                          <button onClick={() => setReviewLogExpanded(v => !v)} className="flex items-center gap-2 flex-wrap mb-2">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Session summary</span>
                            {added > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-md border text-emerald-700 bg-emerald-50 border-emerald-200">{added} accepted</span>}
                            {resolved > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-md border text-blue-700 bg-blue-50 border-blue-200">{resolved} resolved</span>}
                            {skipped > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-md border text-slate-600 bg-slate-100 border-slate-200">{skipped} skipped</span>}
                            {rejected > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-md border text-rose-700 bg-rose-50 border-rose-200">{rejected} rejected</span>}
                            <ChevronDown size={11} className={`text-slate-400 transition-transform ${reviewLogExpanded ? '' : '-rotate-90'}`} />
                          </button>
                          {reviewLogExpanded && (
                            <div className="space-y-0.5 max-h-36 overflow-y-auto pr-1">
                              {reviewLog.map((e, i) => (
                                <div key={i} className="flex items-start gap-2 text-[11px]">
                                  <span className={`flex-shrink-0 font-black w-16 ${e.action === 'added' ? 'text-emerald-600' : e.action === 'resolved' ? 'text-blue-600' : e.action === 'skipped' ? 'text-slate-400' : 'text-rose-600'}`}>{e.action === 'added' ? 'accepted' : e.action}</span>
                                  <span className="text-slate-600 truncate flex-1" title={e.title}>{e.title}</span>
                                  <span className="text-slate-400 text-[10px] flex-shrink-0 truncate max-w-[160px]" title={e.docName}>{e.docName}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex justify-end">
                          <button onClick={() => setShowAiPanel(false)} className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-slate-50">Close</button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                </div>
              )}

              <div className="space-y-4">
                {displayedActions.length === 0 ? (
                  actionSearch.trim() ? (
                    <div className="bg-white rounded-lg border border-slate-200 p-12 text-center"><Search size={28} className="text-slate-300 mx-auto mb-3" /><p className="font-black text-slate-700">No actions match &ldquo;{actionSearch}&rdquo;</p><button onClick={() => setActionSearch('')} className="text-[11px] text-indigo-500 hover:underline mt-2">Clear search</button></div>
                  ) : (
                    <div className="bg-white rounded-lg border border-slate-200 p-12 text-center"><CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-3" /><p className="font-black text-slate-700">No actions for this site</p><p className="text-sm text-slate-400 mt-1">All items resolved or filtered out.</p></div>
                  )
                ) : docGroups.map(({ source, fileId, displayName, actions, redCount, amberCount, highRiskCount, hasRed, hasAmber }) => {
                  const isOpen = actionSearch.trim() ? true : expandedDocGroups.has(source);
                  const isSyncingThis = syncingDocId === String(fileId);
                  const isAdvisor = effectiveRole === 'advisor' || effectiveRole === 'superadmin';
                  return (
                    <div key={source} data-doc-source={source}>
                      <div className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-indigo-200 transition-colors ${isOpen ? 'bg-indigo-200' : 'bg-indigo-100'}`}>
                        <button onClick={() => toggleDocGroup(source)} className="flex items-center gap-3 flex-1 text-left min-w-0">
                          <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                          <span className="font-black text-[12px] text-slate-700 truncate flex-1">{highlight(displayName, actionSearch)}</span>
                        </button>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {redCount > 0 && <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded-lg bg-rose-100 text-rose-700 border border-rose-200">{redCount} Overdue action{redCount !== 1 ? 's' : ''}</span>}
                          {highRiskCount > 0 && <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded-lg bg-rose-600 text-white border border-rose-700">{highRiskCount} High Risk</span>}
                          {amberCount > 0 && !hasRed && <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700 border border-amber-200">{amberCount} upcoming</span>}
                          {!hasRed && !hasAmber && <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-700 border border-emerald-200">{actions.length} scheduled</span>}
                          {isOpen && isAdvisor && actions.some(a => !resolvedIds.includes(a.id) && a.status !== 'resolved' && a.status !== 'archived') && (
                            <button
                              onClick={() => { setBulkResolveExpanded(prev => ({ ...prev, [source]: !prev[source] })); if (!bulkResolveDates[source]) setBulkResolveDates(prev => ({ ...prev, [source]: new Date().toLocaleDateString('en-CA') })); }}
                              className={`border rounded-lg text-[10px] font-black px-2.5 py-1 transition-colors ${bulkResolveExpanded[source] ? 'bg-indigo-300 border-indigo-400 text-indigo-900' : 'border-indigo-300 text-indigo-600 hover:bg-indigo-300/50'}`}
                            >Mark all resolved</button>
                          )}
                          {isAdvisor && fileId && (
                            <button
                              onClick={e => { e.stopPropagation(); if (!isSyncingThis && !aiSyncing) handleSingleDocSync(selectedSite, String(fileId)); }}
                              disabled={isSyncingThis || aiSyncing}
                              title="Re-sync this document"
                              className={`p-1 rounded-lg transition-colors ${isSyncingThis ? 'text-violet-500 animate-spin' : 'text-indigo-300 hover:text-violet-500'} disabled:opacity-40`}
                            >
                              <RefreshCw size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                      {isOpen && bulkResolveExpanded[source] && (
                        <div className="mt-1 mb-2 px-4 py-3 bg-white rounded-xl border border-indigo-200 space-y-3">
                          <p className="text-[11px] font-black text-slate-600">Mark all unresolved actions in this document as resolved</p>
                          <div className="flex flex-wrap gap-4 items-end">
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Resolved date</span>
                              <input type="date" value={bulkResolveDates[source] ?? new Date().toLocaleDateString('en-CA')} onChange={e => setBulkResolveDates(prev => ({ ...prev, [source]: e.target.value }))} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white" />
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Evidence (optional)</span>
                              <div className="flex items-center gap-2">
                                <input id={`bulk-resolve-file-${source}`} type="file" multiple accept=".pdf,.docx,.doc,.jpg,.jpeg,.png" className="hidden" onChange={e => { const files = Array.from(e.target.files ?? []); setBulkResolveFiles(prev => ({ ...prev, [source]: [...(prev[source] ?? []), ...files] })); e.target.value = ''; }} />
                                <button type="button" onClick={() => document.getElementById(`bulk-resolve-file-${source}`)?.click()} className="px-3 py-1.5 border border-slate-200 rounded-lg text-[11px] font-black text-slate-500 hover:bg-slate-50 hover:border-slate-300">+ Select files</button>
                                {(bulkResolveFiles[source] ?? []).length > 0 && (
                                  <div className="flex flex-col gap-0.5">
                                    {(bulkResolveFiles[source] ?? []).map((f, i) => (
                                      <span key={i} className="flex items-center gap-1 text-[11px] text-slate-600 font-bold">
                                        <span className="truncate max-w-[140px]">{f.name}</span>
                                        <button type="button" onClick={() => setBulkResolveFiles(prev => ({ ...prev, [source]: (prev[source] ?? []).filter((_, j) => j !== i) }))} className="text-slate-400 hover:text-slate-600 flex-shrink-0 ml-1">×</button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {bulkResolveUploading[source] && <span className="text-[11px] text-slate-400 italic">Uploading…</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => handleBulkResolveActions(source, actions)} disabled={bulkResolveUploading[source]} className="px-4 py-1.5 bg-emerald-600 text-white rounded-xl text-[11px] font-black hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">Confirm all resolved</button>
                            <button onClick={() => { setBulkResolveExpanded(prev => ({ ...prev, [source]: false })); setBulkResolveFiles(prev => ({ ...prev, [source]: [] })); }} className="px-4 py-1.5 border border-rose-200 text-rose-500 rounded-xl text-[11px] font-black hover:bg-rose-50 hover:border-rose-300">Cancel</button>
                          </div>
                        </div>
                      )}
                      {isOpen && (
                        <div className="space-y-3 mt-2 pl-2">
                          {actions.map(action => <ActionCard key={action.id} action={{ ...action, notes: actionNotes[action.id] || action.notes }} isResolved={resolvedIds.includes(action.id) || action.status === 'resolved' || action.status === 'archived'} onToggleResolve={toggleResolve} onAddNote={handleAddNote} onDelete={handleDeleteAction} onUpdateIssueDate={handleUpdateIssueDate} onUpdateField={handleUpdateActionField} onClientSubmit={handleClientSubmit} onClientWithdraw={handleClientWithdraw} onAdvisorConfirm={handleAdvisorConfirm} onAdvisorReject={handleAdvisorReject} onApplyFromWord={handleApplyFromWord} onRestore={handleRestoreAction} role={effectiveRole} canDelete={profile?.role === 'superadmin'} expanded={expandedActionId === action.id} onExpand={() => setExpandedActionId(prev => prev === action.id ? null : action.id)} siteId={selectedSite?.id} userId={user?.id} onFlash={showAppFlash} searchQuery={actionSearch} />)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </>)}

              {effectiveSiteTab === 'documents' && profile && (
                <SiteDocumentsTab
                  site={selectedSite}
                  profile={profile}
                  userId={user?.id ?? null}
                  onComplianceUpdate={(score) => {
                    setSelectedSite(prev => prev ? { ...prev, compliance: score } : prev);
                    setSites(prev => prev.map(s => s.id === selectedSite.id ? { ...s, compliance: score } : s));
                  }}
                  onActionsAdded={(newActions) => setAllActions(prev => [...prev, ...newActions.filter((a: any) => !a._siteDocumentId)])}
                  onDocumentDeleted={(docId) => setAllActions(prev => prev.filter(a => (a as any)._siteDocumentId !== docId))}
                />
              )}

              {/* ── Document Health tab (advisor only) ── */}
              {effectiveSiteTab === 'dochealth' && effectiveRole !== 'client' && (
                <DocHealthTab siteId={selectedSite.id} onComplianceUpdate={(score) => {
                  setSelectedSite(prev => prev ? { ...prev, compliance: score } : prev);
                  setSites(prev => prev.map(s => s.id === selectedSite.id ? { ...s, compliance: score } : s));
                }} onJumpToActions={(docName) => {
                  pendingExpandDocRef.current = docName;
                  setSiteTab('actions');
                  setTimeout(() => {
                    const el = Array.from(document.querySelectorAll<HTMLElement>('[data-doc-source]'))
                      .find(e => e.getAttribute('data-doc-source') === docName);
                    if (!el) return;
                    const top = el.getBoundingClientRect().top + window.scrollY - 90;
                    window.scrollTo({ top, behavior: 'smooth' });
                  }, 300);
                }} role={effectiveRole} onArchive={handleArchiveDoc} onClone={handleCloneDoc} onUnarchive={(docName) => {
                  setAllActions(prev => prev.map(a => a.source === docName ? { ...a, status: 'open' as ActionStatus, resolvedDate: null } : a));
                }} />
              )}

              {/* ── Files browser tab — accordion style ── */}
              {effectiveSiteTab === 'files' && selectedSite.datto_folder_id && (() => {
                const role = effectiveRole;
                const rootEntry = folderData.get(selectedSite.datto_folder_id!);
                const rootItems = rootEntry ? [...rootEntry.items].sort((a, b) =>
                  a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1
                ) : [];
                const rootFolders = rootItems.filter(i => i.type === 'folder' && !(role === 'client' && /^vault$/i.test(i.name)));
                const rootFiles = rootItems.filter(i => i.type === 'file');

                const handleSearchChange = async (q: string) => {
                  setFileSearchQuery(q);
                  if (!q.trim() || searchFileCache?.siteId === selectedSite.id || searchLoading) return;
                  setSearchLoading(true);
                  try {
                    const files = await fetchAllFiles(selectedSite.datto_folder_id!, new Set(), browserRootPath, true);
                    setSearchFileCache({ siteId: selectedSite.id, files: files.filter(f => f.type === 'file') });
                  } finally {
                    setSearchLoading(false);
                  }
                };

                const toggleSection = async (folder: DattoItem) => {
                  if (expandedFolderIds.has(folder.id)) {
                    setExpandedFolderIds(new Set());
                  } else {
                    setExpandedFolderIds(new Set([folder.id]));
                    if (!sectionFiles.has(folder.id)) {
                      setSectionLoading(prev => { const s = new Set(prev); s.add(folder.id); return s; });
                      try {
                        const folderPath = rootEntry ? `${rootEntry.path}/${folder.name}` : folder.name;
                        const all = await fetchAllFiles(folder.id, new Set(), folderPath, true);
                        setSectionFiles(prev => new Map(prev).set(folder.id, all.filter(f => f.type === 'file')));
                      } finally {
                        setSectionLoading(prev => { const s = new Set(prev); s.delete(folder.id); return s; });
                      }
                    }
                  }
                };

                const renderFileRow = (file: DattoItem & { folderPath?: string }, subPath?: string) => {
                  const badge = fileTypeBadge(file.name);
                  const href = getFileHref(file, file.folderPath || browserRootPath, role, role === 'client' ? user?.id : undefined, role === 'client' ? selectedSite?.id : undefined);
                  const isOfficeLink = href.startsWith('ms-');
                  return (
                    <a
                      key={file.id}
                      href={href}
                      target={isOfficeLink ? undefined : '_blank'}
                      rel={isOfficeLink ? undefined : 'noopener noreferrer'}
                      className="flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-indigo-50 group transition-colors"
                      title={isOfficeLink ? 'Open in Word/Excel from mapped drive' : undefined}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-slate-700 group-hover:text-indigo-700 truncate flex items-center gap-1.5">
                          <span className="truncate">{file.name.replace(/\.[^.]+$/, '')}</span>
                          <span className={`text-[8px] font-black px-1 py-0.5 rounded flex-shrink-0 ${badge.cls}`}>{badge.label}</span>
                        </p>
                        {subPath && <p className="text-[10px] text-slate-400 truncate mt-0.5">{subPath}</p>}
                      </div>
                      {file.modified && <span className="text-[10px] text-slate-300 flex-shrink-0 tabular-nums">{new Date(file.modified).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</span>}
                    </a>
                  );
                };

                const searchResults = fileSearchQuery.trim() && searchFileCache
                  ? searchFileCache.files.filter(f => f.name.toLowerCase().includes(fileSearchQuery.toLowerCase()))
                  : null;

                return (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-400 font-medium px-1">{(effectiveRole === 'advisor' || effectiveRole === 'superadmin') ? 'Search and open your H&S documents. Office files open locally via W: drive.' : 'Search, view and download your H&S documents. Files open as PDF in your browser.'}</p>
                    {/* Search bar */}
                    <div className="bg-white rounded-lg border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3">
                      <Search size={14} className="text-slate-400 flex-shrink-0" />
                      <input
                        type="text"
                        placeholder="Search all files…"
                        value={fileSearchQuery}
                        onChange={e => handleSearchChange(e.target.value)}
                        className="flex-1 text-sm text-slate-700 placeholder-slate-300 bg-transparent outline-none"
                      />
                      {searchLoading && <span className="text-[10px] font-bold text-slate-400 animate-pulse">Searching…</span>}
                      {fileSearchQuery && <button onClick={() => { setFileSearchQuery(''); setSearchFileCache(null); }} className="text-slate-300 hover:text-slate-500"><X size={13} /></button>}
                    </div>

                    {/* Search results */}
                    {searchResults !== null ? (
                      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                        {searchResults.length === 0 ? (
                          <div className="p-8 text-center text-slate-400 text-sm font-bold">No files match "{fileSearchQuery}"</div>
                        ) : (
                          <div className="divide-y divide-slate-50">
                            {searchResults.map(file => {
                              const relPath = file.folderPath?.replace(browserRootPath, '').replace(/^\//, '') || '';
                              return renderFileRow(file, relPath || undefined);
                            })}
                          </div>
                        )}
                      </div>
                    ) : loadingFolderIds.has(selectedSite.datto_folder_id!) && !rootEntry ? (
                      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-8 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div>
                    ) : (
                      <>
                        {/* Accordion sections — one per top-level folder */}
                        {rootFolders.map(folder => {
                          const isExpanded = expandedFolderIds.has(folder.id);
                          const isLoading = sectionLoading.has(folder.id);
                          const files = sectionFiles.get(folder.id) ?? [];
                          return (
                            <div key={folder.id} className="bg-indigo-50 rounded-lg border border-indigo-100 shadow-sm overflow-hidden">
                              <button
                                onClick={() => toggleSection(folder)}
                                className={`group w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left border-l-4 ${isExpanded ? 'bg-indigo-100 border-l-indigo-500' : 'bg-indigo-50 border-l-indigo-200 hover:bg-indigo-100 hover:border-l-indigo-400'}`}
                              >
                                {isExpanded
                                  ? <FolderOpen size={15} className="text-indigo-500 flex-shrink-0" />
                                  : <Folder size={15} className="text-indigo-300 group-hover:text-indigo-500 flex-shrink-0 transition-colors" />
                                }
                                <span className={`text-[13px] font-bold flex-1 truncate ${isExpanded ? 'text-indigo-700' : 'text-indigo-600 group-hover:text-indigo-700'} transition-colors`}>{folder.name}</span>
                                {isExpanded && files.length > 0 && (
                                  <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full flex-shrink-0">{files.length}</span>
                                )}
                                {isLoading
                                  ? <span className="inline-block w-3.5 h-3.5 border-2 border-slate-200 border-t-sky-500 rounded-full animate-spin flex-shrink-0" />
                                  : <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                }
                              </button>
                              {isExpanded && !isLoading && (
                                <div className="border-t border-slate-100">
                                  {files.length === 0 ? (
                                    <p className="px-4 py-4 text-[12px] text-slate-400">No files found in this section.</p>
                                  ) : (() => {
                                    const sectionPath = `${rootEntry?.path}/${folder.name}`;
                                    // Two-level grouping: first by immediate subfolder, then by the next
                                    // path segment within that subfolder (sub-subfolders like Archive).
                                    type GroupData = { directFiles: typeof files; subGroups: Map<string, typeof files> };
                                    const grouped = new Map<string, GroupData>();
                                    for (const file of files) {
                                      const fullRel = file.folderPath?.replace(sectionPath, '').replace(/^\//, '') || '';
                                      const slash1 = fullRel.indexOf('/');
                                      const topKey = slash1 >= 0 ? fullRel.slice(0, slash1) : fullRel;
                                      const remainder = slash1 >= 0 ? fullRel.slice(slash1 + 1) : '';
                                      if (!grouped.has(topKey)) grouped.set(topKey, { directFiles: [], subGroups: new Map() });
                                      const group = grouped.get(topKey)!;
                                      if (!remainder) {
                                        group.directFiles.push(file);
                                      } else {
                                        const slash2 = remainder.indexOf('/');
                                        const subKey = slash2 >= 0 ? remainder.slice(0, slash2) : remainder;
                                        const sub = group.subGroups.get(subKey) ?? [];
                                        sub.push(file);
                                        group.subGroups.set(subKey, sub);
                                      }
                                    }
                                    const sortedGroups = [...grouped.entries()].sort(([a], [b]) =>
                                      !a ? -1 : !b ? 1 : a.localeCompare(b)
                                    );
                                    return sortedGroups.map(([groupPath, groupData]) => {
                                      if (!groupPath) {
                                        // Files directly in section root — always visible, no toggle
                                        return (
                                          <div key="__root__" className="divide-y divide-slate-50">
                                            {groupData.directFiles.map(file => renderFileRow(file))}
                                          </div>
                                        );
                                      }
                                      const subKey = `${folder.id}::${groupPath}`;
                                      const isSubOpen = expandedSubfolders.has(subKey);
                                      const totalCount = groupData.directFiles.length + [...groupData.subGroups.values()].reduce((s, f) => s + f.length, 0);
                                      return (
                                        <div key={groupPath}>
                                          <button
                                            onClick={() => setExpandedSubfolders(prev => {
                                              const s = new Set([...prev].filter(k => !k.startsWith(`${folder.id}::`)));
                                              if (!prev.has(subKey)) s.add(subKey);
                                              return s;
                                            })}
                                            className={`w-full px-4 py-2 border-y flex items-center gap-2 transition-colors text-left ${isSubOpen ? 'bg-indigo-50 border-indigo-100 border-l-2 border-l-indigo-300' : 'bg-indigo-50/20 border-indigo-100 hover:bg-indigo-50'}`}
                                          >
                                            {isSubOpen ? <FolderOpen size={11} className="text-indigo-300 flex-shrink-0" /> : <Folder size={11} className="text-indigo-200 flex-shrink-0" />}
                                            <span className={`text-[11px] font-bold flex-1 ${isSubOpen ? 'text-indigo-500' : 'text-indigo-400'}`}>{groupPath}</span>
                                            <span className="text-[10px] text-slate-400 mr-1">{totalCount}</span>
                                            <ChevronDown size={11} className={`text-slate-400 flex-shrink-0 transition-transform ${isSubOpen ? 'rotate-180' : ''}`} />
                                          </button>
                                          {isSubOpen && (
                                            <div className="divide-y divide-slate-50">
                                              {groupData.directFiles.map(file => renderFileRow(file))}
                                              {[...groupData.subGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([subGroupName, subFiles]) => {
                                                const subSubKey = `${folder.id}::${groupPath}::${subGroupName}`;
                                                const isSubSubOpen = expandedSubfolders.has(subSubKey);
                                                return (
                                                  <div key={subGroupName} className="border-t border-slate-50">
                                                    <button
                                                      onClick={() => setExpandedSubfolders(prev => {
                                                        const s = new Set([...prev].filter(k => !k.startsWith(`${folder.id}::${groupPath}::`)));
                                                        if (!prev.has(subSubKey)) s.add(subSubKey);
                                                        return s;
                                                      })}
                                                      className={`w-full pl-10 pr-4 py-2 flex items-center gap-2 transition-colors text-left ${isSubSubOpen ? 'bg-indigo-50 border-indigo-100 border-l-2 border-l-indigo-300' : 'bg-indigo-50/20 border-indigo-100 hover:bg-indigo-50'}`}
                                                    >
                                                      {isSubSubOpen ? <FolderOpen size={11} className="text-indigo-300 flex-shrink-0" /> : <Folder size={11} className="text-indigo-200 flex-shrink-0" />}
                                                      <span className={`text-[11px] font-bold flex-1 ${isSubSubOpen ? 'text-indigo-500' : 'text-indigo-400'}`}>{subGroupName}</span>
                                                      <span className="text-[10px] text-slate-400 mr-1">{subFiles.length}</span>
                                                      <ChevronDown size={11} className={`text-slate-400 flex-shrink-0 transition-transform ${isSubSubOpen ? 'rotate-180' : ''}`} />
                                                    </button>
                                                    {isSubSubOpen && (
                                                      <div className="divide-y divide-slate-50 pl-4">
                                                        {subFiles.map(file => renderFileRow(file))}
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Any files sitting directly in the root (no subfolder) */}
                        {rootFiles.length > 0 && (
                          <div className="bg-indigo-50 rounded-lg border border-indigo-100 shadow-sm overflow-hidden">
                            <div className="px-4 py-3 border-b border-indigo-100">
                              <span className="text-[11px] font-black uppercase tracking-widest text-indigo-300">Other files</span>
                            </div>
                            <div className="divide-y divide-slate-50">
                              {rootFiles.map(file => renderFileRow({ ...file, folderPath: rootEntry?.path ?? '' }))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}

              {/* ── Industry Alignment tab ── */}
              {effectiveSiteTab === 'iag' && (
                <div className="space-y-4">
                <div className="bg-violet-50 border border-violet-100 rounded-lg px-6 py-4 flex gap-4 items-start">
                  <Shield size={18} className="text-violet-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-black text-violet-900">What is Industry Alignment?</p>
                    <p className="text-xs text-violet-700 mt-1 leading-relaxed">This page shows how your contracted H&amp;S services compare against the recommended and mandatory requirements for your site type. <span className="font-bold">Mandatory</span> items are legally or sector-required. <span className="font-bold">Recommended</span> items represent best practice. Gaps highlighted in red indicate mandatory services not currently contracted — speak to your advisor to address these.</p>
                  </div>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                  <div className="bg-violet-600 px-6 py-4 flex items-center justify-between">
                    <h3 className="font-black text-white uppercase tracking-widest text-sm flex items-center gap-2"><Shield size={14} />Industry Alignment — {SITE_TYPE_LABELS[selectedSite.type] || selectedSite.type}</h3>
                    <span className="text-violet-200 text-[11px] font-bold">Services contracted for this site</span>
                  </div>
                  {iagServicesLoading ? (
                    <div className="p-8 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div>
                  ) : iagServices.length === 0 ? (
                    <div className="p-8 text-center">
                      <Shield size={28} className="text-slate-300 mx-auto mb-3" />
                      <p className="font-black text-slate-700 text-sm">No industry requirements set for {SITE_TYPE_LABELS[selectedSite.type] || selectedSite.type}</p>
                      <p className="text-xs text-slate-400 mt-1">Generate requirements in the Industry Standards tab in admin.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {iagServices.map(svc => (
                        <div key={svc.id} className={`flex items-center gap-4 px-6 py-3.5 ${!svc.purchased && svc.is_mandatory ? 'bg-rose-50/50' : ''}`}>
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${svc.purchased ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                            {svc.purchased
                              ? <CheckCircle size={14} className="text-emerald-600" />
                              : <X size={12} className="text-slate-400" />
                            }
                          </div>
                          <div className="flex-1">
                            <p className={`text-sm font-bold ${svc.purchased ? 'text-slate-800' : 'text-slate-400'}`}>{svc.requirement_name}</p>
                            {svc.description && <p className="text-[11px] text-slate-400 mt-0.5">{svc.description}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {svc.is_mandatory
                              ? <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">Mandatory</span>
                              : <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200">Recommended</span>
                            }
                            {!svc.purchased && svc.is_mandatory && (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-600 text-white">Gap</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {iagServices.length > 0 && (
                    <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center gap-4 text-[11px] font-bold text-slate-500">
                      <span className="text-emerald-600">{iagServices.filter(s => s.purchased).length} contracted</span>
                      <span>·</span>
                      <span className="text-slate-400">{iagServices.filter(s => !s.purchased).length} not contracted</span>
                      {iagServices.some(s => s.is_mandatory && !s.purchased) && (
                        <span className="ml-auto text-rose-600 flex items-center gap-1"><AlertCircle size={12} />{iagServices.filter(s => s.is_mandatory && !s.purchased).length} mandatory gap{iagServices.filter(s => s.is_mandatory && !s.purchased).length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  )}
                </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      {showSyncConfig && selectedSite && (
        <SyncConfigModal site={selectedSite} onClose={() => setShowSyncConfig(false)} onSave={handleSaveSyncConfig} />
      )}
      {showClientUploadsPanel && selectedSite && user && (
        <ClientUploadsPanel
          siteId={selectedSite.id}
          siteName={selectedSite.name}
          siteFolderPath={selectedSite.datto_folder_path ?? null}
          userId={user.id}
          onClose={() => setShowClientUploadsPanel(false)}
          onCountChange={(n) => setPendingUploadsCount(n)}
        />
      )}
      {showAiReviewPanel && selectedSite && (
        <AiSuggestionsPanel
          siteId={selectedSite.id}
          siteName={selectedSite.name}
          onClose={() => setShowAiReviewPanel(false)}
          onCountChange={(n) => setAiSuggestionsCount(n)}
          onActionAccepted={(action) => {
            setAllActions(prev => prev.map(a =>
              a.id === action.id
                ? { ...a, status: action.status as ActionStatus, isSuggested: action.is_suggested ?? false, action: action.title ?? a.action, date: action.due_date ?? a.date, who: action.responsible_person ?? a.who, riskLevel: action.risk_level ?? a.riskLevel }
                : a
            ));
          }}
        />
      )}
      {showSettings && profile && (profile.role === 'advisor' || profile.role === 'superadmin') && (
        <DattoPathModal
          userId={user.id}
          currentPath={typeof window !== 'undefined' ? (localStorage.getItem('dattoBasePath') || '') : ''}
          onClose={() => setShowSettings(false)}
          onSave={(path) => {
            localStorage.setItem('dattoBasePath', path);
            setProfile(prev => prev ? { ...prev, datto_base_path: path } : prev);
            setShowSettings(false);
          }}
        />
      )}

      {/* Password recovery — triggered by email reset link */}
      {showPasswordReset && (
        <SetPasswordModal
          title="Set your new password"
          onSubmit={async (pw) => {
            const { error } = await supabase.auth.updateUser({ password: pw });
            if (error) throw error;
            setShowPasswordReset(false);
            showAppFlash('Password updated successfully');
            fetch('/api/auth/password-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id, origin: window.location.origin }) }).catch(() => {});
          }}
          onClose={() => setShowPasswordReset(false)}
        />
      )}

      {/* Change password — initiated by logged-in user */}
      {showChangePassword && (
        <SetPasswordModal
          title="Change your password"
          onSubmit={async (pw) => {
            const { error } = await supabase.auth.updateUser({ password: pw });
            if (error) throw error;
            setShowChangePassword(false);
            showAppFlash('Password updated successfully');
            fetch('/api/auth/password-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id, origin: window.location.origin }) }).catch(() => {});
          }}
          onClose={() => setShowChangePassword(false)}
        />
      )}

      {/* App-level flash notification */}
      {appFlash && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-lg shadow-xl animate-in slide-in-from-bottom-4 duration-300">
          {appFlash}
        </div>
      )}
    </div>
  );
}