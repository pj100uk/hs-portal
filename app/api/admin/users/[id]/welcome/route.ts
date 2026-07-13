import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendWelcomeEmail } from '../../../../../lib/email';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { advisorName, password, cc } = await request.json();

  if (!advisorName || !password || password.length < 8) {
    return NextResponse.json({ error: 'Advisor name and password (min 8 chars) are required' }, { status: 400 });
  }

  const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(params.id);
  if (userError || !user?.email) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Reset password and store in metadata so admin can recall it later
  const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(params.id, {
    password,
    user_metadata: { welcome_password: password },
  });
  if (pwError) return NextResponse.json({ error: pwError.message }, { status: 500 });

  const { data: profile } = await supabaseAdmin.from('profiles').select('full_name, role').eq('id', params.id).single();

  await sendWelcomeEmail({
    email: user.email,
    name: profile?.full_name ?? null,
    password,
    advisorName,
    role: profile?.role ?? 'client',
    cc: Array.isArray(cc) && cc.length ? cc : undefined,
  });

  return NextResponse.json({ ok: true });
}
