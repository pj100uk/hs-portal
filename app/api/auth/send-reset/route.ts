import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPasswordResetEmail } from '../../../lib/email';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const { email, origin: clientOrigin } = await request.json();
  if (!email) return NextResponse.json({ ok: true }); // always return ok — don't reveal if email exists

  const origin = (clientOrigin ?? 'https://www.riskdox.co.uk') + '/';

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: origin },
  });

  if (!error && data?.properties?.action_link) {
    const reportUrl = `${origin.replace(/\/$/, '')}/security-report?uid=${data.user.id}`;
    await sendPasswordResetEmail({ email, resetUrl: data.properties.action_link, reportUrl });
  }

  return NextResponse.json({ ok: true });
}
