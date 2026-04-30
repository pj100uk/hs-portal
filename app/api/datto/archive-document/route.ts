import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const DATTO_DRIVE_ROOT = 'W:\\Customer Documents';

function toWinPath(slashPath: string): string {
  return slashPath.replace(/\//g, '\\');
}

function findZArchiveEntry(dir: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const matches = entries
    .filter(e => {
      if (!e.isDirectory()) return false;
      const n = e.name.toLowerCase();
      return n.startsWith('z-archiv') || n.startsWith('z archiv');
    })
    .sort((a, b) => {
      // Prefer 'z-archived*' (with d) over 'z-archive*' to avoid picking up unrelated archive folders
      const aD = a.name.toLowerCase().startsWith('z-archived') || a.name.toLowerCase().startsWith('z archived');
      const bD = b.name.toLowerCase().startsWith('z-archived') || b.name.toLowerCase().startsWith('z archived');
      if (aD && !bD) return -1;
      if (!aD && bD) return 1;
      return a.name.localeCompare(b.name);
    });
  return matches.length > 0 ? path.join(dir, matches[0].name) : null;
}

// Strip leading numeric prefix ("01. ", "2. ", "3 ") for fuzzy folder matching
function normalizeSegment(s: string): string {
  return s.replace(/^\d+[\.\s]+/, '').trim().toLowerCase();
}

// Walk relSegments into baseDir, matching existing folders by normalised name where possible
function resolveArchivePath(baseDir: string, relSegments: string[]): string {
  let current = baseDir;
  for (const seg of relSegments) {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { /* fall through */ }
    const norm = normalizeSegment(seg);
    const match = entries.find(e => e.isDirectory() && normalizeSegment(e.name) === norm);
    current = path.join(current, match ? match.name : seg);
  }
  return current;
}

function findZArchiveDir(startDir: string): { dir: string; zParent: string } | { error: string } {
  const searched: string[] = [];
  let current = startDir;
  while (current.toLowerCase().startsWith(DATTO_DRIVE_ROOT.toLowerCase())) {
    const parent = path.dirname(current);
    if (parent === current) break;
    const found = findZArchiveEntry(parent);
    if (found) return { dir: found, zParent: parent };
    searched.push(parent);
    current = parent;
  }
  return { error: `Z-Archived Documents not found. Searched in: ${searched.join(', ') || startDir}` };
}

export async function POST(request: NextRequest) {
  try {
    const { sourceFolderPath, fileName } = await request.json();
    console.log('[archive-document] sourceFolderPath:', sourceFolderPath, '| fileName:', fileName);

    if (!sourceFolderPath || !fileName) {
      return NextResponse.json({ error: 'sourceFolderPath and fileName are required' }, { status: 400 });
    }

    const sourceDirWin = path.join(DATTO_DRIVE_ROOT, toWinPath(sourceFolderPath));
    const sourceFilePath = path.join(sourceDirWin, fileName);
    console.log('[archive-document] source file path:', sourceFilePath);
    console.log('[archive-document] source exists:', fs.existsSync(sourceFilePath));

    if (!fs.existsSync(sourceFilePath)) {
      return NextResponse.json({ error: `Source file not found: ${sourceFilePath}` }, { status: 404 });
    }

    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    const baseName = fileName.slice(0, fileName.length - ext.length).trimEnd();
    const today = new Date().toISOString().slice(0, 10);
    const archiveName = `${baseName} arc${today}${ext}`;
    console.log('[archive-document] archive name:', archiveName);

    const result = findZArchiveDir(sourceDirWin);
    if ('error' in result) {
      console.log('[archive-document] Z-Archive not found:', result.error);
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    console.log('[archive-document] Z-Archive folder found:', result.dir);

    // Resolve archive sub-folder by matching each path segment against existing folders,
    // normalising away numeric prefixes so "02. Risk Assessments" matches "Risk Assessments"
    const relPath = path.relative(result.zParent, sourceDirWin);
    const relSegments = relPath ? relPath.split(path.sep) : [];
    const targetDir = relSegments.length > 0 ? resolveArchivePath(result.dir, relSegments) : result.dir;
    console.log('[archive-document] relPath:', relPath, '| targetDir:', targetDir);

    fs.mkdirSync(targetDir, { recursive: true });

    const targetFilePath = path.join(targetDir, archiveName);
    console.log('[archive-document] moving', sourceFilePath, '->', targetFilePath);

    fs.renameSync(sourceFilePath, targetFilePath);
    console.log('[archive-document] move complete');

    return NextResponse.json({ success: true, archivedFileName: archiveName, targetPath: targetFilePath });
  } catch (err: any) {
    console.error('[archive-document] error:', err);
    return NextResponse.json({ error: err.message ?? 'Archive failed' }, { status: 500 });
  }
}
