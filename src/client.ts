import { buildSignedHeaders } from "./auth";
import { createDoAnythingNamespace } from "./do-anything";
import { errorFromPayload, timeoutError } from "./errors";
import { createGumemNamespace } from "./gumem";
import { createTrackNamespace } from "./track";
import {
  isJsonObject,
  type CompleteDelegateAgentInput,
  type DelegateAgentInput,
  type DelegateAgentResponse,
  type EAKEvent,
  type EAKHttpMethod,
  type EAKOptions,
  type EAKResponse,
  type EAKService,
  type EAKTransport,
  type JsonObject,
  type RawRequestInput,
  type RequestPayload,
} from "./types";
import { createWebSearchNamespace } from "./web-search";

export class EazoAgentKit {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly host: string;

  readonly gumem: ReturnType<typeof createGumemNamespace>;
  readonly webSearch: ReturnType<typeof createWebSearchNamespace>;
  readonly doAnything: ReturnType<typeof createDoAnythingNamespace>;
  readonly track: ReturnType<typeof createTrackNamespace>;

  constructor(private readonly options: EAKOptions) {
    const accessKey = options.accessKey ?? options.accessKeyId;
    const secretKey = options.secretKey ?? options.accessKeySecret;
    const host = options.host ?? options.genauthBaseUrl;
    if (!accessKey || !secretKey) {
      throw new Error("EAK accessKey and secretKey are required");
    }
    if (!host) {
      throw new Error("host is required");
    }
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.host = normalizeBaseUrl(host);
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    const transport: EAKTransport = {
      gumemJson: (...args) => this.gumemJson(...args),
      gumemSSE: (...args) => this.gumemSSE(...args),
      webAgentJson: (...args) => this.webAgentJson(...args),
      webAgentSSE: (...args) => this.webAgentSSE(...args),
    };
    this.gumem = createGumemNamespace(transport);
    this.webSearch = createWebSearchNamespace(transport);
    this.doAnything = createDoAnythingNamespace(transport);
    this.track = createTrackNamespace(transport);
  }

  delegateAgent(
    input: DelegateAgentInput,
  ): Promise<EAKResponse<DelegateAgentResponse>> {
    return this.signedPost<DelegateAgentResponse>("/api/v3/eak/delegations", input).then(
      normalizeDelegateAgentTokenResponse,
    );
  }

  completeDelegateAgent(
    input: CompleteDelegateAgentInput,
  ): Promise<EAKResponse<Exclude<DelegateAgentResponse, { authorizationUrl: string }>>> {
    return this.signedPost<Exclude<DelegateAgentResponse, { authorizationUrl: string }>>(
      "/api/v3/eak/delegations/complete",
      input,
    ).then(
      normalizeDelegateAgentTokenResponse,
    );
  }

  request<T = unknown>(input: RawRequestInput): Promise<EAKResponse<T>> {
    return this.unstableRequest<T>(input);
  }

  unstableRequest<T = unknown>(input: RawRequestInput): Promise<EAKResponse<T>> {
    return this.jsonRequest<T>(this.host, input.path, {
      method: input.method,
      token: input.token,
      query: input.query,
      body: input.body,
      headers: input.headers,
      service: "eak",
    });
  }

  private gumemJson<T>(
    method: EAKHttpMethod,
    path: string,
    token: string,
    payload: RequestPayload = {},
  ): Promise<EAKResponse<T>> {
    return this.jsonRequest<T>(this.requireBaseUrl("gumemBaseUrl"), path, {
      ...payload,
      method,
      token,
      service: "gumem",
    });
  }

  private gumemSSE<T>(
    path: string,
    token: string,
    payload: RequestPayload & { lastEventId?: string } = {},
  ): AsyncIterable<EAKEvent<T>> {
    return this.sseRequest<T>(this.requireBaseUrl("gumemBaseUrl"), path, {
      ...payload,
      token,
      service: "gumem",
    });
  }

  private webAgentJson<T>(
    method: EAKHttpMethod,
    path: string,
    token: string,
    payload: RequestPayload = {},
  ): Promise<EAKResponse<T>> {
    return this.jsonRequest<T>(
      this.requireBaseUrl("webAgentBaseUrl"),
      this.webAgentPath(token, path),
      { ...payload, method, token, service: "webagent" },
    );
  }

  private webAgentSSE<T>(
    path: string,
    token: string,
    payload: RequestPayload & { lastEventId?: string } = {},
  ): AsyncIterable<EAKEvent<T>> {
    return this.sseRequest<T>(
      this.requireBaseUrl("webAgentBaseUrl"),
      this.webAgentPath(token, path),
      { ...payload, token, service: "webagent" },
    );
  }

  private signedPost<T>(pathname: string, body: object): Promise<EAKResponse<T>> {
    const payload = toRecord(body);
    const headers = buildSignedHeaders(
      {
        accessKey: this.accessKey,
        secretKey: this.secretKey,
      },
      "POST",
      pathname,
      payload,
    );
    return this.jsonRequest<T>(this.baseUrlFor("genauth"), pathname, {
      method: "POST",
      body: payload,
      headers,
      service: "genauth",
      signed: true,
    });
  }

  private async jsonRequest<T>(
    baseUrl: string,
    pathname: string,
    options: RequestPayload & {
      method: EAKHttpMethod;
      token?: string;
      service: EAKService;
      signed?: boolean;
    },
  ): Promise<EAKResponse<T>> {
    const response = await this.fetchWithTimeout(urlWithQuery(baseUrl, pathname, options.query), {
      method: options.method,
      headers: requestHeaders(options),
      body: requestBody(options.body),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw errorFromPayload(
        response.status,
        payload,
        `EAK request failed with HTTP ${response.status}`,
      );
    }
    return normalizeResponse<T>(payload, options.service);
  }

  private async *sseRequest<T>(
    baseUrl: string,
    pathname: string,
    options: RequestPayload & {
      token: string;
      service: EAKService;
      lastEventId?: string;
    },
  ): AsyncIterable<EAKEvent<T>> {
    const response = await this.fetchWithTimeout(urlWithQuery(baseUrl, pathname, options.query), {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${options.token}`,
        ...(options.headers || {}),
        ...(options.lastEventId ? { "last-event-id": options.lastEventId } : {}),
      },
    });
    if (!response.ok) {
      throw errorFromPayload(
        response.status,
        await readJson(response),
        `EAK stream failed with HTTP ${response.status}`,
      );
    }
    if (!response.body) {
      throw errorFromPayload(502, undefined, "EAK stream response has no body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const event = parseSSEEvent<T>(chunk);
          if (event) yield event;
        }
      }
      const finalEvent = parseSSEEvent<T>(buffer);
      if (finalEvent) yield finalEvent;
    } finally {
      reader.releaseLock();
    }
  }

  private async fetchWithTimeout(input: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (isAbortError(error)) throw timeoutError(error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private baseUrlFor(service: EAKService): string {
    if (service === "eak") return this.host;
    if (service === "genauth") return normalizeBaseUrl(this.options.genauthBaseUrl ?? this.host);
    if (service === "gumem") return normalizeBaseUrl(this.options.gumemBaseUrl ?? this.host);
    return normalizeBaseUrl(this.options.webAgentBaseUrl ?? this.host);
  }

  private requireBaseUrl(key: "gumemBaseUrl" | "webAgentBaseUrl"): string {
    return this.baseUrlFor(key === "gumemBaseUrl" ? "gumem" : "webagent");
  }

  private webAgentPath(token: string, path: string): string {
    const normalized = normalizePath(path);
    if (normalized.startsWith("/api/v1/projects/")) return normalized;
    const tenantId = requiredClaim(token, "webagent_tenant_id");
    return `/api/v1/projects/${encodeURIComponent(tenantId)}${normalized}`;
  }
}

export const EAK = EazoAgentKit;
export const EzaoAgentKit = EazoAgentKit;

function requestHeaders(
  options: RequestPayload & { token?: string; signed?: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(options.headers || {}),
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined && !isBodyInit(options.body) && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  return headers;
}

function requestBody(body: RequestPayload["body"]): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (isBodyInit(body)) return body;
  return JSON.stringify(body);
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    value instanceof ArrayBuffer ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams
  );
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}

function normalizeResponse<T>(payload: unknown, _service: EAKService): EAKResponse<T> {
  if (isJsonObject(payload) && ("data" in payload || "meta" in payload)) {
    return {
      data: ("data" in payload ? payload.data : payload) as T,
      meta: {
        ...(isJsonObject(payload.meta) ? payload.meta : {}),
        ...topLevelMeta(payload),
      },
    };
  }
  return { data: payload as T, meta: {} };
}

function topLevelMeta(payload: JsonObject): JsonObject {
  const meta: JsonObject = {};
  for (const key of ["requestId", "traceId", "auditId"]) {
    if (typeof payload[key] === "string") meta[key] = payload[key];
  }
  return meta;
}

function urlWithQuery(baseUrl: string, pathname: string, query?: JsonObject): URL {
  const url = new URL(normalizePath(pathname), baseUrl);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeBaseUrl(host: string): string {
  const withProtocol = /^https?:\/\//i.test(host) ? host : `https://${host}`;
  return withProtocol.replace(/\/+$/, "");
}

function toRecord(value: object): JsonObject {
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item;
  }
  return out;
}

function decodeJwtPayload(token: string): JsonObject {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("delegateAgentToken is not a JWT");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JsonObject;
}

function requiredClaim(token: string, name: string): string {
  const value = decodeJwtPayload(token)[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`delegateAgentToken is missing ${name}`);
  }
  return value;
}

function parseSSEEvent<T>(chunk: string): EAKEvent<T> | null {
  const lines = chunk.split(/\r?\n/);
  let id: string | undefined;
  let event: string | undefined;
  const data: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    const index = line.indexOf(":");
    const field = index >= 0 ? line.slice(0, index) : line;
    const value = index >= 0 ? line.slice(index + 1).replace(/^ /, "") : "";
    if (field === "id") id = value;
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  if (!id && !event && !data.length) return null;
  return { id, event, data: parseEventData<T>(data.join("\n")) };
}

function parseEventData<T>(raw: string): T {
  if (!raw) return undefined as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}

function normalizeDelegateAgentTokenResponse<T extends DelegateAgentResponse>(
  response: EAKResponse<T>,
): EAKResponse<T> {
  if (!isJsonObject(response.data)) return response;
  if (typeof response.data.delegateAgentToken === "string") return response;
  if (typeof response.data.delegationToken !== "string") return response;
  return {
    ...response,
    data: {
      ...response.data,
      delegateAgentToken: response.data.delegationToken,
    } as T,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
