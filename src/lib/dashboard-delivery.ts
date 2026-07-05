export const SELECT_EMAIL_DELIVERY_METRICS_SQL =
  "SELECT " +
  "COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count, " +
  "COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count " +
  'FROM "Email_logs" WHERE workspace_id = $1';

export const SELECT_RECENT_DELIVERY_FAILURES_SQL =
  "SELECT log.campaign_id, campaign.name AS campaign_name, " +
  "COUNT(*)::int AS failed_count, MAX(log.sent_at) AS last_failed_at " +
  'FROM "Email_logs" log ' +
  'INNER JOIN "Campaigns" campaign ' +
  "ON campaign.id = log.campaign_id AND campaign.workspace_id = log.workspace_id " +
  "WHERE log.workspace_id = $1 AND log.status = 'failed' " +
  "GROUP BY log.campaign_id, campaign.name " +
  "ORDER BY last_failed_at DESC NULLS LAST, log.campaign_id DESC LIMIT 5";

export type EmailDeliveryMetricsRow = {
  sent_count: number;
  failed_count: number;
};

export type RecentDeliveryFailureRow = {
  campaign_id: string;
  campaign_name: string;
  failed_count: number;
  last_failed_at: Date | string | null;
};

export function toEmailDeliveryMetrics(
  row: EmailDeliveryMetricsRow | undefined,
): { sentEmails: number; failedEmails: number } {
  return {
    sentEmails: row?.sent_count ?? 0,
    failedEmails: row?.failed_count ?? 0,
  };
}
