import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';

const CLIENT_ID = '8768d9f6-7ae5-4c96-a8a7-512e3c957fd0';
const CLIENT_SECRET = '8228393f-1323-4d80-8dbe-e3e87c291158';
const BASE_URL = 'https://eu.workplace.datto.com/2/api/v1';
const AUTH_HEADER = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

// Extract all text from a table cell's XML
function decodeXmlEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function cellText(cellXml: string): string {
  return decodeXmlEntities(
    (cellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
      .map(t => t.replace(/<[^>]+>/g, ''))
      .join('')
  );
}

// Replace all text content in a cell, preserving the first run's formatting
function setCellText(cellXml: string, newText: string): string {
  const runs = Array.from(cellXml.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g));
  if (runs.length === 0) {
    // Empty cell — use the paragraph mark's rPr (inside <w:pPr>) which defines the cell's expected formatting
    const pPrMatch = cellXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/);
    const pPrRprMatch = pPrMatch ? pPrMatch[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) : null;
    const rPr = pPrRprMatch ? pPrRprMatch[0] : '';
    const newRun = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(newText)}</w:t></w:r>`;
    return cellXml.replace(/(<\/w:p>)/, `${newRun}$1`);
  }
  // Extract rPr from inside the first <w:r> specifically (not paragraph-mark rPr inside <w:pPr>)
  const firstRun = runs[0][0];
  const rPrMatch = firstRun.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  const rPr = rPrMatch ? rPrMatch[0] : '';
  const updatedFirstRun = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(newText)}</w:t></w:r>`;
  // Replace first run with updated content, remove any remaining runs
  let result = cellXml.replace(firstRun, updatedFirstRun);
  runs.slice(1).forEach(r => { result = result.replace(r[0], ''); });
  return result;
}

function escapeXml(str: string): string {
  return decodeXmlEntities(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Normalise header text for matching
function normaliseHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, '');
}

// A title row must contain "action"/"actions" AND one of these secondary words
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
  // Exact or near-exact cell labels only — must be the whole/primary label
  action:      ['actionrequired', 'actionsrequired', 'requiredaction', 'action'],
  responsible: ['responsible', 'personresponsible', 'responsibleperson', 'responsibleparty', 'responsiblefor'],
  targetDate:  ['targetdate', 'duedate', 'targetcompletion', 'targetcompletiondate', 'date'],
  completed:   ['completiondate', 'datecompleted', 'completeddate', 'completed', 'dateofcompletion'],
};

// For these keys, also allow the pattern to appear anywhere in the norm (they're distinctive enough)
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
  const { fileId, folderId, fileName: docFileName, hazardRef, actionText, responsiblePerson, targetDate, completedDate } =
    await request.json();

  if (!fileId || !folderId || !hazardRef) {
    return NextResponse.json({ error: 'fileId, folderId and hazardRef are required' }, { status: 400 });
  }

  // 1. Download the DOCX from Datto
  const downloadRes = await fetch(`${BASE_URL}/file/${fileId}/data`, {
    headers: { Authorization: AUTH_HEADER },
  });
  if (!downloadRes.ok) {
    const detail = await downloadRes.text();
    return NextResponse.json({ error: 'Failed to download from Datto', detail }, { status: 502 });
  }
  const docxBuffer = await downloadRes.arrayBuffer();

  // 2. Open as ZIP and get document.xml
  const zip = await JSZip.loadAsync(docxBuffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    return NextResponse.json({ error: 'word/document.xml not found in DOCX' }, { status: 422 });
  }
  let xml = await docFile.async('string');

  // 3. Find all tables and pick the action plan table
  const tableMatches = Array.from(xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g));
  if (tableMatches.length < 1) {
    return NextResponse.json({ error: 'No tables found in document' }, { status: 422 });
  }

  let actionTableXml = '';
  let tableStart = 0;
  let colIndex: Record<string, number> = {};
  let rowMatches: RegExpExecArray[] = [];
  let columnHeaderRowIndex = 0;
  let matchReason = '';

  // Build debug summary for all tables regardless of outcome
  const tableSummary = tableMatches.map((t, ti) => {
    const rows = Array.from(t[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g));
    const rowSummaries = rows.slice(0, 3).map((r, ri) => {
      const cells = Array.from(r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => cellText(m[0]));
      return `  row${ri}: ${cells.join(' | ')}`;
    });
    return `Table ${ti + 1}:\n${rowSummaries.join('\n')}`;
  }).join('\n\n');

  for (const tableMatch of tableMatches) {
    const tblXml = tableMatch[0];
    const rows = Array.from(tblXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g));
    if (rows.length < 2) continue;

    // Strategy 1: first row is a merged title cell e.g. "ACTION ARISING FROM RISK ASSESSMENT"
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

    if (isTitleRow) {
      // Title row match — accept regardless of column detection (title is authoritative)
      actionTableXml = tblXml;
      tableStart = tableMatch.index!;
      colIndex = candidate;
      rowMatches = rows;
      columnHeaderRowIndex = hdrRowIndex;
      matchReason = `title row: "${titleText}"`;
      break;
    } else if ('action' in candidate) {
      // Fallback: found action column in header row
      actionTableXml = tblXml;
      tableStart = tableMatch.index!;
      colIndex = candidate;
      rowMatches = rows;
      columnHeaderRowIndex = hdrRowIndex;
      matchReason = `column header match`;
      break;
    }
  }

  if (!actionTableXml) {
    return NextResponse.json({ error: `Could not find an action plan table.\n\n${tableSummary}` }, { status: 422 });
  }

  // 5. Report missing columns
  const missing = Object.keys(COLUMN_PATTERNS).filter(k => !(k in colIndex));
  if (missing.length > 0) {
    const hdrCells = Array.from(rowMatches[columnHeaderRowIndex][0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => cellText(m[0]));
    return NextResponse.json({
      error: `Matched by ${matchReason}. Missing columns: ${missing.join(', ')}.\nColumn headers: ${hdrCells.join(' | ')}\n\nAll tables:\n${tableSummary}`,
    }, { status: 422 });
  }

  // 6. Find the data row matching hazardRef (skip title + header rows)
  const dataRows = rowMatches.slice(columnHeaderRowIndex + 1);
  let targetRowXml: string | null = null;
  let originalRowXml: string | null = null;

  for (const rowMatch of dataRows) {
    const rowXml = rowMatch[0];
    const cells = Array.from(rowXml.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(m => m[0]);
    // Check all cells for a hazardRef match
    if (cells.some(c => cellText(c).trim() === String(hazardRef).trim())) {
      originalRowXml = rowXml;
      const updatedCells = [...cells];
      if (actionText !== undefined && colIndex.action < updatedCells.length)
        updatedCells[colIndex.action] = setCellText(updatedCells[colIndex.action], actionText);
      if (responsiblePerson !== undefined && colIndex.responsible < updatedCells.length)
        updatedCells[colIndex.responsible] = setCellText(updatedCells[colIndex.responsible], responsiblePerson);
      if (targetDate !== undefined && colIndex.targetDate < updatedCells.length)
        updatedCells[colIndex.targetDate] = setCellText(updatedCells[colIndex.targetDate], targetDate);
      if (completedDate !== undefined && colIndex.completed < updatedCells.length)
        updatedCells[colIndex.completed] = setCellText(updatedCells[colIndex.completed], completedDate);

      // Rebuild the row with updated cells
      let rebuilt = rowXml;
      cells.forEach((orig, i) => { rebuilt = rebuilt.replace(orig, updatedCells[i]); });
      targetRowXml = rebuilt;
      break;
    }
  }

  if (!originalRowXml || !targetRowXml) {
    return NextResponse.json({ error: `No row found with hazard ref "${hazardRef}"` }, { status: 422 });
  }

  // 7. Splice updated row back into the table XML, then back into full XML
  const updatedTableXml = actionTableXml.replace(originalRowXml, targetRowXml);
  xml = xml.slice(0, tableStart) + updatedTableXml + xml.slice(tableStart + actionTableXml.length);

  // 8. Repack the ZIP
  zip.file('word/document.xml', xml);
  const newDocxBuffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });

  // 9. Upload modified DOCX to the parent folder with the original filename
  const form = new FormData();
  form.append('partData', new Blob([newDocxBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }), docFileName);
  form.append('fileName', docFileName);
  form.append('makeUnique', 'false');

  const uploadRes = await fetch(`${BASE_URL}/file/${folderId}/files`, {
    method: 'POST',
    headers: { Authorization: AUTH_HEADER },
    body: form,
  });

  if (!uploadRes.ok) {
    const detail = await uploadRes.text();
    return NextResponse.json({ error: 'Datto upload failed', detail, status: uploadRes.status }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
