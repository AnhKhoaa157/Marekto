"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { ApiRequestError, isRecord, requestApi } from "@/lib/client-api";
import {
  CAMPAIGN_AI_CONTEXT_LIMITS,
  parseCampaignAiContext,
  type CampaignAiContext,
  type CampaignAiContextKey,
} from "@/lib/campaign-ai-context";
import {
  buildCampaignDraftRequest,
  buildTemplateDraftRequest,
} from "@/lib/campaign-builder-draft";
import {
  parseCampaignTargetFilters,
  type CampaignTargetFilters,
} from "@/lib/campaign-filters";

type BuilderInputState = {
  productOrService: string;
  campaignGoal: string;
  targetAudiencePrompt: string;
  tone: string;
  offerOrCTA: string;
  schedulePreference: string;
  enablePersonalization: boolean;
};

type BuilderTextFieldKey = Exclude<
  keyof BuilderInputState,
  "enablePersonalization"
>;

type BuilderResult = {
  campaignName: string;
  brief: string;
  audienceExplanation: string;
  targetFilters: CampaignTargetFilters;
  filtersValid: boolean;
  subjectIdeas: string[];
  emailHtml: string;
  aiContext: CampaignAiContext;
  scheduleNotes: string;
  warnings: string[];
};

type SavedResource = { id: number; name: string };

const BUILDER_FIELDS: ReadonlyArray<{
  key: BuilderTextFieldKey;
  label: string;
  limit: number;
  multiline: boolean;
  required: boolean;
  placeholder: string;
  help: string;
}> = [
  {
    key: "productOrService",
    label: "Product or service",
    limit: 200,
    multiline: false,
    required: true,
    placeholder: "Online English course for beginners",
    help: "What you are marketing in this campaign.",
  },
  {
    key: "campaignGoal",
    label: "Campaign goal",
    limit: 300,
    multiline: true,
    required: true,
    placeholder: "Increase signups for the July cohort",
    help: "The outcome this campaign should drive.",
  },
  {
    key: "targetAudiencePrompt",
    label: "Target audience",
    limit: 500,
    multiline: true,
    required: true,
    placeholder:
      "Contacts in HCM with lead score over 70 and interested in education",
    help: "Describe the audience. Contact records are never sent to the AI provider.",
  },
  {
    key: "tone",
    label: "Tone",
    limit: 100,
    multiline: false,
    required: false,
    placeholder: "Friendly, motivating, professional",
    help: "Optional voice and style guidance.",
  },
  {
    key: "offerOrCTA",
    label: "Offer / call to action",
    limit: 300,
    multiline: false,
    required: false,
    placeholder: "Register now to get 20% off",
    help: "Optional offer or CTA text. No CTA URL is invented for you.",
  },
  {
    key: "schedulePreference",
    label: "Schedule preference",
    limit: 200,
    multiline: false,
    required: false,
    placeholder: "Send this Friday morning",
    help: "Optional timing note. Saved drafts are scheduled manually later.",
  },
];

const AI_CONTEXT_FIELDS: ReadonlyArray<{
  key: CampaignAiContextKey;
  label: string;
  multiline: boolean;
}> = [
  { key: "goal", label: "Goal", multiline: true },
  { key: "tone", label: "Tone", multiline: false },
  { key: "cta", label: "CTA intent", multiline: true },
  { key: "audience_description", label: "Audience framing", multiline: true },
  { key: "language", label: "Language", multiline: false },
];

const EMPTY_INPUT: BuilderInputState = {
  productOrService: "",
  campaignGoal: "",
  targetAudiencePrompt: "",
  tone: "",
  offerOrCTA: "",
  schedulePreference: "",
  enablePersonalization: false,
};

const inputClassName =
  "w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30";

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`The campaign builder response has an invalid ${label}.`);
  }

  return value.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(`The campaign builder response has an invalid ${label}.`);
    }

    return entry;
  });
}

export function parseBuilderResult(value: unknown): BuilderResult {
  if (
    !isRecord(value) ||
    typeof value.campaignName !== "string" ||
    typeof value.brief !== "string" ||
    typeof value.audienceExplanation !== "string" ||
    typeof value.emailHtml !== "string" ||
    typeof value.scheduleNotes !== "string" ||
    typeof value.filtersValid !== "boolean" ||
    !isRecord(value.targetFilters)
  ) {
    throw new Error("The campaign builder response has an invalid shape.");
  }

  return {
    campaignName: value.campaignName,
    brief: value.brief,
    audienceExplanation: value.audienceExplanation,
    targetFilters: parseCampaignTargetFilters(value.targetFilters),
    filtersValid: value.filtersValid,
    subjectIdeas: parseStringArray(value.subjectIdeas, "subject ideas"),
    emailHtml: value.emailHtml,
    aiContext: parseCampaignAiContext(value.aiContext),
    scheduleNotes: value.scheduleNotes,
    warnings: parseStringArray(value.warnings ?? [], "warnings"),
  };
}

function parseSavedResource(value: unknown): SavedResource {
  if (!isRecord(value) || typeof value.id !== "number" || typeof value.name !== "string") {
    throw new Error("The save response has an invalid shape.");
  }

  return { id: value.id, name: value.name };
}

function formatAudienceFilter(key: string, value: unknown): string {
  const displayValue =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "unsupported value";

  if (key === "city") return `City is ${displayValue}`;
  if (key === "lead_score_gt") return `Lead score is above ${displayValue}`;
  if (key === "lead_score_gte") return `Lead score is at least ${displayValue}`;
  if (key === "lead_score_lt") return `Lead score is below ${displayValue}`;
  if (key === "lead_score_lte") return `Lead score is at most ${displayValue}`;
  if (key === "tags_contains") return `Includes tag ${displayValue}`;

  const label = key.replaceAll("_", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} is ${displayValue}`;
}

export function CampaignBuilderManager() {
  const router = useRouter();
  const [input, setInput] = useState<BuilderInputState>(EMPTY_INPUT);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [result, setResult] = useState<BuilderResult | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [brief, setBrief] = useState("");
  const [audienceExplanation, setAudienceExplanation] = useState("");
  const [emailHtml, setEmailHtml] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [subjectIdeas, setSubjectIdeas] = useState<string[]>([]);
  const [selectedSubject, setSelectedSubject] = useState(0);
  const [subjectCopyStatus, setSubjectCopyStatus] = useState<string | null>(null);
  const [targetFilters, setTargetFilters] = useState<CampaignTargetFilters>({});
  const [filtersValid, setFiltersValid] = useState(true);
  const [filtersAcknowledged, setFiltersAcknowledged] = useState(false);
  const [useAllContacts, setUseAllContacts] = useState(false);
  const [aiContext, setAiContext] = useState<CampaignAiContext>({});
  const [enablePersonalization, setEnablePersonalization] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [allowCampaignWithoutTemplate, setAllowCampaignWithoutTemplate] =
    useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);
  const [isSavingBoth, setIsSavingBoth] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState<SavedResource | null>(null);
  const [savedCampaign, setSavedCampaign] = useState<SavedResource | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const handleUnauthorized = useCallback(() => {
    router.push("/login");
    router.refresh();
  }, [router]);

  const isSaving = isSavingTemplate || isSavingCampaign || isSavingBoth;
  const filtersReady = filtersValid || filtersAcknowledged;
  const hasFilters = Object.keys(targetFilters).length > 0;

  function updateInput(key: BuilderTextFieldKey, value: string) {
    setInput((current) => ({ ...current, [key]: value }));
    setGenerateError(null);
  }

  function applyResult(builderResult: BuilderResult) {
    setResult(builderResult);
    setCampaignName(builderResult.campaignName);
    setBrief(builderResult.brief);
    setAudienceExplanation(builderResult.audienceExplanation);
    setEmailHtml(builderResult.emailHtml);
    setScheduleNotes(builderResult.scheduleNotes);
    setSubjectIdeas(builderResult.subjectIdeas);
    setSelectedSubject(0);
    setSubjectCopyStatus(null);
    setTargetFilters(builderResult.targetFilters);
    setFiltersValid(builderResult.filtersValid);
    setFiltersAcknowledged(false);
    setUseAllContacts(false);
    setAiContext(builderResult.aiContext);
    setEnablePersonalization(input.enablePersonalization);
    setWarnings(builderResult.warnings);

    setAllowCampaignWithoutTemplate(false);
    setSavedTemplate(null);
    setSavedCampaign(null);
    setTemplateError(null);
    setCampaignError(null);
    setSaveSuccess(null);
  }

  async function handleGenerate() {
    const requiredField = BUILDER_FIELDS.find(
      (field) => field.required && input[field.key].trim().length === 0,
    );

    if (requiredField) {
      setGenerateError(`${requiredField.label} is required.`);
      return;
    }

    setGenerateError(null);
    setIsGenerating(true);

    try {
      const payload: Record<string, unknown> = {
        productOrService: input.productOrService.trim(),
        campaignGoal: input.campaignGoal.trim(),
        targetAudiencePrompt: input.targetAudiencePrompt.trim(),
        enablePersonalization: input.enablePersonalization,
      };

      for (const key of ["tone", "offerOrCTA", "schedulePreference"] as const) {
        const value = input[key].trim();
        if (value.length > 0) {
          payload[key] = value;
        }
      }

      const builderResult = await requestApi(
        "/api/ai/campaign-builder",
        { method: "POST", body: JSON.stringify(payload) },
        parseBuilderResult,
      );

      applyResult(builderResult);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        handleUnauthorized();
        return;
      }

      setGenerateError(
        error instanceof Error
          ? error.message
          : "The campaign builder is unavailable right now. You can try again shortly.",
      );
    } finally {
      setIsGenerating(false);
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
  }

  function removeFilter(key: string) {
    setTargetFilters((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setCampaignError(null);
  }

  function updateSubjectIdea(index: number, value: string) {
    setSubjectIdeas((current) =>
      current.map((subject, subjectIndex) =>
        subjectIndex === index ? value : subject,
      ),
    );
    setSubjectCopyStatus(null);
  }

  async function copySubjectIdea(index: number) {
    const subject = subjectIdeas[index]?.trim();

    if (!subject) {
      setSubjectCopyStatus("Add a subject line before copying it.");
      return;
    }

    try {
      await navigator.clipboard.writeText(subject);
      setSubjectCopyStatus(`Subject ${index + 1} copied.`);
    } catch {
      setSubjectCopyStatus("Unable to copy automatically. Select and copy the text manually.");
    }
  }

  function isUnauthorized(error: unknown): boolean {
    if (error instanceof ApiRequestError && error.status === 401) {
      handleUnauthorized();
      return true;
    }

    return false;
  }

  async function createTemplate(): Promise<SavedResource> {
    const body = buildTemplateDraftRequest({
      name: campaignName,
      emailHtml,
      brief,
      selectedSubject: subjectIdeas[selectedSubject] ?? null,
    });

    return requestApi(
      "/api/templates",
      { method: "POST", body: JSON.stringify(body) },
      parseSavedResource,
    );
  }

  async function createCampaign(templateId: number | null): Promise<SavedResource> {
    const body = buildCampaignDraftRequest({
      name: campaignName,
      templateId,
      useAllContacts,
      filtersValid: filtersReady,
      targetFilters,
      enablePersonalization,
      aiContext,
    });

    return requestApi(
      "/api/campaigns",
      { method: "POST", body: JSON.stringify(body) },
      parseSavedResource,
    );
  }

  async function handleSaveTemplate() {
    setTemplateError(null);
    setSaveSuccess(null);
    setIsSavingTemplate(true);

    try {
      const template = await createTemplate();
      setSavedTemplate(template);
      setSaveSuccess(`Template draft "${template.name}" saved.`);
    } catch (error) {
      if (isUnauthorized(error)) return;
      setTemplateError(
        error instanceof Error ? error.message : "Unable to save the template draft.",
      );
    } finally {
      setIsSavingTemplate(false);
    }
  }

  async function handleSaveCampaign() {
    setCampaignError(null);
    setSaveSuccess(null);

    if (!savedTemplate && !allowCampaignWithoutTemplate) {
      setCampaignError(
        "Save the template first, or choose to save the campaign without a template.",
      );
      return;
    }

    setIsSavingCampaign(true);

    try {
      const campaign = await createCampaign(savedTemplate?.id ?? null);
      setSavedCampaign(campaign);
      setSaveSuccess(`Campaign draft "${campaign.name}" saved.`);
    } catch (error) {
      if (isUnauthorized(error)) return;
      setCampaignError(
        error instanceof Error ? error.message : "Unable to save the campaign draft.",
      );
    } finally {
      setIsSavingCampaign(false);
    }
  }

  async function handleSaveBoth() {
    setTemplateError(null);
    setCampaignError(null);
    setSaveSuccess(null);
    setIsSavingBoth(true);

    try {
      let template = savedTemplate;

      if (!template) {
        try {
          template = await createTemplate();
          setSavedTemplate(template);
        } catch (error) {
          if (isUnauthorized(error)) return;
          setTemplateError(
            error instanceof Error
              ? error.message
              : "Unable to save the template draft.",
          );
          return;
        }
      }

      try {
        const campaign = await createCampaign(template.id);
        setSavedCampaign(campaign);
        setSaveSuccess("Template and campaign drafts saved.");
      } catch (error) {
        if (isUnauthorized(error)) return;
        setCampaignError(
          error instanceof Error
            ? error.message
            : "Template saved, but the campaign draft failed. Retry the campaign save.",
        );
      }
    } finally {
      setIsSavingBoth(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-50">Campaign idea</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Describe your campaign. Marekto generates a reviewable draft package —
          nothing is sent or scheduled automatically.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {BUILDER_FIELDS.map((field) => {
            const id = `builder-${field.key}`;
            const value = input[field.key];

            return (
              <div
                className={`space-y-2 ${field.multiline ? "lg:col-span-2" : ""}`}
                key={field.key}
              >
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-zinc-200" htmlFor={id}>
                    {field.label}
                    {field.required ? null : (
                      <span className="ml-1 text-xs font-normal text-zinc-500">
                        (optional)
                      </span>
                    )}
                  </label>
                  <span className="text-xs text-zinc-600">
                    {value.length}/{field.limit}
                  </span>
                </div>
                {field.multiline ? (
                  <textarea
                    aria-describedby={`${id}-help`}
                    className={`${inputClassName} min-h-20 resize-y py-2`}
                    disabled={isGenerating}
                    id={id}
                    maxLength={field.limit}
                    onChange={(event) => updateInput(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    value={value}
                  />
                ) : (
                  <input
                    aria-describedby={`${id}-help`}
                    className={`${inputClassName} h-10`}
                    disabled={isGenerating}
                    id={id}
                    maxLength={field.limit}
                    onChange={(event) => updateInput(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    type="text"
                    value={value}
                  />
                )}
                <p className="text-xs leading-5 text-zinc-500" id={`${id}-help`}>
                  {field.help}
                </p>
              </div>
            );
          })}
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
          <input
            checked={input.enablePersonalization}
            className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-2 focus:ring-indigo-400"
            disabled={isGenerating}
            onChange={(event) =>
              setInput((current) => ({
                ...current,
                enablePersonalization: event.target.checked,
              }))
            }
            type="checkbox"
          />
          <span>
            <span className="block text-sm font-medium text-zinc-200">
              Enable AI personalization at delivery
            </span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">
              Saved on the campaign draft. The worker personalizes each recipient at
              send time, falling back to the raw template if AI is unavailable.
            </span>
          </span>
        </label>

        {generateError ? (
          <p className="mt-4 text-sm text-red-300" role="alert">
            {generateError}
          </p>
        ) : null}

        <div className="mt-4">
          <button
            className="h-10 w-full rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 sm:w-auto"
            disabled={isGenerating}
            onClick={() => void handleGenerate()}
            type="button"
          >
            {isGenerating
              ? "Generating campaign package..."
              : result
                ? "Regenerate campaign package"
                : "Generate campaign package"}
          </button>
        </div>
      </section>

      {!result ? (
        <section className="rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-6 text-center">
          <p className="text-sm font-medium text-zinc-200">No draft generated yet</p>
          <p className="mt-2 text-sm text-zinc-500">
            Fill in the campaign idea above and generate a reviewable draft. You can
            edit every section before saving Template and Campaign drafts.
          </p>
        </section>
      ) : (
        <>
          {warnings.length > 0 ? (
            <section
              className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4"
              role="status"
            >
              <h2 className="text-sm font-semibold text-amber-200">
                Warnings to review
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-100/90">
                {warnings.map((warning, index) => (
                  <li key={`${index}-${warning.slice(0, 12)}`}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-50">
              Campaign identity and brief
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Edit the reviewed name and brief. This name is used for the Template
              and Campaign drafts.
            </p>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-zinc-200"
                  htmlFor="builder-campaign-name"
                >
                  Campaign name
                </label>
                <input
                  className={`${inputClassName} h-10`}
                  id="builder-campaign-name"
                  onChange={(event) => setCampaignName(event.target.value)}
                  type="text"
                  value={campaignName}
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-zinc-200"
                  htmlFor="builder-brief"
                >
                  Campaign brief
                </label>
                <textarea
                  className={`${inputClassName} min-h-24 resize-y py-2`}
                  id="builder-brief"
                  onChange={(event) => setBrief(event.target.value)}
                  value={brief}
                />
              </div>
            </div>
          </section>

          <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-50">
              Audience explanation and filters
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Review the plain-language audience and the validated filters. Only
              supported filters are kept.
            </p>
            <div className="mt-4 space-y-2">
              <label
                className="text-sm font-medium text-zinc-200"
                htmlFor="builder-audience"
              >
                Audience explanation
              </label>
              <textarea
                className={`${inputClassName} min-h-20 resize-y py-2`}
                id="builder-audience"
                onChange={(event) => setAudienceExplanation(event.target.value)}
                value={audienceExplanation}
              />
            </div>

            <div className="mt-4 space-y-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
              <p className="text-sm font-medium text-zinc-200">Validated filters</p>
              {!filtersValid ? (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200">
                  Some suggested filters were unsupported and removed. Review the
                  remaining audience and accept it, or send to all contacts, before
                  saving a campaign draft.
                </p>
              ) : null}
              {hasFilters ? (
                <ul className="flex flex-wrap gap-2">
                  {Object.entries(targetFilters).map(([key, value]) => (
                    <li
                      className="flex max-w-full items-center gap-2 break-words rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-xs font-medium text-indigo-200"
                      key={key}
                    >
                      <span>{formatAudienceFilter(key, value)}</span>
                      <button
                        aria-label={`Remove filter ${key}`}
                        className="rounded text-indigo-300 outline-none transition-colors hover:text-indigo-100 focus-visible:ring-2 focus-visible:ring-indigo-400"
                        onClick={() => removeFilter(key)}
                        type="button"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-500">
                  No targeted filters. Choose &quot;Send to all contacts&quot; below
                  to save a campaign for every contact.
                </p>
              )}
              {!filtersValid && !filtersAcknowledged ? (
                <button
                  className="h-9 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-200 outline-none transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-400"
                  onClick={() => setFiltersAcknowledged(true)}
                  type="button"
                >
                  Accept the remaining audience filters
                </button>
              ) : null}
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900 p-3">
                <input
                  checked={useAllContacts}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-2 focus:ring-indigo-400"
                  onChange={(event) => {
                    setUseAllContacts(event.target.checked);
                    setCampaignError(null);
                  }}
                  type="checkbox"
                />
                <span className="text-xs leading-5 text-zinc-300">
                  Send to all contacts in this workspace (ignore the filters above).
                </span>
              </label>
            </div>
          </section>

          <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-50">Subject ideas</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Edit the ideas, then choose the subject to store with the template draft.
            </p>
            <ul className="mt-4 space-y-2">
              {subjectIdeas.map((subject, index) => {
                const id = `builder-subject-${index}`;
                return (
                  <li key={id}>
                    <div className="flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-950 p-3 sm:flex-row sm:items-center">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        checked={selectedSubject === index}
                        className="mt-0.5 h-4 w-4 border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-2 focus:ring-indigo-400"
                        name="builder-subject"
                        onChange={() => setSelectedSubject(index)}
                        type="radio"
                      />
                        <span className="sr-only">Select subject idea {index + 1}</span>
                        <input
                          aria-label={`Subject idea ${index + 1}`}
                          className={`${inputClassName} h-10 min-w-0`}
                          maxLength={200}
                          onChange={(event) =>
                            updateSubjectIdea(index, event.target.value)
                          }
                          type="text"
                          value={subject}
                        />
                      </label>
                      <button
                        className="h-10 shrink-0 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-200 outline-none transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-400"
                        onClick={() => void copySubjectIdea(index)}
                        type="button"
                      >
                        Copy
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {subjectCopyStatus ? (
              <p aria-live="polite" className="mt-3 text-xs text-zinc-400">
                {subjectCopyStatus}
              </p>
            ) : null}
          </section>

          <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-50">
              Email HTML and preview
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Edit the draft HTML. The preview runs with scripts and browser
              privileges disabled.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label
                    className="text-sm font-medium text-zinc-200"
                    htmlFor="builder-email-html"
                  >
                    HTML content
                  </label>
                  <span className="text-xs text-zinc-600">
                    {emailHtml.length.toLocaleString()} characters
                  </span>
                </div>
                <textarea
                  className={`${inputClassName} min-h-72 resize-y py-2 font-mono`}
                  id="builder-email-html"
                  onChange={(event) => setEmailHtml(event.target.value)}
                  value={emailHtml}
                />
              </div>
              <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
                <div className="border-b border-zinc-800 px-3 py-2">
                  <h3 className="text-sm font-medium text-zinc-200">Safe preview</h3>
                </div>
                {emailHtml.trim() ? (
                  <iframe
                    className="h-72 w-full bg-white"
                    referrerPolicy="no-referrer"
                    sandbox=""
                    srcDoc={emailHtml}
                    title="Campaign email preview"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center p-4 text-center text-sm text-zinc-500">
                    Add HTML content to preview the email.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-50">
              AI personalization context
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Guidance saved on the campaign draft. It shapes tone and intent only —
              it cannot invent facts, offers, URLs, or personal data.
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
              <input
                checked={enablePersonalization}
                className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-2 focus:ring-indigo-400"
                onChange={(event) => setEnablePersonalization(event.target.checked)}
                type="checkbox"
              />
              <span className="text-xs leading-5 text-zinc-300">
                Personalize each recipient email with Gemini at delivery.
              </span>
            </label>
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {AI_CONTEXT_FIELDS.map((field) => {
                const id = `builder-ai-${field.key}`;
                const value = aiContext[field.key] ?? "";
                const limit = CAMPAIGN_AI_CONTEXT_LIMITS[field.key];

                return (
                  <div
                    className={`space-y-2 ${field.multiline ? "lg:col-span-2" : ""}`}
                    key={field.key}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <label
                        className="text-sm font-medium text-zinc-200"
                        htmlFor={id}
                      >
                        {field.label}
                      </label>
                      <span className="text-xs text-zinc-600">
                        {value.length}/{limit}
                      </span>
                    </div>
                    {field.multiline ? (
                      <textarea
                        className={`${inputClassName} min-h-20 resize-y py-2`}
                        id={id}
                        maxLength={limit}
                        onChange={(event) =>
                          updateAiContext(field.key, event.target.value)
                        }
                        value={value}
                      />
                    ) : (
                      <input
                        className={`${inputClassName} h-10`}
                        id={id}
                        maxLength={limit}
                        onChange={(event) =>
                          updateAiContext(field.key, event.target.value)
                        }
                        type="text"
                        value={value}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-50">Schedule notes</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Guidance only. The saved campaign stays a draft — you schedule delivery
              manually from the Campaigns page.
            </p>
            <textarea
              aria-label="Schedule notes"
              className={`${inputClassName} mt-4 min-h-20 resize-y py-2`}
              onChange={(event) => setScheduleNotes(event.target.value)}
              value={scheduleNotes}
            />
          </section>

          <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-50">Save drafts</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Saved campaigns always start as drafts with no schedule. Nothing is
              sent until you schedule it later and the worker runs.
            </p>

            {savedTemplate ? (
              <div
                aria-live="polite"
                className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"
              >
                <p className="font-medium">Template draft saved</p>
                <p className="mt-1 text-emerald-100/90">
                  #{savedTemplate.id} · {savedTemplate.name}
                </p>
                <Link
                  className="mt-2 inline-flex text-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  href="/templates"
                >
                  Open Templates
                </Link>
              </div>
            ) : null}

            {savedCampaign ? (
              <div
                aria-live="polite"
                className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"
              >
                <p className="font-medium">Campaign draft saved</p>
                <p className="mt-1 text-emerald-100/90">
                  #{savedCampaign.id} · {savedCampaign.name}
                </p>
                <div className="mt-2 flex flex-wrap gap-4">
                  <Link
                    className="inline-flex text-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                    href={`/campaigns/${savedCampaign.id}`}
                  >
                    Open campaign
                  </Link>
                  <Link
                    className="inline-flex text-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                    href="/campaigns"
                  >
                    Open Campaigns
                  </Link>
                </div>
              </div>
            ) : null}

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
              <input
                checked={allowCampaignWithoutTemplate}
                className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-2 focus:ring-indigo-400"
                disabled={savedTemplate !== null}
                onChange={(event) => {
                  setAllowCampaignWithoutTemplate(event.target.checked);
                  setCampaignError(null);
                }}
                type="checkbox"
              />
              <span className="text-xs leading-5 text-zinc-300">
                Save the campaign draft without a template. Leave unchecked to link
                the saved template.
              </span>
            </label>

            {templateError ? (
              <p className="mt-3 text-sm text-red-300" role="alert">
                Template: {templateError}
              </p>
            ) : null}
            {campaignError ? (
              <p className="mt-2 text-sm text-red-300" role="alert">
                Campaign: {campaignError}
              </p>
            ) : null}
            {saveSuccess ? (
              <p aria-live="polite" className="mt-2 text-sm text-emerald-300">
                {saveSuccess}
              </p>
            ) : null}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                className="h-10 rounded-md border border-zinc-700 px-4 text-sm font-medium text-zinc-200 outline-none transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
                disabled={isSaving || savedTemplate !== null}
                onClick={() => void handleSaveTemplate()}
                title={
                  savedTemplate !== null
                    ? "Template already saved for this draft"
                    : undefined
                }
                type="button"
              >
                {isSavingTemplate ? "Saving template..." : "Save Template Draft"}
              </button>
              <button
                className="h-10 rounded-md border border-zinc-700 px-4 text-sm font-medium text-zinc-200 outline-none transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
                disabled={isSaving || savedCampaign !== null}
                onClick={() => void handleSaveCampaign()}
                type="button"
              >
                {isSavingCampaign ? "Saving campaign..." : "Save Campaign Draft"}
              </button>
              <button
                className="h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                disabled={isSaving || savedCampaign !== null}
                onClick={() => void handleSaveBoth()}
                type="button"
              >
                {isSavingBoth
                  ? "Saving drafts..."
                  : savedTemplate
                    ? "Save Campaign with saved template"
                    : "Save Template + Campaign Draft"}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
