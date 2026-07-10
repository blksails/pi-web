# 02 · Core Concepts

This is pi-web's conceptual map: grasp the concepts below and every later chapter falls into place.

> This chapter only draws the map; it does not dive deep. Wherever a "see" jump is given, the corresponding dedicated chapter unfolds the code-level detail.

## Agent Source

An **agent source** is the entry descriptor for what pi-web loads. It can be:

- a **local directory** (absolute path), or
- a **git source** (resolved/fetched down to a local directory).

Source resolution (the `agent-source-resolver` spec) does three things:

1. **Resolve** a directory or git → local working directory;
2. **Entry detection** (`entry-probe.ts`) — a `package.json#pi-web.entry` override takes priority; otherwise the first existing one is picked in the order `index.ts` > `index.js` > `index.mjs`; if none exist, there is no entry;
3. **Dual-mode decision** + trust policy → produce a `spawnSpec` (how the child process starts, with types defined by `@blksails/pi-web-protocol`).

### Getting started: treat a local directory as an agent source

`examples/hello-agent` is a minimal custom agent (the directory contains `index.ts`, whose default export is an `AgentDefinition`). Set it as the default source and start the server:

```bash
# custom mode: examples/hello-agent contains index.ts and is judged a custom entry
PI_WEB_DEFAULT_SOURCE="$PWD/examples/hello-agent" pnpm dev
# Open http://localhost:5173 in the browser; creating a session spawns a long-lived child process from this source
```

- `PI_WEB_DEFAULT_SOURCE` is read by `server/bootstrap.ts:73` (via `lib/app/config.ts:97`), defaulting to `builtin:default-agent`.
- `pnpm dev` is `scripts/dev-all.mjs`, which concurrently launches the API server (`:3000`) and the Vite dev server (`:5173`); **in development, open `:5173` in the browser**, and `/api` requests are proxied by Vite to `:3000`.
- `hello-agent` deliberately omits `model`, so it inherits the default provider/model from `~/.pi/agent/settings.json` — any `pi` login runs it out of the box.

Expected result: the source appears on the source-picker page, and after creating a session you can converse with the agent and trigger its `echo` tool.

## Dual-mode Loading

| Mode | Trigger | Spawn target |
| --- | --- | --- |
| **custom** | An entry is detected (`index.ts/js/mjs` or a `pi-web.entry` override) | bootstrap runner (`node <runner-bootstrap.mjs> --agent <entry> --cwd <work>`): `jiti` loads the user entry → normalize into `AgentDefinition` → `createAgentSessionRuntime` → `runRpcMode` |
| **cli** | No entry in the source | pi CLI: `node <piCliEntry> --mode rpc` (the working directory is set via `spawnSpec.cwd`; the pi CLI has no `--cwd` flag) |

**Key decision: both modes expose the same RPC protocol.** The underlying RPC implementation is identical and the front-to-back bridge is fully reused; only the spawn target process differs. This lets pi-web run any custom agent as well as serve the general pi coding agent as a web service, without needing two separate frontends.

> For how to write a custom-mode entry and normalize it into `AgentDefinition`, see [08 · Agent Development](./08-agent-development.md); for cli mode and the global `pi-web` command line, see [18 · CLI](./18-cli.md).

## Session

A session = **one long-lived agent child process**.

- Create a session (`POST /api/sessions`) → resolve the source → spawn the child process → return a `sessionId`;
- For the duration of the session, the process stays resident, and the frontend subscribes to its event stream over SSE;
- `PiSession` (the `session-engine` spec) handles event broadcasting, lifecycle, and the **extension UI suspension table** (permission prompts waiting for the user's response).

The session registry is the `SessionStore` interface (`packages/server/src/session/session-store.ts:12`), with the default implementation `InMemorySessionStore` (in memory, same file `:39`), but **the interface is externalized** — leaving a seam for future distributed backends such as Redis / Durable Object.

> One process per session + a long-lived SSE connection = a **stateful service**. This is the fundamental reason pi-web cannot run on Serverless/Edge, and why horizontal scaling requires sticky routing by `sessionId`. See [03 · Architecture](./03-architecture.md) for details.

> Historical sessions can be browsed in the **Sessions List** and resumed with one click (re-subscribing to their event stream by `sessionId`). See [14 · Sessions List](./14-sessions-list.md) for details.

### Session lifecycle state (readiness handshake)

A child process being "spawned" does not mean it "can accept a prompt": the pi event stream has **no** `session_start` / `ready` anchor, so the moment the server marks a session available is often earlier than the agent can actually process commands. To handle this, pi-web defines a **business readiness state** that is **orthogonal** to the channel's activity state (active/stopping/stopped):

| Lifecycle state | Meaning |
| --- | --- |
| `initializing` | The child process is up but the readiness probe has not yet succeeded (the default initial state, fail-safe: not sendable until confirmed). |
| `ready` | The readiness probe's first response has arrived; the agent can accept prompts. |
| `error` | The probe timed out / the child process exited before becoming ready; the session is unusable. |
| `ended` | Normal stop / the child process exited after becoming ready. |

- The server judges true readiness by **the first response of the read-only probe `getCommands()`** (`packages/server/src/session/pi-session.ts:447-471`).
- The readiness state is broadcast over a **sticky** `control: session-status` frame; new subscribers **replay the current state** on subscription, preventing loss of early frames (`packages/protocol/src/transport/session-status.ts:21-41`).

> The frontend uses this to decide "when the input box can send a message"; on reconnect it also relies on replay to recover the current state. This is the foundational concept for understanding "when a session is usable".

## RPC Channel (`PiRpcChannel`)

At the backend's core is a **transport-agnostic RPC channel**:

```ts
// packages/server/src/rpc-channel/pi-rpc-channel.ts
interface PiRpcChannel {
  send(line: string): void;                 // write one JSONL line downstream (local = child-process stdin)
  onLine(cb: (line: string) => void): Unsubscribe; // register a per-line callback, returns an unsubscribe handle
  close(): Promise<void>;                    // close the channel and exit cleanly
  health(): ChannelHealth;                   // query channel health (alive / exitCode / signal)
}
```

- `PiRpcProcess` (`packages/server/src/rpc-channel/pi-rpc-process.ts`) is its **local implementation** (based on `node:child_process` spawn);
- `SpawnSpec` (how the child process starts) is owned and exported by `@blksails/pi-web-protocol`, the single source of truth;
- The channel is abstracted to leave room for future remote hosts such as e2b / ssh / device.

Child-process communication uses **JSONL framing**: split strictly on `\n`, strip `\r`, and **disable Node `readline`** (which would incorrectly split on `U+2028/2029`). Messages come in three kinds: `response` (command responses), `event` (streaming events), and `extension_ui_request` (extension UI requests, such as permission prompts).

> pi-web **does not directly use the SDK's built-in `RpcClient`** — it hardcodes spawning `pi` and does not expose the extension UI sub-protocol. pi-web writes its own `PiRpcProcess` to handle these three kinds of messages.

## Two orthogonal communication planes

Above the RPC channel, pi-web has **two mutually orthogonal cross-process communication planes**. Building this mental model makes much of the design fall into place: one is the **conversation stream** (one-way rendering of chat messages), the other is the **authoritative surface** (a bidirectional CQRS convention over domain state + commands).

### Plane one: Event → UIMessage translation layer (conversation stream)

This is **the hinge of chat**. The RPC events emitted by the agent child process (text deltas, reasoning, tool calls, tool results, etc.) are converted by the translation layer into AI SDK v5 `UIMessage` data-parts, then pushed over SSE to the browser's `useChat`.

- The backend RPC bridge is safeguarded by **integration tests against real subprocesses**;
- The frontend translation layer is a **pure function**, covered by unit tests.

This plane is **one-way**: agent → browser, rendering a stream of conversation messages.

### Plane two: Surface authoritative surface (domain state + commands)

Some rich interactive UIs (such as the Canvas) do not belong in the chat message stream: they need a piece of **structured domain state** streamed down to the frontend in real time, while the frontend must be able to **issue commands** against that domain — and those commands travel over a structured channel, **bypassing the LLM**. pi-web carries this scenario with the **Surface authoritative surface** paradigm:

- **The authoritative snapshot lives in the agent child process** (single writer, CQRS): state is mirrored down to the frontend over `control: "state"` frames (`packages/tool-kit/src/surface/create-surface.ts`);
- **Commands travel up from the frontend**: the `useSurface` hook sends structured commands to the agent for execution over the ui-rpc channel (`packages/react/src/hooks/use-surface.ts`);
- One `domain` (such as `canvas`) = one authoritative surface.

> This is **orthogonal** to plane one: the chat stream renders messages, the Surface plane synchronizes domain state. The Canvas Workbench is built end-to-end on this plane (`domain=canvas`). The concept is enough here; for the full API of `createSurface` / `wireSurfaceBridge` / `useSurface`, see [04 · Surface Stack](./04-surface-stack.md).
>
> Note: the pre-spec design draft calls this paradigm **AAS (Agent-Authoritative Surface)**; on main it is implemented in the form of the Surface stack, and AAS appears only as design vocabulary.

### The foundation of plane two: the state injection bridge (bidirectional shared KV)

Beneath Surface is a more fundamental **session-level shared KV**, whose authority likewise lives in the agent child process:

- **Downstream** (agent → UI): authoritative KV changes are mirrored to the frontend over the SSE `control: "state"` frame, each key carrying a **monotonically increasing `rev`** (the frontend uses it to drop out-of-order/stale frames, `packages/protocol/src/web-ext/state.ts:14-24`);
- **Write-back** (UI → agent): the frontend writes back via `POST /sessions/:id/state` (`packages/server/src/http/create-handler.ts:172`), with a synchronous ack;
- **Author side**: inside an agent tool, this state is read/written via `getSessionState()` (seam `__piWebSessionState__`, `packages/tool-kit/src/session-state.ts:15`), providing **shared human-machine read/write**.

`examples/state-bridge-agent` is the end-to-end example of this bridge (the AI uses the `increment`/`read_state` tools, the human clicks a button in the UI to write back, and both see the same live state). For the full contract of the write-back endpoint and the `control:"state"` frame, see [24 · HTTP/SSE API Reference](./24-http-api-reference.md); for author-side usage, see [08 · Agent Development](./08-agent-development.md).

## SSE frames: data frames and control frames

The frontend and backend stream data over **SSE (Server-Sent Events)**, with each frame carrying a `protocolVersion`. The top-level frame discriminates two kinds by `kind` (`packages/protocol/src/transport/sse-frame.ts`):

- **`kind: "uiMessageChunk"`** — a data frame embedding a `UiMessageChunk` (text / reasoning / tool / data-part), fed directly to the AI SDK (the conversation-stream plane);
- **`kind: "control"`** — a side-channel **control frame**, further discriminated by its inner `control` field. Control frames are not a single kind; conceptually remember these:
  - `session-status` — the session readiness handshake (the lifecycle state above, sticky);
  - `state` — the authoritative KV downstream mirror of the state injection bridge / Surface;
  - `ui-rpc` — the downstream response of Tier3 extension UI ↔ agent;
  - plus `error` / `queue` / `stats` / `logs` / `session-state`, etc.

> Early docs once said "SSE only pushes UIMessage" — this is incomplete; the control-frame plane is just as real and broadcast. `@blksails/pi-web-protocol` is the stable contract, and changes to its types/schemas require semantic versioning. For the **full enumeration of control frames and "which ones are actually sent"**, see [24 · HTTP/SSE API Reference](./24-http-api-reference.md).

## The two paths for attachments (concept preview)

Attachments do not enter the pi protocol; they live entirely in the pi-web layer. The core is **"reference, not base64"**: history and context hold only `att_<id>` references, and base64 is materialized at only two exits:

1. **Fed to the LLM for vision** — an uploaded image is converted to base64 at this exit and handed to the model;
2. **Handed to a server-side tool** — the file is `resolve`d into a path/url/bytes inside the runner child process via the `attachmentId` parameter, and the tool's output is persisted and flows back.

See [09 · Attachment System](./09-attachment-system.md) for details.

## Other capability surfaces (concept preview)

Beyond the conversation stream and Surface, two large capability surfaces get one line here plus a jump:

- **Web UI Extension (5-tier)** — an agent can attach content to the 21 protocol slots of the Web UI via declarative extensions (from inline widgets to isolated iframe surfaces `artifactSurface`); this is pi-web's mechanism for letting an agent "grow a UI". Note it is **orthogonal** to the Surface plane above: 5-tier is about **mount position**, Surface is about **communication convention**. See [12 · Web UI Extension](./12-web-ui-extension.md) for details.
- **Canvas Workbench** — an image-derivative canvas editor (stage zoom/pan, tool rail, mask annotation, version bar, gallery, vision "Read" button), built on the Surface plane (`domain=canvas`), gated by an environment variable and **off by default**. See [16 · Canvas Workbench](./16-canvas-workbench.md) for details.

## The config directory `~/.pi/agent`

The source of credentials and defaults:

- `auth.json` — provider credentials (generated after `pi` login);
- `settings.json` — default provider/model, etc.;
- `models.json` — custom OpenAI-compatible providers (see [07 · Providers and Models](./07-providers-and-models.md)).

The directory can be overridden via `PI_WEB_AGENT_DIR` / `PI_CODING_AGENT_DIR`. Note that the environment variable is named `PI_CODING_AGENT_DIR` (not `PI_AGENT_DIR`).

## Three invariants (running through the design)

Remember these three and many design decisions become self-consistent:

1. **Single identity** — each attachment has one `att_<id>`, the same identity space across the entire chain (including tool outputs).
2. **Persist before reference** — any attachment is first written to the object store to get an id, before being referenced by a message/tool.
3. **base64 materialized only at named exits** — normally only references are passed; base64 appears briefly only at the two explicit exits, "fed to the LLM" and "tool read", to save context.

## Next / Related

- How these concepts map onto layers and data flow → [03 · Architecture](./03-architecture.md)
- The full API of the Surface authoritative surface / state injection bridge, plus the Canvas instance → [04 · Surface Stack](./04-surface-stack.md)
- The package boundaries mentioned, such as `@blksails/pi-web-protocol` and `@blksails/pi-web-server` → [05 · Packages](./05-packages.md)
- Wrapping a UI around your own agent (the custom-mode entry) → [08 · Agent Development](./08-agent-development.md)
- The full implementation of the three attachment invariants → [09 · Attachment System](./09-attachment-system.md)
- Serving the general pi agent as a web service (cli mode / the `pi-web` command) → [18 · CLI](./18-cli.md)
- The full enumeration of SSE frames and control frames, and the `POST /sessions/:id/state` endpoint → [24 · HTTP/SSE API Reference](./24-http-api-reference.md)
- Look up any unfamiliar term anytime → [26 · Glossary](./26-glossary.md)
