import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface ActivityEvent {
  userId: string | null;
  siteId: string | null;
  organisationId?: string | null;
  action: 'document_viewed' | 'file_uploaded' | 'evidence_uploaded' | 'login';
  resourceType?: string | null;
  resourceId?: string | null;
  resourceName?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logActivity(event: ActivityEvent): Promise<void> {
  const { error } = await supabase.from('activity_log').insert({
    user_id:         event.userId,
    site_id:         event.siteId,
    organisation_id: event.organisationId ?? null,
    action:          event.action,
    resource_type:   event.resourceType ?? null,
    resource_id:     event.resourceId ?? null,
    resource_name:   event.resourceName ?? null,
    metadata:        event.metadata ?? {},
  });
  if (error) console.error('[activity_log] write error:', error);
}
