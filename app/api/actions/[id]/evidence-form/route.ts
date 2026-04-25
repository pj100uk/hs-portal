import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import {
  Document, Paragraph, TextRun, Table, TableRow, TableCell,
  Packer, WidthType, AlignmentType, BorderStyle, ImageRun,
  ShadingType, HeightRule, VerticalAlign, PageOrientation,
} from 'docx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const NAVY = '051f5b';
const LIGHT_GREY = 'f1f3f7';

function borderNone() {
  return { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' };
}

function borderThin(color = 'cccccc') {
  return { style: BorderStyle.SINGLE, size: 4, color };
}

function detailRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 20, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: LIGHT_GREY },
        borders: { top: borderThin(), bottom: borderThin(), left: borderThin(), right: borderThin() },
        children: [new Paragraph({
          children: [new TextRun({ text: label, bold: true, size: 20, font: 'Calibri', color: '374151' })],
          spacing: { before: 60, after: 60 },
        })],
      }),
      new TableCell({
        width: { size: 80, type: WidthType.PERCENTAGE },
        borders: { top: borderThin(), bottom: borderThin(), left: borderThin(), right: borderThin() },
        children: [new Paragraph({
          children: [new TextRun({ text: value || '—', size: 20, font: 'Calibri' })],
          spacing: { before: 60, after: 60 },
        })],
      }),
    ],
  });
}

function borderThick(color = NAVY) {
  return { style: BorderStyle.SINGLE, size: 12, color };
}

function blankAckRow(): TableRow {
  const cell = (widthPct: number, opts: { dividerLeft?: boolean; dividerRight?: boolean } = {}) => new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: {
      top: borderThin(),
      bottom: borderThin(),
      left: opts.dividerLeft ? borderThick() : borderThin(),
      right: opts.dividerRight ? borderThick() : borderThin(),
    },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text: '', size: 20 })], spacing: { before: 80, after: 80 } })],
  });
  // 6 columns: Name | Sig | Date ‖ Name | Sig | Date
  return new TableRow({
    height: { value: 420, rule: HeightRule.EXACT },
    children: [cell(22), cell(19), cell(9, { dividerRight: true }), cell(22, { dividerLeft: true }), cell(19), cell(9)],
  });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data: action, error } = await supabase
    .from('actions')
    .select('hazard_ref, hazard, source_document_name, site_id, existing_controls, description')
    .eq('id', params.id)
    .single();

  if (error || !action) return NextResponse.json({ error: 'Action not found' }, { status: 404 });

  const { data: site } = await supabase
    .from('sites')
    .select('name, organisation_id')
    .eq('id', action.site_id)
    .single();

  const orgId = site?.organisation_id ?? null;
  const [{ data: org }, { count: orgSiteCount }] = await Promise.all([
    orgId ? supabase.from('organisations').select('name').eq('id', orgId).single() : Promise.resolve({ data: null }),
    orgId ? supabase.from('sites').select('id', { count: 'exact', head: true }).eq('organisation_id', orgId) : Promise.resolve({ count: 0 }),
  ]);

  const orgName = org?.name ?? '';
  const siteName = site?.name ?? '';
  const clientLabel = orgName && orgSiteCount && orgSiteCount > 1
    ? `${orgName} / ${siteName}`
    : orgName || siteName;

  // Load logo PNG
  const logoPath = path.join(process.cwd(), 'public', 'logo.png');
  const logoData = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

  const docName = action.source_document_name?.replace(/\.[^.]+$/, '') ?? 'Risk Assessment';
  const issueDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  // Acknowledgement table header row
  const ackHeaderRow = new TableRow({
    tableHeader: true,
    children: (['Name', 'Signature', 'Date', 'Name', 'Signature', 'Date']).map((label, i) => {
      const widths = [22, 19, 9, 22, 19, 9];
      const dividerRight = i === 2;
      const dividerLeft = i === 3;
      return new TableCell({
        width: { size: widths[i], type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: NAVY },
        borders: {
          top: borderThin(NAVY),
          bottom: borderThin(NAVY),
          left: dividerLeft ? borderThick('FFFFFF') : borderThin(NAVY),
          right: dividerRight ? borderThick('FFFFFF') : borderThin(NAVY),
        },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: label, bold: true, size: 18, font: 'Calibri', color: 'FFFFFF' })],
          spacing: { before: 60, after: 60 },
        })],
      });
    }),
  });

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 720, bottom: 720, left: 900, right: 900 },
          size: { orientation: PageOrientation.LANDSCAPE, width: 11906, height: 16838 },
        },
      },
      children: [
        // Logo
        ...(logoData ? [new Paragraph({
          children: [new ImageRun({ data: logoData, transformation: { width: 220, height: 66 }, type: 'png' })],
          spacing: { after: 160 },
        })] : [new Paragraph({
          children: [new TextRun({ text: 'MB Health & Safety', bold: true, size: 36, font: 'Calibri', color: NAVY })],
          spacing: { after: 160 },
        })]),

        // Title
        new Paragraph({
          children: [new TextRun({
            text: 'Risk Assessment Communication & Acknowledgement Form',
            bold: true, size: 26, font: 'Calibri', color: NAVY,
          })],
          spacing: { after: 240 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY } },
        }),

        // Details table
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            detailRow('Risk Assessment', docName),
            detailRow('Client', clientLabel),
            detailRow('Date Issued', issueDate),
          ],
        }),

        // Intro text
        new Paragraph({
          children: [new TextRun({
            text: `The following members of staff have read the ${docName} risk assessment. Their signatures confirm they have read and understood all which is within its contents.`,
            size: 20, font: 'Calibri', italics: true, color: '374151',
          })],
          spacing: { before: 280, after: 200 },
        }),

        // Acknowledgement table
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [ackHeaderRow, ...Array.from({ length: 13 }, blankAckRow)],
        }),

        // Footer note
        new Paragraph({
          children: [new TextRun({
            text: `Generated by MB Health & Safety Portal · ${issueDate}`,
            size: 16, font: 'Calibri', color: '9ca3af',
          })],
          spacing: { before: 240 },
          alignment: AlignmentType.RIGHT,
        }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const safeDocName = docName.replace(/[^a-zA-Z0-9 \-_.]/g, '').trim();
  const filename = `${safeDocName} - Acknowledgement Form.docx`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
