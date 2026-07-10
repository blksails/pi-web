# 17 · Development Standards and Testing

This chapter covers pi-web's TypeScript coding standards, the layered testing strategy, the script inventory, the isolated-build conventions, and the Kiro Spec-Driven development workflow.

---

## 17.1 TypeScript Standards

All code must compile with zero errors under TypeScript strict mode, and `any` is forbidden.

`tsconfig.base.json` enforces the following options:

| Option | Value |
|---|---|
| `strict` | `true` |
| `noUncheckedIndexedAccess` | `true` |
| `noImplicitOverride` | `true` |
| `noFallthroughCasesInSwitch` | `true` |
| `isolatedModules` | `true` |

**Rules for RPC protocol types**: The single source of truth for the RPC-layer contracts (`RpcCommand` / `RpcResponse` / `AgentEvent` / `RpcExtensionUIRequest` / `RpcExtensionUIResponse`, etc.) is the `@blksails/pi-web-protocol` package, which re-exports them uniformly from its `src/index.ts` (`packages/protocol/src/rpc/*.ts`, `packages/protocol/src/transport/*.ts`). These types were originally derived from the upstream pi SDK's `@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts` (upstream does not expose its RPC-layer types in `exports`), and have now been consolidated into the protocol package for centralized maintenance. **Business code may only import and consume them; redeclaring** these types or `SpawnSpec` locally is forbidden (the local `rpc-types.ts` copy approach mentioned in the early `PLAN.md` has been superseded by protocol-contract). `SpawnSpec` is likewise exported by `@blksails/pi-web-protocol`, defined in `packages/protocol/src/transport/spawn.ts` (`SpawnSpecSchema`), with the fields `{ cmd, args, cwd, env }`, all four required.

Type-check command (recursively checks all workspace packages at the same time):

```bash
pnpm typecheck
# equivalent to: pnpm -r run typecheck && tsc -p tsconfig.json --noEmit
```

---

## 17.2 Layered Testing Strategy (Hard Requirement)

Every Kiro spec **must** satisfy all three layers below at once:

| Layer | Tooling | Runtime | Coverage Target |
|---|---|---|---|
| **Unit / integration tests** | Vitest (`test:app`) | jsdom | Frontend translation-layer pure functions, page-render smoke |
| **Node-level e2e** | Vitest (`e2e:node`) | Node | Backend RPC bridge + the full HTTP/SSE path (offline stub) |
| **Browser e2e** | Playwright (`e2e`) | Chromium | Source selection → prompt → streaming-reply loop |

Every layer must prove it passes with **fresh run evidence** (actual terminal-output screenshots or log excerpts); see the `kiro-verify-completion` protocol.

### 17.2.1 Unit / Integration Tests

Config file: `vitest.config.ts`

- Environment: `jsdom`
- Test directories: `test/**/*.test.ts`, `test/**/*.test.tsx`
- Setup: `test/setup.ts`

Run:

```bash
pnpm test:app          # main app tests only
pnpm test              # recursively across all workspace packages (concurrency 1)
```

Example coverage in the main app tests (`test/`):

- `chat-app.test.tsx` — ChatApp component rendering
- `route.integration.test.ts` — API Route Handler integration
- `attachment-handler-assembly.test.ts` — attachment handler assembly
- `system-resource-args.test.ts` — system-resource arg parsing

### 17.2.2 Backend RPC Bridge Integration Tests (packages/server)

Each sub-package runs `vitest run` in its own directory; the test files live in `packages/server/test/`:

```
test/
├── rpc-channel/
│   ├── pi-rpc-process.unit.test.ts   # PiRpcProcess message-routing unit tests
│   ├── pi-rpc-process.e2e.test.ts    # spawn → prompt → abort real-subprocess e2e
│   ├── pi-rpc-process.restart.test.ts
│   └── hot-reload.test.ts
├── session/
│   ├── pi-session.lifecycle.test.ts
│   ├── pi-session.commands.test.ts
│   └── mock-channel.ts               # PiRpcChannel mock implementation
└── session-store/
    ├── fs-store.test.ts
    ├── sqlite-store.test.ts
    └── file-session-agent.e2e.test.ts
```

**Key principle**: The backend RPC bridge uses real subprocesses for integration testing rather than mock processes; the `PiRpcProcess` e2e tests support dual modes:

- Default `STUB` (`packages/server/test/rpc-channel/fixtures/rpc-stub-process.mjs` returns fixed responses, no API Key required)
- `PI_WEB_LIVE=1 ANTHROPIC_API_KEY=... pnpm -C packages/server test` switches to the real `pi --mode rpc`

### 17.2.3 Node-level e2e

Config file: `vitest.node-e2e.config.ts`

- Environment: `node`
- Test directory: `e2e/node/**/*.test.ts`
- Timeout: 30 seconds

Run:

```bash
pnpm e2e:node   # the script already bakes in PI_WEB_STUB_AGENT=1, no extra setup needed
```

Drives the full HTTP/SSE path of the real `createPiWebHandler` without a browser. When Playwright downloads are restricted or the CI headless environment is problematic, this layer can serve as alternative evidence for verifying the streaming path.

Example test files (`e2e/node/`):

- `streaming.e2e.test.ts` — create session → POST prompt → consume the SSE stream → verify incremental `text-delta`, `reasoning-delta`, `tool-input-available`, and other frames, and assert the permission-dialog round trip
- `config-domains.e2e.test.ts` — config-domain HTTP endpoints
- `attachment-completion.e2e.test.ts` — attachment trigger completion

### 17.2.4 Browser e2e (Playwright)

Config file: `playwright.config.ts`

- Test directory: `e2e/browser/`, matching `*.e2e.ts`
- Timeout: 60 seconds (assertions 15 seconds)
- Workers: 1 (sequential execution, to avoid server-state races)

Dual-backend project configuration:

| Project Name | Port | `SESSION_STORE` |
|---|---|---|
| `fs` | `3100` (default) | `fs` + `SESSION_STORE_ROOT` |
| `sqlite` | `3101` | `sqlite` + `SESSION_STORE_PATH` |

`session-persistence.e2e.ts` runs under both projects, while the remaining specs run only under the `fs` project.

Run (build first):

```bash
pnpm build && pnpm e2e
```

Or use external-server mode (when the dev server is running, to avoid a second build polluting `.next`):

```bash
# Build first into an isolated directory (see section 17.3)
NEXT_DIST_DIR=.next-e2e pnpm build

# Start the two stub servers
PI_WEB_STUB_AGENT=1 PI_WEB_DEFAULT_SOURCE=./examples/hello-agent \
  NEXT_DIST_DIR=.next-e2e SESSION_STORE=fs SESSION_STORE_ROOT=/tmp/e2e-fs \
  next start -p 3100 &

PI_WEB_STUB_AGENT=1 PI_WEB_DEFAULT_SOURCE=./examples/hello-agent \
  NEXT_DIST_DIR=.next-e2e SESSION_STORE=sqlite SESSION_STORE_PATH=/tmp/e2e.db \
  next start -p 3101 &

# Run the tests
PI_WEB_E2E_EXTERNAL_SERVER=1 \
  PI_WEB_E2E_FS_ROOT=/tmp/e2e-fs \
  PI_WEB_E2E_SQLITE_PATH=/tmp/e2e.db \
  pnpm e2e
```

Example browser e2e test files (`e2e/browser/`):

- `rich-chat.e2e.ts` — the full PiChat loop: source selection → prompt → streaming reply
- `session-persistence.e2e.ts` — cold-resume URL session persistence
- `webext.e2e.ts` / `webext-full.e2e.ts` — Web Extension rendering e2e
- `tool-call-ui.e2e.ts` — tool-call card UI

> Common error: if the page reports a webpack 500 after a build, it is most likely sharing `.next` with a running `next dev` (see [23 · 1.1](./23-troubleshooting-faq.md)); if the Playwright port is occupied or downloads are restricted, use the external-server mode above first, or fall back to `pnpm e2e:node`. For a roundup of testing and toolchain issues, see [23 · 4 Testing and Toolchain Issues](./23-troubleshooting-faq.md).

---

## 17.3 Isolated Builds (Avoiding a Polluted Shared .next)

**Running `next build` while `next dev` is running is forbidden** — both share the `.next` directory, and concurrent writes lead to webpack 500 errors.

| Purpose | `NEXT_DIST_DIR` | Command |
|---|---|---|
| Development (default) | `.next` (implicit) | `pnpm dev` |
| e2e isolated build | `.next-e2e` | `NEXT_DIST_DIR=.next-e2e pnpm build` |
| CLI standalone build | `.next-cli` | `pnpm build:cli` |

After the CLI build, `scripts/pack-standalone.mjs` is invoked to post-process the artifact, emitting to `.next-cli/standalone`.

---

## 17.4 Script Inventory

All `scripts` in `package.json`:

| Script | Command | Description |
|---|---|---|
| `dev` | `next dev` | Dev server (default port 3000; some machines conventionally use 3010 — trust the actual `pnpm dev` output) |
| `build` | `next build` | Production build (writes `.next`) |
| `start` | `next start` | Production start |
| `build:cli` | `NEXT_DIST_DIR=.next-cli next build && NEXT_DIST_DIR=.next-cli node scripts/pack-standalone.mjs` | standalone CLI build |
| `start:cli` | `node bin/pi-web.mjs` | Start the global CLI |
| `test` | `pnpm -r --workspace-concurrency=1 run test` | All-workspace tests |
| `test:app` | `vitest run` | Main app unit/integration tests |
| `e2e` | `playwright test` | Browser e2e (build first) |
| `e2e:build` | `next build && playwright test` | e2e immediately after build |
| `e2e:node` | `PI_WEB_STUB_AGENT=1 vitest run -c vitest.node-e2e.config.ts` | Node-level e2e |
| `e2e:cli` | `node e2e/cli/cli-smoke.mjs` | CLI smoke e2e |
| `e2e:cli:watch` | `node e2e/cli/cli-watch.mjs` | CLI --watch hot-reload e2e |
| `typecheck` | `pnpm -r run typecheck && tsc -p tsconfig.json --noEmit` | Full type check |

---

## 17.5 Interface Seams (Testability Boundaries)

The following interfaces are the key injection points for unit tests; any implementation must satisfy the interface contract and may not bypass it:

### PiRpcChannel

Defined in: `packages/server/src/rpc-channel/pi-rpc-channel.ts`

```typescript
interface PiRpcChannel {
  send(line: string): void;
  onLine(listener: LineListener): Unsubscribe;
  close(): Promise<void>;
  health(): ChannelHealth;
}
```

`PiRpcProcess` is the local subprocess implementation; in tests it is replaced by `mock-channel.ts` (`packages/server/test/session/mock-channel.ts`), with no real subprocess required.

### SessionStore / SessionEntryStore

Defined in: `packages/server/src/session-store/`; the backend supports three kinds — `fs` / `sqlite` / `postgres`. Switch via the `SESSION_STORE` environment variable; `SESSION_STORE_ROOT` (fs) or `SESSION_STORE_PATH` (sqlite) specifies the storage path.

### BlobStore

The port interface `BlobStore` is defined in `packages/server/src/attachment/blob-store.ts`; the current implementation `LocalFsBlobBackend` lives in `packages/server/src/attachment/local-fs-backend.ts` (interfaces for other backends such as S3 are reserved). Configured via `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET`, which the main process and the subprocess must keep consistent (otherwise signed URLs return 401).

---

## 17.6 Kiro Spec-Driven Workflow Overview

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
# 1. Initialize a new spec
/kiro-spec-init "feature description"

# 2. Generate requirements (EARS format)
/kiro-spec-requirements <feature>

# 3. Analyze the gap against the existing codebase (optional)
/kiro-validate-gap <feature>

# 4. Generate the design document
/kiro-spec-design <feature>

# 5. Generate implementation tasks
/kiro-spec-tasks <feature>

# 6. Check progress
/kiro-spec-status <feature>

# 7. Fast path (fully automatic, skipping step-by-step approval)
/kiro-spec-quick <feature> --auto
```

`spec.json` records the current phase and approval status; `phase: "implemented"` means complete. Taking the `rpc-channel` spec (`.kiro/specs/rpc-channel/spec.json`) as an example, its `approvals` field records that all three phases — requirements / design / tasks — have been approved.

### Implementation-Phase Requirements

- Backend RPC bridge implementations must be paired with the integration/e2e tests under `packages/server/test/rpc-channel/`
- The frontend translation layer (event → UIMessage) is covered by pure-function unit tests
- Loop verification uses `PI_WEB_STUB_AGENT=1`, requiring no API Key or cost
- After each spec is complete, call `/kiro-verify-completion` to provide fresh run evidence

---

## Next Steps / Related

- Backend RPC channel and session-engine architecture → [03 Architecture](./03-architecture.md)
- Sub-package boundaries such as `packages/server`, `packages/protocol` → [05 Packages](./05-packages.md)
- Environment variables such as `SESSION_STORE`, `PI_WEB_ATTACHMENT_DIR` → [06 Configuration](./06-configuration.md)
- The `build:cli` standalone build and `bin/pi-web.mjs` → [18 CLI](./18-cli.md)
- Production build and server startup → [19 Deployment](./19-deployment.md)
- Logging configuration for the test environment → [21 Logging](./21-logging.md)
- Troubleshooting build pollution, e2e port conflicts, and similar issues → [23 Troubleshooting FAQ](./23-troubleshooting-faq.md)
