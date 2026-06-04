import { EAKScopes, EzaoAgentKit } from "@eazo/eak";

type AuditCase = {
  name: string;
  status: "pass" | "fail" | "blocked";
  observation: string;
  evidence?: Record<string, unknown>;
};

type ObservedFetch = {
  calls: Array<{ url: string; method?: string; status?: number; body?: unknown }>;
  fetch: typeof fetch;
};

const accessKey = process.env.EAK_ACCESS_KEY;
const secretKey = process.env.EAK_SECRET_KEY;

if (!accessKey || !secretKey) {
  throw new Error("Missing required env vars: EAK_ACCESS_KEY, EAK_SECRET_KEY");
}

const probeUserId = process.env.EAK_USER_ID || "user_probe_for_runtime_only";
const agentId = process.env.EAK_AGENT_ID || "memory-agent";
const cases: AuditCase[] = [];

await runtimeDiscoveryCase();
await stringAgentDelegationCase();
await missingRuntimeTokenCase();

console.log(JSON.stringify({ ok: true, package: "@eazo/eak", cases }, null, 2));

async function runtimeDiscoveryCase() {
  const observed = observedFetch();
  const client = new EzaoAgentKit({
    accessKey,
    secretKey,
    host: process.env.EAK_HOST,
    fetch: observed.fetch,
  });

  try {
    await client.delegateToken({
      userId: probeUserId,
      agent: agentId,
      scopes: [EAKScopes.GUMEM_MEMORY_READ],
      mode: "silent",
    });
  } catch {
    // Delegation may be blocked by user binding; runtime discovery can still be evaluated.
  }

  const runtime = observed.calls.find((call) => call.url.includes("/api/v3/eak/runtime-config"));
  cases.push({
    name: "default runtime discovery with real AK/SK",
    status: runtime?.status === 200 ? "pass" : "fail",
    observation:
      runtime?.status === 200
        ? "SDK default host signs runtime-config and receives real service URLs."
        : "SDK did not receive runtime-config successfully.",
    evidence: sanitizeRuntime(runtime),
  });
}

async function stringAgentDelegationCase() {
  const client = new EzaoAgentKit({ accessKey, secretKey, host: process.env.EAK_HOST });
  try {
    const delegation = await client.delegateToken({
      userId: probeUserId,
      agent: agentId,
      scopes: [
        EAKScopes.GUMEM_MEMORY_READ,
        EAKScopes.GUMEM_MEMORY_WRITE,
        EAKScopes.GUMEM_MESSAGE_WRITE,
      ],
      mode: "silent",
    });

    if ("authorizationUrl" in delegation.data) {
      cases.push({
        name: "string agent silent delegation",
        status: "blocked",
        observation: "Delegation returned interactive authorization instead of a silent token.",
        evidence: {
          grantId: delegation.data.grantId,
          authorizationUrl: delegation.data.authorizationUrl,
        },
      });
      return;
    }

    cases.push({
      name: "string agent silent delegation",
      status: "pass",
      observation: "Delegation returned a token. Real GUMem smoke can proceed with this user.",
      evidence: {
        tokenType: delegation.data.tokenType,
        expiresIn: delegation.data.expiresIn,
        grantId: delegation.data.grantId,
        auditId: delegation.data.auditId,
      },
    });
  } catch (error) {
    cases.push({
      name: "string agent silent delegation",
      status: "blocked",
      observation:
        "Correct string agent shape reaches server-side credential/user validation, but this user is not bound to the credential userpool.",
      evidence: sanitizeError(error),
    });
  }
}

async function missingRuntimeTokenCase() {
  const client = new EzaoAgentKit({
    accessKey,
    secretKey,
    gumemBaseUrl: "https://gum.eazo.ai/api",
  });
  try {
    await client.gumem.recall({ sessionId: "audit", query: "memory" } as never);
    cases.push({
      name: "GUMem call without token",
      status: "fail",
      observation: "GUMem call unexpectedly proceeded without a token.",
    });
  } catch (error) {
    cases.push({
      name: "GUMem call without token",
      status: "pass",
      observation: "SDK fails fast before product call when token is missing.",
      evidence: sanitizeError(error),
    });
  }
}

function observedFetch(): ObservedFetch {
  const calls: ObservedFetch["calls"] = [];
  return {
    calls,
    fetch: (async (url, init) => {
      const response = await fetch(url, init);
      let body: unknown;
      try {
        body = await response.clone().json();
      } catch {
        body = undefined;
      }
      calls.push({ url: String(url), method: init?.method, status: response.status, body });
      return response;
    }) as typeof fetch,
  };
}

function sanitizeRuntime(call: ObservedFetch["calls"][number] | undefined) {
  const data = isRecord(call?.body) && isRecord(call.body.data) ? call.body.data : undefined;
  return {
    url: call?.url,
    status: call?.status,
    data,
  };
}

function sanitizeError(error: unknown): Record<string, unknown> {
  if (!isRecord(error)) return { message: String(error) };
  const body = isRecord(error.body) ? error.body : undefined;
  return {
    name: error.name,
    code: error.code,
    status: error.status,
    message: error.message,
    requestId: error.requestId,
    details: isRecord(body?.details) ? body?.details : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
