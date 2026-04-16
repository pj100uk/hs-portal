"use client";
import { useEffect, useState } from 'react';

const OFFICE_EXTS = ['docx','doc','xlsx','xls','pptx','ppt'];
const IMAGE_EXTS  = ['jpg','jpeg','png','gif','webp'];

type ViewerState =
  | { mode: 'loading' }
  | { mode: 'office'; embedUrl: string; pdfUrl: string; downloadUrl: string; fileName: string }
  | { mode: 'iframe'; src: string; fileName: string }
  | { mode: 'buttons'; pdfUrl: string; downloadUrl: string; fileName: string }
  | { mode: 'error'; message: string };

export default function ViewerPage() {
  const [state, setState] = useState<ViewerState>({ mode: 'loading' });

  useEffect(() => {
    const params   = new URLSearchParams(window.location.search);
    const fileId   = params.get('fileId') || '';
    const docId    = params.get('docId')  || '';
    const name     = params.get('fileName') || 'document';
    const role     = params.get('role') || 'client';
    const ext      = name.split('.').pop()?.toLowerCase() || '';
    const isOffice = OFFICE_EXTS.includes(ext);
    const isImage  = IMAGE_EXTS.includes(ext);
    const origin   = window.location.origin;

    // ── Client uploaded documents (docId) ────────────────────────────────────
    if (docId) {
      const pdfUrl      = `/api/convert?storageDocId=${encodeURIComponent(docId)}&fileName=${encodeURIComponent(name)}`;
      const downloadUrl = `/api/storage/file?docId=${encodeURIComponent(docId)}&download=1`;

      if (isOffice) {
        fetch(`/api/storage/signed-url?docId=${encodeURIComponent(docId)}`)
          .then(r => r.json())
          .then(({ url, error }) => {
            if (error || !url) {
              setState({ mode: 'buttons', pdfUrl, downloadUrl, fileName: name });
              return;
            }
            setState({
              mode: 'office',
              embedUrl: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`,
              pdfUrl,
              downloadUrl,
              fileName: name,
            });
          })
          .catch(() => setState({ mode: 'buttons', pdfUrl, downloadUrl, fileName: name }));
        return;
      }
      setState({ mode: 'iframe', src: `/api/storage/file?docId=${encodeURIComponent(docId)}`, fileName: name });
      return;
    }

    if (!fileId) { setState({ mode: 'error', message: 'No file ID provided.' }); return; }

    const dattoSrc     = `/api/datto/file?fileId=${fileId}&fileName=${encodeURIComponent(name)}`;
    const dattoFullUrl = `${origin}/api/datto/file?fileId=${fileId}&fileName=${encodeURIComponent(name)}`;

    // ── H&S docs (fileId) ────────────────────────────────────────────────────
    if (role === 'client') {
      const src = (ext === 'pdf' || isImage) ? dattoSrc : `/api/convert?fileId=${fileId}&fileName=${encodeURIComponent(name)}`;
      setState({ mode: 'iframe', src, fileName: name });
      return;
    }

    // Advisor
    if (ext === 'pdf' || isImage) {
      setState({ mode: 'iframe', src: dattoSrc, fileName: name });
    } else if (isOffice) {
      const pdfUrl      = `/api/convert?fileId=${fileId}&fileName=${encodeURIComponent(name)}`;
      const downloadUrl = dattoSrc;
      const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
      if (!isLocalhost) {
        setState({
          mode: 'office',
          embedUrl: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(dattoFullUrl)}`,
          pdfUrl,
          downloadUrl,
          fileName: name,
        });
      } else {
        setState({ mode: 'buttons', pdfUrl, downloadUrl, fileName: name });
      }
    } else {
      setState({ mode: 'iframe', src: dattoSrc, fileName: name });
    }
  }, []);

  if (state.mode === 'loading') return (
    <div style={centered}>
      <div style={{ fontSize: 24 }}>⏳</div>
      <p style={{ margin: 0, color: '#64748b', fontFamily: 'sans-serif' }}>Loading…</p>
    </div>
  );

  if (state.mode === 'error') return (
    <div style={centered}>
      <p style={{ color: '#dc2626', fontFamily: 'sans-serif' }}>Error: {state.message}</p>
    </div>
  );

  if (state.mode === 'buttons') return (
    <div style={centered}>
      <div style={{ textAlign: 'center', maxWidth: 360, padding: '0 24px' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
        <p style={{ fontFamily: 'sans-serif', fontSize: 13, color: '#94a3b8', margin: '0 0 24px', wordBreak: 'break-word' }}>
          {state.fileName}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a href={state.downloadUrl} download style={btnPrimary}>
            ⬇ Download
          </a>
          <a href={state.pdfUrl} target="_blank" rel="noopener noreferrer" style={btnGhost}>
            View as PDF
          </a>
        </div>
      </div>
    </div>
  );

  if (state.mode === 'office') return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={toolbar}>
        <span style={toolbarName}>{state.fileName}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={state.downloadUrl} download style={tbBtn}>
            ⬇ Download
          </a>
          <a href={state.pdfUrl} target="_blank" rel="noopener noreferrer" style={tbBtnGhost}>
            View as PDF
          </a>
        </div>
      </div>
      <iframe
        src={state.embedUrl}
        style={{ flex: 1, border: 'none', display: 'block' }}
        title={state.fileName}
      />
    </div>
  );

  // mode === 'iframe'
  return (
    <iframe
      src={state.src}
      style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }}
      title={state.fileName}
    />
  );
}

const centered: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh',
};
const toolbar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 16px', background: '#1e293b', gap: 12, flexShrink: 0,
};
const toolbarName: React.CSSProperties = {
  fontFamily: 'sans-serif', fontSize: 13, color: '#94a3b8',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
};
const tbBtn: React.CSSProperties = {
  padding: '6px 14px', background: '#0ea5e9', color: '#fff',
  fontFamily: 'sans-serif', fontWeight: 700, fontSize: 12, borderRadius: 8,
  textDecoration: 'none', border: '1px solid #0284c7', whiteSpace: 'nowrap',
};
const tbBtnGhost: React.CSSProperties = {
  padding: '6px 14px', background: 'transparent', color: '#94a3b8',
  fontFamily: 'sans-serif', fontWeight: 700, fontSize: 12, borderRadius: 8,
  textDecoration: 'none', border: '1px solid #334155', whiteSpace: 'nowrap',
};
const btnPrimary: React.CSSProperties = {
  display: 'block', padding: '10px 20px', background: '#0ea5e9', color: '#fff',
  fontFamily: 'sans-serif', fontWeight: 700, fontSize: 13, borderRadius: 10,
  textDecoration: 'none', border: '1px solid #0284c7',
};
const btnGhost: React.CSSProperties = {
  display: 'block', padding: '10px 20px', background: '#f8fafc', color: '#64748b',
  fontFamily: 'sans-serif', fontWeight: 700, fontSize: 13, borderRadius: 10,
  textDecoration: 'none', border: '1px solid #e2e8f0',
};
