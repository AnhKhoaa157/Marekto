import assert from "node:assert/strict";
import test from "node:test";

import { buildAdminHealthConfig } from "../src/lib/admin-health.ts";

const FULL_ENV = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://user:secret@db.internal:5432/app",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "mailer",
  SMTP_PASSWORD: "hunter2",
  SMTP_FROM: "noreply@example.com",
  GEMINI_API_KEY: "AIzaExampleKey0000000000000000000000000",
  CRON_SECRET: "a-very-long-cron-secret-value",
};

test("reports every integration as configured when env is complete", () => {
  const config = buildAdminHealthConfig(FULL_ENV);

  assert.deepEqual(config, {
    database: { configured: true },
    smtp: { configured: true },
    gemini: { configured: true },
    cron: { configured: true },
    environment: { node_env: "production", is_production: true },
  });
});

test("reports unconfigured integrations without leaking values", () => {
  const config = buildAdminHealthConfig({ NODE_ENV: "development" });

  assert.equal(config.database.configured, false);
  assert.equal(config.smtp.configured, false);
  assert.equal(config.gemini.configured, false);
  assert.equal(config.cron.configured, false);
  assert.equal(config.environment.is_production, false);
  assert.equal(config.environment.node_env, "development");
});

test("partial SMTP configuration is not reported as configured", () => {
  const config = buildAdminHealthConfig({
    ...FULL_ENV,
    SMTP_PASSWORD: "",
  });

  assert.equal(config.smtp.configured, false);
});

test("health config never contains any secret VALUE", () => {
  const serialized = JSON.stringify(buildAdminHealthConfig(FULL_ENV));

  assert.doesNotMatch(serialized, /secret/);
  assert.doesNotMatch(serialized, /hunter2/);
  assert.doesNotMatch(serialized, /AIzaExampleKey/);
  assert.doesNotMatch(serialized, /db\.internal/);
});
