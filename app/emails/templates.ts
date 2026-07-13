const INDIGO = '#4F46E5';
const INDIGO_DARK = '#4338CA';
const PORTAL_URL = 'https://www.riskdox.co.uk';

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>RiskDox</title>
</head>
<body style="margin:0;padding:0;background:#eef2ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ff;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border-top:4px solid #4F46E5;border-left:1px solid #c7d2fe;border-right:1px solid #c7d2fe;border-bottom:1px solid #c7d2fe;">
        <!-- Header -->
        <tr>
          <td style="background:#ffffff;border-bottom:1px solid #e5e7eb;padding:24px 40px;">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="vertical-align:middle;">
                <img src="https://www.riskdox.co.uk/logo.png" alt="MBHS" height="44" style="display:block;height:44px;border:0;" />
              </td>
              <td style="vertical-align:middle;text-align:right;">
                <span style="display:block;color:#0f172a;font-size:20px;font-weight:800;letter-spacing:-0.5px;line-height:1.1;">RiskDox</span>
                <span style="display:block;color:#4F46E5;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-top:3px;">Health &amp; Safety Portal</span>
                <span style="display:block;color:#64748b;font-size:9px;font-weight:400;letter-spacing:0.3px;margin-top:2px;">by McCormack Benson Health &amp; Safety</span>
              </td>
            </tr></table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            ${content}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;">
            <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
              This is an automated notification from RiskDox. Please do not reply to this email.<br />
              Provided by <a href="https://www.mb-hs.com" style="color:#6b7280;text-decoration:underline;">McCormack Benson Health &amp; Safety</a><br />
              &copy; ${new Date().getFullYear()} MBHS. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function ctaButton(label: string, url: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
    <tr>
      <td style="background:${INDIGO};border-radius:6px;">
        <a href="${url}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111827;line-height:1.3;">${text}</h1>`;
}

function para(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">${text}</p>`;
}

function metaRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 12px;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;">${label}</td>
    <td style="padding:8px 12px;font-size:13px;color:#111827;font-weight:500;vertical-align:top;">${value}</td>
  </tr>`;
}

function metaTable(rows: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:20px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;width:100%;">
    ${rows}
  </table>`;
}

// ─── Templates ───────────────────────────────────────────────────────────────

export function passwordChangedHtml(params: { reportUrl: string }): string {
  return layout(`
    ${heading('Your password has been changed')}
    ${para('The password for your RiskDox account was just updated.')}
    ${para('If this was you, no further action is needed.')}
    ${para('If you did not make this change, please report it to us immediately using the button below.')}
    ${ctaButton('Report Unauthorised Access', params.reportUrl)}
    ${para(`<span style="font-size:13px;color:#6b7280;">Our team will investigate and secure your account as quickly as possible.</span>`)}
  `);
}

export function securityAlertHtml(params: { userEmail: string; message: string }): string {
  return layout(`
    ${heading('Security alert — unauthorised access reported')}
    ${para('A portal user has reported that their password was changed without their knowledge.')}
    ${metaTable([
      metaRow('User', params.userEmail),
      metaRow('Message', params.message || '(no message provided)'),
    ].join(''))}
    ${ctaButton('View in Portal', PORTAL_URL)}
  `);
}

export function passwordResetHtml(params: { resetUrl: string; reportUrl: string }): string {
  return layout(`
    ${heading('Reset your password')}
    ${para('We received a request to reset the password for your RiskDox account. Click the button below to choose a new password.')}
    ${ctaButton('Reset Password', params.resetUrl)}
    ${para(`<span style="font-size:13px;color:#6b7280;">This link expires in 1 hour. If you didn't request this reset, you can safely ignore this email — your password won't change.</span>`)}
    ${para(`<span style="font-size:13px;color:#6b7280;">If you're concerned someone is trying to access your account without your knowledge, <a href="${params.reportUrl}" style="color:#dc2626;text-decoration:underline;">report it to us immediately</a>.</span>`)}
  `);
}

export function welcomeHtml(params: {
  name: string | null; email: string; password: string; advisorName: string;
}): string {
  const greeting = params.name ? `Hello ${params.name},` : 'Hello,';

  return layout(`
    ${heading('You now have access to your Health &amp; Safety Portal')}
    ${para(`${greeting}`)}
    ${para(`I'm contacting you on behalf of <strong>${params.advisorName}</strong> from McCormack Benson Health &amp; Safety to let you know that you now have online access to your health and safety documents through <strong>RiskDox</strong>, our client portal.`)}
    ${para('Your portal can be accessed at any time at:')}
    ${metaTable([
      metaRow('Portal', `<a href="${PORTAL_URL}" style="color:#4F46E5;text-decoration:none;">${PORTAL_URL}</a>`),
      metaRow('Email', params.email),
      metaRow('Password', params.password),
    ].join(''))}
    ${para('We recommend bookmarking the address for easy access in future.')}
    ${ctaButton('Sign in to RiskDox', PORTAL_URL)}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
    ${para('With your current access you can view and download your health and safety documents at any time, from any device, without needing to contact us directly. You can also upload and store your own health and safety documents — such as internally produced risk assessments, policies, or certificates — giving you a single secure location for all your H&amp;S paperwork.')}
    <table cellpadding="0" cellspacing="0" style="margin:20px 0;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;width:100%;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#4F46E5;">Want to get more from your portal?</p>
        <p style="margin:0 0 10px;font-size:13px;color:#374151;line-height:1.6;">Full portal access gives you a real-time view of your health and safety compliance, including:</p>
        <ul style="margin:0 0 10px;padding-left:20px;font-size:13px;color:#374151;line-height:1.8;">
          <li>A live compliance dashboard with scores across documentation, industry alignment, and action progress</li>
          <li>A complete action plan with outstanding items, due dates, and responsible persons</li>
          <li>The ability to upload evidence of completed actions and track sign-off with your advisor</li>
          <li>A full activity log across your account</li>
        </ul>
        <p style="margin:0;font-size:13px;color:#374151;line-height:1.6;">If you'd like to discuss upgrading your access or would like to know more about what's included, please feel free to get in touch.</p>
      </td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:14px;color:#374151;line-height:1.6;">Kind regards,<br /><strong>${params.advisorName}</strong><br />McCormack Benson Health &amp; Safety<br /><a href="https://www.mb-hs.com" style="color:#4F46E5;text-decoration:none;">www.mb-hs.com</a> &nbsp;|&nbsp; 01375 398 998</p>
  `);
}

export function advisorWelcomeHtml(params: {
  name: string | null; email: string; password: string; advisorName: string;
}): string {
  const greeting = params.name ? `Hello ${params.name},` : 'Hello,';

  return layout(`
    ${heading('Welcome to RiskDox — Advisor Access')}
    ${para(`${greeting}`)}
    ${para(`Your RiskDox advisor account has been set up by <strong>${params.advisorName}</strong>. You can now log in to the portal to manage your client sites, review documents, and track health &amp; safety actions.`)}
    ${para('Your login details:')}
    ${metaTable([
      metaRow('Portal', `<a href="${PORTAL_URL}" style="color:#4F46E5;text-decoration:none;">${PORTAL_URL}</a>`),
      metaRow('Email', params.email),
      metaRow('Password', params.password),
    ].join(''))}
    ${para('We recommend changing your password after your first login.')}
    ${ctaButton('Sign in to RiskDox', PORTAL_URL)}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
    ${para('As an advisor you have access to:')}
    <ul style="margin:0 0 12px;padding-left:20px;font-size:14px;color:#374151;line-height:1.8;">
      <li>A full dashboard across all your assigned client sites</li>
      <li>Document management and AI-powered action extraction</li>
      <li>Compliance, industry alignment, and action progress scoring</li>
      <li>Evidence review and sign-off workflows</li>
      <li>Activity logs and client upload management</li>
    </ul>
    <p style="margin:24px 0 0;font-size:14px;color:#374151;line-height:1.6;">Kind regards,<br /><strong>${params.advisorName}</strong><br />McCormack Benson Health &amp; Safety<br /><a href="https://www.mb-hs.com" style="color:#4F46E5;text-decoration:none;">www.mb-hs.com</a> &nbsp;|&nbsp; 01375 398 998</p>
  `);
}

export function advisorActionSubmittedHtml(params: {
  siteName: string; orgName?: string | null; actionTitle: string;
  hazardRef?: string | null; sourceDocumentName?: string | null;
}): string {
  const orgDisplay = params.orgName ? ` from <em>${params.orgName}</em>` : '';
  const ref = params.hazardRef ? `Ref ${params.hazardRef}` : null;
  const rows = [
    metaRow('Action', params.actionTitle),
    ...(ref ? [metaRow('Ref', ref)] : []),
    ...(params.sourceDocumentName ? [metaRow('Document', params.sourceDocumentName)] : []),
    metaRow('Site', params.siteName),
  ].join('');

  return layout(`
    ${heading('Action submitted for review')}
    ${para(`A client${orgDisplay} has marked an action as complete and submitted it for your review.`)}
    ${metaTable(rows)}
    ${ctaButton('Review in Portal', PORTAL_URL)}
  `);
}

export function clientActionDueSoonHtml(params: {
  actionTitle: string; dueDate: string; daysUntilDue: number; hazardRef?: string | null;
}): string {
  const daysLabel = params.daysUntilDue === 1 ? 'tomorrow' : `in ${params.daysUntilDue} days`;
  const rows = [
    metaRow('Action', params.actionTitle),
    ...(params.hazardRef ? [metaRow('Ref', `Ref ${params.hazardRef}`)] : []),
    metaRow('Due date', params.dueDate),
  ].join('');

  return layout(`
    ${heading(`Action due ${daysLabel}`)}
    ${para(`A health &amp; safety action assigned to you is due ${daysLabel}. Please log in to the portal to review it and submit evidence of completion if ready.`)}
    ${metaTable(rows)}
    ${ctaButton('View in Portal', PORTAL_URL)}
  `);
}

export function clientActionOverdueHtml(params: {
  actionTitle: string; dueDate: string; daysPastDue: number; hazardRef?: string | null;
}): string {
  const daysLabel = params.daysPastDue === 1 ? '1 day' : `${params.daysPastDue} days`;
  const rows = [
    metaRow('Action', params.actionTitle),
    ...(params.hazardRef ? [metaRow('Ref', `Ref ${params.hazardRef}`)] : []),
    metaRow('Was due', params.dueDate),
    metaRow('Overdue by', daysLabel),
  ].join('');

  return layout(`
    ${heading('Action overdue')}
    ${para(`A health &amp; safety action assigned to you is now overdue by ${daysLabel}. Please log in to the portal to review it and take action.`)}
    ${metaTable(rows)}
    ${ctaButton('View in Portal', PORTAL_URL)}
  `);
}

export function advisorGeneralUploadHtml(params: {
  uploaderName: string; orgName?: string | null; fileName: string; siteName: string; notes?: string | null;
}): string {
  const uploaderDisplay = params.orgName
    ? `<strong>${params.uploaderName}</strong> (<em>${params.orgName}</em>)`
    : `<strong>${params.uploaderName}</strong>`;
  const rows = [
    metaRow('File', params.fileName),
    metaRow('Site', params.siteName),
    ...(params.notes ? [metaRow('Note', params.notes)] : []),
  ].join('');

  return layout(`
    ${heading('New file uploaded for review')}
    ${para(`${uploaderDisplay} has uploaded a file to the portal and it is waiting for your review.`)}
    ${metaTable(rows)}
    ${ctaButton('Review in Portal', PORTAL_URL)}
  `);
}

export function advisorEvidenceUploadHtml(params: {
  siteName: string; orgName?: string | null; fileName: string; hazardRef?: string | null; sourceDocumentName?: string | null;
}): string {
  const orgDisplay = params.orgName ? ` from <em>${params.orgName}</em>` : '';
  const rows = [
    metaRow('File', params.fileName),
    ...(params.hazardRef ? [metaRow('Action ref', `Ref ${params.hazardRef}`)] : []),
    ...(params.sourceDocumentName ? [metaRow('Document', params.sourceDocumentName)] : []),
    metaRow('Site', params.siteName),
  ].join('');

  return layout(`
    ${heading('New evidence uploaded for an action')}
    ${para(`A client${orgDisplay} has uploaded evidence against an action. Please log in to review it.`)}
    ${metaTable(rows)}
    ${ctaButton('Review in Portal', PORTAL_URL)}
  `);
}

export function clientUploadRejectionHtml(params: {
  fileName: string; reviewNote?: string | null;
}): string {
  return layout(`
    ${heading('Your file has been returned')}
    ${para(`Your uploaded file <strong>&ldquo;${params.fileName}&rdquo;</strong> has been reviewed by your advisor and returned for revision.`)}
    ${params.reviewNote ? metaTable(metaRow('Advisor note', params.reviewNote)) : ''}
    ${para('Please log in to view the feedback and re-upload if needed.')}
    ${ctaButton('View in Portal', PORTAL_URL)}
  `);
}

export function clientActionRejectionHtml(params: {
  actionTitle: string; reviewNote?: string | null;
}): string {
  return layout(`
    ${heading('An action has been returned for revision')}
    ${para('Your advisor has reviewed an action and sent it back with feedback.')}
    ${metaTable([
      metaRow('Action', params.actionTitle),
      ...(params.reviewNote ? [metaRow('Advisor note', params.reviewNote)] : []),
    ].join(''))}
    ${para('Please log in to view the feedback and update the action.')}
    ${ctaButton('View in Portal', PORTAL_URL)}
  `);
}
