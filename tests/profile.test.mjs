import assert from "node:assert/strict";
import test from "node:test";

import {
  isProfileValidationError,
  parseProfileUpdateBody,
} from "../src/lib/profile.ts";

test("parses profile update fields", () => {
  assert.deepEqual(
    parseProfileUpdateBody({
      first_name: "  Khoa ",
      last_name: "",
      phone: " 0909000000 ",
    }),
    {
      firstName: "Khoa",
      lastName: null,
      phone: "0909000000",
    },
  );
});

test("rejects invalid profile payloads", () => {
  assert.throws(() => parseProfileUpdateBody(null), /JSON object/);
  assert.throws(
    () => parseProfileUpdateBody({ first_name: 123 }),
    /must be strings/,
  );
  assert.throws(
    () => parseProfileUpdateBody({ phone: "1".repeat(41) }),
    /phone is too long/,
  );
});

test("identifies profile validation errors", () => {
  assert.equal(isProfileValidationError("Profile fields must be strings"), true);
  assert.equal(isProfileValidationError("Unexpected database failure"), false);
});
