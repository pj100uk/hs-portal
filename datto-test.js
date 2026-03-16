const CLIENT_ID = '8768d9f6-7ae5-4c96-a8a7-512e3c957fd0';
const CLIENT_SECRET = '8228393f-1323-4d80-8dbe-e3e87c291158';
const BASE_URL = 'https://eu.workplace.datto.com/2/api/v1';
const fs = require('fs');
const path = require('path');

const headers = {
  'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
};

async function getFiles(folderId, folderPath = '') {
  const res = await fetch(`${BASE_URL}/file/${folderId}/files`, { headers });
  const data = await res.json();
  
  for (const item of data.result) {
    if (item.folder) {
      await getFiles(item.id, `${folderPath}/${item.name}`);
    } else if (item.name.endsWith('.docx')) {
      console.log(`Downloading: ${folderPath}/${item.name}`);
      const fileRes = await fetch(`${BASE_URL}/file/${item.id}/data`, { headers });
      const buffer = await fileRes.arrayBuffer();
      const localPath = `test-download/${folderPath}`;
      fs.mkdirSync(localPath, { recursive: true });
      fs.writeFileSync(`${localPath}/${item.name}`, Buffer.from(buffer));
      console.log(`Saved: ${localPath}/${item.name}`);
    }
  }
}

getFiles(1239993420, 'Entrust Global');