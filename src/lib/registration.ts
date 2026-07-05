import { getDbClient } from "@/lib/db";

const OWNER_ROLE = "owner";

const INSERT_WORKSPACE_SQL =
  'INSERT INTO "Workspaces" (name) VALUES ($1) RETURNING id';
const CHECK_USER_EXISTS_SQL = 'SELECT 1 FROM "Users" WHERE email = $1';
const INSERT_USER_SQL =
  'INSERT INTO "Users" (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id';
const UPDATE_WORKSPACE_OWNER_SQL =
  'UPDATE "Workspaces" SET owner_id = $1 WHERE id = $2';
const INSERT_MEMBERSHIP_SQL =
  'INSERT INTO "Workspace_members" (workspace_id, user_id, role) VALUES ($1, $2, $3)';

export const EMAIL_TAKEN_ERROR = "Email already registered";

export type RegistrationResult = {
  userId: number;
  workspaceId: number;
};

export type VerifiedRegistration = {
  email: string;
  passwordHash: string;
  workspaceName: string;
};

/**
 * Provision a workspace + owner user + membership inside a single transaction.
 * This runs before tenant context exists, so it intentionally uses a raw pooled
 * client and only touches non-RLS bootstrap tables.
 */
export async function runRegistrationTransaction(
  registration: VerifiedRegistration,
): Promise<RegistrationResult> {
  const client = await getDbClient();
  let connectionIsBroken = false;

  try {
    await client.query("BEGIN");

    const existing = await client.query(CHECK_USER_EXISTS_SQL, [
      registration.email,
    ]);
    if (existing.rowCount && existing.rowCount > 0) {
      throw new Error(EMAIL_TAKEN_ERROR);
    }

    const workspaceResult = await client.query<{ id: number }>(
      INSERT_WORKSPACE_SQL,
      [registration.workspaceName],
    );
    const newWorkspaceId = workspaceResult.rows[0].id;

    const userResult = await client.query<{ id: number }>(INSERT_USER_SQL, [
      registration.email,
      registration.passwordHash,
      OWNER_ROLE,
    ]);
    const newUserId = userResult.rows[0].id;

    await client.query(UPDATE_WORKSPACE_OWNER_SQL, [newUserId, newWorkspaceId]);
    await client.query(INSERT_MEMBERSHIP_SQL, [
      newWorkspaceId,
      newUserId,
      OWNER_ROLE,
    ]);

    await client.query("COMMIT");

    return { userId: newUserId, workspaceId: newWorkspaceId };
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError) => {
      connectionIsBroken = true;
      console.error("Rollback failed:", rollbackError);
    });

    throw error;
  } finally {
    client.release(connectionIsBroken);
  }
}
