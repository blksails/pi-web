/**
 * Real-mode runner bootstrap (cwd-independent).
 *
 * Plain ESM JS that needs NO jiti to *start*. It lives at the root of the
 * `@blksails/server` package, so the bare `jiti` import below resolves against
 * the server package's `node_modules` regardless of where the subprocess is
 * spawned (the agent's working directory, which has no `node_modules`).
 *
 * Responsibilities:
 *  1. Construct a jiti instance rooted at THIS file (the server package dir) so
 *     jiti + the pi SDK + the TS runner all resolve from the server package,
 *     independent of `process.cwd()`.
 *  2. Import the TypeScript runner (`./src/runner/runner.ts`) through jiti.
 *  3. Invoke its `main(argv)`, passing through the runner CLI args
 *     (`--agent` / `--cwd` / `--agent-dir` / `--trusted`).
 *
 * The agent's working directory is conveyed via the child `cwd` (spawnSpec.cwd)
 * and/or the runner's `--cwd` arg — only MODULE RESOLUTION is anchored here.
 *
 * Launch shape (assembled by agent-source/assemble-spawn.ts, custom mode):
 *   node <abs>/runner-bootstrap.mjs --agent <entry> --cwd <work> [--agent-dir <dir>]
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = fileURLToPath(import.meta.url);
const serverPkgDir = dirname(here);

// Root jiti at the server package dir: resolves jiti's own deps, the pi SDK
// (@earendil-works/pi-coding-agent, @blksails/agent-kit, @earendil-works/pi-ai)
// and the runner TS against the server package, never the agent's cwd.
const jiti = createJiti(here);

const runnerTs = join(serverPkgDir, "src", "runner", "runner.ts");

async function bootstrap() {
  const mod = await jiti.import(runnerTs);
  const main = mod.main ?? mod.default?.main;
  if (typeof main !== "function") {
    process.stderr.write(
      "runner-bootstrap: runner module did not export a main() function\n",
    );
    process.exitCode = 1;
    return;
  }
  // Pass through only the runner CLI args (after this bootstrap script path).
  await main(process.argv.slice(2));
}

void bootstrap();
