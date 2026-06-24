# 14 · Global CLI (standalone mode)

`pi-web` ships a globally installable CLI entry point, letting you spin up a self-contained pi-web instance locally or in CI with a single command—no knowledge of Next.js internals required.

---

## How it works

`bin/pi-web.mjs` is a **thin launcher** that contains no business logic itself (`bin/pi-web.mjs:1-12`). It does just three things:

1. Parse command-line arguments with `node:util.parseArgs` (`parseCliArgs`, `bin/pi-web.mjs:46`).
2. Call `buildEnv()` to translate arguments into runtime environment variables (`bin/pi-web.mjs:107`): `PI_WEB_DEFAULT_SOURCE`, `PORT`, `HOSTNAME`, and so on, which the business code reads via `loadConfig()`—the two are decoupled.
3. Use `node:child_process.spawn` to launch `<distDir>/standalone/server.js` with `process.execPath` (the current Node) (`launch`, `bin/pi-web.mjs:221`). The child process `cwd` is set to the standalone directory, with `stdio: "inherit"`, and the business code requires zero changes.

`parseCliArgs` and `buildEnv` are **pure functions and are exported** for unit testing; all side effects (spawn / open / port probing) are concentrated in `launch` / `main` and only fire when executed as the program entry point (`bin/pi-web.mjs:347-360` resolves symbolic links with `realpathSync` before comparing against `import.meta.url`, ensuring the entry-point check still holds after global installation via `npm link`).

The standalone artifact is produced by Next.js `output: "standalone"` mode (`next.config.ts:60-61`). After the build, `scripts/pack-standalone.mjs` fills in the static assets and trims the output, forming a minimal server bundle that can run independently of the monorepo source tree. When the launcher resolves the artifact path, `NEXT_DIST_DIR` defaults to `.next-cli` (`bin/pi-web.mjs:211-215`), isolated from dev's `.next`.

```
bin/pi-web.mjs                    ← thin launcher (entry point)
.next-cli/standalone/server.js    ← Next standalone artifact
scripts/pack-standalone.mjs       ← post-build script that fills in static assets + trims
```

---

## Installation

### Prerequisites

- Node.js >= 22.19.0
- pnpm >= 9 (required for the monorepo build)

### Global install from npm (recommended)

The CLI is published to the public npm registry under the name `@blksails/pi-web` (`package.json:2`, `publishConfig.access: "public"`) and can be installed globally directly:

```bash
npm i -g @blksails/pi-web
# or
pnpm add -g @blksails/pi-web

pi-web --version   # 0.1.2
pi-web --help
```

The published package contains only the self-contained standalone artifact and **does not require** the monorepo source to run.

### Build from source and link (development/debugging)

To debug the CLI based on local changes, build from the monorepo and link it globally with `npm link`:

```bash
# 1. Build the CLI artifact (output isolated to .next-cli, leaving dev's .next untouched)
pnpm build:cli
# Equivalent to:
# NEXT_DIST_DIR=.next-cli next build && NEXT_DIST_DIR=.next-cli node scripts/pack-standalone.mjs

# 2. Link globally
npm link

# 3. Verify
pi-web --version
pi-web --help
```

The `bin` and `files` fields in `package.json:8-15` together determine the published shape—`bin` points the command name at the thin launcher, while `files` tightens the published contents to three items, shipping only the standalone artifact and config with the package:

```json
{
  "name": "@blksails/pi-web",
  "version": "0.1.2",
  "bin": { "pi-web": "bin/pi-web.mjs" },
  "files": ["bin", ".next-cli/standalone", "next.config.ts"],
  "publishConfig": { "access": "public" }
}
```

---

## Quick start

```bash
# Use the current directory as the agent source (simplest usage)
pi-web

# Specify an agent source directory, custom port, and auto-open the browser when ready
pi-web ./examples/hello-agent -p 8080 --open

# Specify an agent source, bind all network interfaces
pi-web ./my-agent --host 0.0.0.0 -p 3000

# Offline smoke test with the stub agent (no real pi config needed)
pi-web ./examples/hello-agent --stub

# Watch the agent source directory and hot-reload active sessions on file changes
pi-web ./my-agent --watch
```

Once the server is ready, the console prints:

```
[pi-web] ready → http://127.0.0.1:3000
```

---

## Options reference

| Option | Short flag | Default | Description |
|------|--------|--------|------|
| `[source]` | — | current directory | agent source (local directory or git source) |
| `--port <n>` | `-p` | `3000` | listen port; if the port is taken, automatically increments to find a free one (up to 20 attempts) |
| `--host <h>` | — | `127.0.0.1` | bind host |
| `--cwd <dir>` | — | working directory when the CLI is invoked | session working directory |
| `--agent-dir <dir>` | — | `~/.pi/agent` | pi config directory |
| `--open` | — | `false` | open the system default browser automatically when the server is ready |
| `--stub` | — | `false` | run with the deterministic stub agent (offline smoke test, no real pi config needed) |
| `--watch` | — | `false` | watch the local agent source directory and reload active sessions on file changes (local directories only) |
| `--help` | `-h` | — | show help and exit (exit code 0) |
| `--version` | `-v` | — | show the version number and exit (exit code 0) |

---

## Argument-to-environment-variable mapping

`buildEnv()` translates CLI options into the env that the Next.js application reads at runtime, achieving decoupling:

| CLI option / default | Environment variable |
|----------------|---------|
| `source` (after absolutization) | `PI_WEB_DEFAULT_SOURCE` |
| `--cwd` (after absolutization) | `PI_WEB_DEFAULT_CWD` |
| `--port` | `PORT` |
| `--host` | `HOSTNAME` |
| fixed injection at CLI startup | `PI_WEB_AUTOSTART=1` (skip the source-picker page and go straight to a session) |
| `--agent-dir` | `PI_WEB_AGENT_DIR` |
| `--stub` | `PI_WEB_STUB_AGENT=1` |
| `--watch` (local source) | `PI_WEB_WATCH=1` + `PI_RUNNER_HOT_RELOAD_PATHS=<source>` |

> The `source` path is absolutized relative to the working directory when the CLI is invoked (`baseCwd`), because the standalone server process's cwd changes to the standalone directory.

---

## --watch hot reload

`--watch` reuses the dev runner's hot-reload mechanism:

- Injects `PI_WEB_WATCH=1` to lift the dev-environment gate.
- Injects `PI_RUNNER_HOT_RELOAD_PATHS=<source>` to tell the watcher which path to monitor.
- On file changes, the idle per-session runner process restarts automatically (resuming the session rather than creating a new one).

**Limitation**: `--watch` only works for local directory sources. When a git source is passed, `main()` prints a warning and skips file watching (`bin/pi-web.mjs:334-336`), and `buildEnv()` silently omits the watch env (`bin/pi-web.mjs:138-141`).

### Turn safety (does not interrupt an in-progress session)

A hot reload only actually restarts when the runner is **idle**, avoiding interrupting a streaming response or tool call midway. `PiRpcProcess` (`packages/server/src/rpc-channel/pi-rpc-process.ts:122`) tracks the `agent_start..agent_end` interval as `turnActive` (`pi-rpc-process.ts:511-512`) and extends `requestRestart`'s "busy" check from "has pending commands" to "**has pending commands OR turn in progress**" (`pi-rpc-process.ts:198-201`):

- If a restart request arrives while a turn is in progress (streaming tokens / tool call / awaiting an extension_ui response), it is deferred until after `agent_end`.
- Relying on `pendingCommands` alone is not enough—a prompt is acked immediately and all increments flow over the event stream, so an empty `pendingCommands` mid-turn would be misread as idle, interrupting the turn and losing information.
- `maybeRestartWhenIdle` (`pi-rpc-process.ts:209-213`) settles the deferred restart uniformly after command settlement and turn completion (`pi-rpc-process.ts:500`, `pi-rpc-process.ts:514`).

Dev-mode hot reload (`PI_RUNNER_HOT_RELOAD=1`) and the CLI's `--watch` share this same mechanism, so neither interrupts an in-progress session.

---

## Go straight to a session (autostart)

Since the agent source is already determined when launched via the CLI, there is no need to make the user click once on the source-picker page. The launcher **injects** `PI_WEB_AUTOSTART=1` unconditionally (`bin/pi-web.mjs:127`), and the front-end app-shell uses this to skip `AgentSourcePicker` and create a session directly from `PI_WEB_DEFAULT_SOURCE`, entering the session UI (reusing the existing resume branch):

- `AppConfig.autoStart` reads `PI_WEB_AUTOSTART` → `page.tsx` passes it through → `ChatApp`'s initial session uses `defaultSource` to create a session directly when `autoStart` is set.
- After entering the auto session, "switch source" (`onReset`) can still return to the source-picker page.
- For non-CLI launches (where this signal is not set), the default behavior is unchanged and the source-picker page is still shown.

This is the only "go straight to a session" wiring signal between the CLI and the application layer; the application layer makes only a minimal assembly change, and the session engine / source resolution / runner behavior are all unaffected.

---

## Build details

### Why an isolated build directory is needed

```bash
NEXT_DIST_DIR=.next-cli next build
```

During development, `next dev` uses the default `.next` directory; the CLI artifact is written to `.next-cli`, so the two don't interfere. Running `next build` while the dev server is running pollutes the shared `.next` and causes a webpack 500 error, so isolation is mandatory.

### Standalone artifact and static asset completion

Next.js `output: "standalone"` does not bundle `static/` and `public/` itself; `scripts/pack-standalone.mjs` completes them after the build in an overwrite (idempotent, re-runnable) manner (`scripts/pack-standalone.mjs:22-44`):

1. Verify `<distDir>/standalone/server.js` exists (missing = not yet built in standalone mode, exit code 1).
2. Copy `<distDir>/static/` → `<distDir>/standalone/<distDir>/static/`.
3. Copy `public/` → `<distDir>/standalone/public/` (if it exists).

The layout assumes `outputFileTracingRoot` = app root (= workspace root, `next.config.ts:64`), so within standalone the app files are at the root and `server.js` is at the standalone root.

### Mutual exclusion of standalone and next start (PI_WEB_DISABLE_STANDALONE)

The standalone artifact is incompatible with `next start` (the latter refuses to serve a standalone build). Browser e2e must launch the server via `next start`, so `next.config.ts:60-61` makes `output` conditional:

```typescript
// next.config.ts:60-61
output:
  process.env.PI_WEB_DISABLE_STANDALONE === "1" ? undefined : "standalone",
```

- Default (variable unset): produces standalone, CLI packaging behavior unchanged.
- `PI_WEB_DISABLE_STANDALONE=1`: disables standalone so `next start` can serve a regular production build (for e2e).

### Trimming the published standalone artifact (pack-standalone prune)

The CLI package is a self-contained artifact and does not need development files such as test / docs / source-map / markdown. After completing the static assets, `scripts/pack-standalone.mjs:46-71` recursively cleans the standalone directory:

- **Delete entire directories** (`PRUNE_DIRS`, `scripts/pack-standalone.mjs:47-53`): `test`/`tests`/`__tests__`, `docs`/`doc`, `example`/`examples`, `.github`/`coverage`/`stories`/`man`, etc.; plus pure test/e2e libraries dragged in via `outputFileTracingIncludes` as internal-package devDeps but not needed at runtime—`vitest`/`vite`/`@vitest`/`tinypool`/`tinyspy`/`tinybench`/`jsdom`/`happy-dom`/`@testing-library`/`playwright`/`playwright-core`/`@playwright`.
- **Delete files** (`PRUNE_FILE` regex, `scripts/pack-standalone.mjs:54`): `*.md` / `*.markdown` / `*.map` / `*.flow` / `*.tsbuildinfo` / `*.d.ts`, plus `changelog`/`authors`/`contributors`/`.npmignore`/`.editorconfig`/`.prettierrc*`/`.eslintrc*`.

Effect: CLI package **69.7MB → 46.4MB (13619 → 8345 files)** (commit `e07dfa7`). The cleanup count is printed on completion:

```
[pack-standalone] trim: cleaned N dev files/dirs (test/docs/*.map/*.md…)
```

When you need to compare / debug, use `PACK_NO_PRUNE=1` to disable trimming (`scripts/pack-standalone.mjs:66-71`) and keep the full artifact.

### outputFileTracingIncludes — P0 critical config

The child processes spawned by the main process when a session activates (runner-bootstrap.mjs, pi SDK cli.js, jiti) are runtime dynamic processes that Next.js's nft (Node File Tracer) cannot trace by default. They are explicitly included in `next.config.ts`:

```typescript
// next.config.ts:69-79
outputFileTracingIncludes: {
  "/**/*": [
    "./packages/server/runner-bootstrap.mjs",
    "./packages/server/src/**/*",
    "./packages/server/node_modules/@earendil-works/**/*",
    "./packages/server/node_modules/jiti/**/*",
    "./packages/agent-kit/**/*",
    "./packages/tool-kit/**/*",
    "./examples/**/*",
  ],
},
```

Without this config, real sessions cannot start under the standalone artifact (the child-process dependency files are missing).

---

## npm scripts cheat sheet

| Command | Equivalent operation |
|------|---------|
| `pnpm build:cli` | `NEXT_DIST_DIR=.next-cli next build && NEXT_DIST_DIR=.next-cli node scripts/pack-standalone.mjs` |
| `pnpm start:cli` | `node bin/pi-web.mjs` |
| `pnpm e2e:cli` | `node e2e/cli/cli-smoke.mjs` |
| `pnpm e2e:cli:watch` | `node e2e/cli/cli-watch.mjs` |

Build-related environment variables:

| Variable | Purpose |
|------|------|
| `NEXT_DIST_DIR` | isolated build output directory; the CLI uses `.next-cli`, which doesn't pollute dev's `.next` |
| `PI_WEB_DISABLE_STANDALONE=1` | disable standalone output so `next start` can serve a regular build (for browser e2e) |
| `PACK_NO_PRUNE=1` | skip standalone trimming and keep the full artifact (for comparison / debugging) |

---

## E2E acceptance

`e2e/cli/cli-smoke.mjs` covers the complete startup chain and is repeatable (produces fresh-evidence screenshots):

```bash
# Prerequisite: build first
pnpm build:cli

# Run the smoke test
pnpm e2e:cli
```

The smoke test covers:

1. **Artifact integrity** — verifies that `server.js`, `runner-bootstrap.mjs`, the pi SDK `cli.js`, and `jiti` are all present in the standalone directory.
2. **Argument paths** — `--help`/`--version` exit code 0; an unknown argument exits non-zero and does not start the server.
3. **Stub startup + browser smoke** — CLI launches standalone → browser loads → default source activates a session → message sent → stub streaming response received.

Evidence screenshots are saved to `.kiro/specs/pi-web-cli/evidence/cli-smoke-repeatable.png`.

`e2e/cli/cli-watch.mjs` specifically validates `--watch` hot-reload behavior.

---

## FAQ

> The following are high-frequency questions specific to the CLI; for more startup / session troubleshooting, see [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md).

**Q: At startup it reports `self-contained artifact .next-cli/standalone/server.js not found`**

A: It hasn't been built yet—run `pnpm build:cli` first.

**Q: What if the port is taken?**

A: The CLI automatically increments from the specified port (default 3000) to find a free one, trying up to 20 ports, and prints the actual port used in the console. If all 20 ports are taken, use `-p` to specify a different range.

**Q: `--watch` has no effect**

A: Confirm that `source` is a local directory path, not a git source such as `git:` / `https:`. A git source has no local directory to watch, so the CLI prints a warning and skips it.

**Q: I changed a file with `--watch`, but the session didn't reload immediately**

A: This is turn-safety protection. A restart only happens when the runner is idle; if the session is streaming a response or calling a tool (turn in progress), the restart is deferred until after this turn ends (`agent_end`), avoiding interrupting the current session. It resumes automatically once idle.

**Q: The CLI package is too large / I want to keep the full artifact for investigation**

A: The default build already trims automatically (cleaning test/docs/`*.map`/`*.md`, etc., roughly 69.7MB → 46.4MB). To compare against the full artifact, use `PACK_NO_PRUNE=1 pnpm build:cli` to disable trimming.

---

## Next steps / related docs

- [05 · Configuration](./05-configuration.md) — full documentation of env variables such as `PI_WEB_DEFAULT_SOURCE`, `PI_WEB_AUTOSTART`
- [15 · Deployment](./15-deployment.md) — production deployment, Docker packaging
- [17 · Development and Testing](./17-development-and-testing.md) — running in dev mode, the rationale behind `NEXT_DIST_DIR` isolated builds
- [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md) — more startup troubleshooting
