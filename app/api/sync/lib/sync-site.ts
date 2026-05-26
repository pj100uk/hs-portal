import mammoth from 'mammoth';
import { createClient } from '@supabase/supabase-js';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { BASE_URL, AUTH_HEADER } from '../../datto/folder-utils';
import { CURRENT_EXTRACTION_VERSION } from '../../../../lib/extraction-version';
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Progress event types ──────────────────────────────────────────────────────

export type SyncEvent =
  | { type: 'scan'; siteName: string }
  | { type: 'docs_found'; siteName: string; count: number }
  | { type: 'doc_start'; siteName: string; docName: string; index: number; total: number }
  | { type: 'doc_done'; siteName: string; docName: string; index: number; total: number; newPending: number; updated: number; error?: string; skipped?: string }
  | { type: 'site_done'; siteName: string; processed: number; newPending: number; updated: number; errors: string[] };

// ── Datto folder walk ────────────────────────────────────────────────────────

const EXCLUDED_FOLDERS = ['archive', 'evidence', 'photos', '_doc_converted_tmp', 'client provided documents', 'vault', 'z-archive manual'];

function normaliseItems(raw: any): { id: string; name: string; type: 'file' | 'folder'; modified?: string }[] {
  const list: any[] = Array.isArray(raw) ? raw
    : Array.isArray(raw?.result) ? raw.result
    : Array.isArray(raw?.data) ? raw.data
    : Array.isArray(raw?.children) ? raw.children
    : Array.isArray(raw?.items) ? raw.items
    : [];
  return list.map((item: any) => ({
    ...item,
    id: String(item.id ?? item.fileId ?? item.folderId ?? ''),
    name: item.name ?? item.fileName ?? item.folderName ?? 'Unnamed',
    modified: item.modified ?? (item.time ? new Date(item.time).toISOString() : undefined),
    type: (item.type === 'folder' || item.type === 'FOLDER' || item.isDirectory === true || item.folder === true || item.folderType !== undefined || item.childCount !== undefined)
      ? 'folder' : 'file',
  }));
}

async function fetchAllFiles(
  folderId: string,
  userExcludedIds: Set<string> = new Set(),
  currentPath = ''
): Promise<{ id: string; name: string; type: 'file' | 'folder'; modified?: string; parentFolderId: string; folderPath: string }[]> {
  const res = await fetch(`${BASE_URL}/file/${folderId}/files`, {
    headers: { Authorization: AUTH_HEADER },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const raw = await res.json();
  const items = normaliseItems(raw);
  const files = items
    .filter(i => i.type === 'file')
    .map(i => ({ ...i, parentFolderId: folderId, folderPath: currentPath }));
  const folders = items.filter(i =>
    i.type === 'folder' &&
    !EXCLUDED_FOLDERS.includes(i.name.toLowerCase()) &&
    !userExcludedIds.has(i.id)
  );
  const subFiles = await Promise.all(
    folders.map(f => fetchAllFiles(f.id, userExcludedIds, currentPath ? `${currentPath}/${f.name}` : f.name))
  );
  return [...files, ...subFiles.flat()];
}

// ── Text helpers ─────────────────────────────────────────────────────────────

function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  const na = norm(a); const nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const wordsA = na.split(/\s+/).filter(w => w.length > 3 || /^\d+$/.test(w));
  const wordsB = nb.split(/\s+/).filter(w => w.length > 3 || /^\d+$/.test(w));
  const setBo = wordsB.reduce((acc: Record<string, boolean>, w) => { acc[w] = true; return acc; }, {});
  const intersection = wordsA.filter(w => setBo[w]).length;
  const unionSize = Array.from(new Set(wordsA.concat(wordsB))).length;
  return unionSize > 0 ? intersection / unionSize : 0;
}

function normaliseRiskLevel(raw: string): 'HIGH' | 'MEDIUM' | 'LOW' | null {
  const n = raw.toLowerCase().trim();
  const numMatch = n.match(/(?:^|[=:\s])(\d+)\s*$/) ?? n.match(/^(\d+)$/);
  if (numMatch) {
    const score = parseInt(numMatch[1], 10);
    return score >= 16 ? 'HIGH' : score >= 9 ? 'MEDIUM' : 'LOW';
  }
  if (/critical|extreme|intolerable|substantial|very.?high|high/.test(n) || n === 'h') return 'HIGH';
  if (/significant|moderate|med/.test(n) || n === 'm') return 'MEDIUM';
  if (/tolerable|trivial|negligible|low|none/.test(n) || n === 'l') return 'LOW';
  return null;
}

function ukToIso(raw: string): string {
  const m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (!m) return raw;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function resolveDueDate(dueDate: string | null, dueDateRelative: string | null, assessmentDate: string | null): string | null {
  if (dueDate) return ukToIso(dueDate);
  if (!dueDateRelative) return null;
  const base = assessmentDate ? new Date(assessmentDate) : new Date();
  const lower = dueDateRelative.toLowerCase();
  const n = (pattern: RegExp) => { const m = lower.match(pattern); return m ? parseInt(m[1]) : 0; };
  const months = n(/(\d+)\s*month/); const weeks = n(/(\d+)\s*week/);
  const days = n(/(\d+)\s*day/); const years = n(/(\d+)\s*year/);
  if (months) base.setMonth(base.getMonth() + months);
  else if (weeks) base.setDate(base.getDate() + weeks * 7);
  else if (days) base.setDate(base.getDate() + days);
  else if (years) base.setFullYear(base.getFullYear() + years);
  else return dueDateRelative;
  return base.toISOString().split('T')[0];
}

// ── Core sync logic ───────────────────────────────────────────────────────────

export async function runSyncForSite(siteId: string, forceAll: boolean, baseUrl: string, onProgress?: (e: SyncEvent) => void, insertStatus: 'open' | 'ai_suggested' = 'ai_suggested') {
  const errors: string[] = [];
  let processed = 0; let newPending = 0; let updated = 0;

  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .select('id, name, datto_folder_id, datto_folder_path, last_ai_sync, organisation_id, included_datto_folder_ids, excluded_datto_folder_ids')
    .eq('id', siteId)
    .single();
  if (siteErr || !site) return { processed: 0, newPending: 0, updated: 0, errors: [`Site not found: ${siteErr?.message ?? siteId}`] };
  if (!site.datto_folder_id) return { processed: 0, newPending: 0, updated: 0, errors: ['Site has no datto_folder_id'] };

  onProgress?.({ type: 'scan', siteName: site.name });

  await fetch(`${baseUrl}/api/documents?siteId=${siteId}&clientProvided=false`).catch(() => {});

  const { data: freshActionsData } = await supabase
    .from('actions')
    .select('id, title, description, due_date, site_id, source_document_name, source_document_id, source_folder_id, source_folder_path, hazard_ref, hazard, existing_controls, risk_rating, risk_level, status, responsible_person, resolved_date, issue_date, extraction_version')
    .eq('site_id', siteId);
  const currentActions = (freshActionsData ?? []).filter((a: any) => !a.site_document_id);
  const actionsForDupCheck = currentActions;

  const userExcludedIds = new Set<string>(site.excluded_datto_folder_ids ?? []);
  let allItems: Awaited<ReturnType<typeof fetchAllFiles>>;
  let allFilesForOrphanCheck: Awaited<ReturnType<typeof fetchAllFiles>>;
  if (site.included_datto_folder_ids?.length > 0) {
    const includedSet = new Set(site.included_datto_folder_ids.map(String));
    allFilesForOrphanCheck = await fetchAllFiles(site.datto_folder_id, userExcludedIds, site.datto_folder_path ?? '');
    allItems = allFilesForOrphanCheck.filter(f => includedSet.has(String(f.parentFolderId)));
  } else {
    allFilesForOrphanCheck = await fetchAllFiles(site.datto_folder_id, userExcludedIds, site.datto_folder_path ?? '');
    allItems = allFilesForOrphanCheck;
  }

  // Refresh stale paths
  const livePathMap = new Map(allItems.map(f => [String(f.id), f.folderPath]));
  const liveNameMap = new Map(allItems.map(f => [String(f.id), f.name]));
  const staleActions = currentActions.filter((a: any) =>
    a.source_document_id &&
    livePathMap.has(String(a.source_document_id)) && (
      livePathMap.get(String(a.source_document_id)) !== a.source_folder_path ||
      liveNameMap.get(String(a.source_document_id)) !== a.source_document_name
    )
  );
  if (staleActions.length > 0) {
    await Promise.all(staleActions.map((a: any) => {
      const updates: Record<string, string> = {};
      const newPath = livePathMap.get(String(a.source_document_id));
      const newName = liveNameMap.get(String(a.source_document_id));
      if (newPath !== undefined && newPath !== a.source_folder_path) updates.source_folder_path = newPath;
      if (newName !== undefined && newName !== a.source_document_name) updates.source_document_name = newName;
      return supabase.from('actions').update(updates).eq('id', a.id);
    }));
    staleActions.forEach((a: any) => {
      const newPath = livePathMap.get(String(a.source_document_id));
      const newName = liveNameMap.get(String(a.source_document_id));
      if (newPath !== undefined) a.source_folder_path = newPath;
      if (newName !== undefined) a.source_document_name = newName;
    });
  }

  const SUPPORTED_EXTS = ['.docx', '.doc', '.pdf', '.xlsx', '.xls'];
  const OFFICE_EXTS = new Set(['.docx', '.doc', '.xlsx', '.xls']);
  let docFiles = allItems.filter(i =>
    SUPPORTED_EXTS.some(ext => i.name.toLowerCase().endsWith(ext)) &&
    !i.name.toLowerCase().includes('draft')
  );

  const stemWords = (name: string): string[] =>
    name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const wordOverlap = (a: string[], b: string[]): number => {
    const setB = new Set(b);
    return a.filter(w => setB.has(w)).length / Math.min(a.length, b.length);
  };
  const stemMap = new Map<string, typeof docFiles[0]>();
  for (const f of docFiles) {
    const stem = `${(f.folderPath ?? '').toLowerCase()}::${f.name.toLowerCase().replace(/\.[^.]+$/, '')}`;
    const ext = (f.name.toLowerCase().match(/\.[^.]+$/) ?? [''])[0];
    const prev = stemMap.get(stem);
    if (!prev) { stemMap.set(stem, f); continue; }
    const prevIsOffice = OFFICE_EXTS.has((prev.name.toLowerCase().match(/\.[^.]+$/) ?? [''])[0]);
    if (!prevIsOffice && OFFICE_EXTS.has(ext)) stemMap.set(stem, f);
  }
  let deduped = Array.from(stemMap.values());

  const officeByFolder = new Map<string, typeof deduped>();
  for (const f of deduped) {
    if (!OFFICE_EXTS.has((f.name.toLowerCase().match(/\.[^.]+$/) ?? [''])[0])) continue;
    const folder = (f.folderPath ?? '').toLowerCase();
    if (!officeByFolder.has(folder)) officeByFolder.set(folder, []);
    officeByFolder.get(folder)!.push(f);
  }
  deduped = deduped.filter(f => {
    const ext = (f.name.toLowerCase().match(/\.[^.]+$/) ?? [''])[0];
    if (OFFICE_EXTS.has(ext)) return true;
    const folder = (f.folderPath ?? '').toLowerCase();
    const officeDocs = officeByFolder.get(folder);
    if (!officeDocs?.length) return true;
    return !officeDocs.some(od => wordOverlap(stemWords(f.name), stemWords(od.name)) >= 0.5);
  });
  docFiles = deduped;

  const allDattoFileIds = new Set(allFilesForOrphanCheck.map(f => String(f.id)));
  // Only purge orphaned actions if Datto returned a non-empty file listing.
  // An empty listing likely means the API walk failed — deleting here would wipe all actions.
  if (allItems.length > 0) {
    const uniquePortalDocIds = [...new Set(
      currentActions.filter((a: any) => a.source_document_id && !a.site_document_id).map((a: any) => String(a.source_document_id))
    )];
    const missingDocIds = uniquePortalDocIds.filter(id => !allDattoFileIds.has(id));
    if (missingDocIds.length > 0) {
      await supabase.from('actions').delete().in('source_document_id', missingDocIds).eq('site_id', siteId);
    }
  }

  const THREE_YEARS_AGO = Date.now() - 3 * 365 * 24 * 60 * 60 * 1000;
  if (!forceAll && site.last_ai_sync) {
    const lastSync = new Date(site.last_ai_sync).getTime();
    docFiles = docFiles.filter(i => {
      const mod = (i as any).modified || null;
      if (!mod) return true;
      return new Date(mod).getTime() > lastSync;
    });
  }
  if (!forceAll) {
    docFiles = docFiles.filter(i => {
      const mod = (i as any).modified || null;
      if (!mod) return true;
      return new Date(mod).getTime() > THREE_YEARS_AGO;
    });
  }

  onProgress?.({ type: 'docs_found', siteName: site.name, count: docFiles.length });

  if (docFiles.length === 0) {
    await supabase.from('sites').update({ last_ai_sync: new Date().toISOString() }).eq('id', siteId);
    onProgress?.({ type: 'site_done', siteName: site.name, processed: 0, newPending: 0, updated: 0, errors: [] });
    return { processed: 0, newPending: 0, updated: 0, errors: [] };
  }

  const processDoc = async (doc: typeof docFiles[0], index: number) => {
    onProgress?.({ type: 'doc_start', siteName: site.name, docName: doc.name, index, total: docFiles.length });
    const docNewPending = { count: 0 }; const docUpdated = { count: 0 };
    try {
      const ext = doc.name.split('.').pop()?.toLowerCase() ?? '';

      let fileRes: Response | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        fileRes = await fetch(`${BASE_URL}/file/${doc.id}/data`, { headers: { Authorization: AUTH_HEADER } });
        if (fileRes.status !== 429) break;
        const wait = parseInt(fileRes.headers.get('Retry-After') || '15', 10) * 1000;
        await new Promise(r => setTimeout(r, wait));
      }
      if (!fileRes!.ok) throw new Error(`Failed to download ${doc.name}: ${fileRes!.status}`);
      const buffer = await fileRes!.arrayBuffer();
      if (buffer.byteLength < 100) throw new Error(`${doc.name} appears corrupted (${buffer.byteLength} bytes)`);

      let aiBody: Record<string, string>;
      let geminiFileName: string | undefined;
      if (ext === 'docx') {
        const magic = new Uint8Array(buffer.slice(0, 4));
        if (magic[0] !== 0x50 || magic[1] !== 0x4B || magic[2] !== 0x03 || magic[3] !== 0x04)
          throw new Error(`${doc.name} is not a valid DOCX (bad magic bytes)`);
        const extracted = await mammoth.convertToHtml({ buffer: Buffer.from(buffer) });
        const htmlContent = extracted.value
          .replace(/â€¦/g, '…').replace(/â€™/g, '’').replace(/â€œ/g, '“')
          .replace(/â€/g, '”').replace(/Ã©/g, 'é').replace(/Â·/g, '·').replace(/Â /g, ' ');
        if (!htmlContent.trim()) throw new Error(`${doc.name} yielded no text — may be image-only`);
        const MAX_HTML_CHARS = 800_000;
        aiBody = { html: htmlContent.length > MAX_HTML_CHARS ? htmlContent.slice(0, 15_000) + '\n<!-- [truncated] -->\n' + htmlContent.slice(-(MAX_HTML_CHARS - 15_000)) : htmlContent, docName: doc.name };
      } else if (ext === 'doc') {
        throw new Error(`"${doc.name}" is in legacy .doc format — convert to .docx first`);
      } else if (ext === 'xlsx' || ext === 'xls') {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(buffer);
        const text = workbook.SheetNames.map((name: string) => `Sheet: ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`).join('\n\n');
        aiBody = { text, docName: doc.name };
      } else if (ext === 'pdf') {
        const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!);
        const safeName = doc.name.replace(/[^a-z0-9.]/gi, '_');
        const tmpPath = nodePath.join(os.tmpdir(), `${Date.now()}-${safeName}`);
        fs.writeFileSync(tmpPath, Buffer.from(buffer));
        try {
          const uploadRes = await fileManager.uploadFile(tmpPath, { mimeType: 'application/pdf', displayName: doc.name });
          geminiFileName = uploadRes.file.name;
          aiBody = { fileUri: uploadRes.file.uri, mimeType: 'application/pdf', docName: doc.name };
        } finally {
          fs.unlinkSync(tmpPath);
        }
      } else {
        throw new Error(`Unsupported file type: .${ext}`);
      }

      let aiRes = await fetch(`${baseUrl}/api/ai-extract`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...aiBody, siteId, organisationId: site.organisation_id }),
      });
      if (!aiRes.ok) {
        const errBody = await aiRes.json().catch(() => ({})) as any;
        const errMsg: string = errBody.error ?? aiRes.statusText;
        if (/token count exceeds|input token/i.test(errMsg) && 'html' in aiBody) {
          const plainText = (aiBody as any).html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400_000);
          aiRes = await fetch(`${baseUrl}/api/ai-extract`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: plainText, docName: doc.name, siteId, organisationId: site.organisation_id }),
          });
          if (!aiRes.ok) { const e = await aiRes.json().catch(() => ({})) as any; throw new Error(`AI failed: ${e.error ?? aiRes.statusText}`); }
        } else throw new Error(`AI extraction failed for ${doc.name}: ${errMsg}`);
      }
      if (geminiFileName) new GoogleAIFileManager(process.env.GEMINI_API_KEY!).deleteFile(geminiFileName).catch(() => {});
      const { actions: _rawActions, documentMeta } = await aiRes.json() as any;

      const actions: any[] = (_rawActions ?? [])
        .filter((a: any) => (a.description ?? '').toString().trim().length > 0)
        .map((a: any) => {
          const d = (a.dueDate ?? '').toString().trim();
          if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ...a, dueDate: null, dueDateRelative: a.dueDateRelative ?? d };
          return a;
        });
      const documentType = documentMeta?.documentType ?? 'general_ra';

      // 'other' = Gemini couldn't identify this as any known RA type
      if (documentType === 'other') {
        onProgress?.({ type: 'doc_done', siteName: site.name, docName: doc.name, index, total: docFiles.length, newPending: 0, updated: 0, skipped: 'Not an RA (other)' });
        return;
      }

      // COSHH: controls document — if filled in, create a standing annual review action
      if (documentType === 'coshh') {
        if (!documentMeta?.assessmentDate) {
          onProgress?.({ type: 'doc_done', siteName: site.name, docName: doc.name, index, total: docFiles.length, newPending: 0, updated: 0, skipped: 'Not an RA (coshh — unfilled)' });
          return;
        }
        const coshhTitle = 'Review and update COSHH assessment — confirm controls remain adequate and substance/process has not changed';
        const alreadyCoshh = actionsForDupCheck.some((e: any) => e.source_document_id === doc.id && e.title === coshhTitle);
        if (!alreadyCoshh) {
          const { error: insertErr } = await supabase.from('actions').insert({
            site_id: siteId, title: coshhTitle, description: '', priority: 'green',
            status: insertStatus, is_suggested: insertStatus === 'ai_suggested', due_date: null,
            source_document_name: doc.name, source_document_id: doc.id,
            source_folder_id: doc.parentFolderId, source_folder_path: doc.folderPath ?? null,
            hazard: 'Chemical/substance exposure', regulation: 'COSHH Regulations 2002',
            issue_date: documentMeta.assessmentDate, extraction_version: CURRENT_EXTRACTION_VERSION,
          });
          if (!insertErr) { newPending++; docNewPending.count++; }
        }
        processed++;
        onProgress?.({ type: 'doc_done', siteName: site.name, docName: doc.name, index, total: docFiles.length, newPending: docNewPending.count, updated: docUpdated.count });
        return;
      }

      // DSE: if all compliant (no actions) create annual review; otherwise process NO-answer actions normally
      if (documentType === 'dse') {
        if (!documentMeta?.assessmentDate) {
          onProgress?.({ type: 'doc_done', siteName: site.name, docName: doc.name, index, total: docFiles.length, newPending: 0, updated: 0, skipped: 'Not an RA (dse — unfilled)' });
          return;
        }
        if (actions.length === 0) {
          const dseTitle = 'Annual DSE workstation review — confirm all workstation requirements continue to be met';
          const alreadyDse = actionsForDupCheck.some((e: any) => e.source_document_id === doc.id && e.title === dseTitle);
          if (!alreadyDse) {
            const { error: insertErr } = await supabase.from('actions').insert({
              site_id: siteId, title: dseTitle, description: '', priority: 'green',
              status: insertStatus, is_suggested: insertStatus === 'ai_suggested', due_date: null,
              source_document_name: doc.name, source_document_id: doc.id,
              source_folder_id: doc.parentFolderId, source_folder_path: doc.folderPath ?? null,
              hazard: 'Display screen equipment use',
              regulation: 'Health and Safety (Display Screen Equipment) Regulations 1992',
              risk_level: 'LOW', issue_date: documentMeta.assessmentDate,
              extraction_version: CURRENT_EXTRACTION_VERSION,
            });
            if (!insertErr) { newPending++; docNewPending.count++; }
          }
          processed++;
          onProgress?.({ type: 'doc_done', siteName: site.name, docName: doc.name, index, total: docFiles.length, newPending: docNewPending.count, updated: docUpdated.count });
          return;
        }
        // Has NO-answer actions — fall through to normal processing below
      }

      // No assessment date: use additional signals to decide if genuine or unfilled template
      if (!documentMeta?.assessmentDate) {
        const trimSig = (s: string | null | undefined) => (s ?? '').trim();
        const hasAssessor    = !!trimSig(documentMeta?.assessor);
        const hasClientName  = !!trimSig(documentMeta?.clientConsulted);
        const hasResponsible = actions.some((a: any) => !!trimSig(a.responsiblePerson));
        const hasHazardRef   = actions.some((a: any) => !!trimSig(a.hazardRef));
        if (!hasAssessor && !hasClientName && !hasResponsible && !hasHazardRef) {
          onProgress?.({ type: 'doc_done', siteName: site.name, docName: doc.name, index, total: docFiles.length, newPending: 0, updated: 0, skipped: 'No assessment date — template?' });
          return;
        }
        // Has enough signals to treat as genuine — proceed without a date
      }

      type ReadRow = { hazardRef: string; actionText: string; responsiblePerson: string; targetDate: string; completedDate: string; riskRating: string };
      let readRows: ReadRow[] = [];
      let parsedHazards: { ref: string; description: string; existingControls?: string }[] = [];
      if (ext === 'docx') {
        const [readResRaw, hazardsResRaw] = await Promise.all([
          fetch(`${baseUrl}/api/datto/file/readactions?fileId=${doc.id}`).catch(() => null),
          fetch(`${baseUrl}/api/datto/file/hazards?fileId=${doc.id}`).catch(() => null),
        ]);
        try { if (readResRaw?.ok) { const { rows } = await readResRaw.json(); if (rows) readRows = rows; } } catch { /* non-fatal */ }
        try { if (hazardsResRaw?.ok) { const { hazards } = await hazardsResRaw.json(); if (hazards?.length > 0) parsedHazards = hazards; } } catch { /* non-fatal */ }
      }

      if (readRows.length > 0) {
        const usedRefs = new Set<string>(actions.filter(a => a.hazardRef).map(a => a.hazardRef));
        for (const a of actions) {
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

      const parsedHazardMap = new Map(parsedHazards.map(h => [String(h.ref), h]));
      const readRowsByRef = new Map<string, ReadRow[]>();
      for (const r of readRows) {
        if (!r.hazardRef) continue;
        const key = String(r.hazardRef).trim();
        if (!readRowsByRef.has(key)) readRowsByRef.set(key, []);
        readRowsByRef.get(key)!.push(r);
      }
      const bestReadRow = (hazardRef: string | null | undefined, actionText: string | null | undefined): ReadRow | undefined => {
        if (!hazardRef) return undefined;
        const rows = readRowsByRef.get(String(hazardRef).trim());
        if (!rows?.length) return undefined;
        if (rows.length === 1) return rows[0];
        if (!actionText) return rows[0];
        const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
        const needle = norm(actionText);
        return rows.find(r => norm(r.actionText) === needle)
          ?? rows.find(r => { const h = norm(r.actionText); return h.includes(needle) || needle.includes(h); })
          ?? rows[0];
      };

      const docActionsForDoc = actionsForDupCheck.filter((a: any) => a.source_document_id === doc.id);
      const docBaseName = doc.name.replace(/\.[^.]+$/, '').toLowerCase();
      const normText = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

      const rowPairingMap = new Map<string, ReadRow>();
      if (readRows.length > 0) {
        const claimedRowIdxByRef = new Map<string, Set<number>>();
        for (const docAction of docActionsForDoc) {
          if (!docAction.hazard_ref) continue;
          const ref = String(docAction.hazard_ref).trim();
          const allRows = readRowsByRef.get(ref) ?? [];
          if (!allRows.length) continue;
          const claimed = claimedRowIdxByRef.get(ref) ?? new Set<number>();
          const available = allRows.map((r, i) => ({ r, i })).filter(({ i }) => !claimed.has(i));
          if (!available.length) continue;
          let best = available[0];
          if (docAction.title && available.length > 1) {
            const needle = normText(docAction.title);
            const exact = available.find(({ r }) => normText(r.actionText) === needle);
            const sub = !exact ? available.find(({ r }) => { const h = normText(r.actionText); return h.includes(needle) || needle.includes(h); }) : undefined;
            best = exact ?? sub ?? available[0];
          }
          claimed.add(best.i);
          claimedRowIdxByRef.set(ref, claimed);
          rowPairingMap.set(docAction.id, best.r);
        }
      }

      const geminiCountByRef = new Map<string, number>();
      for (const a of actions) {
        if (a.hazardRef) geminiCountByRef.set(String(a.hazardRef), (geminiCountByRef.get(String(a.hazardRef)) ?? 0) + 1);
      }
      const claimedPortalActionIds = new Set<string>();

      for (const a of actions) {
        const parsedH = a.hazardRef ? parsedHazardMap.get(String(a.hazardRef)) : undefined;
        const tableRow = bestReadRow(a.hazardRef, a.description);
        const tableRiskRating: string | null = tableRow?.riskRating || null;
        const tableRiskLevel = tableRiskRating ? normaliseRiskLevel(tableRiskRating) : null;

        const portalActionsForRef = a.hazardRef ? docActionsForDoc.filter((e: any) => String(e.hazard_ref) === String(a.hazardRef)) : [];
        const geminiCountForRef = a.hazardRef ? (geminiCountByRef.get(String(a.hazardRef)) ?? 0) : 0;

        const alreadyAdded = (() => {
          if (a.hazardRef && portalActionsForRef.length > 0) {
            if (geminiCountForRef <= portalActionsForRef.length) return true;
            return portalActionsForRef.some((e: any) => e.title === a.description || textSimilarity(e.title, a.description) > 0.8);
          }
          return actionsForDupCheck.some((e: any) => {
            if (e.site_id !== siteId) return false;
            if (e.source_document_id !== doc.id) {
              const eBase = (e.source_document_name ?? '').replace(/\.[^.]+$/, '').toLowerCase();
              if (eBase !== docBaseName) return false;
            }
            return e.title === a.description || textSimilarity(e.title ?? '', a.description) > 0.8;
          });
        })();

        if (!alreadyAdded) {
          const { error: insertErr } = await supabase.from('actions').insert({
            site_id: siteId, title: a.description, description: '', priority: 'green',
            status: insertStatus, is_suggested: insertStatus === 'ai_suggested',
            due_date: resolveDueDate(a.dueDate ?? null, a.dueDateRelative ?? null, documentMeta?.assessmentDate ?? null),
            source_document_name: doc.name, source_document_id: doc.id,
            source_folder_id: doc.parentFolderId, source_folder_path: doc.folderPath ?? null,
            hazard_ref: a.hazardRef ?? null,
            hazard: parsedH?.description ?? a.hazard ?? null,
            existing_controls: parsedH?.existingControls ?? a.existingControls ?? null,
            risk_rating: tableRiskRating ?? a.riskRating ?? null,
            risk_level: tableRiskLevel ?? a.riskLevel ?? null,
            regulation: a.regulation ?? null, responsible_person: a.responsiblePerson ?? null,
            issue_date: documentMeta?.assessmentDate ?? null,
            extraction_version: CURRENT_EXTRACTION_VERSION,
          });
          if (!insertErr) {
            newPending++; docNewPending.count++;
            (currentActions as any[]).push({ id: `inserted-${newPending}`, title: a.description, site_id: siteId, source_document_id: doc.id, source_document_name: doc.name, hazard_ref: a.hazardRef ?? null });
            if (documentMeta?.assessmentDate && doc.name) {
              const d = new Date(documentMeta.assessmentDate + 'T00:00:00');
              d.setFullYear(d.getFullYear() + 1);
              await supabase.from('document_health').upsert(
                { site_id: siteId, document_name: doc.name, review_due: d.toISOString().slice(0, 10) },
                { onConflict: 'site_id,document_name', ignoreDuplicates: false }
              ).then(null, () => {});
            }
          } else {
            errors.push(`Insert failed for ${doc.name}: ${insertErr.message}`);
          }
        } else {
          const candidates = docActionsForDoc.filter((e: any) => e.hazard_ref === a.hazardRef && !claimedPortalActionIds.has(e.id));
          if (!candidates.length) continue;
          let existingAction = candidates[0];
          if (candidates.length > 1) {
            const needle = normText(a.description);
            const byRow = candidates.find((e: any) => normText(rowPairingMap.get(e.id)?.actionText) === needle);
            const byRowSub = !byRow ? candidates.find((e: any) => { const h = normText(rowPairingMap.get(e.id)?.actionText); return h.includes(needle) || needle.includes(h); }) : undefined;
            const byText = (!byRow && !byRowSub) ? candidates.find((e: any) => normText(e.title) === needle) : undefined;
            existingAction = byRow ?? byRowSub ?? byText ?? candidates[0];
          }
          claimedPortalActionIds.add(existingAction.id);

          const aiUpdates: Record<string, any> = {};
          const newHazard = parsedH?.description ?? a.hazard ?? null;
          const newControls = parsedH?.existingControls ?? a.existingControls ?? null;
          const existingHazardIsHtml = (existingAction.hazard as string | null)?.trimStart().startsWith('<');
          const existingControlsIsHtml = (existingAction.existing_controls as string | null)?.trimStart().startsWith('<');
          if (newHazard && newHazard !== existingAction.hazard && (!existingHazardIsHtml || newHazard.trimStart().startsWith('<'))) aiUpdates.hazard = newHazard;
          if (newControls && newControls !== existingAction.existing_controls && (!existingControlsIsHtml || newControls.trimStart().startsWith('<'))) aiUpdates.existing_controls = newControls;
          const pairedRow = rowPairingMap.get(existingAction.id);
          const naTableRisk = pairedRow?.riskRating ?? bestReadRow(a.hazardRef, a.description)?.riskRating;
          if (naTableRisk && naTableRisk !== existingAction.risk_rating) {
            aiUpdates.risk_rating = naTableRisk;
            const derived = normaliseRiskLevel(naTableRisk);
            if (derived) aiUpdates.risk_level = derived;
          }
          if (doc.folderPath && doc.folderPath !== existingAction.source_folder_path) aiUpdates.source_folder_path = doc.folderPath;
          if (documentMeta?.assessmentDate && documentMeta.assessmentDate !== existingAction.issue_date) aiUpdates.issue_date = documentMeta.assessmentDate;
          aiUpdates.extraction_version = CURRENT_EXTRACTION_VERSION;

          if (Object.keys(aiUpdates).length > 1) {
            const { error: updateErr } = await supabase.from('actions').update(aiUpdates).eq('id', existingAction.id);
            if (!updateErr) { updated++; docUpdated.count++; }
          }
        }
      }

      await supabase.from('actions').update({ extraction_version: CURRENT_EXTRACTION_VERSION })
        .eq('source_document_id', doc.id).eq('site_id', siteId).lt('extraction_version', CURRENT_EXTRACTION_VERSION)
        .then(null, () => {});

      if (readRows.length > 0) {
        for (const docAction of docActionsForDoc) {
          if (!docAction.hazard_ref) continue;
          const docRow = rowPairingMap.get(docAction.id);
          if (!docRow) continue;
          const twoWay: Record<string, any> = {};
          if (docRow.actionText && docRow.actionText !== docAction.title) twoWay.title = docRow.actionText;
          if (docRow.responsiblePerson && docRow.responsiblePerson !== docAction.responsible_person) twoWay.responsible_person = docRow.responsiblePerson;
          if (docRow.targetDate) {
            const norm = ukToIso(docRow.targetDate);
            const resolved = /^\d{4}-\d{2}-\d{2}$/.test(norm) ? norm : resolveDueDate(null, norm, documentMeta?.assessmentDate ?? docAction.issue_date ?? null);
            if (resolved && resolved !== docAction.due_date) twoWay.due_date = resolved;
          }
          if (docRow.completedDate && !docAction.resolved_date) { twoWay.resolved_date = ukToIso(docRow.completedDate); twoWay.status = 'resolved'; }
          if (Object.keys(twoWay).length > 0) await supabase.from('actions').update(twoWay).eq('id', docAction.id);
        }
      }

      processed++;
      onProgress?.({ type: 'doc_done', siteName: site.name, docName: doc.name, index, total: docFiles.length, newPending: docNewPending.count, updated: docUpdated.count });
    } catch (docErr: any) {
      errors.push(`${doc.name}: ${docErr.message}`);
      onProgress?.({ type: 'doc_done', siteName: site.name, docName: doc.name, index, total: docFiles.length, newPending: 0, updated: 0, error: docErr.message });
    }
  };

  const CONCURRENCY = 1;
  for (let i = 0; i < docFiles.length; i += CONCURRENCY) {
    await Promise.all(docFiles.slice(i, i + CONCURRENCY).map((doc, offset) => processDoc(doc, i + offset)));
    if (i + CONCURRENCY < docFiles.length) await new Promise(r => setTimeout(r, 1500));
  }

  await supabase.from('sites').update({ last_ai_sync: new Date().toISOString() }).eq('id', siteId);
  onProgress?.({ type: 'site_done', siteName: site.name, processed, newPending, updated, errors });
  return { processed, newPending, updated, errors };
}
