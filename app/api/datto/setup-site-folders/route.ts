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

const Z_ARCHIVE_SUBFOLDERS = [
  'Accident, Incident Reporting',
  'Annual In-House Audit',
  'Communication/4.01 Sub-Contractor Process',
  'Competence & Training/3.01 Competence Matrix',
  'Competence & Training/3.02 Training/3.2.1 In House Brieftings',
  'Competence & Training/3.02 Training/3.2.2 Completed Training',
  'Health & Safety Monitoring/7.01 In-House Monitoring/7.1.1 In-House Inspections',
  'Health & Safety Monitoring/7.01 In-House Monitoring/7.1.2 Equipment Inspections',
  'Health & Safety Monitoring/7.01 In-House Monitoring/7.1.3 Occupational Health',
  'Health & Safety Monitoring/7.02 MBHS Visit Reports',
  'Health & Safety Monitoring/7.03 Permit to Work',
  'Health & Safety Related Policies/Templates',
  'Risk Assessments/Activities',
  'Risk Assessments/CoSHH',
  'Risk Assessments/DSE/DSE related Advice sheets',
  'Risk Assessments/Expectant Mother',
  'Risk Assessments/Fire',
  'Risk Assessments/Health & Wellbeing',
  'Risk Assessments/Manual Handling',
  'Risk Assessments/Miscellaneous',
  'Risk Assessments/Premises',
  'Risk Assessments/Work at Height',
  'Risk Assessments/Young Person',
];

// POST /api/datto/setup-site-folders
// Body: { folderPath: string, siteId?: string, siteName?: string }
// Creates standard folders for a site and stores the parent folder ID.
export async function POST(request: NextRequest) {
  try {
    const { folderPath, siteId, siteName } = await request.json();
    if (!folderPath) return NextResponse.json({ error: 'folderPath is required' }, { status: 400 });

    const parts = folderPath.split('/').filter(Boolean);
    const manualAbsPath = path.join(DATTO_DRIVE_ROOT, ...parts);
    const parentAbsPath = path.dirname(manualAbsPath);
    const orgFolderName = parts[0];

    const results: Record<string, string> = {};

    // Only create subfolders inside the H&S Manual if it already exists on disk.
    // Using recursive:true on a non-existent parent would silently create the whole
    // path, producing ghost H&S Manual folders whenever the stored path is stale.
    if (fs.existsSync(manualAbsPath)) {
      // 1. Client Provided Documents
      const clientDocsPath = path.join(manualAbsPath, 'Client Provided Documents');
      try {
        fs.mkdirSync(clientDocsPath, { recursive: true });
        results.clientProvided = 'created';
      } catch (err: any) {
        results.clientProvided = `failed: ${err.message}`;
      }

      // 2. Z-Archived Documents with full subfolder mirror
      const zArchiveBase = path.join(manualAbsPath, 'Z-Archived Documents');
      try {
        fs.mkdirSync(zArchiveBase, { recursive: true });
        for (const sub of Z_ARCHIVE_SUBFOLDERS) {
          fs.mkdirSync(path.join(zArchiveBase, ...sub.split('/')), { recursive: true });
        }
        results.zArchive = 'created';
      } catch (err: any) {
        results.zArchive = `failed: ${err.message}`;
      }
    } else {
      results.clientProvided = 'skipped — H&S Manual folder not found on disk';
      results.zArchive = 'skipped — H&S Manual folder not found on disk';
    }

    // 3. Vault/[Site Name]/ — sibling of the H&S Manual folder (org level)
    const vaultSiteName = siteName || parts[parts.length - 1].replace(/\s*H&S Manual\s*$/i, '').trim();
    const vaultPath = path.join(parentAbsPath, 'Vault', vaultSiteName);
    try {
      fs.mkdirSync(vaultPath, { recursive: true });
      results.vault = 'created';
    } catch (err: any) {
      results.vault = `failed: ${err.message}`;
    }

    // 4. Find org folder ID in Datto
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

    // 5. Find Vault/[Site Name] folder ID in Datto and save to DB
    if (siteId && parentFolderId) {
      const dbUpdates: Record<string, string> = { datto_parent_folder_id: parentFolderId };

      try {
        // Find Vault folder under org
        const vaultListRes = await fetch(`${BASE_URL}/file/${parentFolderId}/files`, {
          headers: { Authorization: AUTH_HEADER },
          cache: 'no-store',
        });
        if (vaultListRes.ok) {
          const vaultJson = await vaultListRes.json();
          const vaultArr: any[] = Array.isArray(vaultJson) ? vaultJson : (vaultJson.result ?? vaultJson.files ?? vaultJson.items ?? []);
          const vaultFolder = vaultArr.find((i: any) => /^vault$/i.test(i.name ?? ''));
          if (vaultFolder) {
            const vaultFolderId = String(vaultFolder.id ?? vaultFolder.fileId ?? '');
            // Find site subfolder within Vault
            const siteListRes = await fetch(`${BASE_URL}/file/${vaultFolderId}/files`, {
              headers: { Authorization: AUTH_HEADER },
              cache: 'no-store',
            });
            if (siteListRes.ok) {
              const siteJson = await siteListRes.json();
              const siteArr: any[] = Array.isArray(siteJson) ? siteJson : (siteJson.result ?? siteJson.files ?? siteJson.items ?? []);
              const siteVaultFolder = siteArr.find((i: any) => (i.name ?? '').toLowerCase() === vaultSiteName.toLowerCase());
              if (siteVaultFolder) {
                dbUpdates.vault_folder_id = String(siteVaultFolder.id ?? siteVaultFolder.fileId ?? '');
                results.vaultFolderId = dbUpdates.vault_folder_id;
              }
            }
          }
        }
      } catch (err: any) {
        results.vaultFolderLookup = `failed: ${err.message}`;
      }

      const { error } = await supabase
        .from('sites')
        .update(dbUpdates)
        .eq('id', siteId);
      results.dbUpdate = error ? `failed: ${error.message}` : 'saved';
    }

    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error('[setup-site-folders] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
