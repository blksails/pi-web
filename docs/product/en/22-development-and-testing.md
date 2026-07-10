# 22 · Development Standards and Testing

This chapter is aimed at pi-web contributors. It covers the TypeScript coding standards, the two-process `pnpm dev` development loop, the real `build:dist` build pipeline, the layered testing strategy and its script inventory, the testability interface seams, and the Kiro Spec-Driven development workflow.

> The frontend is a Vite-driven SPA (`index.html` as the static entry + `src/main.tsx`, output at `dist/client`); the server host is Hono (`server/index.ts` with a single `app.all('/api/*')`), bundled into one file `dist/server.mjs` by esbuild. Next.js has been removed from main — every command in this chapter follows the real `package.json` scripts, and there is no `.next` / `next dev` / `next build` / `NEXT_DIST_DIR`.

---

## 22.1 TypeScript Standards

All code must compile with zero errors under TypeScript strict mode, and `any` is forbidden.

`tsconfig.base.json` enforces the following options (`tsconfig.base.json:8-19`):

| Option | Value |
|---|---|
| `strict` | `true` |
| `noUncheckedIndexedAccess` | `true` |
| `noImplicitOverride` | `true` |
| `noFallthroughCasesInSwitch` | `true` |
| `isolatedModules` | `true` |

**Rules for handling RPC protocol types**: The single source of truth for the RPC-layer contracts (`RpcCommand` / `RpcResponse` / `AgentEvent` / `RpcExtensionUIRequest` / `RpcExtensionUIResponse`, etc.) is the `@blksails/pi-web-protocol` package, which re-exports them uniformly from its `src/index.ts` (`packages/protocol/src/rpc/*.ts`, `packages/protocol/src/transport/*.ts`). These types were originally derived from the upstream pi SDK's `@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts` (upstream does not expose its RPC-layer types in `exports`), and have since been consolidated into the protocol package for centralized maintenance. **Business code may only import and consume them; redeclaring** these types or `SpawnSpec` locally is forbidden. `SpawnSpec` is likewise exported by `@blksails/pi-web-protocol`, defined in `packages/protocol/src/transport/spawn.ts` (`SpawnSpecSchema`), with the fields `{ cmd, args, cwd, env }`, all four required.

Type-check command (recursively checks all workspace packages at the same time):

```bash
pnpm typecheck
# equivalent to: pnpm -r run typecheck && tsc -p tsconfig.json --noEmit
```

---

## 22.2 Development Loop: the Two-Process `pnpm dev` Orchestration

`pnpm dev` is not a single-process server but `node scripts/dev-all.mjs` (`package.json:17`) — one command that concurrently spins up two processes:

| Process | Port | Purpose |
|---|---|---|
| **API host** (`server/index.ts`, run directly as TS via jiti) | `3000` | Hono `app.all('/api/*')` + session subprocesses |
| **Vite dev server** | `5173` | SPA frontend + HMR, reverse-proxies `/api` to `127.0.0.1:3000` |

**During development the browser opens `http://localhost:5173`** (not 3000). Port `3000` is a pure API host — opening it directly shows JSON, not the chat UI; `/api` requests are forwarded to it by the Vite proxy (`vite.config.ts:72-81`).

The orchestration semantics of `dev-all.mjs` (`scripts/dev-all.mjs:19-36`):

- If either child process exits (or on `Ctrl-C`) → both processes are torn down together with `SIGTERM`;
- Under a non-TTY (background / CI), `stdin` is set to `ignore` — otherwise Vite sees EOF on stdin and self-exits.

Ports are decided by environment variables read in `vite.config.ts:73,78`: `PI_WEB_DEV_CLIENT_PORT` changes the Vite frontend port (default 5173), and `PI_WEB_DEV_API_PORT` changes the backend port the Vite `/api` proxy **points to** (default 3000). Note that the backend process itself listens on `PORT` (`server/index.ts:100`, default 3000, not explicitly set by `dev-all.mjs`); therefore to relocate the backend port as a whole you must set both `PORT` and `PI_WEB_DEV_API_PORT` to the same value, otherwise the proxy points at an empty port.

Start and verify:

```bash
pnpm dev
# The terminal shows logs from two processes: Vite (5173) + API (3000)
# Open http://localhost:5173 in the browser — you should see the source-selection page
```

**Expected result**: the browser at 5173 renders the source-selection page; opening 3000 yields only an API response. Development has no shared build cache, so you can run `pnpm build:dist` in another terminal at any time without polluting the dev state (this is exactly the class of dev conflict that disappeared once Next was dropped, see the comment at `vite.config.ts:74-75`).

> For pure frontend debugging (without the API), use `pnpm dev:client` (just `vite`); for a pure backend hot-run, use `pnpm dev:server` (jiti runs `server/index.ts` directly). For the complete end-to-end getting-started flow, see [01 Quickstart](./01-quickstart.md).

---

## 22.3 Build Pipeline: the Five Steps of `build:dist`

The production build entry is `pnpm build` (= `pnpm build:dist`); `pnpm build:cli` is an alias of `build:dist` (`package.json:20-33`) — there is no separate CLI build path. `build:dist` chains five steps:

| Step | Script | Output / Purpose |
|---|---|---|
| 1 | `build:client` (`vite build`) | Frontend output `dist/client` (default, overridable via `PI_WEB_CLIENT_OUT`) |
| 2 | `build:server` (`node scripts/build-server.mjs`) | esbuild bundles the **single file** `dist/server.mjs` (bundle + esm + node22) |
| 3 | `node scripts/pack-dist.mjs` | Collects runtime dependencies in the original pnpm layout and prunes them |
| 4 | `build:unpacker` (`node scripts/build-unpacker.mjs`) | Emits the zero-dependency single-file unpacker `payload/unpack.mjs` |
| 5 | `build:payload` (`node scripts/pack-payload.mjs`) | Compresses the bundled payload `payload/dist.tar.zst` + `payload.json` |

Key constraints:

- **The entry `dist/server.mjs` must sit at the artifact root** — `build-server.mjs` inlines `import.meta.url` and its fallback path is `process.cwd()`, so moving the entry breaks resolution;
- esbuild `external` = the two pi SDK packages + `jiti` + `pg` (these stay external and are not bundled into the single file);
- The bundled compressed payload of steps 3–5 plus the first-launch unpack mechanism serve CLI and desktop distribution; see [18 CLI](./18-cli.md) and [20 Desktop (Tauri)](./20-desktop-tauri.md) for details.

Start the build artifact locally:

```bash
pnpm build:dist
node dist/server.mjs      # equivalent to pnpm start; open http://localhost:3000 in the browser
```

> **Artifact isolation**: when you need an artifact that does not overwrite the dev-state `dist/` (e.g. dedicated to e2e), point `PI_WEB_DIST_DIR` at another directory (`playwright.config.ts:65`, default `dist`). There is no `NEXT_DIST_DIR` / `.next-cli` / `.next-e2e` / `pack-standalone.mjs` — those Next-era concepts are gone — and neither is the old caution that "running a build while dev is running pollutes `.next` and causes a webpack 500": there is now no shared build cache.

---

## 22.4 Layered Testing Strategy (Hard Requirement)

Every Kiro spec **must** satisfy all three layers below at once, and prove it passes with **fresh run evidence** (actual terminal output or log excerpts); see the `kiro-verify-completion` protocol:

| Layer | Script | Runtime | Coverage Target |
|---|---|---|---|
| **Unit / integration** | `pnpm test:app` (Vitest) | jsdom | Frontend translation-layer pure functions, page-render smoke, handler integration |
| **Node-level e2e** | `pnpm e2e:node` (Vitest) | Node | The full HTTP/SSE path of the real `createPiWebHandler` (offline stub) |
| **Browser e2e** | `pnpm e2e` (Playwright) | Chromium | Source selection → prompt → streaming-reply loop |

The vite-spa migration and the two distribution forms have additional dedicated e2e suites (22.4.5 / 22.4.6), which should also be brought in alongside the relevant specs.

### 22.4.1 Unit / Integration Tests

Config file `vitest.config.ts`: environment `jsdom`, `include: test/**/*.test.ts(x)`, `setupFiles: test/setup.ts`. The alias table maps the raw-TS `@blksails/pi-web-*` packages (including the canvas-kit / canvas-ui subpaths) explicitly to their source files — Vitest does not read `tsconfig` paths, so each one must be aliased individually (`vitest.config.ts:14-29`).

```bash
pnpm test:app          # main app tests only (vitest run)
pnpm test              # recursively across all workspace packages (--workspace-concurrency=1)
```

Example coverage in the main app tests (`test/`):

- `chat-app.test.tsx` — ChatApp component rendering;
- `route.integration.test.ts` — the catch-all session route forwards to `createPiWebHandler` and returns the Response verbatim (including the SSE stream) + config injection / secret redaction checks;
- `bootstrap-gate.test.tsx` / `runtime-features.test.ts` — `GET /api/bootstrap` runtime-gated delivery (replacing the old build-time `NEXT_PUBLIC_*` inlining);
- `attachment-handler-assembly.test.ts`, `system-resource-args.test.ts`.

### 22.4.2 Backend RPC Bridge Integration Tests (`packages/server`)

Each sub-package runs `vitest run` in its own directory; the test directory is `packages/server/test/`:

```
test/
├── rpc-channel/
│   ├── pi-rpc-process.unit.test.ts   # PiRpcProcess message-routing unit tests
│   ├── pi-rpc-process.e2e.test.ts    # spawn → prompt → abort real-subprocess e2e
│   └── fixtures/rpc-stub-process.mjs # fixed-response stub (no API Key required)
├── session/
│   ├── pi-session.lifecycle.test.ts
│   └── mock-channel.ts               # PiRpcChannel mock implementation
└── session-store/
    ├── fs-store.test.ts
    └── sqlite-store.test.ts
```

**Key principle**: the backend RPC bridge uses real subprocesses for integration testing rather than mock processes. The `PiRpcProcess` e2e supports dual modes:

- Default `STUB` (`packages/server/test/rpc-channel/fixtures/rpc-stub-process.mjs` returns fixed responses, no API Key required);
- `PI_WEB_LIVE=1 ANTHROPIC_API_KEY=... pnpm -C packages/server test` switches to the real `pi --mode rpc`.

### 22.4.3 Node-level e2e

Config file `vitest.node-e2e.config.ts`: environment `node`, `include: e2e/node/**/*.test.ts`, timeout 30 seconds. The script already bakes in the stub (`cross-env PI_WEB_STUB_AGENT=1`, cross-platform):

```bash
pnpm e2e:node   # no API Key, no browser required
```

Drives the full HTTP/SSE path of the real `createPiWebHandler`. When Playwright downloads are restricted or the CI headless environment is problematic, this layer can serve as alternative evidence for verifying the streaming path. Examples (`e2e/node/`):

- `streaming.e2e.test.ts` — create session → POST prompt → consume SSE → assert `text-delta` / `reasoning-delta` / `tool-input-available` frames and the permission-dialog round trip;
- `config-domains.e2e.test.ts`, `attachment-completion.e2e.test.ts`;
- `state-bridge.e2e.test.ts` — the state-injection bridge `POST /sessions/:id/state` write-back + the `control:state` downstream mirror;
- `vision-tool.e2e.test.ts` / `vision-models-endpoint.e2e.test.ts` — the `image_vision` tool and `GET /vision/models` enumeration.

### 22.4.4 Browser e2e (Playwright)

Config file `playwright.config.ts`: `testDir: e2e/browser`, `testMatch: *.e2e.ts`, timeout 60 seconds (assertions 15 seconds), `workers: 1` (sequential execution, to avoid server-state races). The browser drives the loop against a **real pi-web server + a deterministic offline stub agent** (`PI_WEB_STUB_AGENT=1`), with no API Key and no cost.

Dual-backend session-persistence projects (`playwright.config.ts:93-110`):

| Project Name | Port | `SESSION_STORE` |
|---|---|---|
| `fs` | `3100` (`PI_WEB_E2E_PORT` base) | `fs` + a temporary `SESSION_STORE_ROOT` |
| `sqlite` | `3101` | `sqlite` + a temporary `SESSION_STORE_PATH` |

`session-persistence.e2e.ts` runs under both projects (persist → URL → cold resume → continue chatting, verified once per backend), while the remaining specs run only under `fs`.

**Self-managed server mode** (Playwright starts the server itself):

```bash
pnpm exec playwright install chromium-headless-shell
pnpm build:dist && pnpm e2e
```

**External server mode** (CI / when you need to keep one server resident; taken from `playwright.config.ts:19-25`):

```bash
pnpm build:dist

# Start the two stub servers (node dist/server.mjs, with PI_WEB_CLIENT_DIR pointing at the frontend output)
PI_WEB_STUB_AGENT=1 PI_WEB_DEFAULT_SOURCE=./examples/hello-agent \
  PI_WEB_CLIENT_DIR="$PWD/dist/client" \
  SESSION_STORE=fs SESSION_STORE_ROOT=/tmp/e2e-fs \
  PORT=3100 node dist/server.mjs &

PI_WEB_STUB_AGENT=1 PI_WEB_DEFAULT_SOURCE=./examples/hello-agent \
  PI_WEB_CLIENT_DIR="$PWD/dist/client" \
  SESSION_STORE=sqlite SESSION_STORE_PATH=/tmp/e2e.db \
  PORT=3101 node dist/server.mjs &

# Run the tests (reusing the already-started external servers)
PI_WEB_E2E_EXTERNAL_SERVER=1 \
  PI_WEB_E2E_FS_ROOT=/tmp/e2e-fs \
  PI_WEB_E2E_SQLITE_PATH=/tmp/e2e.db \
  pnpm e2e
```

**Expected result**: the `fs` project runs every spec, the `sqlite` project runs only the persistence spec, and all pass. Note that `node dist/server.mjs` starts with the repo root as its cwd, and its `clientDir()` defaults to `cwd/client` (which does not exist); therefore external server mode **must** set `PI_WEB_CLIENT_DIR` to point at `dist/client`, otherwise the frontend output 404s.

Browser e2e examples (`e2e/browser/`): `rich-chat.e2e.ts` (source selection → prompt → streaming loop), `session-persistence.e2e.ts` (cold resume), `extension-ui-surfaces.e2e.ts` (Web Extension rendering), `message-queue.e2e.ts`, `aigc-canvas.e2e.ts` / `canvas-plugin-stickers.e2e.ts`.

> If the Playwright port is occupied or downloads are restricted, use the external server mode above first, or fall back to `pnpm e2e:node`. For a roundup of testing and toolchain issues, see [23 · Testing and Toolchain Issues](./23-troubleshooting-faq.md).

### 22.4.5 Production CSP Regression (`e2e:csp`)

The vite-spa migration tightened the production CSP to "no `unsafe-eval` + drop `unsafe-inline` from `script-src`", switching to allowlisting the inline import map via a sha256 hash (`server/static.ts`). This security regression specifically verifies that the import map is still applied by the browser under the tightened CSP, with no inline-script violations:

```bash
node dist/server.mjs &                       # requires the production build artifact
node e2e/csp/import-map-csp.mjs http://localhost:3000
```

It watches the browser console directly: it collects CSP violations (`Refused to execute inline script`) and asserts that the import map has taken effect (`e2e/csp/import-map-csp.mjs:1-14`). For CSP-related production white-screen / silent extension-failure troubleshooting, see [23 Troubleshooting](./23-troubleshooting-faq.md).

### 22.4.6 CLI, Desktop, and Payload e2e

The bundled compressed payload + first-launch unpack mechanism, the CLI launcher, and the Tauri desktop shell each have their own black-box e2e (all `.mjs`, run directly with `node`):

| Script | File | Verifies |
|---|---|---|
| `e2e:cli` | `e2e/cli/cli-smoke.mjs` | CLI smoke start |
| `e2e:cli:watch` | `e2e/cli/cli-watch.mjs` | `--watch` hot reload |
| `e2e:cli:real` / `e2e:cli:reloc` | `e2e/cli/cli-real.mjs` / `cli-reloc.mjs` | Real mode / relocatable artifact |
| `e2e:runtime:conc` | `e2e/runtime-payload/concurrency.mjs` | First-launch unpack concurrency lock |
| `e2e:runtime:recovery` | `e2e/runtime-payload/recovery.mjs` | Recovery after an unpack crash |
| `e2e:desktop:real` | `e2e/desktop/desktop-real.mjs` | Unpackaged shell launches a local session, no orphan exit |
| `e2e:desktop:packaged` | `e2e/desktop/desktop-packaged.mjs` | Packaged state launches the backend from bundled resources |
| `e2e:desktop:nonode` / `:corrupt` | `desktop-no-node.mjs` / `desktop-corrupt-payload.mjs` | Discriminating error codes for missing sidecar / corrupt payload |
| `e2e:desktop:webdriver` | `e2e/desktop/webdriver/bridge.e2e.mjs` | The desktop directory-picker bridge |

For the desktop's overall shape, the bundled Node sidecar, and unpack error codes, see [20 Desktop (Tauri)](./20-desktop-tauri.md); for CLI startup and first-launch unpack, see [18 CLI](./18-cli.md).

> `e2e/parity/compare.mjs` and `e2e/review/webext-review.mjs` are comparison / review aids (not gating regression tests), run manually as needed.

---

## 22.5 Script Inventory

Commonly used entries in `package.json` `scripts`:

| Script | Command | Description |
|---|---|---|
| `dev` | `node scripts/dev-all.mjs` | Two processes: Vite frontend :5173 + API :3000 (open 5173 in the browser) |
| `dev:client` | `vite` | Frontend dev only |
| `dev:server` | jiti runs `server/index.ts` directly | API host only |
| `build` / `build:cli` | `pnpm build:dist` | Production build (the two are equivalent) |
| `build:dist` | client + server + pack-dist + unpacker + payload | The five-step build pipeline (22.3) |
| `build:client` | `vite build` | Frontend output `dist/client` |
| `build:server` | `node scripts/build-server.mjs` | esbuild single file `dist/server.mjs` |
| `build:unpacker` / `build:payload` | `build-unpacker.mjs` / `pack-payload.mjs` | Payload unpacker + compressed payload |
| `start` / `start:dist` | `node dist/server.mjs` | Start the production server |
| `start:cli` | `node bin/pi-web.mjs` | Start the global CLI |
| `typecheck` | `pnpm -r run typecheck && tsc -p tsconfig.json --noEmit` | Full type check |
| `test` | `pnpm -r --workspace-concurrency=1 run test` | All-workspace tests |
| `test:app` | `vitest run` | Main app unit / integration tests |
| `e2e` | `playwright test` | Browser e2e (run `build:dist` first) |
| `e2e:build` | `pnpm build:dist && playwright test` | e2e immediately after build |
| `e2e:node` | `cross-env PI_WEB_STUB_AGENT=1 vitest run -c vitest.node-e2e.config.ts` | Node-level e2e |
| `e2e:csp` | `node e2e/csp/import-map-csp.mjs` | Production CSP import-map allowlist regression |
| `e2e:cli` / `:watch` / `:real` / `:reloc` | `node e2e/cli/*.mjs` | CLI smoke / hot reload / real / relocatable |
| `e2e:desktop:*` | `node e2e/desktop/*.mjs` | Desktop shell e2e (real / packaged / no-node / corrupt / webdriver) |
| `e2e:runtime:conc` / `:recovery` | `node e2e/runtime-payload/*.mjs` | First-launch unpack concurrency / recovery |
| `desktop:sidecar` / `desktop:build` | fetch sidecar / `tauri build` | Desktop Node runtime and packaging |

---

## 22.6 Interface Seams (Testability Boundaries)

The following interfaces are the key injection points for unit tests; any implementation must satisfy the interface contract and may not bypass it:

### PiRpcChannel

Defined in `packages/server/src/rpc-channel/pi-rpc-channel.ts`:

```typescript
interface PiRpcChannel {
  send(line: string): void;
  onLine(listener: LineListener): Unsubscribe;
  close(): Promise<void>;
  health(): ChannelHealth;
}
```

`PiRpcProcess` is the local subprocess implementation; in tests it is replaced by `packages/server/test/session/mock-channel.ts`, with no real subprocess required.

### SessionStore / SessionEntryStore

Defined in `packages/server/src/session-store/`; the backend supports three kinds — `fs` / `sqlite` / `postgres`. Switch via the `SESSION_STORE` environment variable; `SESSION_STORE_ROOT` (fs) or `SESSION_STORE_PATH` (sqlite) specifies the storage path.

### BlobStore

The port interface `BlobStore` is defined in `packages/server/src/attachment/blob-store.ts`; the current implementation `LocalFsBlobBackend` lives in `packages/server/src/attachment/local-fs-backend.ts` (interfaces for other backends such as S3 are reserved). Configured via `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET`, which the main process and the subprocess must keep consistent (otherwise signed URLs return 401).

---

## 22.7 Kiro Spec-Driven Workflow Overview

pi-web follows Kiro spec-driven development; every feature must pass a three-phase approval before it can be implemented.

### Directory Structure

```
.kiro/
├── steering/          # project-level rules (product.md / tech.md / structure.md)
└── specs/
    └── <feature>/
        ├── spec.json          # phase status and approval records
        ├── requirements.md    # EARS-format requirements
        ├── design.md          # architecture design
        └── tasks.md           # implementation task list with checkboxes
```

### Typical Command Chain

```bash
/kiro-spec-init "feature description" # 1. Initialize a new spec
/kiro-spec-requirements <feature>     # 2. Generate requirements (EARS format)
/kiro-validate-gap <feature>          # 3. Analyze the gap against the existing codebase (optional)
/kiro-spec-design <feature>           # 4. Generate the design document
/kiro-spec-tasks <feature>            # 5. Generate implementation tasks
/kiro-spec-status <feature>           # 6. Check progress
/kiro-spec-quick <feature> --auto     # 7. Fast path (fully automatic, skips step-by-step approval)
```

`spec.json` records the current phase and approval status; `phase: "implemented"` means complete. Taking the `rpc-channel` spec (`.kiro/specs/rpc-channel/spec.json`) as an example, its `approvals` field records that all three phases — requirements / design / tasks — have been approved.

### Implementation-Phase Requirements

- Backend RPC bridge implementations must be paired with the integration / e2e tests under `packages/server/test/rpc-channel/`;
- The frontend translation layer (event → UIMessage) is covered by pure-function unit tests;
- Loop verification uses `PI_WEB_STUB_AGENT=1`, requiring no API Key or cost;
- After each spec is complete, call `/kiro-verify-completion` to provide fresh run evidence.

---

## Next Steps / Related

- Run your first streaming reply in 5 minutes (the full `pnpm dev` flow) → [01 Quickstart](./01-quickstart.md)
- The backend RPC channel and session engine, and the Vite/Hono/esbuild architecture → [03 Architecture](./03-architecture.md)
- The boundaries of the 11 sub-packages such as `packages/server` and `packages/protocol` → [05 Packages](./05-packages.md)
- Environment variables such as `SESSION_STORE`, `PI_WEB_ATTACHMENT_DIR`, and `PI_WEB_DIST_DIR` → [06 Configuration](./06-configuration.md)
- The `bin/pi-web.mjs` launcher and first-launch unpack → [18 CLI](./18-cli.md)
- The `dist/server.mjs` artifact structure, the bundled payload, and the production CSP → [19 Deployment](./19-deployment.md)
- Desktop (Tauri) packaging, the sidecar, and desktop e2e → [20 Desktop](./20-desktop-tauri.md)
- Logging configuration for the test environment → [21 Logging](./21-logging.md)
- Troubleshooting build / e2e port conflicts, CSP white screens, and similar issues → [23 Troubleshooting FAQ](./23-troubleshooting-faq.md)
