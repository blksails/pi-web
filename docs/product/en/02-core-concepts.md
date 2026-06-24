# 02 · Core Concepts

To understand pi-web, just grasp these few concepts.

## Agent Source

An **agent source** is the entry descriptor for what pi-web loads. It can be:

- a **local directory** (absolute path), or
- a **git source** (resolved/fetched down to a local directory).

Source resolution (the `agent-source-resolver` spec) does three things:

1. **Resolve** a directory or git → local working directory;
2. **Entry detection** (`entry-probe.ts`) — a `package.json#pi-web.entry` override takes priority; otherwise the first existing one is picked in the order `index.ts` > `index.js` > `index.mjs`; if none exist, there is no entry;
3. **Dual-mode decision** + trust policy → produce a `spawnSpec` (how the child process starts, with types defined by `@blksails/pi-web-protocol`).

## Dual-mode Loading

| Mode | Trigger | Spawn target |
| --- | --- | --- |
| **custom** | An entry is detected (`index.ts/js/mjs` or a `pi-web.entry` override) | bootstrap runner (`node <runner-bootstrap.mjs> --agent <entry> --cwd <work>`): `jiti` loads the user entry → normalize into `AgentDefinition` → `createAgentSessionRuntime` → `runRpcMode` |
| **cli** | No entry in the source | pi CLI: `node <piCliEntry> --mode rpc` (the working directory is set via `spawnSpec.cwd`; the pi CLI has no `--cwd` flag) |

**Key decision: both modes expose the same RPC protocol.** The underlying RPC implementation is identical, the front-to-back bridge is fully reused, and only the spawn target process differs. This lets pi-web run any custom agent as well as serve the general pi coding agent as a web service, without needing two separate frontends.

> For how to write a custom-mode entry and normalize it into `AgentDefinition`, see [07 · Custom Agent Development](./07-agent-development.md); for cli mode and the global `pi-web` command line, see [14 · CLI](./14-cli.md).

## Session

A session = **one long-lived agent child process**.

- Create a session (`POST /api/sessions`) → resolve the source → spawn the child process → return a `sessionId`;
- For the duration of the session, the process stays resident, and the frontend subscribes to its event stream over SSE;
- `PiSession` (the `session-engine` spec) handles event broadcasting, lifecycle, and the **extension UI suspension table** (permission prompts waiting for the user's response).

The session registry is the `SessionStore` interface (`packages/server/src/session/session-store.ts`), with the default implementation `InMemorySessionStore` (in memory), but **the interface is externalized** — leaving a seam for future distributed backends such as Redis / Durable Object.

> One process per session + a long-lived SSE connection = a **stateful service**. This is the fundamental reason pi-web cannot run on Serverless/Edge, and why horizontal scaling requires sticky routing by `sessionId`. See [03 · Architecture](./03-architecture.md) for details.

> Historical sessions can be browsed in the **Sessions List** and resumed with one click (re-subscribing to their event stream by `sessionId`). See [21 · Sessions List](./21-sessions-list.md) for details.

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

## Event → UIMessage Translation Layer

This is **the hinge between front and back**. The RPC events emitted by the agent child process (text deltas, reasoning, tool calls, tool results, etc.) are converted by the translation layer into AI SDK v5 `UIMessage` data-parts, then pushed over SSE to the browser's `useChat`.

- The backend RPC bridge is safeguarded by **integration tests against real subprocesses**;
- The frontend translation layer is a **pure function**, covered by unit tests.

## SSE Frames and `protocolVersion`

The frontend and backend stream data over **SSE (Server-Sent Events)**, with each frame carrying a `protocolVersion`. `@blksails/pi-web-protocol` is the stable contract; changes to types/schemas require semantic versioning. See [13 · HTTP/SSE API Reference](./13-http-api-reference.md) for details.

## The Two Paths for Attachments (Concept Preview)

Attachments do not enter the pi protocol; they live entirely in the pi-web layer. The core is **"reference, not base64"**: history and context hold only `att_<id>` references, and base64 is materialized at only two exits:

1. **Fed to the LLM for vision** — an uploaded image is converted to base64 at this exit and handed to the model;
2. **Handed to a server-side tool** — the file is `resolve`d into a path/url/bytes inside the runner child process via the `attachmentId` parameter, and the tool's output is persisted and flows back.

See [08 · Attachment System](./08-attachment-system.md) for details.

## The Config Directory `~/.pi/agent`

The source of credentials and defaults:

- `auth.json` — provider credentials (generated after `pi` login);
- `settings.json` — default provider/model, etc.;
- `models.json` — custom OpenAI-compatible providers (see [06](./06-providers-and-models.md)).

The directory can be overridden via `PI_WEB_AGENT_DIR` / `PI_CODING_AGENT_DIR`. Note that the environment variable is named `PI_CODING_AGENT_DIR` (not `PI_AGENT_DIR`).

## Three Invariants (Running Through the Design)

Remember these three and many design decisions become self-consistent:

1. **Single identity** — each attachment has one `att_<id>`, the same identity space across the entire chain (including tool outputs).
2. **Persist before reference** — any attachment is first written to the object store to get an id, before being referenced by a message/tool.
3. **base64 materialized only at named exits** — normally only references are passed; base64 appears briefly only at the two explicit exits, "fed to the LLM" and "tool read", to save context.

## Next / Related

- How these concepts map onto layers and data flow → [03 · Architecture](./03-architecture.md)
- The package boundaries mentioned, such as `@blksails/pi-web-protocol` and `@blksails/pi-web-server` → [04 · Packages](./04-packages.md)
- Wrapping a UI around your own agent (the custom-mode entry) → [07 · Custom Agent Development](./07-agent-development.md)
- Serving the general pi agent as a web service (cli mode / the `pi-web` command) → [14 · CLI](./14-cli.md)
- The full implementation of the three attachment invariants → [08 · Attachment System](./08-attachment-system.md)
- Look up any unfamiliar term anytime → [20 · Glossary](./20-glossary.md)
