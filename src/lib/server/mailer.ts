import "server-only";
import nodemailer from "nodemailer";

/*
 * HCM Master Suite's own mailer (Nodemailer over SMTP), so every email comes from your domain.
 *
 * Resend (recommended): set RESEND_API_KEY and MAIL_FROM="HCM Master Suite <no-reply@yourdomain.com>"
 *   (the domain must be verified in Resend). This uses smtp.resend.com:465 with user "resend".
 * Any other SMTP: SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER, SMTP_PASS, MAIL_FROM.
 */
function config() {
  const host = process.env.SMTP_HOST || (process.env.RESEND_API_KEY ? "smtp.resend.com" : "");
  const user = process.env.SMTP_USER || (process.env.RESEND_API_KEY ? "resend" : "");
  const pass = process.env.SMTP_PASS || process.env.RESEND_API_KEY || "";
  const port = Number(process.env.SMTP_PORT || 465);
  return { host, user, pass, port };
}
export const mailReady = () => { const c = config(); return Boolean(c.host && c.user && c.pass); };

let tx: ReturnType<typeof nodemailer.createTransport> | null = null;
function transport() {
  if (tx) return tx;
  const c = config();
  tx = nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return tx;
}
const from = () => process.env.MAIL_FROM || `HCM Master Suite <${config().user}>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const shell = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><title>${title}</title></head>
<body style="margin:0;background:#EEF4FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF4FA;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border-radius:22px;padding:30px 28px;box-shadow:0 12px 40px -18px rgba(2,132,199,.35)">
<tr><td style="padding-bottom:22px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#38bdf8,#0284c7);background-color:#0284c7;color:#fff;font-weight:800;font-size:16px;text-align:center;line-height:34px">H</td>
<td style="padding-left:10px;font-weight:700;font-size:17px">HCM <span style="color:#0284c7">Master Suite</span></td></tr></table></td></tr>
${body}
</table>
<p style="font-size:12px;color:#64748B;margin:18px 0 0">HCM Master Suite · People, attendance, payroll and AI in one place</p>
</td></tr></table></body></html>`;

const COPY = {
  signup: { subject: "is your HCM Master Suite sign-up code", title: "Confirm your email", text: "Use this code to finish creating your account and register your company." },
  signin: { subject: "is your HCM Master Suite sign-in code", title: "Your sign-in code", text: "Type this code on the sign-in screen, on any device." },
  reset: { subject: "is your HCM Master Suite password reset code", title: "Reset your password", text: "Use this code to set a new password for your account." },
} as const;
export type CodePurpose = keyof typeof COPY;

/** 6-digit code email. The code is in the subject too, so a phone notification shows it without opening the email. */
export async function sendCodeEmail(to: string, code: string, purpose: CodePurpose) {
  const c = COPY[purpose];
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const html = shell(c.title, `
<tr><td style="font-size:23px;font-weight:700;line-height:1.25;padding-bottom:8px">${c.title}</td></tr>
<tr><td style="font-size:15px;line-height:1.55;color:#334155;padding-bottom:20px">${c.text}</td></tr>
<tr><td align="center" style="padding:4px 0 20px"><div style="display:inline-block;background:#E0F2FE;border-radius:16px;padding:16px 26px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:7px;color:#075985">${spaced}</div></td></tr>
<tr><td style="font-size:13.5px;line-height:1.55;color:#64748B">The code works once and expires in 10 minutes. If you didn’t ask for it, you can ignore this email — nobody can use your account without it.</td></tr>`);
  const text = `${c.title}: ${code}\n\n${c.text}\nIt works once and expires in 10 minutes. If you didn't ask for it, ignore this email.`;
  await transport().sendMail({ from: from(), to, subject: `${code} ${c.subject}`, text, html, headers: { "X-Entity-Ref-ID": `${Date.now()}` } });
}

/** Invitation to a company: a button that opens "Set your password". */
export async function sendInviteEmail(to: string, o: { inviter: string; company: string; role: string; url: string; existing?: boolean }) {
  const title = o.existing ? `You were added to ${o.company}` : `${o.inviter} invited you to ${o.company}`;
  const html = shell(title, `
<tr><td style="font-size:23px;font-weight:700;line-height:1.25;padding-bottom:8px">${esc(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.55;color:#334155;padding-bottom:22px">You have access to <b>${esc(o.company)}</b> on HCM Master Suite as <b>${esc(o.role)}</b>. ${o.existing ? "Sign in with your existing account to open it." : "Set your password to get started: attendance, leave, payslips and more in one place."}</td></tr>
<tr><td style="padding-bottom:22px"><a href="${esc(o.url)}" style="display:inline-block;background:#0284c7;color:#fff;text-decoration:none;font-weight:600;border-radius:999px;padding:13px 24px">${o.existing ? "Sign in" : "Accept invitation"}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.55;color:#64748B">Button not working? Paste this link in your browser:<br><span style="word-break:break-all;color:#0284c7">${esc(o.url)}</span></td></tr>`);
  const text = `${title}\n\nYou have access to ${o.company} as ${o.role}.\n${o.existing ? "Sign in" : "Accept the invitation"}: ${o.url}`;
  await transport().sendMail({ from: from(), to, subject: title, text, html });
}
