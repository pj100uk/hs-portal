export const CLIENT_ID = '8768d9f6-7ae5-4c96-a8a7-512e3c957fd0';
export const CLIENT_SECRET = '8228393f-1323-4d80-8dbe-e3e87c291158';
export const BASE_URL = 'https://eu.workplace.datto.com/2/api/v1';
export const AUTH_HEADER = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

const CLIENT_DOCS_FOLDER_NAME = 'Client Provided Documents';

/**
 * Returns the ID of the "Client Provided Documents" subfolder under the given
 * site folder, creating it if it doesn't exist. Falls back to siteFolderId if
 * the create call fails (e.g. permission error).
 */
export async function resolveClientDocsFolderId(siteFolderId: string): Promise<string> {
  try {
    // List children of the site folder
    const listRes = await fetch(`${BASE_URL}/file/${siteFolderId}/files`, {
      headers: { Authorization: AUTH_HEADER },
      cache: 'no-store',
    });
    console.log('[folder-utils] list children status:', listRes.status, 'for folder:', siteFolderId);
    if (listRes.ok) {
      const items = await listRes.json();
      const arr: any[] = Array.isArray(items) ? items : (items.result ?? items.files ?? items.items ?? []);
      console.log('[folder-utils] children count:', arr.length, 'names:', arr.map((i: any) => i.name ?? i.fileName).join(', '));
      const existing = arr.find(
        (i: any) =>
          i.folder === true &&
          (i.name ?? '').toLowerCase() === CLIENT_DOCS_FOLDER_NAME.toLowerCase()
      );
      if (existing) {
        const id = String(existing.id ?? existing.fileId ?? existing.folderId);
        console.log('[folder-utils] found existing folder:', id);
        return id;
      }
    } else {
      const errText = await listRes.text();
      console.error('[folder-utils] list children failed:', errText);
    }

    // Attempt to create the subfolder — name is a query param per Datto API spec
    const createUrl = `${BASE_URL}/file/${siteFolderId}?name=${encodeURIComponent(CLIENT_DOCS_FOLDER_NAME)}`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { Authorization: AUTH_HEADER },
    });
    console.log('[folder-utils] create folder status:', createRes.status);
    if (createRes.ok) {
      const created = await createRes.json();
      const newId = created.id ?? created.fileId ?? created.folderId;
      if (newId) {
        console.log('[folder-utils] created new folder:', newId);
        return String(newId);
      }
    } else if (createRes.status === 409) {
      // Folder already exists — re-list to get its ID
      console.log('[folder-utils] folder already exists (409), re-listing...');
      const retryRes = await fetch(`${BASE_URL}/file/${siteFolderId}/files`, {
        headers: { Authorization: AUTH_HEADER },
        cache: 'no-store',
      });
      if (retryRes.ok) {
        const items = await retryRes.json();
        const arr: any[] = Array.isArray(items) ? items : (items.result ?? items.files ?? items.items ?? []);
        const found = arr.find((i: any) => i.folder === true && (i.name ?? '').toLowerCase() === CLIENT_DOCS_FOLDER_NAME.toLowerCase());
        if (found) {
          const id = String(found.id);
          console.log('[folder-utils] found folder after 409:', id);
          return id;
        }
      }
    } else {
      const errText = await createRes.text();
      console.error('[folder-utils] create folder failed:', errText);
    }
  } catch (err) {
    console.error('[folder-utils] exception:', err);
  }

  // Fallback: upload to the site root folder
  console.warn('[folder-utils] falling back to site root folder:', siteFolderId);
  return siteFolderId;
}
