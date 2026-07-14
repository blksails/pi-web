# 25 · Roadmap

The evolution path of pi-web: from a single-machine Web UI, to a complete delivery form that pairs a remix canvas with desktop distribution, and onward to the planned cloud-native multi-agent collaboration platform.

This chapter answers only two questions: **what has already shipped**, and **what is explicitly planned but not yet implemented**. Every item marked "shipped" is backed by git-tracked code on `main`; every item marked "planned / not implemented" only locks in a seam and does not block currently usable capabilities. Between the two lies an isolation belt — **in development (branch not merged to main)**, covered at the end of this chapter. Readers must not treat anything there as a usable capability.

---

## 1. Shipped Capability Matrix

### 1.1 Core Waves (MVP → Extended Complete)

The following specs are all `phase: implemented` and verified by e2e; together they form the skeleton of pi-web.

| Wave | Spec | Key Deliverables |
|------|------|-----------|
| Protocol root | `protocol-contract` | `@blksails/pi-web-protocol`: RPC types, SSE frames, UIMessage data-part schema, zod validation |
| Transport layer | `rpc-channel` | `PiRpcChannel` interface + `PiRpcProcess` (JSONL over stdio) |
| Source resolution | `agent-source-resolver` | Directory/git entry detection, custom/cli dual-mode determination, spawnSpec |
| Runtime | `agent-runner` | bootstrap runner (jiti loads `index.ts` → `runRpcMode`) + `@blksails/pi-web-agent-kit` |
| Session engine | `session-engine` | `PiSession` broadcasting/lifecycle/extension-UI suspension + `SessionStore` interface |
| HTTP layer | `http-api` | REST + SSE + `createPiWebHandler` (Web Fetch handler; host see 1.2) |
| Frontend | `react-client` | `PiTransport` (AI SDK v5 `ChatTransport`) + `usePiSession`/`usePiControls`/`useExtensionUI` |
| Extension management | `extension-management` | Install/list/uninstall + trust policy + `get_commands` command palette |
| UI components | `ui-components` | `@blksails/pi-web-ui`: `<PiChat>`/Tool/Reasoning/PromptInput + renderer registry |
| Whole-site loop | `app-shell` | Vite SPA frontend + Hono server end-to-end e2e (select source → prompt → browser streaming reply) |

> Note: early docs described the whole-site loop as a "Next.js full chain". That no longer holds — see the architecture migration wave in 1.2.

### 1.2 Architecture Migration Wave · Off Next → Vite + SPA + Hono + esbuild (`vite-spa-migration`, `phase: implemented`)

This was the single largest architecture switch after the MVP. The early roadmap never recorded it, yet it is already merged to `main`:

- **Frontend** switched to a Vite-driven SPA: root `index.html` as the static entry (with an inlined single-instance import map) + `src/main.tsx` as the module entry, producing `dist/client` (`vite.config.ts:22-23,68`).
- **Server host** switched to Hono + `@hono/node-server`; the entire `/api/*` surface collapses to a single `app.all('/api/*')` that forwards to the singleton `createPiWebHandler` (`server/index.ts:33,75-91`).
- **Server bundling** is done by esbuild into a single file `dist/server.mjs` (bundle + esm + node22; the two pi SDK packages, jiti, and pg stay external; the entry must sit at the product root — `scripts/build-server.mjs:27,73-80`).
- **Dev command** `pnpm dev` = `node scripts/dev-all.mjs`, which concurrently launches the API server (`:3000`) and vite dev (`:5173`, with `/api` proxied to `:3000`); during development the browser opens `:5173` (`scripts/dev-all.mjs:32-36`, `vite.config.ts:72-81`).
- **Production CSP hardening**: `productionCsp()` bans `unsafe-eval` and removes `unsafe-inline` from `script-src` (allowlisting the inlined import map via a sha256 hash instead); it is injected through Hono middleware only when `NODE_ENV=production` (`server/static.ts:124-192`).
- **Runtime config endpoint**: the `NEXT_PUBLIC_*` gating variable names are kept, but the semantics are inverted — no longer inlined at build time, they are read from env at server runtime by `GET /api/bootstrap` and delivered as runtime features (`server/bootstrap.ts:91-100`), then injected into the frontend via `setRuntimeFeatures()`. As a result, such env gates (e.g. `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER`) now take effect after restarting the server — no rebuild required.

For architecture details see [03 · System Architecture](./03-architecture.md); for build and deployment forms see [19 · Deployment & Operations](./19-deployment.md); for the CLI first-launch unpack see [18 · CLI](./18-cli.md).

### 1.3 Canvas Workbench Stack (shipped, off by default)

A remix canvas editor aimed at users/integrators, published as two independent packages with code already merged to `main`, and **not shown by default** — whether it appears is decided by whether the agent source mounts `CanvasLauncher`/`CanvasPanel` into named slots (`launcherRail`/`panelRight`), not by a global switch (the historical env gate `NEXT_PUBLIC_PI_WEB_CANVAS` is now kept only for backward compatibility; see [16](./16-canvas-workbench.md)):

| Wave | Spec | Deliverables |
|------|------|--------|
| L1/L2 kernel | `canvas-kit-m1` | `@blksails/pi-web-canvas-kit`: `createCanvasKernel` + 8 built-in drawing tools |
| Action scoring | `canvas-actions-m2` | `defineCanvasAction` + 6 built-in generation actions (outpaint/inpaint/reference/variants/reframe/edit) |
| Plugin triad | `canvas-plugins-m3` | `defineCanvasLayer/Tool/Action` + `registerPluginBundles` namespace/topology validation |
| vision readout | `canvas-vision-readout` | Prompt-bar "Read" button: assembles the working image into a `tool:image_vision` SurfaceOp and sends it into the conversation stream |

`CanvasWorkbench` (stage zoom/pan, tool rail, mask-annotation overlay, version bar, gallery `CanvasGallery`) is built on top of the Surface stack (`domain=canvas` CQRS). Canonical examples: `examples/aigc-canvas-agent`, `examples/canvas-plugin-stickers`.

For the user-facing view see [16 · Canvas Workbench](./16-canvas-workbench.md); for plugin authors see [17 · Canvas Plugin Development](./17-canvas-plugins.md).

### 1.4 Surface Authoritative-Surface Stack (shipped)

A **second cross-process communication plane** orthogonal to the RPC/SSE chat stream: the agent side owns domain authoritative state, with a CQRS single-writer convention of commands upward + state downward. It is implemented, backed by real child-process integration tests, and drives Canvas end to end:

- `createSurface` (agent facade, `packages/tool-kit/src/surface/create-surface.ts`)
- `wireSurfaceBridge` (runner bridge, `packages/server/src/runner/surface-wiring.ts`)
- `useSurface` / `useConversationBridge` (frontend hooks, `packages/react/src/hooks/`)
- protocol contract root `packages/protocol/src/web-ext/surface.ts`

> Terminology discipline: **AAS** (Agent-Authoritative Surface) in `agent-authoritative-surface-design.md` is still, on `main`, an explicitly labeled **pre-spec design-vocabulary term**; the single framework-level authority is `docs/surface-app-runtime-contract-v1.md`, which has absorbed that draft. The **shipped code symbols** of this stack are the `createSurface`/`useSurface` etc. listed above — not an "AAS SDK".

For the concept-first overview see [04 · Surface Authoritative-Surface Stack](./04-surface-stack.md); example `examples/surface-demo-agent`.

### 1.5 Other Merged Waves

The following capabilities were unrecorded in the early roadmap but are all on `main`:

| Capability | Deliverables / Evidence |
|------|--------------|
| Attachment system | `attachment-store` + `attachment-tool-bridge`: reference-style four-layer attachments (L0 object store + L2 resolve handle + tool-output flow-back). See [09](./09-attachment-system.md) |
| AIGC image tools | `image_generation`/`image_edit` loaded via `aigcExtension` + `pi.registerTool` (ToolSpec/compileTool already removed). See [11](./11-aigc-and-vision-tools.md) |
| Vision recognition | `image-vision-tool`: `image_vision` tool + `/img_vision` command + `GET /vision/models`. See [11](./11-aigc-and-vision-tools.md) |
| State injection bridge | `state-injection-bridge`: bidirectional session-level KV, authoritative in the agent child process, `POST /sessions/:id/state` write-back + `control:"state"` downward mirror frame |
| Session readiness handshake | `SessionLifecycleState` + sticky `control:"session-status"` frame + `getCommands` read-only readiness probe |
| Agent-declared routes | `AgentDefinition.routes` → session-anchored endpoints + `slashCompletions` static completion. See [08](./08-agent-development.md) |
| Message queue UI | Enqueue/visualize/retrieve, per-session `control:"queue"` sticky frame. See [15](./15-message-queue.md) |
| Sessions list / launcher rail | `SessionListPanel` + `LauncherRail` (search/new/favorite anchors/webext slot). See [14](./14-sessions-list.md) |
| Global CLI (standalone) | `bin/pi-web.mjs` thin launcher that spawns `dist/server.mjs` + first-launch shared-runtime unpack. See [18](./18-cli.md) |
| Logging system | `@blksails/pi-web-logger` isomorphic structured logging (**already merged to trunk**) + browser panel. See [21](./21-logging.md) |
| New packages | `@blksails/pi-web-logger` (a real leaf in the dependency tree), `-primitives` (6 thin shadcn wrappers). See [05](./05-packages.md) |

> `packages/` now holds **11** independently publishable packages (early docs mistakenly wrote 7). For the full list and dependency graph see [05 · Layered Packages](./05-packages.md).

### 1.6 Desktop (Tauri v2, shipped · verified on some platforms)

pi-web's **second delivery form**: a Tauri v2 desktop shell (not Electron — already migrated). Both related specs are `implemented-partial` — the macOS full chain is verified, cross-platform is not yet fully verified:

- Three installer forms: `dmg` (macOS) / `nsis` (Windows) / `appimage` (Linux), `desktop/src-tauri/tauri.conf.json`.
- Bundled Node sidecar v22.22.0 (trust anchor: the lock file verifies the sha256 of the official archive), `desktop/node-sidecar.lock.json`.
- Shared-runtime first-launch unpack: `payload/dist.tar.zst` + `unpack.mjs` → `~/.pi/web/runtime/<ver>-<digest>/` (`shared-runtime-payload`, also `implemented-partial`).
- Three run modes: `packaged` / `dev` / `unpackaged` (the packaged state force-ignores the dev-url security constraint).

For distribution and runtime details see [20 · Desktop (Tauri) Packaging & Distribution](./20-desktop-tauri.md).

**Test coverage (MVP-wave snapshot)**: protocol 74 / server 289 (incl. 1 skip = LLM-key gated) / react 55 / ui 48 / agent-kit 3 / integration 6 / offline Node e2e 4 / browser Playwright e2e 2. This is a historical snapshot of the MVP wave; the test cases of the subsequent waves in 1.2–1.6 are not counted here. For current per-spec coverage, query with `/kiro-spec-status {feature}`.

### Verify Shipped Capabilities Yourself

```bash
# Run the shipped whole-site loop offline (no real LLM)
PI_WEB_STUB_AGENT=1 pnpm dev
# Open http://localhost:5173 in the browser (/api auto-proxied to :3000)
```

Expected: land on the source-picker page → pick an agent under `examples/` (e.g. `examples/hello-agent`) → send a prompt → receive a streaming reply in the browser. To try Canvas/Surface/vision capabilities, switch the source to `examples/aigc-canvas-agent` or `examples/vision-agent`; the Canvas panel gate is covered in [16](./16-canvas-workbench.md).

---

## 2. Milestone Review

| Milestone | Description | Status |
|--------|------|------|
| M0 | Scaffolding: Web UI + shadcn + ai-elements + example agent | Done |
| M1 | Agent loading + RPC bridge (`PiRpcProcess` + `SessionManager`) | Done |
| M2 | Translation layer + minimal loop (select source → prompt → streaming reply) | Done |
| M3 | Tool cards + reasoning blocks + control panel (model/level/abort/steer/stats) | Done |
| M4 | Extension UI + attachments + AIGC + CLI + completion framework | Done |
| **M5** | **Off Next → Vite+SPA+Hono+esbuild migration · Canvas Workbench · Surface authoritative-surface stack · state injection bridge/readiness handshake · Tauri desktop (verified on some platforms)** | **Done** |
| M6+ | Remote hosts (e2b/ssh/device) + distributed session routing + pi cloud orchestration | Planned |

> The M5 row is new in this revision: it moves the batch of capabilities in 1.2–1.6 — **shipped yet previously scattered without a home** — from the "future" column into the "done" column, cleanly separating them from the **purely planned** capabilities of M6+, so readers don't misread "new things already done" as "not yet done".

---

## 3. In Development (branch not merged to main, currently unusable)

> **Scope warning**: the items below are **not on `main`** — they exist only in unmerged feature branches, and the rest of this manual does not record them. Do not write scripts against them or depend on their commands — they are currently **unusable**, and their command syntax, paths, and behavior are not finalized.

| Item | Status |
|------|------|
| CLI package-management command set (`create`/`install`/`uninstall`/`list`/`update`/`publish` and other subcommands) | In development, not merged to main (branch `feat/cli-package-commands`) |
| Component installer (shadcn-style source-install lane) | In development, not merged to main (branch `feat/component-installer`) |

Before they merge to `main`, what [18 · CLI](./18-cli.md) records remains the **subcommand-free thin launcher** (`bin/pi-web.mjs` accepts only a single `[source]` positional argument + launch options, in `parseCliArgs` of `bin/pi-web.mjs`).

---

## 4. Planned (Future / Out of MVP)

The following items come from `PLAN.md §14` and `.kiro/steering/roadmap.md`. They are **not yet implemented** and only lock in seams, without blocking current capabilities.

### 4.1 embed-integrations — Non-React Embed Integration

**Goal**: An `@blksails/embed` package (**planned, directory not yet created**) that lets any tech stack (Vue/Svelte/plain HTML/back-office systems) integrate pi-web with zero intrusion.

- `<pi-web-chat src endpoint token>` Web Component custom element
- `mountPiChat(el, opts)` imperative mount API
- Styling penetrated via CSS variables + Shadow DOM parts

**Reuse foundation**: the Hono host's REST/SSE protocol is already stable (`POST /sessions`, `GET /sessions/:id/stream`, etc.; see [24 · HTTP/SSE API Reference](./24-http-api-reference.md)), so the embed package is merely a browser-side wrapper of that protocol, requiring no server-side changes.

### 4.2 host-provider-remote — Remote Agent Host

**Goal**: on top of the already-implemented transport-agnostic seam `PiRpcChannel` (`packages/server/src/rpc-channel/pi-rpc-channel.ts`), add an `agentHostProvider` factory (planned in PLAN.md §14.1/§14.3, **not yet landed as a symbol in the current code**) to select a remote backend, lifting the constraint that "the agent must run locally".

| Provider | Mechanism | Status |
|----------|------|------|
| `local` | `child_process` + pipes (currently handled by `PiRpcProcess`) | Implemented |
| `docker` | Per-session container, RPC JSONL over docker exec stdio | Planned |
| `e2b` | e2b sandbox, RPC over e2b SDK process stdio stream | Planned (M6+) |
| `ssh` | Remote host daemon + reverse tunnel | Planned (M6+) |
| `device` | Edge device + WebSocket reverse connection | Planned (M6+) |

**Known risks** (`PLAN.md §14.6`): remote-host cold-start latency (needs sandbox pooling/warm-up); disconnect recovery (session state lives on the remote end, so it needs reconnection rather than rebuilding); device fleet management for security (reverse-tunnel authentication, least privilege) and operations (offline/version drift).

### 4.3 session-router-distributed — Distributed Session Routing

**Goal**: make pi-web scale horizontally and support multi-node deployment. Three sub-items:

1. **Externalized `SessionStore`**: replace the current in-memory implementation `InMemorySessionStore` with a Redis / Cloudflare Durable Object implementation; the `SessionStore` interface (`packages/server/src/session/session-store.ts`) is already reserved in `session-engine`.
2. **Control/data plane split**: the control plane (agent catalog, authentication, routing, billing) is stateless and can run on the edge; the data plane (RPC channel forwarding) is stateful, but the state lives on the host side and the gateway only forwards.
3. **Edge gateway**: stateless authentication + routing + SSE proxy; cross-node sticky routing is resolved by `SessionRouter`.

**Constraint**: in edge mode, `agentHostProvider` **must be a remote type** (`e2b`/`ssh`/`device`), not `local` (the edge runtime cannot spawn child processes).

### 4.4 pi-cloud-orchestration — Multi-Agent Cloud Orchestration

**Goal**: build a cloud layer (possibly an `@blksails/cloud` package) on top of the Hono host, implementing multi-agent management and billing administration.

- `AgentCatalog`: registration, version management, permissions, and sharing of multiple `AgentDefinition`s/sources
- Fleet panel: a unified view of one user's concurrent sessions across multiple agents and multiple hosts
- Billing integration: reuse the pi SDK's existing `get_session_stats` primitive
- Multi-tenant `authResolver` + `authorizeSession` authentication middleware landed

**Reusable pi SDK primitives**: `new_session`/`fork`/`clone`/`switch_session`, `get_session_stats`, `set_session_name`.

### 4.5 Production Hardening (`PLAN.md §11`, distributed into relevant specs)

| Item | Description | Status |
|------|------|------|
| Sandbox selection landing | Container/e2b isolation, fine-grained tool-execution permissions | Planned |
| Graceful shutdown | Session drain + child-process cleanup | Planned |
| Resource quotas | CPU/memory/timeout per-session quotas | Planned |
| Production CSP hardening | Ban `unsafe-eval`, remove `unsafe-inline` in favor of import-map sha256 allowlisting | **Shipped** (see 1.2 / [19](./19-deployment.md)) |
| Structured logging | `@blksails/pi-web-logger` isomorphic logging + browser panel | **Shipped** (see [21](./21-logging.md)) |
| Images and reverse proxy | Containerized release, CDN reverse-proxy configuration | Planned |

---

## 5. Seam Quick Reference

If you want to take part in developing future capabilities, the following are the already-reserved extension points.

Implemented seams whose implementation can be swapped directly:

```
PiRpcChannel         — transport-agnostic RPC channel interface; PiRpcProcess is the local impl
                       location: packages/server/src/rpc-channel/pi-rpc-channel.ts

SessionStore         — externalized session backend interface; current impl InMemorySessionStore
                       location: packages/server/src/session/session-store.ts

authResolver         — (req) => AuthContext (reject → 401)
authorizeSession     — (ctx) => boolean (false → 403)
                       type declarations: packages/server/src/http/auth.ts
                       used at:           packages/server/src/http/router.ts

createSurface        — agent side builds a domain authoritative surface (shipped, see 04)
                       location: packages/tool-kit/src/surface/create-surface.ts
```

Planned (PLAN.md §14.1/§14.3, not yet landed as a code symbol):

```
agentHostProvider    — remote host factory, returns a PiRpcChannel by channel type
                       (unified entry point for docker/e2b/ssh/device impls, planned)
```

---

## Related

- [03 · System Architecture](./03-architecture.md) — the current implementation of Vite SPA ↔ Hono host ↔ child process
- [04 · Surface Authoritative-Surface Stack](./04-surface-stack.md) — the shipped second communication plane
- [05 · Layered Packages](./05-packages.md) — responsibilities and dependency direction of the 11 `@blksails/*` packages
- [16 · Canvas Workbench](./16-canvas-workbench.md) — the shipped remix canvas editor
- [17 · Canvas Plugin Development](./17-canvas-plugins.md) — the triad contract and dual-end wiring
- [18 · CLI](./18-cli.md) — the thin launcher and first-launch shared-runtime unpack
- [19 · Deployment & Operations](./19-deployment.md) — the single-file esbuild artifact and production CSP
- [20 · Desktop (Tauri)](./20-desktop-tauri.md) — the second delivery form
- [24 · HTTP/SSE API Reference](./24-http-api-reference.md) — the stable protocol surface reused by embed / the cloud layer
