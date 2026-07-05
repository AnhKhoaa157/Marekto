import assert from "node:assert/strict";
import test from "node:test";

import {
  getCachedAiOutput,
  hashAiInput,
  saveAiOutput,
} from "../src/lib/ai/cache.ts";
import { EMAIL_LOG_ID, USER_ID, WORKSPACE_ID } from "./test-ids.mjs";

function createDate() {
  return new Date("2026-06-30T00:00:00.000Z");
}

test("hashes normalized AI input deterministically", () => {
  const hash = hashAiInput("  VIP customers in HCM  ");

  assert.equal(hash.length, 64);
  assert.equal(hash, hashAiInput("VIP customers in HCM"));
  assert.throws(() => hashAiInput("   "), /AI input is required/);
});

test("reads cached AI output inside the requested workspace", async () => {
  const expectedHash = hashAiInput("VIP customers in HCM");
  const calls = [];
  const workspaceRunner = async (workspaceId, callback) => {
    calls.push({ workspaceId });

    return callback({
      query: async (text, params) => {
        calls.push({ text, params });

        return {
          rows: [
            {
              id: EMAIL_LOG_ID,
              workspace_id: workspaceId,
              feature: "segmentation",
              input_hash: expectedHash,
              input_text: "VIP customers in HCM",
              output_json: { city: "HCM", tags_contains: "VIP" },
              provider: "gemini",
              model: "gemini-2.5-flash",
              status: "generated",
              created_by: USER_ID,
              created_at: createDate(),
              updated_at: createDate(),
            },
          ],
        };
      },
    });
  };

  const cached = await getCachedAiOutput(WORKSPACE_ID, "segmentation", " VIP customers in HCM ", {
    workspaceRunner,
  });

  assert.equal(calls[0].workspaceId, WORKSPACE_ID);
  assert.match(calls[1].text, /FROM "Ai_outputs"/);
  assert.deepEqual(calls[1].params, [WORKSPACE_ID, "segmentation", expectedHash]);
  assert.deepEqual(cached?.outputJson, { city: "HCM", tags_contains: "VIP" });
  assert.equal(cached?.workspaceId, WORKSPACE_ID);
});

test("returns null when no cached AI output exists", async () => {
  const workspaceRunner = async (_workspaceId, callback) =>
    callback({
      query: async () => ({ rows: [] }),
    });

  const cached = await getCachedAiOutput(WORKSPACE_ID, "segmentation", "No cache", {
    workspaceRunner,
  });

  assert.equal(cached, null);
});

test("upserts cached AI output with parameterized JSONB payloads", async () => {
  const expectedHash = hashAiInput("VIP customers in HCM");
  const calls = [];
  const workspaceRunner = async (workspaceId, callback) => {
    calls.push({ workspaceId });

    return callback({
      query: async (text, params) => {
        calls.push({ text, params });

        return {
          rows: [
            {
              id: EMAIL_LOG_ID,
              workspace_id: workspaceId,
              feature: params[1],
              input_hash: params[2],
              input_text: params[3],
              output_json: JSON.parse(params[4]),
              provider: params[5],
              model: params[6],
              status: params[7],
              created_by: params[8],
              created_at: createDate(),
              updated_at: createDate(),
            },
          ],
        };
      },
    });
  };

  const cached = await saveAiOutput(
    {
      workspaceId: WORKSPACE_ID,
      feature: "segmentation",
      inputText: " VIP customers in HCM ",
      outputJson: { city: "HCM" },
      provider: "gemini",
      model: "gemini-2.5-flash",
      createdBy: USER_ID,
    },
    { workspaceRunner },
  );

  assert.equal(calls[0].workspaceId, WORKSPACE_ID);
  assert.match(calls[1].text, /ON CONFLICT/);
  assert.deepEqual(calls[1].params, [
    WORKSPACE_ID,
    "segmentation",
    expectedHash,
    "VIP customers in HCM",
    '{"city":"HCM"}',
    "gemini",
    "gemini-2.5-flash",
    "generated",
    USER_ID,
  ]);
  assert.deepEqual(cached.outputJson, { city: "HCM" });
});

test("rejects invalid cache input before querying", async () => {
  const workspaceRunner = async () => {
    throw new Error("workspace runner should not be called");
  };

  await assert.rejects(
    getCachedAiOutput("bad", "segmentation", "VIP", { workspaceRunner }),
    /workspaceId must be a UUID/,
  );
  await assert.rejects(
    getCachedAiOutput(WORKSPACE_ID, "unsupported", "VIP", { workspaceRunner }),
    /Unsupported AI output feature/,
  );
  await assert.rejects(
    saveAiOutput(
      {
        workspaceId: WORKSPACE_ID,
        feature: "segmentation",
        inputText: "VIP",
        outputJson: undefined,
        provider: "gemini",
        model: "gemini-2.5-flash",
      },
      { workspaceRunner },
    ),
    /AI output must be JSON serializable/,
  );
});
