export const PENDING_STATUS = "pending";
export const PROCESSING_STATUS = "processing";
export const FAILED_STATUS = "failed";
export const CLAIM_LEASE_MINUTES = 15;

export const CLAIM_CAMPAIGN_SQL =
  'UPDATE "Campaigns" campaign SET status = $2, processing_started_at = NOW(), ' +
  "failure_reason = NULL, updated_at = NOW() " +
  "WHERE campaign.id = (" +
  'SELECT candidate.id FROM "Campaigns" candidate ' +
  "WHERE candidate.workspace_id = $1 AND (" +
  "(candidate.status = $3 AND candidate.run_at IS NOT NULL AND candidate.run_at <= NOW()) " +
  "OR (candidate.status = $2 AND candidate.processing_started_at < NOW() - ($4 * INTERVAL '1 minute'))" +
  ") ORDER BY candidate.run_at ASC NULLS LAST, candidate.id ASC " +
  "FOR UPDATE SKIP LOCKED LIMIT 1" +
  ") AND campaign.workspace_id = $1 " +
  "RETURNING campaign.id, campaign.workspace_id, campaign.template_id, campaign.target_filters";
