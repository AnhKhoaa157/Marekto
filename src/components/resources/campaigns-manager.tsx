"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  ResourceEmpty,
  ResourceError,
  ResourceLoading,
} from "@/components/resources/resource-states";
import {
  ApiRequestError,
  formatApiDate,
  isRecord,
  requestApi,
} from "@/lib/client-api";
import {
  CAMPAIGN_AI_CONTEXT_LIMITS,
  parseCampaignAiContext,
  type CampaignAiContext,
  type CampaignAiContextKey,
} from "@/lib/campaign-ai-context";

type CampaignStatus = "draft" | "pending" | "processing" | "sent" | "failed";
type DeliveryPlan = "draft" | "schedule";
type AudienceMode = "all" | "ai";
type AudienceSource = "gemini" | "cache";
type SchedulePreset =
  | "custom"
  | "tomorrow-morning"
  | "tomorrow-afternoon"
  | "next-week-morning";

type CampaignRow = {
  id: number;
  workspace_id: number;
  template_id: number | null;
  name: string;
  status: CampaignStatus;
  target_filters: Record<string, unknown>;
  ai_personalization_enabled: boolean;
  ai_context: CampaignAiContext;
  scheduled_at: string | null;
  run_at: string | null;
  created_at: string;
  updated_at: string;
};

type TemplateOption = {
  id: number;
  name: string;
};

type SegmentationResult = {
  targetFilters: Record<string, unknown>;
  source: AudienceSource;
};

const AI_CONTEXT_FIELDS: ReadonlyArray<{
  key: CampaignAiContextKey;
  label: string;
  placeholder: string;
  multiline: boolean;
}> = [
  {
    key: "goal",
    label: "Campaign goal",
    placeholder: "Invite VIP customers to book a product demo",
    multiline: true,
  },
  {
    key: "tone",
    label: "Tone",
    placeholder: "Warm, concise, and helpful",
    multiline: false,
  },
  {
    key: "cta",
    label: "CTA intent",
    placeholder: "Encourage the recipient to book a demo",
    multiline: true,
  },
  {
    key: "audience_description",
    label: "Audience framing",
    placeholder: "VIP customers in HCM with strong engagement",
    multiline: true,
  },
  {
    key: "language",
    label: "Language",
    placeholder: "English",
    multiline: false,
  },
];

function parseNullableDate(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("The campaign response contains an invalid date.");
  }

  return value;
}

function parseCampaignStatus(value: unknown): CampaignStatus {
  if (
    value === "draft" ||
    value === "pending" ||
    value === "processing" ||
    value === "sent" ||
    value === "failed"
  ) {
    return value;
  }

  throw new Error("The campaign response contains an invalid status.");
}

function parseCampaign(value: unknown): CampaignRow {
  if (
    !isRecord(value) ||
    typeof value.id !== "number" ||
    typeof value.workspace_id !== "number" ||
    (value.template_id !== null && typeof value.template_id !== "number") ||
    typeof value.name !== "string" ||
    !isRecord(value.target_filters) ||
    typeof value.ai_personalization_enabled !== "boolean" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    throw new Error("The campaign response has an invalid shape.");
  }

  return {
    id: value.id,
    workspace_id: value.workspace_id,
    template_id: value.template_id,
    name: value.name,
    status: parseCampaignStatus(value.status),
    target_filters: value.target_filters,
    ai_personalization_enabled: value.ai_personalization_enabled,
    ai_context: parseCampaignAiContext(value.ai_context),
    scheduled_at: parseNullableDate(value.scheduled_at),
    run_at: parseNullableDate(value.run_at),
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function parseCampaigns(value: unknown): CampaignRow[] {
  if (!Array.isArray(value)) {
    throw new Error("The campaigns response is not a list.");
  }

  return value.map(parseCampaign);
}

function parseTemplateOption(value: unknown): TemplateOption {
  if (!isRecord(value) || typeof value.id !== "number" || typeof value.name !== "string") {
    throw new Error("The template response has an invalid shape.");
  }

  return { id: value.id, name: value.name };
}

function parseTemplateOptions(value: unknown): TemplateOption[] {
  if (!Array.isArray(value)) {
    throw new Error("The templates response is not a list.");
  }

  return value.map(parseTemplateOption);
}

function hasAudienceFilters(filters: Record<string, unknown>): boolean {
  return Object.keys(filters).length > 0;
}

function parseAudienceSource(value: unknown): AudienceSource {
  if (value === "gemini" || value === "cache") {
    return value;
  }

  throw new Error("The AI audience response contains an invalid source.");
}

function parseSegmentationResult(value: unknown): SegmentationResult {
  if (!isRecord(value) || !isRecord(value.target_filters)) {
    throw new Error("The AI audience response has an invalid shape.");
  }

  if (!hasAudienceFilters(value.target_filters)) {
    throw new Error("The AI audience response did not contain any rules.");
  }

  return {
    targetFilters: value.target_filters,
    source: parseAudienceSource(value.source),
  };
}

function formatAudienceFilter(key: string, value: unknown): string {
  const displayValue =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "unsupported value";

  if (key === "city") {
    return `City is ${displayValue}`;
  }

  if (key === "lead_score_gt") {
    return `Lead score is above ${displayValue}`;
  }

  if (key === "lead_score_gte") {
    return `Lead score is at least ${displayValue}`;
  }

  if (key === "lead_score_lt") {
    return `Lead score is below ${displayValue}`;
  }

  if (key === "lead_score_lte") {
    return `Lead score is at most ${displayValue}`;
  }

  if (key === "tags_contains") {
    return `Includes tag ${displayValue}`;
  }

  const label = key.replaceAll("_", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} is ${displayValue}`;
}

function getDeliveryPlan(status: CampaignStatus): DeliveryPlan {
  if (status === "pending") {
    return "schedule";
  }

  return "draft";
}

function getCampaignStatus(plan: DeliveryPlan): CampaignStatus {
  if (plan === "schedule") {
    return "pending";
  }

  return "draft";
}

function getStatusLabel(status: CampaignStatus): string {
  if (status === "pending") {
    return "Scheduled";
  }

  if (status === "sent") {
    return "Sent";
  }

  if (status === "processing") {
    return "Processing";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "Draft";
}

function toLocalDateParts(value: string | null): { date: string; time: string } {
  if (!value) {
    return { date: "", time: "" };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: "", time: "" };
  }

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  const localValue = localDate.toISOString();

  return {
    date: localValue.slice(0, 10),
    time: localValue.slice(11, 16),
  };
}

function formatDateInput(date: Date): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function getPresetDate(preset: Exclude<SchedulePreset, "custom">): {
  date: string;
  time: string;
} {
  const date = new Date();

  if (preset.startsWith("tomorrow")) {
    date.setDate(date.getDate() + 1);
  }

  if (preset === "next-week-morning") {
    date.setDate(date.getDate() + 7);
  }

  const time = preset.endsWith("afternoon") ? "14:00" : "09:00";

  return {
    date: formatDateInput(date),
    time,
  };
}

function buildScheduledAt(date: string, time: string): string | null {
  if (!date) {
    return null;
  }

  const dateTime = new Date(`${date}T${time || "09:00"}`);

  if (Number.isNaN(dateTime.getTime())) {
    return null;
  }

  return dateTime.toISOString();
}

function statusClassName(status: CampaignStatus): string {
  if (status === "sent") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }

  if (status === "pending") {
    return "border-blue-500/30 bg-blue-500/10 text-blue-300";
  }

  if (status === "processing") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  }

  if (status === "failed") {
    return "border-red-500/30 bg-red-500/10 text-red-300";
  }

  return "border-zinc-700 bg-zinc-800 text-zinc-300";
}

export function CampaignsManager() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [editingCampaign, setEditingCampaign] = useState<CampaignRow | null>(null);
  const [name, setName] = useState("");
  const [deliveryPlan, setDeliveryPlan] = useState<DeliveryPlan>("draft");
  const [templateId, setTemplateId] = useState("");
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>("custom");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("all");
  const [audiencePrompt, setAudiencePrompt] = useState("");
  const [audienceSource, setAudienceSource] = useState<AudienceSource | null>(null);
  const [targetFilters, setTargetFilters] = useState<Record<string, unknown>>({});
  const [aiPersonalizationEnabled, setAiPersonalizationEnabled] = useState(false);
  const [aiContext, setAiContext] = useState<CampaignAiContext>({});
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingAudience, setIsGeneratingAudience] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);

  const handleUnauthorized = useCallback(() => {
    router.push("/login");
    router.refresh();
  }, [router]);

  const loadResources = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [campaignRows, templateRows] = await Promise.all([
          requestApi("/api/campaigns", { method: "GET", signal }, parseCampaigns),
          requestApi("/api/templates", { method: "GET", signal }, parseTemplateOptions),
        ]);
        setCampaigns(campaignRows);
        setTemplates(templateRows);
      } catch (loadFailure) {
        if (loadFailure instanceof DOMException && loadFailure.name === "AbortError") {
          return;
        }

        if (loadFailure instanceof ApiRequestError && loadFailure.status === 401) {
          handleUnauthorized();
          return;
        }

        setLoadError(
          loadFailure instanceof Error ? loadFailure.message : "Unable to load campaigns.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [handleUnauthorized],
  );

  useEffect(() => {
    const controller = new AbortController();

    void Promise.all([
      requestApi(
        "/api/campaigns",
        { method: "GET", signal: controller.signal },
        parseCampaigns,
      ),
      requestApi(
        "/api/templates",
        { method: "GET", signal: controller.signal },
        parseTemplateOptions,
      ),
    ])
      .then(([campaignRows, templateRows]) => {
        setCampaigns(campaignRows);
        setTemplates(templateRows);
      })
      .catch((loadFailure: unknown) => {
        if (loadFailure instanceof DOMException && loadFailure.name === "AbortError") {
          return;
        }

        if (loadFailure instanceof ApiRequestError && loadFailure.status === 401) {
          handleUnauthorized();
          return;
        }

        setLoadError(
          loadFailure instanceof Error ? loadFailure.message : "Unable to load campaigns.",
        );
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [handleUnauthorized]);

  function resetForm() {
    setEditingCampaign(null);
    setName("");
    setDeliveryPlan("draft");
    setTemplateId("");
    setSchedulePreset("custom");
    setScheduleDate("");
    setScheduleTime("");
    setAudienceMode("all");
    setAudiencePrompt("");
    setAudienceSource(null);
    setTargetFilters({});
    setAiPersonalizationEnabled(false);
    setAiContext({});
    setAudienceError(null);
    setActionError(null);
  }

  function startEditing(campaign: CampaignRow) {
    const dateParts = toLocalDateParts(campaign.scheduled_at);

    setEditingCampaign(campaign);
    setName(campaign.name);
    setDeliveryPlan(getDeliveryPlan(campaign.status));
    setTemplateId(campaign.template_id?.toString() ?? "");
    setSchedulePreset("custom");
    setScheduleDate(dateParts.date);
    setScheduleTime(dateParts.time);
    setAudienceMode(hasAudienceFilters(campaign.target_filters) ? "ai" : "all");
    setAudiencePrompt("");
    setAudienceSource(null);
    setTargetFilters(campaign.target_filters);
    setAiPersonalizationEnabled(campaign.ai_personalization_enabled);
    setAiContext(campaign.ai_context);
    setAudienceError(null);
    setActionError(null);
    setSuccess(null);
    setConfirmingDeleteId(null);
  }

  function handleDeliveryPlanChange(plan: DeliveryPlan) {
    setDeliveryPlan(plan);
    setActionError(null);

    if (plan === "schedule" && !scheduleDate) {
      const preset = getPresetDate("tomorrow-morning");
      setSchedulePreset("tomorrow-morning");
      setScheduleDate(preset.date);
      setScheduleTime(preset.time);
    }
  }

  function handleSchedulePresetChange(preset: SchedulePreset) {
    setSchedulePreset(preset);

    if (preset === "custom") {
      return;
    }

    const presetDate = getPresetDate(preset);
    setScheduleDate(presetDate.date);
    setScheduleTime(presetDate.time);
  }

  function handleAudienceModeChange(mode: AudienceMode) {
    setAudienceMode(mode);
    setAudienceError(null);
    setActionError(null);

    if (mode === "all") {
      setAudienceSource(null);
    }
  }

  function updateAiContext(key: CampaignAiContextKey, value: string) {
    setAiContext((current) => {
      const next = { ...current };
      const normalized = value.trimStart();

      if (normalized.length === 0) {
        delete next[key];
      } else {
        next[key] = normalized;
      }

      return next;
    });
    setActionError(null);
  }

  async function handleGenerateAudience() {
    const prompt = audiencePrompt.trim();

    if (!prompt) {
      setAudienceError("Describe the audience you want to reach.");
      return;
    }

    setAudienceError(null);
    setActionError(null);
    setSuccess(null);
    setIsGeneratingAudience(true);

    try {
      const result = await requestApi(
        "/api/ai/segmentation",
        {
          method: "POST",
          body: JSON.stringify({ prompt }),
        },
        parseSegmentationResult,
      );

      setTargetFilters(result.targetFilters);
      setAudienceSource(result.source);
    } catch (generateError) {
      if (generateError instanceof ApiRequestError && generateError.status === 401) {
        handleUnauthorized();
        return;
      }

      setAudienceError(
        generateError instanceof Error
          ? generateError.message
          : "Unable to generate audience rules.",
      );
    } finally {
      setIsGeneratingAudience(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setSuccess(null);

    const trimmedName = name.trim();

    if (!trimmedName) {
      setActionError("Campaign name is required.");
      return;
    }

    if (deliveryPlan === "schedule" && !scheduleDate) {
      setActionError("Choose a delivery date before scheduling this campaign.");
      return;
    }

    if (audienceMode === "ai" && !hasAudienceFilters(targetFilters)) {
      setActionError("Generate audience rules before saving this campaign.");
      return;
    }

    setIsSubmitting(true);

    const editingId = editingCampaign?.id;

    try {
      const filters = audienceMode === "all" ? {} : targetFilters;
      const scheduledAt =
        deliveryPlan === "schedule" ? buildScheduledAt(scheduleDate, scheduleTime) : null;

      if (deliveryPlan === "schedule" && !scheduledAt) {
        throw new Error("Schedule must be a valid date and time.");
      }

      const savedCampaign = await requestApi(
        editingId ? `/api/campaigns/${editingId}` : "/api/campaigns",
        {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify({
            name: trimmedName,
            status: getCampaignStatus(deliveryPlan),
            template_id: templateId ? Number(templateId) : null,
            scheduled_at: scheduledAt,
            target_filters: filters,
            ai_personalization_enabled: aiPersonalizationEnabled,
            ai_context: aiContext,
          }),
        },
        parseCampaign,
      );

      setCampaigns((current) =>
        editingId
          ? current.map((campaign) =>
              campaign.id === savedCampaign.id ? savedCampaign : campaign,
            )
          : [savedCampaign, ...current],
      );
      setSuccess(
        editingId ? "Campaign updated successfully." : "Campaign created successfully.",
      );
      resetForm();
    } catch (saveError) {
      if (saveError instanceof ApiRequestError && saveError.status === 401) {
        handleUnauthorized();
        return;
      }

      setActionError(
        saveError instanceof Error ? saveError.message : "Unable to save campaign.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteConfirmed(campaign: CampaignRow) {
    setActionError(null);
    setSuccess(null);
    setDeletingId(campaign.id);

    try {
      await requestApi(`/api/campaigns/${campaign.id}`, { method: "DELETE" }, parseCampaign);
      setCampaigns((current) => current.filter((item) => item.id !== campaign.id));
      if (editingCampaign?.id === campaign.id) {
        resetForm();
      }
      setSuccess("Campaign deleted successfully.");
      setConfirmingDeleteId(null);
    } catch (deleteError) {
      if (deleteError instanceof ApiRequestError && deleteError.status === 401) {
        handleUnauthorized();
        return;
      }

      setActionError(
        deleteError instanceof Error ? deleteError.message : "Unable to delete campaign.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  function getTemplateName(id: number | null): string {
    if (id === null) {
      return "No template";
    }

    return templates.find((template) => template.id === id)?.name ?? "Template unavailable";
  }

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <article className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm xl:col-span-2">
        <h2 className="text-lg font-semibold text-zinc-50">Workspace campaigns</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Plan, schedule, and review campaigns for this workspace.
        </p>
        <div className="mt-4">
          {isLoading ? <ResourceLoading label="Loading campaigns" /> : null}
          {!isLoading && loadError ? (
            <ResourceError
              message={loadError}
              onRetry={() => {
                setLoadError(null);
                setIsLoading(true);
                void loadResources();
              }}
            />
          ) : null}
          {!isLoading && !loadError && campaigns.length === 0 ? (
            <ResourceEmpty
              description="Create a campaign draft or schedule one for delivery."
              title="No campaigns found"
            />
          ) : null}
          {!isLoading && !loadError && campaigns.length > 0 ? (
            <div className="marekto-scrollbar overflow-x-auto">
              <table className="w-full min-w-full text-left text-sm">
                <thead className="border-b border-zinc-800 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">Campaign</th>
                    <th className="py-3 pr-4">Delivery</th>
                    <th className="py-3 pr-4">Schedule</th>
                    <th className="py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td className="py-4 pr-4">
                        <p className="font-medium text-zinc-100">{campaign.name}</p>
                        <p className="mt-1 text-sm text-zinc-500">
                          {getTemplateName(campaign.template_id)}
                        </p>
                      </td>
                      <td className="py-4 pr-4">
                        <div className="flex flex-wrap gap-2">
                          <span
                            className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${statusClassName(campaign.status)}`}
                          >
                            {getStatusLabel(campaign.status)}
                          </span>
                          {campaign.ai_personalization_enabled ? (
                            <span className="inline-flex rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-xs font-medium text-indigo-200">
                              AI personalization
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-4 pr-4 text-zinc-500">
                        {campaign.scheduled_at
                          ? formatApiDate(campaign.scheduled_at)
                          : "Not scheduled"}
                      </td>
                      <td className="py-4">
                        {confirmingDeleteId === campaign.id ? (
                          <div className="flex flex-col items-end gap-2">
                            <p className="text-right text-xs font-medium text-red-300">
                              Delete this campaign?
                            </p>
                            <div className="flex justify-end gap-2">
                              <button
                                className="h-9 rounded-md border border-red-500/30 px-3 text-sm font-medium text-red-300 outline-none transition-colors hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-400 disabled:border-zinc-800 disabled:text-zinc-600"
                                disabled={deletingId === campaign.id}
                                onClick={() => void handleDeleteConfirmed(campaign)}
                                type="button"
                              >
                                {deletingId === campaign.id
                                  ? "Deleting..."
                                  : "Confirm delete"}
                              </button>
                              <button
                                className="h-9 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-400"
                                disabled={deletingId === campaign.id}
                                onClick={() => setConfirmingDeleteId(null)}
                                type="button"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Link
                              className="inline-flex h-9 items-center rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
                              href={`/campaigns/${campaign.id}`}
                            >
                              View
                            </Link>
                            <button
                              className="h-9 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent"
                              disabled={
                                campaign.status === "processing" || campaign.status === "sent"
                              }
                              onClick={() => startEditing(campaign)}
                              title={
                                campaign.status === "processing" || campaign.status === "sent"
                                  ? "Processing and sent campaigns are read-only"
                                  : undefined
                              }
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="h-9 rounded-md border border-red-500/30 px-3 text-sm font-medium text-red-300 outline-none transition-colors hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-400"
                              onClick={() => {
                                setActionError(null);
                                setSuccess(null);
                                setConfirmingDeleteId(campaign.id);
                              }}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </article>

      <aside className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-50">
          {editingCampaign ? "Edit campaign" : "Create campaign"}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {editingCampaign
            ? "Update the name, delivery plan, audience, or template."
            : "Create a draft now, or schedule delivery for later."}
        </p>
        <form className="mt-4 space-y-4" noValidate onSubmit={handleSubmit}>
          <CampaignFormSectionHeading
            description="Name the campaign and choose the HTML template used for delivery."
            title="Campaign details"
          />
          <CampaignTextInput label="Name" onChange={setName} required value={name} />
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-200" htmlFor="campaign-template">
              Template
            </label>
            <select
              className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              id="campaign-template"
              onChange={(event) => setTemplateId(event.target.value)}
              value={templateId}
            >
              <option value="">No template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <CampaignFormSectionHeading
            description="Save a draft now or choose when the worker should deliver it."
            title="Delivery"
          />
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-200" htmlFor="campaign-plan">
              Delivery plan
            </label>
            <select
              className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              id="campaign-plan"
              onChange={(event) =>
                handleDeliveryPlanChange(event.target.value as DeliveryPlan)
              }
              value={deliveryPlan}
            >
              <option value="draft">Save as draft</option>
              <option value="schedule">Schedule delivery</option>
            </select>
            <p className="text-xs text-zinc-500">
              Drafts stay inactive. Scheduled campaigns run when their delivery time
              arrives.
            </p>
          </div>
          {deliveryPlan === "schedule" ? (
            <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-zinc-200"
                  htmlFor="campaign-schedule-preset"
                >
                  Schedule shortcut
                </label>
                <select
                  className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-50 outline-none transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                  id="campaign-schedule-preset"
                  onChange={(event) =>
                    handleSchedulePresetChange(event.target.value as SchedulePreset)
                  }
                  value={schedulePreset}
                >
                  <option value="tomorrow-morning">Tomorrow morning</option>
                  <option value="tomorrow-afternoon">Tomorrow afternoon</option>
                  <option value="next-week-morning">Next week morning</option>
                  <option value="custom">Custom date and time</option>
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-zinc-200"
                    htmlFor="campaign-schedule-date"
                  >
                    Delivery date
                  </label>
                  <input
                    className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-50 outline-none transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                    id="campaign-schedule-date"
                    onChange={(event) => {
                      setScheduleDate(event.target.value);
                      setSchedulePreset("custom");
                    }}
                    type="date"
                    value={scheduleDate}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-zinc-200"
                    htmlFor="campaign-schedule-time"
                  >
                    Delivery time
                  </label>
                  <input
                    className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-50 outline-none transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                    id="campaign-schedule-time"
                    onChange={(event) => {
                      setScheduleTime(event.target.value);
                      setSchedulePreset("custom");
                    }}
                    type="time"
                    value={scheduleTime}
                  />
                </div>
              </div>
            </div>
          ) : null}
          <CampaignFormSectionHeading
            description="Send to every contact or generate a validated AND-based audience."
            title="Audience"
          />
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-200" htmlFor="campaign-audience">
              Audience
            </label>
            <select
              className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              disabled={isGeneratingAudience}
              id="campaign-audience"
              onChange={(event) =>
                handleAudienceModeChange(event.target.value as AudienceMode)
              }
              value={audienceMode}
            >
              <option value="all">All contacts in this workspace</option>
              <option value="ai">Build a targeted audience with AI</option>
            </select>
            <p className="text-xs text-zinc-500">
              {audienceMode === "all"
                ? "Every real contact in this workspace will be eligible."
                : "Describe who should receive this campaign, then review the generated rules."}
            </p>
          </div>
          {audienceMode === "ai" ? (
            <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label
                    className="text-sm font-medium text-zinc-200"
                    htmlFor="campaign-audience-prompt"
                  >
                    Audience description
                  </label>
                  <span className="text-xs text-zinc-500">
                    {audiencePrompt.length}/500
                  </span>
                </div>
                <textarea
                  aria-describedby="campaign-audience-help"
                  className="min-h-24 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:text-zinc-500"
                  disabled={isGeneratingAudience}
                  id="campaign-audience-prompt"
                  maxLength={500}
                  onChange={(event) => {
                    setAudiencePrompt(event.target.value);

                    if (hasAudienceFilters(targetFilters)) {
                      setTargetFilters({});
                      setAudienceSource(null);
                    }

                    setAudienceError(null);
                  }}
                  placeholder="For example: VIP customers in HCM with a lead score above 80"
                  value={audiencePrompt}
                />
                <p className="text-xs text-zinc-500" id="campaign-audience-help">
                  Marekto converts this description into validated rules. Contact records
                  are not sent to the AI provider.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  className="h-10 flex-1 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                  disabled={isGeneratingAudience || audiencePrompt.trim().length === 0}
                  onClick={() => void handleGenerateAudience()}
                  type="button"
                >
                  {isGeneratingAudience
                    ? "Generating audience..."
                    : hasAudienceFilters(targetFilters)
                      ? "Regenerate audience"
                      : "Generate audience"}
                </button>
                {hasAudienceFilters(targetFilters) ? (
                  <button
                    className="h-10 rounded-md border border-zinc-700 px-4 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:text-zinc-600"
                    disabled={isGeneratingAudience}
                    onClick={() => {
                      setTargetFilters({});
                      setAudienceSource(null);
                      setAudienceError(null);
                    }}
                    type="button"
                  >
                    Clear rules
                  </button>
                ) : null}
              </div>
              {audienceError ? (
                <p className="text-sm text-red-300" role="alert">
                  {audienceError}
                </p>
              ) : null}
              {hasAudienceFilters(targetFilters) ? (
                <div
                  aria-live="polite"
                  className="space-y-2 border-t border-zinc-800 pt-3"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Audience rules</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      All generated rules must match.
                    </p>
                  </div>
                  {audienceSource ? (
                    <p
                      className={
                        audienceSource === "cache"
                          ? "rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200"
                          : "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200"
                      }
                    >
                      {audienceSource === "cache"
                        ? "AI is unavailable. Marekto reused saved audience rules from this workspace."
                        : "Audience rules generated by Gemini and saved for this workspace."}
                    </p>
                  ) : (
                    <p className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-400">
                      These saved rules came from this campaign. Regenerate to refresh them.
                    </p>
                  )}
                  <ul className="flex flex-wrap gap-2">
                    {Object.entries(targetFilters).map(([key, value]) => (
                      <li
                        className="max-w-full break-words rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-xs font-medium text-indigo-200"
                        key={key}
                      >
                        {formatAudienceFilter(key, value)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          <fieldset className="space-y-4 rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <legend className="px-1 text-sm font-semibold text-zinc-100">
              AI personalization
            </legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900 p-3">
              <input
                checked={aiPersonalizationEnabled}
                className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-2 focus:ring-indigo-400"
                onChange={(event) => {
                  setAiPersonalizationEnabled(event.target.checked);
                  setActionError(null);
                }}
                type="checkbox"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-200">
                  Personalize each recipient email with Gemini
                </span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                  If AI is unavailable or returns invalid content, Marekto sends the
                  original template instead.
                </span>
              </span>
            </label>

            {aiPersonalizationEnabled ? (
              <div className="space-y-4 border-t border-zinc-800 pt-4">
                <div>
                  <p className="text-sm font-medium text-zinc-200">
                    Campaign writing guidance
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    Optional guidance can shape tone and intent. It cannot create facts,
                    offers, deadlines, URLs, legal content, or personal data.
                  </p>
                </div>
                {AI_CONTEXT_FIELDS.map((field) => (
                  <CampaignAiContextField
                    key={field.key}
                    field={field}
                    onChange={(value) => updateAiContext(field.key, value)}
                    value={aiContext[field.key] ?? ""}
                  />
                ))}
              </div>
            ) : null}
          </fieldset>
          {actionError ? (
            <p className="text-sm text-red-300" role="alert">
              {actionError}
            </p>
          ) : null}
          {success ? (
            <p aria-live="polite" className="text-sm text-emerald-300">
              {success}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="h-10 flex-1 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              disabled={
                isSubmitting ||
                isGeneratingAudience ||
                (audienceMode === "ai" && !hasAudienceFilters(targetFilters))
              }
              type="submit"
            >
              {isSubmitting
                ? editingCampaign
                  ? "Saving changes..."
                  : "Creating campaign..."
                : editingCampaign
                  ? "Save changes"
                  : deliveryPlan === "schedule"
                    ? "Schedule campaign"
                    : "Save campaign"}
            </button>
            {editingCampaign ? (
              <button
                className="h-10 rounded-md border border-zinc-700 px-4 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-400"
                onClick={resetForm}
                type="button"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </aside>
    </section>
  );
}

type CampaignTextInputProps = {
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
};

function CampaignFormSectionHeading({
  description,
  title,
}: Readonly<{ description: string; title: string }>) {
  return (
    <div className="border-t border-zinc-800 pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
    </div>
  );
}

type CampaignAiContextFieldProps = {
  field: (typeof AI_CONTEXT_FIELDS)[number];
  onChange: (value: string) => void;
  value: string;
};

function CampaignAiContextField({
  field,
  onChange,
  value,
}: Readonly<CampaignAiContextFieldProps>) {
  const id = `campaign-ai-context-${field.key}`;
  const sharedClassName =
    "w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-50 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-zinc-200" htmlFor={id}>
          {field.label}
        </label>
        <span className="text-xs text-zinc-600">
          {value.length}/{CAMPAIGN_AI_CONTEXT_LIMITS[field.key]}
        </span>
      </div>
      {field.multiline ? (
        <textarea
          className={`${sharedClassName} min-h-20 resize-y py-2`}
          id={id}
          maxLength={CAMPAIGN_AI_CONTEXT_LIMITS[field.key]}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          value={value}
        />
      ) : (
        <input
          className={`${sharedClassName} h-10`}
          id={id}
          maxLength={CAMPAIGN_AI_CONTEXT_LIMITS[field.key]}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          type="text"
          value={value}
        />
      )}
    </div>
  );
}

function CampaignTextInput({
  label,
  onChange,
  required = false,
  value,
}: Readonly<CampaignTextInputProps>) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-zinc-200" htmlFor="campaign-name">
        {label}
      </label>
      <input
        className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
        id="campaign-name"
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type="text"
        value={value}
      />
    </div>
  );
}
