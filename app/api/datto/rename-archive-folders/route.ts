import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const DATTO_DRIVE_ROOT = 'W:\\Customer Documents';
const OLD_NAME = 'Z-Archive Manual';
const NEW_NAME = 'Z-Archived Documents';

function findAndRename(dir: string, renamed: string[], errors: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // skip unreadable dirs
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.name === OLD_NAME) {
      const newPath = path.join(dir, NEW_NAME);
      try {
        fs.renameSync(fullPath, newPath);
        renamed.push(fullPath);
        // Continue scanning the renamed folder for nested matches
        findAndRename(newPath, renamed, errors);
      } catch (e: any) {
        errors.push(`${fullPath}: ${e.message}`);
      }
    } else {
      findAndRename(fullPath, renamed, errors);
    }
  }
}

export async function POST() {
  if (!fs.existsSync(DATTO_DRIVE_ROOT)) {
    return NextResponse.json({ error: 'W: drive not accessible' }, { status: 500 });
  }

  const renamed: string[] = [];
  const errors: string[] = [];

  findAndRename(DATTO_DRIVE_ROOT, renamed, errors);

  return NextResponse.json({
    ok: true,
    renamed: renamed.length,
    renamedPaths: renamed,
    errors,
  });
}
