import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';

const CLIENT_ID = '8768d9f6-7ae5-4c96-a8a7-512e3c957fd0';
const CLIENT_SECRET = '8228393f-1323-4d80-8dbe-e3e87c291158';
const BASE_URL = 'https://eu.workplace.datto.com/2/api/v1';
const AUTH_HEADER = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

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

const COLUMN_PATTERNS: Record<string, string[]> = {
  action:      ['actionrequired', 'actionsrequired', 'requiredaction', 'action'],
  responsible: ['responsible', 'personresponsible', 'responsibleperson', 'responsibleparty', 'responsiblefor'],
  targetDate:  ['targetdate', 'duedate', 'targetcompletion', 'targetcompletiondate', 'date'],
  completed:   ['completiondate', 'datecompleted', 'completeddate', 'completed', 'dateofcompletion'],
};

const INCLUDE_MATCH_KEYS: (keyof typeof COLUMN_PATTERNS)[] = ['responsible', 'completed'];

function matchColumn(headerText: string, key: keyof typeof COLUMN_PATTERNS): boolean {
  const norm = normaliseHeader(headerText);
  if (norm.length > 35) return false;
  return COLUMN_PATTERNS[key].some(p =>
    norm === p ||
    norm.startsWith(p) ||
    (INCLUDE_MATCH_KEYS.includes(key) && norm.includes(p))
  );
}

export async function POST(request: NextRequest) {
  const { fileId, hazardRef } = await request.json();

  if (!fileId || !hazardRef) {
    return NextResponse.json({ error: 'fileId and hazardRef are required' }, { status: 400 });
  }

  const downloadRes = await fetch(`${BASE_URL}/file/${fileId}/data`, {
    headers: { Authorization: AUTH_HEADER },
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
  if (tableMatches.length < 1) {
    return NextResponse.json({ error: 'No tables found in document' }, { status: 422 });
  }

  let actionTableXml = '';
  let colIndex: Record<string, number> = {};
  let rowMatches: RegExpExecArray[] = [];
  let columnHeaderRowIndex = 0;

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
      actionTableXml = tblXml;
      colIndex = candidate;
      rowMatches = rows;
      columnHeaderRowIndex = hdrRowIndex;
      break;
    }
  }

  if (!actionTableXml) {
    return NextResponse.json({ error: 'Could not find an action plan table' }, { status: 422 });
  }

  const dataRows = rowMatches.slice(columnHeaderRowIndex + 1);
  for (const rowMatch of dataRows) {
    const cells = Array.from(rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => m[0]);
    if (cells.some(c => cellText(c).trim() === String(hazardRef).trim())) {
      return NextResponse.json({
        actionText:        'action'      in colIndex ? cellText(cells[colIndex.action]).trim()      : '',
        responsiblePerson: 'responsible' in colIndex ? cellText(cells[colIndex.responsible]).trim() : '',
        targetDate:        'targetDate'  in colIndex ? cellText(cells[colIndex.targetDate]).trim()  : '',
        completedDate:     'completed'   in colIndex ? cellText(cells[colIndex.completed]).trim()   : '',
      });
    }
  }

  return NextResponse.json({ error: `No row found with hazard ref "${hazardRef}"` }, { status: 422 });
}
