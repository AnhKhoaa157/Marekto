import {
  parseCampaignAiContext,
  type CampaignAiContext,
} from "./campaign-ai-context.ts";
import {
  parseCampaignTargetFilters,
  type CampaignTargetFilters,
} from "./campaign-filters.ts";

/**
 * Pure mapping helpers that turn a reviewed campaign-builder package into the
 * exact request bodies accepted by the existing `POST /api/templates` and
 * `POST /api/campaigns` routes. Keeping these framework-free lets the builder
 * UI and the tests share one contract, and guarantees builder campaigns are
 * always drafts with a null schedule.
 */

export class CampaignBuilderDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignBuilderDraftError";
  }
}

export type TemplateDraftInput = {
  name: string;
  emailHtml: string;
  brief?: string;
  selectedSubject?: string | null;
};

export type TemplateDraftRequest = {
  name: string;
  body_html: string;
  body_json: Record<string, unknown>;
};

export type CampaignDraftInput = {
  name: string;
  templateId: number | null;
  useAllContacts: boolean;
  filtersValid: boolean;
  targetFilters: CampaignTargetFilters;
  enablePersonalization: boolean;
  aiContext: CampaignAiContext;
};

export type CampaignDraftRequest = {
  name: string;
  status: "draft";
  template_id: number | null;
  target_filters: CampaignTargetFilters;
  ai_personalization_enabled: boolean;
  ai_context: CampaignAiContext;
  scheduled_at: null;
};

export function buildTemplateDraftRequest(
  input: TemplateDraftInput,
): TemplateDraftRequest {
  const name = input.name.trim();

  if (name.length === 0) {
    throw new CampaignBuilderDraftError("Template name is required");
  }

  const bodyHtml = input.emailHtml.trim();

  if (bodyHtml.length === 0) {
    throw new CampaignBuilderDraftError("Template HTML content is required");
  }

  const bodyJson: Record<string, unknown> = { source: "campaign-builder" };
  const brief = input.brief?.trim();
  const subject = input.selectedSubject?.trim();

  if (brief) {
    bodyJson.brief = brief;
  }

  if (subject) {
    bodyJson.subject = subject;
  }

  return {
    name,
    body_html: input.emailHtml,
    body_json: bodyJson,
  };
}

export function buildCampaignDraftRequest(
  input: CampaignDraftInput,
): CampaignDraftRequest {
  const name = input.name.trim();

  if (name.length === 0) {
    throw new CampaignBuilderDraftError("Campaign name is required");
  }

  if (
    input.templateId !== null &&
    (!Number.isInteger(input.templateId) || input.templateId <= 0)
  ) {
    throw new CampaignBuilderDraftError("Invalid template id");
  }

  let targetFilters: CampaignTargetFilters;

  if (input.useAllContacts) {
    targetFilters = {};
  } else {
    if (!input.filtersValid) {
      throw new CampaignBuilderDraftError(
        "Correct the flagged audience filters before saving a campaign draft",
      );
    }

    targetFilters = parseCampaignTargetFilters(input.targetFilters);

    if (Object.keys(targetFilters).length === 0) {
      throw new CampaignBuilderDraftError(
        "Choose an audience or explicitly send to all contacts",
      );
    }
  }

  return {
    name,
    status: "draft",
    template_id: input.templateId,
    target_filters: targetFilters,
    ai_personalization_enabled: input.enablePersonalization === true,
    ai_context: parseCampaignAiContext(input.aiContext),
    scheduled_at: null,
  };
}
