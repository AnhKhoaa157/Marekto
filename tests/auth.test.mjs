import assert from "node:assert/strict";
import test from "node:test";

import { SignJWT } from "jose";

process.env.JWT_SECRET = "marekto-test-secret";

const { signJWT, verifyJWT } = await import("../src/lib/auth.ts");

test("verifies a valid tenant token", async () => {
  const token = await signJWT({ userId: 2, workspaceId: 9 });
  assert.deepEqual(await verifyJWT(token), { userId: 2, workspaceId: 9 });
});

test("verifies a valid no-workspace account token", async () => {
  const token = await signJWT({ userId: 2, workspaceId: null });
  assert.deepEqual(await verifyJWT(token), { userId: 2, workspaceId: null });
});

test("rejects malformed and expired tenant tokens", async () => {
  assert.equal(await verifyJWT("not-a-jwt"), null);

  const expiredToken = await new SignJWT({ userId: 2, workspaceId: 9 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("marekto")
    .setAudience("marekto-app")
    .setIssuedAt()
    .setExpirationTime("0s")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));

  assert.equal(await verifyJWT(expiredToken), null);
});
