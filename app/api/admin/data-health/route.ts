import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function assertSuperadmin(userId: string) {
  const { data } = await supabase.from('profiles').select('role').eq('id', userId).single();
  return data?.role === 'superadmin';
}

function groupBySite(rows: { site_id: string }[], siteMap: Map<string, { name: string; org_name: string }>) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.site_id, (counts.get(r.site_id) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([site_id, count]) => ({
      site_id,
      site_name: siteMap.get(site_id)?.name ?? 'Unknown site',
      org_name: siteMap.get(site_id)?.org_name ?? '',
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

// Groups by site but counts distinct source documents rather than individual rows.
// Used for action-based checks where the user acts on documents, not individual actions.
function groupBySiteByDoc(
  rows: { site_id: string; source_document_id?: string | null; source_document_name?: string | null }[],
  siteMap: Map<string, { name: string; org_name: string }>,
) {
  const siteDocs = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!siteDocs.has(r.site_id)) siteDocs.set(r.site_id, new Set());
    siteDocs.get(r.site_id)!.add(r.source_document_id ?? r.source_document_name ?? '__unknown__');
  }
  return Array.from(siteDocs.entries())
    .map(([site_id, docs]) => ({
      site_id,
      site_name: siteMap.get(site_id)?.name ?? 'Unknown site',
      org_name: siteMap.get(site_id)?.org_name ?? '',
      count: docs.size,
    }))
    .sort((a, b) => b.count - a.count);
}

function countDistinctDocs(rows: { source_document_id?: string | null; source_document_name?: string | null }[]) {
  const keys = new Set(rows.map(r => r.source_document_id ?? r.source_document_name ?? '__unknown__'));
  return keys.size;
}

export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId || !(await assertSuperadmin(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [sitesRes, orgsRes] = await Promise.all([
    supabase.from('sites').select('id, name, organisation_id, datto_folder_id, last_ai_sync'),
    supabase.from('organisations').select('id, name'),
  ]);

  const orgMap = new Map((orgsRes.data ?? []).map(o => [o.id, o.name]));
  const siteMap = new Map(
    (sitesRes.data ?? []).map(s => [s.id, { name: s.name, org_name: orgMap.get(s.organisation_id) ?? '' }])
  );
  const allSiteIds = new Set((sitesRes.data ?? []).map(s => s.id));

  const [
    actionsRes,
    siteDocsRes,
    siteDocIdsRes,
  ] = await Promise.all([
    supabase.from('actions').select('id, site_id, status, resolved_date, site_document_id, source_document_id, source_document_name, extraction_version, source_folder_path'),
    supabase.from('site_documents').select('id, site_id, document_type, datto_file_id, client_provided, extraction_version'),
    supabase.from('site_documents').select('id'),
  ]);

  const actions = actionsRes.data ?? [];
  const siteDocs = siteDocsRes.data ?? [];
  const validDocIds = new Set((siteDocIdsRes.data ?? []).map(d => d.id));

  // 1. Orphaned actions — site_document_id points to a deleted site_documents row
  const orphanedActions = actions.filter(
    a => a.site_document_id != null && !validDocIds.has(a.site_document_id)
  );

  // 2. Archive / resolve status mismatches — status set but no resolved_date
  const archiveMismatches = actions.filter(
    a => (a.status === 'archived' || a.status === 'resolved') && !a.resolved_date
  );

  // 3. Outdated extraction — marked for rescan by migration (extraction_version = 0)
  const outdatedExtraction = actions.filter(a => a.extraction_version === 0);

  // 5. Unscanned compliance docs — never had AI extraction run
  const unscannedDocs = siteDocs.filter(d => d.document_type == null);

  // 6. Compliance docs with missing Datto file ID — upload likely timed out
  const missingDattoId = siteDocs.filter(d => d.datto_file_id == null && d.client_provided === true);

  // 7. Never-synced sites that have a Datto folder configured
  const neverSyncedSites = (sitesRes.data ?? []).filter(
    s => s.datto_folder_id != null && s.last_ai_sync == null
  );

  // 8. Missing folder path — RA actions from Datto with no source_folder_path, so the
  //    W: drive document link can't be built and the advisor can't open the file.
  //    Only flag open/in-progress actions (archived/resolved don't need the link).
  const missingFolderPath = actions.filter(
    a => a.source_document_id != null &&
         (a.source_folder_path == null || a.source_folder_path === '') &&
         a.status !== 'archived' && a.status !== 'resolved'
  );

  const checks = [
    {
      id: 'orphaned_actions',
      label: 'Orphaned Actions',
      description: 'Actions linked to compliance documents that no longer exist. Safe to delete automatically.',
      severity: orphanedActions.length > 0 ? 'error' : 'ok',
      count: orphanedActions.length,
      countUnit: 'action',
      fixable: true,
      fixLabel: 'Delete orphaned actions',
      details: groupBySite(orphanedActions, siteMap),
    },
    {
      id: 'archive_mismatches',
      label: 'Archive/Resolve Mismatches',
      description: 'Actions marked as archived or resolved but with no resolved date — likely from a failed archive operation.',
      severity: archiveMismatches.length > 0 ? 'warning' : 'ok',
      count: archiveMismatches.length,
      countUnit: 'action',
      fixable: true,
      fixLabel: 'Set resolved date to today',
      details: groupBySite(archiveMismatches, siteMap),
    },
    {
      id: 'outdated_extraction',
      label: 'Outdated AI Extraction',
      description: 'RA actions with incomplete data (missing hazard, risk level, or existing controls) from before prompt improvements. Run "Sync all" on affected sites.',
      severity: outdatedExtraction.length > 0 ? 'warning' : 'ok',
      count: countDistinctDocs(outdatedExtraction),
      countUnit: 'doc',
      fixable: false,
      fixLabel: null,
      details: groupBySiteByDoc(outdatedExtraction, siteMap),
    },
    {
      id: 'unscanned_docs',
      label: 'Unscanned Compliance Docs',
      description: 'Uploaded compliance documents that have never been through AI extraction — document type, dates, and people are missing. Re-upload or use the document rescan flow.',
      severity: unscannedDocs.length > 0 ? 'info' : 'ok',
      count: unscannedDocs.length,
      countUnit: 'doc',
      fixable: false,
      fixLabel: null,
      details: groupBySite(unscannedDocs, siteMap),
    },
    {
      id: 'missing_datto_ids',
      label: 'Missing Datto File Links',
      description: 'Compliance documents uploaded to the portal but where the Datto file ID was never recorded — usually because the Datto polling timed out during upload. The file may exist in Datto but the portal cannot archive or manage it.',
      severity: missingDattoId.length > 0 ? 'warning' : 'ok',
      count: missingDattoId.length,
      countUnit: 'doc',
      fixable: false,
      fixLabel: null,
      details: groupBySite(missingDattoId, siteMap),
    },
    {
      id: 'never_synced_sites',
      label: 'Never AI-Synced Sites',
      description: 'Sites with a Datto folder configured but no AI sync has ever been run. Open each site and run an AI sync to extract actions from their documents.',
      severity: neverSyncedSites.length > 0 ? 'warning' : 'ok',
      count: neverSyncedSites.length,
      countUnit: 'site',
      fixable: false,
      fixLabel: null,
      details: neverSyncedSites.map(s => ({
        site_id: s.id,
        site_name: s.name,
        org_name: orgMap.get(s.organisation_id) ?? '',
        count: 1,
      })),
    },
    {
      id: 'missing_folder_path',
      label: 'Missing Datto Folder Paths',
      description: 'Open RA actions from Datto with no folder path recorded — the "Open document" link on these actions will not work. Re-running AI Sync for the affected sites will refresh the paths.',
      severity: missingFolderPath.length > 0 ? 'warning' : 'ok',
      count: countDistinctDocs(missingFolderPath),
      countUnit: 'doc',
      fixable: false,
      fixLabel: null,
      details: groupBySiteByDoc(missingFolderPath, siteMap),
    },
  ];

  return NextResponse.json({ checks });
}

export async function POST(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId || !(await assertSuperadmin(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const repair = body?.repair as string;

  if (repair === 'orphaned_actions' || repair === 'all_safe') {
    const { data: actionRefs } = await supabase
      .from('actions')
      .select('id, site_document_id')
      .not('site_document_id', 'is', null);

    const { data: validDocs } = await supabase.from('site_documents').select('id');
    const validSet = new Set((validDocs ?? []).map(d => d.id));
    const orphanedIds = (actionRefs ?? [])
      .filter(a => !validSet.has(a.site_document_id))
      .map(a => a.id);

    if (orphanedIds.length > 0) {
      await supabase.from('actions').delete().in('id', orphanedIds);
    }

    if (repair === 'orphaned_actions') {
      return NextResponse.json({ fixed: orphanedIds.length, detail: `Deleted ${orphanedIds.length} orphaned action(s)` });
    }
  }

  if (repair === 'archive_mismatches' || repair === 'all_safe') {
    const today = new Date().toISOString().slice(0, 10);
    const { data: fixedRows } = await supabase
      .from('actions')
      .update({ resolved_date: today })
      .in('status', ['archived', 'resolved'])
      .is('resolved_date', null)
      .select('id');

    const fixedCount = fixedRows?.length ?? 0;
    if (repair === 'archive_mismatches') {
      return NextResponse.json({ fixed: fixedCount, detail: `Set resolved_date on ${fixedCount} action(s)` });
    }
  }

  if (repair === 'all_safe') {
    return NextResponse.json({ fixed: null, detail: 'All safe auto-fixes applied' });
  }

  return NextResponse.json({ error: 'Unknown repair type' }, { status: 400 });
}
