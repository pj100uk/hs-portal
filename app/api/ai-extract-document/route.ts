import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: { responseMimeType: 'application/json', temperature: 0 } as any,
});

const PROMPT = `You are a compliance document analyst for a health & safety management portal.

Analyse the provided document and extract the following information. Return a single JSON object with these keys:

- "documentName": string | null — the title or name of the document (e.g. "Fire Extinguisher Service Certificate", "Manual Handling Training Record")
- "documentType": string | null — the category of document (e.g. "Certificate", "Training Record", "Inspection Report", "Risk Assessment", "Insurance Certificate", "Equipment Test")
- "issueDate": string | null — the date the document was issued or completed, as ISO date YYYY-MM-DD, or null if not found
- "expiryDate": string | null — the date the document expires, is due for renewal, or next review is required, as ISO date YYYY-MM-DD, or null if not found. Look for words like "expiry", "valid until", "renewal due", "next inspection", "review date"
- "peopleMentioned": string[] — full names of any individuals mentioned, whether as the subject of training/certification, the assessor, the responsible person, or the issuing authority. Return as an array of strings. Return [] if none found
- "actions": array — required actions explicitly stated in the document, PLUS proactive suggestions based on document type and content (e.g. renewal reminders, review schedules, follow-up inspections). Always return at least 1–3 actions. Each item must have:
  - "hazardContext": string | null — the hazard, material, item, or subject this action relates to, taken verbatim or very closely from the same row, section, or entry as the action. For example, from an asbestos survey table: "Presumed gaskets to pipe flanges, boiler room". Null if no specific hazard or subject is identifiable.
  - "description": string — the action required, copied as closely as possible to the exact wording in the document. Do NOT blend or combine text from other rows or sections. If the action text is brief (e.g. "Remove and dispose of in accordance with The Control of Asbestos Regulations 2012"), return it as-is without adding material descriptions or context from elsewhere in the table.
  - "dueDate": string | null (ISO date YYYY-MM-DD if a specific date is stated, otherwise null)
  - "responsiblePerson": string | null
  - "priority": "HIGH" | "MEDIUM" | "LOW" | null
  - "suggested": boolean — true if this is a proactive suggestion inferred from context (not explicitly stated in the document), false if explicitly required by the document

If a field cannot be determined, return null (or [] for arrays). Do not guess dates — only return dates explicitly stated in the document.`;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { text, fileBase64, mimeType, docName } = body;
  const syncId = Date.now();

  try {
    let result;

    if (fileBase64 && mimeType) {
      result = await model.generateContent([
        { inlineData: { data: fileBase64, mimeType } },
        `${PROMPT}\n\nDocument name: ${docName}\nSync-ID: ${syncId}`,
      ]);
    } else if (text?.trim()) {
      result = await model.generateContent(
        `${PROMPT}\n\nDocument name: ${docName}\nSync-ID: ${syncId}\nDocument text:\n${text}`
      );
    } else {
      return NextResponse.json({ error: 'Provide either text or fileBase64+mimeType' }, { status: 400 });
    }

    const parsed = JSON.parse(result.response.text());
    return NextResponse.json({
      documentName: parsed.documentName ?? null,
      documentType: parsed.documentType ?? null,
      issueDate: parsed.issueDate ?? null,
      expiryDate: parsed.expiryDate ?? null,
      peopleMentioned: Array.isArray(parsed.peopleMentioned) ? parsed.peopleMentioned : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    });
  } catch (err: any) {
    console.error('Gemini document extract error:', err);
    return NextResponse.json({ error: err.message || 'Gemini API error' }, { status: 500 });
  }
}
