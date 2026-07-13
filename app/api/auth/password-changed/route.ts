import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPasswordChangedEmail } from '../../../lib/email';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_ORIGIN = 'https://www.riskdox.co.uk';

export async function POST(request: NextRequest) {
  const { userId, origin } = await request.json();
  if (!userId) return NextResponse.json({ ok: true });

  const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!user?.email) return NextResponse.json({ ok: true });

  const base = origin ?? DEFAULT_ORIGIN;
  const reportUrl = `${base}/security-report?uid=${userId}`;
  await sendPasswordChangedEmail({ email: user.email, reportUrl });

  return NextResponse.json({ ok: true });
}
