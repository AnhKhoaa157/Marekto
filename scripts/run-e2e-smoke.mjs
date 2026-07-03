#!/usr/bin/env node
// Controlled end-to-end MVP smoke path (Phase 13.4).
//
// Exercises the real product path against a REAL, disposable PostgreSQL test
// database and a REAL Nodemailer SMTP transport:
//
//   provision tenant -> sign JWT -> verify through the real proxy auth
//   -> create tenant contacts -> generate a Campaign Builder package
//   -> map through the real builder->draft contract -> save Template + Campaign
//      drafts as real tenant records -> schedule the campaign
//   -> gate the run with the real cron authorization -> claim with the real
//      atomic claim SQL -> personalize (or safe fallback) -> deliver over a real
//      SMTP transport to a local capture sink -> write recipient Email_logs
//   -> verify status + logs with the SAME SQL/transform the email-logs route uses.
//
// Fidelity note: the HTTP route handlers import "next/server", which only
// resolves inside the Next bundler, so this orchestrator composes the exact
// same exported libraries, SQL constants, and transforms those routes use. It
// does not re-implement business logic; it drives the real modules directly.
//
// Provider honesty:
//   * Default (controlled) mode uses a deterministic in-process Gemini double
//     and a local SMTP capture server. The SMTP transport/protocol is REAL;
//     only the provider endpoints are test doubles ("controlled-provider
//     evidence").
//   * `--live` uses the real Gemini API (GEMINI_API_KEY required) and the real
//     configured SMTP provider. Never run --live in ordinary CI.
//
// Safety: refuses to run unless DATABASE_URL names a *test* database, and only
// ever deletes the single workspace it created.
import process from "node:process";

import { assertTestDatabase } from "./helpers/integration-safety.mjs";
import { startSmtpCaptureServer } from "./lib/smtp-capture.mjs";

const LIVE = process.argv.includes("--live");
const stamp = () => new Date().toISOString();
const log = (stage, message) => console.log(`[smoke ${stamp()}] ${stage}: ${message}`);

const BUILDER_INPUT = {
  productOrService: "Online English course for beginners",
  campaignGoal: "Increase signups for the July cohort",
  targetAudiencePrompt:
    "Contacts in HCM with lead score over 70 and interested in education",
  tone: "Friendly, motivating, professional",
  offerOrCTA: "Register now to get 20% off",
  schedulePreference: "Send this Friday morning",
  enablePersonalization: true,
};

function controlledGeminiPackage() {
  return {
    campaignName: "July Beginner English Signup Push",
    brief: "Promote the July beginner English cohort to high-intent contacts.",
    audienceExplanation:
      "Targets HCM contacts with lead score above 70 and an education interest tag.",
    targetFilters: { city: "HCM", lead_score_gt: 70, tags_contains: "education" },
    subjectIdeas: ["Start speaking English this July", "Save 20% today"],
    emailHtml:
      "<!doctype html><html><body><p>Hi {{first_name}}, join the July cohort.</p></body></html>",
    aiContext: {
      goal: "Increase signups for the July cohort",
      tone: "Friendly, motivating, professional",
      cta: "Register now to get 20% off",
      audience_description: "HCM education contacts",
      language: "English",
    },
    scheduleNotes: "Recommended: Friday morning. Save as draft first.",
    warnings: [],
  };
}

async function main() {
  const dbName = assertTestDatabase();
  log("setup", `disposable test database "${dbName}" (mode: ${LIVE ? "LIVE" : "controlled"})`);

  process.env.JWT_SECRET ||= "e2e-smoke-only-jwt-secret-not-for-production-use";
  process.env.CRON_SECRET ||= "e2e-smoke-only-cron-secret";

  const { initializeDatabase, withTransaction, withWorkspace, query, pool } =
    await import("../src/lib/db.ts");
  const { signJWT, verifyJWT } = await import("../src/lib/auth.ts");
  const { authenticateTenantRequest } = await import("../src/lib/proxy-auth.ts");
  const { authorizeCronRequest } = await import("../src/lib/cron-auth.ts");
  const { generateCampaignPackage } = await import("../src/lib/ai/campaign-builder.ts");
  const { buildTemplateDraftRequest, buildCampaignDraftRequest } = await import(
    "../src/lib/campaign-builder-draft.ts"
  );
  const { parseCampaignTargetFilters, buildContactSelection } = await import(
    "../src/lib/campaign-filters.ts"
  );
  const { parseCampaignAiContext } = await import("../src/lib/campaign-ai-context.ts");
  const {
    CLAIM_CAMPAIGN_SQL,
    CLAIM_LEASE_MINUTES,
    INSERT_EMAIL_LOG_SQL,
    PENDING_STATUS,
    PROCESSING_STATUS,
    SENT_STATUS,
    FAILED_STATUS,
    resolveCampaignDeliveryOutcome,
  } = await import("../src/lib/campaign-worker.ts");
  const { resolveCampaignDeliveryContent } = await import(
    "../src/lib/ai/personalization.ts"
  );
  const { resolveSmtpConfig, createSmtpTransporter, sendCampaignEmail } = await import(
    "../src/lib/mail/nodemailer.ts"
  );
  const {
    SELECT_CAMPAIGN_DELIVERY_SQL,
    SELECT_EMAIL_LOG_SUMMARY_SQL,
    toCampaignDeliveryCampaign,
    toCampaignDeliverySummary,
  } = await import("../src/lib/email-logs.ts");

  let workspaceId = null;
  let capture = null;
  const evidence = { mode: LIVE ? "live" : "controlled", stages: {} };

  try {
    await initializeDatabase();

    // --- Stage 1: provision a dedicated tenant (register-equivalent setup) ---
    const provisioned = await withTransaction(async (client) => {
      const email = `smoke+${Date.now()}@marekto-e2e.test`;
      const workspace = await client.query(
        'INSERT INTO "Workspaces" (name) VALUES ($1) RETURNING id',
        ["E2E smoke workspace"],
      );
      const user = await client.query(
        'INSERT INTO "Users" (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
        [email, "smoke-not-a-real-hash", "owner"],
      );
      await client.query('UPDATE "Workspaces" SET owner_id = $1 WHERE id = $2', [
        user.rows[0].id,
        workspace.rows[0].id,
      ]);
      await client.query(
        'INSERT INTO "Workspace_members" (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [workspace.rows[0].id, user.rows[0].id, "owner"],
      );
      return { workspaceId: workspace.rows[0].id, userId: user.rows[0].id };
    });
    workspaceId = provisioned.workspaceId;
    log("stage-1", `provisioned workspace ${workspaceId}`);
    evidence.stages.provision = { workspaceId, ok: true };

    // --- Stage 2: sign a JWT and verify it through the real proxy auth ---
    const token = await signJWT({
      userId: provisioned.userId,
      workspaceId: provisioned.workspaceId,
    });
    const spoofedHeaders = new Headers({
      authorization: `Bearer ${token}`,
      "x-workspace-id": "999999", // spoof attempt; proxy must overwrite this
    });
    const auth = await authenticateTenantRequest(
      spoofedHeaders,
      { get: () => undefined },
      verifyJWT,
    );
    if (!auth.ok) throw new Error(`Proxy authentication failed: ${auth.error}`);
    const verifiedWorkspace = auth.headers.get("x-workspace-id");
    if (verifiedWorkspace !== String(workspaceId)) {
      throw new Error(`Proxy did not replace spoofed workspace header: ${verifiedWorkspace}`);
    }
    log("stage-2", `real proxy replaced spoofed x-workspace-id -> verified ${verifiedWorkspace}`);
    evidence.stages.proxy = { spoofReplaced: true, verifiedWorkspace };

    // --- Stage 3: create tenant contacts that match the builder audience ---
    const contactSeeds = [
      { email: "aisha@marekto-e2e.test", first_name: "Aisha", props: { city: "HCM", lead_score: 85, tags: ["education"] } },
      { email: "binh@marekto-e2e.test", first_name: "Binh", props: { city: "HCM", lead_score: 92, tags: ["education", "vip"] } },
      { email: "carlos@marekto-e2e.test", first_name: "Carlos", props: { city: "Hanoi", lead_score: 40, tags: ["sales"] } },
    ];
    await withWorkspace(workspaceId, async (client) => {
      for (const seed of contactSeeds) {
        await client.query(
          'INSERT INTO "Contacts" (workspace_id, email, first_name, properties) VALUES ($1, $2, $3, $4::jsonb)',
          [workspaceId, seed.email, seed.first_name, JSON.stringify(seed.props)],
        );
      }
    });
    log("stage-3", `created ${contactSeeds.length} contacts (2 matching filter, 1 non-matching)`);
    evidence.stages.contacts = { created: contactSeeds.length };

    // --- Stage 4: generate the Campaign Builder package ---
    let geminiGenerator;
    if (LIVE) {
      const { generateGeminiJson } = await import("../src/lib/ai/gemini.ts");
      geminiGenerator = generateGeminiJson;
    } else {
      geminiGenerator = async () => controlledGeminiPackage();
    }
    const pkg = await generateCampaignPackage(BUILDER_INPUT, geminiGenerator);
    log("stage-4", `generated builder package "${pkg.campaignName}" (${LIVE ? "live Gemini" : "controlled-provider"})`);

    // --- Stage 5 + 6: map through the real builder->draft contract; persist ---
    const parsedFilters = parseCampaignTargetFilters(pkg.targetFilters ?? {});
    const templateReq = buildTemplateDraftRequest({
      name: `${pkg.campaignName} template`,
      emailHtml: pkg.emailHtml,
      brief: pkg.brief,
      selectedSubject: pkg.subjectIdeas[0] ?? null,
    });

    const drafts = await withWorkspace(workspaceId, async (client) => {
      const template = await client.query(
        'INSERT INTO "Templates" (workspace_id, name, body_html, body_json) VALUES ($1, $2, $3, $4::jsonb) RETURNING id',
        [workspaceId, templateReq.name, templateReq.body_html, JSON.stringify(templateReq.body_json)],
      );
      const templateId = template.rows[0].id;
      // Now that the template is a real record, build the campaign draft request
      // through the real builder->draft contract with the real template id.
      const campaignReq = buildCampaignDraftRequest({
        name: pkg.campaignName,
        templateId,
        useAllContacts: false,
        filtersValid: true,
        targetFilters: parsedFilters,
        enablePersonalization: BUILDER_INPUT.enablePersonalization,
        aiContext: pkg.aiContext ?? {},
      });
      const campaign = await client.query(
        'INSERT INTO "Campaigns" (workspace_id, template_id, name, status, target_filters, ai_personalization_enabled, ai_context, scheduled_at, run_at) ' +
          "VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, NULL, NULL) RETURNING id, status",
        [
          workspaceId,
          templateId,
          campaignReq.name,
          campaignReq.status,
          JSON.stringify(campaignReq.target_filters),
          campaignReq.ai_personalization_enabled,
          JSON.stringify(campaignReq.ai_context),
        ],
      );
      return { templateId, campaignId: campaign.rows[0].id, status: campaign.rows[0].status };
    });
    if (drafts.status !== "draft") throw new Error(`Expected draft, got ${drafts.status}`);
    log("stage-5", `saved Template ${drafts.templateId} + Campaign ${drafts.campaignId} as real draft records`);
    evidence.stages.drafts = { ...drafts, filters: parsedFilters };

    // --- Stage 7: manually schedule the campaign (immediately due) ---
    const pastRunAt = new Date(Date.now() - 60_000).toISOString();
    await withWorkspace(workspaceId, async (client) => {
      await client.query(
        'UPDATE "Campaigns" SET status = $1, scheduled_at = $2, run_at = $2, updated_at = NOW() WHERE id = $3 AND workspace_id = $4',
        [PENDING_STATUS, pastRunAt, drafts.campaignId, workspaceId],
      );
    });
    log("stage-7", `scheduled campaign ${drafts.campaignId} (pending, due ${pastRunAt})`);

    // --- Stage 8: gate + run the worker delivery with real SMTP ---
    // 8a: exercise the real cron authorization gate (fail-closed logic).
    const cronDecision = authorizeCronRequest(
      `Bearer ${process.env.CRON_SECRET}`,
      process.env.CRON_SECRET,
      false,
    );
    if (!cronDecision.ok) throw new Error("Cron authorization unexpectedly rejected");
    const badCron = authorizeCronRequest("Bearer wrong", process.env.CRON_SECRET, false);
    if (badCron.ok) throw new Error("Cron authorization accepted a wrong secret");
    log("stage-8", "cron authorization gate accepts the secret and rejects a wrong one");

    if (!LIVE) {
      capture = await startSmtpCaptureServer();
      process.env.SMTP_HOST = capture.host;
      process.env.SMTP_PORT = String(capture.port);
      process.env.SMTP_USER = "capture";
      process.env.SMTP_PASSWORD = "capture";
      process.env.SMTP_FROM = "Marekto Smoke <smoke@marekto-e2e.test>";
      process.env.SMTP_SECURE = "false";
      log("stage-8", `SMTP capture listening on ${capture.host}:${capture.port}`);
    }

    // 8b: claim the campaign with the real atomic claim SQL.
    const claimed = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query(CLAIM_CAMPAIGN_SQL, [
        workspaceId,
        PROCESSING_STATUS,
        PENDING_STATUS,
        CLAIM_LEASE_MINUTES,
      ]);
      return result.rows[0] ?? null;
    });
    if (!claimed) throw new Error("Worker failed to claim the due campaign");

    // 8c: prepare recipients through the real filter parser + selection builder.
    const prepared = await withWorkspace(workspaceId, async (client) => {
      const template = await client.query(
        'SELECT body_html FROM "Templates" WHERE id = $1 AND workspace_id = $2',
        [claimed.template_id, workspaceId],
      );
      const filters = parseCampaignTargetFilters(claimed.target_filters);
      const selection = buildContactSelection(workspaceId, filters);
      const contacts = await client.query(selection.text, selection.params);
      return { emailHtml: template.rows[0].body_html.trim(), contacts: contacts.rows };
    });

    // 8d: deliver each recipient over the real SMTP transport + log the result.
    const config = resolveSmtpConfig();
    const transporter = createSmtpTransporter(config);
    const aiContext = claimed.ai_personalization_enabled
      ? parseCampaignAiContext(claimed.ai_context)
      : {};
    let sent = 0;
    let failed = 0;
    for (const contact of prepared.contacts) {
      const content = await resolveCampaignDeliveryContent(
        {
          campaign: { name: claimed.name, aiContext },
          template: { bodyHtml: prepared.emailHtml },
          contact: {
            email: contact.email,
            firstName: contact.first_name,
            lastName: contact.last_name,
            properties: contact.properties,
          },
        },
        claimed.ai_personalization_enabled,
      );
      try {
        await sendCampaignEmail(
          {
            to: contact.email,
            subject: content.subject,
            html: content.html,
            ...(content.text !== null ? { text: content.text } : {}),
          },
          transporter,
          config,
        );
        sent += 1;
        await withWorkspace(workspaceId, (client) =>
          client.query(INSERT_EMAIL_LOG_SQL, [
            workspaceId,
            claimed.id,
            contact.id,
            "sent",
            null,
            content.source,
            content.personalizationError,
          ]),
        );
      } catch (error) {
        failed += 1;
        await withWorkspace(workspaceId, (client) =>
          client.query(INSERT_EMAIL_LOG_SQL, [
            workspaceId,
            claimed.id,
            contact.id,
            "failed",
            error instanceof Error ? error.message : "delivery failed",
            content.source,
            content.personalizationError,
          ]),
        );
      }
    }
    const outcome = resolveCampaignDeliveryOutcome(prepared.contacts.length, sent, failed);
    await withWorkspace(workspaceId, (client) =>
      client.query(
        'UPDATE "Campaigns" SET status = $1, processing_started_at = NULL, failure_reason = $2, updated_at = NOW() WHERE id = $3 AND workspace_id = $4',
        [outcome.status === SENT_STATUS ? SENT_STATUS : FAILED_STATUS, outcome.reason, claimed.id, workspaceId],
      ),
    );
    log("stage-8", `delivered sent=${sent} failed=${failed} over ${LIVE ? "live SMTP" : "SMTP capture"}`);

    // --- Stage 9: verify status + logs with the exact email-logs route SQL ---
    const verification = await withWorkspace(workspaceId, async (client) => {
      const campaignRow = await client.query(SELECT_CAMPAIGN_DELIVERY_SQL, [
        claimed.id,
        workspaceId,
      ]);
      const summaryRow = await client.query(SELECT_EMAIL_LOG_SUMMARY_SQL, [
        workspaceId,
        claimed.id,
      ]);
      return {
        campaign: toCampaignDeliveryCampaign(campaignRow.rows[0]),
        summary: toCampaignDeliverySummary(summaryRow.rows[0]),
      };
    });

    const summary = verification.summary;
    const expectedRecipients = 2;
    const assertions = [];
    const check = (name, condition, detail) => {
      assertions.push({ name, ok: Boolean(condition), detail });
      if (!condition) throw new Error(`Assertion failed: ${name} (${detail})`);
    };

    check("campaign marked sent", verification.campaign.status === "sent", `status=${verification.campaign.status}`);
    check("one delivery log per matching recipient", Number(summary.total_recipients) === expectedRecipients, `total_recipients=${summary.total_recipients}`);
    check("all matching recipients delivered", Number(summary.sent_count) === expectedRecipients, `sent_count=${summary.sent_count}`);
    check("no failed deliveries", Number(summary.failed_count) === 0, `failed_count=${summary.failed_count}`);

    if (!LIVE) {
      check("SMTP capture received each delivery", capture.messages.length === expectedRecipients, `captured=${capture.messages.length}`);
      const gotBinh = capture.messages.some((m) => m.to.some((r) => r.includes("binh@marekto-e2e.test")));
      check("delivered to a matching recipient", gotBinh, "binh present in capture");
      const gotCarlos = capture.messages.some((m) => m.to.some((r) => r.includes("carlos@marekto-e2e.test")));
      check("non-matching contact excluded by filter", gotCarlos === false, "carlos excluded");
    }

    evidence.stages.delivery = {
      campaignStatus: verification.campaign.status,
      summary,
      captured: LIVE ? "live-provider" : capture.messages.length,
      assertions,
    };

    log("stage-9", `verified status=sent, sent=${summary.sent_count}/${summary.total_recipients}, failed=${summary.failed_count}`);
    log("done", `controlled end-to-end smoke path PASSED (${assertions.length} assertions)`);
    console.log("\n=== SANITIZED EVIDENCE ===");
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    if (capture) await capture.close();
    if (workspaceId !== null) {
      await query('DELETE FROM "Workspaces" WHERE id = $1', [workspaceId]);
      log("cleanup", `deleted workspace ${workspaceId} (cascade)`);
    }
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[smoke ${stamp()}] FAILED:`, error instanceof Error ? error.message : error);
  process.exit(1);
});
