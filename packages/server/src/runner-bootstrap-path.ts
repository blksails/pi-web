/**
 * Resolve the absolute path to the real-mode runner bootstrap script
 * (`runner-bootstrap.mjs`) that lives at the root of the `@blksails/pi-web-server`
 * package.
 *
 * This module computes the path from ITS OWN location (`import.meta.url`), so
 * the result is independent of `process.cwd()` and of how the host app is
 * bundled. It imports nothing from the pi SDK / jiti / the runner, so it is
 * safe to pull into the Next server bundle (the App calls this to get the
 * bootstrap path it then hands to `assemble` as `runnerEntry`).
 *
 * Layout:  packages/server/src/runner-bootstrap-path.ts  (this file)
 *          packages/server/runner-bootstrap.mjs          (target, one dir up)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
// src/ -> package root
const serverPkgDir = path.dirname(path.dirname(here));

/** Absolute path to `runner-bootstrap.mjs` (the cwd-independent runner entry). */
export function runnerBootstrapPath(): string {
  return path.join(serverPkgDir, "runner-bootstrap.mjs");
}
