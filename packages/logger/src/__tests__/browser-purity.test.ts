/**
 * Task 5.1 — R1.6: Browser-reachable module graph "node:" import scan
 *
 * Requirement 1.6: The logger library MUST guarantee that the browser build
 * product contains NO references to Node-only modules (static or dynamic imports
 * of "node:*" specifiers, or bare built-in names like "fs", "path", "os", etc.).
 *
 * Implementation: source-graph scan (fallback approach — no bundler required).
 * Starting from packages/logger/src/index.ts, we follow every relative import
 * recursively, collect all reachable .ts source files, and assert that none of
 * them contain:
 *   1. A static import: `import ... from "node:..."` or `from 'node:...'`
 *   2. A dynamic import: `import("node:...")` or `import('node:...')`
 *
 * The scan intentionally covers ALL files in the reachable module graph so that
 * future additions of node: imports are caught — not just the handful of files
 * that were hand-checked at authoring time.
 *
 * RED-phase verification: temporarily adding `import("node:fs")` to any source
 * file reachable from index.ts causes this test to fail.
 */

import { describe, it, expect } from "vitest";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

// ── Patterns that constitute forbidden "node:" references ─────────────────────

/** Matches static imports: import ... from "node:..." or 'node:...' */
const STATIC_NODE_IMPORT_RE = /\bimport\s+(?:type\s+)?[\s\S]*?\bfrom\s+['"]node:/;

/** Matches dynamic imports: import("node:...") or import('node:...') */
const DYNAMIC_NODE_IMPORT_RE = /\bimport\s*\(\s*['"]node:/;

// ── Source pre-processing ─────────────────────────────────────────────────────

/**
 * Strip single-line comments (`// ...`) and block comments (`/* ... *\/`)
 * from TypeScript source text before scanning for forbidden import patterns.
 * This prevents false positives where comments *describe* a forbidden import
 * pattern as a warning (e.g. "MUST NOT use import ... from node:...").
 *
 * The replacement preserves line structure (replaces block-comment internals
 * with whitespace of the same line-count) so that error line numbers remain
 * meaningful if we ever need them.
 */
function stripComments(src: string): string {
  // Remove block comments /* ... */ (non-greedy, handles multi-line)
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => {
    // Preserve newlines so that line numbers stay intact
    const newlines = (m.match(/\n/g) ?? []).length;
    return "\n".repeat(newlines);
  });
  // Remove single-line comments // ...
  out = out.replace(/\/\/[^\n]*/g, "");
  return out;
}

// ── Source-graph walker ───────────────────────────────────────────────────────

/**
 * Resolve a relative specifier from a given directory, trying .ts then
 * /index.ts suffixes (matching TypeScript .js → .ts convention).
 */
function resolveSpecifier(fromDir: string, specifier: string): string | null {
  // Strip the .js extension that TypeScript ESM output uses
  const base = specifier.replace(/\.js$/, "");

  const candidates = [
    nodePath.resolve(fromDir, base + ".ts"),
    nodePath.resolve(fromDir, base, "index.ts"),
  ];

  for (const candidate of candidates) {
    if (nodeFs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Walk the import graph starting from `entryPath`, collecting all reachable
 * source file absolute paths. Only follows relative imports (starts with "./",
 * "../"). Package imports (e.g. "vitest", "node:…") are not followed.
 */
function collectReachableFiles(entryPath: string): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [entryPath];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    let src: string;
    try {
      src = nodeFs.readFileSync(current, "utf8");
    } catch {
      continue; // skip unreadable files
    }

    const fromDir = nodePath.dirname(current);

    // Match all import/export specifiers: both static and re-exports
    // We only want RELATIVE specifiers ("./" or "../")
    const importSpecifierRe = /\bfrom\s+['"](\.[^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = importSpecifierRe.exec(src)) !== null) {
      const specifier = match[1]!;
      const resolved = resolveSpecifier(fromDir, specifier);
      if (resolved !== null && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return visited;
}

// ── Test ──────────────────────────────────────────────────────────────────────

describe("R1.6 — Browser-reachable module graph: no node: imports", () => {
  // Resolve the entry point relative to this test file's location.
  // __tests__/ is one level below src/, so ../index.ts points to src/index.ts.
  const entryPath = nodePath.resolve(
    new URL(".", import.meta.url).pathname,
    "..",
    "index.ts",
  );

  it("entry point (index.ts) is resolvable and exists", () => {
    expect(nodeFs.existsSync(entryPath)).toBe(true);
  });

  it("source graph scan finds at least 5 source files (sanity check)", () => {
    const files = collectReachableFiles(entryPath);
    // Ensure the walker actually traversed the graph (not an empty set)
    expect(files.size).toBeGreaterThanOrEqual(5);
  });

  it("no reachable source file contains a static `import ... from \"node:\"` specifier", () => {
    const files = collectReachableFiles(entryPath);
    const violations: string[] = [];

    for (const filePath of files) {
      const raw = nodeFs.readFileSync(filePath, "utf8");
      // Strip comments before scanning so that comment-based warnings like
      // "MUST NOT use import ... from 'node:...'" don't produce false positives.
      const src = stripComments(raw);
      if (STATIC_NODE_IMPORT_RE.test(src)) {
        violations.push(filePath);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `R1.6 VIOLATION — the following source files contain static "node:" imports\n` +
          `(these would pollute a browser bundle):\n\n` +
          violations.map((f) => `  • ${f}`).join("\n") +
          `\n\nFix: use globalThis-based access or the globalThis seam pattern instead.`,
      );
    }

    expect(violations).toHaveLength(0);
  });

  it("no reachable source file contains a dynamic `import(\"node:\")` call", () => {
    const files = collectReachableFiles(entryPath);
    const violations: string[] = [];

    for (const filePath of files) {
      const raw = nodeFs.readFileSync(filePath, "utf8");
      const src = stripComments(raw);
      if (DYNAMIC_NODE_IMPORT_RE.test(src)) {
        violations.push(filePath);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `R1.6 VIOLATION — the following source files contain dynamic "node:" imports\n` +
          `(these can be split into browser bundles by webpack/esbuild):\n\n` +
          violations.map((f) => `  • ${f}`).join("\n") +
          `\n\nFix: use globalThis-based access or the globalThis seam pattern instead.`,
      );
    }

    expect(violations).toHaveLength(0);
  });

  it("lists all scanned files for audit transparency", () => {
    const files = collectReachableFiles(entryPath);
    const srcDir = nodePath.resolve(
      new URL(".", import.meta.url).pathname,
      "..",
    );

    // Print relative paths for readability in test output
    const relativePaths = [...files]
      .map((f) => nodePath.relative(srcDir, f))
      .sort();

    // This is an informational assertion — we just confirm the set is non-empty
    // and that index.ts itself is included.
    expect(relativePaths).toContain("index.ts");

    // Emit for human inspection
    // (vitest suppresses console in run mode unless --reporter=verbose)
    // biome-ignore lint: intentional test transparency output
    console.info(
      `[R1.6 scan] ${files.size} files scanned:\n` +
        relativePaths.map((p) => `  ${p}`).join("\n"),
    );
  });
});
