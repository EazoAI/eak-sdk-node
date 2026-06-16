export const EAKScopes = {
  GUMEM_SESSION_CREATE: "gumem.session:create",
  GUMEM_MESSAGE_WRITE: "gumem.message:write",
  GUMEM_MEMORY_READ: "gumem.memory:read",
  GUMEM_MEMORY_WRITE: "gumem.memory:write",
  GUMEM_MEMORY_DELETE: "gumem.memory:delete",
  GUMEM_SEARCH_RUN: "gumem.search:run",
  GUMEM_ADMIN_MANAGE: "gumem.admin:manage",
  GUMEM_RESOURCE_WRITE: "gumem.resource:write",
  GUMEM_ACTION_WRITE: "gumem.action:write",
  GUMEM_ACTION_READ: "gumem.action:read",
  GUMEM_PROFILE_READ: "gumem.profile:read",

  // WebAgent products: exactly two verbs per product — `read` (observe) and
  // `manage` (anything that changes execution state). See
  // wa/docs/eak-sdk-public-surface.md §3.
  DO_ANYTHING_READ: "webagent.do_anything:read",
  DO_ANYTHING_MANAGE: "webagent.do_anything:manage",
  WEB_SEARCH_READ: "webagent.web_search:read",
  WEB_SEARCH_MANAGE: "webagent.web_search:manage",
  DEEP_RESEARCH_READ: "webagent.deep_research:read",
  DEEP_RESEARCH_MANAGE: "webagent.deep_research:manage",
  TRACK_READ: "webagent.track:read",
  TRACK_MANAGE: "webagent.track:manage",
} as const;

export type EAKScope = (typeof EAKScopes)[keyof typeof EAKScopes];

/** Product names accepted by `delegateToken({ products })`. */
export type EAKProduct = "doAnything" | "webSearch" | "deepResearch" | "track";

/**
 * Scope sets granted by the `delegateToken({ products })` sugar — each
 * product expands to its full verb pair: `read` + `manage`.
 */
export const EAKProductScopes: Record<EAKProduct, readonly EAKScope[]> = {
  doAnything: [
    EAKScopes.DO_ANYTHING_READ,
    EAKScopes.DO_ANYTHING_MANAGE,
  ],
  webSearch: [
    EAKScopes.WEB_SEARCH_READ,
    EAKScopes.WEB_SEARCH_MANAGE,
  ],
  deepResearch: [
    EAKScopes.DEEP_RESEARCH_READ,
    EAKScopes.DEEP_RESEARCH_MANAGE,
  ],
  track: [
    EAKScopes.TRACK_READ,
    EAKScopes.TRACK_MANAGE,
  ],
} as const;

/** Every scope string the SDK knows about (gumem + webagent). */
export const KNOWN_SCOPES: readonly string[] = Object.values(EAKScopes);

export const EAKScopeBundles = {
  GUMEM_READONLY: [EAKScopes.GUMEM_MEMORY_READ, EAKScopes.GUMEM_PROFILE_READ],
  GUMEM_SESSION_RECALL: [
    EAKScopes.GUMEM_MEMORY_READ,
    EAKScopes.GUMEM_MEMORY_WRITE,
    EAKScopes.GUMEM_MESSAGE_WRITE,
  ],
  GUMEM_WRITE: [
    EAKScopes.GUMEM_SESSION_CREATE,
    EAKScopes.GUMEM_MESSAGE_WRITE,
    EAKScopes.GUMEM_ACTION_WRITE,
  ],
  // One bundle per WebAgent product = [read, manage].
  DO_ANYTHING: [
    EAKScopes.DO_ANYTHING_READ,
    EAKScopes.DO_ANYTHING_MANAGE,
  ],
  WEB_SEARCH: [
    EAKScopes.WEB_SEARCH_READ,
    EAKScopes.WEB_SEARCH_MANAGE,
  ],
  DEEP_RESEARCH: [
    EAKScopes.DEEP_RESEARCH_READ,
    EAKScopes.DEEP_RESEARCH_MANAGE,
  ],
  TRACK: [
    EAKScopes.TRACK_READ,
    EAKScopes.TRACK_MANAGE,
  ],
} as const;
