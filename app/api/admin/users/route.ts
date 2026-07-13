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
    user_metadata: user.user_metadata ?? null,
    profile: profiles?.find(p => p.id === user.id) || null,
  }));

  return NextResponse.json(combined);
}

// POST — create a new user
export async function POST(request: NextRequest) {
  const { email, password, role, organisation_id, site_ids, full_name, phone, view_only } = await request.json();

  if (!email || !password || !role) {
    return NextResponse.json({ error: 'Email, password and role are required' }, { status: 400 });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: full_name ? { full_name } : undefined,
  });

  if (userError) return NextResponse.json({ error: userError.message }, { status: 400 });

  const profileUpdates: Record<string, unknown> = { role, organisation_id: organisation_id || null, full_name: full_name || null, phone: phone || null };
  if (role === 'client' && view_only !== undefined) profileUpdates.view_only = !!view_only;

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update(profileUpdates)
    .eq('id', userData.user.id);

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 });

  if (role === 'client' && site_ids && site_ids.length > 0) {
    const { error: assignError } = await supabaseAdmin.from('client_site_assignments').insert(
      site_ids.map((siteId: string) => ({ client_user_id: userData.user.id, site_id: siteId }))
    );
    if (assignError) return NextResponse.json({ error: `User created but site assignment failed: ${assignError.message}` }, { status: 400 });
  }

  return NextResponse.json({ user: userData.user });
}

// PATCH — update a user's profile (organisation_id, datto_base_path, full_name, phone) or set password
export async function PATCH(request: NextRequest) {
  const { userId, organisation_id, datto_base_path, view_only, receive_emails, newPassword, full_name, phone } = await request.json();
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

  // Admin password set — store in metadata so welcome modal can recall it
  if (newPassword) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
      user_metadata: { welcome_password: newPassword },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  }

  const updates: Record<string, unknown> = {};
  if (organisation_id !== undefined) updates.organisation_id = organisation_id ?? null;
  if (datto_base_path !== undefined) updates.datto_base_path = datto_base_path || null;
  if (view_only !== undefined) updates.view_only = view_only;
  if (receive_emails !== undefined) updates.receive_emails = receive_emails;
  if (full_name !== undefined) updates.full_name = full_name || null;
  if (phone !== undefined) updates.phone = phone || null;
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

// DELETE — delete a user (cleans up related records first)
export async function DELETE(request: NextRequest) {
  const { userId } = await request.json();
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

  // Null out nullable FK references (don't delete the rows, just unlink the user)
  await supabaseAdmin.from('sites').update({ advisor_id: null }).eq('advisor_id', userId);
  await supabaseAdmin.from('activity_log').update({ user_id: null }).eq('user_id', userId);

  // Delete rows that belong to this user
  await supabaseAdmin.from('client_site_assignments').delete().eq('client_user_id', userId);
  await supabaseAdmin.from('advisor_site_assignments').delete().eq('advisor_id', userId);
  await supabaseAdmin.from('advisor_organisations').delete().eq('advisor_id', userId);

  // Delete profile before auth user (FK may not cascade)
  await supabaseAdmin.from('profiles').delete().eq('id', userId);

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ success: true });
}