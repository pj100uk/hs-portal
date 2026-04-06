import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';

const CLIENT_ID = '8768d9f6-7ae5-4c96-a8a7-512e3c957fd0';
const CLIENT_SECRET = '8228393f-1323-4d80-8dbe-e3e87c291158';
const BASE_URL = 'https://eu.workplace.datto.com/2/api/v1';
const AUTH_HEADER = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

function cellText(cellXml: string): string {
  return (Array.from(cellXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)))
    .map(t => t[0].replace(/<[^>]+>/g, ''))
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

const COLUMN_PATTERNS: Record<string, string[]> = {
  hazardRef:   ['no', 'ref', 'hazardno', 'hazardref', 'number', 'item'],
  action:      ['actionrequired', 'actionsrequired', 'requiredaction', 'action'],
  responsible: ['responsible', 'personresponsible', 'responsibleperson', 'responsibleparty', 'responsiblefor'],
  targetDate:  ['targetdate', 'duedate', 'targetcompletion', 'targetcompletiondate', 'date'],
  completed:   ['completiondate', 'datecompleted', 'completeddate', 'completed', 'dateofcompletion'],
};

const INCLUDE_MATCH_KEYS: (keyof typeof COLUMN_PATTERNS)[] = ['responsible', 'completed'];
// hazardRef patterns are short/ambiguous — only allow exact match to avoid false positives
const EXACT_ONLY_KEYS: (keyof typeof COLUMN_PATTERNS)[] = ['hazardRef'];

function matchColumn(headerText: string, key: keyof typeof COLUMN_PATTERNS): boolean {
  const norm = normaliseHeader(headerText);
  if (norm.length > 35) return false;
  const exactOnly = EXACT_ONLY_KEYS.includes(key);
  return COLUMN_PATTERNS[key].some(p =>
    norm === p ||
    (!exactOnly && norm.startsWith(p)) ||
    (INCLUDE_MATCH_KEYS.includes(key) && norm.includes(p))
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');

  if (!fileId) {
    return NextResponse.json({ error: 'fileId is required' }, { status: 400 });
  }

  const downloadRes = await fetch(`${BASE_URL}/file/${fileId}/data`, {
    headers: { Authorization: AUTH_HEADER },
    cache: 'no-store',
  });
  if (!downloadRes.ok) {
    const detail = await downloadRes.text();
    return NextResponse.json({ error: 'Failed to download from Datto', detail }, { status: 502 });
  }
  const docxBuffer = await downloadRes.arrayBuffer();

  const zip = await JSZip.loadAsync(docxBuffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    return NextResponse.json({ error: 'word/document.xml not found in DOCX' }, { status: 422 });
  }
  const xml = await docFile.async('string');

  const tableMatches = Array.from(xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g));

  let colIndex: Record<string, number> = {};
  let rowMatches: RegExpExecArray[] = [];
  let columnHeaderRowIndex = 0;
  let found = false;

  for (const tableMatch of tableMatches) {
    const tblXml = tableMatch[0];
    const rows = Array.from(tblXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g));
    if (rows.length < 2) continue;

    const firstRowCells = Array.from(rows[0][0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => m[0]);
    const nonEmptyFirst = firstRowCells.filter(c => cellText(c).trim().length > 0);
    const titleText = nonEmptyFirst.length === 1 ? cellText(nonEmptyFirst[0]) : '';
    const isTitleRow = titleText.length > 0 && isActionTableTitle(titleText);

    const hdrRowIndex = isTitleRow ? 1 : 0;
    if (rows.length <= hdrRowIndex) continue;
    const hdrCells = Array.from(rows[hdrRowIndex][0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => m[0]);
    const candidate: Record<string, number> = {};
    hdrCells.forEach((cell, i) => {
      const text = cellText(cell);
      for (const key of Object.keys(COLUMN_PATTERNS) as (keyof typeof COLUMN_PATTERNS)[]) {
        if (!(key in candidate) && matchColumn(text, key)) candidate[key] = i;
      }
    });

    if (isTitleRow || 'action' in candidate) {
      colIndex = candidate;
      rowMatches = rows;
      columnHeaderRowIndex = hdrRowIndex;
      found = true;
      break;
    }
  }

  if (!found) {
    return NextResponse.json({ rows: [] });
  }

  const dataRows = rowMatches.slice(columnHeaderRowIndex + 1);
  const result: { hazardRef: string; actionText: string; responsiblePerson: string; targetDate: string; completedDate: string }[] = [];

  for (const rowMatch of dataRows) {
    const cells = Array.from(rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => cellText(m[0]).trim());
    const hazardRef = colIndex.hazardRef !== undefined ? (cells[colIndex.hazardRef] ?? '') : '';
    const actionText = colIndex.action !== undefined ? (cells[colIndex.action] ?? '') : '';
    const responsiblePerson = colIndex.responsible !== undefined ? (cells[colIndex.responsible] ?? '') : '';
    const targetDate = colIndex.targetDate !== undefined ? (cells[colIndex.targetDate] ?? '') : '';
    const completedDate = colIndex.completed !== undefined ? (cells[colIndex.completed] ?? '') : '';

    // Skip entirely empty rows
    if (!hazardRef && !actionText && !responsiblePerson && !targetDate && !completedDate) continue;

    result.push({ hazardRef, actionText, responsiblePerson, targetDate, completedDate });
  }

  return NextResponse.json({ rows: result });
}
