import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { BASE_URL, AUTH_HEADER } from '../folder-utils';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const DATTO_DRIVE_ROOT = 'W:\\Customer Documents';
const DATTO_CUSTOMER_DOCS_ROOT = '175942289';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/datto/setup-site-folders
// Body: { folderPath: string, siteId?: string }
// Creates standard folders for a site and stores the parent folder ID.
export async function POST(request: NextRequest) {
  try {
    const { folderPath, siteId } = await request.json();
    if (!folderPath) return NextResponse.json({ error: 'folderPath is required' }, { status: 400 });

    const parts = folderPath.split('/').filter(Boolean);
    const manualAbsPath = path.join(DATTO_DRIVE_ROOT, ...parts);
    const parentAbsPath = path.dirname(manualAbsPath);
    const orgFolderName = parts[0]; // e.g. "Jack Arnold UK Limited -Test"

    const results: Record<string, string> = {};

    // 1. Client Provided Documents — inside the H&S Manual folder
    const clientDocsPath = path.join(manualAbsPath, 'Client Provided Documents');
    try {
      fs.mkdirSync(clientDocsPath, { recursive: true });
      results.clientProvided = 'created';
    } catch (err: any) {
      results.clientProvided = `failed: ${err.message}`;
    }

    // 2. Archive — sibling of the H&S Manual folder
    const archivePath = path.join(parentAbsPath, 'Archive');
    try {
      fs.mkdirSync(archivePath, { recursive: true });
      results.archive = 'created';
    } catch (err: any) {
      results.archive = `failed: ${err.message}`;
    }

    // 3. Find parent folder ID in Datto so archive moves work correctly
    let parentFolderId: string | null = null;
    try {
      const listRes = await fetch(`${BASE_URL}/file/${DATTO_CUSTOMER_DOCS_ROOT}/files`, {
        headers: { Authorization: AUTH_HEADER },
        cache: 'no-store',
      });
      if (listRes.ok) {
        const json = await listRes.json();
        const arr: any[] = Array.isArray(json) ? json : (json.result ?? json.files ?? json.items ?? []);
        const match = arr.find((i: any) => (i.name ?? '').toLowerCase() === orgFolderName.toLowerCase());
        if (match) {
          parentFolderId = String(match.id ?? match.fileId ?? '');
          results.parentFolderId = parentFolderId;
        } else {
          results.parentFolderId = 'not found in Datto listing';
        }
      }
    } catch (err: any) {
      results.parentFolderLookup = `failed: ${err.message}`;
    }

    // 4. Save parent folder ID to DB if siteId provided
    if (siteId && parentFolderId) {
      const { error } = await supabase
        .from('sites')
        .update({ datto_parent_folder_id: parentFolderId })
        .eq('id', siteId);
      results.dbUpdate = error ? `failed: ${error.message}` : 'saved';
    }

    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error('[setup-site-folders] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
