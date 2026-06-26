import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import {
  advisorGeneralUploadHtml,
  advisorEvidenceUploadHtml,
  clientUploadRejectionHtml,
  clientActionRejectionHtml,
} from '../emails/templates';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
console.log('[email] RESEND_API_KEY present:', !!process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FROM = 'RiskDox <noreply@mb-hs.com>';
const PORTAL_URL = 'https://www.riskdox.co.uk';

async function sendEmail(to: string, subject: string, text: string, html: string): Promise<void> {
  if (!resend) { console.warn('[email] RESEND_API_KEY not set — skipping email'); return; }
  try {
    await resend.emails.send({ from: FROM, to, subject, text, html });
  } catch (err: any) {
    console.error('[email] send failed:', err.message);
  }
}

async function lookupAdvisorEmails(siteId: string): Promise<string[]> {
  const { data: site } = await supabase.from('sites').select('advisor_id, organisation_id').eq('id', siteId).single();
  const advisorIds = new Set<string>();

  if (site?.advisor_id) advisorIds.add(site.advisor_id);

  const { data: siteAssignments } = await supabase
    .from('advisor_site_assignments').select('advisor_id').eq('site_id', siteId);
  siteAssignments?.forEach(a => advisorIds.add(a.advisor_id));

  if (site?.organisation_id) {
    const { data: orgAdvisors } = await supabase
      .from('advisor_organisations').select('advisor_id').eq('organisation_id', site.organisation_id);
    orgAdvisors?.forEach(a => advisorIds.add(a.advisor_id));
  }

  const { data: profiles } = await supabase
    .from('profiles').select('id, receive_emails').in('id', [...advisorIds]);

  const emails: string[] = [];
  for (const id of advisorIds) {
    const profile = profiles?.find(p => p.id === id);
    if (profile?.receive_emails === false) continue;
    const { data: { user } } = await supabase.auth.admin.getUserById(id);
    if (user?.email) emails.push(user.email);
  }
  return emails;
}

async function lookupClientEmail(userId: string): Promise<string | null> {
  const { data: profile } = await supabase.from('profiles').select('receive_emails').eq('id', userId).single();
  if (profile?.receive_emails === false) return null;
  const { data: { user } } = await supabase.auth.admin.getUserById(userId);
  return user?.email ?? null;
}

async function lookupSiteName(siteId: string): Promise<string> {
  const { data } = await supabase.from('sites').select('name').eq('id', siteId).single();
  return data?.name ?? 'your site';
}

async function lookupOrgName(siteId: string): Promise<string | null> {
  const { data } = await supabase.from('sites').select('organisations(name)').eq('id', siteId).single();
  return (data?.organisations as any)?.name ?? null;
}

// ─── Exported notification functions (fire-and-forget) ───────────────────────

export async function notifyAdvisorOfGeneralUpload(params: {
  siteId: string; uploadedBy: string | null; fileName: string; notes: string | null;
}): Promise<void> {
  const [advisorEmails, siteName, orgName] = await Promise.all([
    lookupAdvisorEmails(params.siteId),
    lookupSiteName(params.siteId),
    lookupOrgName(params.siteId),
  ]);
  if (!advisorEmails.length) return;

  let uploaderName = 'A client';
  if (params.uploadedBy) {
    const { data: { user } } = await supabase.auth.admin.getUserById(params.uploadedBy);
    uploaderName = user?.user_metadata?.full_name ?? user?.email ?? 'A client';
  }

  const text = [
    `${uploaderName} has uploaded a new file for your review.`,
    `File: ${params.fileName}`,
    ...(params.notes ? [`Note: ${params.notes}`] : []),
    `Site: ${siteName}`,
    `Log in to review: ${PORTAL_URL}`,
  ].join('\n');

  const html = advisorGeneralUploadHtml({ uploaderName, orgName, fileName: params.fileName, siteName, notes: params.notes });
  for (const email of advisorEmails) {
    await sendEmail(email, `New file uploaded for review — ${siteName}`, text, html);
  }
}

export async function notifyAdvisorOfEvidenceUpload(params: {
  siteId: string; uploadedBy: string | null; fileName: string;
  hazardRef: string | null; sourceDocumentName: string | null;
}): Promise<void> {
  const [advisorEmails, siteName, orgName] = await Promise.all([
    lookupAdvisorEmails(params.siteId),
    lookupSiteName(params.siteId),
    lookupOrgName(params.siteId),
  ]);
  if (!advisorEmails.length) return;

  const ref = params.hazardRef ? `Ref ${params.hazardRef}` : null;
  const text = [
    `A client has uploaded evidence for an action.`,
    `File: ${params.fileName}`,
    ...(ref ? [`Action ref: ${ref}`] : []),
    ...(params.sourceDocumentName ? [`Document: ${params.sourceDocumentName}`] : []),
    `Site: ${siteName}`,
    `Log in to review: ${PORTAL_URL}`,
  ].join('\n');

  const html = advisorEvidenceUploadHtml({
    siteName, orgName, fileName: params.fileName,
    hazardRef: params.hazardRef, sourceDocumentName: params.sourceDocumentName,
  });
  const subjectRef = ref ? `${ref} — ` : '';
  for (const email of advisorEmails) {
    await sendEmail(email, `New evidence uploaded — ${subjectRef}${siteName}`, text, html);
  }
}

export function notifyClientOfUploadRejection(params: {
  uploadedBy: string; fileName: string; reviewNote: string | null;
}): void {
  void (async () => {
    const clientEmail = await lookupClientEmail(params.uploadedBy);
    if (!clientEmail) return;

    const text = [
      `Your uploaded file "${params.fileName}" has been returned by your advisor.`,
      ...(params.reviewNote ? [`Advisor note: ${params.reviewNote}`] : []),
      `Please log in to the portal to review the feedback and re-upload if needed.`,
      PORTAL_URL,
    ].join('\n');

    const html = clientUploadRejectionHtml({ fileName: params.fileName, reviewNote: params.reviewNote });
    await sendEmail(clientEmail, `Your uploaded file has been returned — ${params.fileName}`, text, html);
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
  const text = [
    `Your action has been reviewed and sent back for revision.`,
    `Action: ${params.actionTitle}`,
    ...(params.reviewNote ? [`Advisor note: ${params.reviewNote}`] : []),
    `Please log in to the portal to view the feedback.`,
    PORTAL_URL,
  ].join('\n');

  const html = clientActionRejectionHtml({ actionTitle: params.actionTitle, reviewNote: params.reviewNote });
  await sendEmail(to, `An action has been returned for revision`, text, html);
}
