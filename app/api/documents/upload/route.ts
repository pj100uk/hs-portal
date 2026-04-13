import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Busboy from 'busboy';
import { recalcSiteCompliance } from '../recalc-compliance';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    const { fileBuffer, fileName, fileSize, mimeType, siteId, userId } =
      await parseMultipart(request, contentType);

    if (!fileBuffer || !fileName) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!siteId) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
    }

    // Check for existing document with same filename for this site
    const { data: existingArr } = await supabase
      .from('site_documents')
      .select('id, document_name, file_name, datto_file_id')
      .eq('site_id', siteId)
      .eq('file_name', fileName)
      .limit(1);
    const existing = existingArr?.[0] ?? null;
    const duplicateId = existing?.id ?? null;
    const duplicateName = existing?.document_name ?? existing?.file_name ?? null;
    const duplicateDattoFileId = existing?.datto_file_id ?? null;

    // Check if site has a Datto folder configured — required for all uploads
    const { data: site } = await supabase
      .from('sites')
      .select('datto_folder_id')
      .eq('id', siteId)
      .single();

    if (!site?.datto_folder_id) {
      return NextResponse.json(
        { error: 'This site has no H&S document folder configured. Please contact your administrator to set up the Datto folder for this site before uploading documents.' },
        { status: 422 }
      );
    }

    // Insert Supabase record (Datto upload handled separately after user review)
    const { data: doc, error: insertErr } = await supabase
      .from('site_documents')
      .insert({
        site_id: siteId,
        uploaded_by: userId ?? null,
        file_name: fileName,
        file_size_bytes: fileSize ?? null,
        datto_file_id: null,
        datto_folder_id: null,
        client_provided: true,
      })
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    await recalcSiteCompliance(siteId, supabase);

    return NextResponse.json({ documentId: doc.id, duplicateId, duplicateName, duplicateDattoFileId });
  } catch (err: any) {
    console.error('[upload] error:', err);
    return NextResponse.json({ error: err.message ?? 'Upload failed' }, { status: 500 });
  }
}

function parseMultipart(request: NextRequest, contentType: string): Promise<{
  fileBuffer: Buffer | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  siteId: string;
  userId: string;
}> {
  return new Promise(async (resolve, reject) => {
    const bb = Busboy({ headers: { 'content-type': contentType } });
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let fileSize = 0;
    let fileMime = '';
    let siteId = '';
    let userId = '';
    const chunks: Buffer[] = [];

    bb.on('file', (_field: string, stream: any, info: { filename: string; mimeType: string }) => {
      fileName = info.filename;
      fileMime = info.mimeType;
      stream.on('data', (chunk: Buffer) => { chunks.push(chunk); fileSize += chunk.length; });
      stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
    });

    bb.on('field', (name: string, val: string) => {
      if (name === 'siteId') siteId = val;
      if (name === 'userId') userId = val;
    });

    bb.on('finish', () => resolve({ fileBuffer, fileName, fileSize, mimeType: fileMime, siteId, userId }));
    bb.on('error', reject);

    const body = await request.arrayBuffer();
    bb.write(Buffer.from(body));
    bb.end();
  });
}
