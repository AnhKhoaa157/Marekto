export type WorkerLogLevel = "info" | "warn" | "error";

export type WorkerLogCategory =
  | "smtp_unconfigured"
  | "smtp_send_failed"
  | "ai_personalization_fallback"
  | "template_missing"
  | "no_recipients"
  | "filter_invalid"
  | "campaign_failed"
  | "workspace_failed"
  | "worker_failed";

export type WorkerLogContext = {
  workspaceId?: string;
  campaignId?: string;
  contactId?: string;
  category?: WorkerLogCategory;
  reason?: unknown;
};

type WorkerLogSink = Pick<Console, "info" | "warn" | "error">;
type WorkerLogEnv = Readonly<Record<string, string | undefined>>;

const MAX_REASON_LENGTH = 500;
const SENSITIVE_ENV_NAME =
  /(?:SECRET|TOKEN|PASSWORD|API_KEY|SMTP_USER|DATABASE_URL)/i;

function getSensitiveValues(env: WorkerLogEnv): string[] {
  return Object.entries(env)
    .filter(
      ([name, value]) =>
        SENSITIVE_ENV_NAME.test(name) &&
        typeof value === "string" &&
        value.length >= 4,
    )
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
}

export function sanitizeWorkerLogReason(
  reason: unknown,
  env: WorkerLogEnv = process.env,
): string {
  const rawMessage =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Worker operation failed";

  const environmentRedacted = getSensitiveValues(env).reduce(
    (message, secret) => message.replaceAll(secret, "[REDACTED]"),
    rawMessage,
  );
  const redacted = environmentRedacted
    .replace(
      /\b(https?:\/\/)([^\s:/@]+):([^\s@]+)@/gi,
      "$1[REDACTED]:[REDACTED]@",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(
      /\b(password|passwd|pwd|token|authorization|api[_-]?key|secret|smtp[_-]?(?:user|password)|gemini[_-]?api[_-]?key|jwt[_-]?secret)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (redacted.length <= MAX_REASON_LENGTH) {
    return redacted;
  }

  return `${redacted.slice(0, MAX_REASON_LENGTH - 3)}...`;
}

export function categorizeWorkerFailure(error: unknown): WorkerLogCategory {
  const message = sanitizeWorkerLogReason(error, {}).toLowerCase();

  if (message.includes("no recipients")) {
    return "no_recipients";
  }

  if (
    message.includes("template") &&
    (message.includes("unavailable") || message.includes("missing"))
  ) {
    return "template_missing";
  }

  if (
    message.includes("smtp delivery is not configured") ||
    message.includes("missing required smtp")
  ) {
    return "smtp_unconfigured";
  }

  if (
    message.startsWith("unsupported filter") ||
    message.includes("target_filters") ||
    message.includes("tags_contains") ||
    message.includes("lead_score_") ||
    message.includes("must be a finite number")
  ) {
    return "filter_invalid";
  }

  return "campaign_failed";
}

export function writeWorkerLog(
  level: WorkerLogLevel,
  event: string,
  context: WorkerLogContext = {},
  sink: WorkerLogSink = console,
  env: WorkerLogEnv = process.env,
): void {
  const record = {
    service: "campaign-worker",
    level,
    event,
    ...(context.workspaceId !== undefined
      ? { workspace_id: context.workspaceId }
      : {}),
    ...(context.campaignId !== undefined
      ? { campaign_id: context.campaignId }
      : {}),
    ...(context.contactId !== undefined ? { contact_id: context.contactId } : {}),
    ...(context.category ? { category: context.category } : {}),
    ...(context.reason !== undefined
      ? { reason: sanitizeWorkerLogReason(context.reason, env) }
      : {}),
  };

  sink[level](JSON.stringify(record));
}
