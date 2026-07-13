import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendSecurityAlertEmail } from '../../../lib/email';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const { uid, message } = await request.json();

  let userEmail = 'Unknown user';
  if (uid) {
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(uid);
    if (user?.email) userEmail = user.email;
  }

  const { data: admins } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('role', 'superadmin');

  const adminEmails: string[] = [];
  for (const admin of admins ?? []) {
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(admin.id);
    if (user?.email) adminEmails.push(user.email);
  }

  if (adminEmails.length) {
    await sendSecurityAlertEmail({ userEmail, message: message ?? '', adminEmails });
  }

  return NextResponse.json({ ok: true });
}
