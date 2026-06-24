# 19 · Roadmap

The evolution path of pi-web: from a single-machine Web UI to a cloud-native multi-agent collaboration platform.

---

## Implemented Capability Matrix

### Core Waves (MVP → Extended Complete)

The following specs have all been fully implemented and verified by e2e (`phase: implemented`).

| Wave | Spec | Key Deliverables |
|------|------|-----------|
| Protocol root | `protocol-contract` | `@blksails/pi-web-protocol`: RPC types, SSE frames, UIMessage data-part schema, zod validation |
| Transport layer | `rpc-channel` | `PiRpcChannel` interface + `PiRpcProcess` (JSONL over stdio) |
| Source resolution | `agent-source-resolver` | Directory/git entry detection, custom/cli dual-mode determination, spawnSpec |
| Runtime | `agent-runner` | bootstrap runner (jiti loads `index.ts` → `runRpcMode`) + `@blksails/pi-web-agent-kit` |
| Session engine | `session-engine` | `PiSession` broadcasting/lifecycle/extension UI suspension + `SessionStore` interface |
| HTTP layer | `http-api` | REST + SSE Route Handlers + `createPiWebHandler(Web Fetch)` |
| Frontend | `react-client` | `PiTransport` (AI SDK v5 `ChatTransport`) + `usePiSession`/`usePiControls`/`useExtensionUI` |
| Extension management | `extension-management` | Install/list/uninstall + trust policy + `get_commands` command palette |
| UI components | `ui-components` | `@blksails/pi-web-ui`: `<PiChat>`/Tool/Reasoning/PromptInput + renderer registry |
| Whole-site loop | `app-shell` | Next.js full-chain e2e (select source → prompt → browser streaming reply) |

### Attachment System Wave (2026-06-21, e2e passed)

| Spec | Task Count | Key Deliverables |
|------|--------|-----------|
| `attachment-store` | 21 | L0 object store (LocalFs) + `POST /sessions/:id/attachments` + `GET /attachments/:id/raw` + frontend `useAttachments` |
| `attachment-tool-bridge` | 14 | L2 resolve handle + dual-process store instantiation + `beforeToolCall` ownership check + tool-output persist-and-flow-back |

### Extension Capability Wave (implemented)

| Spec | Key Deliverables |
|------|-----------|
| `agent-web-extension` | Each agent source carries a `.pi/web` UI control layer, Tier1–Tier5 five-layer model |
| `aigc-generation-tools` | AIGC image generation/editing tools, defaulting to `gpt-image-2` |
| `pi-web-cli` | Global CLI (standalone) + `--watch` hot reload + `bin/pi-web.mjs` thin launcher |
| `completion-provider-framework` | `@` trigger completion framework (file provider + realpath security gate) |
| `rich-chat-ui` | Rich `<PiChat>`: session usage panel, slash command palette, tool card redesign |
| `session-persistence-url-resume` | URL-parameter session resume |
| `schema-config-ui` / `config-ui-sandbox-extensions` | JSON Schema config form + sandboxed extension config UI |

**Test coverage snapshot** (`.kiro/steering/roadmap.md`): protocol 74 / server 289 (incl. 1 skip = LLM-key gated) / react 55 / ui 48 / agent-kit 3 / integration 6 / offline Node e2e 4 / browser Playwright e2e 2.

---

## Planned (Future / Out of MVP)

The following items come from `PLAN.md §14` and `.kiro/steering/roadmap.md`. They are **not yet implemented** and only lock in seams, without blocking the MVP.

### embed-integrations — Non-React Embed Integration

**Goal**: An `@blksails/embed` package that lets any tech stack (Vue/Svelte/plain HTML/back-office systems) integrate pi-web with zero intrusion.

Core deliverables:
- `<pi-web-chat src endpoint token>` Web Component custom element
- `mountPiChat(el, opts)` imperative mount API
- Styling penetrated via CSS variables and Shadow DOM parts

**Reuse foundation**: The REST/SSE protocol of `@blksails/pi-web-server` is already stable (`POST /sessions`, `GET /sessions/:id/stream`, etc.). The embed package is merely a browser-side wrapper of that protocol, requiring no server-side changes.

### host-provider-remote — Remote Agent Host

**Goal**: On top of the already-implemented transport-agnostic seam `PiRpcChannel` (`packages/server/src/rpc-channel/pi-rpc-channel.ts`), add an `agentHostProvider` (the factory planned in PLAN.md §14.1/§14.3, **not yet landed in the current code**) to select a remote backend, lifting the constraint that "the agent must run locally".

Planned implementation:

| Provider | Mechanism | Status |
|----------|------|------|
| `local` | `child_process` + pipes (currently handled directly by `PiRpcProcess`) | Implemented |
| `docker` | Per-session container, RPC JSONL over docker exec stdio | Planned |
| `e2b` | e2b sandbox, RPC over e2b SDK process stdio stream | Planned (M5+) |
| `ssh` | Remote host daemon + reverse tunnel | Planned (M5+) |
| `device` | Edge device + WebSocket reverse connection | Planned (M5+) |

**Seam location**: The `PiRpcChannel` interface (`packages/server/src/rpc-channel/pi-rpc-channel.ts`); `PiRpcProcess` (`pi-rpc-process.ts`) is one of its `local` implementations.

**Known risks** (`PLAN.md §14.6`):
- Remote host cold-start latency → requires sandbox pooling/warm-up
- Disconnect recovery: session state lives on the remote end, so it needs reconnection rather than rebuilding
- Device fleet management is a major undertaking: security (reverse-tunnel authentication, least privilege), operations (offline/version drift)

### session-router-distributed — Distributed Session Routing

**Goal**: Make pi-web scale horizontally and support multi-node deployment.

Three sub-items:
1. **Externalized `SessionStore`**: Replace the current in-memory implementation `InMemorySessionStore` (injected by `SessionManager`, `packages/server/src/session/session-store.ts`) with a Redis / Cloudflare Durable Object implementation; the `SessionStore` interface is already reserved in `session-engine`.
2. **Control/data plane split**: The control plane (agent catalog, authentication, routing, billing) is stateless and can run on the edge; the data plane (RPC channel forwarding) is stateful, but the state lives on the host side and the gateway only forwards.
3. **Edge gateway**: Stateless authentication + routing + SSE proxy; cross-node sticky routing is resolved by `SessionRouter`.

**Constraint**: In edge mode, `agentHostProvider` **must be a remote type** (`e2b`/`ssh`/`device`), not `local` (the edge runtime cannot spawn child processes).

### pi-cloud-orchestration — Multi-Agent Cloud Orchestration

**Goal**: Build a cloud layer (possibly an `@blksails/cloud` package) on top of `@blksails/pi-web-server` to implement multi-agent management and billing administration.

Planned features:
- `AgentCatalog`: Registration, version management, permissions, and sharing of multiple `AgentDefinition`s/sources
- Fleet panel: A unified view of one user's concurrent sessions across multiple agents and multiple hosts
- Billing integration: Reuse the pi SDK's existing `get_session_stats` primitive
- Multi-tenant `authResolver` + `authorizeSession` authentication middleware landed

**Reusable pi SDK primitives**: `new_session`/`fork`/`clone`/`switch_session`, `get_session_stats`, `set_session_name`.

### Production Hardening (`PLAN.md §11`, distributed into relevant specs)

| Item | Description |
|------|------|
| Sandbox selection landing | Container/e2b isolation, fine-grained tool execution permissions |
| Graceful shutdown | Session drain + child-process cleanup |
| Resource quotas | CPU/memory/timeout per-session quotas |
| Observability | Structured logging (`packages/logger` implemented, pending merge to trunk) + metrics |
| Images and reverse proxy | Containerized release, CDN reverse-proxy configuration |

---

## Milestone Review

| Milestone | Description | Status |
|--------|------|------|
| M0 | Scaffolding: Next.js + shadcn + ai-elements + example agent | Done |
| M1 | Agent loading + RPC bridge (`PiRpcProcess` + `SessionManager`) | Done |
| M2 | Translation layer + minimal loop (select source → prompt → streaming reply) | Done |
| M3 | Tool cards + reasoning blocks + control panel (model/level/abort/steer/stats) | Done |
| M4 | Extension UI + attachments + AIGC + CLI + completion framework | Done |
| M5+ | Remote hosts (e2b/ssh/device) + distributed routing + pi cloud | Planned |

---

## Seam Quick Reference

If you want to take part in developing future capabilities, the following are the already-reserved extension points:

Implemented seams whose implementation can be swapped directly:

```
PiRpcChannel         — transport-agnostic RPC channel interface; PiRpcProcess is the local impl
                       location: packages/server/src/rpc-channel/pi-rpc-channel.ts

SessionStore         — externalized session backend interface; current impl InMemorySessionStore
                       location: packages/server/src/session/session-store.ts

authResolver         — (req) => AuthContext (reject → 401)
authorizeSession     — (ctx) => boolean (false → 403)
                       type declarations: packages/server/src/http/auth.ts
                       injection surface:  packages/server/src/http/handler.types.ts
                       used at:            packages/server/src/http/router.ts
```

Planned (PLAN.md §14.1/§14.3, not yet landed as a code symbol):

```
agentHostProvider    — remote host factory, returns a PiRpcChannel by channel type
                       (unified entry point for docker/e2b/ssh/device impls, planned)
```

---

## Next Steps / Related

- [03 · System Architecture](./03-architecture.md) — Current implementation details of the RPC channel and seams
- [04 · Package Structure](./04-packages.md) — Projected location of `@blksails/embed` and the package dependency graph
- [07 · Agent Development](./07-agent-development.md) — `AgentDefinition` definition and current usage of the local host
- [08 · Attachment System](./08-attachment-system.md) — Detailed walkthrough of the two implemented attachment specs
- [15 · Deployment](./15-deployment.md) — Current single-machine deployment scheme and containerization reference
</content>
</invoke>
