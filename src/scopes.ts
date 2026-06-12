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

  DO_ANYTHING_RUN: "webagent.do_anything:run",
  DO_ANYTHING_READ: "webagent.do_anything:read",
  DO_ANYTHING_STOP: "webagent.do_anything:stop",
  DO_ANYTHING_CONTROL: "webagent.do_anything:control",
  WEB_SEARCH_RUN: "webagent.web_search:run",
  WEB_SEARCH_READ: "webagent.web_search:read",
  WEB_SEARCH_STOP: "webagent.web_search:stop",
  DEEP_RESEARCH_RUN: "webagent.deep_research:run",
  DEEP_RESEARCH_READ: "webagent.deep_research:read",
  DEEP_RESEARCH_STOP: "webagent.deep_research:stop",
  DEEP_RESEARCH_CONTROL: "webagent.deep_research:control",
  TRACK_RUN: "webagent.track:run",
  TRACK_READ: "webagent.track:read",
  TRACK_STOP: "webagent.track:stop",
  TRACK_MANAGE: "webagent.track:manage",

} as const;

export type EAKScope = (typeof EAKScopes)[keyof typeof EAKScopes];

/** Product names accepted by `delegateToken({ products })`. */
export type EAKProduct = "doAnything" | "webSearch" | "deepResearch" | "track";

/**
 * Scope sets granted by the `delegateToken({ products })` sugar — the full
 * verb bundle each product exposes today.
 */
// TODO(scope collapse to read/manage lands): swap products expansion to {product}:{read,manage}
export const EAKProductScopes: Record<EAKProduct, readonly EAKScope[]> = {
  doAnything: [
    EAKScopes.DO_ANYTHING_RUN,
    EAKScopes.DO_ANYTHING_READ,
    EAKScopes.DO_ANYTHING_STOP,
    EAKScopes.DO_ANYTHING_CONTROL,
  ],
  webSearch: [
    EAKScopes.WEB_SEARCH_RUN,
    EAKScopes.WEB_SEARCH_READ,
    EAKScopes.WEB_SEARCH_STOP,
  ],
  deepResearch: [
    EAKScopes.DEEP_RESEARCH_RUN,
    EAKScopes.DEEP_RESEARCH_READ,
    EAKScopes.DEEP_RESEARCH_STOP,
    EAKScopes.DEEP_RESEARCH_CONTROL,
  ],
  track: [
    EAKScopes.TRACK_RUN,
    EAKScopes.TRACK_READ,
    EAKScopes.TRACK_STOP,
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
  WEB_SEARCH: [
    EAKScopes.WEB_SEARCH_RUN,
    EAKScopes.WEB_SEARCH_READ,
  ],
  AGENT_DO_ANYTHING_BASIC: [
    EAKScopes.DO_ANYTHING_RUN,
    EAKScopes.DO_ANYTHING_READ,
    EAKScopes.DO_ANYTHING_STOP,
    EAKScopes.DO_ANYTHING_CONTROL,
  ],
  AGENT_TRACK: [
    EAKScopes.TRACK_RUN,
    EAKScopes.TRACK_READ,
    EAKScopes.TRACK_STOP,
    EAKScopes.TRACK_MANAGE,
  ],
} as const;
