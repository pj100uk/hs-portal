import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const ids = new URL(req.url).searchParams.get('ids');
  if (!ids) return NextResponse.json({});

  const idList = ids.split(',').filter(Boolean);
  if (idList.length === 0) return NextResponse.json({});

  const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', idList);
  const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p.full_name]));

  const nameMap: Record<string, string> = {};
  for (const id of idList) {
    if (profileMap[id]) { nameMap[id] = profileMap[id]; continue; }
    try {
      const { data: { user } } = await supabase.auth.admin.getUserById(id);
      if (user) {
        const meta = user.user_metadata ?? {};
        nameMap[id] = meta.full_name || meta.name || user.email || id;
      }
    } catch { /* skip — unknown user */ }
  }

  return NextResponse.json(nameMap);
}
