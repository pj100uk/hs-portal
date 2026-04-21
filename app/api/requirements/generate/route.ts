import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function sizeBand(employeeCount?: number | null): string {
  if (!employeeCount) return 'an unknown number of';
  if (employeeCount <= 9) return 'fewer than 10';
  if (employeeCount <= 49) return '10 to 49';
  if (employeeCount <= 249) return '50 to 249';
  return 'more than 250';
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.siteType) return NextResponse.json({ error: 'siteType required' }, { status: 400 });

  const siteTypeLabel = (body.siteType as string).charAt(0) + (body.siteType as string).slice(1).toLowerCase();
  const size = sizeBand(body.employeeCount);

  const prompt = `You are a UK health and safety expert advising a health and safety consultancy.

For a ${siteTypeLabel} workplace with ${size} employees, list the health and safety services that the consultancy would typically provide or recommend to their client.

Rules:
- Focus on services a consultancy delivers (assessments, audits, training, policies, inspections) — not internal H&S procedures the client runs themselves.
- Mark is_mandatory: true ONLY if the service is legally required under current UK legislation.
- When is_mandatory is true, provide the specific Act or Regulation in legal_basis. Leave legal_basis as an empty string when is_mandatory is false.
- Be specific and practical. Aim for 6–12 items.

Return ONLY a valid JSON array with no additional text or markdown:
[
  {
    "requirement_name": "string",
    "description": "string",
    "is_mandatory": true,
    "legal_basis": "string"
  }
]`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const inputTokens = message.usage.input_tokens;
    const outputTokens = message.usage.output_tokens;
    const costUsd = (inputTokens / 1_000_000 * 3.00) + (outputTokens / 1_000_000 * 15.00);
    supabase.from('ai_usage_log').insert({
      service: 'claude', model: 'claude-sonnet-4-6', operation: 'requirements-generate',
      input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd,
      metadata: { siteType: body.siteType },
    }).then(() => {});

    const text = message.content.find(b => b.type === 'text')?.text ?? '';
    // Strip any markdown fences if present
    const json = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const requirements = JSON.parse(json);

    return NextResponse.json({ requirements });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
