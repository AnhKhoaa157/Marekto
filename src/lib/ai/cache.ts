import { createHash } from "node:crypto";

import type { PoolClient, QueryResultRow } from "pg";

const AI_OUTPUT_FEATURES = [
  "segmentation",
  "lead_scoring",
  "email_personalization",
] as const;
const AI_OUTPUT_STATUSES = ["generated", "approved", "stale"] as const;
const SELECT_AI_OUTPUT_SQL =
  'SELECT id, workspace_id, feature, input_hash, input_text, output_json, provider, model, status, created_by, created_at, updated_at ' +
  'FROM "Ai_outputs" ' +
  "WHERE workspace_id = $1 AND feature = $2 AND input_hash = $3 AND status <> 'stale' " +
  "LIMIT 1";
const UPSERT_AI_OUTPUT_SQL =
  'INSERT INTO "Ai_outputs" ' +
  "(workspace_id, feature, input_hash, input_text, output_json, provider, model, status, created_by) " +
  "VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) " +
  "ON CONFLICT (workspace_id, feature, input_hash) DO UPDATE SET " +
  "input_text = EXCLUDED.input_text, " +
  "output_json = EXCLUDED.output_json, " +
  "provider = EXCLUDED.provider, " +
  "model = EXCLUDED.model, " +
  "status = EXCLUDED.status, " +
  "created_by = EXCLUDED.created_by, " +
  "updated_at = CURRENT_TIMESTAMP " +
  "RETURNING id, workspace_id, feature, input_hash, input_text, output_json, provider, model, status, created_by, created_at, updated_at";

export type AiOutputFeature = (typeof AI_OUTPUT_FEATURES)[number];
export type AiOutputStatus = (typeof AI_OUTPUT_STATUSES)[number];

type AiOutputRow = QueryResultRow & {
  id: number;
  workspace_id: number;
  feature: AiOutputFeature;
  input_hash: string;
  input_text: string;
  output_json: unknown;
  provider: string;
  model: string;
  status: AiOutputStatus;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
};

export type CachedAiOutput = {
  id: number;
  workspaceId: number;
  feature: AiOutputFeature;
  inputHash: string;
  inputText: string;
  outputJson: unknown;
  provider: string;
  model: string;
  status: AiOutputStatus;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SaveAiOutputInput = {
  workspaceId: number;
  feature: AiOutputFeature;
  inputText: string;
  outputJson: unknown;
  provider: string;
  model: string;
  status?: AiOutputStatus;
  createdBy?: number | null;
};

type QueryClient = Pick<PoolClient, "query">;
type WorkspaceRunner = <T>(
  workspaceId: number,
  callback: (client: QueryClient) => Promise<T>,
) => Promise<T>;

type AiCacheDependencies = {
  workspaceRunner?: WorkspaceRunner;
};

async function runWithDefaultWorkspace<T>(
  workspaceId: number,
  callback: (client: QueryClient) => Promise<T>,
): Promise<T> {
  const { withWorkspace } = await import("../db.ts");

  return withWorkspace(workspaceId, callback);
}

function isAiOutputFeature(value: string): value is AiOutputFeature {
  return AI_OUTPUT_FEATURES.includes(value as AiOutputFeature);
}

function isAiOutputStatus(value: string): value is AiOutputStatus {
  return AI_OUTPUT_STATUSES.includes(value as AiOutputStatus);
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function normalizeRequiredText(name: string, value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${name} is required`);
  }

  return normalized;
}

function serializeOutputJson(value: unknown): string {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new Error("AI output must be JSON serializable");
  }

  return serialized;
}

function parseAiOutputRow(row: AiOutputRow): CachedAiOutput {
  if (!isAiOutputFeature(row.feature)) {
    throw new Error(`Unsupported AI output feature: ${row.feature}`);
  }

  if (!isAiOutputStatus(row.status)) {
    throw new Error(`Unsupported AI output status: ${row.status}`);
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    feature: row.feature,
    inputHash: row.input_hash,
    inputText: row.input_text,
    outputJson: row.output_json,
    provider: row.provider,
    model: row.model,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function hashAiInput(inputText: string): string {
  const normalizedInput = normalizeRequiredText("AI input", inputText);

  return createHash("sha256").update(normalizedInput, "utf8").digest("hex");
}

export async function getCachedAiOutput(
  workspaceId: number,
  feature: AiOutputFeature,
  inputText: string,
  dependencies: AiCacheDependencies = {},
): Promise<CachedAiOutput | null> {
  assertPositiveInteger("workspaceId", workspaceId);

  if (!isAiOutputFeature(feature)) {
    throw new Error(`Unsupported AI output feature: ${feature}`);
  }

  const normalizedInput = normalizeRequiredText("AI input", inputText);
  const inputHash = hashAiInput(normalizedInput);
  const workspaceRunner = dependencies.workspaceRunner ?? runWithDefaultWorkspace;

  return workspaceRunner(workspaceId, async (client) => {
    const result = await client.query<AiOutputRow>(SELECT_AI_OUTPUT_SQL, [
      workspaceId,
      feature,
      inputHash,
    ]);

    return result.rows[0] ? parseAiOutputRow(result.rows[0]) : null;
  });
}

export async function saveAiOutput(
  input: SaveAiOutputInput,
  dependencies: AiCacheDependencies = {},
): Promise<CachedAiOutput> {
  assertPositiveInteger("workspaceId", input.workspaceId);

  if (!isAiOutputFeature(input.feature)) {
    throw new Error(`Unsupported AI output feature: ${input.feature}`);
  }

  const normalizedInput = normalizeRequiredText("AI input", input.inputText);
  const provider = normalizeRequiredText("AI provider", input.provider);
  const model = normalizeRequiredText("AI model", input.model);
  const status = input.status ?? "generated";
  const createdBy = input.createdBy ?? null;

  if (!isAiOutputStatus(status)) {
    throw new Error(`Unsupported AI output status: ${status}`);
  }

  if (createdBy !== null) {
    assertPositiveInteger("createdBy", createdBy);
  }

  const inputHash = hashAiInput(normalizedInput);
  const outputJson = serializeOutputJson(input.outputJson);
  const workspaceRunner = dependencies.workspaceRunner ?? runWithDefaultWorkspace;

  return workspaceRunner(input.workspaceId, async (client) => {
    const result = await client.query<AiOutputRow>(UPSERT_AI_OUTPUT_SQL, [
      input.workspaceId,
      input.feature,
      inputHash,
      normalizedInput,
      outputJson,
      provider,
      model,
      status,
      createdBy,
    ]);

    const row = result.rows[0];

    if (!row) {
      throw new Error("AI output cache write did not return a row");
    }

    return parseAiOutputRow(row);
  });
}
