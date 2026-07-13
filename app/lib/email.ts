import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import {
  advisorGeneralUploadHtml,
  advisorEvidenceUploadHtml,
  clientUploadRejectionHtml,
  clientActionRejectionHtml,
  passwordResetHtml,
  passwordChangedHtml,
  securityAlertHtml,
  welcomeHtml,
  advisorWelcomeHtml,
  advisorActionSubmittedHtml,
  clientActionDueSoonHtml,
  clientActionOverdueHtml,
} from '../emails/templates';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
console.log('[email] RESEND_API_KEY present:', !!process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FROM = 'RiskDox <noreply@mb-hs.com>';
const PORTAL_URL = 'https://www.riskdox.co.uk';

async function sendEmail(to: string, subject: string, text: string, html: string, cc?: string[]): Promise<void> {
  if (!resend) { console.warn('[email] RESEND_API_KEY not set — skipping email'); return; }
  try {
    await resend.emails.send({ from: FROM, to, subject, text, html, ...(cc?.length ? { cc } : {}) });
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

export async function sendPasswordChangedEmail(params: {
  email: string; reportUrl: string;
}): Promise<void> {
  const text = [
    'The password for your RiskDox account was just updated.',
    'If this was you, no further action is needed.',
    `If you did not make this change, report it to us immediately: ${params.reportUrl}`,
  ].join('\n');
  await sendEmail(params.email, 'Your RiskDox password has been changed', text, passwordChangedHtml({ reportUrl: params.reportUrl }));
}

export async function sendSecurityAlertEmail(params: {
  userEmail: string; message: string; adminEmails: string[];
}): Promise<void> {
  const text = [
    'SECURITY ALERT: A portal user has reported unauthorised access.',
    `User: ${params.userEmail}`,
    `Message: ${params.message || '(none)'}`,
  ].join('\n');
  const html = securityAlertHtml({ userEmail: params.userEmail, message: params.message });
  for (const email of params.adminEmails) {
    await sendEmail(email, `Security alert — unauthorised access reported by ${params.userEmail}`, text, html);
  }
}

export async function sendPasswordResetEmail(params: {
  email: string; resetUrl: string; reportUrl: string;
}): Promise<void> {
  const text = [
    'We received a request to reset your RiskDox password.',
    `Reset your password here: ${params.resetUrl}`,
    'This link expires in 1 hour.',
    "If you didn't request this, you can safely ignore this email — your password won't change.",
    `If you're concerned someone is trying to access your account, report it here: ${params.reportUrl}`,
  ].join('\n');
  await sendEmail(params.email, 'Reset your RiskDox password', text, passwordResetHtml({ resetUrl: params.resetUrl, reportUrl: params.reportUrl }));
}

export async function sendWelcomeEmail(params: {
  email: string; name: string | null; password: string; advisorName: string; role: string; cc?: string[];
}): Promise<void> {
  const isAdvisor = params.role === 'advisor' || params.role === 'superadmin';
  const subject = isAdvisor
    ? 'Welcome to RiskDox — Advisor Access'
    : 'You now have access to your Health & Safety Portal';
  const html = isAdvisor ? advisorWelcomeHtml(params) : welcomeHtml(params);
  const text = [
    `Hello${params.name ? ` ${params.name}` : ''},`,
    isAdvisor
      ? `Your RiskDox advisor account has been set up by ${params.advisorName}.`
      : `You now have access to your RiskDox Health & Safety Portal, set up on behalf of ${params.advisorName} from McCormack Benson Health & Safety.`,
    `Email: ${params.email}`,
    `Password: ${params.password}`,
    `Sign in at: ${PORTAL_URL}`,
  ].join('\n');
  await sendEmail(params.email, subject, text, html, params.cc);
}

export async function notifyAdvisorOfActionSubmitted(params: {
  siteId: string; actionTitle: string; hazardRef?: string | null; sourceDocumentName?: string | null;
}): Promise<void> {
  const [advisorEmails, siteName, orgName] = await Promise.all([
    lookupAdvisorEmails(params.siteId),
    lookupSiteName(params.siteId),
    lookupOrgName(params.siteId),
  ]);
  if (!advisorEmails.length) return;

  const ref = params.hazardRef ? `Ref ${params.hazardRef}` : null;
  const text = [
    'A client has submitted an action for your review.',
    `Action: ${params.actionTitle}`,
    ...(ref ? [`Ref: ${ref}`] : []),
    ...(params.sourceDocumentName ? [`Document: ${params.sourceDocumentName}`] : []),
    `Site: ${siteName}`,
    `Log in to review: ${PORTAL_URL}`,
  ].join('\n');

  const html = advisorActionSubmittedHtml({ siteName, orgName, actionTitle: params.actionTitle, hazardRef: params.hazardRef, sourceDocumentName: params.sourceDocumentName });
  const subjectRef = ref ? `${ref} — ` : '';
  for (const email of advisorEmails) {
    await sendEmail(email, `Action submitted for review — ${subjectRef}${siteName}`, text, html);
  }
}

export async function notifyClientOfActionDueSoon(params: {
  siteId: string; actionTitle: string; dueDate: string; daysUntilDue: number; hazardRef?: string | null;
}): Promise<void> {
  const { data: clients } = await supabase.from('profiles').select('id').eq('role', 'client').eq('site_id', params.siteId);
  const ids = clients?.map(c => c.id) ?? [];
  if (!ids.length) return;
  for (const id of ids) {
    const email = await lookupClientEmail(id);
    if (email) await sendEmail(email, `Action due soon — ${params.dueDate}`, '', clientActionDueSoonHtml(params));
  }
}

export async function notifyClientOfActionOverdue(params: {
  siteId: string; actionTitle: string; dueDate: string; daysPastDue: number; hazardRef?: string | null;
}): Promise<void> {
  const { data: clients } = await supabase.from('profiles').select('id').eq('role', 'client').eq('site_id', params.siteId);
  const ids = clients?.map(c => c.id) ?? [];
  if (!ids.length) return;
  for (const id of ids) {
    const email = await lookupClientEmail(id);
    if (email) await sendEmail(email, `Action overdue — ${params.actionTitle}`, '', clientActionOverdueHtml(params));
  }
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
