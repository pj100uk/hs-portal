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
  Warehouse, ShoppingBag, Home
} from 'lucide-react';
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
}
interface Site {
  id: string; name: string; type: string; organisation_id: string | null;
  red: number; amber: number; green: number; compliance: number; lastReview: string;
  trend: number; datto_folder_id: string | null; advisor_id: string | null;
}
interface Organisation { id: string; name: string; datto_folder_id: string | null; }
interface Profile { role: 'superadmin' | 'advisor' | 'client'; site_id: string | null; organisation_id: string | null; }
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

// ─── Action Card ──────────────────────────────────────────────────────────────
const ActionCard = ({ action, isResolved, onToggleResolve, onAddNote, role }: {
  action: Action; isResolved: boolean; onToggleResolve: (id: string) => void; onAddNote: (id: string, note: string) => void; role: string;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const cfg = priorityConfig[action.priority];
  return (
    <div className={`rounded-2xl border transition-all duration-300 overflow-hidden ${isResolved ? 'bg-slate-50/60 border-slate-100 opacity-60' : `${cfg.bg} ${cfg.border}`}`}>
      <div className="p-6 flex flex-col md:flex-row md:items-start gap-4">
        <div className={`w-1.5 rounded-full self-stretch hidden md:block flex-shrink-0 ${isResolved ? 'bg-slate-300' : cfg.bar}`} style={{ minHeight: 64 }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <h4 className={`font-bold text-lg leading-snug ${isResolved ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{action.action}</h4>
            <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-lg border flex-shrink-0 ${isResolved ? 'bg-white border-slate-200 text-slate-400' : `border ${cfg.badge}`}`}>{isResolved ? 'Resolved' : cfg.label}</span>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 mt-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            <span className="flex items-center gap-1.5"><Clock size={12} /><span className="text-slate-700">{action.date}</span></span>
            {action.who && <span className="flex items-center gap-1.5"><User size={12} /><span className="text-slate-700">{action.who}</span></span>}
            {action.contractor && <span className="flex items-center gap-1.5"><HardHat size={12} /><span className="text-slate-700">{action.contractor}</span></span>}
            {action.regulation && <span className="flex items-center gap-1.5 text-indigo-500"><Shield size={12} />{action.regulation}</span>}
            {action.source && action.source_document_id ? (<a href={`/viewer?fileId=${action.source_document_id}&fileName=${encodeURIComponent(action.source)}&role=${role}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-indigo-400 underline cursor-pointer hover:text-indigo-600" onClick={e => e.stopPropagation()}><FileText size={12} />{action.source}</a>) : action.source ? (<span className="flex items-center gap-1.5 text-indigo-400"><FileText size={12} />{action.source}</span>) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setExpanded(e => !e)} className="p-2.5 rounded-xl bg-white/80 border border-white/60 text-slate-400 hover:text-indigo-600 hover:border-indigo-200 shadow-sm">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
          <button onClick={() => onToggleResolve(action.id)} className={`px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider active:scale-95 shadow-sm flex items-center gap-2 ${isResolved ? 'bg-white border border-slate-200 text-slate-400' : 'bg-slate-900 text-white hover:bg-indigo-700'}`}>
            {isResolved ? <><X size={13} />Undo</> : <><CheckCircle size={13} />Resolve</>}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-white/60 bg-white/60 backdrop-blur-sm px-6 py-5 space-y-5">
          <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Requirement Detail</p><p className="text-sm text-slate-700 leading-relaxed">{action.description}</p></div>
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
const AddActionForm = ({ site, onSave, onCancel }: { site: Site; onSave: (action: Action) => void; onCancel: () => void }) => {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'critical' | 'upcoming' | 'scheduled'>('upcoming');
  const [who, setWho] = useState(''); const [contractor, setContractor] = useState('');
  const [regulation, setRegulation] = useState(''); const [dueDate, setDueDate] = useState('');
  const [sourceDocName, setSourceDocName] = useState(''); const [sourceDocId, setSourceDocId] = useState('');
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const priorityMap: Record<string, Priority> = { critical: 'red', upcoming: 'amber', scheduled: 'green' };

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    if (!dueDate) { setError('Target date is required'); return; }
    setSaving(true); setError('');
    const { data, error: err } = await supabase.from('actions').insert({
      site_id: site.id, title: title.trim(), description: description.trim(), priority, status: 'open',
      regulation: regulation.trim(), contractor: contractor.trim() || null, due_date: dueDate,
      source_document_name: sourceDocName || null, source_document_id: sourceDocId || null,
    }).select().single();
    if (err) { setError('Failed to save. Please try again.'); setSaving(false); return; }
    onSave({ id: data.id, action: data.title, description: data.description || '', date: data.due_date, site: site.name, who, contractor: data.contractor || '', source: data.source_document_name || '', source_document_id: data.source_document_id || '', priority: priorityMap[data.priority] as Priority, regulation: data.regulation || '', notes: '', status: 'open' });
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
            <DattoFileBrowser rootFolderId={site.datto_folder_id} siteName={site.name} onSelect={(name, id) => { setSourceDocName(name); setSourceDocId(id); setShowFileBrowser(false); }} onClose={() => setShowFileBrowser(false)} />
          ) : (
            <div onClick={() => site.datto_folder_id && setShowFileBrowser(true)} className={`${inputClass} flex items-center justify-between gap-2 ${site.datto_folder_id ? 'cursor-pointer hover:border-indigo-300' : 'cursor-not-allowed opacity-60'}`}>
              {sourceDocName ? <><span className="flex items-center gap-2 text-indigo-700 font-bold truncate"><File size={14} className="text-indigo-400 flex-shrink-0" />{sourceDocName}</span><button onClick={e => { e.stopPropagation(); setSourceDocName(''); setSourceDocId(''); }} className="text-slate-300 hover:text-rose-400"><X size={14} /></button></> : <><span className="text-slate-400">{site.datto_folder_id ? 'Click to browse documents…' : 'No Datto folder linked'}</span><FolderOpen size={16} className="text-slate-300" /></>}
            </div>
          )}
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-black text-sm uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save Action'}</button>
          <button onClick={onCancel} className="px-6 py-3 bg-white border border-slate-200 text-slate-500 rounded-xl font-black text-sm uppercase tracking-wider hover:bg-slate-50">Cancel</button>
        </div>
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
          red: 0, amber: 0, green: 0, lastReview: '—',
          datto_folder_id: s.datto_folder_id || orgFolderMap.get(s.organisation_id) || null,
          advisor_id: s.advisor_id ?? null,
        }));
        setSites(mapped);
        if (mapped.length > 0 && !selectedSite) setSelectedSite(mapped[0]);
      }
    };
    load();
  }, [user, profile, organisations]);

  useEffect(() => {
    if (!user || sites.length === 0) return;
    const priorityMap: Record<string, Priority> = { critical: 'red', upcoming: 'amber', scheduled: 'green' };
    const siteIds = sites.map(s => s.id);
    supabase.from('actions').select('*').in('site_id', siteIds).then(({ data }) => {
      if (data) setAllActions(data.map((a: any) => ({ id: a.id, action: a.title, description: a.description || '', date: a.due_date || '', site: sites.find(s => s.id === a.site_id)?.name || '', who: '', contractor: a.contractor || '', source: a.source_document_name || '', source_document_id: a.source_document_id || '', priority: (priorityMap[a.priority] || 'green') as Priority, regulation: a.regulation || '', notes: '', status: a.status as ActionStatus })));
    });
  }, [user, sites]);

  const handleLogout = async () => { await supabase.auth.signOut(); setUser(null); setProfile(null); setSites([]); setOrganisations([]); };
  const handleDattoSync = () => { setIsSyncing(true); setTimeout(() => { setIsSyncing(false); setSyncLastRun('Just now'); }, 2000); };
  const toggleResolve = (id: string) => setResolvedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  const handleAddNote = (id: string, note: string) => { if (note.trim()) setActionNotes(prev => ({ ...prev, [id]: note.trim() })); };
  const handleSiteClick = (site: Site) => { setSelectedSite(site); setView('site'); };
  const handleActionSaved = (action: Action) => { setAllActions(prev => [...prev, action]); setShowAddAction(false); };

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
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{site.type}</p>
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
                  <div className="flex gap-3">
                    <button className="bg-slate-100 text-slate-600 px-6 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-slate-200">Audit Archive</button>
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
              <div className="grid grid-cols-3 gap-4">
                {[{ label: 'Open Actions', value: openCount, color: 'text-slate-900', sub: 'requires attention' }, { label: 'Resolved', value: resolvedCount, color: 'text-emerald-600', sub: 'this session' }, { label: 'Compliance Score', value: `${selectedSite.compliance}%`, color: 'text-indigo-600', sub: `${selectedSite.trend >= 0 ? '+' : ''}${selectedSite.trend}% vs last period` }].map(stat => (
                  <div key={stat.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm text-center"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{stat.label}</p><p className={`text-3xl font-black ${stat.color}`}>{stat.value}</p><p className="text-[10px] text-slate-400 font-medium mt-1">{stat.sub}</p></div>
                ))}
              </div>
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
              <div className="space-y-3">
                {filteredActions.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center"><CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-3" /><p className="font-black text-slate-700">No actions in this category</p><p className="text-sm text-slate-400 mt-1">All items resolved or filtered out.</p></div>
                ) : filteredActions.map(action => <ActionCard key={action.id} action={{ ...action, notes: actionNotes[action.id] || action.notes }} isResolved={resolvedIds.includes(action.id)} onToggleResolve={toggleResolve} onAddNote={handleAddNote} role={profile?.role || 'client'} />)}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}