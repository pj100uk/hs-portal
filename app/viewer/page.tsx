"use client";
import { useEffect, useState } from 'react';

export default function ViewerPage() {
  const [pdfUrl, setPdfUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fileId = params.get('fileId') || '';
    const docId = params.get('docId') || '';
    const name = params.get('fileName') || 'document';
    setFileName(name);

    const ext = name.split('.').pop()?.toLowerCase() || '';

    // Document ID based access — resolves Datto or Storage automatically
    if (docId) {
      if (['docx','doc','xlsx','xls','pptx','ppt'].includes(ext)) {
        setPdfUrl(`/api/convert?storageDocId=${encodeURIComponent(docId)}&fileName=${encodeURIComponent(name)}`);
      } else {
        setPdfUrl(`/api/storage/file?docId=${encodeURIComponent(docId)}`);
      }
      setLoading(false);
      return;
    }

    if (!fileId) {
      setError('No file ID provided.');
      setLoading(false);
      return;
    }

    // PDFs and images — serve directly from Datto
    if (ext === 'pdf' || ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
      setPdfUrl(`/api/datto/file?fileId=${fileId}&fileName=${encodeURIComponent(name)}`);
      setLoading(false);
      return;
    }

    // Office files — convert via CloudConvert
    if (['docx','doc','xlsx','xls','pptx','ppt'].includes(ext)) {
      setPdfUrl(`/api/convert?fileId=${fileId}&fileName=${encodeURIComponent(name)}`);
      setLoading(false);
      return;
    }

    // Fallback — try direct
    setPdfUrl(`/api/datto/file?fileId=${fileId}&fileName=${encodeURIComponent(name)}`);
    setLoading(false);
  }, []);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'sans-serif', color:'#64748b', gap:'12px' }}>
      <div style={{ fontSize:'24px' }}>⏳</div>
      <p style={{ margin:0 }}>Loading {fileName}…</p>
    </div>
  );

  if (error) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'sans-serif' }}>
      <p style={{ color:'#dc2626' }}>Error: {error}</p>
    </div>
  );

  return (
    <iframe
      src={pdfUrl}
      style={{ width:'100%', height:'100vh', border:'none', display:'block' }}
      title={fileName}
    />
  );
}