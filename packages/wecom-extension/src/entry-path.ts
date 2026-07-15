/**
 * Absolute path to the WeCom extension entry (for agent.extensions / forced paths).
 * Does not import the extension body (safe for server bundles that only need the path).
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REL = "index.ts";
const CWD_REL = "packages/wecom-extension/src/index.ts";

let here: string | undefined;
try {
  here = path.dirname(fileURLToPath(import.meta.url));
} catch {
  here = undefined;
}

/** Absolute path to wecom extension entry; undefined if not found. */
export function wecomExtensionEntryPath(): string | undefined {
  if (here !== undefined) {
    const fromHere = path.join(here, REL);
    if (existsSync(fromHere)) return fromHere;
  }
  const fromCwd = path.join(process.cwd(), CWD_REL);
  if (existsSync(fromCwd)) return fromCwd;
  // pi-web monorepo run from package cwd
  const fromPkg = path.join(process.cwd(), "src", REL);
  if (existsSync(fromPkg)) return fromPkg;
  return undefined;
}
