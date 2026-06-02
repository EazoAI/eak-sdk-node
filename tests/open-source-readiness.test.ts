import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, unknown>;
}

function expectFile(path: string): void {
  expect(statSync(join(root, path)).isFile()).toBe(true);
}

describe("open-source readiness", () => {
  it("keeps maintainer-facing repository files in place", () => {
    [
      "CHANGELOG.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "docs/open-source-readiness.md",
      "examples/basic-delegation.ts",
      "tsconfig.examples.json",
      ".github/workflows/ci.yml",
    ].forEach(expectFile);
  });

  it("publishes package metadata expected from an open SDK", () => {
    const pkg = readJson("package.json");
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+ssh://git@gitlab.authing-inc.co/sak-steamory-agent-kit/eak-sdk-node.git",
    });
    expect(pkg.bugs).toEqual({
      url: "https://gitlab.authing-inc.co/sak-steamory-agent-kit/eak-sdk-node/-/issues",
    });
    expect(pkg.homepage).toBe(
      "https://gitlab.authing-inc.co/sak-steamory-agent-kit/eak-sdk-node#readme",
    );
    expect(pkg.publishConfig).toEqual({ access: "public" });
    expect(pkg.scripts).toMatchObject({
      "test:ci": "vitest run --coverage=false",
      "typecheck:examples": "pnpm build && tsc --noEmit -p tsconfig.examples.json",
      "pack:dry-run": "pnpm build && pnpm pack --dry-run",
      prepack: "pnpm build",
    });
    expect(pkg.files).toEqual([
      "dist",
      "README.md",
      "README.zh-CN.md",
      "CHANGELOG.md",
      "LICENSE",
      "docs",
      "examples",
    ]);
  });
});
