import { NextRequest, NextResponse } from 'next/server';
import { convertDocToDocx } from '../../../lib/convert-doc';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const fileName = req.headers.get('x-file-name') || 'document.doc';
    const buffer = Buffer.from(await req.arrayBuffer());
    const { buffer: docxBuffer, fileName: docxFileName } = await convertDocToDocx(buffer, fileName);
    return new NextResponse(new Uint8Array(docxBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'X-Converted-Name': docxFileName,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Conversion failed' }, { status: 500 });
  }
}
