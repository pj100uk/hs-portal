import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — returns id + email for all advisor users (safe to call from any authenticated context)
export async function GET() {
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'advisor');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const emailMap = Object.fromEntries(users.map(u => [u.id, u.email ?? '']));

  const advisors = (profiles ?? []).map((p: { id: string; full_name: string | null }) => ({
    id: p.id,
    email: emailMap[p.id] ?? '',
    full_name: p.full_name,
  }));

  return NextResponse.json(advisors);
}
