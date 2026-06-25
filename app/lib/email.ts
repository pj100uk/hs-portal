import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FROM = 'noreply@mb-hs.com';
const PORTAL_URL = 'https://www.riskdox.co.uk';

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!resend) { console.warn('[email] RESEND_API_KEY not set — skipping email'); return; }
  try {
    await resend.emails.send({ from: FROM, to, subject, text });
  } catch (err: any) {
    console.error('[email] send failed:', err.message);
  }
}

async function lookupAdvisorEmail(siteId: string): Promise<string | null> {
  const { data: site } = await supabase.from('sites').select('advisor_id, organisation_id').eq('id', siteId).single();
  let advisorId: string | null = site?.advisor_id ?? null;

  if (!advisorId) {
    const { data: assignment } = await supabase
      .from('advisor_site_assignments').select('advisor_id').eq('site_id', siteId).limit(1).single();
    advisorId = assignment?.advisor_id ?? null;
  }

  if (!advisorId && site?.organisation_id) {
    const { data: orgAdvisor } = await supabase
      .from('advisor_organisations').select('advisor_id').eq('organisation_id', site.organisation_id).limit(1).single();
    advisorId = orgAdvisor?.advisor_id ?? null;
  }

  if (!advisorId) return null;
  const { data: { user } } = await supabase.auth.admin.getUserById(advisorId);
  return user?.email ?? null;
}

async function lookupClientEmail(userId: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.admin.getUserById(userId);
  return user?.email ?? null;
}

async function lookupSiteName(siteId: string): Promise<string> {
  const { data } = await supabase.from('sites').select('name').eq('id', siteId).single();
  return data?.name ?? 'your site';
}

// ─── Exported notification functions (fire-and-forget) ───────────────────────

export function notifyAdvisorOfGeneralUpload(params: {
  siteId: string; uploadedBy: string | null; fileName: string; notes: string | null;
}): void {
  void (async () => {
    const [advisorEmail, siteName] = await Promise.all([
      lookupAdvisorEmail(params.siteId),
      lookupSiteName(params.siteId),
    ]);
    if (!advisorEmail) return;

    let uploaderName = 'A client';
    if (params.uploadedBy) {
      const { data: { user } } = await supabase.auth.admin.getUserById(params.uploadedBy);
      uploaderName = user?.user_metadata?.full_name ?? user?.email ?? 'A client';
    }

    const lines = [
      `${uploaderName} has uploaded a new file for your review.`,
      '',
      `File: ${params.fileName}`,
      ...(params.notes ? [`Note: ${params.notes}`] : []),
      `Site: ${siteName}`,
      '',
      `Log in to review: ${PORTAL_URL}`,
    ];
    await sendEmail(advisorEmail, `New file uploaded for review — ${siteName}`, lines.join('\n'));
  })();
}

export function notifyAdvisorOfEvidenceUpload(params: {
  siteId: string; uploadedBy: string | null; fileName: string;
  hazardRef: string | null; sourceDocumentName: string | null;
}): void {
  void (async () => {
    const [advisorEmail, siteName] = await Promise.all([
      lookupAdvisorEmail(params.siteId),
      lookupSiteName(params.siteId),
    ]);
    if (!advisorEmail) return;

    const ref = params.hazardRef ? `Ref ${params.hazardRef}` : null;
    const lines = [
      `A client has uploaded evidence for an action.`,
      '',
      `File: ${params.fileName}`,
      ...(ref ? [`Action ref: ${ref}`] : []),
      ...(params.sourceDocumentName ? [`Document: ${params.sourceDocumentName}`] : []),
      `Site: ${siteName}`,
      '',
      `Log in to review: ${PORTAL_URL}`,
    ];
    const subjectRef = ref ? `${ref} — ` : '';
    await sendEmail(advisorEmail, `New evidence uploaded — ${subjectRef}${siteName}`, lines.join('\n'));
  })();
}

export function notifyClientOfUploadRejection(params: {
  uploadedBy: string; fileName: string; reviewNote: string | null;
}): void {
  void (async () => {
    const clientEmail = await lookupClientEmail(params.uploadedBy);
    if (!clientEmail) return;

    const lines = [
      `Your uploaded file "${params.fileName}" has been returned by your advisor.`,
      '',
      ...(params.reviewNote ? [`Advisor note: ${params.reviewNote}`, ''] : []),
      `Please log in to the portal to review the feedback and re-upload if needed.`,
      '',
      PORTAL_URL,
    ];
    await sendEmail(clientEmail, `Your uploaded file has been returned — ${params.fileName}`, lines.join('\n'));
  })();
}

export function notifyClientOfActionRejection(params: {
  siteId: string; actionTitle: string; reviewNote: string | null;
}): void {
  void (async () => {
    const { data: clients } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'client')
      .eq('site_id', params.siteId);

    if (!clients?.length) {
      // Also check client_site_assignments
      const { data: assignments } = await supabase
        .from('client_site_assignments')
        .select('client_user_id')
        .eq('site_id', params.siteId);
      if (!assignments?.length) return;
      for (const a of assignments) {
        const email = await lookupClientEmail(a.client_user_id);
        if (email) await sendRejectionEmail(email, params);
      }
      return;
    }

    for (const client of clients) {
      const email = await lookupClientEmail(client.id);
      if (email) await sendRejectionEmail(email, params);
    }
  })();
}

async function sendRejectionEmail(
  to: string,
  params: { actionTitle: string; reviewNote: string | null },
): Promise<void> {
  const lines = [
    `Your action has been reviewed and sent back for revision.`,
    '',
    `Action: ${params.actionTitle}`,
    ...(params.reviewNote ? [`Advisor note: ${params.reviewNote}`, ''] : []),
    `Please log in to the portal to view the feedback.`,
    '',
    PORTAL_URL,
  ];
  await sendEmail(to, `An action has been returned for revision`, lines.join('\n'));
}
