import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const DATTO_BASE = 'https://eu.workplace.datto.com/2/api/v1';
const DATTO_CLIENT_ID = '8768d9f6-7ae5-4c96-a8a7-512e3c957fd0';
const DATTO_CLIENT_SECRET = '8228393f-1323-4d80-8dbe-e3e87c291158';
const DATTO_AUTH = 'Basic ' + Buffer.from(`${DATTO_CLIENT_ID}:${DATTO_CLIENT_SECRET}`).toString('base64');

const CLOUDCONVERT_API_KEY = process.env.CLOUDCONVERT_API_KEY!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVod253c3VyeXJ3b2V0cnlocWZoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzMxOTcwNSwiZXhwIjoyMDg4ODk1NzA1fQ.e_ejWJ-jm0Ct5vK6ATOrgG1P440LKQ1Kago6Z3kmGJ0';
const CACHE_BUCKET = 'pdf-cache';
const CACHE_TTL_HOURS = 24;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get('fileId');
  const fileName = searchParams.get('fileName') || 'document';

  if (!fileId) {
    return NextResponse.json({ error: 'Missing fileId' }, { status: 400 });
  }

  const cacheKey = `${fileId}.pdf`;

  // ── 1. Check Supabase cache ──
  try {
    const { data: existing } = await supabase.storage
      .from(CACHE_BUCKET)
      .list('', { search: cacheKey });

    if (existing && existing.length > 0) {
      const file = existing[0];
      const updatedAt = new Date(file.updated_at || file.created_at);
      const ageHours = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);

      if (ageHours < CACHE_TTL_HOURS) {
        console.log(`Cache hit for ${fileId}`);
        const { data: pdfData } = await supabase.storage
          .from(CACHE_BUCKET)
          .download(cacheKey);

        if (pdfData) {
          const buffer = await pdfData.arrayBuffer();
          const pdfName = fileName.replace(/\.[^/.]+$/, '') + '.pdf';
          return new NextResponse(buffer, {
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `inline; filename="${pdfName}"`,
              'Cache-Control': 'private, max-age=3600',
            },
          });
        }
      }
    }
  } catch (e) {
    console.error('Cache check failed:', e);
    // Continue to conversion
  }

  // ── 2. Fetch file from Datto ──
  console.log(`Converting ${fileName} via CloudConvert...`);
  const dattoRes = await fetch(`${DATTO_BASE}/file/${fileId}/data`, {
    headers: { Authorization: DATTO_AUTH },
  });

  if (!dattoRes.ok) {
    return NextResponse.json({ error: `Datto fetch failed: ${dattoRes.status}` }, { status: 500 });
  }

  const fileBuffer = await dattoRes.arrayBuffer();
  const ext = fileName.split('.').pop()?.toLowerCase() || 'docx';

  // ── 3. Upload to CloudConvert and convert ──
  try {
    // Create job
    const jobRes = await fetch('https://api.cloudconvert.com/v2/jobs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDCONVERT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tasks: {
          'upload-file': {
            operation: 'import/upload',
          },
          'convert-file': {
            operation: 'convert',
            input: 'upload-file',
            input_format: ext,
            output_format: 'pdf',
          },
          'export-file': {
            operation: 'export/url',
            input: 'convert-file',
          },
        },
      }),
    });

    if (!jobRes.ok) {
      const err = await jobRes.text();
      return NextResponse.json({ error: `CloudConvert job failed: ${err}` }, { status: 500 });
    }

    const job = await jobRes.json();
    const uploadTask = job.data.tasks.find((t: any) => t.name === 'upload-file');

    if (!uploadTask?.result?.form) {
      return NextResponse.json({ error: 'No upload form from CloudConvert' }, { status: 500 });
    }

    // Upload file to CloudConvert
    const { url, parameters } = uploadTask.result.form;
    const formData = new FormData();
    Object.entries(parameters).forEach(([k, v]) => formData.append(k, v as string));
    formData.append('file', new Blob([fileBuffer]), fileName);

    const uploadRes = await fetch(url, { method: 'POST', body: formData });
    if (!uploadRes.ok) {
      return NextResponse.json({ error: 'Upload to CloudConvert failed' }, { status: 500 });
    }

    // Wait for job to complete (poll up to 60 seconds)
    const jobId = job.data.id;
    let pdfUrl: string | null = null;

    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(r => setTimeout(r, 2000));

      const statusRes = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${CLOUDCONVERT_API_KEY}` },
      });
      const status = await statusRes.json();

      if (status.data.status === 'finished') {
        const exportTask = status.data.tasks.find((t: any) => t.name === 'export-file');
        pdfUrl = exportTask?.result?.files?.[0]?.url || null;
        break;
      } else if (status.data.status === 'error') {
        return NextResponse.json({ error: 'CloudConvert conversion error' }, { status: 500 });
      }
    }

    if (!pdfUrl) {
      return NextResponse.json({ error: 'Conversion timed out' }, { status: 500 });
    }

    // ── 4. Download converted PDF ──
    const pdfRes = await fetch(pdfUrl);
    const pdfBuffer = await pdfRes.arrayBuffer();

    // ── 5. Cache in Supabase Storage ──
    try {
      await supabase.storage
        .from(CACHE_BUCKET)
        .upload(cacheKey, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });
      console.log(`Cached PDF for ${fileId}`);
    } catch (e) {
      console.error('Cache save failed:', e);
      // Non-fatal — still serve the PDF
    }

    // ── 6. Return PDF ──
    const pdfName = fileName.replace(/\.[^/.]+$/, '') + '.pdf';
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${pdfName}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });

  } catch (e: any) {
    console.error('Conversion error:', e);
    return NextResponse.json({ error: e.message || 'Conversion failed' }, { status: 500 });
  }
}