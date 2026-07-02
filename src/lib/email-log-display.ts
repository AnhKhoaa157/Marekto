import type {
  CampaignEmailLogItem,
  EmailLogErrorCategory,
} from "@/lib/email-logs";

const MAX_DIAGNOSTIC_LENGTH = 600;

const ERROR_CATEGORY_LABELS: Record<EmailLogErrorCategory, string> = {
  none: "No delivery error",
  ai_fallback: "AI fallback",
  smtp_failure: "SMTP delivery",
  smtp_unconfigured: "SMTP configuration",
  template_missing: "Template missing",
  no_recipients: "No recipients",
  unknown: "Unknown delivery error",
};

export function getEmailLogErrorCategoryLabel(
  category: EmailLogErrorCategory,
): string {
  return ERROR_CATEGORY_LABELS[category];
}

export function getEmailLogPersonalizationLabel(
  log: Pick<
    CampaignEmailLogItem,
    "status" | "personalization_source" | "personalization_error"
  >,
): string {
  if (log.personalization_source === "gemini") {
    return "Personalized with AI";
  }

  if (
    log.personalization_source === "template" &&
    log.personalization_error
  ) {
    return "AI unavailable; original template used";
  }

  if (log.personalization_source === "template" && log.status === "sent") {
    return "Sent with original template";
  }

  if (log.personalization_source === "template") {
    return "Original template used";
  }

  return "Not recorded";
}

export function sanitizeEmailLogDiagnostic(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const withoutStack = value
    .split(/\r?\n/)
    .filter((line, index) => {
      if (/^\s*at\s+/.test(line) || /^\s*Caused by:\s*/i.test(line)) {
        return false;
      }

      return index === 0 || !/^\s*(Error|TypeError|RangeError):\s*/.test(line);
    })
    .join(" ")
    .replace(/^\s*(Error|TypeError|RangeError):\s*/i, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");

  const redacted = withoutStack
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
    .replace(/\s+/g, " ")
    .trim();

  if (!redacted) {
    return null;
  }

  if (redacted.length <= MAX_DIAGNOSTIC_LENGTH) {
    return redacted;
  }

  return `${redacted.slice(0, MAX_DIAGNOSTIC_LENGTH - 3)}...`;
}
