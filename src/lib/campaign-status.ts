export const CAMPAIGN_STATUSES = [
  "draft",
  "pending",
  "processing",
  "sent",
  "failed",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type UserCampaignStatus = Extract<CampaignStatus, "draft" | "pending">;

const USER_CAMPAIGN_STATUSES: readonly UserCampaignStatus[] = ["draft", "pending"];

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return (
    typeof value === "string" &&
    CAMPAIGN_STATUSES.includes(value as CampaignStatus)
  );
}

export function parseUserCampaignStatus(
  value: unknown,
  fallback: UserCampaignStatus,
): UserCampaignStatus {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new Error("Invalid status");
  }

  const normalized = value.trim().toLowerCase();

  if (!USER_CAMPAIGN_STATUSES.includes(normalized as UserCampaignStatus)) {
    throw new Error("Only draft or pending status can be set by users");
  }

  return normalized as UserCampaignStatus;
}

export function parseAiPersonalizationEnabled(
  value: unknown,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new Error("ai_personalization_enabled must be a boolean");
  }

  return value;
}

export function assertUserCampaignIsEditable(status: CampaignStatus): void {
  if (status === "processing" || status === "sent") {
    throw new Error("Processing or sent campaigns cannot be edited");
  }
}

export function assertCampaignSchedule(
  status: CampaignStatus,
  scheduledAt: string | null,
): void {
  if (status === "pending" && scheduledAt === null) {
    throw new Error("Scheduled campaigns require a delivery time");
  }
}
