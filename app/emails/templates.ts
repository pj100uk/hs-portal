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
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr>
          <td style="background:#c7d2fe;padding:24px 40px;">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="vertical-align:middle;">
                <img src="https://www.riskdox.co.uk/logo.png" alt="MBHS" height="52" style="display:block;height:52px;border:0;" />
              </td>
              <td style="vertical-align:middle;text-align:right;">
                <span style="display:block;color:#1e1b4b;font-size:20px;font-weight:800;letter-spacing:-0.5px;line-height:1.1;">RiskDox</span>
                <span style="display:block;color:#3730a3;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-top:3px;margin-right:-1.5px;">Health &amp; Safety Portal</span>
                <span style="display:block;color:#4338ca;font-size:9px;font-weight:400;letter-spacing:0.3px;margin-top:2px;margin-right:-0.3px;">by McCormack Benson Health &amp; Safety</span>
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
