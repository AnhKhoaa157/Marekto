import assert from "node:assert/strict";
import test from "node:test";

import {
  getEmailLogErrorCategoryLabel,
  getEmailLogPersonalizationLabel,
  sanitizeEmailLogDiagnostic,
} from "../src/lib/email-log-display.ts";

test("describes AI personalization and template fallback truthfully", () => {
  assert.equal(
    getEmailLogPersonalizationLabel({
      status: "sent",
      personalization_source: "gemini",
      personalization_error: null,
    }),
    "Personalized with AI",
  );
  assert.equal(
    getEmailLogPersonalizationLabel({
      status: "sent",
      personalization_source: "template",
      personalization_error: "Provider unavailable",
    }),
    "AI unavailable; original template used",
  );
  assert.equal(
    getEmailLogPersonalizationLabel({
      status: "sent",
      personalization_source: "template",
      personalization_error: null,
    }),
    "Sent with original template",
  );
  assert.equal(
    getEmailLogPersonalizationLabel({
      status: "failed",
      personalization_source: "template",
      personalization_error: null,
    }),
    "Original template used",
  );
});

test("maps error categories to user-facing diagnostic labels", () => {
  assert.equal(getEmailLogErrorCategoryLabel("ai_fallback"), "AI fallback");
  assert.equal(getEmailLogErrorCategoryLabel("smtp_failure"), "SMTP delivery");
  assert.equal(getEmailLogErrorCategoryLabel("none"), "No delivery error");
});

test("redacts credentials, tokens, API keys, and stack traces", () => {
  const diagnostic = sanitizeEmailLogDiagnostic(
    "Error: SMTP failed password=mail-pass token=token-value " +
      "Bearer bearer-value " +
      "https://mailer:secret@smtp.example.test " +
      "AIza123456789012345678901234567890\n" +
      "    at sendMail (mailer.ts:20:3)",
  );

  assert.ok(diagnostic);
  assert.equal(diagnostic.includes("mail-pass"), false);
  assert.equal(diagnostic.includes("token-value"), false);
  assert.equal(diagnostic.includes("bearer-value"), false);
  assert.equal(diagnostic.includes("mailer:secret"), false);
  assert.equal(diagnostic.includes("AIza123456789012345678901234567890"), false);
  assert.equal(diagnostic.includes("sendMail"), false);
  assert.match(diagnostic, /\[REDACTED\]/);
});

test("returns null for missing diagnostics and bounds displayed text", () => {
  assert.equal(sanitizeEmailLogDiagnostic(null), null);
  assert.equal(sanitizeEmailLogDiagnostic("   "), null);
  assert.equal(sanitizeEmailLogDiagnostic("x".repeat(900))?.length, 600);
});
