import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/marekto";

const {
  createInviteToken,
  hashInviteToken,
  parseWorkspaceInviteToken,
  parseWorkspaceName,
  parseWorkspaceRole,
} = await import("../src/lib/workspace-collaboration.ts");

test("parseWorkspaceName trims and bounds workspace names", () => {
  assert.equal(parseWorkspaceName("  Acme Growth  "), "Acme Growth");
  assert.throws(() => parseWorkspaceName(""), /Workspace name is required/);
  assert.throws(() => parseWorkspaceName("a".repeat(81)), /80 characters/);
});

test("parseWorkspaceRole accepts only member and owner roles", () => {
  assert.equal(parseWorkspaceRole("owner"), "owner");
  assert.equal(parseWorkspaceRole("member"), "member");
  assert.throws(() => parseWorkspaceRole("admin"), /Workspace role is invalid/);
});

test("invite tokens are random while stored hashes are deterministic", () => {
  const tokenA = createInviteToken();
  const tokenB = createInviteToken();

  assert.notEqual(tokenA, tokenB);
  assert.equal(hashInviteToken(tokenA), hashInviteToken(tokenA));
  assert.notEqual(hashInviteToken(tokenA), tokenA);
});

test("parseWorkspaceInviteToken accepts tokens and invite links", () => {
  const token = "46Ig_DdnNGfVOuGGgpqq7HnLZEtDSfi_DdCOs1DBUJw";

  assert.equal(parseWorkspaceInviteToken(token), token);
  assert.equal(
    parseWorkspaceInviteToken(`http://localhost:3000/invite/${token}`),
    token,
  );
  assert.equal(parseWorkspaceInviteToken(`/invite/${token}`), token);
  assert.throws(
    () => parseWorkspaceInviteToken("http://localhost:3000/not-an-invite"),
    /invalid or expired/,
  );
});
