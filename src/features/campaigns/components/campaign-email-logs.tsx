"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";

import { CampaignDetailSkeleton } from "@/features/campaigns/components/campaign-detail-skeleton";
import { ResourceEmpty, ResourceError } from "@/components/shared/resource-states";
import {
  ApiRequestError,
  formatApiDate,
  isRecord,
  requestApi,
} from "@/lib/client-api";
import { parseCampaignAiContext } from "@/lib/campaign-ai-context";
import {
  getEmailLogErrorCategoryLabel,
  getEmailLogPersonalizationLabel,
  sanitizeEmailLogDiagnostic,
} from "@/lib/email-log-display";
import type {
  CampaignDeliveryCampaign,
  CampaignDeliverySummary,
  CampaignEmailLogItem,
  CampaignEmailLogsData,
  EmailLogErrorCategory,
  EmailLogStatus,
  EmailPersonalizationSource,
} from "@/lib/email-logs";

type CampaignEmailLogsProps = {
  campaignId: number;
};

function parseNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`The campaign response contains an invalid ${label}.`);
  }

  return value;
}

function parseCount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`The delivery summary contains an invalid ${label}.`);
  }

  return value;
}

function parseEmailLogStatus(value: unknown): EmailLogStatus {
  if (value === "sent" || value === "failed") {
    return value;
  }

  throw new Error("The email log response contains an invalid status.");
}

function parsePersonalizationSource(value: unknown): EmailPersonalizationSource | null {
  if (value === null || value === "gemini" || value === "template") {
    return value;
  }

  throw new Error("The email log response contains an invalid personalization source.");
}

function parseErrorCategory(value: unknown): EmailLogErrorCategory {
  if (
    value === "none" ||
    value === "ai_fallback" ||
    value === "smtp_failure" ||
    value === "smtp_unconfigured" ||
    value === "template_missing" ||
    value === "no_recipients" ||
    value === "unknown"
  ) {
    return value;
  }

  throw new Error("The email log response contains an invalid error category.");
}

function parseCampaign(value: unknown): CampaignDeliveryCampaign {
  if (
    !isRecord(value) ||
    typeof value.id !== "number" ||
    typeof value.name !== "string" ||
    typeof value.status !== "string" ||
    typeof value.ai_personalization_enabled !== "boolean"
  ) {
    throw new Error("The campaign response has an invalid shape.");
  }

  return {
    id: value.id,
    name: value.name,
    status: value.status,
    failure_reason: parseNullableString(value.failure_reason, "failure reason"),
    ai_personalization_enabled: value.ai_personalization_enabled,
    ai_context: parseCampaignAiContext(value.ai_context),
    scheduled_at: parseNullableString(value.scheduled_at, "scheduled time"),
    run_at: parseNullableString(value.run_at, "run time"),
  };
}

function parseSummary(value: unknown): CampaignDeliverySummary {
  if (!isRecord(value)) {
    throw new Error("The delivery summary has an invalid shape.");
  }

  return {
    total_recipients: parseCount(value.total_recipients, "recipient count"),
    sent_count: parseCount(value.sent_count, "sent count"),
    failed_count: parseCount(value.failed_count, "failed count"),
    gemini_personalized_count: parseCount(
      value.gemini_personalized_count,
      "Gemini count",
    ),
    template_sent_count: parseCount(value.template_sent_count, "template count"),
    ai_fallback_count: parseCount(value.ai_fallback_count, "AI fallback count"),
    first_sent_at: parseNullableString(value.first_sent_at, "first sent time"),
    last_sent_at: parseNullableString(value.last_sent_at, "last sent time"),
  };
}

function parseLog(value: unknown): CampaignEmailLogItem {
  if (
    !isRecord(value) ||
    typeof value.id !== "number" ||
    (value.contact_id !== null && typeof value.contact_id !== "number")
  ) {
    throw new Error("The email log response has an invalid shape.");
  }

  return {
    id: value.id,
    contact_id: value.contact_id,
    recipient_email: parseNullableString(value.recipient_email, "recipient email"),
    recipient_first_name: parseNullableString(
      value.recipient_first_name,
      "recipient first name",
    ),
    recipient_last_name: parseNullableString(
      value.recipient_last_name,
      "recipient last name",
    ),
    status: parseEmailLogStatus(value.status),
    error_message: parseNullableString(value.error_message, "error message"),
    error_category: parseErrorCategory(value.error_category),
    personalization_source: parsePersonalizationSource(value.personalization_source),
    personalization_error: parseNullableString(
      value.personalization_error,
      "personalization error",
    ),
    sent_at: parseNullableString(value.sent_at, "sent time"),
  };
}

function parseCampaignEmailLogs(value: unknown): CampaignEmailLogsData {
  if (!isRecord(value) || !Array.isArray(value.logs)) {
    throw new Error("The campaign delivery response has an invalid shape.");
  }

  return {
    campaign: parseCampaign(value.campaign),
    summary: parseSummary(value.summary),
    logs: value.logs.map(parseLog),
  };
}

function statusClassName(status: string): string {
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

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function errorCategoryClassName(log: CampaignEmailLogItem): string {
  if (log.status === "failed") {
    return "border-red-500/30 bg-red-500/10 text-red-300";
  }

  if (log.error_category === "ai_fallback") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  }

  return "border-zinc-700 bg-zinc-800 text-zinc-300";
}

function personalizationClassName(log: CampaignEmailLogItem): string {
  if (log.personalization_source === "gemini") {
    return "text-indigo-300";
  }

  if (log.personalization_error) {
    return "text-amber-300";
  }

  return "text-zinc-300";
}

function recipientLabel(log: CampaignEmailLogItem): string {
  const fullName = [log.recipient_first_name, log.recipient_last_name]
    .filter(Boolean)
    .join(" ");

  return fullName || log.recipient_email || "Deleted contact";
}

function SummaryCard({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <article className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-50">{value}</p>
    </article>
  );
}

export function CampaignEmailLogs({ campaignId }: Readonly<CampaignEmailLogsProps>) {
  const router = useRouter();
  const [data, setData] = useState<CampaignEmailLogsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  const loadCampaign = useCallback(
    async (signal?: AbortSignal, refresh = false) => {
      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      setError(null);

      try {
        const nextData = await requestApi(
          `/api/campaigns/${campaignId}/email-logs`,
          { method: "GET", signal },
          parseCampaignEmailLogs,
        );
        setData(nextData);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }

        if (loadError instanceof ApiRequestError && loadError.status === 401) {
          router.push("/login");
          router.refresh();
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load campaign delivery data.",
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [campaignId, router],
  );

  useEffect(() => {
    const controller = new AbortController();

    void requestApi(
      `/api/campaigns/${campaignId}/email-logs`,
      { method: "GET", signal: controller.signal },
      parseCampaignEmailLogs,
    )
      .then((nextData) => {
        setData(nextData);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }

        if (loadError instanceof ApiRequestError && loadError.status === 401) {
          router.push("/login");
          router.refresh();
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load campaign delivery data.",
        );
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [campaignId, router]);

  if (isLoading && !data) {
    return <CampaignDetailSkeleton showBackLink={false} />;
  }

  if (error && !data) {
    return <ResourceError message={error} onRetry={() => void loadCampaign()} />;
  }

  if (!data) {
    return null;
  }

  const schedule = data.campaign.run_at ?? data.campaign.scheduled_at;
  const aiContextEntries = Object.entries(data.campaign.ai_context);

  return (
    <div className="min-w-0 space-y-6">
      {error ? <ResourceError message={error} onRetry={() => void loadCampaign()} /> : null}

      <article className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="break-words text-2xl font-semibold tracking-tight text-zinc-50">
                {data.campaign.name}
              </h2>
              <span
                className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${statusClassName(data.campaign.status)}`}
              >
                {statusLabel(data.campaign.status)}
              </span>
            </div>
            <p className="mt-2 text-sm text-zinc-400">
              Delivery activity and campaign configuration from this workspace.
            </p>
          </div>
          <button
            className="h-9 self-start rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-200 outline-none transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:text-zinc-500"
            disabled={isRefreshing}
            onClick={() => void loadCampaign(undefined, true)}
            type="button"
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {data.campaign.failure_reason ? (
          <div className="mt-5 rounded-md border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm font-medium text-red-200">Campaign failure</p>
            <p className="mt-1 break-words text-sm text-red-100/80">
              {sanitizeEmailLogDiagnostic(data.campaign.failure_reason)}
            </p>
          </div>
        ) : null}

        <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Delivery time
            </dt>
            <dd className="mt-1 text-sm font-medium text-zinc-200">
              {schedule ? formatApiDate(schedule) : "Not scheduled"}
            </dd>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              AI personalization
            </dt>
            <dd className="mt-1 text-sm font-medium text-zinc-200">
              {data.campaign.ai_personalization_enabled ? "Enabled" : "Disabled"}
            </dd>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              First sent
            </dt>
            <dd className="mt-1 text-sm font-medium text-zinc-200">
              {data.summary.first_sent_at
                ? formatApiDate(data.summary.first_sent_at)
                : "No sends yet"}
            </dd>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Last sent
            </dt>
            <dd className="mt-1 text-sm font-medium text-zinc-200">
              {data.summary.last_sent_at
                ? formatApiDate(data.summary.last_sent_at)
                : "No sends yet"}
            </dd>
          </div>
        </dl>

        {aiContextEntries.length > 0 ? (
          <section className="mt-5 rounded-md border border-indigo-500/20 bg-indigo-500/5 p-4">
            <h3 className="text-sm font-semibold text-indigo-100">
              AI campaign guidance
            </h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Writing guidance only; template links, contact facts, and compliance
              content remain authoritative.
            </p>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {aiContextEntries.map(([key, value]) => (
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3" key={key}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {key.replaceAll("_", " ")}
                  </dt>
                  <dd className="mt-1 break-words text-sm text-zinc-200">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </article>

      <section aria-label="Delivery summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard label="Recipients" value={data.summary.total_recipients} />
        <SummaryCard label="Sent" value={data.summary.sent_count} />
        <SummaryCard label="Failed" value={data.summary.failed_count} />
        <SummaryCard label="Gemini personalized" value={data.summary.gemini_personalized_count} />
        <SummaryCard label="Template sent" value={data.summary.template_sent_count} />
        <SummaryCard label="AI fallback" value={data.summary.ai_fallback_count} />
      </section>

      <section className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm sm:p-6">
        <div>
          <h3 className="text-lg font-semibold text-zinc-50">Recent delivery activity</h3>
          <p className="mt-1 text-sm text-zinc-400">
            Recipient outcomes recorded by the campaign worker.
          </p>
        </div>

        {data.logs.length === 0 ? (
          <div className="mt-4">
            <ResourceEmpty
              description="Delivery activity will appear after the campaign worker records recipient outcomes."
              title="No delivery logs yet"
            />
          </div>
        ) : (
          <div className="marekto-scrollbar mt-4 overflow-x-auto rounded-md border border-zinc-800">
            <table className="w-full min-w-full text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-950 text-xs font-medium uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Personalization source</th>
                  <th className="px-4 py-3">Error category</th>
                  <th className="px-4 py-3">Sent / logged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {data.logs.map((log) => {
                  const recipient = recipientLabel(log);
                  const deliveryDiagnostic = sanitizeEmailLogDiagnostic(
                    log.error_message,
                  );
                  const personalizationDiagnostic = sanitizeEmailLogDiagnostic(
                    log.personalization_error,
                  );
                  const hasDiagnostics = Boolean(
                    deliveryDiagnostic || personalizationDiagnostic,
                  );
                  const isExpanded = expandedLogId === log.id;
                  const detailsId = `email-log-details-${log.id}`;

                  return (
                    <Fragment key={log.id}>
                      <tr className={log.status === "failed" ? "bg-red-500/5" : undefined}>
                        <td className="min-w-48 px-4 py-4 align-top">
                          <p className="font-medium text-zinc-100">{recipient}</p>
                          {log.recipient_email && log.recipient_email !== recipient ? (
                            <p className="mt-1 text-sm text-zinc-500">
                              {log.recipient_email}
                            </p>
                          ) : null}
                          {hasDiagnostics ? (
                            <button
                              aria-controls={detailsId}
                              aria-expanded={isExpanded}
                              className="mt-2 text-xs font-medium text-indigo-300 outline-none transition-colors hover:text-indigo-200 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-indigo-400"
                              onClick={() =>
                                setExpandedLogId(isExpanded ? null : log.id)
                              }
                              type="button"
                            >
                              {isExpanded ? "Hide details" : "View details"}
                            </button>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 align-top">
                          <span
                            aria-label={`Delivery status: ${statusLabel(log.status)}`}
                            className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${statusClassName(log.status)}`}
                          >
                            {statusLabel(log.status)}
                          </span>
                        </td>
                        <td className="min-w-56 px-4 py-4 align-top">
                          <p className={`text-sm font-medium ${personalizationClassName(log)}`}>
                            {getEmailLogPersonalizationLabel(log)}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 align-top">
                          <span
                            className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${errorCategoryClassName(log)}`}
                          >
                            {getEmailLogErrorCategoryLabel(log.error_category)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 align-top text-zinc-400">
                          <time dateTime={log.sent_at ?? undefined}>
                            {log.sent_at
                              ? formatApiDate(log.sent_at)
                              : "Time unavailable"}
                          </time>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr id={detailsId}>
                          <td className="bg-zinc-950 px-4 py-4" colSpan={5}>
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                              {deliveryDiagnostic ? (
                                <div>
                                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                    Delivery diagnostic
                                  </p>
                                  <p className="mt-2 break-words text-sm text-zinc-300">
                                    {deliveryDiagnostic}
                                  </p>
                                </div>
                              ) : null}
                              {personalizationDiagnostic ? (
                                <div>
                                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                    AI fallback context
                                  </p>
                                  <p className="mt-2 break-words text-sm text-amber-200">
                                    {personalizationDiagnostic}
                                  </p>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
