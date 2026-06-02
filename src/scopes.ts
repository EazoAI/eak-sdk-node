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

  WEBAGENT_TASK_RUN: "webagent.task:run",
  WEBAGENT_TASK_READ: "webagent.task:read",
  WEBAGENT_BROWSER_CONTROL: "webagent.browser:control",
  WEBAGENT_WORKSPACE_READ: "webagent.workspace:read",
  WEBAGENT_WORKSPACE_WRITE: "webagent.workspace:write",
  WEBAGENT_ADMIN_MANAGE: "webagent.admin:manage",

  WEBAGENT_WEB_SEARCH_RUN: "webagent.web_search:run",
  WEBAGENT_WEB_SEARCH_READ: "webagent.web_search:read",
  WEBAGENT_WEB_SEARCH_REFINE: "webagent.web_search:refine",
  WEBAGENT_WEB_SEARCH_CANCEL: "webagent.web_search:cancel",

  WEBAGENT_DO_ANYTHING_SESSION: "webagent.do_anything:session",
  WEBAGENT_DO_ANYTHING_RUN: "webagent.do_anything:run",
  WEBAGENT_DO_ANYTHING_EVENTS: "webagent.do_anything:events",
  WEBAGENT_DO_ANYTHING_INTERVENE: "webagent.do_anything:intervene",
  WEBAGENT_DO_ANYTHING_CANCEL: "webagent.do_anything:cancel",
  WEBAGENT_DO_ANYTHING_READ_ARTIFACTS: "webagent.do_anything:read_artifacts",
  WEBAGENT_DO_ANYTHING_READ_RECORDING: "webagent.do_anything:read_recording",

  WEBAGENT_BROWSER_USE_RUN: "webagent.browser_use:run",
  WEBAGENT_BROWSER_USE_TAKE_CONTROL: "webagent.browser_use:take_control",
  WEBAGENT_BROWSER_USE_LIVE_VIEW: "webagent.browser_use:live_view",

  WEBAGENT_DEEP_RESEARCH_RUN: "webagent.deep_research:run",
  WEBAGENT_DEEP_RESEARCH_INTERVENE: "webagent.deep_research:intervene",
  WEBAGENT_DEEP_RESEARCH_READ_ARTIFACTS: "webagent.deep_research:read_artifacts",
  WEBAGENT_DEEP_RESEARCH_CANCEL: "webagent.deep_research:cancel",

  WEBAGENT_TRACK_MONITOR_CREATE: "webagent.track:monitor_create",
  WEBAGENT_TRACK_MONITOR_READ: "webagent.track:monitor_read",
  WEBAGENT_TRACK_MONITOR_UPDATE: "webagent.track:monitor_update",
  WEBAGENT_TRACK_MONITOR_DELETE: "webagent.track:monitor_delete",
  WEBAGENT_TRACK_RUN_NOW: "webagent.track:run_now",
  WEBAGENT_TRACK_EVENTS: "webagent.track:events",

  WEBAGENT_SITE_LOGIN_REQUEST: "webagent.site_login:request",
  WEBAGENT_SITE_LOGIN_CONFIRM: "webagent.site_login:confirm",
  WEBAGENT_SITE_LOGIN_REVOKE: "webagent.site_login:revoke",
} as const;

export type EAKScope = (typeof EAKScopes)[keyof typeof EAKScopes];

export const EAKScopeBundles = {
  GUMEM_READONLY: [EAKScopes.GUMEM_MEMORY_READ, EAKScopes.GUMEM_PROFILE_READ],
  GUMEM_WRITE: [
    EAKScopes.GUMEM_SESSION_CREATE,
    EAKScopes.GUMEM_MESSAGE_WRITE,
    EAKScopes.GUMEM_ACTION_WRITE,
  ],
  WEB_SEARCH: [
    EAKScopes.WEBAGENT_WEB_SEARCH_RUN,
    EAKScopes.WEBAGENT_WEB_SEARCH_READ,
  ],
  AGENT_DO_ANYTHING_BASIC: [
    EAKScopes.WEBAGENT_DO_ANYTHING_SESSION,
    EAKScopes.WEBAGENT_DO_ANYTHING_RUN,
    EAKScopes.WEBAGENT_DO_ANYTHING_EVENTS,
    EAKScopes.WEBAGENT_DO_ANYTHING_CANCEL,
  ],
  AGENT_TRACK: [
    EAKScopes.WEBAGENT_TRACK_MONITOR_CREATE,
    EAKScopes.WEBAGENT_TRACK_MONITOR_READ,
    EAKScopes.WEBAGENT_TRACK_MONITOR_UPDATE,
    EAKScopes.WEBAGENT_TRACK_MONITOR_DELETE,
    EAKScopes.WEBAGENT_TRACK_RUN_NOW,
    EAKScopes.WEBAGENT_TRACK_EVENTS,
  ],
} as const;
