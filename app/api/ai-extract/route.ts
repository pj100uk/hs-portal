import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: { responseMimeType: 'application/json', temperature: 0 } as any,
})

const PROMPT_SUFFIX = `You are an expert H&S (Health & Safety) compliance assistant.

Analyse the following document and extract all action items, required controls, recommended actions, outstanding items, corrective actions, or any other content indicating something needs to be done or improved. Return a single JSON object with two keys: "documentMeta" and "actions".

"documentMeta" must have:
- "assessmentDate": string | null (ISO date YYYY-MM-DD if found, otherwise null)
- "reviewDate": string | null (ISO date YYYY-MM-DD of last review/update if found, otherwise null)
- "assessor": string | null (name of the person who completed the assessment, otherwise null)
- "clientConsulted": string | null (name of client or person consulted, otherwise null)

Many H&S documents contain two tables: a hazard register (rows numbered 1, 2, 3… each with a hazard description, existing controls, and risk rating) and a separate action plan table (rows referencing those same numbers). You MUST cross-reference every action back to the hazard register using the hazard number to populate "hazard", "existingControls", and "riskRating" — do not leave these null if the information exists in the document. If an action references "All" hazards rather than a specific number, summarise the overall hazard context from the document. Never return the hazard number itself as the hazard description.

"actions" must be an array. Each item must have:
- "description": string (the action to be taken)
- "hazardRef": string | null (the raw hazard reference number or code as written in the action plan, e.g. "1", "3", "H-04" — null if no numbered reference exists)
- "hazard": string | null (full hazard description looked up from the hazard register if referenced by number, otherwise the hazard as written, otherwise null)
- "existingControls": string | null (controls already in place for this hazard, looked up from the hazard register if applicable, otherwise null)
- "regulation": string | null (relevant legislation or regulation if mentioned, otherwise null)
- "riskRating": string | null (the raw risk rating as written in the document, e.g. "16/25", "High", "Red", otherwise null)
- "riskLevel": "HIGH" | "MEDIUM" | "LOW" | null (your best interpretation of the risk rating — this is a suggestion only and will be reviewed by an advisor)
- "responsiblePerson": string | null (name or role if mentioned, otherwise null)
- "dueDate": string | null (ISO date YYYY-MM-DD only if an explicit calendar date is stated for this specific action — do NOT use the document date, assessment date, or review date)
- "dueDateRelative": string | null (if the action states a relative timeframe such as "1 month", "6 weeks", "3 months", "immediately" etc., return it exactly as written; also use this for open-ended terms such as "Ongoing", "Continuous", "Permanent", "Regular" — only populate this if dueDate is null)
- "priority": "HIGH" | "MEDIUM" | "LOW" | null (urgency of the action itself, inferred from language if possible)

If no actions are found, return { "documentMeta": { "assessmentDate": null, "reviewDate": null, "assessor": null, "clientConsulted": null }, "actions": [] }.`

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const { text, fileBase64, mimeType, docName } = body
  const syncId = Date.now()

  try {
    let result

    if (fileBase64 && mimeType) {
      // PDF or other binary — send as inline data to Gemini
      result = await model.generateContent([
        { inlineData: { data: fileBase64, mimeType } },
        `${PROMPT_SUFFIX}\n\nDocument name: ${docName}\nSync-ID: ${syncId}`,
      ])
    } else if (text?.trim()) {
      // Plain text (from .doc/.docx/.xlsx)
      result = await model.generateContent(
        `${PROMPT_SUFFIX}\n\nDocument name: ${docName}\nSync-ID: ${syncId}\nDocument text:\n${text}`
      )
    } else {
      return NextResponse.json({ error: 'Provide either text or fileBase64+mimeType' }, { status: 400 })
    }

    const parsed = JSON.parse(result.response.text())
    return NextResponse.json({ documentMeta: parsed.documentMeta ?? null, actions: parsed.actions ?? [] })
  } catch (err: any) {
    console.error('Gemini error:', err)
    return NextResponse.json({ error: err.message || 'Gemini API error' }, { status: 500 })
  }
}
