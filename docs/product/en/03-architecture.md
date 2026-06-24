# 03 · System Architecture

**pi-web is a three-stage architecture of "Browser ↔ thin forwarding Route Handler ↔ one Agent subprocess per session"**: all cross-process communication flows over a single transport-agnostic RPC channel (JSONL over stdio), and the backend core is a framework-agnostic `(Request) => Response` handler. This chapter walks top-down through this data flow, the three message types of `PiRpcProcess`, the constraints of stateful long-lived connections, and the seams reserved for remote isolation / distribution.

## Full Data Flow

```
Browser (AI Elements + useChat)
   │  SSE / HTTP
   ▼
Next.js Route Handler (Node runtime, session process resident)
   │  stdin/stdout JSONL
   ▼
Agent subprocess — node <runnerEntry> (custom)  or  node <piCliEntry> --mode rpc (cli)
                   (one process per session)
```

Three stages:

1. **Browser** — AI Elements components + AI SDK v5 `useChat`, sending requests and receiving SSE through a custom `ChatTransport` (`PiTransport`, see `packages/react/src/transport/pi-transport.ts`).
2. **Next.js Route Handler (Node runtime)** — a thin forwarding layer. `runtime = "nodejs"` is mandatory: it must spawn subprocesses and hold SSE long-lived connections, which Edge/Serverless do not support.
3. **Agent subprocess** — one per session; in both modes `cmd` is `node`, only the arguments differ: custom mode runs the bootstrap runner (`node <runnerEntry> --agent <entry> --cwd <cwd>`, which internally loads the user's `index.ts` via `jiti` and then calls `runRpcMode`), while cli mode runs `node <piCliEntry> --mode rpc` (see `packages/server/src/agent-source/assemble-spawn.ts`).

### Seeing "One Process per Session" with Your Own Eyes

This architecture can be observed directly — start dev, open a session, then use `pgrep` to inspect the spawned subprocess:

```bash
# 1. Start the dev server (the standard quickstart command)
pnpm dev          # next dev — http://localhost:3000

# 2. Open http://localhost:3000 in the browser, load an agent and send a message to establish a session

# 3. In another terminal, inspect the full command line of the current node subprocesses (pgrep -fl works on both macOS and Linux)
pgrep -fl node | grep -E -- '--mode rpc|--agent'
```

After loading `examples/hello-agent` (which contains `index.ts`, taking custom mode), you should expect to see something like this single line:

```
94786 node .../packages/server/runner-bootstrap.mjs --agent .../examples/hello-agent/index.ts --cwd .../examples/hello-agent --agent-dir ~/.pi/agent --session-id <uuid> --source-meta .../examples/hello-agent
```

- If a **custom agent** was loaded (the source contains `index.ts`) → you see `node …/runner-bootstrap.mjs --agent <your entry> --cwd <working directory>`;
- If the **general pi** was loaded (the source has no entry, falling back to cli) → you see `node …/pi… --mode rpc`.

Each additional session opened spawns one more such subprocess; closing a session (`DELETE /api/sessions/:id`) makes the corresponding process exit accordingly. See no subprocess at all? Most likely the session hasn't truly been established yet or has just crashed — for diagnosis see [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md).

## The Hinge: RPC Channel + Translation Layer

The backend core is a single **transport-agnostic RPC channel** `PiRpcChannel`; the **event → AI SDK `UIMessage` stream** translation layer is the hinge between front and back.

```
                   ┌──────────────────────────────────────────────────────────┐
   Browser ◀──SSE──│ PiSession (broadcast / lifecycle / extension UI suspend) │
                   │       ▲ event→UIMessage translation                      │
                   │  PiRpcChannel (transport-agnostic)                       │
                   │       ▲ JSONL                                            │
                   └───────┼──────────────────────────────────────────────────┘
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

## Constraints of Stateful Long-Lived Connections

> **Cannot run Serverless / Edge** (unless the control/data planes are split); horizontal scaling requires **sticky routing** by `sessionId`.

The chain of causation: one session = one resident subprocess + one SSE long-lived connection → the session state is bound to a particular process-resident instance → subsequent requests for the same `sessionId` must return to the same instance.

The path toward a future distributed setup (roadmap `session-router-distributed`): an external `SessionStore` (Redis/DO) + control/data plane split + an edge gateway.

## Reserved Seams (Interface Isolation)

Transport / isolation / storage are all implemented behind **interfaces**, switched by backend configuration — these are seams reserved for future capabilities:

| Interface | Current Implementation | Future |
| --- | --- | --- |
| `PiRpcChannel` | `PiRpcProcess` (local child_process) | e2b / ssh / device remote host |
| `agentHostProvider` | local spawn | docker / e2b / ssh / device |
| `SessionStore` | in-memory Registry | Redis / Durable Object |
| `BlobStore` | `LocalFsBlobBackend` | S3-style object store |

Attachment capabilities are layered as **L0 storage / L1 reference / L2 projection (resolve) / L3 context gate** (see [08](./08-attachment-system.md)).

## Security Is a Replaceable Policy

Sandboxing, trust (`trustPolicy`), and authentication (`authResolver`) are all built as **plugin points** rather than hard-coded:

- The source trust policy is landed by the agent-source resolution pipeline (`packages/server/src/agent-source/resolver.ts`, `trust-policy.ts`, deciding whether a source may be loaded/spawned), with the default implementation returning `"ask"` (a headless-safe default);
- Attachment delivery URLs are self-contained and authenticated via HMAC signing (`GET /attachments/:id/raw?exp&sig`, `sig = HMAC-SHA256(secret, "<id>.<exp>")`, verified with a constant-time `timingSafeEqual` comparison), preventing enumeration and not bound to a session (see `packages/server/src/attachment/url-signer.ts`);
- Extension installation goes through a source allowlist + `--ignore-scripts` (disabling npm lifecycle-script RCE, see `packages/server/src/extensions/install/install-args.ts`).

## The Framework-Agnostic Handler

The core of the HTTP layer is `createPiWebHandler` (`packages/server/src/http/create-handler.ts`) — a **Web Fetch `(Request) => Response`** framework-agnostic handler that does method+path routing and SSE encoding itself. Next.js's catch-all routes (`app/api/sessions/[[...path]]/route.ts`, `app/api/config/[[...path]]/route.ts`, `app/api/attachments/[[...path]]/route.ts`) are merely `getHandler()(req)` — forwarding the standard `Request` losslessly to the singleton handler and returning the `Response` as-is (including the SSE `ReadableStream` body), without rewriting status/headers/body and without buffering.

> This means pi-web's backend engine is **not bound to Next.js** — in theory it can be mounted onto any runtime that supports Web Fetch.

## Packages/Layers as Boundaries

Dependencies converge in a single direction: `protocol ← everything`; `server` depends only on `protocol`; `react`/`ui` are decoupled from the backend via the protocol. Each spec's boundary = the package/layer boundary. See [04 · Packages](./04-packages.md) for details.

## Runtime & Image

- **Language** TypeScript (strict, `any` forbidden);
- **Framework** Next.js 15 (App Router / RSC), API Routes forced to `runtime="nodejs"`;
- **Runtime** Node `>=22.19.0`, image `node:24-bookworm-slim`; **Bun for toolchain only**;
- **Agent loading** `jiti` (running the user's `index.ts` directly at runtime).

## Next Steps / Related

- The concrete boundaries of packages and layers, and the dependency direction → [04 · Packages](./04-packages.md)
- Per-endpoint documentation of the HTTP endpoints mentioned above (`/api/sessions`, `/api/attachments`, etc.) → [13 · HTTP API Reference](./13-http-api-reference.md)
- The full picture of attachment L0–L3 layering and HMAC delivery URLs → [08 · Attachment System](./08-attachment-system.md)
- Extension installation / trust policy → [09 · Extensions and Skills](./09-extensions-and-skills.md)
- Deployment forms and the sticky routing constraint → [15 · Deployment](./15-deployment.md)
</content>
</invoke>
