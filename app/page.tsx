"use client";
import React, { useState } from 'react';
import { 
  ShieldAlert, ChevronRight, Building2, ClipboardList, AlertCircle, 
  CheckCircle2, FileText, Filter, ArrowLeft, Search, User, Layout, MapPin, 
  Clock, Briefcase, Factory, Wrench, RefreshCw, Database, ExternalLink, 
  CheckCircle, Info, Settings, LogOut, Truck, PenTool, BarChart3, TrendingUp
} from 'lucide-react';

export default function App() {
  const [view, setView] = useState('portfolio'); 
  const [dashboardTab, setDashboardTab] = useState('analytics');
  const [selectedSite, setSelectedSite] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLastRun, setSyncLastRun] = useState('2 hours ago');
  const [resolvedIds, setResolvedIds] = useState([]);

  const handleDattoSync = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      setSyncLastRun('Just now');
    }, 2000);
  };

  const toggleResolve = (id) => {
    setResolvedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const clientOrg = {
    name: "Precision Engineering Ltd",
    role: "Operations Director",
    status: { red: 5, amber: 12, green: 87 }
  };

  const sites = [
    { id: 1, name: "Main Assembly Factory", type: "Manufacturing", red: 2, amber: 4, green: 30, compliance: 82, lastReview: '2024-02-20' },
    { id: 2, name: "Tooling & Die Workshop", type: "Workshop", red: 2, amber: 3, green: 15, compliance: 75, lastReview: '2024-02-22' },
    { id: 3, name: "Logistics & Storage Hub", type: "Logistics", red: 1, amber: 2, green: 22, compliance: 90, lastReview: '2024-01-15' },
    { id: 4, name: "Design & R&D Studio", type: "Office", red: 0, amber: 3, green: 20, compliance: 95, lastReview: '2024-02-10' },
  ];

  const siteActions = [
    { id: 1, action: "Install interlocking guarding on CNC Milling Machine #08", date: "2024-03-01", site: "Main Assembly", who: "Factory Manager", source: "PUWER Audit", priority: "red" },
    { id: 2, action: "Thorough examination of LEV system in grinding bay", date: "2024-03-05", site: "Tooling Workshop", who: "Workshop Lead", source: "LEV Certification", priority: "red" },
    { id: 3, action: "Replace damaged racking uprights in Aisle 4", date: "2024-03-12", site: "Logistics Hub", who: "Warehouse Sup", source: "Racking Inspection", priority: "amber" },
    { id: 4, action: "Update Display Screen Equipment (DSE) assessments for design team", date: "2024-04-05", site: "R&D Studio", who: "Studio Lead", source: "DSE Review", priority: "green" },
  ];

  const handleSiteClick = (site) => {
    setSelectedSite(site);
    setView('site');
  };

  const getSiteIcon = (type) => {
    switch (type) {
      case 'Manufacturing': return <Factory size={20} />;
      case 'Workshop': return <Wrench size={20} />;
      case 'Logistics': return <Truck size={20} />;
      case 'Office': return <PenTool size={20} />;
      default: return <Building2 size={20} />;
    }
  };

  const StatusBadge = ({ type, count }) => {
    const colors = {
      red: 'bg-rose-50 text-rose-700 border-rose-100',
      amber: 'bg-amber-50 text-amber-700 border-amber-100',
      green: 'bg-emerald-50 text-emerald-700 border-emerald-100'
    };
    return (
      <div className={`px-2 py-1 rounded border text-[10px] font-bold flex items-center gap-1.5 ${colors[type]}`}>
        <div className={`w-1.5 h-1.5 rounded-full ${type === 'red' ? 'bg-rose-500' : type === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
        {count} {type.toUpperCase()}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-indigo-100">
      <aside className="fixed left-0 top-0 h-full w-20 bg-indigo-950 flex flex-col items-center py-8 gap-10 text-indigo-300 z-20 text-center">
        <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-indigo-950 shadow-lg font-black text-xl italic hover:scale-105 transition-transform mx-auto">PE</div>
        <nav className="flex flex-col gap-8">
          <button onClick={() => { setView('portfolio'); setSelectedSite(null); }} className={`p-3 rounded-xl transition-all ${view === 'portfolio' ? 'bg-indigo-800 text-white shadow-inner' : 'hover:text-white'}`}><Layout size={24} /></button>
          <button onClick={() => { setView('site'); setSelectedSite(sites[0]); }} className={`p-3 rounded-xl transition-all ${view === 'site' ? 'bg-indigo-800 text-white shadow-inner' : 'hover:text-white'}`}><ClipboardList size={24} /></button>
          <button className="p-3 rounded-xl hover:text-white transition-colors hover:bg-white/5"><Settings size={24} /></button>
        </nav>
        <div className="mt-auto flex flex-col gap-6">
          <button onClick={handleDattoSync} className={`p-3 rounded-xl transition-all ${isSyncing ? 'text-white animate-spin' : 'hover:text-white hover:bg-white/5'}`} title="Sync with Datto Workplace">
            <RefreshCw size={24} />
          </button>
          <div className="w-10 h-10 rounded-full bg-indigo-800 flex items-center justify-center font-bold text-white text-xs border border-indigo-700 mx-auto">JD</div>
        </div>
      </aside>

      <main className="pl-20">
        <header className="bg-white/90 backdrop-blur-sm border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-4 text-left">
            {view === 'site' && (<button onClick={() => setView('portfolio')} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"><ArrowLeft size={20} /></button>)}
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-none">{clientOrg.name}</h1>
              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5">
                <Database size={10} /> 
                <span>Portal Live Sync: {syncLastRun}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
             <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-slate-800">Operations Director</p>
                <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest italic">Status: Compliant</p>
             </div>
             <div className="hidden lg:flex bg-slate-100 p-1 rounded-lg">
                <button onClick={() => { setView('portfolio'); setSelectedSite(null); }} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded transition-all ${view === 'portfolio' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Dashboard</button>
                <button onClick={() => { setView('site'); setSelectedSite(sites[0]); }} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded transition-all ${view === 'site' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Action Plan</button>
             </div>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {view === 'portfolio' ? (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 rounded-3xl p-10 text-white flex justify-between items-center shadow-2xl relative overflow-hidden text-left">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500 rounded-full -mr-32 -mt-32 blur-[100px] opacity-20" />
                <div className="relative z-10">
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-300">Executive Summary</span>
                  <h2 className="text-4xl font-black italic tracking-tighter uppercase mt-2">Divisional Compliance</h2>
                  <p className="text-indigo-200 mt-2 font-medium max-w-md italic italic">Real-time safety performance across all site operations.</p>
                </div>
                <div className="flex gap-6 relative z-10 text-center">
                   <div className="bg-white/5 backdrop-blur-md rounded-2xl p-6 border border-white/10 w-32">
                     <p className="text-[10px] uppercase font-bold opacity-60 tracking-widest mb-1 text-white">Overdue</p>
                     <p className="text-4xl font-black text-rose-400">5</p>
                   </div>
                   <div className="bg-white/5 backdrop-blur-md rounded-2xl p-6 border border-white/10 w-32">
                     <p className="text-[10px] uppercase font-bold opacity-60 tracking-widest mb-1 text-white">Upcoming</p>
                     <p className="text-4xl font-black text-amber-400">12</p>
                   </div>
                </div>
              </div>

              <div className="flex border-b border-slate-200 gap-8">
                 <button onClick={() => setDashboardTab('analytics')} className={`pb-4 px-2 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all border-b-2 ${dashboardTab === 'analytics' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}><BarChart3 size={16} /> Visual Analytics</button>
                 <button onClick={() => setDashboardTab('data')} className={`pb-4 px-2 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all border-b-2 ${dashboardTab === 'data' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}><Building2 size={16} /> Division Registry</button>
              </div>

              {dashboardTab === 'analytics' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in slide-in-from-bottom-4 duration-500">
                  <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-8 shadow-sm text-left">
                    <h3 className="font-black text-slate-900 text-xl tracking-tight mb-8 uppercase">Compliance Benchmarking</h3>
                    <div className="space-y-6">
                      {sites.map(site => (
                        <div key={site.id}>
                          <div className="flex justify-between items-end mb-2 text-sm font-bold">
                            <span className="text-slate-700">{site.name}</span>
                            <span className="text-indigo-600">{site.compliance}%</span>
                          </div>
                          <div className="w-full bg-slate-100 h-4 rounded-full overflow-hidden flex shadow-inner">
                            <div className={`h-full rounded-full transition-all duration-1000 ${site.compliance > 85 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${site.compliance}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm flex flex-col items-center justify-center text-center">
                    <h3 className="font-black text-slate-900 text-xl tracking-tight w-full mb-8 text-left uppercase">Risk Map</h3>
                    <div className="relative w-40 h-40 flex items-center justify-center mb-8">
                       <svg className="w-full h-full -rotate-90" viewBox="0 0 160 160">
                         <circle cx="80" cy="80" r="70" stroke="#f1f5f9" strokeWidth="18" fill="none" />
                         <circle cx="80" cy="80" r="70" stroke="#f43f5e" strokeWidth="18" fill="none" strokeDasharray="440" strokeDashoffset="400" />
                       </svg>
                       <div className="absolute text-center"><p className="text-3xl font-black text-slate-900 leading-none">104</p><p className="text-[10px] font-black text-slate-400 uppercase mt-1">Actions</p></div>
                    </div>
                    <div className="w-full space-y-3 text-left">
                       <div className="flex items-center justify-between text-xs font-bold px-4 py-2 bg-rose-50 rounded-xl text-rose-700 border border-rose-100"><span>Critical Risks</span><span>5</span></div>
                       <div className="flex items-center justify-between text-xs font-bold px-4 py-2 bg-amber-50 rounded-xl text-amber-700 border border-amber-100"><span>Scheduled Items</span><span>12</span></div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden text-left">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50/50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100"><th className="px-8 py-4">Department / Site</th><th className="px-8 py-4">Status</th><th className="px-8 py-4">Score</th><th className="px-8 py-4"></th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sites.map(site => (
                        <tr key={site.id} className="hover:bg-indigo-50/30 transition-colors cursor-pointer group" onClick={() => handleSiteClick(site)}>
                          <td className="px-8 py-6 flex items-center gap-4">
                            <div className="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all transform group-hover:rotate-3 shadow-sm">{getSiteIcon(site.type)}</div>
                            <div className="font-bold text-slate-800 text-base">{site.name}</div>
                          </td>
                          <td className="px-8 py-6"><div className="flex gap-2">{site.red > 0 && <StatusBadge type="red" count={site.red} />}<StatusBadge type="green" count={site.green} /></div></td>
                          <td className="px-8 py-6 font-black text-slate-700 text-sm">{site.compliance}%</td>
                          <td className="px-8 py-6 text-right"><ChevronRight size={18} className="text-slate-300 inline group-hover:translate-x-1 transition-transform" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6 animate-in slide-in-from-right-8 duration-500 text-left">
              <div className="bg-white border border-slate-200 p-8 rounded-3xl flex flex-col md:flex-row justify-between items-center gap-8 shadow-sm border-l-[12px] border-l-indigo-600 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full -mr-16 -mt-16 opacity-50" />
                <div className="flex items-center gap-8 z-10">
                  <div className="w-20 h-20 bg-slate-900 rounded-3xl flex items-center justify-center text-white shadow-xl transform rotate-3">{getSiteIcon(selectedSite?.type || 'Manufacturing')}</div>
                  <div><h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none">{selectedSite?.name} Action Plan</h2><p className="text-slate-500 font-medium mt-3 italic max-w-lg text-left">Live requirement extraction synced from latest safety documentation.</p></div>
                </div>
                <div className="flex gap-3 z-10">
                   <button className="bg-slate-100 text-slate-600 px-8 py-3 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all shadow-sm">Audit Archive</button>
                   <button className="bg-indigo-600 text-white px-8 py-3 rounded-2xl text-xs font-black uppercase shadow-xl hover:bg-indigo-700 transition-all">Export Plan</button>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden text-left">
                <div className="divide-y divide-slate-100">
                  {siteActions.map(action => (
                    <div key={action.id} className={`p-8 flex flex-col md:flex-row md:items-center gap-8 transition-all duration-300 ${resolvedIds.includes(action.id) ? 'bg-emerald-50/30 opacity-60' : 'hover:bg-slate-50/50'}`}>
                      <div className={`w-2 h-20 rounded-full hidden md:block transition-colors ${resolvedIds.includes(action.id) ? 'bg-emerald-400' : action.priority === 'red' ? 'bg-rose-500' : 'bg-amber-500'}`} />
                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <h4 className={`font-bold text-xl leading-tight transition-colors ${resolvedIds.includes(action.id) ? 'text-slate-400 line-through font-medium' : 'text-slate-800'}`}>{action.action}</h4>
                          <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-lg border shrink-0 ml-4 shadow-sm ${resolvedIds.includes(action.id) ? 'border-emerald-200 bg-white text-emerald-600' : action.priority === 'red' ? 'border-rose-100 bg-rose-50 text-rose-600' : 'border-amber-100 bg-amber-50 text-amber-600'}`}>{resolvedIds.includes(action.id) ? 'Resolved' : action.priority === 'red' ? 'Urgent' : 'Upcoming'}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-10 gap-y-4 mt-6 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                          <span className="flex items-center gap-2.5"><Clock size={14}/> Deadline: <span className="text-slate-700 font-bold">{action.date}</span></span>
                          <span className="flex items-center gap-2.5"><User size={14}/> Owner: <span className="text-slate-700 font-bold">{action.who}</span></span>
                          <span className="flex items-center gap-2.5 text-indigo-500 underline decoration-indigo-200 underline-offset-4 font-black"><FileText size={14}/> Source: {action.source}</span>
                        </div>
                      </div>
                      <button onClick={() => toggleResolve(action.id)} className={`flex-1 md:flex-none px-8 py-3.5 rounded-2xl font-black text-xs transition-all active:scale-95 shadow-md ${resolvedIds.includes(action.id) ? 'bg-white border border-slate-200 text-slate-400 shadow-none' : 'bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-emerald-100'}`}>{resolvedIds.includes(action.id) ? "Undo" : "Resolve"}</button>
                    </div>
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
