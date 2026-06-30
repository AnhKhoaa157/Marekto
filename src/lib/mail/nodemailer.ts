import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

const REQUIRED_SMTP_ENV_VARS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
] as const;

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type CampaignEmailMessage = EmailMessage;

export type MailSendResult = {
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
};

export type MailTransporter = {
  sendMail(options: SendMailOptions): Promise<SMTPTransport.SentMessageInfo>;
};

type SmtpEnv = Readonly<NodeJS.ProcessEnv>;

function readRequiredEnv(env: SmtpEnv, name: (typeof REQUIRED_SMTP_ENV_VARS)[number]) {
  const value = env[name]?.trim();

  if (!value) {
    return null;
  }

  return value;
}

function parseSmtpSecure(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error("SMTP_SECURE must be true or false");
}

export function resolveSmtpConfig(env: SmtpEnv = process.env): SmtpConfig {
  const missing = REQUIRED_SMTP_ENV_VARS.filter(
    (name) => readRequiredEnv(env, name) === null,
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required SMTP environment variables: ${missing.join(", ")}`,
    );
  }

  const portValue = Number(env.SMTP_PORT);

  if (!Number.isInteger(portValue) || portValue <= 0 || portValue > 65535) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535");
  }

  return {
    host: readRequiredEnv(env, "SMTP_HOST") as string,
    port: portValue,
    secure: parseSmtpSecure(env.SMTP_SECURE),
    user: readRequiredEnv(env, "SMTP_USER") as string,
    password: readRequiredEnv(env, "SMTP_PASSWORD") as string,
    from: readRequiredEnv(env, "SMTP_FROM") as string,
  };
}

export function isSmtpConfigured(env: SmtpEnv = process.env): boolean {
  try {
    resolveSmtpConfig(env);
    return true;
  } catch {
    return false;
  }
}

export function createSmtpTransporter(config: SmtpConfig): MailTransporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
  });
}

export async function sendEmail(
  message: EmailMessage,
  transporter?: MailTransporter,
  config?: SmtpConfig,
): Promise<MailSendResult> {
  if (!message.to.trim()) {
    throw new Error("Recipient email is required");
  }

  if (!message.subject.trim()) {
    throw new Error("Email subject is required");
  }

  if (!message.html.trim() && !message.text?.trim()) {
    throw new Error("Email content is required");
  }

  const resolvedConfig = config ?? resolveSmtpConfig();
  const resolvedTransporter =
    transporter ?? createSmtpTransporter(resolvedConfig);

  const result = await resolvedTransporter.sendMail({
    from: resolvedConfig.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    messageId: result.messageId,
    accepted: result.accepted.map(String),
    rejected: result.rejected.map(String),
    response: result.response,
  };
}

export async function sendCampaignEmail(
  message: CampaignEmailMessage,
  transporter?: MailTransporter,
  config?: SmtpConfig,
): Promise<MailSendResult> {
  return sendEmail(message, transporter, config);
}

export function sanitizeMailError(
  error: unknown,
  env: SmtpEnv = process.env,
): string {
  const rawMessage =
    error instanceof Error ? error.message : "Email delivery failed";
  const secrets = [env.SMTP_PASSWORD, env.SMTP_USER].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  return secrets.reduce(
    (message, secret) => message.split(secret).join("***"),
    rawMessage,
  );
}
