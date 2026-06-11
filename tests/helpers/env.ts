import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadDotEnvLocal(cwd = process.cwd()): void {
  const path = resolve(cwd, ".env.local");
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquote(rawValue.trim());
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value?.trim()) return value;
  throw new Error(`${name} is required`);
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  const commentStart = value.search(/\s#/);
  return commentStart >= 0 ? value.slice(0, commentStart).trimEnd() : value;
}
