import { sendEmail, type MailTransporter, type SmtpConfig } from "./nodemailer";

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
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>Your Marekto verification code</title>
  </head>
  <body style="margin:0;padding:0;background:#09090b;font-family:Inter,Segoe UI,Arial,sans-serif;color:#f4f4f5;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Your Marekto verification code is ${safeOtp}. It expires in ${safeMinutes} minutes.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#09090b;margin:0;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border-collapse:separate;border-spacing:0;background:#18181b;border:1px solid #27272a;border-radius:18px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.38);">
            <tr>
              <td style="padding:28px 28px 18px;background:linear-gradient(135deg,#18181b 0%,#1f1b3d 54%,#312e81 100%);">
                <div style="display:inline-block;padding:7px 10px;border:1px solid rgba(165,180,252,0.45);border-radius:999px;background:rgba(79,70,229,0.22);font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#c7d2fe;font-weight:700;">
                  Marekto secure signup
                </div>
                <h1 style="margin:18px 0 0;font-size:28px;line-height:1.2;color:#fafafa;font-weight:800;letter-spacing:-0.02em;">
                  Verify your email
                </h1>
                <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#d4d4d8;">
                  Use this one-time code to finish creating your workspace.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#a1a1aa;">
                  We received a signup request for <span style="color:#e4e4e7;font-weight:700;">${safeEmail}</span>.
                </p>
                <div style="margin:22px 0;padding:22px;border:1px solid rgba(99,102,241,0.5);border-radius:16px;background:#0f1022;text-align:center;">
                  <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#a5b4fc;font-weight:800;">
                    Verification code
                  </div>
                  <div style="margin-top:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:38px;line-height:1.1;letter-spacing:0.18em;color:#ffffff;font-weight:900;">
                    ${safeOtp}
                  </div>
                </div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;margin:0 0 22px;">
                  <tr>
                    <td style="padding:14px 16px;border:1px solid #3f3f46;border-radius:14px;background:#111113;">
                      <p style="margin:0;font-size:14px;line-height:1.6;color:#d4d4d8;">
                        This code expires in <strong style="color:#fafafa;">${safeMinutes} minutes</strong>. For your security, do not share it with anyone.
                      </p>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">
                  If you did not request this email, you can safely ignore it. No Marekto account will be created without this code.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #27272a;background:#111113;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#71717a;">
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
