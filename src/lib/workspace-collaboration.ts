import { createHash, randomBytes } from "node:crypto";

import type { PoolClient } from "pg";

import { sanitizeAuditMetadata } from "./admin-audit.ts";
import { initializeDatabase, query, withTransaction } from "./db.ts";

const WORKSPACE_OWNER_ROLE = "owner";
const WORKSPACE_MEMBER_ROLE = "member";
const INVITE_TTL_DAYS = 7;
const MAX_WORKSPACE_NAME_LENGTH = 80;

export type WorkspaceRole = "owner" | "member";

export type WorkspaceSummary = {
  id: number;
  name: string;
  role: WorkspaceRole;
  owner_id: number | null;
  member_count: number;
  joined_at: string | null;
};

export type WorkspaceMember = {
  user_id: number;
  email: string;
  role: WorkspaceRole;
  joined_at: string | null;
};

export type WorkspaceInvite = {
  id: number;
  workspace_id: number;
  workspace_name: string;
  created_by_user_id: number;
  created_by_email: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export type InvitePreview = {
  workspace_id: number;
  workspace_name: string;
  member_count: number;
  expires_at: string;
};

export type WorkspaceAuditEvent = {
  id: number;
  actor_user_id: number | null;
  actor_email: string | null;
  target_type: string;
  target_id: number | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type WorkspaceSummaryRow = {
  id: number;
  name: string;
  role: string;
  owner_id: number | null;
  member_count: number;
  joined_at: Date | string | null;
};

type WorkspaceMemberRow = {
  user_id: number;
  email: string;
  role: string;
  joined_at: Date | string | null;
};

type InviteRow = {
  id: number;
  workspace_id: number;
  workspace_name: string;
  created_by_user_id: number;
  created_by_email: string | null;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  created_at: Date | string;
};

type InvitePreviewRow = {
  workspace_id: number;
  workspace_name: string;
  member_count: number;
  expires_at: Date | string;
};

type WorkspaceAuditRow = {
  id: number;
  actor_user_id: number | null;
  actor_email: string | null;
  target_type: string;
  target_id: number | null;
  action: string;
  metadata: unknown;
  created_at: Date | string;
};

type IdRow = {
  id: number;
};

type RoleRow = {
  role: string;
};

type CountRow = {
  count: number;
};

function toIsoString(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toWorkspaceRole(value: string): WorkspaceRole {
  return value === WORKSPACE_OWNER_ROLE ? WORKSPACE_OWNER_ROLE : WORKSPACE_MEMBER_ROLE;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function parseWorkspaceName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Workspace name is required");
  }

  const name = value.trim();

  if (name.length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new Error(`Workspace name must be ${MAX_WORKSPACE_NAME_LENGTH} characters or fewer`);
  }

  return name;
}

export function parseWorkspaceRole(value: unknown): WorkspaceRole {
  if (value === WORKSPACE_OWNER_ROLE || value === WORKSPACE_MEMBER_ROLE) {
    return value;
  }

  throw new Error("Workspace role is invalid");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function parseWorkspaceInviteToken(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Invite token is required");
  }

  const input = value.trim();
  let token = input;

  if (/^https?:\/\//i.test(input)) {
    try {
      token = new URL(input).pathname.match(/^\/invite\/([^/]+)\/?$/)?.[1] ?? "";
    } catch {
      token = "";
    }
  } else if (input.startsWith("/")) {
    token = input.split(/[?#]/, 1)[0].match(/^\/invite\/([^/]+)\/?$/)?.[1] ?? "";
  }

  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Invite link is invalid or expired");
  }

  return token;
}

function mapWorkspaceSummary(row: WorkspaceSummaryRow): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    role: toWorkspaceRole(row.role),
    owner_id: row.owner_id,
    member_count: row.member_count ?? 0,
    joined_at: toIsoString(row.joined_at),
  };
}

function mapWorkspaceMember(row: WorkspaceMemberRow): WorkspaceMember {
  return {
    user_id: row.user_id,
    email: row.email,
    role: toWorkspaceRole(row.role),
    joined_at: toIsoString(row.joined_at),
  };
}

function mapInvite(row: InviteRow): WorkspaceInvite {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    workspace_name: row.workspace_name,
    created_by_user_id: row.created_by_user_id,
    created_by_email: row.created_by_email,
    expires_at: toIsoString(row.expires_at) ?? "",
    revoked_at: toIsoString(row.revoked_at),
    created_at: toIsoString(row.created_at) ?? "",
  };
}

async function recordWorkspaceAudit(
  client: PoolClient,
  input: {
    workspaceId: number;
    actorUserId: number;
    targetType: string;
    targetId: number | null;
    action: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    'INSERT INTO "Workspace_audit_logs" ' +
      "(workspace_id, actor_user_id, target_type, target_id, action, metadata) " +
      "VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
    [
      input.workspaceId,
      input.actorUserId,
      input.targetType,
      input.targetId,
      input.action,
      JSON.stringify(sanitizeAuditMetadata(input.metadata)),
    ],
  );
}

async function assertWorkspaceOwner(
  client: PoolClient,
  workspaceId: number,
  userId: number,
): Promise<void> {
  const result = await client.query<RoleRow>(
    'SELECT role FROM "Workspace_members" WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );

  if (result.rows[0]?.role !== WORKSPACE_OWNER_ROLE) {
    throw new Error("Forbidden: workspace owner access required");
  }
}

async function countWorkspaceOwners(
  client: PoolClient,
  workspaceId: number,
): Promise<number> {
  const result = await client.query<CountRow>(
    'SELECT COUNT(*)::int AS count FROM "Workspace_members" WHERE workspace_id = $1 AND role = $2',
    [workspaceId, WORKSPACE_OWNER_ROLE],
  );

  return result.rows[0]?.count ?? 0;
}

async function getMembershipRole(
  client: PoolClient,
  workspaceId: number,
  userId: number,
): Promise<WorkspaceRole | null> {
  const result = await client.query<RoleRow>(
    'SELECT role FROM "Workspace_members" WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  const role = result.rows[0]?.role;
  return role ? toWorkspaceRole(role) : null;
}

async function repairWorkspaceOwnerId(
  client: PoolClient,
  workspaceId: number,
): Promise<void> {
  await client.query(
    'UPDATE "Workspaces" SET owner_id = (' +
      'SELECT user_id FROM "Workspace_members" ' +
      'WHERE workspace_id = $1 AND role = $2 ORDER BY joined_at ASC, id ASC LIMIT 1' +
      ") WHERE id = $1 AND (owner_id IS NULL OR NOT EXISTS (" +
      'SELECT 1 FROM "Workspace_members" WHERE workspace_id = $1 AND user_id = "Workspaces".owner_id AND role = $2' +
      "))",
    [workspaceId, WORKSPACE_OWNER_ROLE],
  );
}

export async function listUserWorkspaces(userId: number): Promise<WorkspaceSummary[]> {
  assertPositiveInteger("userId", userId);

  const result = await query<WorkspaceSummaryRow>(
    'SELECT w.id, w.name, w.owner_id, wm.role, wm.joined_at, ' +
      '(SELECT COUNT(*)::int FROM "Workspace_members" count_m WHERE count_m.workspace_id = w.id) AS member_count ' +
      'FROM "Workspace_members" wm ' +
      'INNER JOIN "Workspaces" w ON w.id = wm.workspace_id ' +
      "WHERE wm.user_id = $1 " +
      "ORDER BY wm.joined_at ASC, w.id ASC",
    [userId],
  );

  return result.rows.map(mapWorkspaceSummary);
}

export async function createWorkspaceForUser(
  userId: number,
  workspaceName: string,
): Promise<WorkspaceSummary> {
  assertPositiveInteger("userId", userId);
  const name = parseWorkspaceName(workspaceName);

  return withTransaction(async (client) => {
    const workspaceResult = await client.query<IdRow>(
      'INSERT INTO "Workspaces" (name, owner_id) VALUES ($1, $2) RETURNING id',
      [name, userId],
    );
    const workspaceId = workspaceResult.rows[0].id;

    await client.query(
      'INSERT INTO "Workspace_members" (workspace_id, user_id, role) VALUES ($1, $2, $3)',
      [workspaceId, userId, WORKSPACE_OWNER_ROLE],
    );

    await recordWorkspaceAudit(client, {
      workspaceId,
      actorUserId: userId,
      targetType: "workspace",
      targetId: workspaceId,
      action: "workspace.created",
      metadata: { workspace_name: name },
    });

    return {
      id: workspaceId,
      name,
      role: WORKSPACE_OWNER_ROLE,
      owner_id: userId,
      member_count: 1,
      joined_at: new Date().toISOString(),
    };
  });
}

export async function assertUserCanUseWorkspace(
  userId: number,
  workspaceId: number,
): Promise<WorkspaceSummary> {
  assertPositiveInteger("userId", userId);
  assertPositiveInteger("workspaceId", workspaceId);

  const result = await query<WorkspaceSummaryRow>(
    'SELECT w.id, w.name, w.owner_id, wm.role, wm.joined_at, ' +
      '(SELECT COUNT(*)::int FROM "Workspace_members" count_m WHERE count_m.workspace_id = w.id) AS member_count ' +
      'FROM "Workspace_members" wm ' +
      'INNER JOIN "Workspaces" w ON w.id = wm.workspace_id ' +
      "WHERE wm.user_id = $1 AND wm.workspace_id = $2",
    [userId, workspaceId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error("Forbidden: workspace membership required");
  }

  return mapWorkspaceSummary(row);
}

export async function listWorkspaceMembers(
  actorUserId: number,
  workspaceId: number,
): Promise<WorkspaceMember[]> {
  assertPositiveInteger("actorUserId", actorUserId);
  assertPositiveInteger("workspaceId", workspaceId);

  return withTransaction(async (client) => {
    await assertWorkspaceOwner(client, workspaceId, actorUserId);

    const result = await client.query<WorkspaceMemberRow>(
      'SELECT u.id AS user_id, u.email, wm.role, wm.joined_at ' +
        'FROM "Workspace_members" wm ' +
        'INNER JOIN "Users" u ON u.id = wm.user_id ' +
        "WHERE wm.workspace_id = $1 " +
        "ORDER BY wm.role DESC, wm.joined_at ASC, u.id ASC",
      [workspaceId],
    );

    return result.rows.map(mapWorkspaceMember);
  });
}

export async function listWorkspaceAuditEvents(
  actorUserId: number,
  workspaceId: number,
  limit = 50,
): Promise<WorkspaceAuditEvent[]> {
  assertPositiveInteger("actorUserId", actorUserId);
  assertPositiveInteger("workspaceId", workspaceId);

  const boundedLimit = Number.isInteger(limit)
    ? Math.min(Math.max(limit, 1), 100)
    : 50;

  return withTransaction(async (client) => {
    await assertWorkspaceOwner(client, workspaceId, actorUserId);

    const result = await client.query<WorkspaceAuditRow>(
      'SELECT log.id, log.actor_user_id, actor.email AS actor_email, ' +
        "log.target_type, log.target_id, log.action, log.metadata, log.created_at " +
        'FROM "Workspace_audit_logs" log ' +
        'LEFT JOIN "Users" actor ON actor.id = log.actor_user_id ' +
        "WHERE log.workspace_id = $1 " +
        "ORDER BY log.created_at DESC, log.id DESC LIMIT $2",
      [workspaceId, boundedLimit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      actor_user_id: row.actor_user_id,
      actor_email: row.actor_email,
      target_type: row.target_type,
      target_id: row.target_id,
      action: row.action,
      metadata:
        typeof row.metadata === "object" && row.metadata !== null
          ? (row.metadata as Record<string, unknown>)
          : {},
      created_at: toIsoString(row.created_at) ?? "",
    }));
  });
}

export async function updateWorkspaceMemberRole(input: {
  actorUserId: number;
  workspaceId: number;
  targetUserId: number;
  role: WorkspaceRole;
}): Promise<WorkspaceMember> {
  assertPositiveInteger("actorUserId", input.actorUserId);
  assertPositiveInteger("workspaceId", input.workspaceId);
  assertPositiveInteger("targetUserId", input.targetUserId);

  return withTransaction(async (client) => {
    await assertWorkspaceOwner(client, input.workspaceId, input.actorUserId);

    const currentRole = await getMembershipRole(
      client,
      input.workspaceId,
      input.targetUserId,
    );

    if (!currentRole) {
      throw new Error("Workspace member not found");
    }

    if (currentRole === WORKSPACE_OWNER_ROLE && input.role === WORKSPACE_MEMBER_ROLE) {
      const ownerCount = await countWorkspaceOwners(client, input.workspaceId);
      if (ownerCount <= 1) {
        throw new Error("The last workspace owner cannot be demoted");
      }
    }

    const result = await client.query<WorkspaceMemberRow>(
      'WITH updated AS (' +
        'UPDATE "Workspace_members" SET role = $1 ' +
        "WHERE workspace_id = $2 AND user_id = $3 " +
        "RETURNING user_id, role, joined_at" +
        ") SELECT updated.user_id, u.email, updated.role, updated.joined_at " +
        'FROM updated INNER JOIN "Users" u ON u.id = updated.user_id',
      [input.role, input.workspaceId, input.targetUserId],
    );

    await repairWorkspaceOwnerId(client, input.workspaceId);
    await recordWorkspaceAudit(client, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      targetType: "member",
      targetId: input.targetUserId,
      action: "member.role_changed",
      metadata: { role: input.role, previous_role: currentRole },
    });

    return mapWorkspaceMember(result.rows[0]);
  });
}

export async function removeWorkspaceMember(input: {
  actorUserId: number;
  workspaceId: number;
  targetUserId: number;
}): Promise<void> {
  assertPositiveInteger("actorUserId", input.actorUserId);
  assertPositiveInteger("workspaceId", input.workspaceId);
  assertPositiveInteger("targetUserId", input.targetUserId);

  await withTransaction(async (client) => {
    await assertWorkspaceOwner(client, input.workspaceId, input.actorUserId);

    const currentRole = await getMembershipRole(
      client,
      input.workspaceId,
      input.targetUserId,
    );

    if (!currentRole) {
      throw new Error("Workspace member not found");
    }

    if (currentRole === WORKSPACE_OWNER_ROLE) {
      const ownerCount = await countWorkspaceOwners(client, input.workspaceId);
      if (ownerCount <= 1) {
        throw new Error("The last workspace owner cannot be removed");
      }
    }

    await client.query(
      'DELETE FROM "Workspace_members" WHERE workspace_id = $1 AND user_id = $2',
      [input.workspaceId, input.targetUserId],
    );

    await repairWorkspaceOwnerId(client, input.workspaceId);
    await recordWorkspaceAudit(client, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      targetType: "member",
      targetId: input.targetUserId,
      action: "member.removed",
      metadata: { previous_role: currentRole },
    });
  });
}

export async function createWorkspaceInvite(input: {
  actorUserId: number;
  workspaceId: number;
}): Promise<{ invite: WorkspaceInvite; token: string }> {
  assertPositiveInteger("actorUserId", input.actorUserId);
  assertPositiveInteger("workspaceId", input.workspaceId);

  return withTransaction(async (client) => {
    await assertWorkspaceOwner(client, input.workspaceId, input.actorUserId);

    const token = createInviteToken();
    const result = await client.query<InviteRow>(
      'WITH inserted AS (' +
        'INSERT INTO "Workspace_invites" ' +
        "(workspace_id, token_hash, created_by_user_id, expires_at) " +
        "VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 day')) " +
        "RETURNING id, workspace_id, created_by_user_id, expires_at, revoked_at, created_at" +
        ") SELECT inserted.id, inserted.workspace_id, w.name AS workspace_name, " +
        "inserted.created_by_user_id, creator.email AS created_by_email, " +
        "inserted.expires_at, inserted.revoked_at, inserted.created_at " +
        'FROM inserted INNER JOIN "Workspaces" w ON w.id = inserted.workspace_id ' +
        'LEFT JOIN "Users" creator ON creator.id = inserted.created_by_user_id',
      [input.workspaceId, hashInviteToken(token), input.actorUserId, INVITE_TTL_DAYS],
    );

    await recordWorkspaceAudit(client, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      targetType: "invite",
      targetId: result.rows[0].id,
      action: "member.invite_created",
    });

    return { invite: mapInvite(result.rows[0]), token };
  });
}

export async function listWorkspaceInvites(input: {
  actorUserId: number;
  workspaceId: number;
}): Promise<WorkspaceInvite[]> {
  assertPositiveInteger("actorUserId", input.actorUserId);
  assertPositiveInteger("workspaceId", input.workspaceId);

  return withTransaction(async (client) => {
    await assertWorkspaceOwner(client, input.workspaceId, input.actorUserId);

    const result = await client.query<InviteRow>(
      'SELECT i.id, i.workspace_id, w.name AS workspace_name, i.created_by_user_id, ' +
        "creator.email AS created_by_email, i.expires_at, i.revoked_at, i.created_at " +
        'FROM "Workspace_invites" i ' +
        'INNER JOIN "Workspaces" w ON w.id = i.workspace_id ' +
        'LEFT JOIN "Users" creator ON creator.id = i.created_by_user_id ' +
        "WHERE i.workspace_id = $1 " +
        "ORDER BY i.created_at DESC, i.id DESC",
      [input.workspaceId],
    );

    return result.rows.map(mapInvite);
  });
}

export async function revokeWorkspaceInvite(input: {
  actorUserId: number;
  workspaceId: number;
  inviteId: number;
}): Promise<void> {
  assertPositiveInteger("actorUserId", input.actorUserId);
  assertPositiveInteger("workspaceId", input.workspaceId);
  assertPositiveInteger("inviteId", input.inviteId);

  await withTransaction(async (client) => {
    await assertWorkspaceOwner(client, input.workspaceId, input.actorUserId);

    const result = await client.query<IdRow>(
      'UPDATE "Workspace_invites" SET revoked_at = COALESCE(revoked_at, NOW()) ' +
        "WHERE id = $1 AND workspace_id = $2 RETURNING id",
      [input.inviteId, input.workspaceId],
    );

    if (!result.rows[0]) {
      throw new Error("Workspace invite not found");
    }

    await recordWorkspaceAudit(client, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      targetType: "invite",
      targetId: input.inviteId,
      action: "member.invite_revoked",
    });
  });
}

export async function getInvitePreview(token: string): Promise<InvitePreview> {
  if (token.trim().length === 0) {
    throw new Error("Invite token is required");
  }

  await initializeDatabase();

  const result = await query<InvitePreviewRow>(
    'SELECT i.workspace_id, w.name AS workspace_name, i.expires_at, ' +
      '(SELECT COUNT(*)::int FROM "Workspace_members" m WHERE m.workspace_id = i.workspace_id) AS member_count ' +
      'FROM "Workspace_invites" i ' +
      'INNER JOIN "Workspaces" w ON w.id = i.workspace_id ' +
      "WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.expires_at > NOW()",
    [hashInviteToken(token)],
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error("Invite link is invalid or expired");
  }

  return {
    workspace_id: row.workspace_id,
    workspace_name: row.workspace_name,
    member_count: row.member_count ?? 0,
    expires_at: toIsoString(row.expires_at) ?? "",
  };
}

export async function joinWorkspaceInvite(input: {
  userId: number;
  token: string;
}): Promise<WorkspaceSummary> {
  assertPositiveInteger("userId", input.userId);

  if (input.token.trim().length === 0) {
    throw new Error("Invite token is required");
  }

  return withTransaction(async (client) => {
    const inviteResult = await client.query<InvitePreviewRow>(
      'SELECT i.workspace_id, w.name AS workspace_name, i.expires_at, ' +
        '(SELECT COUNT(*)::int FROM "Workspace_members" m WHERE m.workspace_id = i.workspace_id) AS member_count ' +
        'FROM "Workspace_invites" i ' +
        'INNER JOIN "Workspaces" w ON w.id = i.workspace_id ' +
        "WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.expires_at > NOW()",
      [hashInviteToken(input.token)],
    );
    const invite = inviteResult.rows[0];

    if (!invite) {
      throw new Error("Invite link is invalid or expired");
    }

    const existingRole = await getMembershipRole(
      client,
      invite.workspace_id,
      input.userId,
    );

    if (existingRole) {
      return {
        id: invite.workspace_id,
        name: invite.workspace_name,
        role: existingRole,
        owner_id: null,
        member_count: invite.member_count,
        joined_at: null,
      };
    }

    await client.query(
      'INSERT INTO "Workspace_members" (workspace_id, user_id, role) VALUES ($1, $2, $3)',
      [invite.workspace_id, input.userId, WORKSPACE_MEMBER_ROLE],
    );

    await recordWorkspaceAudit(client, {
      workspaceId: invite.workspace_id,
      actorUserId: input.userId,
      targetType: "member",
      targetId: input.userId,
      action: "member.joined",
      metadata: { source: "invite" },
    });

    return {
      id: invite.workspace_id,
      name: invite.workspace_name,
      role: WORKSPACE_MEMBER_ROLE,
      owner_id: null,
      member_count: invite.member_count + 1,
      joined_at: new Date().toISOString(),
    };
  });
}
