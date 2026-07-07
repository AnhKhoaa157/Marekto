import assert from "node:assert/strict";
import test from "node:test";

import { SESSION_ID, USER_ID, WORKSPACE_ID } from "./test-ids.mjs";

import { SignJWT } from "jose";

process.env.JWT_SECRET = "marekto-test-secret";

const { signJWT, verifyJWT } = await import("../src/lib/auth.ts");

test("verifies a valid tenant token", async () => {
  const token = await signJWT({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    sessionId: SESSION_ID,
  });
  assert.deepEqual(await verifyJWT(token), {
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    sessionId: SESSION_ID,
  });
});

test("verifies a valid no-workspace account token", async () => {
  const token = await signJWT({ userId: USER_ID, workspaceId: null, sessionId: SESSION_ID });
  assert.deepEqual(await verifyJWT(token), {
    userId: USER_ID,
    workspaceId: null,
    sessionId: SESSION_ID,
  });
});

test("rejects malformed and expired tenant tokens", async () => {
  assert.equal(await verifyJWT("not-a-jwt"), null);

  const expiredToken = await new SignJWT({ userId: USER_ID, workspaceId: WORKSPACE_ID })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("marekto")
    .setAudience("marekto-app")
    .setIssuedAt()
    .setExpirationTime("0s")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));

  assert.equal(await verifyJWT(expiredToken), null);
});
