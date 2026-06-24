import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { BASE_URL, AUTH_HEADER } from '../folder-utils';

const DATTO_DRIVE_ROOT = 'W:\\Customer Documents';

export const runtime = 'nodejs';

// Reused from readback/route.ts
function cellText(cellXml: string): string {
  return (cellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
    .map(t => t.replace(/<[^>]+>/g, ''))
    .join('');
}

function normaliseHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, '');
}

const ACTION_TITLE_SECONDARY = [
  'plan', 'arising', 'from', 'assessment', 'recommended', 'corrective',
  'register', 'log', 'tracker', 'required', 'summary', 'list',
];

function isActionTableTitle(text: string): boolean {
  const norm = normaliseHeader(text);
  return (norm.includes('action') || norm.includes('actions')) &&
    ACTION_TITLE_SECONDARY.some(w => norm.includes(w));
}

const STRIP_LABEL_RE = /assessment.?date|completed.?by|person.{0,5}consulted|assessor|date.?of.?assessment|\bdate\b/i;

/** Clear all <w:t> text content inside a cell XML string */
function clearCellText(cellXml: string): string {
  return cellXml.replace(/(<w:t[^>]*>)[^<]*(<\/w:t>)/g, '$1$2');
}

function stripDocumentXml(xml: string): string {
  const tableRe = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
  return xml.replace(tableRe, (tblXml) => {
    const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
    const rows = Array.from(tblXml.matchAll(rowRe));
    if (rows.length < 2) return tblXml;

    // Detect title row + action table
    const firstRowCells = Array.from(rows[0][0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => m[0]);
    const nonEmptyFirst = firstRowCells.filter(c => cellText(c).trim().length > 0);
    const titleText = nonEmptyFirst.length === 1 ? cellText(nonEmptyFirst[0]) : '';
    const isTitleRow = titleText.length > 0 && isActionTableTitle(titleText);
    const hdrRowIndex = isTitleRow ? 1 : 0;

    const isActionTable = isTitleRow || (() => {
      if (rows.length <= hdrRowIndex) return false;
      const hdrCells = Array.from(rows[hdrRowIndex][0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => m[0]);
      return hdrCells.some(c => normaliseHeader(cellText(c)) === 'action' ||
        normaliseHeader(cellText(c)) === 'actionrequired' ||
        normaliseHeader(cellText(c)) === 'actionsrequired');
    })();

    let result = tblXml;

    if (isActionTable) {
      // Clear all data rows (keep header rows)
      const dataStart = hdrRowIndex + 1;
      rows.slice(dataStart).forEach(rowMatch => {
        const clearedRow = rowMatch[0].replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (tcXml) => clearCellText(tcXml));
        result = result.replace(rowMatch[0], clearedRow);
      });
    } else {
      // Strip labelled fields: clear the cell AFTER a label-matching cell in the same row
      rows.forEach(rowMatch => {
        const cellMatches = Array.from(rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g));
        const cells = cellMatches.map(m => m[0]);
        let modifiedRow = rowMatch[0];
        cells.forEach((cell, i) => {
          if (STRIP_LABEL_RE.test(cellText(cell)) && i + 1 < cells.length) {
            const nextCleared = clearCellText(cells[i + 1]);
            modifiedRow = modifiedRow.replace(cells[i + 1], nextCleared);
          }
        });
        if (modifiedRow !== rowMatch[0]) {
          result = result.replace(rowMatch[0], modifiedRow);
        }
      });
    }

    return result;
  });
}

export async function POST(request: NextRequest) {
  try {
    const { fileId, fileName, folderId, folderPath } = await request.json();

    if (!fileId || !fileName || !folderId) {
      return NextResponse.json({ error: 'fileId, fileName and folderId are required' }, { status: 400 });
    }

    if (!fileName.toLowerCase().endsWith('.docx')) {
      return NextResponse.json({ error: 'Only .docx files can be cloned' }, { status: 400 });
    }

    // Build clone filename with next year
    const ext = '.docx';
    const rawBase = fileName.slice(0, fileName.length - ext.length);
    // Strip trailing administrative suffixes iteratively (version numbers, dates).
    // Only strips from the END to avoid touching section refs like "2.1.1" at the start.
    const STRIP_TAIL = [
      /\s+\d{4}-\d{2}(-\d{2})?$/,   // YYYY-MM or YYYY-MM-DD
      /\s+\d{4}$/,                    // YYYY
      /\s+\d{1,2}\.\d{2,4}$/,         // M.YY, MM.YY, MM.YYYY (e.g. 8.25, 04.26)
      /\s+[Vv]\d+(?:\.\d+)*$/,       // V1, v2, V1.0, v2.1
    ];
    let baseName = rawBase;
    let changed = true;
    while (changed) {
      changed = false;
      for (const re of STRIP_TAIL) {
        const stripped = baseName.replace(re, '');
        if (stripped !== baseName) { baseName = stripped; changed = true; }
      }
    }
    baseName = baseName.trim();
    const curYear = new Date().getFullYear();
    const nextYY = String(curYear + 1).slice(2);
    const cloneName = `${baseName} ${curYear}-${nextYY}${ext}`;

    // Download original — try W: drive first, fall back to Datto API
    let docxBuffer: ArrayBuffer;
    if (folderPath) {
      const wPath = path.join(DATTO_DRIVE_ROOT, ...folderPath.split('/').filter(Boolean), fileName);
      if (fs.existsSync(wPath)) {
        console.log('[clone-document] reading source from W: drive:', wPath);
        const nodeBuf = fs.readFileSync(wPath);
        docxBuffer = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength) as ArrayBuffer;
      } else {
        const downloadRes = await fetch(`${BASE_URL}/file/${fileId}/data`, { headers: { Authorization: AUTH_HEADER } });
        if (!downloadRes.ok) {
          const detail = await downloadRes.text();
          return NextResponse.json({ error: 'Failed to download from Datto', detail }, { status: 502 });
        }
        docxBuffer = await downloadRes.arrayBuffer();
      }
    } else {
      const downloadRes = await fetch(`${BASE_URL}/file/${fileId}/data`, { headers: { Authorization: AUTH_HEADER } });
      if (!downloadRes.ok) {
        const detail = await downloadRes.text();
        return NextResponse.json({ error: 'Failed to download from Datto', detail }, { status: 502 });
      }
      docxBuffer = await downloadRes.arrayBuffer();
    }

    // Reject obviously corrupt downloads (e.g. Datto stub files)
    if (docxBuffer.byteLength < 100) {
      return NextResponse.json({ error: 'Source file appears corrupt or empty in Datto', detail: `File size: ${docxBuffer.byteLength} bytes` }, { status: 422 });
    }

    // Strip action tables and labelled fields
    const zip = await JSZip.loadAsync(docxBuffer);
    const docFile = zip.file('word/document.xml');
    if (!docFile) {
      return NextResponse.json({ error: 'word/document.xml not found in DOCX' }, { status: 422 });
    }
    const xml = await docFile.async('string');
    const strippedXml = stripDocumentXml(xml);
    zip.file('word/document.xml', strippedXml);
    const cloneBuffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    const cloneBytes = new Uint8Array(cloneBuffer);

    // 1. Try W: drive first (direct filesystem write — works even when Datto API blocks new file creation)
    if (folderPath) {
      try {
        const targetDir = path.join(DATTO_DRIVE_ROOT, ...folderPath.split('/').filter(Boolean));
        const targetFile = path.join(targetDir, cloneName);
        if (fs.existsSync(targetDir)) {
          fs.writeFileSync(targetFile, cloneBytes);
          console.log('[clone-document] wrote via W: drive:', targetFile);
          return NextResponse.json({ success: true, newFileId: null, newFileName: cloneName, wdrivePath: targetFile, via: 'wdrive' });
        }
      } catch (fsErr: any) {
        console.warn('[clone-document] W: drive write failed, falling back to API:', fsErr.message);
      }
    }

    // 2. Fall back to Datto REST API
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const form = new FormData();
    form.append('partData', new Blob([new Uint8Array(cloneBytes)], { type: mimeType }), cloneName);
    form.append('fileName', cloneName);
    form.append('makeUnique', 'false');

    const uploadRes = await fetch(`${BASE_URL}/file/${folderId}/files`, {
      method: 'POST',
      headers: { Authorization: AUTH_HEADER },
      body: form,
    });
    const uploadBody = await uploadRes.text();
    if (!uploadRes.ok) {
      console.error('[clone-document] upload failed', uploadRes.status, uploadBody);
      return NextResponse.json({ error: 'Clone upload failed', detail: uploadBody, status: uploadRes.status }, { status: 502 });
    }

    let newFileId: string | null = null;
    try {
      const j = JSON.parse(uploadBody);
      const d = j.value ?? j;
      newFileId = String(d.fileID ?? d.fileId ?? d.id ?? '') || null;
    } catch { /* non-JSON */ }

    return NextResponse.json({ success: true, newFileId, newFileName: cloneName });
  } catch (err: any) {
    console.error('[clone-document] error:', err);
    return NextResponse.json({ error: err.message ?? 'Clone failed' }, { status: 500 });
  }
}
