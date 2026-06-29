import { timingSafeEqual } from "node:crypto";

export type CronAuthorizationResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

export function authorizeCronRequest(
  authorization: string | null,
  configuredSecret: string | undefined,
  isProduction: boolean,
): CronAuthorizationResult {
  if (!configuredSecret) {
    return isProduction
      ? { ok: false, status: 503, error: "Cron worker is not configured" }
      : { ok: true };
  }

  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix)) {
    return { ok: false, status: 401, error: "Unauthorized cron request" };
  }

  const suppliedSecret = authorization.slice(prefix.length).trim();
  const expectedBuffer = Buffer.from(configuredSecret);
  const suppliedBuffer = Buffer.from(suppliedSecret);
  const matches =
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer);

  return matches
    ? { ok: true }
    : { ok: false, status: 401, error: "Unauthorized cron request" };
}
