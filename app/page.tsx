"use client";
import React, { useState, useEffect } from 'react';
import {
  ShieldAlert, ChevronRight, Building2, ClipboardList, AlertCircle,
  CheckCircle2, FileText, ArrowLeft, User, Layout, MapPin,
  Clock, Briefcase, Factory, Wrench, RefreshCw, Database, ExternalLink,
  CheckCircle, Settings, LogOut, Truck, PenTool, BarChart3, TrendingUp,
  ChevronDown, ChevronUp, Paperclip, MessageSquare, HardHat, Calendar,
  Zap, AlertTriangle, Target, Activity, Shield, ArrowUpRight, X, Plus
} from 'lucide-react';
import { supabase } from './lib/supabase';

type Priority = 'red' | 'amber' | 'green';
type ActionStatus = 'open' | 'resolved';

interface Action {
  id: number;
  action: string;
  description: string;
  date: string;
  site: string;
  who: string;
  contractor?: string;
  source: string;
  priority: Priority;
  regulation: string;
  notes: string;
  evidenceLabel?: string;
  status: ActionStatus;
}

interface Site {
  id: number;
  name: string;
  type: string;
  red: number;
  amber: number;
  green: number;
  compliance: number;
  lastReview: string;
  trend: number;
}

const allActions: Action[] = [
  {
    id: 1,
    action: "Install interlocking guarding on CNC Milling Machine #08",
    description: "Machine #08 currently has no interlocking guard fitted to the spindle access panel. Risk of entanglement with rotating parts during operation. Immediate isolation and guarding required before return to service.",
    date: "2024-03-01",
    site: "Main Assembly Factory",
    who: "Factory Manager",
    contractor: "SafeGuard Engineering Ltd",
    source: "PUWER Audit — Feb 2024",
    priority: "red",
    regulation: "PUWER 1998, Reg. 11",
    notes: "Machine has been isolated pending repair. Contractor quotation received — awaiting sign-off.",
    evidenceLabel: "PUWER_Audit_Feb24.pdf",
    status: "open",
  },
  {
    id: 2,
    action: "Thorough examination of LEV system in grinding bay",
    description: "The local exhaust ventilation (LEV) system serving the grinding bay is overdue its 14-month statutory thorough examination. Airborne dust levels may exceed WELs without confirmed extraction performance.",
    date: "2024-03-05",
    site: "Tooling & Die Workshop",
    who: "Workshop Lead",
    contractor: "AirCheck Compliance Services",
    source: "LEV Certification Log",
    priority: "red",
    regulation: "COSHH 2002, Reg. 9",
    notes: "Annual certificate expired Jan 2024. Contractor booked for w/c 04 March.",
    evidenceLabel: "LEV_Cert_Expired_Jan24.pdf",
    status: "open",
  },
  {
    id: 3,
    action: "Replace damaged racking uprights in Aisle 4",
    description: "Two uprights in Aisle 4 show visible impact damage at base plate level, reducing rated load capacity. Area has been cordoned off. Structural assessment and replacement required before re-use.",
    date: "2024-03-12",
    site: "Logistics & Storage Hub",
    who: "Warehouse Supervisor",
    contractor: "RackSafe Ltd",
    source: "Racking Inspection — Jan 2024",
    priority: "amber",
    regulation: "PUWER 1998 / SEMA CoP",
    notes: "Aisle 4 cordoned with barrier tape. Awaiting structural engineer sign-off on adjacent bays.",
    evidenceLabel: "Racking_Inspection_Jan24.pdf",
    status: "open",
  },
  {
    id: 4,
    action: "Update Display Screen Equipment assessments for design team",
    description: "DSE self-assessments for 8 members of the design team are due for renewal. Three staff members have raised musculoskeletal concerns in recent months which should be captured in updated assessments.",
    date: "2024-04-05",
    site: "Design & R&D Studio",
    who: "Studio Lead",
    source: "DSE Review Schedule",
    priority: "green",
    regulation: "DSE Regulations 1992",
    notes: "Template updated. Team lead to distribute and collect by end of March.",
    status: "open",
  },
  {
    id: 5,
    action: "Review and update site-specific COSHH inventory for new adhesive compounds",
    description: "Two new adhesive compounds (Araldite 2047 and Loctite 3090) have been introduced to the assembly process without formal COSHH assessment. Safety data sheets received but assessments not yet completed.",
    date: "2024-03-20",
    site: "Main Assembly Factory",
    who: "Factory Manager",
    source: "COSHH Register Review",
    priority: "amber",
    regulation: "COSHH 2002",
    notes: "SDSs filed. H&S Advisor to complete assessments during site visit w/c 18 March.",
    status: "open",
  },
  {
    id: 6,
    action: "Renew forklift operator certifications for 3 warehouse staff",
    description: "Certificates for operators J. Patel, R. Clarke, and M. Osei expired in February 2024. Operators must not use FLT equipment until renewed certification is in place.",
    date: "2024-03-08",
    site: "Logistics & Storage Hub",
    who: "Warehouse Supervisor",
    contractor: "RTITB Accredited Training Centre",
    source: "Training Matrix — Q1 Review",
    priority: "amber",
    regulation: "LOLER 1998 / ACOP L117",
    notes: "Operators temporarily reassigned to ground duties. Training course confirmed for 07 March.",
    evidenceLabel: "Training_Matrix_Q1_2024.xlsx",
    status: "open",
  },
];

const getSiteIcon = (type: string, size = 20) => {
  switch (type) {
    case 'Manufacturing': return <Factory size={size} />;
    case 'Workshop': return <Wrench size={size} />;
    case 'Logistics': return <Truck size={size} />;
    case 'Office': return <PenTool size={size} />;
    default: return <Building2 size={size} />;
  }
};

const priorityConfig = {
  red:   { label: 'Critical',  bg: 'bg-rose-50',   border: 'border-rose-200',  text: 'text-rose-700',   bar: 'bg-rose-500',   dot: 'bg-rose-500',   badge: 'bg-rose-100 text-rose-700 border-rose-200' },
  amber: { label: 'Upcoming',  bg: 'bg-amber-50',  border: 'border-amber-200', text: 'text-amber-700',  bar: 'bg-amber-500',  dot: 'bg-amber-500',  badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  green: { label: 'Scheduled', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', bar: 'bg-emerald-500', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};

const StatusBadge = ({ type, count }: { type: Priority; count: number }) => {
  const c = priorityConfig[type];
  return (
    <div className={`px-2 py-1 rounded-lg border text-[10px] font-black flex items-center gap-1.5 ${c.badge}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {count} {type.toUpperCase()}
    </div>
  );
};

const ComplianceRing = ({ score, size = 56 }: { score: number; size?: number }) => {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 90 ? '#10b981' : score >= 75 ? '#6366f1' : '#f43f5e';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r={r} stroke="#f1f5f9" strokeWidth="5" fill="none" />
      <circle cx="24" cy="24" r={r} stroke={color} strokeWidth="5" fill="none"
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform="rotate(-90 24 24)"
        style={{ transition: 'stroke-dashoffset 1s ease' }}
      />
      <text x="24" y="28" textAnchor="middle" fontSize="10" fontWeight="900" fill={color}>{score}</text>
    </svg>
  );
};

const ActionCard = ({
  action, isResolved, onToggleResolve, onAddNote,
}: {
  action: Action; isResolved: boolean;
  onToggleResolve: (id: number) => void;
  onAddNote: (id: number, note: string) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const cfg = priorityConfig[action.priority];

  return (
    <div className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
      isResolved ? 'bg-slate-50/60 border-slate-100 opacity-60' : `${cfg.bg} ${cfg.border}`
    }`}>
      <div className="p-6 flex flex-col md:flex-row md:items-start gap-4">
        <div className={`w-1.5 rounded-full self-stretch hidden md:block flex-shrink-0 transition-colors ${
          isResolved ? 'bg-slate-300' : cfg.bar
        }`} style={{ minHeight: 64 }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <h4 className={`font-bold text-lg leading-snug ${isResolved ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
              {action.action}
            </h4>
            <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-lg border flex-shrink-0 ${
              isResolved ? 'bg-white border-slate-200 text-slate-400' : `border ${cfg.badge}`
            }`}>
              {isResolved ? 'Resolved' : cfg.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 mt-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            <span className="flex items-center gap-1.5"><Clock size={12} /> <span className="text-slate-700">{action.date}</span></span>
            <span className="flex items-center gap-1.5"><User size={12} /> <span className="text-slate-700">{action.who}</span></span>
            {action.contractor && (
              <span className="flex items-center gap-1.5"><HardHat size={12} /> <span className="text-slate-700">{action.contractor}</span></span>
            )}
            <span className="flex items-center gap-1.5 text-indigo-500"><Shield size={12} /> {action.regulation}</span>
            <span className="flex items-center gap-1.5 text-indigo-400 underline decoration-indigo-200 underline-offset-2 cursor-pointer hover:text-indigo-600 transition-colors">
              <FileText size={12} /> {action.source}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setExpanded(e => !e)}
            className="p-2.5 rounded-xl bg-white/80 border border-white/60 text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button onClick={() => onToggleResolve(action.id)}
            className={`px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all active:scale-95 shadow-sm flex items-center gap-2 ${
              isResolved ? 'bg-white border border-slate-200 text-slate-400' : 'bg-slate-900 text-white hover:bg-indigo-700'
            }`}>
            {isResolved ? <><X size={13} /> Undo</> : <><CheckCircle size={13} /> Resolve</>}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/60 bg-white/60 backdrop-blur-sm px-6 py-5 space-y-5 animate-in slide-in-from-top-2 duration-200">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Requirement Detail</p>
            <p className="text-sm text-slate-700 leading-relaxed">{action.description}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 flex items-center gap-1.5"><MessageSquare size={11} /> Advisor Notes</p>
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 leading-relaxed min-h-[48px]">
                {action.notes || <span className="text-slate-300 italic">No notes added.</span>}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 flex items-center gap-1.5"><Paperclip size={11} /> Evidence</p>
              {action.evidenceLabel ? (
                <div className="bg-white rounded-xl border border-indigo-100 px-4 py-3 flex items-center gap-3 cursor-pointer hover:border-indigo-300 transition-colors group">
                  <FileText size={16} className="text-indigo-400 group-hover:text-indigo-600 transition-colors flex-shrink-0" />
                  <span className="text-xs font-bold text-indigo-600 truncate">{action.evidenceLabel}</span>
                  <ExternalLink size={12} className="text-slate-300 group-hover:text-indigo-400 transition-colors ml-auto flex-shrink-0" />
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-dashed border-slate-200 px-4 py-3 flex items-center justify-center gap-2 cursor-pointer hover:border-indigo-300 transition-colors group">
                  <Plus size={14} className="text-slate-300 group-hover:text-indigo-400 transition-colors" />
                  <span className="text-xs font-bold text-slate-300 group-hover:text-indigo-400 transition-colors">Upload Evidence</span>
                </div>
              )}
            </div>
          </div>
          {showNoteInput ? (
            <div className="flex gap-2 items-start">
              <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
                placeholder="Add a progress note…" rows={2}
                className="flex-1 text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none bg-white" />
              <div className="flex flex-col gap-2">
                <button onClick={() => { onAddNote(action.id, noteText); setNoteText(''); setShowNoteInput(false); }}
                  className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 transition-colors">Save</button>
                <button onClick={() => setShowNoteInput(false)}
                  className="px-4 py-2.5 bg-white border border-slate-200 text-slate-400 rounded-xl text-xs font-black hover:bg-slate-50 transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowNoteInput(true)}
              className="text-[11px] font-black uppercase tracking-wider text-indigo-500 hover:text-indigo-700 flex items-center gap-1.5 transition-colors">
              <Plus size={13} /> Add Note
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [view, setView] = useState<'portfolio' | 'site'>('portfolio');
  const [dashboardTab, setDashboardTab] = useState<'analytics' | 'data'>('analytics');
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLastRun, setSyncLastRun] = useState('2 hours ago');
  const [resolvedIds, setResolvedIds] = useState<number[]>([]);
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all');
  const [actionNotes, setActionNotes] = useState<Record<number, string>>({});
  const [sites, setSites] = useState<Site[]>([]);

  useEffect(() => {
    supabase.from('sites').select('*').then(({ data }) => {
      if (data) setSites(data.map((s: any) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        compliance: s.compliance_score,
        trend: s.trend,
        red: 0,
        amber: 0,
        green: 0,
        lastReview: '—',
      })));
    });
  }, []);

  const handleDattoSync = () => {
    setIsSyncing(true);
    setTimeout(() => { setIsSyncing(false); setSyncLastRun('Just now'); }, 2000);
  };

  const toggleResolve = (id: number) =>
    setResolvedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const handleAddNote = (id: number, note: string) => {
    if (note.trim()) setActionNotes(prev => ({ ...prev, [id]: note.trim() }));
  };

  const handleSiteClick = (site: Site) => { setSelectedSite(site); setView('site'); };

  const siteActions = selectedSite
    ? allActions.filter(a => a.site === selectedSite.name)
    : allActions;

  const filteredActions = filterPriority === 'all'
    ? siteActions
    : siteActions.filter(a => a.priority === filterPriority);

  const openCount = siteActions.filter(a => !resolvedIds.includes(a.id)).length;
  const resolvedCount = siteActions.filter(a => resolvedIds.includes(a.id)).length;
  const criticalCount = allActions.filter(a => a.priority === 'red').length;
  const upcomingCount = allActions.filter(a => a.priority === 'amber').length;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-indigo-100">
      <aside className="fixed left-0 top-0 h-full w-20 bg-indigo-950 flex flex-col items-center py-8 gap-10 text-indigo-300 z-20">
        <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-indigo-950 shadow-lg font-black text-xl italic hover:scale-105 transition-transform">PE</div>
        <nav className="flex flex-col gap-6">
          <button onClick={() => { setView('portfolio'); setSelectedSite(null); }}
            className={`p-3 rounded-xl transition-all ${view === 'portfolio' ? 'bg-indigo-700 text-white shadow-inner' : 'hover:text-white hover:bg-white/5'}`}
            title="Portfolio Dashboard"><Layout size={22} /></button>
          <button onClick={() => { setView('site'); setSelectedSite(sites[0]); }}
            className={`p-3 rounded-xl transition-all ${view === 'site' ? 'bg-indigo-700 text-white shadow-inner' : 'hover:text-white hover:bg-white/5'}`}
            title="Action Plans"><ClipboardList size={22} /></button>
          <button className="p-3 rounded-xl hover:text-white hover:bg-white/5 transition-colors" title="Settings">
            <Settings size={22} /></button>
        </nav>
        <div className="mt-auto flex flex-col gap-5 items-center">
          <button onClick={handleDattoSync}
            className={`p-3 rounded-xl transition-all ${isSyncing ? 'text-white animate-spin' : 'hover:text-white hover:bg-white/5'}`}
            title="Sync"><RefreshCw size={22} /></button>
          <div className="w-10 h-10 rounded-full bg-indigo-800 flex items-center justify-center font-black text-white text-xs border border-indigo-700">JD</div>
        </div>
      </aside>

      <main className="pl-20">
        <header className="bg-white/95 backdrop-blur-sm border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            {view === 'site' && (
              <button onClick={() => setView('portfolio')} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors">
                <ArrowLeft size={18} />
              </button>
            )}
            <div>
              <h1 className="text-base font-black text-slate-900 tracking-tight leading-none">Precision Engineering Ltd</h1>
              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                <Database size={9} /> <span>Portal Sync: {syncLastRun}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-black text-slate-800">Operations Director</p>
              <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">● Compliant</p>
            </div>
            <div className="hidden lg:flex bg-slate-100 p-1 rounded-xl">
              <button onClick={() => { setView('portfolio'); setSelectedSite(null); }}
                className={`px-4 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${view === 'portfolio' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                Dashboard</button>
              <button onClick={() => { setView('site'); setSelectedSite(sites[0]); }}
                className={`px-4 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${view === 'site' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                Action Plan</button>
            </div>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {view === 'portfolio' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 rounded-3xl p-10 text-white flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500 rounded-full -mr-32 -mt-32 blur-[100px] opacity-20 pointer-events-none" />
                <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-violet-600 rounded-full -mb-32 blur-[80px] opacity-10 pointer-events-none" />
                <div className="relative z-10">
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-300">Executive Summary</span>
                  <h2 className="text-4xl font-black tracking-tighter mt-2">Divisional Compliance</h2>
                  <p className="text-indigo-300 mt-2 max-w-md text-sm">Real-time H&S status across all manufacturing departments and sites.</p>
                </div>
                <div className="flex gap-4 relative z-10">
                  {[
                    { label: 'Critical', value: criticalCount, color: 'text-rose-400', icon: <Zap size={14} /> },
                    { label: 'Upcoming', value: upcomingCount, color: 'text-amber-400', icon: <Clock size={14} /> },
                    { label: 'Sites', value: sites.length, color: 'text-indigo-300', icon: <Building2 size={14} /> },
                  ].map(stat => (
                    <div key={stat.label} className="bg-white/5 backdrop-blur-md rounded-2xl p-5 border border-white/10 text-center min-w-[90px]">
                      <div className={`flex items-center justify-center gap-1 text-[10px] font-black uppercase tracking-widest opacity-70 mb-1.5 ${stat.color}`}>{stat.icon} {stat.label}</div>
                      <p className={`text-4xl font-black ${stat.color}`}>{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex border-b border-slate-200 gap-6">
                {[
                  { key: 'analytics', label: 'Visual Analytics', icon: <BarChart3 size={14} /> },
                  { key: 'data', label: 'Division Registry', icon: <Building2 size={14} /> },
                ].map(tab => (
                  <button key={tab.key}
                    onClick={() => setDashboardTab(tab.key as 'analytics' | 'data')}
                    className={`pb-4 px-1 text-[11px] font-black uppercase tracking-widest flex items-center gap-2 border-b-2 transition-all ${
                      dashboardTab === tab.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}>
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>

              {dashboardTab === 'analytics' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-500">
                  <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                    <div className="flex items-center justify-between mb-8">
                      <h3 className="font-black text-slate-900 text-lg tracking-tight uppercase">Compliance Benchmarking</h3>
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-lg">Q1 2024</span>
                    </div>
                    <div className="space-y-6">
                      {sites.map(site => (
                        <div key={site.id} className="group cursor-pointer" onClick={() => handleSiteClick(site)}>
                          <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-3">
                              <div className="w-7 h-7 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all text-xs">
                                {getSiteIcon(site.type, 14)}
                              </div>
                              <span className="text-sm font-bold text-slate-700 group-hover:text-indigo-700 transition-colors">{site.name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`text-[10px] font-black flex items-center gap-1 ${site.trend >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {site.trend >= 0 ? <TrendingUp size={11} /> : <ArrowUpRight size={11} className="rotate-90" />}
                                {site.trend >= 0 ? '+' : ''}{site.trend}%
                              </span>
                              <span className={`font-black text-sm ${site.compliance >= 90 ? 'text-emerald-600' : site.compliance >= 75 ? 'text-indigo-600' : 'text-rose-600'}`}>{site.compliance}%</span>
                            </div>
                          </div>
                          <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden shadow-inner">
                            <div className={`h-full rounded-full transition-all duration-1000 ${site.compliance >= 90 ? 'bg-emerald-500' : site.compliance >= 75 ? 'bg-indigo-500' : 'bg-rose-500'}`}
                              style={{ width: `${site.compliance}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm flex flex-col">
                    <h3 className="font-black text-slate-900 text-lg tracking-tight uppercase mb-6">Action Summary</h3>
                    <div className="flex-1 flex flex-col justify-center items-center">
                      <div className="relative w-36 h-36 flex items-center justify-center mb-6">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 160 160">
                          <circle cx="80" cy="80" r="70" stroke="#f1f5f9" strokeWidth="16" fill="none" />
                          <circle cx="80" cy="80" r="70" stroke="#f43f5e" strokeWidth="16" fill="none"
                            strokeDasharray="440" strokeDashoffset="418" strokeLinecap="round" />
                        </svg>
                        <div className="absolute text-center">
                          <p className="text-3xl font-black text-slate-900 leading-none">{allActions.length}</p>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Total</p>
                        </div>
                      </div>
                      <div className="w-full space-y-2.5">
                        {[
                          { label: 'Critical / Urgent', count: criticalCount, color: 'bg-rose-50 text-rose-700 border-rose-100' },
                          { label: 'Upcoming (Amber)', count: upcomingCount, color: 'bg-amber-50 text-amber-700 border-amber-100' },
                          { label: 'Scheduled (Green)', count: allActions.filter(a => a.priority === 'green').length, color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
                        ].map(item => (
                          <div key={item.label} className={`flex items-center justify-between text-xs font-black px-4 py-2.5 rounded-xl border ${item.color}`}>
                            <span>{item.label}</span>
                            <span className="text-base font-black">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                    {sites.map(site => (
                      <div key={site.id}
                        className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all group"
                        onClick={() => handleSiteClick(site)}>
                        <div className="flex items-start justify-between mb-4">
                          <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                            {getSiteIcon(site.type)}
                          </div>
                          <ComplianceRing score={site.compliance} />
                        </div>
                        <p className="font-black text-sm text-slate-800 leading-tight mb-1">{site.name}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">{site.type}</p>
                        <div className="flex gap-1.5">
                          {site.red > 0 && <StatusBadge type="red" count={site.red} />}
                          {site.amber > 0 && <StatusBadge type="amber" count={site.amber} />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {dashboardTab === 'data' && (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50/80 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100">
                        <th className="px-8 py-4">Department / Site</th>
                        <th className="px-8 py-4">Type</th>
                        <th className="px-8 py-4">Status</th>
                        <th className="px-8 py-4">Score</th>
                        <th className="px-8 py-4">Last Review</th>
                        <th className="px-8 py-4"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sites.map(site => (
                        <tr key={site.id}
                          className="hover:bg-indigo-50/30 transition-colors cursor-pointer group"
                          onClick={() => handleSiteClick(site)}>
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm">
                                {getSiteIcon(site.type)}
                              </div>
                              <span className="font-bold text-slate-800">{site.name}</span>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 bg-slate-50 border border-slate-100 px-3 py-1 rounded-lg">{site.type}</span>
                          </td>
                          <td className="px-8 py-5">
                            <div className="flex gap-1.5">
                              {site.red > 0 && <StatusBadge type="red" count={site.red} />}
                              {site.amber > 0 && <StatusBadge type="amber" count={site.amber} />}
                              <StatusBadge type="green" count={site.green} />
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            <ComplianceRing score={site.compliance} size={40} />
                          </td>
                          <td className="px-8 py-5 text-sm font-bold text-slate-600">{site.lastReview}</td>
                          <td className="px-8 py-5 text-right">
                            <ChevronRight size={16} className="text-slate-300 inline group-hover:translate-x-1 transition-transform" />
                          </td>
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
                    <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl">
                      {getSiteIcon(selectedSite.type, 28)}
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-slate-900 tracking-tight">{selectedSite.name}</h2>
                      <p className="text-slate-500 text-sm mt-1">Last audit: {selectedSite.lastReview} · {selectedSite.type}</p>
                      <div className="flex gap-2 mt-3">
                        {selectedSite.red > 0 && <StatusBadge type="red" count={selectedSite.red} />}
                        {selectedSite.amber > 0 && <StatusBadge type="amber" count={selectedSite.amber} />}
                        <StatusBadge type="green" count={selectedSite.green} />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button className="bg-slate-100 text-slate-600 px-6 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all">
                      Audit Archive</button>
                    <button className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest shadow-lg hover:bg-indigo-700 transition-all">
                      Export Plan</button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Open Actions', value: openCount, color: 'text-slate-900', sub: 'requires attention' },
                  { label: 'Resolved', value: resolvedCount, color: 'text-emerald-600', sub: 'this session' },
                  { label: 'Compliance Score', value: `${selectedSite.compliance}%`, color: 'text-indigo-600', sub: `${selectedSite.trend >= 0 ? '+' : ''}${selectedSite.trend}% vs last period` },
                ].map(stat => (
                  <div key={stat.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm text-center">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{stat.label}</p>
                    <p className={`text-3xl font-black ${stat.color}`}>{stat.value}</p>
                    <p className="text-[10px] text-slate-400 font-medium mt-1">{stat.sub}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-2">Filter:</span>
                {(['all', 'red', 'amber', 'green'] as const).map(f => (
                  <button key={f} onClick={() => setFilterPriority(f)}
                    className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider border transition-all ${
                      filterPriority === f
                        ? f === 'all' ? 'bg-slate-900 text-white border-slate-900'
                          : f === 'red' ? 'bg-rose-600 text-white border-rose-600'
                          : f === 'amber' ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                    }`}>
                    {f === 'all' ? 'All' : f === 'red' ? 'Critical' : f === 'amber' ? 'Upcoming' : 'Scheduled'}
                    {f !== 'all' && <span className="ml-1.5 opacity-70">({siteActions.filter(a => a.priority === f).length})</span>}
                  </button>
                ))}
                <span className="ml-auto text-[11px] font-bold text-slate-400">{filteredActions.length} action{filteredActions.length !== 1 ? 's' : ''}</span>
              </div>

              <div className="space-y-3">
                {filteredActions.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                    <CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-3" />
                    <p className="font-black text-slate-700">No actions in this category</p>
                    <p className="text-sm text-slate-400 mt-1">All items resolved or filtered out.</p>
                  </div>
                ) : (
                  filteredActions.map(action => (
                    <ActionCard
                      key={action.id}
                      action={{ ...action, notes: actionNotes[action.id] || action.notes }}
                      isResolved={resolvedIds.includes(action.id)}
                      onToggleResolve={toggleResolve}
                      onAddNote={handleAddNote}
                    />
                  ))
                )}
              </div>

              <div className="pt-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Switch Site</p>
                <div className="flex gap-3 flex-wrap">
                  {sites.map(site => (
                    <button key={site.id} onClick={() => setSelectedSite(site)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black border transition-all ${
                        selectedSite.id === site.id
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                      }`}>
                      {getSiteIcon(site.type, 14)}
                      {site.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}