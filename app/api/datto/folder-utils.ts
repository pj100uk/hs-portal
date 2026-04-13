export const CLIENT_ID = '8768d9f6-7ae5-4c96-a8a7-512e3c957fd0';
export const CLIENT_SECRET = '8228393f-1323-4d80-8dbe-e3e87c291158';
export const BASE_URL = 'https://eu.workplace.datto.com/2/api/v1';
export const AUTH_HEADER = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

const CLIENT_DOCS_FOLDER_NAME = 'Client Provided Documents';
const ARCHIVE_FOLDER_NAME = 'Archive';

/** Extract ID from a Datto item response — matches all known field variants */
function extractId(item: any): string | null {
  const raw = item.id ?? item.fileId ?? item.folderId ?? item.fileID ?? item.folderID;
  return raw != null ? String(raw) : null;
}

/** Detect whether a Datto list item is a folder — matches all known response shapes */
function isFolder(item: any): boolean {
  return (
    item.type === 'folder' ||
    item.type === 'FOLDER' ||
    item.isDirectory === true ||
    item.folderType !== undefined ||
    item.childCount !== undefined ||
    item.folder === true
  );
}

/** Normalise a Datto list response to a flat array */
function toArr(raw: any): any[] {
  return Array.isArray(raw) ? raw : (raw.result ?? raw.files ?? raw.items ?? raw.data ?? []);
}

/** List children of a Datto folder */
async function listChildren(folderId: string): Promise<any[]> {
  const res = await fetch(`${BASE_URL}/file/${folderId}/files`, {
    headers: { Authorization: AUTH_HEADER },
    cache: 'no-store',
  });
  if (!res.ok) { console.error('[folder-utils] list failed:', res.status, await res.text()); return []; }
  return toArr(await res.json());
}

/** Find a subfolder by name (case-insensitive) in a list of Datto items */
function findFolder(arr: any[], name: string): string | null {
  const match = arr.find(i => isFolder(i) && (i.name ?? i.folderName ?? '').toLowerCase() === name.toLowerCase());
  return match ? extractId(match) : null;
}

/** Resolve or create a named subfolder. Returns { id } on success or { id: null, error } on failure. */
async function resolveSubfolder(parentFolderId: string, folderName: string): Promise<{ id: string | null; error?: string }> {
  // Check if it already exists
  const children = await listChildren(parentFolderId);
  const existingId = findFolder(children, folderName);
  if (existingId) return { id: existingId };

  // Create it
  const createRes = await fetch(`${BASE_URL}/file/${parentFolderId}?name=${encodeURIComponent(folderName)}`, {
    method: 'POST',
    headers: { Authorization: AUTH_HEADER },
  });
  const createBody = await createRes.text();
  console.log('[folder-utils] create', folderName, '— status:', createRes.status, 'body:', createBody);

  if (createRes.ok) {
    let parsed: any = {};
    try { parsed = JSON.parse(createBody); } catch { /* not JSON */ }
    const newId = extractId(parsed);
    if (newId) { console.log('[folder-utils] created:', newId); return { id: newId }; }
    // Response OK but no ID in body — re-list to find it
    const retry = await listChildren(parentFolderId);
    const retryId = findFolder(retry, folderName);
    return retryId ? { id: retryId } : { id: null, error: `Folder created but ID not found. Response: ${createBody}` };
  }

  if (createRes.status === 409) {
    const retry = await listChildren(parentFolderId);
    const retryId = findFolder(retry, folderName);
    return retryId ? { id: retryId } : { id: null, error: `409 conflict but folder not found on re-list` };
  }

  return { id: null, error: `Datto folder create failed (${createRes.status}): ${createBody}` };
}

/**
 * Returns the ID of the "Archive" subfolder under the given parent folder,
 * creating it if it doesn't exist.
 */
export async function resolveArchiveFolderId(parentFolderId: string): Promise<string | null> {
  try {
    const { id } = await resolveSubfolder(parentFolderId, ARCHIVE_FOLDER_NAME);
    return id;
  } catch (err) {
    console.error('[folder-utils] resolveArchiveFolderId exception:', err);
    return null;
  }
}

/**
 * Returns the ID of the "Client Provided Documents" subfolder under the given
 * site folder, creating it if it doesn't exist.
 * Falls back to siteFolderId if creation fails (e.g. permission error).
 */
export async function resolveClientDocsFolderId(siteFolderId: string): Promise<string> {
  try {
    const { id } = await resolveSubfolder(siteFolderId, CLIENT_DOCS_FOLDER_NAME);
    if (id) return id;
  } catch (err) {
    console.error('[folder-utils] resolveClientDocsFolderId exception:', err);
  }
  // Fallback: upload directly to the site root folder
  console.warn('[folder-utils] falling back to site root folder:', siteFolderId);
  return siteFolderId;
}
