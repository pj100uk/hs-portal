import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/storage/signed-url?docId=xxx
// Returns a short-lived public signed URL for a client-uploaded file (for Office Online viewer)
export async function GET(request: NextRequest) {
  const docId = new URL(request.url).searchParams.get('docId');
  if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 });

  const { data: doc } = await supabase
    .from('site_documents')
    .select('file_name')
    .eq('id', docId)
    .single();

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

  const storagePath = `${docId}/${doc.file_name}`;
  const { data, error } = await supabase.storage
    .from('client-uploads')
    .createSignedUrl(storagePath, 3600); // 1 hour

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'Could not generate signed URL' }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl });
}
