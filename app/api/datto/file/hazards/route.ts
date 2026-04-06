import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';

const CLIENT_ID = '8768d9f6-7ae5-4c96-a8a7-512e3c957fd0';
const CLIENT_SECRET = '8228393f-1323-4d80-8dbe-e3e87c291158';
const BASE_URL = 'https://eu.workplace.datto.com/2/api/v1';
const AUTH_HEADER = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

function cellText(cellXml: string): string {
  return Array.from(cellXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
    .map(t => t[0].replace(/<[^>]+>/g, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Convert a table cell's DOCX XML to safe HTML, preserving paragraphs, bullets, italic, bold
function cellHtml(cellXml: string): string {
  const paragraphs = Array.from(cellXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g));
  const parts: string[] = [];
  let inList = false;

  for (const para of paragraphs) {
    const paraXml = para[0];
    const pPr = paraXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
    const isBullet = pPr.includes('<w:numPr>');

    let paraContent = '';
    for (const run of Array.from(paraXml.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g))) {
      const runXml = run[0];
      const rPr = runXml.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
      const isBold = /<w:b\b(?:\s[^>]*)?\/>/.test(rPr);
      const isItalic = /<w:i\b(?:\s[^>]*)?\/>/.test(rPr);

      let runText = '';
      for (const el of Array.from(runXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:br(?:\s[^/]*)?\/?>/g))) {
        runText += el[0].startsWith('<w:br') ? '<br>' : escapeHtml(el[0].replace(/<[^>]+>/g, ''));
      }
      if (!runText) continue;
      if (isItalic) runText = `<em>${runText}</em>`;
      if (isBold) runText = `<strong>${runText}</strong>`;
      paraContent += runText;
    }

    if (!paraContent.trim()) continue;
    // Strip continuation markers (e.g. "CONT:-", "CONT:", "...continued")
    if (/^(cont[:\-\s]|\.{3}continued)/i.test(paraContent.replace(/<[^>]+>/g, '').trim())) continue;

    if (isBullet) {
      if (!inList) { parts.push('<ul>'); inList = true; }
      parts.push(`<li>${paraContent}</li>`);
    } else {
      if (inList) { parts.push('</ul>'); inList = false; }
      parts.push(`<p>${paraContent}</p>`);
    }
  }
  if (inList) parts.push('</ul>');
  return parts.join('');
}

// Strip HTML tags to get plain text (used for dropdown preview labels)
function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cellFirstLine(cellXml: string): string {
  const firstPara = cellXml.match(/<w:p\b[\s\S]*?<\/w:p>/);
  const text = firstPara
    ? Array.from(firstPara[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
        .map(t => t[0].replace(/<[^>]+>/g, '')).join(' ').replace(/\s+/g, ' ').trim()
    : cellText(cellXml);
  if (text.length <= 80) return text;
  const truncated = text.slice(0, 80);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated) + '…';
}

function truncatePreview(text: string): string {
  if (text.length <= 80) return text;
  const truncated = text.slice(0, 80);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated) + '…';
}

function normaliseHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, '');
}

// Action plan table title detection (same as readactions/writeback)
const ACTION_TITLE_SECONDARY = [
  'plan', 'arising', 'from', 'assessment', 'recommended', 'corrective',
  'register', 'log', 'tracker', 'required', 'summary', 'list',
];
function isActionTableTitle(text: string): boolean {
  const norm = normaliseHeader(text);
  return (norm.includes('action') || norm.includes('actions')) &&
    ACTION_TITLE_SECONDARY.some(w => norm.includes(w));
}

// ── Pass 1: Simple column-based detection ────────────────────────────────────
// Works for tables with clear ref + description headers on a single row, e.g.:
//   No. | Hazard | Existing Controls | Risk Rating
const HAZARD_COLUMN_PATTERNS: Record<string, string[]> = {
  ref:              ['no', 'ref', 'hazardno', 'hazardref', 'number', 'item', 'hazardnumber'],
  description:      ['hazard', 'hazarddescription', 'activityhazard', 'description',
                     'hazardactivity', 'hazardsidentified', 'activity'],
  existingControls: ['existingcontrols', 'controlmeasures', 'currentcontrols',
                     'existingmeasures', 'controls', 'measures'],
  riskRating:       ['riskrating', 'risklevel', 'riskscore', 'rating'],
};
const EXACT_ONLY_KEYS = ['ref', 'riskRating'];
const INCLUDE_MATCH_KEYS = ['existingControls'];

function matchHazardColumn(headerText: string, key: string): boolean {
  const norm = normaliseHeader(headerText);
  if (norm.length > 35) return false;
  const exactOnly = EXACT_ONLY_KEYS.includes(key);
  const includeMatch = INCLUDE_MATCH_KEYS.includes(key);
  return HAZARD_COLUMN_PATTERNS[key].some(p =>
    norm === p ||
    (!exactOnly && norm.startsWith(p)) ||
    (includeMatch && norm.includes(p))
  );
}

function trySimpleTableDetection(
  tableMatches: RegExpMatchArray[]
): { ref: string; description: string; descriptionPreview: string; existingControls?: string; riskRating?: string }[] | null {
  for (const tableMatch of tableMatches) {
    const tblXml = tableMatch[0];
    const rows = Array.from(tblXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g));
    if (rows.length < 2) continue;

    // Skip action plan tables
    const firstRowCells = Array.from(rows[0][0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => m[0]);
    const nonEmptyFirst = firstRowCells.filter(c => cellText(c).trim().length > 0);
    const titleText = nonEmptyFirst.length === 1 ? cellText(nonEmptyFirst[0]) : '';
    if (titleText && isActionTableTitle(titleText)) continue;

    const hdrRowIndex = (titleText && normaliseHeader(titleText).includes('hazard')) ? 1 : 0;
    if (rows.length <= hdrRowIndex + 1) continue;

    const hdrCells = Array.from(rows[hdrRowIndex][0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => m[0]);
    const colIndex: Record<string, number> = {};
    hdrCells.forEach((cell, i) => {
      const text = cellText(cell);
      for (const key of Object.keys(HAZARD_COLUMN_PATTERNS)) {
        if (!(key in colIndex) && matchHazardColumn(text, key)) colIndex[key] = i;
      }
    });

    if (!('ref' in colIndex) || !('description' in colIndex)) continue;

    const hazards: { ref: string; description: string; descriptionPreview: string; existingControls?: string; riskRating?: string }[] = [];
    for (const rowMatch of rows.slice(hdrRowIndex + 1)) {
      const cells = Array.from(rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => m[0]);
      const ref = colIndex.ref !== undefined ? cellText(cells[colIndex.ref] ?? '').trim() : '';
      const descCell = cells[colIndex.description] ?? '';
      const description = cellHtml(descCell);
      const descriptionPreview = cellFirstLine(descCell).trim();
      const existingControls = colIndex.existingControls !== undefined
        ? cellHtml(cells[colIndex.existingControls] ?? '') || undefined
        : undefined;
      const riskRating = colIndex.riskRating !== undefined
        ? cellText(cells[colIndex.riskRating] ?? '').trim() || undefined
        : undefined;
      if (!ref && !description) continue;
      hazards.push({ ref, description, descriptionPreview, existingControls, riskRating });
    }

    if (hazards.length > 0) return hazards;
  }
  return null;
}

// ── Pass 2: Content-based heuristic for merged-header format ─────────────────
// Handles templates where hazard register uses a 2-row merged header, e.g.:
//   Row 0: Hazard | Initial | Existing Control Measures | Residual | Additional Controls
//   Row 1:        | Sev | Prob | Risk |                 | Sev | Prob | Risk |
//   Row 2: (data) | <long description>  | 3 | 4 | 12 | <long controls> | 3 | 3 | 9 |
// Each hazard may be its own table (split tables). Numbered by document order.
//
// Action plan table is scanned first to get risk ratings keyed by ref number.

function tryHeuristicDetection(
  tableMatches: RegExpMatchArray[]
): { ref: string; description: string; descriptionPreview: string; existingControls?: string; riskRating?: string }[] | null {
  // Step A: extract risk ratings from action plan table
  const riskByRef = new Map<string, string>();
  for (const tableMatch of tableMatches) {
    const tblXml = tableMatch[0];
    const rows = Array.from(tblXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g));
    if (rows.length < 2) continue;
    const firstRowCells = Array.from(rows[0][0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => m[0]);
    const nonEmptyFirst = firstRowCells.filter(c => cellText(c).trim().length > 0);
    const titleText = nonEmptyFirst.length === 1 ? cellText(nonEmptyFirst[0]) : '';
    if (!isActionTableTitle(titleText)) continue;

    // Header row is row 1 (after merged title)
    const hdrCells = Array.from(rows[1][0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => cellText(m[0]).trim());
    let noCol = -1, riskCol = -1;
    hdrCells.forEach((h, i) => {
      const n = normaliseHeader(h);
      if (noCol === -1 && (n === 'no' || n === 'number' || n === 'ref' || n === 'hazardno')) noCol = i;
      if (riskCol === -1 && (n === 'riskrating' || n === 'risk' || n === 'rating' || n === 'risklevel')) riskCol = i;
    });
    if (noCol === -1) continue;
    for (const row of rows.slice(2)) {
      const cells = Array.from(row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => cellText(m[0]).trim());
      const ref = cells[noCol] ?? '';
      const risk = riskCol !== -1 ? (cells[riskCol] ?? '') : '';
      if (ref && risk) riskByRef.set(ref, risk);
    }
    break;
  }

  // Step B: find all hazard assessment tables (have "Hazard" in first row, not action plan)
  const hazardEntries: { description: string; descriptionPreview: string; existingControls?: string }[] = [];

  for (const tableMatch of tableMatches) {
    const tblXml = tableMatch[0];
    const rows = Array.from(tblXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g));
    if (rows.length < 2) continue;

    // Skip action plan tables
    const firstRowCells = Array.from(rows[0][0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => m[0]);
    const nonEmptyFirst = firstRowCells.filter(c => cellText(c).trim().length > 0);
    const titleText = nonEmptyFirst.length === 1 ? cellText(nonEmptyFirst[0]) : '';
    if (titleText && isActionTableTitle(titleText)) continue;

    // First row must contain "Hazard" as one of the (possibly merged) column headers
    const firstRowTexts = firstRowCells.map(c => cellText(c).trim());
    const hasHazardHeader = firstRowTexts.some(t => normaliseHeader(t) === 'hazard' || normaliseHeader(t) === 'hazards');
    if (!hasHazardHeader) continue;

    // Second row may be a sub-header (Sev/Prob/Risk). Skip both rows to get to data.
    // A sub-header row has all cells short (<= 12 chars).
    const secondRowCells = Array.from((rows[1]?.[0] ?? '').matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => cellText(m[0]).trim());
    const secondRowIsSubHeader = secondRowCells.length > 0 && secondRowCells.every(c => c.length <= 12);
    const dataStartIndex = secondRowIsSubHeader ? 2 : 1;

    // From each data row, collect substantial text cells (> 30 chars, not purely numeric)
    // preserving column order. First substantial cell = description, second = existing controls.
    for (const rowMatch of rows.slice(dataStartIndex)) {
      // Keep raw cell XML so we can generate HTML; filter by plain-text length
      const cells = Array.from(rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => m[0]);
      const substantial = cells.filter(c => {
        const t = cellText(c);
        return t.length > 30 && !/^[\d\s./:()%]+$/.test(t);
      });
      if (substantial.length === 0) continue;

      const description = cellHtml(substantial[0]);
      const existingControls = substantial[1] ? cellHtml(substantial[1]) : undefined;
      const descriptionPreview = truncatePreview(stripHtml(description));

      hazardEntries.push({ description, descriptionPreview, existingControls });
    }
  }

  if (hazardEntries.length === 0) return null;

  return hazardEntries.map((h, i) => {
    const ref = String(i + 1);
    return {
      ref,
      description: h.description,
      descriptionPreview: h.descriptionPreview,
      existingControls: h.existingControls,
      riskRating: riskByRef.get(ref),
    };
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');
  if (!fileId) return NextResponse.json({ error: 'fileId is required' }, { status: 400 });

  let docxBuffer: ArrayBuffer;
  try {
    const downloadRes = await fetch(`${BASE_URL}/file/${fileId}/data`, {
      headers: { Authorization: AUTH_HEADER },
      cache: 'no-store',
    });
    if (!downloadRes.ok) return NextResponse.json({ hazards: [] });
    docxBuffer = await downloadRes.arrayBuffer();
  } catch {
    return NextResponse.json({ hazards: [] });
  }

  let xml: string;
  try {
    const zip = await JSZip.loadAsync(docxBuffer);
    const docFile = zip.file('word/document.xml');
    if (!docFile) return NextResponse.json({ hazards: [] });
    xml = await docFile.async('string');
  } catch {
    return NextResponse.json({ hazards: [] });
  }

  const tableMatches = Array.from(xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g));

  // Try simple column-header approach first
  const simple = trySimpleTableDetection(tableMatches);
  if (simple) return NextResponse.json({ hazards: simple });

  // Fall back to content-based heuristic for merged-header format
  const heuristic = tryHeuristicDetection(tableMatches);
  if (heuristic) return NextResponse.json({ hazards: heuristic });

  return NextResponse.json({ hazards: [] });
}
