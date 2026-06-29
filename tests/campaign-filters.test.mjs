import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContactSelection,
  parseCampaignTargetFilters,
} from "../src/lib/campaign-filters.ts";

test("builds parameterized JSONB equality filters", () => {
  const filters = parseCampaignTargetFilters({ city: "HCM" });
  const selection = buildContactSelection(7, filters);

  assert.match(selection.text, /properties->\$2 = \$3::jsonb/);
  assert.deepEqual(selection.params, [7, "city", '"HCM"']);
});

test("builds numeric lead-score comparisons", () => {
  const filters = parseCampaignTargetFilters({ lead_score_gt: 80 });
  const selection = buildContactSelection(3, filters);

  assert.match(selection.text, /jsonb_typeof\(properties->\$2\)/);
  assert.match(selection.text, /> \$3/);
  assert.deepEqual(selection.params, [3, "lead_score", 80]);
});

test("builds tag containment without interpolating the tag", () => {
  const filters = parseCampaignTargetFilters({ tags_contains: "VIP" });
  const selection = buildContactSelection(5, filters);

  assert.match(selection.text, /ARRAY\[\$2\]::text\[\]/);
  assert.doesNotMatch(selection.text, /VIP/);
  assert.deepEqual(selection.params, [5, "VIP"]);
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
