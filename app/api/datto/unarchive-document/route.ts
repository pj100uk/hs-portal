import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const DATTO_DRIVE_ROOT = 'W:\\Customer Documents';

function toWinPath(s: string): string {
  return s.replace(/\//g, '\\');
}

export async function POST(request: NextRequest) {
  try {
    const { archivedFilePath, originalFolderPath, originalFileName } = await request.json();
    if (!archivedFilePath || !originalFolderPath || !originalFileName) {
      return NextResponse.json({ error: 'archivedFilePath, originalFolderPath, and originalFileName are required' }, { status: 400 });
    }

    if (!fs.existsSync(archivedFilePath)) {
      return NextResponse.json({ error: `Archived file not found: ${archivedFilePath}` }, { status: 404 });
    }

    const targetDir = path.join(DATTO_DRIVE_ROOT, toWinPath(originalFolderPath));
    const targetPath = path.join(targetDir, originalFileName);

    if (fs.existsSync(targetPath)) {
      return NextResponse.json({ error: `File already exists at original location: ${targetPath}` }, { status: 409 });
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.renameSync(archivedFilePath, targetPath);

    return NextResponse.json({ success: true, restoredPath: targetPath });
  } catch (err: any) {
    console.error('[unarchive-document] error:', err);
    return NextResponse.json({ error: err.message ?? 'Unarchive failed' }, { status: 500 });
  }
}
