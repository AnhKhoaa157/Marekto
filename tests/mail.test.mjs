import assert from "node:assert/strict";
import test from "node:test";

import {
  sendPasswordResetOtpEmail,
  sendRegistrationOtpEmail,
} from "../src/lib/mail/auth.ts";

import {
  isSmtpConfigured,
  resolveSmtpConfig,
  sanitizeMailError,
  sendCampaignEmail,
} from "../src/lib/mail/nodemailer.ts";

const validSmtpEnv = {
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_USER: "mailer@example.test",
  SMTP_PASSWORD: "super-secret-password",
  SMTP_FROM: "Marekto <mailer@example.test>",
};

test("validates required SMTP configuration", () => {
  assert.equal(isSmtpConfigured(validSmtpEnv), true);
  assert.deepEqual(resolveSmtpConfig(validSmtpEnv), {
    host: "smtp.example.test",
    port: 587,
    secure: false,
    user: "mailer@example.test",
    password: "super-secret-password",
    from: "Marekto <mailer@example.test>",
  });

  assert.equal(isSmtpConfigured({}), false);
  assert.throws(
    () => resolveSmtpConfig({ ...validSmtpEnv, SMTP_PORT: "not-a-port" }),
    /SMTP_PORT/,
  );
});

test("sends campaign email through an injected transporter", async () => {
  const config = resolveSmtpConfig(validSmtpEnv);
  const messages = [];
  const transporter = {
    async sendMail(options) {
      messages.push(options);

      return {
        messageId: "message-1",
        accepted: ["recipient@example.test"],
        rejected: [],
        pending: [],
        response: "250 queued",
        envelope: {
          from: "mailer@example.test",
          to: ["recipient@example.test"],
        },
      };
    },
  };

  const result = await sendCampaignEmail(
    {
      to: "recipient@example.test",
      subject: "Real campaign",
      html: "<p>Hello</p>",
    },
    transporter,
    config,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].from, "Marekto <mailer@example.test>");
  assert.equal(messages[0].disableFileAccess, true);
  assert.equal(messages[0].disableUrlAccess, true);
  assert.deepEqual(result.accepted, ["recipient@example.test"]);
});

test("registration OTP email uses dark-mode-safe solid backgrounds", async () => {
  const config = resolveSmtpConfig(validSmtpEnv);
  let sentMessage;
  const transporter = {
    async sendMail(options) {
      sentMessage = options;
      return {
        messageId: "message-otp",
        accepted: [options.to],
        rejected: [],
        pending: [],
        response: "250 queued",
        envelope: { from: "mailer@example.test", to: [options.to] },
      };
    },
  };

  await sendRegistrationOtpEmail(
    { email: "owner@example.test", otp: "591535", expiresInMinutes: 10 },
    transporter,
    config,
  );

  assert.match(sentMessage.html, /prefers-color-scheme: dark/);
  assert.match(sentMessage.html, /bgcolor="#312e81"/);
  assert.match(sentMessage.html, /background-color:#312e81/);
  assert.doesNotMatch(sentMessage.html, /linear-gradient|rgba\(/);
});

test("password reset email carries the OTP without unsafe dark-mode gradients", async () => {
  const config = resolveSmtpConfig(validSmtpEnv);
  let sentMessage;
  const transporter = {
    async sendMail(options) {
      sentMessage = options;
      return {
        messageId: "message-reset",
        accepted: [options.to],
        rejected: [],
        pending: [],
        response: "250 queued",
        envelope: { from: "mailer@example.test", to: [options.to] },
      };
    },
  };

  await sendPasswordResetOtpEmail(
    { email: "owner@example.test", otp: "654321", expiresInMinutes: 10 },
    transporter,
    config,
  );

  assert.equal(sentMessage.subject, "Reset your Marekto password");
  assert.match(sentMessage.html, /654321/);
  assert.match(sentMessage.html, /bgcolor="#312e81"/);
  assert.doesNotMatch(sentMessage.html, /linear-gradient|rgba\(/);
});

test("sanitizes SMTP secrets from delivery errors", () => {
  const message = sanitizeMailError(
    new Error("Auth failed for mailer@example.test with super-secret-password"),
    validSmtpEnv,
  );

  assert.equal(message.includes("super-secret-password"), false);
  assert.equal(message.includes("mailer@example.test"), false);
  assert.match(message, /\*\*\*/);
});
