# 18 · CLI

`pi-web` provides a globally installable command entry point: a single command spins up a self-contained pi-web instance locally or in CI (Vite + SPA front-end + a single-file Hono/esbuild back-end). It is a **subcommand-free thin launcher**—there are no package-management subcommands such as `create` / `install` / `publish`. It only does three things: "parse arguments → translate them into runtime env → spawn the back-end artifact".

---

## How it works

`bin/pi-web.mjs` contains no business logic itself and does three things:

1. Parse the command line into structured options with `node:util.parseArgs` (`parseCliArgs`, `bin/pi-web.mjs:47`).
2. Translate those options into the runtime environment variables the back-end reads with `buildEnv()` (`bin/pi-web.mjs:108`): `PI_WEB_DEFAULT_SOURCE`, `PORT`, `HOSTNAME`, and so on. The business code reads them via `loadConfig()`—the two are decoupled.
3. Locate the back-end artifact entry with `resolveRuntime()`, then use `node:child_process.spawn` to launch the **product root's `dist/server.mjs`** with `process.execPath` (the current Node) (`launch`, `bin/pi-web.mjs:324`). The child process's `cwd` is set to the product root, `stdio: "inherit"`, and the business code needs zero changes.

`parseCliArgs` and `buildEnv` are **pure functions and are exported** for unit testing; all side effects (spawn / open / port probing / first-run unpacking) are concentrated in `launch` / `main` and only fire when executed as the program entry point. The entry-point check compares `import.meta.url` after resolving symbolic links with `realpathSync` (`bin/pi-web.mjs:455-469`), so the check still holds after a global install via `npm link`, and it uses the `globalThis.__PI_WEB_CLI_EMBEDDED__` marker to avoid self-launching a second time when inlined into the desktop shell bundle.

> `dist/server.mjs` is bundled into a single file by `scripts/build-server.mjs` via esbuild (bundle + esm + node22, with the two pi SDK packages / jiti / pg kept external). **The entry point must sit at the product root**: `packages/server`'s `runnerBootstrapPath()` / `resolvePiCliEntry()` fall back to `process.cwd()` once `import.meta.url` has been inlined away by the bundler, and `launch()` uses exactly the product root as the child process's cwd (`bin/pi-web.mjs:322-328`). For the build artifact layout, see [19 · Deployment and Operations](./19-deployment.md).

> Known stale facts (harmless at runtime): the header comment at `bin/pi-web.mjs:6` and the `description` at `package.json:88` still say "launch the Next standalone self-contained artifact". This is leftover wording—Next.js has long been gone from main, and what actually launches is the esbuild single file `dist/server.mjs`. `standaloneServerJs` at `bin/pi-web.mjs:230` is likewise marked `@deprecated` and kept only as an old-name alias for one release.

---

## Three-level artifact-entry resolution

`resolveRuntime()` (`bin/pi-web.mjs:263`) locates the back-end entry by priority, stopping at the first hit:

| Level | Condition | Entry source | Unpacks? |
|-------|-----------|--------------|----------|
| ① | `PI_WEB_DIST_DIR` is set | `<PKG_ROOT>/<PI_WEB_DIST_DIR>/server.mjs` | No (isolated build / e2e) |
| ② | `<PKG_ROOT>/dist/server.mjs` already exists | in-repo already-built artifact | No (development) |
| ③ | none of the above hit (npm-installed) | packaged compressed payload `payload/` → shared runtime dir | **first run triggers unpacking** |

- Levels ①② let post-`pnpm build:dist` local iteration, CLI e2e, and the unpackaged desktop-shell e2e all keep passing with zero changes, without being slowed down by first-run unpacking.
- Level ③ is the shape after a global npm install: the published package ships only `payload/` (not `dist/`). On first launch, `payload/unpack.mjs` unpacks into a shared runtime directory and the console prints:

  ```
  [pi-web] 首次启动,已解包运行时 → <distRoot>(<N>ms)
  ```

`distServerJs()` (`bin/pi-web.mjs:225`) is the entry computation for levels ①②: `join(PKG_ROOT, process.env.PI_WEB_DIST_DIR ?? "dist", "server.mjs")`.

---

## First-run shared-runtime unpacking

On the first launch in npm-installed mode, `ensureRuntime()` (the packaged `payload/unpack.mjs`, sourced from `src/runtime/unpack.src.mjs:435`) unpacks the compressed payload into a shared runtime directory:

- **Target directory**: `~/.pi/web/runtime/<version>-<digest prefix>/` (`defaultRuntimeRoot`, `src/runtime/unpack.src.mjs:145-148`; the directory name is produced by `runtimeDirName`, `:73`). The root path can be overridden with `PI_WEB_RUNTIME_ROOT`.
- **Concurrency safety**: when multiple instances first-launch at once, they coordinate via a lock directory + heartbeat (`acquireLock`, `src/runtime/unpack.src.mjs:370`); latecomers reuse the already-unpacked result instead of unpacking again.
- **Digest verification**: the payload digest is computed on the fly while unpacking, and the operation aborts if it does not match once the read completes (`src/runtime/unpack.src.mjs:274-278`).
- **GC**: old runtime directories are reclaimed on a best-effort basis only **after** the back-end has been launched, keeping the most recent `GC_KEEP=2` versions (`scheduleRuntimeGc`, `bin/pi-web.mjs:284`; `gcRuntimeRoot`, `src/runtime/unpack.src.mjs:561`). GC never blocks or affects startup.

When unpacking fails, `main()` translates the discriminant error code into readable text (`RUNTIME_ERROR_HINTS`, `bin/pi-web.mjs:392-401`):

| Error code | User's next step |
|------------|------------------|
| `runtime-root-unwritable` | The runtime directory is not writable; check permissions or relocate it with `PI_WEB_RUNTIME_ROOT` |
| `disk-full` | Insufficient disk space; clean up and retry |
| `payload-missing` / `payload-corrupt` | Payload missing/corrupt; reinstall `@blksails/pi-web` |
| `zstd-unsupported` | Node version too old; upgrade to Node >= 22.15.0 |
| `lock-timeout` | Timed out waiting for another instance to unpack; confirm no stuck process and retry |

> This shared-runtime payload production line also serves the desktop edition (Tauri); for the full mechanism see [20 · Desktop Edition (Tauri) Packaging and Distribution](./20-desktop-tauri.md). For a self-service failure quick-reference, see [23 · Troubleshooting / FAQ](./23-troubleshooting-faq.md).

---

## Installation

### Prerequisites

- Node.js >= 22.19.0 (`package.json:6` `engines.node`)
- pnpm >= 9 (only needed when building from the monorepo source)

### Global install from npm (recommended)

The CLI is published to the public npm registry under the name `@blksails/pi-web` (`package.json:89-91` `publishConfig.access: "public"`):

```bash
npm i -g @blksails/pi-web
# or
pnpm add -g @blksails/pi-web

pi-web --version   # 0.2.0
pi-web --help
```

The published package ships only three things—the thin launcher, the packaged compressed payload, and the vite config the back-end uses to resolve aliases (`package.json:11-15`):

```json
{
  "name": "@blksails/pi-web",
  "version": "0.2.0",
  "bin": { "pi-web": "bin/pi-web.mjs" },
  "files": ["bin", "payload", "vite.config.ts"],
  "publishConfig": { "access": "public" }
}
```

After installation, the first run automatically unpacks the shared runtime (see above).

### Build from source and link (development / debugging)

To debug the CLI against local changes, build from the monorepo and link it globally with `npm link`:

```bash
# 1. Build the full artifact set (dist/client + dist/server.mjs + payload/)
pnpm build:dist

# 2. Link globally
npm link

# 3. Verify
pi-web --version
pi-web --help
```

When linked, `resolveRuntime()` hits level ② (the in-repo `dist/server.mjs` already exists) and does not trigger unpacking.

---

## Quick start

```bash
# Use the current directory as the agent source (simplest usage)
pi-web

# Specify an agent source directory, custom port, and auto-open the browser when ready
pi-web ./examples/hello-agent -p 8080 --open

# Bind all network interfaces
pi-web ./my-agent --host 0.0.0.0 -p 3000

# Offline smoke test with the stub agent (no real pi config needed)
pi-web ./examples/hello-agent --stub

# Watch the agent source directory and hot-reload active sessions on file changes
pi-web ./my-agent --watch
```

Once the server is ready, the console prints (`bin/pi-web.mjs:356`):

```
[pi-web] 就绪 → http://127.0.0.1:3000
```

`examples/hello-agent` is the minimal agent bundled with the repo; combined with `--stub`, it lets you run an end-to-end smoke test on a machine with no pi credentials at all.

---

## Options reference

Source: the `parseArgs` configuration in `parseCliArgs` (`bin/pi-web.mjs:53-63`).

| Option | Short flag | Default | Description |
|--------|-----------|---------|-------------|
| `[source]` | — | current directory | agent source (local directory or git source) |
| `--port <n>` | `-p` | `3000` | listen port; when taken, automatically increments to find a free one (up to 20 attempts) |
| `--host <h>` | — | `127.0.0.1` | bind host |
| `--cwd <dir>` | — | working directory when the CLI is invoked | session working directory |
| `--agent-dir <dir>` | — | `~/.pi/agent` | pi config directory |
| `--open` | — | `false` | open the system default browser when ready |
| `--stub` | — | `false` | run with the deterministic stub agent (offline smoke test) |
| `--watch` | — | `false` | watch the local agent source directory and reload active sessions on file changes (local directories only) |
| `--help` | `-h` | — | show help and exit (exit code 0) |
| `--version` | `-v` | — | show the version and exit (exit code 0) |

Unknown / invalid options throw `CliUsageError`, print a usage hint, and exit non-zero without starting the server (`bin/pi-web.mjs:65-68`, `412-420`).

---

## Argument-to-environment-variable mapping

`buildEnv()` (`bin/pi-web.mjs:108-144`) translates CLI options into the env the back-end reads:

| CLI option / default | Environment variable |
|----------------------|----------------------|
| `source` (after absolutization) | `PI_WEB_DEFAULT_SOURCE` |
| `--cwd` (after absolutization) | `PI_WEB_DEFAULT_CWD` |
| `--port` | `PORT` |
| `--host` | `HOSTNAME` |
| fixed injection at CLI startup | `PI_WEB_AUTOSTART=1` (skip the source-picker page and go straight to a session) |
| `--agent-dir` | `PI_WEB_AGENT_DIR` |
| `--stub` | `PI_WEB_STUB_AGENT=1` |
| `--watch` (local source) | `PI_WEB_WATCH=1` + `PI_RUNNER_HOT_RELOAD_PATHS=<source>` |

> `source` / `--cwd` are absolutized relative to the working directory when the CLI is invoked (`baseCwd`), because the back-end child process's cwd becomes the product root (`bin/pi-web.mjs:109-119`). Git-form sources (`git:` / `https:` / `ssh:` / `git@`) are passed through verbatim and not absolutized (`looksLikeGitSource`, `:38`).
>
> `PI_WEB_AUTOSTART=1` is not CLI-exclusive—the desktop shell injects it into the back-end too. For the full semantics of each env, see [06 · Configuration Reference](./06-configuration.md).

### Go straight to a session (autostart)

When launched via the CLI, the agent source is already determined, so there is no need to make the user click once on the source-picker page. The launcher **injects `PI_WEB_AUTOSTART=1` unconditionally** (`bin/pi-web.mjs:128`); the front-end uses this to skip `AgentSourcePicker` and create a session directly from `PI_WEB_DEFAULT_SOURCE`, entering the session UI. "Switch source" still returns to the source-picker page afterward. For non-CLI launches (where this signal is unset), the default behavior is unchanged and the source-picker page is still shown.

---

## Port selection and readiness detection

- **Automatic avoidance**: `findFreePort` (`bin/pi-web.mjs:189`) probes upward from the specified port, trying up to 20 ports, and uses the first free one; if the actual port differs from the requested one it prints a notice (`:317-321`). If all 20 are taken, it errors out. Choosing a free port before launching avoids the readiness probe accidentally hitting the occupant (`:308-316`).
- **Readiness probe**: `waitForReady` (`bin/pi-web.mjs:151`) polls `host:port`, treats any HTTP response as ready, then prints the ready address and decides whether to open the browser based on `--open`. This function is exported so the desktop shell reuses the same readiness logic, avoiding a fork.

---

## --watch hot reload

`--watch` reuses the dev runner's hot-reload mechanism:

- Injects `PI_WEB_WATCH=1` to lift the dev-environment gate.
- Injects `PI_RUNNER_HOT_RELOAD_PATHS=<source>` to tell the watcher which path to monitor.
- On file changes, the idle per-session runner process restarts automatically (resuming the session rather than creating a new one).

**Limitation**: `--watch` only works for local directory sources. When a git source is passed, `main()` prints a warning and skips it (`bin/pi-web.mjs:429-431`), and `buildEnv()` silently omits the watch env (`:139-142`).

### Turn safety (does not interrupt an in-progress session)

A hot reload only actually restarts when the runner is **idle**, avoiding interrupting a streaming response or tool call midway. `requestRestart`'s "busy" check is extended from "has pending commands" to "has pending commands OR turn in progress" (`packages/server/src/rpc-channel/pi-rpc-process.ts:217-220`): when a restart request arrives mid-turn (streaming tokens / tool call / awaiting an extension_ui response), it is deferred and settled uniformly after `agent_end`. Dev mode's `PI_RUNNER_HOT_RELOAD=1` and the CLI's `--watch` share this mechanism, and neither interrupts an in-progress session.

---

## Build and npm scripts quick reference

The CLI artifact is the full production artifact, generated by `pnpm build:dist` chaining five steps (`package.json:22`):

```
vite build(client) → esbuild(server) → pack-dist.mjs → build:unpacker → build:payload
```

| Command | Equivalent operation |
|---------|----------------------|
| `pnpm build:dist` | full five-step build (dist/client + dist/server.mjs + payload/) |
| `pnpm build:cli` | it is `pnpm build:dist` (`package.json:26`, an alias) |
| `pnpm start:cli` | `node bin/pi-web.mjs` (`package.json:27`) |
| `pnpm e2e:cli` | `node e2e/cli/cli-smoke.mjs` |
| `pnpm e2e:cli:watch` | `node e2e/cli/cli-watch.mjs` |
| `pnpm e2e:cli:real` | `node e2e/cli/cli-real.mjs` |
| `pnpm e2e:cli:reloc` | `node e2e/cli/cli-reloc.mjs` |

For build-pipeline details (esbuild single file, pack-dist artifact layout, production CSP), see [19 · Deployment and Operations](./19-deployment.md).

---

## E2E acceptance

The CLI's e2e suite splits into four, each covering a different path:

```bash
# Prerequisite: build first
pnpm build:dist

# Startup-chain smoke test
pnpm e2e:cli
```

- `e2e/cli/cli-smoke.mjs` — artifact integrity + argument paths (`--help`/`--version` exit code 0, unknown argument non-zero and does not start) + stub startup + browser smoke (default source activates a session → message sent → stub streaming response received).
- `e2e/cli/cli-watch.mjs` — specifically validates `--watch` hot-reload behavior.
- `e2e/cli/cli-real.mjs` — real (non-stub) mode startup chain.
- `e2e/cli/cli-reloc.mjs` — **first-run shared-runtime unpacking / relocation path**. The direct artifact path of levels ①② cannot exercise unpacking; unpacking is covered only by `cli-reloc` and the desktop shell's `desktop-packaged` (`bin/pi-web.mjs:257-259`).

---

## FAQ

> The following are high-frequency questions specific to the CLI; for more startup / session troubleshooting, see [23 · Troubleshooting / FAQ](./23-troubleshooting-faq.md).

**Q: At startup it reports `未找到自包含产物 <...>/dist/server.mjs`**

A: The repo hasn't been built yet—run `pnpm build:dist` first (`bin/pi-web.mjs:301-306`). In npm-installed mode it should unpack automatically—if you see this error, level ③'s payload is most likely missing; see the `payload-missing` hint.

**Q: What if the port is taken?**

A: The CLI increments from the specified port (default 3000) to find a free one, trying up to 20 ports, and prints the actual port used. If all 20 are taken, use `-p` to specify a different range.

**Q: `--watch` has no effect**

A: Confirm `source` is a local directory, not a git source such as `git:` / `https:`. A git source has no local directory to watch, so the CLI prints a warning and skips it.

**Q: I changed a file with `--watch`, but the session didn't reload immediately**

A: This is turn-safety protection. A restart only happens when the runner is idle; while the session is streaming a response or calling a tool (turn in progress), the restart is deferred until this turn ends (`agent_end`). It resumes automatically once idle.

**Q: The first launch is slow / I want to specify where the runtime unpacks**

A: In npm-installed mode the first launch unpacks the shared runtime (one-time). Use `PI_WEB_RUNTIME_ROOT` to specify the unpack root directory. For unpacking-related error codes and self-service fixes, see the "First-run shared-runtime unpacking" table above.

---

## Related

- [06 · Configuration Reference](./06-configuration.md) — full explanation of env such as `PI_WEB_DEFAULT_SOURCE`, `PI_WEB_AUTOSTART`, `PI_WEB_DIST_DIR`, `PI_WEB_RUNTIME_ROOT`
- [19 · Deployment and Operations (Web Server)](./19-deployment.md) — the esbuild single-file artifact structure, the packaged-payload production line, and the production CSP
- [20 · Desktop Edition (Tauri) Packaging and Distribution](./20-desktop-tauri.md) — the second delivery form that reuses the same `dist/server.mjs` back-end and shared-runtime payload
- [22 · Development and Testing](./22-development-and-testing.md) — the `pnpm dev` dual-process orchestration and the five-step `build:dist` pipeline
- [23 · Troubleshooting / FAQ](./23-troubleshooting-faq.md) — more startup issues and first-run unpacking troubleshooting
