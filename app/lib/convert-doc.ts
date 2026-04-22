import { google } from 'googleapis';
import { Readable } from 'stream';

export async function convertDocToDocx(
  buffer: Buffer,
  fileName: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth });

  const uploaded = await drive.files.create({
    requestBody: { name: fileName, mimeType: 'application/vnd.google-apps.document' },
    media: { mimeType: 'application/msword', body: Readable.from(buffer) },
    fields: 'id',
  });
  const fileId = uploaded.data.id!;

  try {
    const exported = await drive.files.export(
      { fileId, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { responseType: 'arraybuffer' },
    );
    return {
      buffer: Buffer.from(exported.data as ArrayBuffer),
      fileName: fileName.replace(/\.doc$/i, '.docx'),
    };
  } finally {
    await drive.files.delete({ fileId }).catch(() => {});
  }
}
