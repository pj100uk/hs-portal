import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash',
  generationConfig: { responseMimeType: 'application/json' } as any,
})

const PROMPT_SUFFIX = `You are an expert H&S (Health & Safety) compliance assistant.

Extract all action items from the following document. Return ONLY a JSON array.
Each item must have:
- "description": string (the action to be taken)
- "dueDate": string | null (ISO date YYYY-MM-DD if mentioned, otherwise null)
- "responsiblePerson": string | null (name or role if mentioned, otherwise null)
- "priority": "HIGH" | "MEDIUM" | "LOW" | null (infer from urgency language if possible)

If no actions are found, return an empty array [].`

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const { text, fileBase64, mimeType, docName } = body

  try {
    let result

    if (fileBase64 && mimeType) {
      // PDF or other binary — send as inline data to Gemini
      result = await model.generateContent([
        { inlineData: { data: fileBase64, mimeType } },
        `${PROMPT_SUFFIX}\n\nDocument name: ${docName}`,
      ])
    } else if (text?.trim()) {
      // Plain text (from .doc/.docx/.xlsx)
      result = await model.generateContent(
        `${PROMPT_SUFFIX}\n\nDocument name: ${docName}\nDocument text:\n${text}`
      )
    } else {
      return NextResponse.json({ error: 'Provide either text or fileBase64+mimeType' }, { status: 400 })
    }

    const actions = JSON.parse(result.response.text())
    return NextResponse.json({ actions })
  } catch (err: any) {
    console.error('Gemini error:', err)
    return NextResponse.json({ error: err.message || 'Gemini API error' }, { status: 500 })
  }
}
