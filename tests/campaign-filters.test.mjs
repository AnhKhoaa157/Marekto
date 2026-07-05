import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContactSelection,
  parseCampaignTargetFilters,
} from "../src/lib/campaign-filters.ts";
import { WORKSPACE_ID } from "./test-ids.mjs";

test("builds parameterized JSONB equality filters", () => {
  const filters = parseCampaignTargetFilters({ city: "HCM" });
  const selection = buildContactSelection(WORKSPACE_ID, filters);

  assert.match(selection.text, /properties->\$2 = \$3::jsonb/);
  assert.deepEqual(selection.params, [WORKSPACE_ID, "city", '"HCM"']);
});

test("builds numeric lead-score comparisons", () => {
  const filters = parseCampaignTargetFilters({ lead_score_gt: 80 });
  const selection = buildContactSelection(WORKSPACE_ID, filters);

  assert.match(selection.text, /jsonb_typeof\(properties->\$2\)/);
  assert.match(selection.text, /> \$3/);
  assert.deepEqual(selection.params, [WORKSPACE_ID, "lead_score", 80]);
});

test("builds tag containment without interpolating the tag", () => {
  const filters = parseCampaignTargetFilters({ tags_contains: "VIP" });
  const selection = buildContactSelection(WORKSPACE_ID, filters);

  assert.match(selection.text, /ARRAY\[\$2\]::text\[\]/);
  assert.doesNotMatch(selection.text, /VIP/);
  assert.deepEqual(selection.params, [WORKSPACE_ID, "VIP"]);
});

test("rejects unsupported nested values and operators", () => {
  assert.throws(
    () => parseCampaignTargetFilters({ city: { value: "HCM" } }),
    /Unsupported filter value/,
  );
  assert.throws(
    () => parseCampaignTargetFilters({ city_contains: "HCM" }),
    /Unsupported filter operator/,
  );
});
