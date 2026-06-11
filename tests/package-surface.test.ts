import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const publicExports = [
  "EAK",
  "EazoAgentKit",
  "EAKScopes",
  "EAKScopeBundles",
  "EAKEventTypes",
  "EAKError",
  "EAKAuthError",
  "EAKDelegationRequiredError",
  "EAKPermissionDeniedError",
  "EAKTokenExpiredError",
  "EAKValidationError",
  "EAKRateLimitError",
  "EAKUpstreamError",
  "EAKTimeoutError",
  "buildAuthorization",
  "buildSignature",
  "buildStringToSign",
] as const;

describe("built package surface", () => {
  it("exports the public API from the ESM build", async () => {
    const esm = await import("../dist/index.js");

    for (const key of publicExports) {
      expect(esm, `missing ESM export ${key}`).toHaveProperty(key);
    }
    expect(esm.EAK).toBe(esm.EazoAgentKit);
  });

  it("exports the public API from the CommonJS build", () => {
    const require = createRequire(import.meta.url);
    const cjs = require("../dist/index.cjs") as Record<string, unknown>;

    for (const key of publicExports) {
      expect(cjs, `missing CJS export ${key}`).toHaveProperty(key);
    }
    expect(cjs.EAK).toBe(cjs.EazoAgentKit);
  });
});
