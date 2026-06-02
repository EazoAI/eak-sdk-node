import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, unknown>;
}

function expectFile(path: string): void {
  expect(statSync(join(root, path)).isFile()).toBe(true);
}

function expectNoFile(path: string): void {
  expect(existsSync(join(root, path))).toBe(false);
}

function readText(path: string): string {
  return readFileSync(join(root, path), "utf8");
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
    ].forEach(expectFile);
    expectNoFile(".github/workflows/ci.yml");
  });

  it("publishes package metadata expected from an open SDK", () => {
    const pkg = readJson("package.json");
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/EazoAI/eak-sdk-node.git",
    });
    expect(pkg.bugs).toEqual({
      url: "https://github.com/EazoAI/eak-sdk-node/issues",
    });
    expect(pkg.homepage).toBe(
      "https://github.com/EazoAI/eak-sdk-node#readme",
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

  it("allows manual branch release jobs while keeping branch sync optional", () => {
    const ci = readText(".gitlab-ci.yml");

    expect(ci).toContain('GITHUB_REPOSITORY: "EazoAI/eak-sdk-node"');
    expect(ci).toContain("if: '$CI_COMMIT_TAG'");
    expect(ci).toContain("if: '$CI_COMMIT_BRANCH'");
    expect(ci).toContain('if: \'$CI_COMMIT_BRANCH == "main"\'');
    expect(ci).toContain("if: '$CI_COMMIT_TAG =~ /^v/'");
    expect(ci).toContain('git push github "${CI_COMMIT_SHA}:refs/heads/${CI_COMMIT_REF_NAME}"');
    expect(ci).toMatch(/- if: '\$CI_COMMIT_BRANCH'\n\s+when: manual\n\s+allow_failure: true/);
    expect(ci).toContain("npm whoami");
    expect(ci).toContain("npm org ls eazo --json");
  });
});
