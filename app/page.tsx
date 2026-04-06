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
  Upload, FileCheck, Trash2, Users
} from 'lucide-react';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { supabase } from './lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────
type Priority = 'red' | 'amber' | 'green';
type ActionStatus = 'open' | 'resolved';
type AppView = 'portfolio' | 'site' | 'admin';
type AdminTab = 'organisations' | 'sites' | 'users' | 'assignments';

interface Action {
  id: string; action: string; description: string; date: string; site: string;
  who: string; contractor?: string; source: string; source_document_id?: string;
  priority: Priority; regulation: string; notes: string; evidenceLabel?: string; status: ActionStatus;
  hazardRef?: string | null; hazard?: string | null; existingControls?: string | null;
  riskRating?: string | null; riskLevel?: string | null; resolvedDate?: string | null; sourceFolderId?: string | null;
  isSuggested?: boolean;
}
interface Site {
  id: string; name: string; type: string; organisation_id: string | null;
  red: number; amber: number; green: number; compliance: number; lastReview: string;
  trend: number; datto_folder_id: string | null; advisor_id: string | null;
  last_ai_sync: string | null;
  excluded_datto_folder_ids: string[];
  actionProgress: number;
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
    // Inject column styles directly into the HTML so they don't depend on Tailwind scanning
    const html = liCount > 4
      ? text
          .replace(/<ul>/g, '<ul style="columns:2;column-gap:1.5rem;list-style-type:disc;padding-left:1rem;margin:0.25rem 0">')
          .replace(/<li>/g, '<li style="break-inside:avoid;margin-bottom:0.125rem">')
      : text;
    return (
      <div
        className="text-[11px] text-slate-600 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_em]:italic [&_strong]:font-bold"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  // Normalise explicit • bullets to newlines, then split into paragraphs (blank lines)
  const normalised = text.replace(/\s*•\s*/g, '\n• ');
  const paragraphs = normalised.split(/\r?\n[ \t]*\r?\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return <span>{text}</span>;

  const renderPara = (para: string, key: number) => {
    const lines = para.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    // Single-line prose — plain text, no bullets, no columns
    if (lines.length <= 1) {
      return <p key={key} className="text-[11px] text-slate-600">{lines[0] ?? ''}</p>;
    }
    // Multiple lines within a paragraph (enumeration / list) — bullet each line
    // Use 2 columns only when there are many items (not for prose paragraphs)
    const clean = lines.map(l => l.startsWith('•') ? l.slice(1).trim() : l);
    return (
      <ul key={key} className={`list-disc pl-4${clean.length > 3 ? ' columns-2 gap-x-6' : ''}`}>
        {clean.map((line, i) => <li key={i} className="text-[11px] text-slate-600 mb-0.5 break-inside-avoid">{line}</li>)}
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
  red:   { label: 'Critical',  bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    bar: 'bg-rose-500',    dot: 'bg-rose-500',    badge: 'bg-rose-100 text-rose-700 border-rose-200' },
  amber: { label: 'Upcoming',  bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   bar: 'bg-amber-500',   dot: 'bg-amber-500',   badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  green: { label: 'Scheduled', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', bar: 'bg-emerald-500', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};

const StatusBadge = ({ type, count }: { type: Priority; count: number }) => {
  const c = priorityConfig[type];
  return (
    <div className={`px-2 py-1 rounded-lg border text-[10px] font-black flex items-center gap-1.5 ${c.badge}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />{count} {type.toUpperCase()}
    </div>
  );
};

const ComplianceRing = ({ score, size = 56 }: { score: number; size?: number }) => {
  const r = 20; const circ = 2 * Math.PI * r; const offset = circ - (score / 100) * circ;
  const color = score >= 90 ? '#10b981' : score >= 75 ? '#6366f1' : '#f43f5e';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r={r} stroke="#f1f5f9" strokeWidth="5" fill="none" />
      <circle cx="24" cy="24" r={r} stroke={color} strokeWidth="5" fill="none" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 24 24)" style={{ transition: 'stroke-dashoffset 1s ease' }} />
      <text x="24" y="28" textAnchor="middle" fontSize="10" fontWeight="900" fill={color}>{score}</text>
    </svg>
  );
};

const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const toUKDate = (iso: string) => { if (!isIsoDate(iso)) return iso; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };

// ─── Action Card ──────────────────────────────────────────────────────────────
const ActionCard = ({ action, isResolved, onToggleResolve, onAddNote, role, expanded, onExpand }: {
  action: Action; isResolved: boolean; onToggleResolve: (id: string) => void; onAddNote: (id: string, note: string) => void; role: string; expanded: boolean; onExpand: () => void;
}) => {
  const [noteText, setNoteText] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = !isResolved && action.date && action.date < today;
  const escalatedPriority: Priority = isOverdue
    ? action.priority === 'green' ? 'amber' : 'red'
    : action.priority;
  const cfg = priorityConfig[escalatedPriority];

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
      const today = new Date().toISOString().slice(0, 10);
      doSync(today);
    }
  };
  return (
    <div className={`rounded-2xl border transition-all duration-300 overflow-hidden ${isResolved ? 'bg-slate-50/60 border-slate-100 opacity-60' : `${cfg.bg} ${cfg.border}`}`}>
      <div className="p-6 flex flex-col md:flex-row md:items-start gap-4">
        <div className={`w-1.5 rounded-full self-stretch hidden md:block flex-shrink-0 ${isResolved ? 'bg-slate-300' : cfg.bar}`} style={{ minHeight: 64 }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              {action.source && action.source_document_id ? (
                <a href={`/viewer?fileId=${action.source_document_id}&fileName=${encodeURIComponent(action.source)}&role=${role}`} target="_blank" rel="noopener noreferrer" className={`font-bold text-lg leading-snug hover:underline ${isResolved ? 'text-slate-400 line-through' : 'text-slate-900'}`} onClick={e => e.stopPropagation()}>{action.source}</a>
              ) : (
                <h4 className={`font-bold text-lg leading-snug ${isResolved ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{action.source || action.action}</h4>
              )}
              {action.hazardRef && <span className="text-[11px] font-black text-violet-500 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-lg flex-shrink-0">Hazard No. {action.hazardRef}</span>}
              {(action as any).isSuggested && <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border border-violet-200 text-violet-600 bg-violet-50 flex-shrink-0">AI Suggested — discuss with advisor</span>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isOverdue && <span className="text-[10px] font-black uppercase px-3 py-1.5 rounded-lg border border-rose-300 bg-rose-50 text-rose-700">Overdue</span>}
              <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-lg border ${isResolved ? 'bg-white border-slate-200 text-slate-400' : `border ${cfg.badge}`}`}>{isResolved ? 'Resolved' : cfg.label}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 mt-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            <span className="flex items-center gap-1.5"><Clock size={12} /><span className="text-slate-700">{action.date}</span></span>
            {action.who && <span className="flex items-center gap-1.5"><User size={12} /><span className="text-slate-700">{action.who}</span></span>}
            {action.contractor && <span className="flex items-center gap-1.5"><HardHat size={12} /><span className="text-slate-700">{action.contractor}</span></span>}
            {action.regulation && <span className="flex items-center gap-1.5 text-indigo-500"><Shield size={12} />{action.regulation}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onExpand} className="p-2.5 rounded-xl bg-white/80 border border-white/60 text-slate-400 hover:text-indigo-600 hover:border-indigo-200 shadow-sm">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
          <button onClick={handleResolve} className={`px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider active:scale-95 shadow-sm flex items-center gap-2 ${isResolved ? 'bg-white border border-slate-200 text-slate-400' : 'bg-slate-900 text-white hover:bg-indigo-700'}`}>
            {isResolved ? <><X size={13} />Undo</> : <><CheckCircle size={13} />Resolve</>}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-white/60 bg-white/60 backdrop-blur-sm px-6 py-5 space-y-5">
          {/* Labelled fields row */}
          <div className="flex flex-wrap gap-6">
            {action.date && <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-0.5">Due Date</p><p className="text-sm font-bold text-slate-700">{action.date}</p></div>}
            {action.who && <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-0.5">Responsible Person</p><p className="text-sm font-bold text-slate-700">{action.who}</p></div>}
            {action.contractor && <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-0.5">Contractor</p><p className="text-sm font-bold text-slate-700">{action.contractor}</p></div>}
            {action.regulation && <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-0.5">Regulation</p><p className="text-sm font-bold text-slate-700">{action.regulation}</p></div>}
          </div>
          {/* Hazard & Existing Controls */}
          {(action.hazard || action.existingControls) && (
            <div className="space-y-2 pl-1">
              {action.hazard && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-0.5">
                    {action.hazardRef ? `Hazard No. ${action.hazardRef}` : 'Hazard'}
                  </p>
                  {formatExtractedText(action.hazard)}
                </div>
              )}
              {action.existingControls && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-0.5">Existing Measures</p>
                  {formatExtractedText(action.existingControls)}
                </div>
              )}
            </div>
          )}
          {action.action && (
            <p className="text-[11px] text-slate-700"><span className="font-black text-rose-600 uppercase tracking-wide">Action Required:</span>{' '}{action.action}</p>
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
              {action.riskLevel && <p className="text-[11px] text-slate-600"><span className="font-black">Risk Level:</span> {action.riskLevel}</p>}
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
  onSelect: (name: string, id: string) => void;
  onNavigate?: (name: string, id: string) => void;
  onClose: () => void;
}) => {
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([{ id: startFolderId, name: startFolderName }]);
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
      {/* Select current folder button */}
      <div className="px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
        <button onClick={() => onSelect(current.name, current.id)} className="text-[11px] font-black text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 uppercase tracking-wider">
          <CheckCircle size={12} />Select &ldquo;{current.name}&rdquo;
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {loading && <div className="p-4 text-center text-[11px] font-black text-slate-400 animate-pulse">Loading…</div>}
        {!loading && apiError && <div className="p-4 text-xs font-bold text-rose-600">{apiError}</div>}
        {!loading && !apiError && folders.length === 0 && <div className="p-4 text-center text-xs font-bold text-slate-400">No subfolders here</div>}
        {!loading && !apiError && folders.map(item => (
          <button key={item.id} onClick={() => navigateTo(item.name, item.id)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50 group border-b border-slate-50 text-left">
            <Folder size={14} className="text-amber-400 flex-shrink-0" /><span className="text-xs font-bold text-slate-700 group-hover:text-amber-700 flex-1 truncate">{item.name}</span><ChevronRight size={12} className="text-slate-300" />
          </button>
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
  const [priority, setPriority] = useState<'critical' | 'upcoming' | 'scheduled'>('upcoming');
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

  const priorityMap: Record<string, Priority> = { critical: 'red', upcoming: 'amber', scheduled: 'green', red: 'red', amber: 'amber', green: 'green' };
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
      site_id: site.id, title: title.trim(), description: description.trim(), priority, status: 'open',
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
      priority: priorityMap[data.priority] as Priority, regulation: data.regulation || '',
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Priority *</label>
            <div className="flex gap-2">
              {([{ val: 'critical', label: 'Critical', active: 'bg-rose-600 text-white border-rose-600' }, { val: 'upcoming', label: 'Upcoming', active: 'bg-amber-500 text-white border-amber-500' }, { val: 'scheduled', label: 'Scheduled', active: 'bg-emerald-600 text-white border-emerald-600' }] as const).map(p => (
                <button key={p.val} onClick={() => setPriority(p.val)} className={`flex-1 py-2.5 rounded-xl text-[11px] font-black border transition-all ${priority === p.val ? p.active : 'bg-white text-slate-500 border-slate-200'}`}>{p.label}</button>
              ))}
            </div>
          </div>
          <div><label className={labelClass}>Target Date *</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputClass} /></div>
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
const DocumentCard = ({ doc, role, actions, onDelete, onToggleAction }: {
  doc: SiteDocument; role: string; actions: Action[];
  onDelete: (id: string) => void; onToggleAction: (id: string, resolved: boolean) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
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
            <h4 className="font-black text-slate-900 leading-snug">{doc.file_name}</h4>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {doc.datto_file_id && (
              <a href={`/viewer?fileId=${doc.datto_file_id}&fileName=${encodeURIComponent(doc.file_name ?? '')}&role=${role}`} target="_blank" rel="noopener noreferrer" className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg" title="View document"><ExternalLink size={14} /></a>
            )}
            {(role === 'advisor' || role === 'superadmin') && (
              <button onClick={() => onDelete(doc.id)} className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg" title="Delete"><Trash2 size={14} /></button>
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
  const today = new Date().toISOString().slice(0, 10);

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
              docName: d.documentName ?? f.name.replace(/\.[^.]+$/, ''),
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
        <div className="grid gap-3 md:grid-cols-2">{documents.map(doc => <DocumentCard key={doc.id} doc={doc} role={profile.role} actions={docActions.filter(a => (a as any)._siteDocumentId === doc.id)} onDelete={handleDelete} onToggleAction={handleToggleAction} />)}</div>
      )}
      {showUpload && <UploadModal site={site} userId={userId} onClose={() => setShowUpload(false)} onSaved={handleSaved} />}
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
  const [showEditSitePicker, setShowEditSitePicker] = useState(false);
  const [editSiteAdvisorId, setEditSiteAdvisorId] = useState('');

  // Create form — org
  const [orgName, setOrgName] = useState('');
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

  // Create form — assignment
  const [assignAdvisorId, setAssignAdvisorId] = useState('');
  const [assignOrgId, setAssignOrgId] = useState('');

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([loadOrgs(), loadSites(), loadUsers(), loadAssignments()]);
    setLoading(false);
  };

  const loadOrgs = async () => { const { data } = await supabase.from('organisations').select('*').order('name'); if (data) setOrganisations(data); };
  const loadSites = async () => { const { data } = await supabase.from('sites').select('*, organisations(name)').order('name'); if (data) setSites(data); };
  const loadUsers = async () => { const res = await fetch('/api/admin/users'); if (res.ok) setUsers(await res.json()); };
  const loadAssignments = async () => { const { data } = await supabase.from('advisor_organisations').select('*, organisations(name)').order('created_at'); if (data) setAssignments(data); };

  const flash = (msg: string, isError = false) => {
    if (isError) { setFlashError(msg); setTimeout(() => setFlashError(''), 4000); }
    else { setFlashSuccess(msg); setTimeout(() => setFlashSuccess(''), 3000); }
  };

  // ── Create handlers ──
  const handleCreateOrg = async () => {
    if (!orgName.trim()) { flash('Name is required', true); return; }
    // Use explicitly selected folder, or current picker position if picker is still open
    const finalId = orgFolderId || (showOrgFolderPicker ? orgPickerCurrentId : '');
    const { error } = await supabase.from('organisations').insert({ name: orgName.trim(), datto_folder_id: finalId || null });
    if (error) { flash(error.message, true); return; }
    flash('Organisation created!');
    setOrgName(''); setOrgFolderId(''); setOrgFolderName(''); setShowOrgFolderPicker(false); setShowOrgForm(false);
    loadOrgs();
  };

  const handleCreateSite = async () => {
    if (!siteName.trim()) { flash('Name is required', true); return; }
    if (!siteOrgId) { flash('Organisation is required', true); return; }
    const finalId = siteFolderId || (showSiteFolderPicker ? sitePickerCurrentId : '');
    const typeValue = siteType === 'OTHER' ? (siteTypeOther.trim() || 'OTHER') : siteType;
    const { error } = await supabase.from('sites').insert({ name: siteName.trim(), type: typeValue, organisation_id: siteOrgId, datto_folder_id: finalId || null, compliance_score: 0, trend: 0 });
    if (error) { flash(error.message, true); return; }
    flash('Site created!');
    setSiteName(''); setSiteType('OFFICE'); setSiteTypeOther(''); setSiteOrgId(''); setSiteFolderId(''); setSiteFolderName(''); setShowSiteFolderPicker(false); setShowSiteForm(false);
    loadSites();
  };

  const handleCreateUser = async () => {
    if (!userEmail.trim()) { flash('Email is required', true); return; }
    if (!userPassword.trim()) { flash('Password is required', true); return; }
    if (userRole === 'client' && !userOrgId) { flash('Organisation is required for client users', true); return; }
    const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userEmail.trim(), password: userPassword, role: userRole, organisation_id: userOrgId || null }) });
    const data = await res.json();
    if (!res.ok) { flash(data.error, true); return; }
    flash('User created!'); setUserEmail(''); setUserPassword(''); setUserRole('advisor'); setUserOrgId(''); setShowUserForm(false); loadUsers();
  };

  const handleCreateAssignment = async () => {
    if (!assignAdvisorId) { flash('Advisor is required', true); return; }
    if (!assignOrgId) { flash('Organisation is required', true); return; }
    const { error } = await supabase.from('advisor_organisations').insert({ advisor_id: assignAdvisorId, organisation_id: assignOrgId });
    if (error) { flash(error.message, true); return; }
    flash('Assignment created!'); setAssignAdvisorId(''); setAssignOrgId(''); setShowAssignForm(false); loadAssignments();
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

  const startEditSite = (site: any) => {
    setEditingSiteId(site.id); setEditSiteName(site.name);
    const knownType = SITE_TYPES.includes(site.type);
    setEditSiteType(knownType ? site.type : 'OTHER');
    setEditSiteTypeOther(knownType ? '' : site.type);
    setEditSiteFolderId(site.datto_folder_id || ''); setEditSiteFolderName(site.datto_folder_id ? `ID: ${site.datto_folder_id}` : '');
    const orgAdvisorId = assignments.find((a: any) => a.organisation_id === site.organisation_id)?.advisor_id || '';
    setEditSiteAdvisorId(site.advisor_id || orgAdvisorId);
    setShowEditSitePicker(false);
  };

  const handleUpdateSite = async (id: string) => {
    if (!editSiteName.trim()) { flash('Name is required', true); return; }
    const finalId = editSiteFolderId || (showEditSitePicker ? editSiteFolderId : '');
    const editTypeValue = editSiteType === 'OTHER' ? (editSiteTypeOther.trim() || 'OTHER') : editSiteType;
    const { error } = await supabase.from('sites').update({ name: editSiteName.trim(), type: editTypeValue, datto_folder_id: finalId || null, advisor_id: editSiteAdvisorId || null }).eq('id', id);
    if (error) { flash(error.message, true); return; }
    flash('Site updated!'); setEditingSiteId(null); setShowEditSitePicker(false); loadSites();
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
    { key: 'assignments', label: 'Assignments', icon: <Layout size={14} /> },
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
              <div><label className={labelClass}>Organisation Name *</label><input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="e.g. Precision Engineering Ltd" className={inputClass} /></div>
              <FolderPickerField
                folderId={orgFolderId} folderName={orgFolderName} showPicker={showOrgFolderPicker}
                onOpenPicker={(v: boolean) => setShowOrgFolderPicker(v)}
                onSelectFolder={(name: string, id: string) => { setOrgFolderName(name); setOrgFolderId(id); setShowOrgFolderPicker(false); }}
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
                                      onSelect={(name, id) => { setEditOrgFolderName(name); setEditOrgFolderId(id); setShowEditOrgPicker(false); }}
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
                              <div className="flex gap-2">
                                <button onClick={() => handleUpdateOrg(org.id)} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700">Save Changes</button>
                                <button onClick={() => { setEditingOrgId(null); setShowEditOrgPicker(false); }} className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider">Cancel</button>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className={labelClass}>Site Name *</label><input value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="e.g. Main Assembly Factory" className={inputClass} /></div>
                <div>
                  <label className={labelClass}>Organisation *</label>
                  <select value={siteOrgId} onChange={e => { setSiteOrgId(e.target.value); setSiteFolderId(''); setSiteFolderName(''); }} className={inputClass}>
                    <option value="">Select organisation…</option>
                    {organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
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
                onSelectFolder={(name: string, id: string) => { setSiteFolderName(name); setSiteFolderId(id); setShowSiteFolderPicker(false); }}
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
                                <div><label className={labelClass}>Advisor</label>
                                  <select value={editSiteAdvisorId} onChange={e => setEditSiteAdvisorId(e.target.value)} className={inputClass}>
                                    <option value="">Unassigned</option>
                                    {advisors.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div>
                                <label className={labelClass}>Datto Folder</label>
                                {showEditSitePicker ? (
                                  <DattoFolderPicker
                                    startFolderId={organisations.find(o => o.id === site.organisation_id)?.datto_folder_id || DATTO_ROOT_ID}
                                    startFolderName={organisations.find(o => o.id === site.organisation_id)?.name || 'Customer Documents'}
                                    onSelect={(name, id) => { setEditSiteFolderName(name); setEditSiteFolderId(id); setShowEditSitePicker(false); }}
                                    onNavigate={(name, id) => { setEditSiteFolderName(name); setEditSiteFolderId(id); }}
                                    onClose={() => setShowEditSitePicker(false)} />
                                ) : (
                                  <div onClick={() => setShowEditSitePicker(true)} className={`${inputClass} flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-300`}>
                                    {editSiteFolderName ? <span className="flex items-center gap-2 text-indigo-700 font-bold text-sm"><Folder size={14} className="text-amber-400" />{editSiteFolderName}</span> : <span className="text-slate-400 text-sm">Click to browse…</span>}
                                    <FolderOpen size={16} className="text-slate-300" />
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => handleUpdateSite(site.id)} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700">Save Changes</button>
                                <button onClick={() => { setEditingSiteId(null); setShowEditSitePicker(false); }} className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider">Cancel</button>
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
                <div>
                  <label className={labelClass}>Organisation *</label>
                  <select value={userOrgId} onChange={e => setUserOrgId(e.target.value)} className={inputClass}>
                    <option value="">Select organisation…</option>
                    {organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
                  </select>
                </div>
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
      {activeTab === 'assignments' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">{assignments.length} Assignment{assignments.length !== 1 ? 's' : ''}</h3>
            <button onClick={() => setShowAssignForm(v => !v)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700"><Plus size={13} />Add Assignment</button>
          </div>
          {showAssignForm && (
            <div className="bg-white border border-indigo-200 rounded-2xl p-6 space-y-4">
              <h4 className="font-black text-slate-900 text-sm uppercase tracking-widest">New Assignment</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className={labelClass}>Advisor *</label><select value={assignAdvisorId} onChange={e => setAssignAdvisorId(e.target.value)} className={inputClass}><option value="">Select advisor…</option>{advisors.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}</select></div>
                <div><label className={labelClass}>Organisation *</label><select value={assignOrgId} onChange={e => setAssignOrgId(e.target.value)} className={inputClass}><option value="">Select organisation…</option>{organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></div>
              </div>
              <div className="flex gap-3">
                <button onClick={handleCreateAssignment} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700">Create Assignment</button>
                <button onClick={() => setShowAssignForm(false)} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl text-[11px] font-black uppercase tracking-wider">Cancel</button>
              </div>
            </div>
          )}
          {loading ? <div className="py-12 text-center text-slate-400 text-sm font-bold animate-pulse">Loading…</div>
            : assignments.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <Layout size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="font-black text-slate-700">No assignments yet</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                  <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-6 py-3">Advisor</th><th className="px-6 py-3">Organisation</th><th className="px-6 py-3">Assigned</th><th className="px-6 py-3"></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {assignments.map(a => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="px-6 py-4 font-bold text-slate-800">{users.find(u => u.id === a.advisor_id)?.email || a.advisor_id}</td>
                        <td className="px-6 py-4 text-sm text-slate-600">{a.organisations?.name || '—'}</td>
                        <td className="px-6 py-4 text-sm text-slate-400">{new Date(a.created_at).toLocaleDateString('en-GB')}</td>
                        <td className="px-6 py-4 text-right"><button onClick={() => handleDeleteAssignment(a.id)} className="text-rose-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50"><X size={14} /></button></td>
                      </tr>
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
const FolderCheckboxTree = ({ folderId, folderName, depth, excludedIds, onToggle, parentExcluded = false }: {
  folderId: string; folderName: string; depth: number;
  excludedIds: Set<string>; onToggle: (id: string) => void;
  parentExcluded?: boolean;
}) => {
  const [expanded, setExpanded] = useState(depth === 0);
  const [children, setChildren] = useState<DattoItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const isExcluded = excludedIds.has(folderId);
  const effectivelyExcluded = parentExcluded || isExcluded;

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

  useEffect(() => { if (depth === 0) loadChildren(); }, []);

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <div className="flex items-center gap-2 py-1.5">
        <button onClick={handleExpand} className="w-4 h-4 flex items-center justify-center text-slate-300 hover:text-slate-500 flex-shrink-0">
          {loading ? <span className="text-[9px] animate-pulse">…</span> : expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <input type="checkbox" checked={!effectivelyExcluded} onChange={() => !parentExcluded && onToggle(folderId)} disabled={parentExcluded} className={`w-3.5 h-3.5 flex-shrink-0 ${parentExcluded ? 'opacity-30 cursor-not-allowed' : 'accent-violet-600'}`} />
        <Folder size={13} className={effectivelyExcluded ? 'text-slate-300 flex-shrink-0' : 'text-amber-400 flex-shrink-0'} />
        <span className={`text-xs font-bold flex-1 truncate ${effectivelyExcluded ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{folderName}</span>
        {fileCount !== null && (
          <span className="text-[10px] text-slate-400 font-bold bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
        )}
      </div>
      {expanded && children !== null && children.map(child => (
        <FolderCheckboxTree key={child.id} folderId={child.id} folderName={child.name} depth={depth + 1} excludedIds={excludedIds} onToggle={onToggle} parentExcluded={effectivelyExcluded} />
      ))}
    </div>
  );
};

const SyncConfigModal = ({ site, onClose, onSave }: {
  site: Site; onClose: () => void; onSave: (siteId: string, excludedIds: string[]) => void;
}) => {
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set(site.excluded_datto_folder_ids ?? []));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleToggle = (id: string) => {
    setExcludedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const handleSave = async () => {
    setSaving(true); setSaveError('');
    const excludedArr = Array.from(excludedIds);
    const { error } = await supabase.from('sites').update({ excluded_datto_folder_ids: excludedArr }).eq('id', site.id);
    if (error) { setSaveError('Failed to save. Please try again.'); setSaving(false); return; }
    onSave(site.id, excludedArr);
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
          <p className="text-[11px] text-violet-700 font-bold">Uncheck folders to skip them during AI Sync. This saves tokens by excluding irrelevant documents.</p>
        </div>
        <div className="px-4 py-3 max-h-[400px] overflow-y-auto">
          <FolderCheckboxTree folderId={site.datto_folder_id} folderName={site.name} depth={0} excludedIds={excludedIds} onToggle={handleToggle} />
        </div>
        <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            {excludedIds.size > 0 && <span className="text-[11px] font-bold text-slate-500">{excludedIds.size} folder{excludedIds.size !== 1 ? 's' : ''} excluded</span>}
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
  const [siteTab, setSiteTab] = useState<'actions' | 'documents'>('actions');
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [filterOrgId, setFilterOrgId] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLastRun, setSyncLastRun] = useState('2 hours ago');
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all');
  const [actionNotes, setActionNotes] = useState<Record<string, string>>({});
  const [sites, setSites] = useState<Site[]>([]);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [allActions, setAllActions] = useState<Action[]>([]);
  const [showAddAction, setShowAddAction] = useState(false);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [aiSyncing, setAiSyncing] = useState(false);
  const [aiSyncProgress, setAiSyncProgress] = useState('');
  const [aiStatusMessage, setAiStatusMessage] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [reviewActions, setReviewActions] = useState<ReviewAction[]>([]);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showSyncConfig, setShowSyncConfig] = useState(false);
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
        if (profile.site_id) sitesQuery = sitesQuery.eq('id', profile.site_id);
        else if (profile.organisation_id) sitesQuery = sitesQuery.eq('organisation_id', profile.organisation_id);
        else { setSites([]); return; }
      }
      const { data } = await sitesQuery;
      if (data) {
        const mapped: Site[] = data.map((s: any) => ({
          id: s.id, name: s.name, type: s.type, organisation_id: s.organisation_id,
          compliance: s.compliance_score ?? 0, trend: s.trend ?? 0,
          actionProgress: s.action_progress ?? 100,
          red: 0, amber: 0, green: 0, lastReview: '—',
          datto_folder_id: s.datto_folder_id || orgFolderMap.get(s.organisation_id) || null,
          advisor_id: s.advisor_id ?? null,
          last_ai_sync: s.last_ai_sync ?? null,
          excluded_datto_folder_ids: s.excluded_datto_folder_ids ?? [],
        }));
        setSites(mapped);
        if (mapped.length > 0 && !selectedSite) setSelectedSite(mapped[0]);
      }
    };
    load();
  }, [user, profile, organisations]);

  useEffect(() => {
    if (!user || sites.length === 0) return;
    const priorityMap: Record<string, Priority> = { critical: 'red', upcoming: 'amber', scheduled: 'green', red: 'red', amber: 'amber', green: 'green' };
    const siteIds = sites.map(s => s.id);
    supabase.from('actions').select('*').in('site_id', siteIds).then(({ data }) => {
      if (data) setAllActions(data.filter((a: any) => !a.site_document_id).map((a: any) => ({ id: a.id, action: a.title, description: a.description || '', date: a.due_date || '', site: sites.find(s => s.id === a.site_id)?.name || '', who: a.responsible_person || '', contractor: a.contractor || '', source: a.source_document_name || '', source_document_id: a.source_document_id || '', priority: (priorityMap[a.priority] || 'green') as Priority, regulation: a.regulation || '', notes: '', status: a.status as ActionStatus, hazardRef: a.hazard_ref || null, hazard: a.hazard || null, existingControls: a.existing_controls || null, riskRating: a.risk_rating || null, riskLevel: a.risk_level || null, resolvedDate: a.resolved_date || null, sourceFolderId: a.source_folder_id || null, isSuggested: a.is_suggested ?? false, _siteDocumentId: a.site_document_id || null })));
    });
  }, [user, sites]);

  const handleLogout = async () => { await supabase.auth.signOut(); setUser(null); setProfile(null); setSites([]); setOrganisations([]); };
  const handleDattoSync = () => { setIsSyncing(true); setTimeout(() => { setIsSyncing(false); setSyncLastRun('Just now'); }, 2000); };

  const recalcActionProgress = async (siteId: string) => {
    const res = await fetch('/api/actions/recalc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: siteId }) });
    if (res.ok) {
      const { action_progress } = await res.json();
      setSites(prev => prev.map(s => s.id === siteId ? { ...s, actionProgress: action_progress } : s));
      setSelectedSite(prev => prev?.id === siteId ? { ...prev, actionProgress: action_progress } : prev);
    }
  };

  const toggleResolve = async (id: string) => {
    const isCurrentlyResolved = resolvedIds.includes(id);
    setResolvedIds(prev => isCurrentlyResolved ? prev.filter(i => i !== id) : [...prev, id]);
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('actions').update({
      status: isCurrentlyResolved ? 'open' : 'resolved',
      resolved_date: isCurrentlyResolved ? null : today,
    }).eq('id', id);
    setAllActions(prev => prev.map(a => a.id === id ? { ...a, status: isCurrentlyResolved ? 'open' : 'resolved', resolvedDate: isCurrentlyResolved ? null : today } : a));
    const action = allActions.find(a => a.id === id);
    const siteId = sites.find(s => s.name === action?.site)?.id;
    if (siteId) recalcActionProgress(siteId);
  };
  const handleAddNote = (id: string, note: string) => { if (note.trim()) setActionNotes(prev => ({ ...prev, [id]: note.trim() })); };
  const handleSiteClick = (site: Site) => { setSelectedSite(site); setView('site'); };
  const handleSaveSyncConfig = (siteId: string, excludedIds: string[]) => {
    setSites(prev => prev.map(s => s.id === siteId ? { ...s, excluded_datto_folder_ids: excludedIds } : s));
    setSelectedSite(prev => prev?.id === siteId ? { ...prev, excluded_datto_folder_ids: excludedIds } : prev);
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
    const priorityMap: Record<string, string> = { HIGH: 'critical', MEDIUM: 'upcoming', LOW: 'scheduled' };
    const dbPriority = ra.advisorPriority ? priorityMap[ra.advisorPriority] || 'upcoming' : 'upcoming';
    const { data } = await supabase.from('actions').insert({
      site_id: selectedSite.id,
      title: ra.description,
      description: '',
      priority: dbPriority,
      status: 'open',
      due_date: ra.dueDate || null,
      source_document_name: ra.docName,
      source_document_id: ra.docFileId || null,
      source_folder_id: ra.docFolderFileId || null,
      hazard_ref: ra.hazardRef || null,
      hazard: ra.hazard || null,
      existing_controls: ra.existingControls || null,
      risk_rating: ra.riskRating || null,
      risk_level: ra.riskLevel || null,
      regulation: ra.regulation || null,
      responsible_person: ra.responsiblePerson || null,
    }).select().single();
    setReviewActions(prev => prev.map(a => a.id === actionId ? { ...a, added: true } : a));
    if (data) {
      const priorityColour: Record<string, Priority> = { critical: 'red', upcoming: 'amber', scheduled: 'green' };
      setAllActions(prev => [...prev, { id: data.id, action: ra.description, description: '', date: ra.dueDate || '', site: selectedSite.name, who: ra.responsiblePerson || '', contractor: '', source: ra.docName, source_document_id: ra.docFileId || '', sourceFolderId: ra.docFolderFileId || null, priority: (priorityColour[dbPriority] || 'green') as Priority, regulation: ra.regulation || '', notes: '', status: 'open', resolvedDate: null, hazardRef: ra.hazardRef || null, hazard: ra.hazard || null, existingControls: ra.existingControls || null, riskRating: ra.riskRating || null, riskLevel: ra.riskLevel || null }]);
      recalcActionProgress(selectedSite.id);
    }
  };

  const handleAddSelectedReviewActions = async () => {
    const toAdd = reviewActions.filter(a => a.selected && !a.added);
    for (const ra of toAdd) await handleAddReviewAction(ra.id);
  };

  const EXCLUDED_FOLDERS = ['archive', 'evidence', 'photos', '_doc_converted_tmp'];

  const fetchAllFiles = async (folderId: string, userExcludedIds: Set<string> = new Set()): Promise<(DattoItem & { parentFolderId: string })[]> => {
    const res = await fetch(`/api/datto?folderId=${folderId}`);
    if (!res.ok) return [];
    const raw = await res.json();
    const items = normaliseItems(raw);
    const files = items.filter((i: DattoItem) => i.type === 'file').map((i: DattoItem) => ({ ...i, parentFolderId: folderId }));
    const folders = items.filter((i: DattoItem) =>
      i.type === 'folder' && !EXCLUDED_FOLDERS.includes(i.name.toLowerCase()) && !userExcludedIds.has(i.id)
    );
    const subFiles = await Promise.all(folders.map((f: DattoItem) => fetchAllFiles(f.id, userExcludedIds)));
    return [...files, ...subFiles.flat()];
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
      // Re-fetch allActions so duplicate detection uses current DB state, not stale mount-time state
      const priorityMap: Record<string, Priority> = { critical: 'red', upcoming: 'amber', scheduled: 'green', red: 'red', amber: 'amber', green: 'green' };
      const siteIds = sites.map(s => s.id);
      const { data: freshActionsData } = await supabase.from('actions').select('*').in('site_id', siteIds);
      const currentActions: Action[] = freshActionsData ? freshActionsData.map((a: any) => ({ id: a.id, action: a.title, description: a.description || '', date: a.due_date || '', site: sites.find(s => s.id === a.site_id)?.name || '', who: a.responsible_person || '', contractor: a.contractor || '', source: a.source_document_name || '', source_document_id: a.source_document_id || '', priority: (priorityMap[a.priority] || 'green') as Priority, regulation: a.regulation || '', notes: '', status: a.status as ActionStatus, hazardRef: a.hazard_ref || null, hazard: a.hazard || null, existingControls: a.existing_controls || null, riskRating: a.risk_rating || null, riskLevel: a.risk_level || null, resolvedDate: a.resolved_date || null, sourceFolderId: a.source_folder_id || null, isSuggested: a.is_suggested ?? false })) : allActions;
      setAllActions(currentActions);
      setAiSyncProgress('Scanning folders…');
      const userExcludedIds = new Set(site.excluded_datto_folder_ids ?? []);
      const allItems = await fetchAllFiles(site.datto_folder_id, userExcludedIds);
      const SUPPORTED_EXTS = ['.docx', '.doc', '.pdf', '.xlsx', '.xls'];
      let docxFiles = allItems.filter(i => SUPPORTED_EXTS.some(ext => i.name.toLowerCase().endsWith(ext)));
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
      for (let i = 0; i < docxFiles.length; i++) {
        if (aiCancelledRef.current) break;
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
            const decodeEntities = (html: string) => { const txt = document.createElement('textarea'); txt.innerHTML = html; return txt.value; };
            const cleanText = decodeEntities(extracted.value
              .replace(/â€¦/g, '…').replace(/â€™/g, '\u2019').replace(/â€œ/g, '\u201C')
              .replace(/â€/g, '\u201D').replace(/Ã©/g, 'é').replace(/Â·/g, '·').replace(/Â /g, ' '));
            if (cleanText.trim()) {
              aiBody = { text: cleanText, docName: doc.name };
            } else {
              // Fallback: convert to PDF via CloudConvert, send as base64
              const convertRes = await fetch(`/api/convert?fileId=${doc.id}&fileName=${encodeURIComponent(doc.name)}&noCache=true`);
              if (!convertRes.ok) throw new Error(`Could not extract text from ${doc.name}`);
              const pdfBuffer = await convertRes.arrayBuffer();
              const bytes = new Uint8Array(pdfBuffer);
              let binary = '';
              for (let b = 0; b < bytes.byteLength; b++) binary += String.fromCharCode(bytes[b]);
              aiBody = { fileBase64: btoa(binary), mimeType: 'application/pdf', docName: doc.name };
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
            try {
              const readRes = await fetch(`/api/datto/file/readactions?fileId=${doc.id}`);
              if (readRes.ok) { const { rows } = await readRes.json(); if (rows) readRows = rows; }
            } catch { /* non-fatal */ }
            try {
              const hazardsRes = await fetch(`/api/datto/file/hazards?fileId=${doc.id}`);
              if (hazardsRes.ok) { const { hazards } = await hazardsRes.json(); if (hazards?.length > 0) parsedHazards = hazards; }
            } catch { /* non-fatal */ }
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
              documentMeta: documentMeta ?? null,
              selected: !alreadyAdded,
              added: alreadyAdded,
              advisorPriority: null,
            };
          });
          if (newActions.length === 0) {
            setReviewActions(prev => [...prev, { id: `empty-${doc.id}`, description: '', dueDate: null, dueDateRelative: null, responsiblePerson: null, priority: null, advisorPriority: null, docName: doc.name, docFileId: doc.id, docFolderFileId: doc.parentFolderId, selected: false, added: false, isError: true, errorMessage: 'No actions found — check the document structure is correct and re-sync.', hazardRef: null, hazard: null, existingControls: null, regulation: null, riskRating: null, riskLevel: null, documentMeta: null }]);
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
            if (Object.keys(aiUpdates).length > 0) {
              await supabase.from('actions').update(aiUpdates).eq('id', existingAction.id);
              setAllActions((prev: Action[]) => prev.map((a: Action) => a.id === existingAction.id ? { ...a, hazard: aiUpdates.hazard ?? a.hazard, existingControls: aiUpdates.existing_controls ?? a.existingControls, riskRating: aiUpdates.risk_rating ?? a.riskRating, riskLevel: aiUpdates.risk_level ?? a.riskLevel } : a));
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
              if (docRow.targetDate && docRow.targetDate !== docAction.date) { updates.date = docRow.targetDate; supaUpdates.due_date = docRow.targetDate; }
              if (docRow.completedDate && !docAction.resolvedDate) { updates.resolvedDate = docRow.completedDate; updates.status = 'resolved'; supaUpdates.resolved_date = docRow.completedDate; supaUpdates.status = 'resolved'; }
              if (Object.keys(supaUpdates).length > 0) {
                await supabase.from('actions').update(supaUpdates).eq('id', docAction.id);
                setAllActions((prev: Action[]) => prev.map((a: Action) => a.id === docAction.id ? { ...a, ...updates } : a));
                if (updates.status === 'resolved') setResolvedIds((prev: string[]) => prev.includes(docAction.id) ? prev : [...prev, docAction.id]);
              }
            }
          }
        } catch (docErr: any) {
          setReviewActions(prev => [...prev, { id: `err-${doc.id}-${Math.random().toString(36).slice(2)}`, description: '', dueDate: null, dueDateRelative: null, responsiblePerson: null, priority: null, advisorPriority: null, docName: doc.name, docFileId: doc.id, docFolderFileId: doc.parentFolderId, selected: false, added: false, isError: true, errorMessage: docErr.message, hazardRef: null, hazard: null, existingControls: null, regulation: null, riskRating: null, riskLevel: null, documentMeta: null }]);
        }
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
  const filteredActions = filterPriority === 'all' ? siteActions : siteActions.filter(a => a.priority === filterPriority);
  const openCount = siteActions.filter(a => !resolvedIds.includes(a.id)).length;
  const resolvedCount = siteActions.filter(a => resolvedIds.includes(a.id)).length;
  const criticalCount = viewActions.filter(a => a.priority === 'red').length;
  const upcomingCount = viewActions.filter(a => a.priority === 'amber').length;

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
                  {[{ label: 'Critical', value: criticalCount, color: 'text-rose-400', icon: <Zap size={14} /> }, { label: 'Upcoming', value: upcomingCount, color: 'text-amber-400', icon: <Clock size={14} /> }, { label: 'Sites', value: viewSites.length, color: 'text-indigo-300', icon: <Building2 size={14} /> }].map(stat => (
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
                            <div className="flex items-center gap-3"><span className={`text-[10px] font-black flex items-center gap-1 ${site.trend >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{site.trend >= 0 ? <TrendingUp size={11} /> : <ArrowUpRight size={11} className="rotate-90" />}{site.trend >= 0 ? '+' : ''}{site.trend}%</span><span className={`font-black text-sm ${site.compliance >= 90 ? 'text-emerald-600' : site.compliance >= 75 ? 'text-indigo-600' : 'text-rose-600'}`}>{site.compliance}%</span></div>
                          </div>
                          <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden shadow-inner"><div className={`h-full rounded-full transition-all duration-1000 ${site.compliance >= 90 ? 'bg-emerald-500' : site.compliance >= 75 ? 'bg-indigo-500' : 'bg-rose-500'}`} style={{ width: `${site.compliance}%` }} /></div>
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
                        {[{ label: 'Critical / Urgent', count: criticalCount, color: 'bg-rose-50 text-rose-700 border-rose-100' }, { label: 'Upcoming (Amber)', count: upcomingCount, color: 'bg-amber-50 text-amber-700 border-amber-100' }, { label: 'Scheduled (Green)', count: viewActions.filter(a => a.priority === 'green').length, color: 'bg-emerald-50 text-emerald-700 border-emerald-100' }].map(item => (
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
                          <div>
                            <div className="flex justify-between text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5"><span>Documents</span><span>{site.compliance}%</span></div>
                            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${site.compliance >= 90 ? 'bg-emerald-500' : site.compliance >= 75 ? 'bg-indigo-500' : 'bg-rose-500'}`} style={{ width: `${site.compliance}%` }} /></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5"><span>Actions</span><span>{site.actionProgress ?? 100}%</span></div>
                            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${(site.actionProgress ?? 100) >= 80 ? 'bg-emerald-500' : (site.actionProgress ?? 100) >= 50 ? 'bg-amber-400' : 'bg-rose-500'}`} style={{ width: `${site.actionProgress ?? 100}%` }} /></div>
                          </div>
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
                      <button
                        onClick={() => handleAiSync(selectedSite)}
                        disabled={aiSyncing || !selectedSite.datto_folder_id}
                        title={!selectedSite.datto_folder_id ? 'No Datto folder configured' : 'Extract actions from Word documents'}
                        className="flex items-center gap-2 bg-violet-600 text-white px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest shadow-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Sparkles className="w-4 h-4" />
                        {aiSyncing ? aiSyncProgress || 'Syncing…' : 'AI Sync'}
                      </button>
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
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'Open Actions', value: openCount, color: 'text-slate-900', sub: 'requires attention' },
                  { label: 'Resolved', value: resolvedCount, color: 'text-emerald-600', sub: 'this session' },
                  { label: 'Document Compliance', value: `${selectedSite.compliance}%`, color: selectedSite.compliance >= 90 ? 'text-emerald-600' : selectedSite.compliance >= 75 ? 'text-indigo-600' : 'text-rose-600', sub: 'advisor managed' },
                  { label: 'Action Progress', value: `${selectedSite.actionProgress ?? 100}%`, color: (selectedSite.actionProgress ?? 100) >= 80 ? 'text-emerald-600' : (selectedSite.actionProgress ?? 100) >= 50 ? 'text-amber-500' : 'text-rose-600', sub: 'client managed' },
                ].map(stat => (
                  <div key={stat.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm text-center"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{stat.label}</p><p className={`text-3xl font-black ${stat.color}`}>{stat.value}</p><p className="text-[10px] text-slate-400 font-medium mt-1">{stat.sub}</p></div>
                ))}
              </div>
              {/* Site tab toggle */}
              <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
                <button onClick={() => setSiteTab('actions')} className={`px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${siteTab === 'actions' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>Actions</button>
                <button onClick={() => setSiteTab('documents')} className={`px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${siteTab === 'documents' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-400 hover:text-slate-600'}`}>Client Managed</button>
              </div>

              {siteTab === 'actions' && (<>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-2">Filter:</span>
                {(['all', 'red', 'amber', 'green'] as const).map(f => (
                  <button key={f} onClick={() => setFilterPriority(f)} className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider border transition-all ${filterPriority === f ? f === 'all' ? 'bg-slate-900 text-white border-slate-900' : f === 'red' ? 'bg-rose-600 text-white border-rose-600' : f === 'amber' ? 'bg-amber-500 text-white border-amber-500' : 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                    {f === 'all' ? 'All' : f === 'red' ? 'Critical' : f === 'amber' ? 'Upcoming' : 'Scheduled'}
                    {f !== 'all' && <span className="ml-1.5 opacity-70">({siteActions.filter(a => a.priority === f).length})</span>}
                  </button>
                ))}
                <span className="ml-auto text-[11px] font-bold text-slate-400">{filteredActions.length} action{filteredActions.length !== 1 ? 's' : ''}</span>
                {profile?.role === 'advisor' && <button onClick={() => setShowAddAction(true)} className="ml-2 flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700 shadow-sm"><Plus size={13} />Add Action</button>}
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
                          <span><span className="text-rose-700">{ra.docName}</span> could not be processed — repair the file in Datto and re-sync. <span className="font-normal text-rose-400">{ra.errorMessage}</span></span>
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
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-0.5">Existing Measures</p>
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
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 pl-3">Priority</span>
                                <select
                                  value={ra.advisorPriority || ''}
                                  onChange={e => setReviewActions(prev => prev.map(a => a.id === ra.id ? { ...a, advisorPriority: e.target.value || null } : a))}
                                  disabled={ra.added}
                                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white disabled:bg-slate-50"
                                >
                                  <option value="">No priority</option>
                                  <option value="HIGH">High</option>
                                  <option value="MEDIUM">Medium</option>
                                  <option value="LOW">Low</option>
                                </select>
                              </div>
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
                            {(ra.riskRating || ra.riskLevel || ra.priority || ra.regulation) && (
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
                                    {ra.priority && (
                                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${
                                        ra.priority === 'HIGH' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                                        ra.priority === 'MEDIUM' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                        'bg-emerald-100 text-emerald-700 border-emerald-200'
                                      }`}>Priority: {ra.priority}</span>
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

              <div className="space-y-3">
                {filteredActions.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center"><CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-3" /><p className="font-black text-slate-700">No actions in this category</p><p className="text-sm text-slate-400 mt-1">All items resolved or filtered out.</p></div>
                ) : filteredActions.map(action => <ActionCard key={action.id} action={{ ...action, notes: actionNotes[action.id] || action.notes }} isResolved={resolvedIds.includes(action.id)} onToggleResolve={toggleResolve} onAddNote={handleAddNote} role={profile?.role || 'client'} expanded={expandedActionId === action.id} onExpand={() => setExpandedActionId(prev => prev === action.id ? null : action.id)} />)}
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