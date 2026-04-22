import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Service role client — never exposed to the browser, server-side only
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — list all users with their profiles
export async function GET() {
  const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: profiles } = await supabaseAdmin.from('profiles').select('*');

  const combined = users.map(user => ({
    id: user.id,
    email: user.email,
    profile: profiles?.find(p => p.id === user.id) || null,
  }));

  return NextResponse.json(combined);
}

// POST — create a new user
export async function POST(request: NextRequest) {
  const { email, password, role, organisation_id, site_ids } = await request.json();

  if (!email || !password || !role) {
    return NextResponse.json({ error: 'Email, password and role are required' }, { status: 400 });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userError) return NextResponse.json({ error: userError.message }, { status: 400 });

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({ role, organisation_id: organisation_id || null })
    .eq('id', userData.user.id);

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 });

  if (role === 'client' && site_ids && site_ids.length > 0) {
    await supabaseAdmin.from('client_site_assignments').insert(
      site_ids.map((siteId: string) => ({ client_user_id: userData.user.id, site_id: siteId }))
    );
  }

  return NextResponse.json({ user: userData.user });
}

// PATCH — update a user's profile (organisation_id, datto_base_path) or set password
export async function PATCH(request: NextRequest) {
  const { userId, organisation_id, datto_base_path, view_only, newPassword } = await request.json();
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

  // Admin password set — no profile update needed
  if (newPassword) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  }

  const updates: Record<string, unknown> = {};
  if (organisation_id !== undefined) updates.organisation_id = organisation_id ?? null;
  if (datto_base_path !== undefined) updates.datto_base_path = datto_base_path || null;
  if (view_only !== undefined) updates.view_only = view_only;
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // If assigning to an org, clear any site-level assignments — org access takes over
  if (organisation_id) {
    await supabaseAdmin.from('client_site_assignments').delete().eq('client_user_id', userId);
  }

  return NextResponse.json({ success: true });
}

// DELETE — delete a user
export async function DELETE(request: NextRequest) {
  const { userId } = await request.json();
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ success: true });
}