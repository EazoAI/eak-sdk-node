import { buildSignedHeaders } from "./auth";
import { createDeepResearchNamespace } from "./deep-research";
import { createDoAnythingNamespace } from "./do-anything";
import { createEakNamespace } from "./eak";
import { EAKDelegationRequiredError, errorFromPayload, timeoutError } from "./errors";
import { createGenAuthNamespace } from "./genauth";
import { createGumemNamespace } from "./gumem";
import { createTrackNamespace } from "./track";
import {
  isJsonObject,
  type CompleteDelegateAgentInput,
  type CompleteDelegateTokenInput,
  type DelegateAgentInput,
  type DelegateAgentResponse,
  type DelegateTokenInteractiveInput,
  type DelegateTokenInput,
  type EAKEvent,
  type EAKHttpMethod,
  type EAKOptions,
  type EAKResponse,
  type EAKRuntimeConfig,
  type EAKService,
  type EAKTransport,
  type DelegateTokenResponse,
  type DelegateTokenSilentResponse,
  type DelegateTokenSilentInput,
  type InteractiveDelegationResponse,
  type JsonObject,
  type RawRequestInput,
  type RequestPayload,
} from "./types";
import type { GenAuthAccessTokenInput } from "./genauth";
import { createWebSearchNamespace } from "./web-search";

const DEFAULT_EAK_HOST = "https://eak.eazo.ai/dashboard";

export class EazoAgentKit {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly host: string;
  private runtimeConfigPromise?: Promise<ResolvedRuntimeConfig>;
  private readonly productTokenCache = new Map<string, { token: string; expiresAt: number }>();
  private genAuthAdminTokenCache?: { accessToken: string; userPoolId: string; expiresAt: number };

  readonly gumem: ReturnType<typeof createGumemNamespace>;
  readonly genauth: ReturnType<typeof createGenAuthNamespace>;
  readonly eak: ReturnType<typeof createEakNamespace>;
  readonly webSearch: ReturnType<typeof createWebSearchNamespace>;
  readonly doAnything: ReturnType<typeof createDoAnythingNamespace>;
  readonly track: ReturnType<typeof createTrackNamespace>;
  readonly deepResearch: ReturnType<typeof createDeepResearchNamespace>;

  constructor(private readonly options: EAKOptions) {
    const accessKey = options.accessKey ?? options.accessKeyId;
    const secretKey = options.secretKey ?? options.accessKeySecret;
    const host = options.host ?? options.eakBaseUrl ?? options.genauthBaseUrl ?? DEFAULT_EAK_HOST;
    if (!accessKey || !secretKey) {
      throw new Error("EAK requires accessKey and secretKey");
    }
    this.accessKey = accessKey ?? "";
    this.secretKey = secretKey ?? "";
    this.host = normalizeBaseUrl(host);
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    const transport: EAKTransport = {
      eakJson: (...args) => this.eakJson(...args),
      genauthJson: (...args) => this.genauthJson(...args),
      gumemJson: (...args) => this.gumemJson(...args),
      gumemSSE: (...args) => this.gumemSSE(...args),
      webAgentJson: (...args) => this.webAgentJson(...args),
      webAgentSSE: (...args) => this.webAgentSSE(...args),
    };
    this.genauth = createGenAuthNamespace(transport, {
      adminTokenFor: () => this.genauthAdminTokenFor(),
    });
    this.eak = createEakNamespace(
      transport,
      this.delegateToken.bind(this),
      (input) => this.completeDelegateToken(input),
    );
    this.gumem = createGumemNamespace(transport);
    this.webSearch = createWebSearchNamespace(transport);
    this.doAnything = createDoAnythingNamespace(transport);
    this.track = createTrackNamespace(transport);
    this.deepResearch = createDeepResearchNamespace(transport);
  }

  delegateToken(
    input: DelegateTokenInteractiveInput,
  ): Promise<EAKResponse<InteractiveDelegationResponse>>;
  delegateToken(input: DelegateTokenSilentInput): Promise<EAKResponse<DelegateTokenSilentResponse>>;
  delegateToken(input: DelegateTokenInput): Promise<EAKResponse<DelegateAgentResponse>>;
  delegateToken(input: DelegateTokenInput): Promise<EAKResponse<DelegateAgentResponse>> {
    return this.signedPost<DelegateAgentResponse>(
      "/api/v3/eak/delegations",
      normalizeDelegateTokenInput(input),
    ).then(normalizeDelegateAgentTokenResponse);
  }

  /** @deprecated Use delegateToken. */
  delegateAgent(input: DelegateAgentInput): Promise<EAKResponse<DelegateAgentResponse>> {
    return this.delegateToken(input);
  }

  completeDelegateToken(
    input: CompleteDelegateTokenInput,
  ): Promise<EAKResponse<DelegateTokenResponse>> {
    return this.signedPost<DelegateTokenResponse>(
      "/api/v3/eak/delegations/complete",
      input,
    ).then(
      normalizeDelegateAgentTokenResponse,
    );
  }

  /** @deprecated Use completeDelegateToken. */
  completeDelegateAgent(
    input: CompleteDelegateAgentInput,
  ): Promise<EAKResponse<DelegateTokenResponse>> {
    return this.completeDelegateToken(input);
  }

  currentUser<T = unknown>(input: GenAuthAccessTokenInput): Promise<EAKResponse<T>> {
    return this.genauth.userInfo<T>(input);
  }

  request<T = unknown>(input: RawRequestInput): Promise<EAKResponse<T>> {
    return this.unstableRequest<T>(input);
  }

  unstableRequest<T = unknown>(input: RawRequestInput): Promise<EAKResponse<T>> {
    return this.baseUrlFor("eak").then((baseUrl) => this.jsonRequest<T>(baseUrl, input.path, {
      method: input.method,
      token: input.token,
      query: input.query,
      body: input.body,
      headers: input.headers,
      service: "eak",
    }));
  }

  private eakJson<T>(
    method: EAKHttpMethod,
    path: string,
    token?: string,
    payload: RequestPayload = {},
  ): Promise<EAKResponse<T>> {
    return this.baseUrlFor("eak").then((baseUrl) => this.jsonRequest<T>(baseUrl, path, {
      ...payload,
      method,
      token,
      service: "eak",
    }));
  }

  private genauthJson<T>(
    method: EAKHttpMethod,
    path: string,
    token?: string,
    payload: RequestPayload = {},
  ): Promise<EAKResponse<T>> {
    return this.baseUrlFor("genauth").then((baseUrl) => this.jsonRequest<T>(baseUrl, path, {
      ...payload,
      method,
      token,
      service: "genauth",
    }));
  }

  private async gumemJson<T>(
    method: EAKHttpMethod,
    path: string,
    token?: string,
    payload: RequestPayload = {},
  ): Promise<EAKResponse<T>> {
    const runtimeToken = await this.productTokenFor("gumem", token, payload.requiredScopes);
    const baseUrl = await this.baseUrlFor("gumem");
    return this.jsonRequest<T>(baseUrl, path, {
      ...payload,
      method,
      token: runtimeToken,
      service: "gumem",
    });
  }

  private async *gumemSSE<T>(
    path: string,
    token?: string,
    payload: RequestPayload & { lastEventId?: string; signal?: AbortSignal } = {},
  ): AsyncIterable<EAKEvent<T>> {
    const runtimeToken = await this.productTokenFor("gumem", token, payload.requiredScopes);
    const baseUrl = await this.baseUrlFor("gumem");
    for await (const event of this.sseRequest<T>(baseUrl, path, {
      ...payload,
      token: runtimeToken,
      service: "gumem",
    })) {
      yield event;
    }
  }

  private async webAgentJson<T>(
    method: EAKHttpMethod,
    path: string,
    token?: string,
    payload: RequestPayload = {},
  ): Promise<EAKResponse<T>> {
    const runtimeToken = await this.productTokenFor("webagent", token, payload.requiredScopes);
    const baseUrl = await this.baseUrlFor("webagent");
    return this.jsonRequest<T>(
      baseUrl,
      this.webAgentPath(runtimeToken, path),
      { ...payload, method, token: runtimeToken, service: "webagent" },
    );
  }

  private async *webAgentSSE<T>(
    path: string,
    token?: string,
    payload: RequestPayload & { lastEventId?: string; signal?: AbortSignal } = {},
  ): AsyncIterable<EAKEvent<T>> {
    const runtimeToken = await this.productTokenFor("webagent", token, payload.requiredScopes);
    const baseUrl = await this.baseUrlFor("webagent");
    for await (const event of this.sseRequest<T>(
      baseUrl,
      this.webAgentPath(runtimeToken, path),
      { ...payload, token: runtimeToken, service: "webagent" },
    )) {
      yield event;
    }
  }

  private async signedPost<T>(pathname: string, body: object): Promise<EAKResponse<T>> {
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
    return this.jsonRequest<T>(await this.baseUrlFor("eak"), pathname, {
      method: "POST",
      body: payload,
      headers,
      service: "eak",
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
    const response = await this.fetchWithTimeout(
      urlWithBasePath(baseUrl, pathname, options.query),
      {
        method: options.method,
        headers: requestHeaders(options),
        body: requestBody(options.body),
      },
    );
    const payload = await readJson(response);
    if (!response.ok) {
      throw errorFromPayload(
        response.status,
        payload,
        `EAK request failed with HTTP ${response.status}`,
      );
    }
    const envelopeStatus = errorEnvelopeStatus(payload);
    if (envelopeStatus !== undefined) {
      throw errorFromPayload(
        envelopeStatus,
        payload,
        `EAK request failed with statusCode ${envelopeStatus}`,
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
      signal?: AbortSignal;
    },
  ): AsyncIterable<EAKEvent<T>> {
    const response = await this.fetchWithTimeout(
      urlWithBasePath(baseUrl, pathname, options.query),
      {
        method: "GET",
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${options.token}`,
          ...(options.headers || {}),
          ...(options.lastEventId ? { "last-event-id": options.lastEventId } : {}),
        },
      },
      options.signal,
    );
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

  private async fetchWithTimeout(
    input: URL,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    const controller = new AbortController();
    const resolved = resolveLocalGenauthRequest(input);
    const requestInit = resolved.hostHeader
      ? {
          ...init,
          headers: withHostHeader(init.headers, resolved.hostHeader),
        }
      : init;
    let didTimeout = false;
    const abortFromSignal = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abortFromSignal, { once: true });
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      return await this.fetchImpl(resolved.url, { ...requestInit, signal: controller.signal });
    } catch (error) {
      if (isAbortError(error) && didTimeout) throw timeoutError(error);
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromSignal);
    }
  }

  private async baseUrlFor(service: EAKService): Promise<string> {
    const explicit = this.explicitBaseUrlFor(service);
    if (explicit) return explicit;
    const runtime = await this.runtimeConfig();
    if (service === "eak") return runtime.eakBaseUrl ?? this.host;
    const hostOrigin = originBaseUrl(this.host);
    if (service === "genauth") return runtime.genauthBaseUrl ?? hostOrigin;
    if (service === "gumem") return runtime.gumemBaseUrl ?? hostOrigin;
    return runtime.webAgentBaseUrl ?? hostOrigin;
  }

  private explicitBaseUrlFor(service: EAKService): string | undefined {
    if (service === "eak") {
      const value = this.options.eakBaseUrl ?? this.options.genauthBaseUrl;
      return value ? normalizeBaseUrl(value) : undefined;
    }
    if (service === "genauth" && this.options.genauthBaseUrl) {
      return normalizeBaseUrl(this.options.genauthBaseUrl);
    }
    if (service === "genauth") {
      const value = serviceHostOption(this.options, "genauth");
      return value ? normalizeBaseUrl(value) : undefined;
    }
    if (service === "gumem" && this.options.gumemBaseUrl) {
      return normalizeBaseUrl(this.options.gumemBaseUrl);
    }
    if (service === "gumem") {
      const value = serviceHostOption(this.options, "gumem");
      return value ? normalizeBaseUrl(value) : undefined;
    }
    if (service === "webagent" && this.options.webAgentBaseUrl) {
      return normalizeBaseUrl(this.options.webAgentBaseUrl);
    }
    if (service === "webagent") {
      const value = serviceHostOption(this.options, "webagent");
      return value ? normalizeBaseUrl(value) : undefined;
    }
    return undefined;
  }

  private runtimeConfig(): Promise<ResolvedRuntimeConfig> {
    this.runtimeConfigPromise ??= this.fetchRuntimeConfig();
    return this.runtimeConfigPromise;
  }

  private async fetchRuntimeConfig(): Promise<ResolvedRuntimeConfig> {
    const pathname = "/api/v3/eak/runtime-config";
    const headers = buildSignedHeaders(
      {
        accessKey: this.accessKey,
        secretKey: this.secretKey,
      },
      "GET",
      pathname,
      {},
    );
    const response = await this.fetchWithTimeout(
      urlWithBasePath(this.host, pathname),
      {
        method: "GET",
        headers: {
          accept: "application/json",
          ...headers,
        },
      },
    );
    const payload = await readJson(response);
    if (!response.ok) {
      throw errorFromPayload(
        response.status,
        payload,
        `EAK runtime config request failed with HTTP ${response.status}`,
      );
    }
    return normalizeRuntimeConfig(payload);
  }

  private webAgentPath(token: string, path: string): string {
    const normalized = normalizePath(path);
    if (normalized.startsWith("/api/v1/projects/")) return normalized;
    // The tenant is carried by the delegation token (a JWT).
    const tenantId = requiredWebAgentTenantId(token);
    return `/api/v1/projects/${encodeURIComponent(tenantId)}${normalized}`;
  }

  private async productTokenFor(
    service: "gumem" | "webagent",
    token: string | undefined,
    requiredScopes: readonly string[] | undefined,
  ): Promise<string> {
    const runtimeToken = requiredRuntimeToken(token);
    if (!isEakDelegationToken(runtimeToken)) return runtimeToken;

    const scopes = [...(requiredScopes || [])].sort();
    const cacheKey = [service, runtimeToken, scopes.join(" ")].join(":");
    const cached = this.productTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

    const response = await this.signedPost<unknown>("/api/v3/eak/token-exchange", {
      subjectToken: runtimeToken,
      resource: service === "gumem" ? "gumem" : "webagent",
      scopes,
    });
    const payload = response.data;
    const accessToken = readAccessToken(payload);
    if (!accessToken) {
      throw errorFromPayload(
        502,
        payload,
        "EAK product token exchange response did not include an access token",
      );
    }

    this.productTokenCache.set(cacheKey, {
      token: accessToken,
      expiresAt: Date.now() + Math.max(0, readExpiresIn(payload) ?? 3600) * 1000,
    });
    return accessToken;
  }

  private async genauthAdminTokenFor(): Promise<{ accessToken: string; userPoolId: string }> {
    const cached = this.genAuthAdminTokenCache;
    if (cached && cached.expiresAt > Date.now() + 30_000) {
      return { accessToken: cached.accessToken, userPoolId: cached.userPoolId };
    }

    const response = await this.signedPost<unknown>("/api/v3/eak/genauth/admin-token", {});
    const payload = response.data;
    const accessToken = readAccessToken(payload);
    const userPoolId =
      readString(payload, "userPoolId") ??
      readString(payload, "userpoolId") ??
      readString(payload, "user_pool_id");
    if (!accessToken || !userPoolId) {
      throw errorFromPayload(
        502,
        payload,
        "EAK GenAuth admin-token response did not include accessToken and userPoolId",
      );
    }

    this.genAuthAdminTokenCache = {
      accessToken,
      userPoolId,
      expiresAt: Date.now() + Math.max(0, readExpiresIn(payload) ?? 3600) * 1000,
    };
    return { accessToken, userPoolId };
  }
}

export { EazoAgentKit as EAK };

interface ResolvedRuntimeConfig {
  eakBaseUrl?: string;
  genauthBaseUrl?: string;
  gumemBaseUrl?: string;
  webAgentBaseUrl?: string;
}

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

function urlWithBasePath(baseUrl: string, pathname: string, query?: JsonObject): URL {
  const base = new URL(baseUrl);
  const basePath = base.pathname === "/" ? "" : base.pathname.replace(/\/+$/, "");
  const normalizedPath = normalizePath(pathname);
  const fullPath =
    basePath && (normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`))
      ? normalizedPath
      : `${basePath}${normalizedPath}`;
  return urlWithQuery(base.origin, fullPath, query);
}

function resolveLocalGenauthRequest(input: URL): { url: URL; hostHeader?: string } {
  const url = new URL(input.toString());
  if (
    process.env.EAK_LOCAL_GENAUTH_REWRITE === "false" ||
    url.protocol !== "http:" ||
    !url.hostname.endsWith(".genauth.localhost")
  ) {
    return { url };
  }

  const hostHeader = url.host;
  url.hostname = process.env.EAK_LOCAL_GENAUTH_TARGET_HOST || "127.0.0.1";
  return { url, hostHeader };
}

function withHostHeader(headers: HeadersInit | undefined, hostHeader: string): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    out[key] = value;
  });
  out.Host = hostHeader;
  return out;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeBaseUrl(host: string): string {
  const withProtocol = /^https?:\/\//i.test(host) ? host : `https://${host}`;
  return withProtocol.replace(/\/+$/, "");
}

function originBaseUrl(host: string): string {
  return new URL(host).origin;
}

function serviceHostOption(
  options: EAKOptions,
  service: Exclude<EAKService, "eak">,
): string | undefined {
  if (service === "genauth") {
    return options.genauthHost;
  }
  if (service === "gumem") {
    return options.gumemHost;
  }
  return options.webAgentHost;
}

function normalizeRuntimeConfig(payload: unknown): ResolvedRuntimeConfig {
  const data = envelopeData(payload);
  if (!isJsonObject(data)) return {};
  const config = data as EAKRuntimeConfig;
  return {
    eakBaseUrl: runtimeServiceUrl(config, "eak", "eakBaseUrl"),
    genauthBaseUrl: runtimeServiceUrl(config, "genauth", "genauthBaseUrl"),
    gumemBaseUrl: runtimeServiceUrl(config, "gumem", "gumemBaseUrl"),
    webAgentBaseUrl:
      runtimeServiceUrl(config, "webAgent", "webAgentBaseUrl") ??
      runtimeServiceUrl(config, "webagent", "webAgentBaseUrl"),
  };
}

function envelopeData(payload: unknown): unknown {
  if (isJsonObject(payload) && "data" in payload) return payload.data;
  return payload;
}

function runtimeServiceUrl(
  config: EAKRuntimeConfig,
  service: keyof NonNullable<EAKRuntimeConfig["services"]>,
  topLevelKey: keyof EAKRuntimeConfig,
): string | undefined {
  const topLevel = config[topLevelKey];
  if (typeof topLevel === "string" && topLevel.trim()) return normalizeBaseUrl(topLevel);
  const serviceValue = config.services?.[service];
  if (typeof serviceValue === "string" && serviceValue.trim()) {
    return normalizeBaseUrl(serviceValue);
  }
  if (isJsonObject(serviceValue)) {
    for (const key of ["baseUrl", "url", "host"] as const) {
      const value = serviceValue[key];
      if (typeof value === "string" && value.trim()) return normalizeBaseUrl(value);
    }
  }
  return undefined;
}

function toRecord(value: object): JsonObject {
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item;
  }
  return out;
}

function normalizeDelegateTokenInput(input: DelegateTokenInput): JsonObject {
  const body = toRecord(input);
  if (!body.userId && isJsonObject(input.user) && typeof input.user.id === "string") {
    body.userId = input.user.id;
  }
  return body;
}

function errorEnvelopeStatus(payload: unknown): number | undefined {
  if (!isJsonObject(payload)) return undefined;
  const statusCode = payload.statusCode;
  if (typeof statusCode !== "number" || statusCode < 400) return undefined;
  if ("data" in payload && payload.data !== undefined) return undefined;
  return statusCode;
}

function decodeJwtPayload(token: string): JsonObject {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("token is not a JWT");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JsonObject;
}

function safeDecodeJwtPayload(token: string): JsonObject | undefined {
  try {
    return decodeJwtPayload(token);
  } catch {
    return undefined;
  }
}

function isEakDelegationToken(token: string): boolean {
  return safeDecodeJwtPayload(token)?.token_type === "eak_delegation_token";
}

function readAccessToken(payload: unknown): string | undefined {
  if (!isJsonObject(payload)) return undefined;
  for (const key of ["accessToken", "access_token", "token"]) {
    const token = payload[key];
    if (typeof token === "string" && token.trim()) return token;
  }
  return undefined;
}

function readExpiresIn(payload: unknown): number | undefined {
  if (!isJsonObject(payload)) return undefined;
  const expiresIn = payload.expiresIn ?? payload.expires_in;
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn)) return expiresIn;
  if (typeof expiresIn === "string" && expiresIn.trim()) {
    const parsed = Number(expiresIn);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readString(payload: unknown, key: string): string | undefined {
  if (!isJsonObject(payload)) return undefined;
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requiredWebAgentTenantId(token: string): string {
  const payload = decodeJwtPayload(token);
  const productResource = payload.product_resource;
  if (isJsonObject(productResource) && productResource.type === "webagent_tenant") {
    const id = productResource.id;
    if (typeof id === "string" && id.trim()) return id;
  }
  const resourceBindingTenantId = nestedString(payload, [
    "resource_bindings",
    "webagent",
    "tenant_id",
  ]);
  if (resourceBindingTenantId) return resourceBindingTenantId;
  const tenantId = payload.webagent_tenant_id;
  if (typeof tenantId === "string" && tenantId.trim()) return tenantId;
  const projectId = payload.webagent_project_id;
  if (typeof projectId === "string" && projectId.trim()) return projectId;
  throw new Error("token is missing WebAgent tenant binding");
}

function nestedString(value: unknown, path: readonly string[]): string | undefined {
  let cursor = value;
  for (const segment of path) {
    if (!isJsonObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor : undefined;
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

function requiredRuntimeToken(token: string | undefined): string {
  if (token && token.trim()) return token;
  throw new EAKDelegationRequiredError(
    "Product capability calls require an explicit token in the token field",
  );
}

function normalizeDelegateAgentTokenResponse<T extends DelegateAgentResponse>(
  response: EAKResponse<T>,
): EAKResponse<T> {
  if (!isJsonObject(response.data)) return response;
  const grantState =
    typeof response.data.grantState === "string"
      ? response.data.grantState
      : typeof response.data.state === "string"
        ? response.data.state
        : typeof response.data.grantId === "string"
          ? response.data.grantId
          : undefined;
  if (typeof response.data.authorizationUrl === "string" && grantState) {
    return {
      ...response,
      data: {
        ...response.data,
        grantState,
        state: grantState,
      } as T,
    };
  }
  const token =
    typeof response.data.delegateAgentToken === "string"
      ? response.data.delegateAgentToken
      : typeof response.data.delegationToken === "string"
        ? response.data.delegationToken
        : typeof response.data.token === "string"
          ? response.data.token
          : undefined;
  if (!token) return response;
  return {
    ...response,
    data: {
      ...response.data,
      token,
      delegateAgentToken: token,
    } as T,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
