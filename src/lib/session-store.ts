import "server-only";

import { randomUUID } from "node:crypto";

import { createClient, type RedisClientType } from "redis";

import { isUuid } from "./identifiers.ts";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const SESSION_KEY_PREFIX = "marekto:auth:active:";

let redisClient: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;

function getRedisUrl(): string {
  const url = process.env.REDIS_URL?.trim();

  if (!url) {
    throw new Error("REDIS_URL is required for authentication sessions");
  }

  return url;
}

function sessionKey(userId: string): string {
  if (!isUuid(userId)) {
    throw new Error("Invalid session user id");
  }

  return `${SESSION_KEY_PREFIX}${userId}`;
}

async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient?.isReady) {
    return redisClient;
  }

  if (!connectPromise) {
    const client = createClient({ url: getRedisUrl() });
    client.on("error", (error) => {
      console.error("Redis session store error:", error.message);
    });

    connectPromise = client.connect().then(() => {
      redisClient = client as RedisClientType;
      return redisClient;
    }).catch((error) => {
      connectPromise = null;
      void client.destroy();
      throw error;
    });
  }

  return connectPromise;
}

export async function createActiveSession(userId: string): Promise<string> {
  const client = await getRedisClient();
  const sessionId = randomUUID();

  await client.set(sessionKey(userId), sessionId, { EX: SESSION_TTL_SECONDS });
  return sessionId;
}

export async function isActiveSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  if (!isUuid(sessionId)) {
    return false;
  }

  const client = await getRedisClient();
  return (await client.get(sessionKey(userId))) === sessionId;
}

export async function touchActiveSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  if (!(await isActiveSession(userId, sessionId))) {
    return false;
  }

  const client = await getRedisClient();
  await client.expire(sessionKey(userId), SESSION_TTL_SECONDS);
  return true;
}

export async function revokeActiveSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  if (!isUuid(sessionId)) {
    return;
  }

  const client = await getRedisClient();
  await client.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    { keys: [sessionKey(userId)], arguments: [sessionId] },
  );
}

export async function invalidateAllUserSessions(userId: string): Promise<void> {
  const client = await getRedisClient();
  await client.set(sessionKey(userId), randomUUID(), { EX: SESSION_TTL_SECONDS });
}

export async function consumeRateLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<boolean> {
  const client = await getRedisClient();
  const key = `marekto:rate-limit:${input.key}`;
  const count = await client.incr(key);

  if (count === 1) {
    await client.expire(key, input.windowSeconds);
  }

  return count <= input.limit;
}
