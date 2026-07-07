import { sendEmail, type MailTransporter, type SmtpConfig } from "./nodemailer.ts";

type RegistrationOtpEmail = {
  email: string;
  otp: string;
  expiresInMinutes: number;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendRegistrationOtpEmail(
  message: RegistrationOtpEmail,
  transporter?: MailTransporter,
  config?: SmtpConfig,
) {
  const safeOtp = escapeHtml(message.otp);
  const safeMinutes = escapeHtml(String(message.expiresInMinutes));
  const safeEmail = escapeHtml(message.email);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark light">
    <meta name="supported-color-schemes" content="dark light">
    <title>Your Marekto verification code</title>
    <style>
      :root { color-scheme: dark light; supported-color-schemes: dark light; }
      @media (prefers-color-scheme: dark) {
        .email-page { background-color: #09090b !important; }
        .email-card { background-color: #18181b !important; }
        .email-header { background-color: #312e81 !important; }
        .email-code { background-color: #0f1022 !important; }
        .email-notice, .email-footer { background-color: #111113 !important; }
        .email-title, .email-code-value, .email-strong { color: #ffffff !important; }
        .email-copy { color: #d4d4d8 !important; }
        .email-muted { color: #a1a1aa !important; }
      }
    </style>
  </head>
  <body class="email-page" style="margin:0;padding:0;background-color:#09090b;font-family:Inter,Segoe UI,Arial,sans-serif;color:#f4f4f5;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Your Marekto verification code is ${safeOtp}. It expires in ${safeMinutes} minutes.
    </div>
    <table class="email-page" role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#09090b" style="background-color:#09090b;margin:0;padding:32px 16px;">
      <tr>
        <td align="center">
          <table class="email-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#18181b" style="max-width:560px;border-collapse:separate;border-spacing:0;background-color:#18181b;border:1px solid #27272a;border-radius:18px;overflow:hidden;">
            <tr>
              <td class="email-header" bgcolor="#312e81" style="padding:28px 28px 18px;background-color:#312e81;">
                <div style="display:inline-block;padding:7px 10px;border:1px solid #818cf8;border-radius:999px;background-color:#3730a3;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#e0e7ff;font-weight:700;">
                  Marekto secure signup
                </div>
                <h1 class="email-title" style="margin:18px 0 0;font-size:28px;line-height:1.2;color:#ffffff;font-weight:800;letter-spacing:0;">
                  Verify your email
                </h1>
                <p class="email-copy" style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#e4e4e7;">
                  Use this one-time code to finish creating your workspace.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p class="email-muted" style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#a1a1aa;">
                  We received a signup request for <span class="email-strong" style="color:#ffffff;font-weight:700;">${safeEmail}</span>.
                </p>
                <div class="email-code" style="margin:22px 0;padding:22px;border:1px solid #6366f1;border-radius:16px;background-color:#0f1022;text-align:center;">
                  <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#a5b4fc;font-weight:800;">
                    Verification code
                  </div>
                  <div class="email-code-value" style="margin-top:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:38px;line-height:1.1;letter-spacing:0.18em;color:#ffffff;font-weight:900;">
                    ${safeOtp}
                  </div>
                </div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;margin:0 0 22px;">
                  <tr>
                    <td class="email-notice" bgcolor="#111113" style="padding:14px 16px;border:1px solid #3f3f46;border-radius:14px;background-color:#111113;">
                      <p class="email-copy" style="margin:0;font-size:14px;line-height:1.6;color:#d4d4d8;">
                        This code expires in <strong class="email-strong" style="color:#ffffff;">${safeMinutes} minutes</strong>. For your security, do not share it with anyone.
                      </p>
                    </td>
                  </tr>
                </table>
                <p class="email-muted" style="margin:0;font-size:13px;line-height:1.6;color:#a1a1aa;">
                  If you did not request this email, you can safely ignore it. No Marekto account will be created without this code.
                </p>
              </td>
            </tr>
            <tr>
              <td class="email-footer" bgcolor="#111113" style="padding:18px 28px;border-top:1px solid #27272a;background-color:#111113;">
                <p class="email-muted" style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
                  Marekto authentication email - sent automatically from your local workspace.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return sendEmail(
    {
      to: message.email,
      subject: "Your Marekto verification code",
      html,
      text:
        `Your Marekto verification code is ${message.otp}. ` +
        `It expires in ${message.expiresInMinutes} minutes.`,
    },
    transporter,
    config,
  );
}
