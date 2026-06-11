import { EAKScopes, EazoAgentKit } from "../../src";
import type { JsonObject } from "../../src";
import { loadDotEnvLocal, requiredEnv } from "../helpers/env";

loadDotEnvLocal();

export const liveE2EEnabled = process.env.EAK_LIVE_E2E === "1";
export const livePrefix = `sdk-live-${Date.now()}`;

export function liveClient(): EazoAgentKit {
  const host = process.env.EAK_HOST?.trim();
  return new EazoAgentKit({
    accessKey: requiredEnv("EAK_ACCESS_KEY"),
    secretKey: requiredEnv("EAK_SECRET_KEY"),
    ...(host ? { host } : {}),
    timeoutMs: Number(process.env.EAK_TIMEOUT_MS || 120_000),
  });
}

export async function resolveLiveUserId(client: EazoAgentKit): Promise<string> {
  const listed = await client.genauth.users.list({ page: 1, limit: 1 });
  const userId = firstUserId(listed.data);
  if (userId) return userId;
  throw new Error("EAK live e2e could not resolve a real GenAuth user from users.list");
}

export async function delegateLiveToken(
  client: EazoAgentKit,
  scopes: readonly string[],
): Promise<{ token: string; userId: string }> {
  const userId = await resolveLiveUserId(client);
  const delegated = await client.delegateToken({
    mode: "silent",
    user: { id: userId },
    agent: requiredEnv("EAK_AGENT_ID"),
    scopes,
    expiresIn: Number(process.env.EAK_DELEGATION_EXPIRES_IN || 3600),
  });
  return { token: delegated.data.token, userId };
}

export const gumemScopes = [
  EAKScopes.GUMEM_MEMORY_READ,
  EAKScopes.GUMEM_MEMORY_WRITE,
  EAKScopes.GUMEM_MESSAGE_WRITE,
  EAKScopes.GUMEM_ACTION_READ,
  EAKScopes.GUMEM_ACTION_WRITE,
  EAKScopes.GUMEM_RESOURCE_WRITE,
] as const;

export const webSearchScopes = [
  EAKScopes.WEB_SEARCH_RUN,
  EAKScopes.WEB_SEARCH_READ,
  EAKScopes.WEB_SEARCH_STOP,
] as const;

export const doAnythingScopes = [
  EAKScopes.DO_ANYTHING_RUN,
  EAKScopes.DO_ANYTHING_READ,
  EAKScopes.DO_ANYTHING_STOP,
  EAKScopes.DO_ANYTHING_CONTROL,
] as const;

export const trackScopes = [
  EAKScopes.TRACK_RUN,
  EAKScopes.TRACK_READ,
  EAKScopes.TRACK_MANAGE,
] as const;

export const deepResearchScopes = [
  EAKScopes.DEEP_RESEARCH_RUN,
  EAKScopes.DEEP_RESEARCH_READ,
  EAKScopes.DEEP_RESEARCH_STOP,
  EAKScopes.DEEP_RESEARCH_CONTROL,
] as const;

export function extractId(data: unknown, label: string): string {
  const value = findString(data, [
    "id",
    "userId",
    "user_id",
    "runId",
    "run_id",
    "sessionId",
    "session_id",
    "monitorId",
    "monitor_id",
    "artifactId",
    "artifact_id",
  ]);
  if (value) return value;
  throw new Error(`EAK live e2e could not read ${label} id from ${JSON.stringify(data)}`);
}

export async function collectSomeEvents<T>(
  iterableFactory: (signal: AbortSignal) => AsyncIterable<T>,
): Promise<T[]> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.EAK_LIVE_STREAM_TIMEOUT_MS || 15_000),
  );
  const events: T[] = [];
  try {
    for await (const event of iterableFactory(controller.signal)) {
      events.push(event);
      if (events.length >= 1) break;
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(timeout);
  }
  return events;
}

export function livePassword(): string {
  return (
    process.env.EAK_LIVE_TEST_USER_PASSWORD ||
    process.env.GENAUTH_DEMO_USER_PASSWORD ||
    `SdkLive!${Date.now()}Aa1`
  );
}

export function firstUserId(data: unknown): string | undefined {
  const arrays = [
    data,
    asRecord(data)?.list,
    asRecord(data)?.users,
    asRecord(data)?.items,
    asRecord(data)?.data,
  ];
  for (const candidate of arrays) {
    if (Array.isArray(candidate) && candidate.length) {
      const id = findString(candidate[0], ["userId", "id", "user_id", "sub", "username"]);
      if (id) return id;
    }
  }
  return findString(data, ["userId", "id", "user_id", "sub", "username"]);
}

export function firstArtifactId(data: unknown): string | undefined {
  const arrays = [
    data,
    asRecord(data)?.list,
    asRecord(data)?.items,
    asRecord(data)?.artifacts,
    asRecord(data)?.data,
  ];
  for (const candidate of arrays) {
    if (Array.isArray(candidate) && candidate.length) {
      const id = findString(candidate[0], ["artifactId", "artifact_id", "id"]);
      if (id) return id;
    }
  }
  return findString(data, ["artifactId", "artifact_id", "id"]);
}

function findString(value: unknown, keys: readonly string[]): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

function asRecord(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}
