"use client";
import React, { useState, useEffect } from 'react';
import {
  ChevronRight, Building2, ClipboardList,
  CheckCircle2, FileText, ArrowLeft, User, Layout,
  Clock, Factory, Wrench, RefreshCw, Database, ExternalLink,
  CheckCircle, Settings, Truck, PenTool, BarChart3, TrendingUp,
  ChevronDown, ChevronUp, Paperclip, MessageSquare, HardHat,
  Zap, Shield, ArrowUpRight, X, Plus, LogOut, Lock, Mail,
  Folder, FolderOpen, File, Pencil, GraduationCap, Heart,
  Warehouse, ShoppingBag, Home, Sparkles, AlertCircle,
  Upload, FileCheck, Trash2, Users, Search
} from 'lucide-react';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { supabase } from './lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────
type Priority = 'red' | 'amber' | 'green';
type ActionStatus = 'open' | 'resolved';
type AppView = 'portfolio' | 'site' | 'admin';
type AdminTab = 'organisations' | 'sites' | 'users' | 'requirements';

interface Action {
  id: string; action: string; description: string; date: string; site: string;
  who: string; contractor?: string; source: string; source_document_id?: string;
  priority: Priority; regulation: string; notes: string; evidenceLabel?: string; status: ActionStatus;
  hazardRef?: string | null; hazard?: string | null; existingControls?: string | null;
  riskRating?: string | null; riskLevel?: string | null; resolvedDate?: string | null; sourceFolderId?: string | null;
  isSuggested?: boolean; updatedAt?: string | null; sourceFolderPath?: string | null; issueDate?: string | null;
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
  employeeCount: number | null;
}

interface DocumentMeta {
  assessmentDate: string | null;
  reviewDate: string | null;
  assessor: string | null;
  clientConsulted: string | null;
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
  isError?: boolean;
  errorMessage?: string;
  advisorPriority: string | null;
}
interface Organisation { id: string; name: string; datto_folder_id: string | null; }
interface Profile { role: 'superadmin' | 'advisor' | 'client'; site_id: string | null; organisation_id: string | null; }
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
  amber: { label: 'Upcoming',  bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   bar: 'bg-amber-500',   dot: 'bg-amber-500',   badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  green: { label: 'Scheduled', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', bar: 'bg-emerald-500', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};

const overdueRiskConfig: Record<string, typeof priorityConfig.red> = {
  HIGH:   { label: 'Overdue', bg: 'bg-rose-100',   border: 'border-rose-500',   text: 'text-rose-800',   bar: 'bg-rose-700',   dot: 'bg-rose-700',   badge: 'bg-rose-200 text-rose-900 border-rose-400' },
  MEDIUM: { label: 'Overdue', bg: 'bg-orange-50',  border: 'border-orange-300', text: 'text-orange-700', bar: 'bg-orange-500', dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700 border-orange-200' },
  LOW:    { label: 'Overdue', bg: 'bg-yellow-50',  border: 'border-yellow-300', text: 'text-yellow-700', bar: 'bg-yellow-500', dot: 'bg-yellow-500', badge: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
};

const DERIVE_ONGOING_RE = /on.?going|continuous|continual|continued|continuing|rolling|recurring|recurrent|regular|permanent|indefinite|open.?ended|as.?required|as.?needed|periodic|routine|always|review/i;

function derivePriority(action: Action): { priority: Priority; label: string } {
  if (action.status === 'resolved') return { priority: 'green', label: 'Resolved' };
  const today = new Date().toLocaleDateString('en-CA');
  const date = action.date;
  const isOngoing = !!date && DERIVE_ONGOING_RE.test(date);
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

const computeActionProgress = (actions: Action[]): number => {
  if (actions.length === 0) return 100;
  const today = new Date().toLocaleDateString('en-CA');
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let resolvedPoints = 0, totalPoints = 0;
  for (const a of actions) {
    const isResolved = a.status === 'resolved';
    const date = a.date || null;
    const isOngoing = !!date && ONGOING_RE.test(date);
    const hasSpecificDate = !!date && !isOngoing && /^\d{4}-\d{2}-\d{2}$/.test(date);
    let w = 1;
    if (hasSpecificDate) {
      if (date < today) { w = 10; }
      else { const daysAway = Math.ceil((new Date(date).getTime() - Date.now()) / 86400000); w = daysAway <= 30 ? 5 : 1; }
    } else {
      const lastUpdated = a.updatedAt?.slice(0, 10) ?? null;
      w = (lastUpdated && lastUpdated < sixMonthsAgo) ? 5 : 1;
    }
    if (isResolved) resolvedPoints += w;
    totalPoints += w;
  }
  return totalPoints === 0 ? 100 : Math.round((resolvedPoints / totalPoints) * 100);
};

const scoreColor = (score: number) => {
  if (score >= 85) return { text: 'text-emerald-600', bar: 'bg-emerald-500', ring: '#10b981' };
  if (score >= 50) return { text: 'text-amber-500',   bar: 'bg-amber-400',   ring: '#f59e0b' };
  return               { text: 'text-rose-600',       bar: 'bg-rose-500',    ring: '#f43f5e' };
};

const ComplianceRing = ({ score, size = 56 }: { score: number; size?: number }) => {
  const r = 20; const circ = 2 * Math.PI * r; const offset = circ - (score / 100) * circ;
  const color = scoreColor(score).ring;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r={r} stroke="#f1f5f9" strokeWidth="5" fill="none" />
      <circle cx="24" cy="24" r={r} stroke={color} strokeWidth="5" fill="none" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 24 24)" style={{ transition: 'stroke-dashoffset 1s ease' }} />
      <text x="24" y="28" textAnchor="middle" fontSize="10" fontWeight="900" fill={color}>{score}</text>
    </svg>
  );
};

// ─── Score Explanation Modal ───────────────────────────────────────────────────
const ScoreExplanationModal = ({ card, onClose }: { card: 'implementation' | 'iag' | 'documentation'; onClose: () => void }) => {
  const content = {
    implementation: {
      title: 'Actions Score',
      color: 'bg-indigo-600',
      body: (
        <>
          <p className="text-sm text-slate-600 leading-relaxed">This measures progress on actions raised during your assessments. Not all actions carry equal weight — an <strong>overdue</strong> action counts for 10 points, <strong>upcoming or review due</strong> for 5, and <strong>scheduled or under review</strong> for 1.</p>
          <p className="text-sm text-slate-600 leading-relaxed mt-3">Actions that are past their due date carry more weight in the calculation. Completing your most important actions has a much larger impact on your score than clearing minor items.</p>
          <div className="mt-4 space-y-2">
            {[{ label: '85% – 100%', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', desc: 'Strong progress — minor items remain.' }, { label: '50% – 84%', color: 'bg-amber-100 text-amber-700 border-amber-200', desc: 'Action required — significant open items.' }, { label: '0% – 49%', color: 'bg-rose-100 text-rose-700 border-rose-200', desc: 'High risk — critical actions outstanding.' }].map(t => (
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
          <p className="text-sm text-slate-600 leading-relaxed mt-3">If any mandatory service is not covered, the card shows Red regardless of the overall percentage — because these carry legal risk.</p>
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
      title: 'Documentation Health',
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
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className={`${content.color} px-6 py-4 flex items-center justify-between`}>
          <h2 className="font-black text-white text-sm uppercase tracking-widest">{content.title}</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-6">{content.body}</div>
        <div className="px-6 pb-6"><button onClick={onClose} className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[11px] uppercase tracking-widest rounded-xl transition-colors">Got it</button></div>
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
  // Encode each segment but preserve slashes between them
  const encoded = parts.map(p => p.replace(/ /g, '%20').replace(/&/g, '%26').replace(/#/g, '%23')).join('/');
  return `${scheme}:ofe|u|file:///${encoded}`;
}
const toUKDate = (iso: string) => { if (!isIsoDate(iso)) return iso; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };

function getFileHref(file: DattoItem, folderPath: string, role: string): string {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const officeExts = ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'];
  if (role === 'advisor' && officeExts.includes(ext)) {
    const basePath = typeof window !== 'undefined' ? (localStorage.getItem('dattoBasePath') || 'W:/Customer Documents') : 'W:/Customer Documents';
    const uri = buildOfficeUri(basePath, folderPath, file.name);
    if (uri) return uri;
  }
  return `/api/datto/file?fileId=${file.id}&fileName=${encodeURIComponent(file.name)}&forceDownload=true`;
}

function fileTypeBadge(name: string): { label: string; cls: string } {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return { label: 'PDF', cls: 'bg-rose-100 text-rose-700' };
  if (ext === 'docx' || ext === 'doc') return { label: 'DOC', cls: 'bg-blue-100 text-blue-700' };
  if (ext === 'xlsx' || ext === 'xls') return { label: 'XLS', cls: 'bg-emerald-100 text-emerald-700' };
  if (ext === 'pptx' || ext === 'ppt') return { label: 'PPT', cls: 'bg-orange-100 text-orange-700' };
  return { label: ext.toUpperCase() || 'FILE', cls: 'bg-slate-100 text-slate-500' };
}

// ─── Action Card ──────────────────────────────────────────────────────────────
const ActionCard = ({ action, isResolved, onToggleResolve, onAddNote, onDelete, onUpdateIssueDate, role, expanded, onExpand }: {
  action: Action; isResolved: boolean; onToggleResolve: (id: string) => void; onAddNote: (id: string, note: string) => void; onDelete?: (id: string) => void; onUpdateIssueDate?: (id: string, date: string | null) => void; role: string; expanded: boolean; onExpand: () => void;
}) => {
  const [noteText, setNoteText] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [editingIssueDate, setEditingIssueDate] = useState(false);
  const [issueDateInput, setIssueDateInput] = useState(action.issueDate || '');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const today = new Date().toLocaleDateString('en-CA');
  const ONGOING_RE = /on.?going|continuous|continual|continued|continuing|rolling|recurring|recurrent|regular|permanent|indefinite|open.?ended|as.?required|as.?needed|periodic|routine|always|review/i;
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
      if (res.ok) setSyncResult({ ok: true, msg: 'Document updated in Datto.' });
      else setSyncResult({ ok: false, msg: `${data.error || 'Sync failed.'}${data.detail ? ` — ${data.detail}` : ''}${data.status ? ` (HTTP ${data.status})` : ''}` });
    } catch {
      setSyncResult({ ok: false, msg: 'Network error.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncToDoc = async () => {
    if (!window.confirm('This will overwrite the original document in Datto with the current portal values. Continue?')) return;
    doSync();
  };

  const handleResolve = () => {
    const resolving = !isResolved;
    onToggleResolve(action.id);
    if (resolving && canSync) {
      const today = new Date().toLocaleDateString('en-CA');
      doSync(today);
    }
  };
  return (
    <div className={`rounded-2xl border transition-all duration-300 overflow-hidden ${isResolved ? 'bg-slate-50/60 border-slate-100 opacity-60' : `${cfg.bg} ${cfg.border}`}`}>
      <div className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-3 cursor-pointer" onClick={onExpand}>
        <div className={`w-1.5 rounded-full self-stretch hidden md:block flex-shrink-0 ${isResolved ? 'bg-slate-300' : cfg.bar}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className={`font-bold text-[12px] leading-snug ${isResolved ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{(action.source || action.action).replace(/\.[^.]+$/, '')}</span>
              {action.hazardRef && <><span className="text-slate-300 text-[11px]">|</span><span className="text-[12px] font-bold text-violet-500 flex-shrink-0">Hazard No. {action.hazardRef}</span></>}
              {action.issueDate && <><span className="text-slate-300 text-[11px]">|</span><span className="text-[12px] font-medium text-slate-500 flex-shrink-0"><span className="text-slate-400 font-normal">Issued: </span>{toUKDate(action.issueDate)}</span></>}
              {action.date && (
                <>
                  <span className="text-slate-300 text-[11px]">|</span>
                  <span className="text-[12px] font-medium text-slate-500 flex-shrink-0"><span className="text-slate-400 font-normal">Due: </span>{toUKDate(action.date)}</span>
                </>
              )}
              {(action as any).isSuggested &&<span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border border-violet-200 text-violet-600 bg-violet-50 flex-shrink-0">AI Suggested</span>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isResolved ? (
                <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border bg-white border-slate-200 text-slate-400">Resolved</span>
              ) : isOngoing ? (
                <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-700">Ongoing</span>
              ) : (
                <>
                  {(() => {
                    const dueLightCls = derivedPriority === 'red' ? 'bg-rose-200 text-rose-700 border-rose-300'
                      : derivedPriority === 'amber' ? 'bg-amber-50 text-amber-500 border-amber-100'
                      : 'bg-emerald-50 text-emerald-500 border-emerald-100';
                    return <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border ${dueLightCls}`}>{derivedLabel}</span>;
                  })()}
                  {action.riskLevel && (() => {
                    const riskDarkCls = action.riskLevel === 'HIGH' ? 'bg-rose-600 text-white border-rose-700'
                      : action.riskLevel === 'MEDIUM' ? 'bg-orange-200 text-orange-800 border-orange-300'
                      : 'bg-emerald-200 text-emerald-800 border-emerald-300';
                    return <span className={`text-[10px] font-black uppercase py-1 rounded-lg border w-24 text-center inline-block ${riskDarkCls}`}>{action.riskLevel} Risk</span>;
                  })()}
                </>
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
        <div className="border-t border-white/60 bg-white/60 backdrop-blur-sm px-6 py-5 space-y-5">
          {/* Top row: issue date + due date + responsible person left, view doc link right */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 flex-wrap text-[12px] font-medium text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="text-slate-500 font-normal text-[11px] uppercase tracking-wider">Issued:</span>
                {editingIssueDate ? (
                  <input
                    type="date"
                    value={issueDateInput}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                    onChange={e => setIssueDateInput(e.target.value)}
                    onBlur={() => { setEditingIssueDate(false); onUpdateIssueDate?.(action.id, issueDateInput || null); }}
                    onKeyDown={e => { if (e.key === 'Enter') { setEditingIssueDate(false); onUpdateIssueDate?.(action.id, issueDateInput || null); } if (e.key === 'Escape') { setIssueDateInput(action.issueDate || ''); setEditingIssueDate(false); } }}
                    className="text-sm font-bold text-slate-700 border-b border-indigo-400 outline-none bg-transparent"
                  />
                ) : (
                  <span
                    onClick={e => { e.stopPropagation(); setIssueDateInput(action.issueDate || ''); setEditingIssueDate(true); }}
                    className="cursor-pointer hover:text-indigo-600 hover:underline decoration-dotted"
                    title="Click to edit issue date"
                  >
                    {action.issueDate ? toUKDate(action.issueDate) : <span className="text-slate-300 font-normal italic text-xs">not set</span>}
                  </span>
                )}
              </span>
              {action.date && <><span className="text-slate-300">|</span><span><span className="text-slate-500 font-normal">Due Date: </span>{toUKDate(action.date)}</span></>}
              {action.who && <><span className="text-slate-300">|</span><span><span className="text-slate-500 font-normal">Responsible: </span>{action.who}</span></>}
            </div>
            {action.source && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {action.sourceFolderPath ? (() => {
                  const basePath = typeof window !== 'undefined' ? (localStorage.getItem('dattoBasePath') || 'W:/Customer Documents') : 'W:/Customer Documents';
                  const uri = buildOfficeUri(basePath, action.sourceFolderPath, action.source);
                  return uri ? (
                    <a href={uri} className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex-shrink-0" title="Open original file">
                      <ExternalLink size={12} className="text-indigo-500 flex-shrink-0" /><span className="font-normal text-slate-400">Open Doc:</span>{action.source.replace(/\.[^.]+$/, '')}
                    </a>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 flex-shrink-0"><File size={12} className="text-slate-400 flex-shrink-0" /><span className="font-normal text-slate-400">Doc:</span>{action.source.replace(/\.[^.]+$/, '')}</span>
                  );
                })() : (
                  <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 flex-shrink-0"><File size={12} className="text-slate-400 flex-shrink-0" /><span className="font-normal text-slate-400">Doc:</span>{action.source.replace(/\.[^.]+$/, '')}</span>
                )}
                {role === 'advisor' && onDelete && (
                  <button onClick={e => { e.stopPropagation(); if (confirm('Delete this action? This cannot be undone.')) onDelete(action.id); }} className="p-1.5 rounded-lg border border-rose-200 text-rose-400 hover:text-rose-600 hover:border-rose-400 hover:bg-rose-50 transition-colors" title="Delete action">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
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
          {action.action && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-rose-600 mb-0.5">Action Required</p>
              <p className="text-[12px] text-slate-700">{action.action}</p>
            </div>
          )}
          <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Requirement Detail</p><p className="text-sm text-slate-700 leading-relaxed">{action.description}</p></div>
          {/* AI Suggestion mini-card */}
          {action.riskRating && (
            <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-violet-500 flex items-center gap-1.5">
                  <Sparkles size={10} />AI Suggestion
                </span>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${
                  action.riskLevel === 'HIGH' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                  action.riskLevel === 'MEDIUM' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                  action.riskLevel === 'LOW' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                  'bg-slate-100 text-slate-600 border-slate-200'
                }`}>Risk: {action.riskRating}</span>
              </div>
              {action.regulation && <p className="text-[11px] text-slate-600"><span className="font-black">Regulation:</span> {action.regulation}</p>}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 flex items-center gap-1.5"><MessageSquare size={11} />Advisor Notes</p>
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 min-h-[48px]">{action.notes || <span className="text-slate-300 italic">No notes added.</span>}</div>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 flex items-center gap-1.5"><Paperclip size={11} />Evidence</p>
              <div className="bg-white rounded-xl border border-dashed border-slate-200 px-4 py-3 flex items-center justify-center gap-2 cursor-pointer hover:border-indigo-300 group">
                <Plus size={14} className="text-slate-300 group-hover:text-indigo-400" /><span className="text-xs font-bold text-slate-300 group-hover:text-indigo-400">Upload Evidence</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100">
                <button
                  onClick={handleResolve}
                  className={`w-full px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider active:scale-95 shadow-sm flex items-center justify-center gap-2 ${isResolved ? 'bg-white border border-slate-200 text-slate-400 hover:border-rose-200 hover:text-rose-400' : 'bg-slate-900 text-white hover:bg-indigo-700'}`}
                >
                  {isResolved ? <><X size={13} />Undo Resolve</> : <><CheckCircle size={13} />Mark as Resolved</>}
                </button>
                {!isResolved && <p className="text-[11px] text-slate-400 italic mt-1.5 text-center">Add a note or upload evidence to demonstrate how this was resolved.</p>}
              </div>
            </div>
          </div>
          {showNoteInput ? (
            <div className="flex gap-2 items-start">
              <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a progress note…" rows={2} className="flex-1 text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none bg-white" />
              <div className="flex flex-col gap-2">
                <button onClick={() => { onAddNote(action.id, noteText); setNoteText(''); setShowNoteInput(false); }} className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700">Save</button>
                <button onClick={() => setShowNoteInput(false)} className="px-4 py-2.5 bg-white border border-slate-200 text-slate-400 rounded-xl text-xs font-black">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowNoteInput(true)} className="text-[11px] font-black uppercase tracking-wider text-indigo-500 hover:text-indigo-700 flex items-center gap-1.5"><Plus size={13} />Add Note</button>
          )}
          {/* Sync to Doc */}
          {canSync && (
            <div className="flex items-center gap-3 pt-1 border-t border-slate-100">
              <button
                onClick={handleSyncToDoc}
                disabled={syncing}
                className="text-[11px] font-black uppercase tracking-wider text-emerald-600 hover:text-emerald-800 flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing…' : 'Sync to Doc'}
              </button>
              {syncResult && (
                <span className={`text-[11px] font-bold ${syncResult.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {syncResult.msg}
                </span>
              )}
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
  const files = items.filter(i => i.type === 'file');

  return (
    <div className="border border-indigo-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="bg-indigo-600 px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] font-black text-white uppercase tracking-widest flex items-center gap-2"><FolderOpen size={13} />Browse Documents</span>
        <button onClick={onClose} className="text-indigo-200 hover:text-white"><X size={15} /></button>
      </div>
      <div className="bg-slate-50 border-b border-slate-100 px-4 py-2 flex items-center gap-1 flex-wrap min-h-[36px]">
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={`${crumb.id}-${i}`}>
            {i > 0 && <ChevronRight size={10} className="text-slate-300" />}
            <button onClick={() => setBreadcrumbs(prev => prev.slice(0, i + 1))} className={`text-[10px] font-black truncate max-w-[120px] ${i === breadcrumbs.length - 1 ? 'text-indigo-700 cursor-default' : 'text-indigo-500 hover:underline'}`}>{crumb.name}</button>
          </React.Fragment>
        ))}
      </div>
      <div className="max-h-56 overflow-y-auto">
        {loading && <div className="p-6 text-center text-[11px] font-black text-slate-400 animate-pulse">Loading…</div>}
        {!loading && apiError && <div className="p-4"><div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-bold text-rose-700">⚠ {apiError}</div></div>}
        {!loading && !apiError && items.length === 0 && <div className="p-6 text-center text-xs font-bold text-slate-400">Empty folder.</div>}
        {!loading && !apiError && (<>
          {folders.map(item => (
            <button key={item.id} onClick={() => setBreadcrumbs(prev => [...prev, { id: item.id, name: item.name }])} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50 group border-b border-slate-50 text-left">
              <Folder size={14} className="text-amber-400 flex-shrink-0" /><span className="text-xs font-bold text-slate-700 group-hover:text-amber-700 flex-1 truncate">{item.name}</span><ChevronRight size={12} className="text-slate-300" />
            </button>
          ))}
          {files.map(item => (
            <button key={item.id} onClick={() => onSelect(item.name, item.id)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-indigo-50 group border-b border-slate-50 text-left">
              <File size={14} className="text-indigo-400 flex-shrink-0" /><span className="text-xs font-bold text-slate-700 group-hover:text-indigo-700 flex-1 truncate">{item.name}</span>
              <span className="text-[10px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded group-hover:bg-indigo-100">Select</span>
            </button>
          ))}
        </>)}
      </div>
      <div className="bg-slate-50 border-t border-slate-100 px-4 py-2 flex items-center justify-between">
        <span className="text-[10px] text-slate-400">{!loading && !apiError && `${folders.length} folders, ${files.length} files`}</span>
        <button onClick={onClose} className="text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase">Cancel</button>
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
        <button onClick={onClose} className="text-indigo-200 hover:text-white"><X size={15} /></button>
      </div>
      <div className="bg-slate-50 border-b border-slate-100 px-4 py-2 flex items-center gap-1 flex-wrap">
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={`${crumb.id}-${i}`}>
            {i > 0 && <ChevronRight size={10} className="text-slate-300" />}
            <button onClick={() => setBreadcrumbs(prev => prev.slice(0, i + 1))} className={`text-[10px] font-black truncate max-w-[120px] ${i === breadcrumbs.length - 1 ? 'text-indigo-700 cursor-default' : 'text-indigo-500 hover:underline'}`}>{crumb.name}</button>
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
            }} className="text-xs font-bold text-slate-700 group-hover:text-amber-700 flex-1 truncate text-left">{item.name}</button>
            <button onClick={() => navigateTo(item.name, item.id)} className="text-slate-300 hover:text-indigo-500 flex-shrink-0 p-1" title="Open subfolder"><ChevronRight size={12} /></button>
          </div>
        ))}
      </div>
      <div className="bg-slate-50 border-t border-slate-100 px-4 py-2 flex justify-end">
        <button onClick={onClose} className="text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase">Cancel</button>
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
  const n = raw.toLowerCase();
  if (n.includes('high') || n === 'h') return 'high';
  if (n.includes('med')  || n === 'm') return 'medium';
  if (n.includes('low')  || n === 'l') return 'low';
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
    <div className="bg-white rounded-2xl border border-indigo-200 shadow-lg overflow-hidden">
      <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between">
        <h3 className="font-black text-white uppercase tracking-widest text-sm">Add New Action</h3>
        <button onClick={onCancel} className="text-indigo-200 hover:text-white"><X size={18} /></button>
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
              {sourceDocName ? <><span className="flex items-center gap-2 text-indigo-700 font-bold truncate"><File size={14} className="text-indigo-400 flex-shrink-0" />{sourceDocName}</span><button onClick={handleClearDoc} className="text-slate-300 hover:text-rose-400"><X size={14} /></button></> : <><span className="text-slate-400">{site.datto_folder_id ? 'Click to browse documents…' : 'No Datto folder linked'}</span><FolderOpen size={16} className="text-slate-300" /></>}
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
                <button key={r.val} type="button" onClick={() => { setRiskRating(r.val); setRiskRatingOverridden(true); }} className={`flex-1 py-2.5 rounded-xl text-[11px] font-black border transition-all ${riskRating === r.val ? r.active : 'bg-white text-slate-500 border-slate-200'}`}>{r.label}</button>
              ))}
              {riskRating && <button type="button" onClick={() => { setRiskRating(null); setRiskRatingOverridden(false); }} className="px-2 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-300 hover:text-rose-400" title="Clear risk rating"><X size={12} /></button>}
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
          <button onClick={handleSave} disabled={saving} className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-black text-sm uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save Action'}</button>
          <button onClick={onCancel} className="px-6 py-3 bg-white border border-slate-200 text-slate-500 rounded-xl font-black text-sm uppercase tracking-wider hover:bg-slate-50">Cancel</button>
        </div>
      </div>
    </div>
  );
};

// ─── Document Card ────────────────────────────────────────────────────────────
const DocumentCard = ({ doc, role, userId, actions, onDelete, onRename, onToggleAction }: {
  doc: SiteDocument; role: string; userId: string | null; actions: Action[];
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onToggleAction: (id: string, resolved: boolean) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(doc.document_name || doc.file_name || '');
  const today = new Date().toLocaleDateString('en-CA');
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const expStatus = doc.expiry_date ? (doc.expiry_date < today ? 'expired' : doc.expiry_date <= soon ? 'expiring' : 'valid') : 'none';
  const openActions = actions.filter(a => a.status !== 'resolved');
  const resolvedActions = actions.filter(a => a.status === 'resolved');
  return (
    <div className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
      <div className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">Client Managed</span>
              {doc.document_type && <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-lg">{doc.document_type}</span>}
            </div>
            {editingName ? (
              <div className="flex items-center gap-2 mt-1">
                <input className="text-sm font-black text-slate-900 border border-indigo-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300 w-full" value={nameInput} onChange={e => setNameInput(e.target.value)} autoFocus />
                <button onClick={() => { onRename(doc.id, nameInput); setEditingName(false); }} className="text-[10px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-100 whitespace-nowrap">Save</button>
                <button onClick={() => setEditingName(false)} className="text-[10px] font-black text-slate-400 hover:text-slate-600 whitespace-nowrap">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <h4 className="font-black text-slate-900 leading-snug">{doc.document_name || doc.file_name}</h4>
                {role === 'client' && <button onClick={() => setEditingName(true)} className="p-1 text-slate-300 hover:text-indigo-500 rounded flex-shrink-0" title="Rename"><Pencil size={11} /></button>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {doc.datto_file_id && (
              <a href={`/viewer?fileId=${doc.datto_file_id}&fileName=${encodeURIComponent(doc.file_name ?? '')}&role=${role}`} target="_blank" rel="noopener noreferrer" className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg" title="View document"><ExternalLink size={14} /></a>
            )}
            {(role === 'advisor' || role === 'superadmin') && !doc.client_provided && (
              <button onClick={() => onDelete(doc.id)} className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg" title="Delete"><Trash2 size={14} /></button>
            )}
            {role === 'client' && (
              <button onClick={() => { if (window.confirm('Delete this document? This cannot be undone.')) onDelete(doc.id); }} className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg" title="Delete document"><Trash2 size={14} /></button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {doc.issue_date && <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Issued</p><p className="text-sm font-bold text-slate-700">{fmt(doc.issue_date)}</p></div>}
          {doc.expiry_date && <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Expires</p><p className="text-sm font-bold text-slate-700">{fmt(doc.expiry_date)}</p></div>}
          {expStatus === 'expired' && <span className="text-[10px] font-black uppercase px-2 py-1 rounded-lg text-rose-700 bg-rose-50 border border-rose-200">Expired</span>}
          {expStatus === 'expiring' && <span className="text-[10px] font-black uppercase px-2 py-1 rounded-lg text-amber-700 bg-amber-50 border border-amber-200">Expiring soon</span>}
          {expStatus === 'valid' && <span className="text-[10px] font-black uppercase px-2 py-1 rounded-lg text-emerald-700 bg-emerald-50 border border-emerald-200">Valid</span>}
        </div>
        {doc.people_mentioned && doc.people_mentioned.length > 0 && (
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><Users size={11} className="text-slate-400 flex-shrink-0" />{doc.people_mentioned.join(', ')}</p>
        )}
        {doc.notes && <p className="text-[11px] text-slate-400 italic">{doc.notes}</p>}
        <p className="text-[10px] text-slate-300">{doc.file_name} · Uploaded {new Date(doc.uploaded_at).toLocaleDateString('en-GB')}</p>
      </div>

      {actions.length > 0 && (
        <div className="border-t border-amber-100">
          <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Actions {openActions.length > 0 && <span className="ml-1 text-indigo-500">{openActions.length} open</span>}{resolvedActions.length > 0 && <span className="ml-1 text-slate-300">· {resolvedActions.length} resolved</span>}
            </p>
            <ChevronDown size={14} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          {expanded && <div className="divide-y divide-slate-100">
            {actions.map(a => {
              const cfg = priorityConfig[a.priority as Priority] ?? priorityConfig.green;
              const isResolved = a.status === 'resolved';
              return (
                <div key={a.id} className={`flex items-start gap-3 px-5 py-3 ${isResolved ? 'opacity-50' : ''}`}>
                  <div className={`w-1 rounded-full self-stretch flex-shrink-0 mt-0.5 ${isResolved ? 'bg-slate-300' : cfg.bar}`} style={{ minHeight: 32 }} />
                  <div className="flex-1 min-w-0 space-y-1">
                    {a.hazard && <p className={`text-[10px] font-black uppercase tracking-wide ${isResolved ? 'text-slate-400' : 'text-slate-500'}`}>{a.hazard}</p>}
                    <p className={`text-[11px] font-bold leading-snug ${isResolved ? 'line-through text-slate-400' : 'text-slate-800'}`}>{a.action}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {!isResolved && <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${cfg.badge}`}>{cfg.label}</span>}
                      {(a as any).isSuggested && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded border border-violet-200 text-violet-600 bg-violet-50">AI Suggested</span>}
                      {a.date && <span className="text-[9px] font-bold text-slate-500 flex items-center gap-1"><Clock size={9} />{a.date}</span>}
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
          </div>}
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

const UploadModal = ({ site, userId, onClose, onSaved }: {
  site: Site; userId: string | null;
  onClose: () => void; onSaved: (doc: SiteDocument, newCompliance: number | null, replacedId?: string) => void;
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
        noFolder: uploadData.noFolder ?? false,
        duplicateId: uploadData.duplicateId ?? undefined,
        duplicateDattoFileId: uploadData.duplicateDattoFileId ?? undefined,
      });

      // AI extract
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

  const handleSave = async () => {
    setSaving(true);
    const priorityMap: Record<string, string> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'green' };
    let lastDoc: SiteDocument | null = null;
    let lastCompliance: number | null = null;

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
      const dattoData = dattoRes.ok ? await dattoRes.json() : {};
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
      if (doc) { lastDoc = doc; onSaved(doc, null, item.duplicateId); }
    }
    const { data: siteData } = await supabase.from('sites').select('compliance_score').eq('id', site.id).single();
    lastCompliance = siteData?.compliance_score ?? null;
    if (lastDoc) onSaved(lastDoc, lastCompliance);
    setSaving(false);
    onClose();
  };

  const doneCount = items.filter(it => it.status === 'done').length;
  const errorCount = items.filter(it => it.status === 'error').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden">
        <div className="bg-amber-500 px-6 py-4 flex items-center justify-between">
          <h2 className="font-black text-white text-sm uppercase tracking-widest flex items-center gap-2">
            <Upload size={14} />Upload Documents
          </h2>
          <button onClick={onClose} className="text-amber-200 hover:text-white"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {step === 'select' && (
            <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-slate-200 rounded-2xl py-14 cursor-pointer hover:border-amber-300 hover:bg-amber-50 transition-colors">
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
                <div key={idx} className={`border rounded-2xl overflow-hidden ${it.status === 'error' ? 'border-rose-200 opacity-50' : 'border-slate-200'}`}>
                  <button
                    onClick={() => setExpandedIdx(prev => prev === idx ? null : idx)}
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
                      {it.noFolder && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">Portal only</span>}
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
            <span className="text-[11px] font-bold text-slate-400 flex-1">{doneCount} document{doneCount !== 1 ? 's' : ''} ready</span>
            <button onClick={onClose} className="px-5 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl font-black text-[11px] uppercase tracking-wider hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave} disabled={saving || doneCount === 0} className="px-6 py-2.5 bg-amber-500 text-white rounded-xl font-black text-[11px] uppercase tracking-wider hover:bg-amber-600 disabled:opacity-50">{saving ? 'Saving…' : `Save ${doneCount > 1 ? `All ${doneCount}` : 'Document'}`}</button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Site Documents Tab ────────────────────────────────────────────────────────
const SiteDocumentsTab = ({ site, profile, userId, onComplianceUpdate, onActionsAdded, onDocumentDeleted }: {
  site: Site; profile: Profile; userId: string | null; onComplianceUpdate: (score: number) => void; onActionsAdded?: (actions: Action[]) => void; onDocumentDeleted?: (docId: string) => void;
}) => {
  const [documents, setDocuments] = useState<SiteDocument[]>([]);
  const [docActions, setDocActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

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

  const handleSaved = async (doc: SiteDocument, newCompliance: number | null, replacedId?: string) => {
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

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 space-y-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-1.5">Client Managed Documents</p>
        <p className="text-xs text-amber-800">Upload your compliance documents here — certificates, inspection reports, training records, insurance, and any other evidence relevant to your site. Uploaded documents are stored securely and our AI will automatically identify key dates and any actions required.</p>
        <p className="text-xs text-amber-800 mt-1">These documents are supplied and monitored by the client and remain their sole responsibility to keep current and accurate.</p>
        <p className="text-xs text-amber-800">Due to varying document formats, actions identified below are generated automatically and <span className="font-black">may not be fully accurate</span> — always read the original document to verify.</p>
        <p className="text-xs text-amber-800">Any concerns should be discussed with your advisor. Issues identified may require a review of your contract and could result in an increase in contract price.</p>
      </div>
      <div className="flex justify-end">
        <button onClick={() => setShowUpload(true)} className="flex items-center gap-2 bg-amber-500 text-white px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-amber-600 shadow-sm"><Upload size={13} />Upload Document</button>
      </div>
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm font-bold animate-pulse">Loading documents…</div>
      ) : documents.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center"><FileCheck size={32} className="text-slate-300 mx-auto mb-3" /><p className="font-black text-slate-700">No documents uploaded yet</p><p className="text-sm text-slate-400 mt-1">Upload certificates, training records, and compliance evidence.</p></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">{documents.map(doc => <DocumentCard key={doc.id} doc={doc} role={profile.role} userId={userId} actions={docActions.filter(a => (a as any)._siteDocumentId === doc.id)} onDelete={handleDelete} onRename={handleRename} onToggleAction={handleToggleAction} />)}</div>
      )}
      {showUpload && <UploadModal site={site} userId={userId} onClose={() => setShowUpload(false)} onSaved={handleSaved} />}
    </div>
  );
};

// ─── Document Health Tab ──────────────────────────────────────────────────────
const DocHealthTab = ({ siteId, onComplianceUpdate }: { siteId: string; onComplianceUpdate?: (score: number) => void }) => {
  const [rows, setRows] = useState<{ docName: string; issueDate: string | null; actionCount: number; reviewDue: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDoc, setEditingDoc] = useState<string | null>(null);
  const [reviewInput, setReviewInput] = useState('');
  const [showHelper, setShowHelper] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from('actions').select('source_document_name, issue_date').eq('site_id', siteId).not('source_document_name', 'is', null),
      supabase.from('document_health').select('document_name, review_due').eq('site_id', siteId),
    ]).then(([actRes, healthRes]) => {
      const actions = actRes.data ?? [];
      const health = healthRes.data ?? [];
      // Group actions by source document name
      const map = new Map<string, { issueDate: string | null; count: number }>();
      for (const a of actions) {
        const name: string = a.source_document_name;
        const existing = map.get(name);
        const d = a.issue_date as string | null;
        if (!existing) {
          map.set(name, { issueDate: d, count: 1 });
        } else {
          map.set(name, {
            count: existing.count + 1,
            issueDate: d && (!existing.issueDate || d > existing.issueDate) ? d : existing.issueDate,
          });
        }
      }
      const reviewMap = new Map(health.map((h: any) => [h.document_name, h.review_due as string | null]));
      const built = Array.from(map.entries()).map(([docName, v]) => ({
        docName,
        issueDate: v.issueDate,
        actionCount: v.count,
        reviewDue: reviewMap.get(docName) ?? null,
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

  if (loading) return <div className="py-8 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div>;

  return (
    <div className="space-y-3">
      {/* Helper text */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <button onClick={() => setShowHelper(h => !h)} className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors">
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
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-amber-500 px-6 py-4 flex items-center justify-between">
          <h3 className="font-black text-white uppercase tracking-widest text-sm flex items-center gap-2"><FileCheck size={14} />Document Health — {rows.length} assessed document{rows.length !== 1 ? 's' : ''}</h3>
          <div className="flex items-center gap-3 text-[11px] font-bold">
            {counts.red > 0 && <span className="text-white">{counts.red} overdue</span>}
            {counts.amber > 0 && <span className="text-amber-100">{counts.amber} review due</span>}
            {counts.grey > 0 && <span className="text-amber-200">{counts.grey} unknown</span>}
            {counts.green > 0 && <span className="text-amber-200">{counts.green} current</span>}
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="p-12 text-center"><FileText size={28} className="text-slate-300 mx-auto mb-3" /><p className="font-black text-slate-700 text-sm">No AI-synced documents found for this site</p><p className="text-sm text-slate-400 mt-1">Run an AI sync to populate document health data.</p></div>
        ) : (
          <table className="w-full text-left">
            <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-5 py-3">Document</th><th className="px-5 py-3">Last Assessed</th><th className="px-5 py-3">Review Due</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(row => {
                const s = docStatus(row.issueDate, row.reviewDue, today);
                return (
                  <tr key={row.docName} className={s === 'red' ? 'bg-rose-50/40' : s === 'amber' ? 'bg-amber-50/30' : ''}>
                    <td className="px-5 py-3.5 font-bold text-slate-800 text-sm max-w-xs truncate">{row.docName.replace(/\.[^.]+$/, '')}</td>
                    <td className="px-5 py-3.5 text-[13px] text-slate-600">
                      {row.issueDate
                        ? <span>{fmt(row.issueDate)} <span className="text-slate-400 text-[11px]">({ageLabel(row.issueDate)})</span></span>
                        : <span className="text-slate-300 text-[11px]">Not known</span>}
                    </td>
                    <td className="px-5 py-3.5">
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
                    <td className="px-5 py-3.5">{statusBadge(s, row.reviewDue)}</td>
                    <td className="px-5 py-3.5 text-right text-[11px] font-bold text-slate-400">{row.actionCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ─── Superadmin Panel ─────────────────────────────────────────────────────────
const SuperadminPanel = () => {
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
  const [showSiteFolderPicker, setShowSiteFolderPicker] = useState(false);
  const [sitePickerCurrentId, setSitePickerCurrentId] = useState('');
  const [sitePickerCurrentName, setSitePickerCurrentName] = useState('');

  // Create form — user
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userRole, setUserRole] = useState<'advisor' | 'client'>('advisor');
  const [userOrgId, setUserOrgId] = useState('');
  const [userSiteIds, setUserSiteIds] = useState<string[]>([]);

  // Assignment search state
  const [orgAdvisorSearch, setOrgAdvisorSearch] = useState('');
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

  // Assignment data
  const [clientSiteAssignments, setClientSiteAssignments] = useState<any[]>([]);
  const [advisorSiteAssignments, setAdvisorSiteAssignments] = useState<any[]>([]);

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

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { if (activeTab === 'requirements') loadRequirements(reqSiteType); }, [activeTab, reqSiteType]);

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([loadOrgs(), loadSites(), loadUsers(), loadAssignments(), loadClientSiteAssignments(), loadAdvisorSiteAssignments()]);
    setLoading(false);
  };

  const loadOrgs = async () => { const { data } = await supabase.from('organisations').select('*').order('name'); if (data) setOrganisations(data); };
  const loadSites = async () => { const { data } = await supabase.from('sites').select('*, organisations(name)').order('name'); if (data) setSites(data); };
  const loadClientSiteAssignments = async () => { const { data } = await supabase.from('client_site_assignments').select('*, sites(name)').order('created_at'); if (data) setClientSiteAssignments(data); };
  const loadAdvisorSiteAssignments = async () => { const { data } = await supabase.from('advisor_site_assignments').select('*, sites(name)').order('created_at'); if (data) setAdvisorSiteAssignments(data); };

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
    const { data: newOrg, error } = await supabase.from('organisations').insert({ name: orgName.trim(), datto_folder_id: finalId || null }).select().single();
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
    const typeValue = siteType === 'OTHER' ? (siteTypeOther.trim() || 'OTHER') : siteType;
    const { error } = await supabase.from('sites').insert({ name: siteName.trim(), type: typeValue, organisation_id: siteOrgId, datto_folder_id: finalId || null, advisor_id: siteAdvisorId || null, compliance_score: 0, trend: 0 });
    if (error) { flash(error.message, true); return; }
    flash('Site created!');
    setSiteName(''); setSiteType('OFFICE'); setSiteTypeOther(''); setSiteOrgId(''); setSiteAdvisorId(''); setSiteFolderId(''); setSiteFolderName(''); setShowSiteFolderPicker(false); setShowSiteForm(false);
    loadSites();
  };

  const handleCreateUser = async () => {
    if (!userEmail.trim()) { flash('Email is required', true); return; }
    if (!userPassword.trim()) { flash('Password is required', true); return; }
    if (userRole === 'client' && !userOrgId) { flash('Organisation is required for client users', true); return; }
    const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userEmail.trim(), password: userPassword, role: userRole, organisation_id: userOrgId || null, site_ids: userSiteIds }) });
    const data = await res.json();
    if (!res.ok) { flash(data.error, true); return; }
    flash('User created!'); setUserEmail(''); setUserPassword(''); setUserRole('advisor'); setUserOrgId(''); setUserSiteIds([]); setShowUserForm(false); loadUsers(); loadClientSiteAssignments();
  };

  const handleCreateAssignment = async () => {
    if (!assignAdvisorId) { flash('Advisor is required', true); return; }
    if (!assignOrgId) { flash('Organisation is required', true); return; }
    const { error } = await supabase.from('advisor_organisations').insert({ advisor_id: assignAdvisorId, organisation_id: assignOrgId });
    if (error) { flash(error.message, true); return; }
    flash('Assignment created!'); setAssignAdvisorId(''); setAssignOrgId(''); setShowAssignForm(false); loadAssignments();
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
    setEditOrgFolderId(org.datto_folder_id || ''); setEditOrgFolderName(org.datto_folder_id ? `ID: ${org.datto_folder_id}` : '');
    setShowEditOrgPicker(false);
  };

  const handleUpdateOrg = async (id: string) => {
    if (!editOrgName.trim()) { flash('Name is required', true); return; }
    const finalId = editOrgFolderId || (showEditOrgPicker ? editOrgFolderId : '');
    const { error } = await supabase.from('organisations').update({ name: editOrgName.trim(), datto_folder_id: finalId || null }).eq('id', id);
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
    const editTypeValue = editSiteType === 'OTHER' ? (editSiteTypeOther.trim() || 'OTHER') : editSiteType;
    const empCount = editSiteEmployeeCount !== '' ? parseInt(editSiteEmployeeCount, 10) : null;
    const { error } = await supabase.from('sites').update({ name: editSiteName.trim(), type: editTypeValue, datto_folder_id: finalId || null, datto_folder_path: editSiteFolderPath || null, advisor_id: editSiteAdvisorId || null, employee_count: empCount }).eq('id', id);
    if (error) { flash(error.message, true); return; }
    flash('Site updated!'); setEditingSiteId(null); setShowEditSitePicker(false); setSiteServices([]); loadSites();
  };

  // ── Delete handlers ──
  const handleDeleteOrg = async (id: string) => { if (!confirm('Delete this organisation? All its sites and actions will also be deleted.')) return; await supabase.from('organisations').delete().eq('id', id); flash('Organisation deleted'); loadOrgs(); loadSites(); };
  const handleDeleteSite = async (id: string) => { if (!confirm('Delete this site? All its actions will also be deleted.')) return; await supabase.from('sites').delete().eq('id', id); flash('Site deleted'); loadSites(); };
  const handleDeleteUser = async (id: string) => { if (!confirm('Delete this user?')) return; await fetch('/api/admin/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) }); flash('User deleted'); loadUsers(); };
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
  ];

  // Reusable folder picker field

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 rounded-3xl p-10 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500 rounded-full -mr-32 -mt-32 blur-[100px] opacity-20 pointer-events-none" />
        <div className="relative z-10">
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-300">System Administration</span>
          <h2 className="text-4xl font-black tracking-tighter mt-2">Superadmin Panel</h2>
          <p className="text-indigo-300 mt-2 text-sm">Manage organisations, sites, users and advisor assignments.</p>
        </div>
      </div>

      {flashError && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold px-4 py-3 rounded-xl">{flashError}</div>}
      {flashSuccess && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-bold px-4 py-3 rounded-xl">✓ {flashSuccess}</div>}

      <div className="flex border-b border-slate-200 gap-6">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`pb-4 px-1 text-[11px] font-black uppercase tracking-widest flex items-center gap-2 border-b-2 transition-all ${activeTab === tab.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ── ORGANISATIONS TAB ── */}
      {activeTab === 'organisations' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">{organisations.length} Organisation{organisations.length !== 1 ? 's' : ''}</h3>
            <button onClick={() => setShowOrgForm(v => !v)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700"><Plus size={13} />Add Organisation</button>
          </div>

          {showOrgForm && (
            <div className="bg-white border border-indigo-200 rounded-2xl p-6 space-y-4">
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
                <button onClick={handleCreateOrg} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700">Create Organisation</button>
                <button onClick={() => { setShowOrgForm(false); setShowOrgFolderPicker(false); }} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider">Cancel</button>
              </div>
            </div>
          )}

          {loading ? <div className="py-12 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div>
            : organisations.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <Building2 size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="font-black text-slate-700">No organisations yet</p>
                <p className="text-sm text-slate-400 mt-1">Add your first client organisation above.</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                  <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-6 py-3">Name</th><th className="px-6 py-3">Advisor</th><th className="px-6 py-3">Datto Folder</th><th className="px-6 py-3">Sites</th><th className="px-6 py-3"></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {organisations.map(org => (
                      <React.Fragment key={org.id}>
                        <tr className="hover:bg-slate-50">
                          <td className="px-6 py-4 font-bold text-slate-800"><button onClick={() => { setSelectedOrgFilter(org.id); setActiveTab('sites'); }} className="hover:text-indigo-600 hover:underline text-left">{org.name}</button></td>
                          <td className="px-6 py-4 text-sm text-slate-600">{(() => { const a = assignments.find((a: any) => a.organisation_id === org.id); return a ? (advisors.find(adv => adv.id === a.advisor_id)?.email || '—') : <span className="text-slate-300">Unassigned</span>; })()}</td>
                          <td className="px-6 py-4 text-sm">{org.datto_folder_id ? <span className="flex items-center gap-1.5 text-amber-600 font-mono text-xs"><Folder size={12} />{org.datto_folder_id}</span> : <span className="text-slate-300">Not set</span>}</td>
                          <td className="px-6 py-4 text-sm font-bold text-slate-600">{sites.filter(s => s.organisation_id === org.id).length}</td>
                          <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
                            <button onClick={() => editingOrgId === org.id ? setEditingOrgId(null) : startEditOrg(org)} className="text-indigo-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50"><Pencil size={14} /></button>
                            <button onClick={() => handleDeleteOrg(org.id)} className="text-rose-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50"><X size={14} /></button>
                          </td>
                        </tr>
                        {editingOrgId === org.id && (
                          <tr><td colSpan={5} className="px-6 py-4 bg-indigo-50/50 border-b border-indigo-100">
                            <div className="space-y-3">
                              <h5 className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Edit Organisation</h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><label className={labelClass}>Name</label><input value={editOrgName} onChange={e => setEditOrgName(e.target.value)} className={inputClass} /></div>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label className={labelClass}>Datto Folder</label>
                                  {showEditOrgPicker ? (
                                    <DattoFolderPicker startFolderId={DATTO_ROOT_ID} startFolderName="Customer Documents"
                                      onSelect={(name, id, _path) => { setEditOrgFolderName(name); setEditOrgFolderId(id); setShowEditOrgPicker(false); }}
                                      onNavigate={(name, id) => { setEditOrgFolderName(name); setEditOrgFolderId(id); }}
                                      onClose={() => setShowEditOrgPicker(false)} />
                                  ) : (
                                    <div onClick={() => setShowEditOrgPicker(true)} className={`${inputClass} flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-300`}>
                                      {editOrgFolderName ? <span className="flex items-center gap-2 text-indigo-700 font-bold text-sm"><Folder size={14} className="text-amber-400" />{editOrgFolderName}</span> : <span className="text-slate-400 text-sm">Click to browse…</span>}
                                      <FolderOpen size={16} className="text-slate-300" />
                                    </div>
                                  )}
                                </div>
                              </div>
                              {/* Advisors */}
                              <div>
                                <label className={labelClass}>Advisors</label>
                                <div className="space-y-1 mb-2">
                                  {assignments.filter((a: any) => a.organisation_id === org.id).map((a: any) => (
                                    <div key={a.id} className="flex items-center justify-between px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm">
                                      <span className="font-bold text-slate-700">{users.find(u => u.id === a.advisor_id)?.email || a.advisor_id}</span>
                                      <button onClick={() => handleDeleteAssignment(a.id)} className="text-rose-400 hover:text-rose-600 p-0.5 rounded"><X size={13} /></button>
                                    </div>
                                  ))}
                                  {assignments.filter((a: any) => a.organisation_id === org.id).length === 0 && <p className="text-xs text-slate-400">No advisors assigned</p>}
                                </div>
                                <div className="relative">
                                  <input value={orgAdvisorSearch} onChange={e => setOrgAdvisorSearch(e.target.value)} placeholder="Search by email to add…" className={`${inputClass} pr-8`} />
                                  {orgAdvisorSearch && (
                                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                                      {advisors.filter(a => a.email.toLowerCase().includes(orgAdvisorSearch.toLowerCase()) && !assignments.some((as: any) => as.organisation_id === org.id && as.advisor_id === a.id)).slice(0, 5).map(a => (
                                        <button key={a.id} onClick={() => handleAddOrgAdvisor(org.id, a.id)} className="w-full text-left px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700">{a.email}</button>
                                      ))}
                                      {advisors.filter(a => a.email.toLowerCase().includes(orgAdvisorSearch.toLowerCase()) && !assignments.some((as: any) => as.organisation_id === org.id && as.advisor_id === a.id)).length === 0 && <p className="px-4 py-2.5 text-sm text-slate-400">No matches</p>}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex gap-2">
                                <button onClick={() => handleUpdateOrg(org.id)} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700">Save Changes</button>
                                <button onClick={() => { setEditingOrgId(null); setShowEditOrgPicker(false); setOrgAdvisorSearch(''); }} className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider">Cancel</button>
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
            <button onClick={() => setShowSiteForm(v => !v)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700"><Plus size={13} />Add Site</button>
          </div>

          {showSiteForm && (
            <div className="bg-white border border-indigo-200 rounded-2xl p-6 space-y-4">
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
                onSelectFolder={(name: string, id: string, _path: string) => { setSiteFolderName(name); setSiteFolderId(id); setShowSiteFolderPicker(false); }}
                onNavigate={(name: string, id: string) => { setSitePickerCurrentName(name); setSitePickerCurrentId(id); }}
                orgForPicker={selectedOrgForSitePicker} labelText="Datto Folder" labelHint="optional — if blank, uses the organisation folder"
              />
              <div className="flex gap-3">
                <button onClick={handleCreateSite} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700">Create Site</button>
                <button onClick={() => { setShowSiteForm(false); setShowSiteFolderPicker(false); }} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider">Cancel</button>
              </div>
            </div>
          )}

          {loading ? <div className="py-12 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div>
            : filteredSites.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <Factory size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="font-black text-slate-700">No sites yet</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                  <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-6 py-3">Site</th><th className="px-6 py-3">Organisation</th><th className="px-6 py-3">Advisor</th><th className="px-6 py-3">Type</th><th className="px-6 py-3">Datto Folder</th><th className="px-6 py-3"></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSites.map(site => (
                      <React.Fragment key={site.id}>
                        <tr className="hover:bg-slate-50">
                          <td className="px-6 py-4 font-bold text-slate-800">{site.name}</td>
                          <td className="px-6 py-4 text-sm text-slate-500">{site.organisations?.name || '—'}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{(() => { const orgAdvisorId = assignments.find((a: any) => a.organisation_id === site.organisation_id)?.advisor_id; const effectiveId = site.advisor_id || orgAdvisorId; const advisor = effectiveId ? advisors.find(a => a.id === effectiveId) : null; return advisor ? <span className={site.advisor_id ? '' : 'text-slate-400 italic'}>{advisor.email}{!site.advisor_id && ' (org)'}</span> : <span className="text-slate-300">Unassigned</span>; })()}</td>
                          <td className="px-6 py-4"><span className="text-[10px] font-black uppercase tracking-wider text-slate-500 bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg">{getSiteLabel(site.type)}</span></td>
                          <td className="px-6 py-4 text-xs font-mono">
                            {site.datto_folder_id
                              ? <span className="text-amber-600 flex items-center gap-1.5"><Folder size={12} />{site.datto_folder_id}</span>
                              : <span className="text-slate-300 italic">Uses org folder</span>}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {site.datto_folder_id && (
                                <button
                                  onClick={() => setSyncConfigSite({ ...site, excluded_datto_folder_ids: site.excluded_datto_folder_ids ?? [] })}
                                  className="text-violet-400 hover:text-violet-600 p-1.5 rounded-lg hover:bg-violet-50"
                                  title="Configure sync folders"
                                ><Settings size={14} /></button>
                              )}
                              <button onClick={() => editingSiteId === site.id ? setEditingSiteId(null) : startEditSite(site)} className="text-indigo-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50"><Pencil size={14} /></button>
                              <button onClick={() => handleDeleteSite(site.id)} className="text-rose-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50"><X size={14} /></button>
                            </div>
                          </td>
                        </tr>
                        {editingSiteId === site.id && (
                          <tr><td colSpan={6} className="px-6 py-4 bg-indigo-50/50 border-b border-indigo-100">
                            <div className="space-y-3">
                              <h5 className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Edit Site</h5>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div><label className={labelClass}>Name</label><input value={editSiteName} onChange={e => setEditSiteName(e.target.value)} className={inputClass} /></div>
                                <div>
                                  <label className={labelClass}>Type</label>
                                  <select value={editSiteType} onChange={e => setEditSiteType(e.target.value)} className={inputClass}>
                                    {SITE_TYPES.map(t => <option key={t} value={t}>{getSiteLabel(t)}</option>)}
                                  </select>
                                  {editSiteType === 'OTHER' && (
                                    <input value={editSiteTypeOther} onChange={e => setEditSiteTypeOther(e.target.value)} placeholder="Describe the site type…" className={`${inputClass} mt-2`} />
                                  )}
                                </div>
                                <div>
                                  <label className={labelClass}>Advisors</label>
                                  <div className="space-y-1 mb-1.5">
                                    {advisorSiteAssignments.filter((a: any) => a.site_id === site.id).map((a: any) => (
                                      <div key={a.id} className="flex items-center justify-between px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-sm">
                                        <span className="font-bold text-slate-700">{users.find(u => u.id === a.advisor_id)?.email || a.advisor_id}</span>
                                        <button onClick={() => handleDeleteAdvisorSiteAssignment(a.id)} className="text-rose-400 hover:text-rose-600 p-0.5 rounded"><X size={13} /></button>
                                      </div>
                                    ))}
                                    {advisorSiteAssignments.filter((a: any) => a.site_id === site.id).length === 0 && <p className="text-[11px] text-slate-400">No advisors assigned</p>}
                                  </div>
                                  <div className="relative">
                                    <input value={siteAdvisorSearch} onChange={e => setSiteAdvisorSearch(e.target.value)} placeholder="Search to add…" className={`${inputClass} text-xs`} />
                                    {siteAdvisorSearch && (
                                      <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                                        {advisors.filter(a => a.email.toLowerCase().includes(siteAdvisorSearch.toLowerCase()) && !advisorSiteAssignments.some((as: any) => as.site_id === site.id && as.advisor_id === a.id)).slice(0, 5).map(a => (
                                          <button key={a.id} onClick={() => handleAddSiteAdvisor(site.id, a.id)} className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700">{a.email}</button>
                                        ))}
                                        {advisors.filter(a => a.email.toLowerCase().includes(siteAdvisorSearch.toLowerCase()) && !advisorSiteAssignments.some((as: any) => as.site_id === site.id && as.advisor_id === a.id)).length === 0 && <p className="px-4 py-2 text-sm text-slate-400">No matches</p>}
                                      </div>
                                    )}
                                  </div>
                                </div>
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
                                  <div onClick={() => setShowEditSitePicker(true)} className={`${inputClass} flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-300`}>
                                    {editSiteFolderName ? <span className="flex items-center gap-2 text-indigo-700 font-bold text-sm"><Folder size={14} className="text-amber-400" />{editSiteFolderName}</span> : <span className="text-slate-400 text-sm">Click to browse…</span>}
                                    <FolderOpen size={16} className="text-slate-300" />
                                  </div>
                                )}
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div><label className={labelClass}>Employee Count (optional)</label><input type="number" min="1" value={editSiteEmployeeCount} onChange={e => setEditSiteEmployeeCount(e.target.value)} placeholder="e.g. 25" className={inputClass} /></div>
                              </div>

                              {/* Client Users */}
                              <div>
                                <label className={labelClass}>Client Users</label>
                                <div className="space-y-1 mb-1.5">
                                  {clientSiteAssignments.filter((a: any) => a.site_id === site.id).map((a: any) => (
                                    <div key={a.id} className="flex items-center justify-between px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-sm">
                                      <span className="font-bold text-slate-700">{users.find(u => u.id === a.client_user_id)?.email || a.client_user_id}</span>
                                      <button onClick={() => handleDeleteClientSiteAssignment(a.id)} className="text-rose-400 hover:text-rose-600 p-0.5 rounded"><X size={13} /></button>
                                    </div>
                                  ))}
                                  {clientSiteAssignments.filter((a: any) => a.site_id === site.id).length === 0 && <p className="text-[11px] text-slate-400">No client users assigned</p>}
                                </div>
                                <div className="relative">
                                  <input value={siteClientSearch} onChange={e => setSiteClientSearch(e.target.value)} placeholder="Search by email to add…" className={`${inputClass} text-xs`} />
                                  {siteClientSearch && (
                                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                                      {users.filter((u: any) => u.profile?.role === 'client' && u.email.toLowerCase().includes(siteClientSearch.toLowerCase()) && !clientSiteAssignments.some((a: any) => a.site_id === site.id && a.client_user_id === u.id)).slice(0, 5).map((u: any) => (
                                        <button key={u.id} onClick={() => handleAddSiteClient(site.id, u.id)} className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700">{u.email}</button>
                                      ))}
                                      {users.filter((u: any) => u.profile?.role === 'client' && u.email.toLowerCase().includes(siteClientSearch.toLowerCase()) && !clientSiteAssignments.some((a: any) => a.site_id === site.id && a.client_user_id === u.id)).length === 0 && <p className="px-4 py-2 text-sm text-slate-400">No matches</p>}
                                    </div>
                                  )}
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
                                      <div key={svc.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                                        <input type="checkbox" id={`svc-${svc.id}`} checked={svc.purchased} onChange={async e => {
                                          const newVal = e.target.checked;
                                          setSiteServices(prev => prev.map(s => s.id === svc.id ? { ...s, purchased: newVal } : s));
                                          await fetch(`/api/sites/${site.id}/services`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requirementId: svc.id, purchased: newVal }) });
                                        }} className="rounded" />
                                        <label htmlFor={`svc-${svc.id}`} className="flex-1 text-sm font-bold text-slate-700 cursor-pointer">{svc.requirement_name}</label>
                                        {svc.is_mandatory
                                          ? <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">Mandatory</span>
                                          : <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200">Recommended</span>
                                        }
                                      </div>
                                    ))}
                                  </div>
                                  {siteServices.some(s => s.is_mandatory && !s.purchased) && (
                                    <p className="text-[11px] font-bold text-rose-600 mt-2 flex items-center gap-1.5"><AlertCircle size={12} />{siteServices.filter(s => s.is_mandatory && !s.purchased).length} mandatory service(s) not covered — IAG score will show Red</p>
                                  )}
                                </div>
                              ) : null}

                              <div className="flex gap-2">
                                <button onClick={() => handleUpdateSite(site.id)} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700">Save Changes</button>
                                <button onClick={() => { setEditingSiteId(null); setShowEditSitePicker(false); setSiteServices([]); setSiteAdvisorSearch(''); setSiteClientSearch(''); }} className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider">Cancel</button>
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

      {/* ── USERS TAB ── */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">{users.length} User{users.length !== 1 ? 's' : ''}</h3>
            <button onClick={() => setShowUserForm(v => !v)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700"><Plus size={13} />Add User</button>
          </div>
          {showUserForm && (
            <div className="bg-white border border-indigo-200 rounded-2xl p-6 space-y-4">
              <h4 className="font-black text-slate-900 text-sm uppercase tracking-widest">New User</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className={labelClass}>Email *</label><input type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)} placeholder="user@company.com" className={inputClass} /></div>
                <div><label className={labelClass}>Password *</label><input type="password" value={userPassword} onChange={e => setUserPassword(e.target.value)} placeholder="Min 8 characters" className={inputClass} /></div>
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
                      <label className={labelClass}>Sites <span className="text-slate-400 font-normal normal-case">(leave empty for all sites in org)</span></label>
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
                </>
              )}
              <div className="flex gap-3">
                <button onClick={handleCreateUser} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700">Create User</button>
                <button onClick={() => setShowUserForm(false)} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider">Cancel</button>
              </div>
            </div>
          )}
          {loading ? <div className="py-12 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div> : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-left">
                <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-6 py-3">Email</th><th className="px-6 py-3">Role</th><th className="px-6 py-3">Organisation</th><th className="px-6 py-3"></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map(user => (
                    <tr key={user.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-bold text-slate-800">{user.email}</td>
                      <td className="px-6 py-4"><span className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg border ${user.profile?.role === 'superadmin' ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : user.profile?.role === 'advisor' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}`}>{user.profile?.role || 'unknown'}</span></td>
                      <td className="px-6 py-4 text-sm text-slate-500">{user.profile?.organisation_id ? organisations.find(o => o.id === user.profile.organisation_id)?.name || '—' : '—'}</td>
                      <td className="px-6 py-4 text-right">{user.profile?.role !== 'superadmin' && <button onClick={() => handleDeleteUser(user.id)} className="text-rose-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50"><X size={14} /></button>}</td>
                    </tr>
                  ))}
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
              <button onClick={() => setShowAddReqForm(v => !v)} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-slate-50"><Plus size={13} />Add Requirement</button>
              <button onClick={handleGenerateRequirements} disabled={generating}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-700 disabled:opacity-50">
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
            <div className="bg-white border border-indigo-200 rounded-2xl p-6 space-y-4">
              <h4 className="font-black text-slate-900 text-sm uppercase tracking-widest">New Requirement</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className={labelClass}>Requirement Name *</label><input value={newReqName} onChange={e => setNewReqName(e.target.value)} placeholder="e.g. Fire Risk Assessment" className={inputClass} /></div>
                <div><label className={labelClass}>Description</label><input value={newReqDesc} onChange={e => setNewReqDesc(e.target.value)} placeholder="Brief description" className={inputClass} /></div>
                <div><label className={labelClass}>Legal Basis (if mandatory)</label><input value={newReqLegal} onChange={e => setNewReqLegal(e.target.value)} placeholder="e.g. Fire Safety Order 2005" className={inputClass} /></div>
                <div className="flex items-center gap-3 pt-6"><input type="checkbox" id="newMandatory" checked={newReqMandatory} onChange={e => setNewReqMandatory(e.target.checked)} className="rounded" /><label htmlFor="newMandatory" className="text-sm font-bold text-slate-700">Mandatory (legally required)</label></div>
              </div>
              <div className="flex gap-3">
                <button onClick={handleAddRequirement} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700">Add Requirement</button>
                <button onClick={() => setShowAddReqForm(false)} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider">Cancel</button>
              </div>
            </div>
          )}

          {/* AI generate preview */}
          {generatePreview && (
            <div className="bg-white border border-violet-200 rounded-2xl overflow-hidden">
              <div className="bg-violet-600 px-6 py-4 flex items-center justify-between">
                <h4 className="font-black text-white text-sm uppercase tracking-widest flex items-center gap-2"><Sparkles size={14} />Review AI-Generated Requirements</h4>
                <button onClick={() => setGeneratePreview(null)} className="text-violet-200 hover:text-white"><X size={18} /></button>
              </div>
              <div className="px-6 pt-4 flex items-center justify-between">
                <p className="text-[11px] text-slate-500 font-bold">Select the requirements to add. These will replace existing requirements for {SITE_TYPE_LABELS[reqSiteType]}.</p>
                <button onClick={() => { const allSelected = generatePreview.every((r: any) => r.selected); setGeneratePreview(generatePreview.map((r: any) => ({ ...r, selected: !allSelected }))); }} className="text-[11px] font-black text-violet-600 hover:text-violet-800 shrink-0 ml-4">
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
                <button onClick={handleConfirmGenerate} className="px-6 py-2.5 bg-violet-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-700">Save {generatePreview.filter((r: any) => r.selected).length} Requirement{generatePreview.filter((r: any) => r.selected).length !== 1 ? 's' : ''}</button>
                <button onClick={() => setGeneratePreview(null)} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider">Cancel</button>
              </div>
            </div>
          )}

          {/* Existing requirements list */}
          {reqLoading ? <div className="py-8 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div>
          : requirements.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <Shield size={32} className="text-slate-300 mx-auto mb-3" />
              <p className="font-black text-slate-700">No requirements set for {SITE_TYPE_LABELS[reqSiteType]}</p>
              <p className="text-sm text-slate-400 mt-1">Use "Generate with AI" to create a starting list, or add manually.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-left">
                <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-6 py-3">Requirement</th><th className="px-6 py-3">Status</th><th className="px-6 py-3">Legal Basis</th><th className="px-6 py-3"></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {requirements.map(req => (
                    <React.Fragment key={req.id}>
                      <tr className="hover:bg-slate-50">
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-800 text-sm">{req.requirement_name}</p>
                          {req.description && <p className="text-[11px] text-slate-400 mt-0.5">{req.description}</p>}
                        </td>
                        <td className="px-6 py-4">{req.is_mandatory ? <span className="text-[10px] font-black uppercase px-2 py-1 rounded-full bg-rose-100 text-rose-700 border border-rose-200">Mandatory</span> : <span className="text-[10px] font-black uppercase px-2 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Recommended</span>}</td>
                        <td className="px-6 py-4 text-[11px] text-slate-400 font-mono">{req.legal_basis || '—'}</td>
                        <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
                          <button onClick={() => { setEditingReqId(req.id); setEditReqName(req.requirement_name); setEditReqDesc(req.description || ''); setEditReqMandatory(req.is_mandatory); setEditReqLegal(req.legal_basis || ''); }} className="text-indigo-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50"><Pencil size={14} /></button>
                          <button onClick={() => handleDeleteRequirement(req.id)} className="text-rose-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50"><X size={14} /></button>
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
                            <div className="flex gap-3"><button onClick={() => handleUpdateRequirement(req.id)} className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700">Save</button><button onClick={() => setEditingReqId(null)} className="px-5 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider">Cancel</button></div>
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

      {syncConfigSite && (
        <SyncConfigModal
          site={syncConfigSite}
          onClose={() => setSyncConfigSite(null)}
          onSave={(siteId, excludedIds) => {
            setSites(prev => prev.map(s => s.id === siteId ? { ...s, excluded_datto_folder_ids: excludedIds } : s));
            setSyncConfigSite(null);
          }}
        />
      )}
    </div>
  );
};

// ─── Sync Config Modal ────────────────────────────────────────────────────────
const FolderCheckboxTree = ({ folderId, folderName, depth, includedIds, onToggle }: {
  folderId: string; folderName: string; depth: number;
  includedIds: Set<string>; onToggle: (id: string) => void;
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
      setChildren(items.filter((i: DattoItem) => i.type === 'folder'));
      setFileCount(items.filter((i: DattoItem) => i.type === 'file').length);
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
        <input type="checkbox" checked={isIncluded} onChange={() => onToggle(folderId)} className="w-3.5 h-3.5 flex-shrink-0 accent-violet-600" />
        <Folder size={13} className={isIncluded ? 'text-amber-400 flex-shrink-0' : 'text-slate-300 flex-shrink-0'} />
        <span className={`text-xs font-bold flex-1 truncate ${isIncluded ? 'text-slate-700' : 'text-slate-400'}`}>{folderName}</span>
        {fileCount !== null && (
          <span className="text-[10px] text-slate-400 font-bold bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
        )}
      </div>
      {expanded && children !== null && children.map(child => (
        <FolderCheckboxTree key={child.id} folderId={child.id} folderName={child.name} depth={depth + 1} includedIds={includedIds} onToggle={onToggle} />
      ))}
    </div>
  );
};

const SyncConfigModal = ({ site, onClose, onSave }: {
  site: Site; onClose: () => void; onSave: (siteId: string, includedIds: string[]) => void;
}) => {
  const [includedFolders, setIncludedFolders] = useState<Map<string, string>>(
    new Map((site.included_datto_folder_ids ?? []).map(id => [id, id]))
  );
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleSelect = (name: string, id: string) => {
    setIncludedFolders(prev => { const next = new Map(prev); next.set(id, name); return next; });
    setShowPicker(false);
  };

  const handleRemove = (id: string) => {
    setIncludedFolders(prev => { const next = new Map(prev); next.delete(id); return next; });
  };

  const handleSave = async () => {
    setSaving(true); setSaveError('');
    const includedArr = Array.from(includedFolders.keys());
    const { error } = await supabase.from('sites').update({ included_datto_folder_ids: includedArr }).eq('id', site.id);
    if (error) { setSaveError('Failed to save. Please try again.'); setSaving(false); return; }
    onSave(site.id, includedArr);
    onClose();
  };

  if (!site.datto_folder_id) return null;
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="bg-violet-600 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-black text-white text-sm uppercase tracking-widest flex items-center gap-2"><Settings size={14} />Configure AI Sync</h2>
            <p className="text-violet-200 text-[11px] mt-0.5">{site.name}</p>
          </div>
          <button onClick={onClose} className="text-violet-200 hover:text-white"><X size={18} /></button>
        </div>
        <div className="bg-violet-50 border-b border-violet-100 px-6 py-3">
          <p className="text-[11px] text-violet-700 font-bold">Select folders to include in AI Sync. Leave empty to scan all folders.</p>
        </div>
        <div className="px-4 py-4 space-y-3">
          {/* Selected folders */}
          {includedFolders.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {Array.from(includedFolders.entries()).map(([id, name]) => (
                <span key={id} className="flex items-center gap-1.5 px-3 py-1 bg-violet-100 text-violet-700 border border-violet-200 rounded-lg text-[11px] font-black">
                  <Folder size={11} className="text-amber-400" />{name}
                  <button onClick={() => handleRemove(id)} className="text-violet-400 hover:text-rose-500 ml-0.5"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          {/* Folder picker */}
          {showPicker ? (
            <DattoFolderPicker
              startFolderId={site.datto_folder_id}
              startFolderName={site.name}
              onSelect={handleSelect}
              onClose={() => setShowPicker(false)}
            />
          ) : (
            <button onClick={() => setShowPicker(true)} className="w-full flex items-center justify-between gap-2 px-4 py-2.5 border border-slate-200 rounded-xl hover:border-violet-300 text-left">
              <span className="text-slate-400 text-sm">Click to browse and add a folder…</span>
              <FolderOpen size={16} className="text-slate-300" />
            </button>
          )}
        </div>
        <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            {includedFolders.size > 0 ? <span className="text-[11px] font-bold text-violet-600">{includedFolders.size} folder{includedFolders.size !== 1 ? 's' : ''} selected</span> : <span className="text-[11px] font-bold text-slate-400">No folders selected — will scan all</span>}
            {saveError && <span className="text-[11px] font-bold text-rose-600">{saveError}</span>}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-5 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-violet-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save Config'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Login Screen ─────────────────────────────────────────────────────────────
const LoginScreen = ({ onLogin }: { onLogin: () => void }) => {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const handleLogin = async () => {
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError('Invalid email or password'); setLoading(false); } else { onLogin(); }
  };
  return (
    <div className="min-h-screen bg-indigo-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-indigo-950 font-black text-2xl mx-auto mb-4 shadow-xl">MB</div>
          <h1 className="text-2xl font-black text-white tracking-tight">McCormack Benson</h1>
          <p className="text-indigo-300 text-sm mt-1">H&S Compliance Portal</p>
        </div>
        <div className="bg-white rounded-3xl p-8 shadow-2xl">
          <h2 className="text-lg font-black text-slate-900 mb-6">Sign in to your account</h2>
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold px-4 py-3 rounded-xl mb-4">{error}</div>}
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Email</label>
              <div className="relative"><Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" /><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Password</label>
              <div className="relative"><Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" /><input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="••••••••" className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            </div>
            <button onClick={handleLogin} disabled={loading} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-black text-sm uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50 mt-2">{loading ? 'Signing in…' : 'Sign In'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<AppView>('portfolio');
  const [dashboardTab, setDashboardTab] = useState<'analytics' | 'data'>('analytics');
  const [siteTab, setSiteTab] = useState<'actions' | 'documents' | 'dochealth' | 'iag' | 'files'>('actions');
  const [iagServices, setIagServices] = useState<any[]>([]);
  const [iagServicesLoading, setIagServicesLoading] = useState(false);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [filterOrgId, setFilterOrgId] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLastRun, setSyncLastRun] = useState('2 hours ago');
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);
  const [filterPriority, setFilterPriority] = useState<Priority | 'all' | 'resolved'>('red');
  const [actionNotes, setActionNotes] = useState<Record<string, string>>({});
  const [sites, setSites] = useState<Site[]>([]);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [allActions, setAllActions] = useState<Action[]>([]);
  const [showAddAction, setShowAddAction] = useState(false);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [expandedDocGroups, setExpandedDocGroups] = useState<Set<string>>(new Set());
  const [aiSyncing, setAiSyncing] = useState(false);
  const [aiSyncProgress, setAiSyncProgress] = useState('');
  // File browser state
  const [folderData, setFolderData] = useState<Map<string, { items: DattoItem[]; path: string }>>(new Map());
  const [loadingFolderIds, setLoadingFolderIds] = useState<Set<string>>(new Set());
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [browserRootPath, setBrowserRootPath] = useState<string>('');
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [searchFileCache, setSearchFileCache] = useState<{ siteId: string; files: (DattoItem & { folderPath: string })[] } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [aiStatusMessage, setAiStatusMessage] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [reviewActions, setReviewActions] = useState<ReviewAction[]>([]);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showSyncConfig, setShowSyncConfig] = useState(false);
  const [scoreExplanationCard, setScoreExplanationCard] = useState<'implementation' | 'iag' | 'documentation' | null>(null);
  const [advisors, setAdvisors] = useState<{ id: string; email: string }[]>([]);
  const aiCancelledRef = React.useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUser(session?.user ?? null); setAuthLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setUser(session?.user ?? null); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('*').eq('id', user.id).single().then(({ data }) => {
      if (data) { setProfile(data); if (data.role === 'superadmin') setView('admin'); }
    });
    fetch('/api/admin/users').then(r => r.json()).then(users => {
      setAdvisors((users as any[]).filter(u => u.profile?.role === 'advisor').map(u => ({ id: u.id, email: u.email })));
    }).catch(() => {});
  }, [user]);

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
    if (!user || !profile || organisations.length === 0) return;
    const load = async () => {
      const orgFolderMap = new Map(organisations.map(o => [o.id, o.datto_folder_id]));
      let sitesQuery = supabase.from('sites').select('*');
      if (profile.role === 'advisor') {
        const orgIds = organisations.map(o => o.id);
        sitesQuery = sitesQuery.in('organisation_id', orgIds);
      } else if (profile.role === 'client') {
        const { data: clientAssigns } = await supabase.from('client_site_assignments').select('site_id').eq('client_user_id', user.id);
        const assignedSiteIds = (clientAssigns ?? []).map((a: any) => a.site_id);
        if (assignedSiteIds.length > 0) {
          sitesQuery = sitesQuery.in('id', assignedSiteIds);
        } else if (profile.site_id) {
          sitesQuery = sitesQuery.eq('id', profile.site_id); // legacy fallback
        } else if (profile.organisation_id) {
          sitesQuery = sitesQuery.eq('organisation_id', profile.organisation_id); // legacy fallback
        } else { setSites([]); return; }
      }
      const { data } = await sitesQuery;
      if (data) {
        const mapped: Site[] = data.map((s: any) => ({
          id: s.id, name: s.name, type: s.type, organisation_id: s.organisation_id,
          compliance: s.compliance_score ?? 0, trend: s.trend ?? 0,
          actionProgress: s.action_progress ?? 100,
          iagScore: s.iag_score ?? null,
          employeeCount: s.employee_count ?? null,
          red: 0, amber: 0, green: 0, lastReview: '—',
          datto_folder_id: s.datto_folder_id || orgFolderMap.get(s.organisation_id) || null,
          datto_folder_path: s.datto_folder_path || null,
          advisor_id: s.advisor_id ?? null,
          last_ai_sync: s.last_ai_sync ?? null,
          excluded_datto_folder_ids: s.excluded_datto_folder_ids ?? [],
          included_datto_folder_ids: s.included_datto_folder_ids ?? null,
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
                actionProgress: s.action_progress ?? 100, iagScore: s.iag_score ?? null,
                employeeCount: s.employee_count ?? null, red: 0, amber: 0, green: 0, lastReview: '—',
                datto_folder_id: s.datto_folder_id || orgFolderMap.get(s.organisation_id) || null,
                advisor_id: s.advisor_id ?? null, last_ai_sync: s.last_ai_sync ?? null,
                excluded_datto_folder_ids: s.excluded_datto_folder_ids ?? [],
                included_datto_folder_ids: s.included_datto_folder_ids ?? null,
              }))];
            }
          }
        }
        setSites(finalMapped);
        if (finalMapped.length > 0 && !selectedSite) { setSelectedSite(finalMapped[0]); recalcActionProgress(finalMapped[0].id); if (profile.role === 'client') setView('site'); }
      }
    };
    load();
  }, [user, profile, organisations]);

  useEffect(() => {
    if (!user || sites.length === 0) return;
    const priorityMap: Record<string, Priority> = { critical: 'red', upcoming: 'amber', scheduled: 'green', red: 'red', amber: 'amber', green: 'green' };
    const siteIds = sites.map(s => s.id);
    supabase.from('actions').select('*').in('site_id', siteIds).then(({ data }) => {
      if (data) setAllActions(data.filter((a: any) => !a.site_document_id).map((a: any) => ({ id: a.id, action: a.title, description: a.description || '', date: a.due_date || '', site: sites.find(s => s.id === a.site_id)?.name || '', who: a.responsible_person || '', contractor: a.contractor || '', source: a.source_document_name || '', source_document_id: a.source_document_id || '', priority: (priorityMap[a.priority] || 'green') as Priority, regulation: a.regulation || '', notes: '', status: a.status as ActionStatus, hazardRef: a.hazard_ref || null, hazard: a.hazard || null, existingControls: a.existing_controls || null, riskRating: a.risk_rating || null, riskLevel: a.risk_level || null, resolvedDate: a.resolved_date || null, sourceFolderId: a.source_folder_id || null, isSuggested: a.is_suggested ?? false, updatedAt: a.updated_at || null, sourceFolderPath: a.source_folder_path || null, issueDate: a.issue_date || null, _siteDocumentId: a.site_document_id || null })));
    });
  }, [user, sites]);

  const handleLogout = async () => { await supabase.auth.signOut(); setUser(null); setProfile(null); setSites([]); setOrganisations([]); };
  const handleDattoSync = () => { setIsSyncing(true); setTimeout(() => { setIsSyncing(false); setSyncLastRun('Just now'); }, 2000); };

  const loadIagServices = async (siteId: string) => {
    setIagServicesLoading(true);
    const res = await fetch(`/api/sites/${siteId}/services`);
    if (res.ok) setIagServices(await res.json());
    setIagServicesLoading(false);
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
    setFilterPriority('red');
    setSiteTab('actions');
  }, [selectedSite?.id]);

  // Collapse open actions when switching tabs or filters
  React.useEffect(() => { setExpandedActionId(null); setExpandedDocGroups(new Set()); }, [siteTab, filterPriority]);

  // Init file browser when Files tab is opened (preserves state on tab toggle, only re-inits for new site)
  React.useEffect(() => {
    if (siteTab !== 'files' || !selectedSite?.datto_folder_id) return;
    if (folderData.has(selectedSite.datto_folder_id)) return;
    const init = async () => {
      const rootPath = await resolvePathFromRoot(selectedSite);
      setBrowserRootPath(rootPath);
      await loadFolder(selectedSite.datto_folder_id!, rootPath);
      setExpandedFolderIds(new Set([selectedSite.datto_folder_id!]));
    };
    init();
  }, [siteTab, selectedSite?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleResolve = async (id: string) => {
    const isCurrentlyResolved = resolvedIds.includes(id);
    setResolvedIds(prev => isCurrentlyResolved ? prev.filter(i => i !== id) : [...prev, id]);
    const today = new Date().toLocaleDateString('en-CA');
    await supabase.from('actions').update({
      status: isCurrentlyResolved ? 'open' : 'resolved',
      resolved_date: isCurrentlyResolved ? null : today,
    }).eq('id', id);
    setAllActions(prev => prev.map(a => a.id === id ? { ...a, status: isCurrentlyResolved ? 'open' : 'resolved', resolvedDate: isCurrentlyResolved ? null : today } : a));
    const action = allActions.find(a => a.id === id);
    const siteId = sites.find(s => s.name === action?.site)?.id;
    if (siteId) recalcActionProgress(siteId);
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
  const handleSiteClick = (site: Site) => { setSelectedSite(site); setView('site'); recalcActionProgress(site.id); };
  const handleSaveSyncConfig = (siteId: string, includedIds: string[]) => {
    setSites(prev => prev.map(s => s.id === siteId ? { ...s, included_datto_folder_ids: includedIds } : s));
    setSelectedSite(prev => prev?.id === siteId ? { ...prev, included_datto_folder_ids: includedIds } : prev);
  };
  const handleActionSaved = (action: Action) => {
    setAllActions(prev => [...prev, action]);
    setShowAddAction(false);
    const siteId = sites.find(s => s.name === action.site)?.id ?? selectedSite?.id;
    if (siteId) recalcActionProgress(siteId);
  };

  const handleAddReviewAction = async (actionId: string) => {
    const ra = reviewActions.find(a => a.id === actionId);
    if (!ra || !selectedSite) return;
    const { data, error: insertErr } = await supabase.from('actions').insert({
      site_id: selectedSite.id,
      title: ra.description,
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
    setReviewActions(prev => prev.map(a => a.id === actionId ? { ...a, added: true } : a));
    if (data) {
      setAllActions(prev => [...prev, { id: data.id, action: ra.description, description: '', date: ra.dueDate || '', site: selectedSite.name, who: ra.responsiblePerson || '', contractor: '', source: ra.docName, source_document_id: ra.docFileId || '', sourceFolderId: ra.docFolderFileId || null, sourceFolderPath: ra.docFolderPath || null, priority: 'green' as Priority, regulation: ra.regulation || '', notes: '', status: 'open', resolvedDate: null, hazardRef: ra.hazardRef || null, hazard: ra.hazard || null, existingControls: ra.existingControls || null, riskRating: ra.riskRating || null, riskLevel: ra.riskLevel || null, updatedAt: data.updated_at || null, issueDate: ra.documentMeta?.assessmentDate || null }]);
      recalcActionProgress(selectedSite.id);
    }
  };

  const handleAddSelectedReviewActions = async () => {
    const toAdd = reviewActions.filter(a => a.selected && !a.added);
    for (const ra of toAdd) await handleAddReviewAction(ra.id);
  };

  const EXCLUDED_FOLDERS = ['archive', 'evidence', 'photos', '_doc_converted_tmp'];
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

  const resolveDueDate = (dueDate: string | null, dueDateRelative: string | null, assessmentDate: string | null): string | null => {
    if (dueDate) return dueDate;
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
  const handleAiSync = async (site: Site, forceAll = false) => {
    if (!site.datto_folder_id) return;
    aiCancelledRef.current = false;
    setAiSyncing(true);
    setAiError(null);
    setAiStatusMessage('');
    setReviewActions([]);
    setShowAiPanel(true);
    try {
      // Trigger server-side Datto existence check — removes advisor docs deleted from Datto + their actions
      await fetch(`/api/documents?siteId=${site.id}&clientProvided=false`);
      // Re-fetch allActions so duplicate detection uses current DB state, not stale mount-time state
      const priorityMap: Record<string, Priority> = { critical: 'red', upcoming: 'amber', scheduled: 'green', red: 'red', amber: 'amber', green: 'green' };
      const siteIds = sites.map(s => s.id);
      const { data: freshActionsData } = await supabase.from('actions').select('*').in('site_id', siteIds);
      const currentActions: Action[] = freshActionsData ? freshActionsData.map((a: any) => ({ id: a.id, action: a.title, description: a.description || '', date: a.due_date || '', site: sites.find(s => s.id === a.site_id)?.name || '', who: a.responsible_person || '', contractor: a.contractor || '', source: a.source_document_name || '', source_document_id: a.source_document_id || '', priority: (priorityMap[a.priority] || 'green') as Priority, regulation: a.regulation || '', notes: '', status: a.status as ActionStatus, hazardRef: a.hazard_ref || null, hazard: a.hazard || null, existingControls: a.existing_controls || null, riskRating: a.risk_rating || null, riskLevel: a.risk_level || null, resolvedDate: a.resolved_date || null, sourceFolderId: a.source_folder_id || null, isSuggested: a.is_suggested ?? false })) : allActions;
      setAllActions(currentActions);
      setAiSyncProgress('Scanning folders…');
      const rootPath = await resolvePathFromRoot(site);
      const includedFolderIds = site.included_datto_folder_ids;
      let allItems;
      if (includedFolderIds && includedFolderIds.length > 0) {
        // Opt-in mode: fetch files only from explicitly selected folders
        const perFolder = await Promise.all(includedFolderIds.map(async (fId) => {
          try {
            const res = await fetch(`/api/datto?folderId=${fId}`);
            if (!res.ok) return [];
            const raw = await res.json();
            return normaliseItems(raw)
              .filter((i: DattoItem) => i.type === 'file')
              .map((i: DattoItem) => ({ ...i, parentFolderId: fId, folderPath: rootPath }));
          } catch { return []; }
        }));
        allItems = perFolder.flat();
      } else {
        // Fallback: old exclusion model
        const userExcludedIds = new Set(site.excluded_datto_folder_ids ?? []);
        allItems = await fetchAllFiles(site.datto_folder_id, userExcludedIds, rootPath);
      }
      const SUPPORTED_EXTS = ['.docx', '.doc', '.pdf', '.xlsx', '.xls'];
      let docxFiles = allItems.filter(i => SUPPORTED_EXTS.some(ext => i.name.toLowerCase().endsWith(ext)));

      // Deduplicate: if both a PDF and an Office doc share the same base name, keep the Office doc
      const OFFICE_EXTS = new Set(['.docx', '.doc', '.xlsx', '.xls']);
      const stemMap = new Map<string, typeof docxFiles[0]>();
      for (const f of docxFiles) {
        const stem = f.name.toLowerCase().replace(/\.[^.]+$/, '');
        const ext = (f.name.toLowerCase().match(/\.[^.]+$/) ?? [''])[0];
        const prev = stemMap.get(stem);
        if (!prev) {
          stemMap.set(stem, f);
        } else {
          const prevIsOffice = OFFICE_EXTS.has((prev.name.toLowerCase().match(/\.[^.]+$/) ?? [''])[0]);
          if (!prevIsOffice && OFFICE_EXTS.has(ext)) stemMap.set(stem, f);
        }
      }
      docxFiles = Array.from(stemMap.values());

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
      if (docxFiles.length === 0) {
        setAiStatusMessage(site.last_ai_sync && !forceAll ? 'No new documents since last sync. Use "Sync all" to reprocess everything.' : 'No supported documents found in this folder.');
        return;
      }
      const processDoc = async (i: number) => {
        if (aiCancelledRef.current) return;
        const doc = docxFiles[i];
        setAiSyncProgress(`Processing ${i + 1}/${docxFiles.length}: ${doc.name}`);
        try {
          const fileRes = await fetch(`/api/datto/file?fileId=${doc.id}&fileName=${encodeURIComponent(doc.name)}`);
          if (!fileRes.ok) throw new Error(`Failed to fetch ${doc.name}`);
          const buffer = await fileRes.arrayBuffer();
          const ext = doc.name.split('.').pop()?.toLowerCase() || '';

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
              // Truncate if too large for Gemini (~375K token safe ceiling, accounting for HTML tag overhead)
              const MAX_HTML_CHARS = 1_500_000;
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
            throw new Error(`.doc format not supported — please open in Word and Save As .docx`);
          } else if (ext === 'xlsx' || ext === 'xls') {
            const workbook = XLSX.read(buffer);
            const text = workbook.SheetNames.map(name =>
              `Sheet: ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`
            ).join('\n\n');
            aiBody = { text, docName: doc.name };
          } else if (ext === 'pdf') {
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let b = 0; b < bytes.byteLength; b++) binary += String.fromCharCode(bytes[b]);
            const base64 = btoa(binary);
            if (base64.length > 5_000_000) {
              throw new Error('Document too large for AI extraction (PDF exceeds size limit) — consider splitting it or converting to DOCX');
            }
            aiBody = { fileBase64: base64, mimeType: 'application/pdf', docName: doc.name };
          } else {
            throw new Error(`Unsupported file type: .${ext}`);
          }

          const aiRes = await fetch('/api/ai-extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(aiBody),
          });
          if (!aiRes.ok) {
            const errBody = await aiRes.json().catch(() => ({}));
            throw new Error(`AI extraction failed for ${doc.name}: ${errBody.error || aiRes.statusText}`);
          }
          const { actions, documentMeta } = await aiRes.json();
          console.log(`[AI-SYNC] ${doc.name} — Gemini returned ${(actions as ExtractedAction[]).length} actions:`);
          (actions as ExtractedAction[]).forEach((a: ExtractedAction, i: number) => console.log(`  [${i}] hazardRef=${a.hazardRef ?? 'null'} | "${a.description}"`));
          // For DOCX: read action plan table to enrich AI actions with hazardRefs + two-way sync
          type ReadRow = { hazardRef: string; actionText: string; responsiblePerson: string; targetDate: string; completedDate: string };
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
          console.log(`[AI-SYNC] ${doc.name} — readactions returned ${readRows.length} rows:`, readRows.map(r => `${r.hazardRef}:"${r.actionText}"`));

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

          const newActions: ReviewAction[] = (actions as ExtractedAction[]).map((a: ExtractedAction) => {
            const parsedH = a.hazardRef ? parsedHazardMap.get(String(a.hazardRef)) : undefined;
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
              return currentActions.some(e => {
                if (e.site !== site.name || e.source_document_id !== doc.id) return false;
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

          // Update hazard/existing controls from AI extraction for already-existing actions
          for (const na of newActions.filter(n => n.added)) {
            const existingAction = currentActions.find(existing =>
              existing.source_document_id === doc.id && existing.hazardRef === na.hazardRef
            );
            if (!existingAction) continue;
            const aiUpdates: Record<string, any> = {};
            // na.hazard/existingControls is now HTML from document parser; always update plain text, never downgrade HTML to plain text
            const existingHazardIsHtml = existingAction.hazard?.trimStart().startsWith('<');
            const existingControlsIsHtml = existingAction.existingControls?.trimStart().startsWith('<');
            const newHazardIsHtml = na.hazard?.trimStart().startsWith('<');
            const newControlsIsHtml = na.existingControls?.trimStart().startsWith('<');
            if (na.hazard && na.hazard !== existingAction.hazard && (!existingHazardIsHtml || newHazardIsHtml)) aiUpdates.hazard = na.hazard;
            if (na.existingControls && na.existingControls !== existingAction.existingControls && (!existingControlsIsHtml || newControlsIsHtml)) aiUpdates.existing_controls = na.existingControls;
            if (na.riskRating && na.riskRating !== existingAction.riskRating) aiUpdates.risk_rating = na.riskRating;
            if (na.riskLevel && na.riskLevel !== existingAction.riskLevel) aiUpdates.risk_level = na.riskLevel;
            if (na.docFolderPath && na.docFolderPath !== existingAction.sourceFolderPath) aiUpdates.source_folder_path = na.docFolderPath;
            if (na.documentMeta?.assessmentDate && na.documentMeta.assessmentDate !== existingAction.issueDate) aiUpdates.issue_date = na.documentMeta.assessmentDate;
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

          // Two-way sync: update existing portal actions from action plan table
          if (readRows.length > 0) {
            const docActions = currentActions.filter((a: Action) => a.source_document_id === doc.id);
            for (const docAction of docActions) {
              if (!docAction.hazardRef) continue;
              const docRow = readRows.find(r => String(r.hazardRef).trim() === String(docAction.hazardRef).trim());
              if (!docRow) continue;
              const updates: Partial<Action> = {};
              const supaUpdates: Record<string, any> = {};
              if (docRow.actionText && docRow.actionText !== docAction.action) { updates.action = docRow.actionText; supaUpdates.title = docRow.actionText; }
              if (docRow.responsiblePerson && docRow.responsiblePerson !== docAction.who) { updates.who = docRow.responsiblePerson; supaUpdates.responsible_person = docRow.responsiblePerson; }
              if (docRow.targetDate) {
                const resolvedTarget = /^\d{4}-\d{2}-\d{2}$/.test(docRow.targetDate)
                  ? docRow.targetDate
                  : resolveDueDate(null, docRow.targetDate, documentMeta?.assessmentDate ?? docAction.issueDate ?? null);
                if (resolvedTarget && resolvedTarget !== docAction.date) { updates.date = resolvedTarget; supaUpdates.due_date = resolvedTarget; }
              }
              if (docRow.completedDate && !docAction.resolvedDate) { updates.resolvedDate = docRow.completedDate; updates.status = 'resolved'; supaUpdates.resolved_date = docRow.completedDate; supaUpdates.status = 'resolved'; }
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

  const viewSites = filterOrgId ? sites.filter(s => s.organisation_id === filterOrgId) : sites;
  const viewActions = allActions.filter(a => viewSites.some(s => s.name === a.site));
  const siteActions = selectedSite ? allActions.filter(a => a.site === selectedSite.name) : allActions;
  const isActionResolved = (a: Action) => resolvedIds.includes(a.id) || a.status === 'resolved';
  const filteredActions = (
    filterPriority === 'all' ? siteActions.filter(a => !isActionResolved(a)) :
    filterPriority === 'resolved' ? siteActions.filter(a => isActionResolved(a)) :
    siteActions.filter(a => !isActionResolved(a) && derivePriority(a).priority === filterPriority)
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
      const aHasDate = !!a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date);
      const bHasDate = !!b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date);
      if (aHasDate && bHasDate) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      if (aHasDate) return -1;
      if (bHasDate) return 1;
      return (a.updatedAt || '') < (b.updatedAt || '') ? -1 : 1;
    });
  // Group filteredActions by source document
  const docGroupMap = new Map<string, typeof filteredActions>();
  for (const a of filteredActions) {
    const key = a.source || 'Unknown Document';
    if (!docGroupMap.has(key)) docGroupMap.set(key, []);
    docGroupMap.get(key)!.push(a);
  }
  const docGroups = Array.from(docGroupMap.entries())
    .map(([source, actions]) => ({
      source,
      displayName: source.replace(/\.[^.]+$/, ''),
      actions,
      hasRed: actions.some(a => derivePriority(a).priority === 'red'),
      hasAmber: actions.some(a => derivePriority(a).priority === 'amber'),
      redCount: actions.filter(a => derivePriority(a).priority === 'red').length,
      amberCount: actions.filter(a => derivePriority(a).priority === 'amber').length,
      highRiskCount: actions.filter(a => a.riskLevel === 'HIGH').length,
    }))
    .sort((a, b) => {
      if (a.hasRed !== b.hasRed) return a.hasRed ? -1 : 1;
      if (a.hasAmber !== b.hasAmber) return a.hasAmber ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
  const toggleDocGroup = (source: string) => {
    setExpandedDocGroups(prev => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source); else next.add(source);
      return next;
    });
  };

  const openActions = siteActions.filter(a => !isActionResolved(a));
  const openCount = openActions.length;
  const resolvedCount = siteActions.filter(a => isActionResolved(a)).length;
  const filterCounts: Record<string, number> = {
    all:      openCount,
    red:      openActions.filter(a => derivePriority(a).priority === 'red').length,
    amber:    openActions.filter(a => derivePriority(a).priority === 'amber').length,
    green:    openActions.filter(a => derivePriority(a).priority === 'green').length,
    resolved: resolvedCount,
  };
  const criticalCount = viewActions.filter(a => derivePriority(a).priority === 'red').length;
  const upcomingCount = viewActions.filter(a => derivePriority(a).priority === 'amber').length;

  if (authLoading) return <div className="min-h-screen bg-indigo-950 flex items-center justify-center"><div className="text-indigo-300 font-black text-sm uppercase tracking-widest animate-pulse">Loading…</div></div>;
  if (!user) return <LoginScreen onLogin={() => {}} />;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-indigo-100">
      <aside className="fixed left-0 top-0 h-full w-20 bg-indigo-950 flex flex-col items-center py-8 gap-10 text-indigo-300 z-20">
        <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-indigo-950 shadow-lg font-black text-xl italic hover:scale-105 transition-transform">MB</div>
        <nav className="flex flex-col gap-6">
          {profile?.role === 'superadmin' && <button onClick={() => setView('admin')} className={`p-3 rounded-xl transition-all ${view === 'admin' ? 'bg-indigo-700 text-white shadow-inner' : 'hover:text-white hover:bg-white/5'}`} title="Admin Panel"><Shield size={22} /></button>}
          {profile?.role === 'advisor' && <button onClick={() => { setView('portfolio'); setSelectedSite(null); }} className={`p-3 rounded-xl transition-all ${view === 'portfolio' ? 'bg-indigo-700 text-white shadow-inner' : 'hover:text-white hover:bg-white/5'}`} title="Portfolio Dashboard"><Layout size={22} /></button>}
          {(profile?.role === 'advisor' || profile?.role === 'client') && <button onClick={() => { setView('site'); if (sites.length > 0 && !selectedSite) setSelectedSite(sites[0]); }} className={`p-3 rounded-xl transition-all ${view === 'site' ? 'bg-indigo-700 text-white shadow-inner' : 'hover:text-white hover:bg-white/5'}`} title="Action Plans"><ClipboardList size={22} /></button>}
          <button className="p-3 rounded-xl hover:text-white hover:bg-white/5" title="Settings"><Settings size={22} /></button>
        </nav>
        <div className="mt-auto flex flex-col gap-5 items-center">
          {profile?.role === 'advisor' && <button onClick={handleDattoSync} className={`p-3 rounded-xl transition-all ${isSyncing ? 'text-white animate-spin' : 'hover:text-white hover:bg-white/5'}`} title="Sync"><RefreshCw size={22} /></button>}
          <button onClick={handleLogout} className="p-3 rounded-xl hover:text-white hover:bg-white/5" title="Sign out"><LogOut size={22} /></button>
          <div className="w-10 h-10 rounded-full bg-indigo-800 flex items-center justify-center font-black text-white text-xs border border-indigo-700">{user.email?.substring(0, 2).toUpperCase()}</div>
        </div>
      </aside>

      <main className="pl-20">
        <header className="bg-white/95 backdrop-blur-sm border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            {view === 'site' && profile?.role === 'advisor' && <button onClick={() => setView('portfolio')} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400"><ArrowLeft size={18} /></button>}
            <div>
              <h1 className="text-base font-black text-slate-900 tracking-tight leading-none">McCormack Benson H&S</h1>
              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1"><Database size={9} /><span>Portal Sync: {syncLastRun}</span></div>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right hidden sm:block"><p className="text-xs font-black text-slate-800">{user.email}</p><p className="text-[10px] text-indigo-600 font-bold uppercase tracking-widest">● {profile?.role}</p></div>
            {profile?.role === 'advisor' && (
              <div className="hidden lg:flex bg-slate-100 p-1 rounded-xl">
                <button onClick={() => { setView('portfolio'); setSelectedSite(null); }} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${view === 'portfolio' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>Dashboard</button>
                <button onClick={() => { setView('site'); if (sites.length > 0 && !selectedSite) setSelectedSite(sites[0]); }} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${view === 'site' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>Action Plan</button>
              </div>
            )}
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {view === 'admin' && profile?.role === 'superadmin' && <SuperadminPanel />}

          {view === 'portfolio' && profile?.role === 'advisor' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 rounded-3xl p-10 text-white flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500 rounded-full -mr-32 -mt-32 blur-[100px] opacity-20 pointer-events-none" />
                <div className="relative z-10"><span className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-300">Executive Summary</span><h2 className="text-4xl font-black tracking-tighter mt-2">Divisional Compliance</h2><p className="text-indigo-300 mt-2 max-w-md text-sm">Real-time H&S status across all sites.</p></div>
                <div className="flex gap-4 relative z-10">
                  {[{ label: 'Overdue', value: criticalCount, color: 'text-rose-400', icon: <Zap size={14} /> }, { label: 'Upcoming', value: upcomingCount, color: 'text-amber-400', icon: <Clock size={14} /> }, { label: 'Sites', value: viewSites.length, color: 'text-indigo-300', icon: <Building2 size={14} /> }].map(stat => (
                    <div key={stat.label} className="bg-white/5 backdrop-blur-md rounded-2xl p-5 border border-white/10 text-center min-w-[90px]">
                      <div className={`flex items-center justify-center gap-1 text-[10px] font-black uppercase tracking-widest opacity-70 mb-1.5 ${stat.color}`}>{stat.icon}{stat.label}</div>
                      <p className={`text-4xl font-black ${stat.color}`}>{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              {/* Org / site filter bar */}
              <div className="flex items-center gap-3 flex-wrap">
                {organisations.length > 1 && (
                  <select value={filterOrgId} onChange={e => { setFilterOrgId(e.target.value); }} className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 focus:outline-none bg-white">
                    <option value="">All Organisations</option>
                    {organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                )}
                {filterOrgId && <button onClick={() => setFilterOrgId('')} className="text-xs font-bold text-indigo-500 hover:text-indigo-700 flex items-center gap-1"><X size={12} />Clear filter</button>}
              </div>
              <div className="flex border-b border-slate-200 gap-6">
                {[{ key: 'analytics', label: 'Visual Analytics', icon: <BarChart3 size={14} /> }, { key: 'data', label: 'Division Registry', icon: <Building2 size={14} /> }].map(tab => (
                  <button key={tab.key} onClick={() => setDashboardTab(tab.key as 'analytics' | 'data')} className={`pb-4 px-1 text-[11px] font-black uppercase tracking-widest flex items-center gap-2 border-b-2 transition-all ${dashboardTab === tab.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>{tab.icon}{tab.label}</button>
                ))}
              </div>
              {dashboardTab === 'analytics' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                    <h3 className="font-black text-slate-900 text-lg tracking-tight uppercase mb-8">Compliance Benchmarking</h3>
                    <div className="space-y-6">
                      {viewSites.map(site => (
                        <div key={site.id} className="group cursor-pointer" onClick={() => handleSiteClick(site)}>
                          <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-3"><div className="w-7 h-7 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all text-xs">{getSiteIcon(site.type, 14)}</div><span className="text-sm font-bold text-slate-700 group-hover:text-indigo-700">{site.name}</span></div>
                            <div className="flex items-center gap-3"><span className={`text-[10px] font-black flex items-center gap-1 ${site.trend >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{site.trend >= 0 ? <TrendingUp size={11} /> : <ArrowUpRight size={11} className="rotate-90" />}{site.trend >= 0 ? '+' : ''}{site.trend}%</span><span className={`font-black text-sm ${scoreColor(site.compliance).text}`}>{site.compliance}%</span></div>
                          </div>
                          <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden shadow-inner"><div className={`h-full rounded-full transition-all duration-1000 ${scoreColor(site.compliance).bar}`} style={{ width: `${site.compliance}%` }} /></div>
                        </div>
                      ))}
                      {viewSites.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No sites assigned yet.</p>}
                    </div>
                  </div>
                  <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm flex flex-col">
                    <h3 className="font-black text-slate-900 text-lg tracking-tight uppercase mb-6">Action Summary</h3>
                    <div className="flex-1 flex flex-col justify-center items-center">
                      <div className="relative w-36 h-36 flex items-center justify-center mb-6">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 160 160"><circle cx="80" cy="80" r="70" stroke="#f1f5f9" strokeWidth="16" fill="none" /><circle cx="80" cy="80" r="70" stroke="#f43f5e" strokeWidth="16" fill="none" strokeDasharray="440" strokeDashoffset="418" strokeLinecap="round" /></svg>
                        <div className="absolute text-center"><p className="text-3xl font-black text-slate-900 leading-none">{viewActions.length}</p><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Total</p></div>
                      </div>
                      <div className="w-full space-y-2.5">
                        {[{ label: 'Overdue', count: criticalCount, color: 'bg-rose-50 text-rose-700 border-rose-100' }, { label: 'Upcoming / Review Due', count: upcomingCount, color: 'bg-amber-50 text-amber-700 border-amber-100' }, { label: 'Scheduled / Review', count: viewActions.filter(a => derivePriority(a).priority === 'green').length, color: 'bg-emerald-50 text-emerald-700 border-emerald-100' }].map(item => (
                          <div key={item.label} className={`flex items-center justify-between text-xs font-black px-4 py-2.5 rounded-xl border ${item.color}`}><span>{item.label}</span><span className="text-base font-black">{item.count}</span></div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                    {viewSites.map(site => (
                      <div key={site.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all group" onClick={() => handleSiteClick(site)}>
                        <div className="flex items-start justify-between mb-4"><div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all">{getSiteIcon(site.type)}</div><ComplianceRing score={site.compliance} /></div>
                        <p className="font-black text-sm text-slate-800 leading-tight mb-1">{site.name}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">{site.type}</p>
                        <div className="space-y-1.5">
                          {[
                            { label: 'Actions', val: site.actionProgress ?? 100 },
                            { label: 'Alignment', val: site.iagScore ?? null },
                            { label: 'Documents', val: site.compliance },
                          ].map(({ label, val }) => (
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
                    ))}
                  </div>
                </div>
              )}
              {dashboardTab === 'data' && (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                  <table className="w-full text-left">
                    <thead><tr className="bg-slate-50/80 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-8 py-4">Site</th><th className="px-8 py-4">Type</th><th className="px-8 py-4">Score</th><th className="px-8 py-4">Last Review</th><th className="px-8 py-4"></th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {viewSites.map(site => (
                        <tr key={site.id} className="hover:bg-indigo-50/30 cursor-pointer group" onClick={() => handleSiteClick(site)}>
                          <td className="px-8 py-5"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm">{getSiteIcon(site.type)}</div><span className="font-bold text-slate-800">{site.name}</span></div></td>
                          <td className="px-8 py-5"><span className="text-[11px] font-black uppercase tracking-wider text-slate-500 bg-slate-50 border border-slate-100 px-3 py-1 rounded-lg">{site.type}</span></td>
                          <td className="px-8 py-5"><ComplianceRing score={site.compliance} size={40} /></td>
                          <td className="px-8 py-5 text-sm font-bold text-slate-600">{site.lastReview}</td>
                          <td className="px-8 py-5 text-right"><ChevronRight size={16} className="text-slate-300 inline group-hover:translate-x-1 transition-transform" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {view === 'site' && selectedSite && (
            <div className="space-y-6 animate-in slide-in-from-right-8 duration-400">
              <div className="bg-white border border-slate-200 p-8 rounded-3xl shadow-sm relative overflow-hidden border-l-[8px] border-l-indigo-600">
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-50/40 to-transparent pointer-events-none" />
                <div className="relative flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl">{getSiteIcon(selectedSite.type, 28)}</div>
                    <div><h2 className="text-2xl font-black text-slate-900 tracking-tight">{selectedSite.name}</h2><p className="text-slate-500 text-sm mt-1">Last audit: {selectedSite.lastReview} · {selectedSite.type}</p></div>
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <button className="bg-slate-100 text-slate-600 px-6 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-slate-200">Audit Archive</button>
                    {profile?.role === 'superadmin' && selectedSite.datto_folder_id && (
                      <button
                        onClick={() => setShowSyncConfig(true)}
                        className="flex items-center gap-2 bg-white border border-violet-200 text-violet-700 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-violet-50"
                        title="Choose which folders to include in AI Sync"
                      >
                        <Settings size={13} />Configure Sync
                        {(selectedSite.excluded_datto_folder_ids?.length ?? 0) > 0 && (
                          <span className="bg-violet-100 text-violet-700 text-[10px] font-black px-1.5 py-0.5 rounded-full">{selectedSite.excluded_datto_folder_ids.length}</span>
                        )}
                      </button>
                    )}
                    {profile?.role === 'advisor' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleAiSync(selectedSite)}
                          disabled={aiSyncing || !selectedSite.datto_folder_id}
                          title={!selectedSite.datto_folder_id ? 'No Datto folder configured' : 'Sync new/modified documents only'}
                          className="flex items-center gap-2 bg-violet-600 text-white px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest shadow-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Sparkles className="w-4 h-4" />
                          {aiSyncing ? 'Syncing…' : 'AI Sync'}
                        </button>
                        <button
                          onClick={() => handleForceAiSync(selectedSite)}
                          disabled={aiSyncing || !selectedSite.datto_folder_id}
                          title={!selectedSite.datto_folder_id ? 'No Datto folder configured' : 'Reprocess all documents regardless of date'}
                          className="flex items-center gap-2 bg-violet-500 text-white px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest shadow-lg hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Sync All
                        </button>
                      </div>
                    )}
                    <button className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest shadow-lg hover:bg-indigo-700">Export Plan</button>
                  </div>
                </div>
              </div>
              {/* Org / site filter bar */}
              <div className="flex items-center gap-3 flex-wrap">
                {organisations.length > 1 && (
                  <select value={filterOrgId} onChange={e => { setFilterOrgId(e.target.value); const first = sites.find(s => !e.target.value || s.organisation_id === e.target.value); if (first) setSelectedSite(first); }} className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 focus:outline-none bg-white">
                    <option value="">All Organisations</option>
                    {organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                )}
                {viewSites.length > 1 && (
                  <select value={selectedSite?.id || ''} onChange={e => { const s = sites.find(s => s.id === e.target.value); if (s) setSelectedSite(s); }} className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 focus:outline-none bg-white">
                    {viewSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </div>
              {/* ── Score cards ── */}
              <div className="space-y-4">
                {/* Row 1 — Actions Score (full width, prominent) */}
                {(() => { const s = computeActionProgress(allActions.filter(a => a.site === selectedSite.name)); const c = scoreColor(s); return (
                  <div className="bg-white rounded-2xl border border-slate-200 px-8 py-6 shadow-sm relative flex items-center justify-center gap-10 cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all" onClick={() => setSiteTab('actions')}>
                    <button onClick={() => setScoreExplanationCard('implementation')} className="absolute top-3 right-3 flex items-center gap-1 text-slate-300 hover:text-indigo-500 transition-colors" title="How is this calculated?"><AlertCircle size={14} /><span className="text-[9px] font-black uppercase tracking-wider">Help</span></button>
                    <ComplianceRing score={s} size={96} />
                    <div className="text-center">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Actions Score</p>
                      <p className={`text-5xl font-black ${c.text}`}>{s}%</p>
                      <p className="text-[11px] text-slate-400 font-medium mt-2">client managed</p>
                    </div>
                  </div>
                ); })()}
                {/* Row 2 — IAG + Documentation Health (advisor/superadmin only) */}
                <div className={`grid gap-4 ${profile?.role !== 'client' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {/* Industry Alignment */}
                  {(() => {
                    const raw = selectedSite.iagScore;
                    const s = raw ?? 0;
                    const c = scoreColor(s);
                    return (
                      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm text-center relative cursor-pointer hover:border-violet-300 hover:shadow-md transition-all" onClick={() => { setSiteTab('iag'); loadIagServices(selectedSite.id); }}>
                        <button onClick={e => { e.stopPropagation(); setScoreExplanationCard('iag'); }} className="absolute top-3 right-3 flex items-center gap-1 text-slate-300 hover:text-violet-500 transition-colors" title="How is this calculated?"><AlertCircle size={14} /><span className="text-[9px] font-black uppercase tracking-wider">Help</span></button>
                        <div className="flex items-center justify-center gap-4">
                          {raw !== null && <ComplianceRing score={s} size={64} />}
                          <div className="text-center">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Industry Alignment</p>
                            {raw === null
                              ? <p className="text-xl font-black text-slate-300">Not set</p>
                              : <p className={`text-3xl font-black ${c.text}`}>{s}%</p>
                            }
                            <p className="text-[10px] text-slate-400 font-medium mt-1">coverage vs requirements</p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {/* Documentation Health — advisor/superadmin only */}
                  {profile?.role !== 'client' && (() => { const s = selectedSite.compliance; const c = scoreColor(s); return (
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm text-center relative cursor-pointer hover:border-amber-300 hover:shadow-md transition-all" onClick={() => setSiteTab('dochealth')}>
                      <button onClick={e => { e.stopPropagation(); setScoreExplanationCard('documentation'); }} className="absolute top-3 right-3 flex items-center gap-1 text-slate-300 hover:text-amber-500 transition-colors" title="How is this calculated?"><AlertCircle size={14} /><span className="text-[9px] font-black uppercase tracking-wider">Help</span></button>
                      <div className="flex items-center justify-center gap-4">
                        <ComplianceRing score={s} size={64} />
                        <div className="text-center">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Documentation Health</p>
                          <p className={`text-3xl font-black ${c.text}`}>{s}%</p>
                          <p className="text-[10px] text-slate-400 font-medium mt-1">advisor managed</p>
                        </div>
                      </div>
                    </div>
                  ); })()}
                </div>
              </div>
              {scoreExplanationCard && <ScoreExplanationModal card={scoreExplanationCard} onClose={() => setScoreExplanationCard(null)} />}
              {/* Site tab toggle */}
              <div className="flex bg-slate-100 p-1 rounded-xl w-fit flex-wrap gap-0.5">
                <button onClick={() => setSiteTab('actions')} className={`px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${siteTab === 'actions' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>Client Actions</button>
                <button onClick={() => setSiteTab('documents')} className={`px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${siteTab === 'documents' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-400 hover:text-slate-600'}`}>Client Managed</button>
                {profile?.role !== 'client' && <button onClick={() => setSiteTab('dochealth')} className={`px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${siteTab === 'dochealth' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-400 hover:text-slate-600'}`}>Advisor Actions</button>}
                {profile?.role !== 'client' && <button onClick={() => { setSiteTab('iag'); loadIagServices(selectedSite.id); }} className={`px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${siteTab === 'iag' ? 'bg-white shadow-sm text-violet-600' : 'text-slate-400 hover:text-slate-600'}`}>Industry Alignment</button>}
                {selectedSite.datto_folder_id && <button onClick={() => setSiteTab('files')} className={`px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${siteTab === 'files' ? 'bg-white shadow-sm text-sky-600' : 'text-slate-400 hover:text-slate-600'}`}>Files</button>}
              </div>

              {siteTab === 'actions' && (<>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {(['all', 'red', 'amber', 'green', 'resolved'] as const).map(f => (
                    <button key={f} onClick={() => setFilterPriority(f)} className={`px-3 py-2 text-[11px] font-black uppercase tracking-wider transition-colors whitespace-nowrap ${
                      f === 'all'      ? filterPriority === f ? 'text-slate-800 underline underline-offset-4 decoration-2' : 'text-slate-400 hover:text-slate-600'
                    : f === 'red'      ? filterPriority === f ? 'text-rose-600 underline underline-offset-4 decoration-2'   : 'text-rose-400 hover:text-rose-600'
                    : f === 'amber'    ? filterPriority === f ? 'text-amber-600 underline underline-offset-4 decoration-2' : 'text-amber-400 hover:text-amber-600'
                    : f === 'green'    ? filterPriority === f ? 'text-emerald-600 underline underline-offset-4 decoration-2' : 'text-emerald-400 hover:text-emerald-600'
                    :                   filterPriority === f ? 'text-slate-600 underline underline-offset-4 decoration-2' : 'text-slate-400 hover:text-slate-600'
                    }`}>
                      {f === 'all' ? 'All' : f === 'red' ? 'Overdue' : f === 'amber' ? 'Upcoming / Review Due' : f === 'green' ? 'Scheduled / Review' : 'Resolved'} ({filterCounts[f] ?? 0})
                    </button>
                  ))}
                  <span className="ml-3 text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg whitespace-nowrap">{openCount} open · {resolvedCount} resolved</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] font-bold text-slate-400">{filteredActions.length} action{filteredActions.length !== 1 ? 's' : ''}</span>
                  {profile?.role === 'advisor' && <button onClick={() => setShowAddAction(true)} className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700 shadow-sm"><Plus size={13} />Add Action</button>}
                </div>
              </div>
              {showAddAction && selectedSite && <AddActionForm site={selectedSite} onSave={handleActionSaved} onCancel={() => setShowAddAction(false)} />}

              {/* ── AI Review Panel ── */}
              {showAiPanel && (
                <div className="bg-white border border-violet-200 rounded-2xl overflow-hidden shadow-lg">
                  <div className="bg-violet-600 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Sparkles className="w-4 h-4 text-violet-200" />
                      <h3 className="font-black text-white uppercase tracking-widest text-sm">AI Extracted Actions</h3>
                      {aiSyncing && <span className="text-violet-200 text-xs font-bold animate-pulse">{aiSyncProgress}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      {!aiSyncing && (
                        <button onClick={() => handleForceAiSync(selectedSite)} title="Reprocess all docs regardless of date" className="px-4 py-2 bg-violet-500 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-400">Sync all</button>
                      )}
                      {!aiSyncing && reviewActions.some(a => a.selected && !a.added) && (
                        <button onClick={handleAddSelectedReviewActions} className="px-4 py-2 bg-white text-violet-700 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-violet-50">Add Selected</button>
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
                    <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                      {reviewActions.filter(a => a.isError).map(ra => (
                        <div key={ra.id} className="px-5 py-2.5 bg-rose-50 border-b border-rose-100 text-[11px] font-bold text-rose-600 flex items-center gap-1.5">
                          <AlertCircle size={11} className="text-rose-500 flex-shrink-0" />
                          <span><span className="text-rose-700">{ra.docName}</span> could not be processed. <span className="font-normal text-rose-400">{ra.errorMessage}</span></span>
                        </div>
                      ))}
                      {(() => {
                        const addedActions = reviewActions.filter(a => a.added);
                        if (addedActions.length === 0) return null;
                        const addedDocs = Array.from(new Map(addedActions.map(a => [a.docFileId, a.docName])).entries());
                        return (
                          <div className="border-b border-slate-100">
                            {addedDocs.map(([docFileId, docName]) => {
                              const count = addedActions.filter(a => a.docFileId === docFileId).length;
                              return (
                                <div key={docFileId} className="px-5 py-2 bg-slate-50 flex items-center gap-2">
                                  <CheckCircle size={11} className="text-green-500 flex-shrink-0" />
                                  <span className="text-[11px] font-black text-slate-500 truncate">{docName}</span>
                                  <span className="ml-auto text-[10px] font-bold text-slate-400 flex-shrink-0">{count} already added</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      {(() => {
                        const newActions = [...reviewActions].filter(ra => !ra.added && !ra.isError);
                        const docGroups = Array.from(new Map(newActions.map(ra => [ra.docFileId, { docName: ra.docName, docFileId: ra.docFileId }])).values());
                        return docGroups.map(({ docName, docFileId }) => (
                          <div key={docFileId}>
                            <div className="px-5 py-2 bg-slate-100/80 border-b border-slate-200 flex items-center gap-2">
                              <FileText size={11} className="text-violet-400 flex-shrink-0" />
                              <span className="text-[11px] font-black text-slate-600 truncate">{docName}</span>
                              <span className="ml-auto text-[10px] font-bold text-slate-400 flex-shrink-0">{newActions.filter(ra => ra.docFileId === docFileId).length} action{newActions.filter(ra => ra.docFileId === docFileId).length !== 1 ? 's' : ''}</span>
                            </div>
                            {newActions.filter(ra => ra.docFileId === docFileId).map(ra => (
                        <div key={ra.id} className={`p-5 flex gap-4 items-start transition-colors hover:bg-slate-50`}>
                          <input type="checkbox" checked={ra.selected} onChange={e => setReviewActions(prev => prev.map(a => a.id === ra.id ? { ...a, selected: e.target.checked } : a))} disabled={ra.added} className="mt-1 w-4 h-4 accent-violet-600 flex-shrink-0" />
                          <div className="flex-1 min-w-0 space-y-2">
                            {/* Document meta */}
                            <div className="space-y-1">
                              {ra.hazardRef && <p className="text-[11px] font-black text-violet-500">Hazard No: {ra.hazardRef}</p>}
                              {ra.documentMeta && (
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-bold text-slate-400">
                                  {ra.documentMeta.assessmentDate && <span>Assessment date: {ra.documentMeta.assessmentDate}</span>}
                                  {ra.documentMeta.reviewDate && <span>· Reviewed: {ra.documentMeta.reviewDate}</span>}
                                </div>
                              )}
                            </div>
                            {/* Hazard & existing measures */}
                            {(ra.hazard || ra.existingControls) && (
                              <div className="space-y-2 pl-1">
                                {ra.hazard && (
                                  <div>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-0.5">{ra.hazardRef ? `Hazard No. ${ra.hazardRef}` : 'Hazard'}</p>
                                    {formatExtractedText(ra.hazard)}
                                  </div>
                                )}
                                {ra.existingControls && (
                                  <div>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-600 mb-0.5">Existing Measures</p>
                                    {formatExtractedText(ra.existingControls)}
                                  </div>
                                )}
                              </div>
                            )}
                            {/* Action description */}
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] font-black text-slate-500 pl-1">Action Required{!ra.added && <span className="font-normal text-slate-400"> — editable</span>}</span>
                              <textarea
                                value={ra.description}
                                onChange={e => setReviewActions(prev => prev.map(a => a.id === ra.id ? { ...a, description: e.target.value } : a))}
                                disabled={ra.added}
                                rows={2}
                                className="w-full text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none bg-white disabled:bg-slate-50 disabled:text-slate-500"
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
                                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white disabled:bg-slate-50"
                                />
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
                          <div className="flex-shrink-0">
                            {ra.added ? (
                              <span className="flex items-center gap-1.5 text-[11px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl"><CheckCircle size={12} />Added</span>
                            ) : (
                              <button onClick={() => handleAddReviewAction(ra.id)} className="px-4 py-1.5 bg-violet-600 text-white rounded-xl text-[11px] font-black hover:bg-violet-700">Add</button>
                            )}
                          </div>
                        </div>
                            ))}
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-4">
                {filteredActions.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center"><CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-3" /><p className="font-black text-slate-700">No actions for this site</p><p className="text-sm text-slate-400 mt-1">All items resolved or filtered out.</p></div>
                ) : docGroups.map(({ source, displayName, actions, redCount, amberCount, highRiskCount, hasRed, hasAmber }) => {
                  const isOpen = expandedDocGroups.has(source);
                  return (
                    <div key={source}>
                      <button
                        onClick={() => toggleDocGroup(source)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-indigo-200 transition-colors text-left ${isOpen ? 'bg-indigo-200' : 'bg-indigo-100 hover:bg-indigo-200'}`}
                      >
                        <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                        <span className="font-black text-[12px] text-slate-700 truncate flex-1">{displayName}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {redCount > 0 && <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded-lg bg-rose-100 text-rose-700 border border-rose-200">{redCount} Overdue action{redCount !== 1 ? 's' : ''}</span>}
                          {highRiskCount > 0 && <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded-lg bg-rose-600 text-white border border-rose-700">{highRiskCount} High Risk</span>}
                          {amberCount > 0 && !hasRed && <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700 border border-amber-200">{amberCount} upcoming</span>}
                          {!hasRed && !hasAmber && <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-700 border border-emerald-200">{actions.length} scheduled</span>}
                        </div>
                      </button>
                      {isOpen && (
                        <div className="space-y-3 mt-2 pl-2">
                          {actions.map(action => <ActionCard key={action.id} action={{ ...action, notes: actionNotes[action.id] || action.notes }} isResolved={resolvedIds.includes(action.id) || action.status === 'resolved'} onToggleResolve={toggleResolve} onAddNote={handleAddNote} onDelete={handleDeleteAction} onUpdateIssueDate={handleUpdateIssueDate} role={profile?.role || 'client'} expanded={expandedActionId === action.id} onExpand={() => setExpandedActionId(prev => prev === action.id ? null : action.id)} />)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </>)}

              {siteTab === 'documents' && profile && (
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
              {siteTab === 'dochealth' && profile?.role !== 'client' && (
                <DocHealthTab siteId={selectedSite.id} onComplianceUpdate={(score) => {
                  setSelectedSite(prev => prev ? { ...prev, compliance: score } : prev);
                  setSites(prev => prev.map(s => s.id === selectedSite.id ? { ...s, compliance: score } : s));
                }} />
              )}

              {/* ── Files browser tab ── */}
              {siteTab === 'files' && selectedSite.datto_folder_id && (() => {
                const role = profile?.role || 'client';

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

                const toggleFolder = async (folder: DattoItem, parentPath: string) => {
                  const folderPath = parentPath ? `${parentPath}/${folder.name}` : folder.name;
                  if (expandedFolderIds.has(folder.id)) {
                    setExpandedFolderIds(prev => { const s = new Set(prev); s.delete(folder.id); return s; });
                  } else {
                    setExpandedFolderIds(prev => { const s = new Set(prev); s.add(folder.id); return s; });
                    if (!folderData.has(folder.id)) await loadFolder(folder.id, folderPath);
                  }
                };

                const renderTree = (folderId: string, depth = 0): React.ReactNode => {
                  const entry = folderData.get(folderId);
                  if (!entry) return null;
                  const sorted = [...entry.items].sort((a, b) =>
                    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1
                  );
                  return sorted.map(item => {
                    if (item.type === 'folder') {
                      const isExpanded = expandedFolderIds.has(item.id);
                      const isLoading = loadingFolderIds.has(item.id);
                      return (
                        <div key={item.id}>
                          <button
                            onClick={() => toggleFolder(item, entry.path)}
                            className="w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-50 text-left group transition-colors"
                            style={{ paddingLeft: `${16 + depth * 20}px` }}
                          >
                            <span className={`text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
                              {isLoading ? <span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-sky-500 rounded-full animate-spin" /> : '▶'}
                            </span>
                            <span className="text-slate-400 flex-shrink-0">📁</span>
                            <span className="text-[12px] font-bold text-slate-700 truncate flex-1">{item.name}</span>
                          </button>
                          {isExpanded && renderTree(item.id, depth + 1)}
                        </div>
                      );
                    } else {
                      const badge = fileTypeBadge(item.name);
                      const href = getFileHref(item, entry.path, role);
                      const isOfficeLink = href.startsWith('ms-');
                      return (
                        <a
                          key={item.id}
                          href={href}
                          className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-sky-50 cursor-pointer group block"
                          style={{ paddingLeft: `${36 + depth * 20}px` }}
                          title={isOfficeLink ? 'Open in Word/Excel from mapped drive' : 'Download / open file'}
                        >
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0 ${badge.cls}`}>{badge.label}</span>
                          <span className="text-[12px] text-slate-600 group-hover:text-sky-700 truncate flex-1">{item.name}</span>
                          {item.modified && <span className="text-[10px] text-slate-300 flex-shrink-0">{new Date(item.modified).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</span>}
                        </a>
                      );
                    }
                  });
                };

                const searchResults = fileSearchQuery.trim() && searchFileCache
                  ? searchFileCache.files.filter(f => f.name.toLowerCase().includes(fileSearchQuery.toLowerCase()))
                  : null;

                return (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* Search bar */}
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
                      <Search size={14} className="text-slate-400 flex-shrink-0" />
                      <input
                        type="text"
                        placeholder="Search files…"
                        value={fileSearchQuery}
                        onChange={e => handleSearchChange(e.target.value)}
                        className="flex-1 text-sm text-slate-700 placeholder-slate-300 bg-transparent outline-none"
                      />
                      {searchLoading && <span className="text-[10px] font-bold text-slate-400 animate-pulse">Loading…</span>}
                      {fileSearchQuery && <button onClick={() => setFileSearchQuery('')} className="text-slate-300 hover:text-slate-500"><X size={13} /></button>}
                    </div>

                    {/* Tree or search results */}
                    <div className="divide-y divide-slate-50 py-1 max-h-[60vh] overflow-y-auto">
                      {searchResults !== null ? (
                        searchResults.length === 0 ? (
                          <div className="p-8 text-center text-slate-400 text-sm font-bold">No files match "{fileSearchQuery}"</div>
                        ) : (
                          searchResults.map(file => {
                            const badge = fileTypeBadge(file.name);
                            const href = getFileHref(file, file.folderPath, role);
                            return (
                              <a key={file.id} href={href} className="flex items-center gap-2.5 px-4 py-2 hover:bg-sky-50 cursor-pointer group block">
                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0 ${badge.cls}`}>{badge.label}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[12px] font-bold text-slate-700 group-hover:text-sky-700 truncate">{file.name}</p>
                                  {file.folderPath && <p className="text-[10px] text-slate-400 truncate">{file.folderPath}</p>}
                                </div>
                              </a>
                            );
                          })
                        )
                      ) : loadingFolderIds.has(selectedSite.datto_folder_id!) && !folderData.has(selectedSite.datto_folder_id!) ? (
                        <div className="p-8 text-center text-slate-400 text-sm font-bold animate-pulse">Loading files…</div>
                      ) : (
                        renderTree(selectedSite.datto_folder_id!)
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Industry Alignment tab (advisor only) ── */}
              {siteTab === 'iag' && profile?.role !== 'client' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
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
              )}
            </div>
          )}
        </div>
      </main>
      {showSyncConfig && selectedSite && (
        <SyncConfigModal site={selectedSite} onClose={() => setShowSyncConfig(false)} onSave={handleSaveSyncConfig} />
      )}
    </div>
  );
}