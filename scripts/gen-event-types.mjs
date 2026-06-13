// Generate src/generated/event-types.ts from the vendored event catalog.
//
// The catalog (src/generated/event-catalog.json) is a verbatim copy of the
// backend's published artifact (webagentbackend/docs/events/catalog.json,
// itself generated from domain.event.types.EventType — the single source of
// truth). To re-sync after the backend adds an event type:
//
//   cp ../webagentbackend/docs/events/catalog.json src/generated/event-catalog.json
//   pnpm gen:event-types
//
// WireEventTypes is the complete (INTERNAL) wire-event catalog. The key for
// each wire string is the backend enum member name, derived deterministically:
// uppercase + "." → "_" (e.g. "run.action.started" → RUN_ACTION_STARTED).
//
// Run with --check to verify the committed output is up to date (CI / test).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(here, "..", "src", "generated", "event-catalog.json");
const outPath = join(here, "..", "src", "generated", "event-types.ts");

/** "run.action.started" → "RUN_ACTION_STARTED" (matches backend enum names). */
function keyFor(wire) {
  const key = wire.toUpperCase().replace(/\./g, "_");
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    throw new Error(`wire type "${wire}" does not map to a valid identifier ("${key}")`);
  }
  return key;
}

function render(catalog) {
  const seenKeys = new Set();
  const entries = catalog.event_types.map((wire) => {
    const key = keyFor(wire);
    if (seenKeys.has(key)) throw new Error(`duplicate generated key ${key} (from ${wire})`);
    seenKeys.add(key);
    return `  ${key}: ${JSON.stringify(wire)},`;
  });
  return `// AUTO-GENERATED — do not edit by hand.
// Source: src/generated/event-catalog.json (vendored from the backend's
// domain.event.types.EventType). Regenerate with \`pnpm gen:event-types\`
// after re-syncing the catalog. Drift is guarded by tests/event-catalog.test.ts
// (SDK side) and the webagent-e2e contract suite (vs the live backend enum).

/**
 * INTERNAL — the raw wire event types (the complete mirror of the backend
 * \`EventType\` enum, in canonical order). NOT a public export. Developers use
 * the curated \`EAKEventTypes\` / \`event.type\` (run-events.ts); these raw wire
 * names back the wire→curated mapping, \`event.raw.event\`, and the drift tests.
 */
export const WireEventTypes = {
${entries.join("\n")}
} as const;

export type WireEventType = (typeof WireEventTypes)[keyof typeof WireEventTypes];

/** The wire catalog as a flat, ordered list — used by the drift tests. */
export const WIRE_EVENT_TYPE_VALUES: readonly WireEventType[] =
  Object.values(WireEventTypes);
`;
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const rendered = render(catalog);

const check = process.argv.includes("--check");
if (check) {
  const current = readFileSync(outPath, "utf8");
  if (current !== rendered) {
    console.error(
      "src/generated/event-types.ts is stale — run `pnpm gen:event-types`.",
    );
    process.exit(1);
  }
  console.log("event-types.ts is up to date.");
} else {
  writeFileSync(outPath, rendered);
  console.log(`wrote ${outPath} (${catalog.event_types.length} event types)`);
}
