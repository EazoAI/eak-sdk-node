import { expect } from "vitest";
import {
  EAKError,
  EAKRateLimitError,
  EAKScopes,
  EAKValidationError,
  EazoAgentKit,
} from "../../src";
import type { JsonObject } from "../../src";
import { loadDotEnvLocal, requiredEnv } from "../helpers/env";

loadDotEnvLocal();

export const liveE2EEnabled = process.env.EAK_LIVE_E2E === "1";
export const livePrefix = `sdk-live-${Date.now()}`;

export function liveClient(): EazoAgentKit {
  const host = process.env.EAK_HOST?.trim();
  // Point WebAgent data-plane calls at a different deployment (e.g. a local
  // backend) while delegation/token-exchange stay on the EAK gateway.
  const webAgentBaseUrl = process.env.EAK_WEBAGENT_BASE_URL?.trim();
  return new EazoAgentKit({
    accessKey: requiredEnv("EAK_ACCESS_KEY"),
    secretKey: requiredEnv("EAK_SECRET_KEY"),
    ...(host ? { host } : {}),
    ...(webAgentBaseUrl ? { webAgentBaseUrl } : {}),
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
  options: {
    label?: string;
    minEvents?: number;
    referenceId?: string;
    referenceIdPaths?: readonly (readonly string[])[];
    eventTypes?: readonly string[];
    timeoutMs?: number;
  } = {},
): Promise<T[]> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? Number(process.env.EAK_LIVE_STREAM_TIMEOUT_MS || 15_000),
  );
  const events: T[] = [];
  try {
    for await (const event of iterableFactory(controller.signal)) {
      events.push(event);
      if (events.length >= (options.minEvents || 1)) break;
    }
  } catch (error) {
    if (!controller.signal.aborted || !isAbortError(error)) throw error;
  } finally {
    clearTimeout(timeout);
  }
  expectLiveEvents(events, options);
  return events;
}

export function expectLiveEvents<T>(
  events: T[],
  options: {
    label?: string;
    minEvents?: number;
    referenceId?: string;
    referenceIdPaths?: readonly (readonly string[])[];
    eventTypes?: readonly string[];
  } = {},
) {
  const label = options.label || "live SSE";
  expect(events.length, `${label} should emit events`).toBeGreaterThanOrEqual(
    options.minEvents || 1,
  );

  for (const event of events) {
    const record = asRecord(event);
    expect(record, `${label} event should be an object`).toBeTruthy();
    if (!record) continue;
    const id = typeof record.id === "string" ? record.id : undefined;
    const eventName = typeof record.event === "string" ? record.event : undefined;
    expect(id || eventName || record.data, `${label} event should include id, event, or data`).toBeTruthy();
    expect(record.data, `${label} event data should not be undefined`).not.toBeUndefined();
    if (isRecord(record.data)) {
      expect(Object.keys(record.data).length, `${label} event data should not be empty`).toBeGreaterThan(0);
      if (typeof record.data.type === "string") {
        expect(record.event, `${label} event should mirror data.type`).toBe(record.data.type);
      }
    }
  }

  if (options.referenceId) {
    const paths = options.referenceIdPaths || [
      ["data", "task_id"],
      ["data", "run_id"],
      ["data", "monitor_id"],
      ["data", "session_id"],
      ["data", "data", "task_id"],
      ["data", "data", "run_id"],
      ["data", "data", "monitor_id"],
      ["data", "data", "session_id"],
    ];
    const hasReference = events.some((event) =>
      paths.some((path) => nestedString(event, path) === options.referenceId),
    );
    expect(hasReference, `${label} events should reference ${options.referenceId}`).toBe(true);
  }

  if (options.eventTypes?.length) {
    const seenTypes = events
      .map((event) => nestedString(event, ["data", "type"]) || nestedString(event, ["event"]))
      .filter((type): type is string => Boolean(type));
    expect(
      seenTypes.some((type) => options.eventTypes?.includes(type)),
      `${label} events should include one of ${options.eventTypes.join(", ")}`,
    ).toBe(true);
  }
}

export function livePassword(): string {
  return (
    process.env.EAK_LIVE_TEST_USER_PASSWORD ||
    process.env.GENAUTH_DEMO_USER_PASSWORD ||
    `SdkLive!${Date.now()}Aa1`
  );
}

const liveConstraintMessages = [
  "Out of Credits",
  "concurrent task limit",
  "media object storage is not configured",
] as const;

export function isLiveEnvironmentConstraint(error: unknown): error is EAKError {
  return (
    error instanceof EAKError &&
    liveConstraintMessages.some((message) => error.message.includes(message)) &&
    (error instanceof EAKRateLimitError ||
      error instanceof EAKValidationError ||
      error.name === "EAKError")
  );
}

export async function allowLiveEnvironmentConstraint<T>(
  operation: Promise<T>,
): Promise<T | undefined> {
  try {
    return await operation;
  } catch (error) {
    if (!isLiveEnvironmentConstraint(error)) throw error;
    expect(error.message).toBeTruthy();
    expect(error.code).toBeTruthy();
    return undefined;
  }
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

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nestedString(value: unknown, path: readonly string[]): string | undefined {
  let cursor = value;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor : undefined;
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError");
}
