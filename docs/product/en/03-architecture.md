# 03 · System Architecture

**pi-web is a three-stage architecture of "Browser (Vite SPA) ↔ thin forwarding Hono host ↔ one Agent subprocess per session"**: all cross-process communication flows over a single transport-agnostic RPC channel (JSONL over stdio), and the backend core is a framework-agnostic `(Request) => Response` handler, bundled by esbuild into a single file `dist/server.mjs`. This chapter walks top-down through that data flow, the three message types of `PiRpcProcess`, and the constraints of stateful long-lived connections, while planting two mental anchors that run through the whole book: **where the frontend Vite SPA is built**, and pi-web's **two orthogonal cross-process communication planes**.

## Two Orthogonal Communication Planes

Before diving into the architecture, establish one overarching idea — front-to-back communication in pi-web is not a single pipe but **two mutually independent, coexisting planes**:

| Plane | Direction & Shape | What It Carries | Where Authority Lives |
| --- | --- | --- | --- |
| **① Session / Conversation Stream** | Request-response + per-turn SSE stream | prompt / steer / tool calls / streamed text-and-thinking replies | the agent's conversation state (message history) |
| **② Surface Authoritative Surface** | Command upstream + state snapshot downstream (CQRS single-writer) | domain state and commands of a rich-interaction UI (e.g. a Canvas) | the authoritative snapshot of some `domain` inside the agent process |

Plane ① is this chapter's main thread — the RPC channel + the event→`UIMessage` translation layer, the classic "say something, stream it back" path. Plane ② is the **Surface authoritative-surface stack**: a piece of rich-interaction UI is modeled as "a thin projection of some `domain` inside the agent process + a command initiator". A UI click becomes a structured command going **upstream** (not through the LLM), and the domain state is mirrored **downstream** to the frontend as an authoritative snapshot. The two share the same subprocess stdio and the same SSE, yet serve entirely different interaction semantics — that is what "orthogonal" means.

> This chapter establishes plane ② only as a **conceptual anchor** (what it is, how it relates to plane ①, which files it lands in); the full API of `createSurface` / `wireSurfaceBridge` / `useSurface` and an end-to-end example are unfolded in [04 Surface Authoritative-Surface Stack](./04-surface-stack.md). Later chapters — [12 Web UI Extension](./12-web-ui-extension.md), [16 Canvas Workbench](./16-canvas-workbench.md), [26 Glossary](./26-glossary.md) — all refer back here.

## Full Data Flow

```
Browser (Vite SPA · AI Elements + useChat)
   │  SSE / HTTP  →  /api/*
   ▼
Hono host (server/index.ts · @hono/node-server adapts fetch↔Node)
   │  one app.all("/api/*") → createPiWebHandler singleton
   │  stdin/stdout JSONL
   ▼
Agent subprocess — node <runnerEntry> (custom)  or  node <piCliEntry> --mode rpc (cli)
                   (one process per session)
```

Three stages:

1. **Browser (Vite SPA)** — AI Elements components + AI SDK v5 `useChat`, sending requests and receiving SSE through a custom `ChatTransport` (`PiTransport`, see `packages/react/src/transport/pi-transport.ts`). The frontend is a static single-page application (`index.html` + `src/main.tsx`, built to `dist/client`), with no SSR / RSC — see the next section "Frontend Build (Vite SPA)".
2. **Thin forwarding Hono host** — `server/index.ts` uses `@hono/node-server` to bridge `IncomingMessage ↔ Web Request/Response` (including SSE streaming responses), acting **purely as a fetch↔Node adapter with no framework-level abstraction**. The entire `/api/*` surface collapses into **a single** `app.all("/api/*")`, forwarding the standard `Request` (`c.req.raw`) losslessly to the `createPiWebHandler` singleton and returning the `Response` verbatim. This layer is process-resident, holds the SSE long-lived connections, and spawns subprocesses, so it cannot run on stateless Serverless / Edge (reason in "Constraints of Stateful Long-Lived Connections").
3. **Agent subprocess** — one per session; in both modes `cmd` is `node`, only the arguments differ: custom mode runs the bootstrap runner (`node <runnerEntry> --agent <entry> --cwd <cwd>`, which internally loads the user's `index.ts` via `jiti` and then calls `runRpcMode`), while cli mode runs `node <piCliEntry> --mode rpc` (see `packages/server/src/agent-source/assemble-spawn.ts`).

### Seeing "One Process per Session" with Your Own Eyes

This architecture can be observed directly — start dev, open a session, then use `pgrep` to inspect the spawned subprocess:

```bash
# 1. Start the dev server (the standard quickstart command)
pnpm dev          # dev-all.mjs: API :3000 + vite :5173

# 2. Open http://localhost:5173 in the browser (vite dev, /api auto-proxied to 3000)
#    Load an agent and send a message to establish a session

# 3. In another terminal, inspect the full command line of the current node subprocesses (pgrep -fl works on both macOS and Linux)
pgrep -fl node | grep -E -- '--mode rpc|--agent'
```

> `pnpm dev` is `node scripts/dev-all.mjs` (`package.json:17`), which **concurrently** brings up two processes: the API host (`server/index.ts`, `:3000`) and vite dev (`:5173`, reverse-proxying `/api` to 3000, see `vite.config.ts:72-81`). During development the browser must open **vite's 5173** — 3000 is the proxied API-only host, and opening it directly shows no SPA frontend. When either process exits or on Ctrl-C, both wind down together (`scripts/dev-all.mjs:20-27`).

After loading `examples/hello-agent` (which contains `index.ts`, taking custom mode), you should expect to see something like this single line:

```
94786 node .../packages/server/runner-bootstrap.mjs --agent .../examples/hello-agent/index.ts --cwd .../examples/hello-agent --agent-dir ~/.pi/agent --session-id <uuid> --source-meta .../examples/hello-agent
```

- If a **custom agent** was loaded (the source contains `index.ts`) → you see `node …/runner-bootstrap.mjs --agent <your entry> --cwd <working directory>`;
- If the **general pi** was loaded (the source has no entry, falling back to cli) → you see `node …/pi… --mode rpc`.

Each additional session opened spawns one more such subprocess; closing a session (`DELETE /api/sessions/:id`) makes the corresponding process exit accordingly. See no subprocess at all? Most likely the session hasn't truly been established yet or has just crashed — for diagnosis see [23 Troubleshooting FAQ](./23-troubleshooting-faq.md).

## Frontend Build (Vite SPA)

The frontend is a **Vite-driven single-page application**, with no more Next.js / App Router / RSC (all of it has been removed from main wholesale):

- **Static entry** — the repo-root `index.html`, containing an inlined singleton import map and the module entry `<script type="module" src="/src/main.tsx">`; `src/main.tsx` is the React mount point.
- **Build output** — `vite build` emits to `dist/client` (`vite.config.ts:68`), pure static assets; in production they are served by the Hono host's `serveStatic` / `serveSpaFallback` (`server/index.ts:94-98`).
- **Runtime config endpoint** — `GET /api/bootstrap` (`server/index.ts:66-67`) replaces the old Next build-time `NEXT_PUBLIC_*` inlining: env is read by the **server** after startup and delivered to the SPA through this endpoint. This is a semantic inversion — switches like `pi-web --canvas` now take effect at **runtime** (rather than being frozen at build time).

Two vite settings are **hard constraints, not to be changed** (`vite.config.ts:5-19` carries the evidential comments):

- `build.target: "esnext"` — at a lower target, vite injects a polyfill for dynamic import that requires `unsafe-eval`, yet the production CSP forbids `unsafe-eval` (see [19 Deployment](./19-deployment.md)); the injection breaks code-extension loading.
- `modulePreload.polyfill: false` — that polyfill injects an inline script and rewrites dynamic-import paths, breaking webext's external-URL entry loading.

Another implicit contract: the `resolve.alias` table in `vite.config.ts` must **replicate `tsconfig.json`'s `paths` verbatim** (`vite.config.ts:37-64`), and the CSS sub-path aliases must be ordered before the main entries (prefix matching would otherwise swallow `/styles.css`) — the three alias tables in `scripts/build-server.mjs` and `vitest.node-e2e.config.ts` must stay consistent.

## The Hinge: RPC Channel + Translation Layer (Plane ①)

The backend core is a single **transport-agnostic RPC channel** `PiRpcChannel`; the **event → AI SDK `UIMessage` stream** translation layer is the hinge between front and back.

```
                   ┌────────────────────────────────────────┐
   Browser  ◀──SSE──│  PiSession (broadcast/lifecycle/ext-UI suspend) │
                   │       ▲ event→UIMessage translation      │
                   │  PiRpcChannel (transport-agnostic)        │
                   │       ▲ JSONL                            │
                   └───────┼────────────────────────────────┘
                           ▼
                 PiRpcProcess (local: child_process)
                           ▼
       custom: node <runnerEntry> (jiti+runRpcMode)  /  cli: node <piCliEntry> --mode rpc
```

Because both modes share the same RPC implementation, the bridge is fully reused, **only the spawn target differs**.

### Why `PiRpcProcess` Is Hand-Written

The SDK's built-in `RpcClient` hard-codes spawning `pi` and does not expose the extension UI sub-protocol. pi-web hand-writes `PiRpcProcess` (`packages/server/src/rpc-channel/pi-rpc-process.ts`, implementing the `PiRpcChannel` port), routing three message types by the `type` field of each line of JSON on stdout:

- `type: "response"` (with `id`) — a command response, fulfilling the Promise for the corresponding `pendingCommands` by `id` (request/response pairing);
- `type: "extension_ui_request"` — an extension UI request (permission prompt, etc.), registered into the `pendingExtensionUI` pending table, awaiting the upper layer to write back via `respondExtensionUI`;
- any other frame carrying a `type` string — treated uniformly as a streaming `event` (`agent_start` / `agent_end` / `message_update`, etc.: text, thinking, tools…), broadcast to `onEvent` listeners.

It wraps a set of command methods aligned with the SDK's `RpcClient` (19 in total: `prompt` / `steer` / `follow_up` / `abort` / `set_model` / `cycle_model` / `get_available_models` / `set_thinking_level` / `get_state` / `get_messages` / `get_session_stats` / `get_commands` / `compact` / `fork` / `get_fork_messages` / `clone` / `new_session` / `bash` / `abort_bash`) — each one "generates a unique id + sends + waits for the corresponding `response`".

### The Pitfalls of JSONL Framing

A hand-written `JsonlLineReader` (`packages/server/src/rpc-channel/jsonl-reader.ts`) does incremental framing: **splitting lines only on `\n`**, stripping a trailing `\r` (CRLF), concatenating leftover partial lines across chunks, and skipping empty lines. **Node's `readline` is disabled** — it would mistakenly treat `U+2028` / `U+2029` as line separators, yet these characters can legitimately appear inside JSON strings, so splitting on them would corrupt the JSON.

> **There is more than one reader on the subprocess's stdin.** Before entering RPC mode, the runner attaches several more JSONL readers to `process.stdin`: the state-injection bridge (`wireStateBridge`, intercepting `piweb_state_set`), the Surface bridge (`wireSurfaceBridge`, intercepting surface command lines), the message-queue "reclaim" bridge, and others (around `packages/server/src/runner/runner.ts:346`). Each consumes only the frames it recognizes and passes the rest through, forming the **upstream** channel of plane ② and the other cross-process seams; the downstream side reuses the state bridge's direct fd1 writes. See [04](./04-surface-stack.md).

### The Reply Stream: One /stream Subscription per Turn

SSE is not a single session-lifetime persistent connection but a **fresh one opened per turn**. The client `PiTransport.sendMessages` (`packages/react/src/transport/pi-transport.ts`) follows a fixed order: **open the stream first, then POST the prompt** — it first calls `connection.openChunkStream()` to open `GET /sessions/:id/stream`, then `await client.prompt()` to send `POST /sessions/:id/messages` submitting this turn's prompt; the reply frames for this turn come back over that stream, which closes on a `finish` / `abort` frame. Having no stream at all during idle is the normal state.

On the server, `GET /stream` (`packages/server/src/http/routes/stream-route.ts`) calls `PiSession.subscribe()` inside `ReadableStream.start`. For a **late subscriber**, subscribe replays only two things: the log ring-buffer plus the sticky `session-status` / `session-state` frames; the `uiMessageChunk` frames that carry the reply body are broadcast **instantaneously via `EventEmitter`, with no buffering and no replay**. `Last-Event-ID` serves only as the **resume sequence origin** (`startSeq`) — the gateway does not cache historical frames or replay by sequence number.

For this reason the "open the stream first, then POST the prompt" ordering is a hard contract rather than a stylistic choice: if `POST /messages` triggers the agent's first output before the stream has connected (measured: the prompt lands in ~32ms, whereas under dev cold-compile / high load the stream may take seconds to connect — ~79ms when warm, but 3237ms observed when cold), the `uiMessageChunk` frames broadcast within that connection window are lost permanently for lack of buffering, and the reply becomes visible only after a manual refresh (via the history endpoint `GET /sessions/:id/messages`). This is the root cause of the intermittent "have to refresh after sending to see the reply" symptom.

## Constraints of Stateful Long-Lived Connections

> **Cannot run Serverless / Edge** (unless the control/data planes are split); horizontal scaling requires **sticky routing** by `sessionId`.

The chain of causation: one session = one resident subprocess + one SSE long-lived connection → the session state is bound to a particular process-resident instance → subsequent requests for the same `sessionId` must return to the same instance. This constraint is independent of the frontend framework; it stems purely from the host's shape of "process-resident + spawning subprocesses + holding long-lived connections".

The path toward a future distributed setup (roadmap `session-router-distributed`): an external `SessionStore` (Redis/DO) + control/data plane split + an edge gateway.

> The desktop edition (Tauri) is a second delivery form parallel to the web server. In `packaged` mode the Rust shell spawns **the same** `dist/server.mjs` (injecting `PORT` / `PI_WEB_NODE_BIN`, etc.) to bring up the backend from bundled resources — it is subject to the same "one process per session + long-lived connection" constraint, only isolated to a single local instance. See [20 Desktop (Tauri)](./20-desktop-tauri.md).

## Reserved Seams (Interface Isolation)

Transport / isolation / storage are all implemented behind **interfaces**, switched by backend configuration — these are seams reserved for future capabilities:

| Interface | Current Implementation | Future |
| --- | --- | --- |
| `PiRpcChannel` | `PiRpcProcess` (local child_process) | e2b / ssh / device remote host |
| `agentHostProvider` | local spawn | docker / e2b / ssh / device |
| `SessionStore` | in-memory Registry | Redis / Durable Object |
| `BlobStore` | `LocalFsBlobBackend` | S3-style object store |

Beyond the table above there are two **already-landed** cross-process seams (distinct from the "future seams" — these are running today):

- **State-injection bridge** — a session-scoped bidirectional shared KV whose authority lives in the agent subprocess (seam `__piWebSessionState__`, `packages/tool-kit/src/session-state.ts:15`); `POST /sessions/:id/state` writes back, and a `control:"state"` SSE frame mirrors downstream (carrying a monotonic `rev`). Author tools read/write via `getSessionState()`; for the concept and author-facing surface see [04](./04-surface-stack.md), and for the write-back endpoint see [24 HTTP API Reference](./24-http-api-reference.md).
- **Surface bridge** (plane ②) — built on top of the state bridge's downstream (`wireSurfaceBridge` reuses `wireStateBridge`'s direct fd1 writes), with commands going upstream dispatched by the second stdin reader (`packages/server/src/runner/surface-wiring.ts`).

Attachment capabilities are layered as **L0 storage / L1 reference / L2 projection (resolve) / L3 context gate** (see [09 Attachment System](./09-attachment-system.md)).

## Security Is a Replaceable Policy

Sandboxing, trust (`trustPolicy`), and authentication (`authResolver`) are all built as **plugin points** rather than hard-coded:

- The source trust policy is landed by the agent-source resolution pipeline (`packages/server/src/agent-source/resolver.ts`, `trust-policy.ts`, deciding whether a source may be loaded/spawned), with the default implementation returning `"ask"` (a headless-safe default);
- Attachment delivery URLs are self-contained and authenticated via HMAC signing (`GET /attachments/:id/raw?exp&sig`, `sig = HMAC-SHA256(secret, "<id>.<exp>")`, verified with a constant-time `timingSafeEqual` comparison), preventing enumeration and not bound to a session (see `packages/server/src/attachment/url-signer.ts`);
- Extension installation goes through a source allowlist + `--ignore-scripts` (disabling npm lifecycle-script RCE, see `packages/server/src/extensions/install/install-args.ts`);
- The auth gate leaves a seam at the Hono layer: the middleware at `server/index.ts:49-52` behaves exactly as if it did not exist while gating is off (the default); once a multi-tenant / login-wall is merged in, the original `middleware.ts` logic migrates here.

## The Framework-Agnostic Handler

The core of the HTTP layer is `createPiWebHandler` (`packages/server/src/http/create-handler.ts`) — a **Web Fetch `(Request) => Response`** framework-agnostic handler that does method+path routing and SSE encoding itself. The host layer is thin enough to be a single forward:

```ts
// server/index.ts:75-91 (excerpt)
app.all("/api/*", async (c) => {
  const res = await getHandler()(c.req.raw);       // forward the standard Request losslessly to the singleton
  if (c.req.method === "DELETE" && res.ok) {
    const id = wholeSessionIdFromUrl(c.req.url);    // on a successful whole-session delete
    if (id !== undefined) await forgetSessionSource(id).catch(() => {}); // also clear the sessionId→source mapping
  }
  return res;                                       // return the Response (with its SSE ReadableStream body) as-is
});
```

`getHandler()(c.req.raw)` feeds `c.req.raw` (the standard `Request`) directly into the singleton handler and returns the resulting `Response` (including the SSE `ReadableStream` body) verbatim, without rewriting status/headers/body and without buffering. The only extra action is clearing the `sessionId → source` mapping after a successful whole-session DELETE (best-effort, never altering the handler's original response). Note that the webext endpoints (`/api/webext/*`) and `/api/bootstrap` must be registered **before** this general forward (`server/index.ts:54-67`), or `app.all` would grab the match first.

> This means pi-web's backend engine is **not bound to any web framework** — `createPiWebHandler` is a standard `(Request) => Promise<Response>` that, in theory, can be mounted onto any runtime supporting Web Fetch; Hono here is merely a replaceable fetch↔Node adapter.

## Server Build: A Single esbuild File

The server is bundled by `scripts/build-server.mjs` with esbuild into a **single file** `dist/server.mjs` (`bundle` + `format:esm` + `target:node22`):

- **★ The entry must sit at the build-output root** (`dist/server.mjs`, not `dist/server/index.mjs`). `packages/server`'s `runnerBootstrapPath()` / `resolvePiCliEntry()` use "infer from `import.meta.url` → fall back to `process.cwd()` on failure"; esbuild inlines `import.meta.url` as the build machine's absolute path, so on a different machine/OS only the fallback works, and the CLI uses `dirname(serverJs)` as cwd — if the entry were in a subdirectory, every fallback would fail and real sessions would crash (`scripts/build-server.mjs:1-27`).
- **external manifest**: the two pi SDK packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`) + `jiti` + `pg` / `pg-native` are kept external — the first three are dynamically imported by the agent subprocess at runtime via jiti, and static bundling would break pnpm's realpath layout; `pg` contains an optional `require('pg-native')` (`scripts/build-server.mjs:29-35`).
- The production build pipeline is `pnpm build:dist` (`package.json:22`) = five steps chained in series: `build:client` (vite) → `build:server` (esbuild) → `pack-dist` → `build:unpacker` → `build:payload`. The product structure and production CSP hardening are in [19 Deployment](./19-deployment.md).

## Packages/Layers as Boundaries

Dependencies converge in a single direction: `protocol ← everything` (the true zero-dependency leaf root is `logger`, on which `protocol` depends alongside zod); `server` is decoupled through the protocol; `react`/`ui` are decoupled from the backend via the protocol. Each spec's boundary = the package/layer boundary. There are **11** independently publishable packages under packages/; see [05 Packages](./05-packages.md) for details.

## Runtime

- **Language** TypeScript (strict, `any` forbidden);
- **Frontend** Vite + SPA (`index.html` static entry + `src/main.tsx`, built to `dist/client`);
- **Server** Hono host (`server/index.ts`, adapted by `@hono/node-server`), bundled by esbuild into a single file `dist/server.mjs` (`bundle`+`esm`+`node22`, with the two pi SDK packages / jiti / pg kept external, and the entry required at the build-output root);
- **Runtime** Node `>=22.19.0` (`package.json:6`); **Bun for toolchain only**;
- **Agent loading** `jiti` (running the user's `index.ts` directly at runtime).

## Next Steps / Related

- The full API of the second communication plane, the Surface authoritative-surface stack, and the Canvas example → [04 Surface Authoritative-Surface Stack](./04-surface-stack.md)
- The concrete boundaries of packages and layers, and the dependency direction (11 packages) → [05 Packages](./05-packages.md)
- The HTTP endpoints, SSE control frames, `/api/bootstrap`, and the state write-back endpoint mentioned above → [24 HTTP API Reference](./24-http-api-reference.md)
- The full picture of attachment L0–L3 layering and HMAC delivery URLs → [09 Attachment System](./09-attachment-system.md)
- Extension installation / trust policy → [10 Extensions and Skills](./10-extensions-and-skills.md)
- Deployment forms, the esbuild product structure, the production CSP, and the sticky-routing constraint → [19 Deployment](./19-deployment.md)
- The desktop (Tauri) delivery form → [20 Desktop (Tauri)](./20-desktop-tauri.md)
- The dev-all two-process orchestration and build-pipeline details → [22 Development and Testing](./22-development-and-testing.md)
