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
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const n = entry.name.toLowerCase();
    if (n.startsWith('z-archiv') || n.startsWith('z archiv')) {
      return path.join(dir, entry.name);
    }
  }
  return null;
}

function findZArchiveDir(startDir: string): { dir: string } | { error: string } {
  const searched: string[] = [];
  let current = startDir;
  while (current.toLowerCase().startsWith(DATTO_DRIVE_ROOT.toLowerCase())) {
    const parent = path.dirname(current);
    if (parent === current) break;
    const found = findZArchiveEntry(parent);
    if (found) return { dir: found };
    searched.push(parent);
    current = parent;
  }
  return { error: `Z-Archived Documents not found. Searched in: ${searched.join(', ') || startDir}` };
}

export async function POST(request: NextRequest) {
  try {
    const { sourceFolderPath, fileName, assessmentDate } = await request.json();
    console.log('[archive-document] sourceFolderPath:', sourceFolderPath, '| fileName:', fileName, '| assessmentDate:', assessmentDate);

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
    const baseName = fileName.slice(0, fileName.length - ext.length);
    const startYear = assessmentDate ? new Date(assessmentDate).getFullYear() : new Date().getFullYear();
    const yy2 = String(startYear + 1).slice(2);
    const archiveName = `${baseName} ${startYear}-${yy2}${ext}`;
    console.log('[archive-document] archive name:', archiveName);

    const result = findZArchiveDir(sourceDirWin);
    if ('error' in result) {
      console.log('[archive-document] Z-Archive not found:', result.error);
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    console.log('[archive-document] Z-Archive folder found:', result.dir);

    const parentFolderName = sourceFolderPath.split('/').filter(Boolean).pop() ?? '';
    const targetDir = parentFolderName ? path.join(result.dir, parentFolderName) : result.dir;
    console.log('[archive-document] parentFolderName:', parentFolderName, '| targetDir:', targetDir);

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
