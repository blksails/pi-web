# 24 · HTTP/SSE API Reference

pi-web exposes every session, configuration, attachment, state-bridge, and vision/AIGC operation as a uniform REST + SSE surface, driven under the hood by the framework-agnostic `createPiWebHandler` factory. This chapter is the consolidated endpoint reference for the whole manual — the endpoints scattered across the feature chapters (sessions list, message queue, attachments, extensions, AIGC/vision, Canvas) are gathered here. Read the relevant feature chapter first for the semantics, then come back here for the concrete request/response contracts.

---

## Architecture Overview

Next.js has been deleted from `main`. The server host is **Hono** (`server/index.ts`); `@hono/node-server` acts only as a `fetch↔Node` adapter and introduces no framework-level abstraction. The entire `/api/*` surface collapses into **one** `app.all('/api/*')` forwarder to the `getHandler()` singleton — but **before** it, the host registers a few endpoints that bypass the handler (webext resources, `/api/bootstrap`), because the generic forwarder would otherwise match them first.

```
Browser (Vite SPA, dev :5173 / prod same port)
         │  fetch /api/**
         ▼
server/index.ts  (Hono host, default PORT=3000)
  ├── app.get('/api/webext/singletons/:name')  ┐ registered first: webext resources
  ├── app.get('/api/webext/resolve')           │ (must precede the generic /api/*
  ├── app.get('/api/webext/dist/:dir/*')       │  forwarder, or the handler grabs the match)
  ├── app.get('/api/bootstrap')                ┘ SPA runtime configuration
  └── app.all('/api/*')  ─────────────┐  everything else under /api
                                       ▼
                        getHandler()  ← lib/app/pi-handler.ts singleton
                                       │
                                       ▼
                        createPiWebHandler(opts)
                        packages/server/src/http/create-handler.ts
                                       ├── Router (method + path dispatch)
                                       ├── Built-in endpoints (sessions / config / attachments)
                                       └── Injected endpoints (config / attachment / agent-sources /
                                            favorites / session-list / aigc-models /
                                            vision-models / bash / extensions …)
```

- `c.req.raw` is a standard `Request`; the `Response` returned by the handler (including an SSE `ReadableStream` body) is **passed through verbatim** — status/headers/body are not rewritten and nothing is buffered (`server/index.ts:75-91`).
- The host is a long-running process: it spawns session subprocesses and holds long-lived SSE connections, so it cannot run on Edge/stateless Serverless. This is a framework-agnostic runtime constraint, **no longer** enforced by any `runtime="nodejs"` declaration.
- The server is bundled by esbuild into a single file `dist/server.mjs` (the entry must sit at the artifact root — see [19 · Deployment & Operations](19-deployment.md)).

> **Port**: default `PORT=3000` (`server/index.ts:100`, `process.env.PORT ?? 3000`). In development, `pnpm dev` concurrently brings up the API (:3000) and Vite dev (:5173); the browser opens 5173 and `/api` is proxied by Vite to 3000; hitting the API directly (as in this chapter's curl examples) targets 3000. Production is a single process on one port.

**Endpoint quick reference** (grouped by purpose; see the corresponding sections for detail):

| Purpose | Endpoint |
|---|---|
| SPA bootstrap | `GET /bootstrap` (runtime config, mounted directly by the host, bypasses the handler) |
| Session lifecycle | `POST /sessions`, `DELETE /sessions/:id` |
| Sessions list | `GET /sessions` (lists historical sessions, paginated) |
| Agent-source enumeration | `GET /agent-sources`, `GET·PUT /agent-sources/favorites` |
| Event subscription | `GET /sessions/:id/stream` (SSE) |
| Send message / steer | `POST /sessions/:id/messages`, `/steer`, `/follow_up`, `/abort` |
| Session control | `POST /sessions/:id/model`, `/thinking`, `/fork`, `/ui-response`, `/ui-rpc` |
| State-injection bridge | `POST /sessions/:id/state` (write-back; downstream via SSE `control:state` frame) |
| Session queries | `GET /sessions/:id/state`, `/stats`, `/messages`, `/commands`, `/models`, `/fork-messages`, `/completion` |
| Agent-declared routes | `GET /sessions/:id/agent-routes`, `GET·POST /sessions/:id/agent-routes/:name` |
| Configuration | `GET·PUT /config/:domain`, `GET /config/models` |
| Model enumeration (tool side) | `GET /aigc/models`, `GET /vision/models` |
| Attachments | `POST /sessions/:id/attachments`, `GET /attachments/:id/raw` |

> The full prefix for every endpoint on the browser/curl side is `/api/**` (the handler's internal routes carry no `/api`; that is aligned by `sse.basePath`). webext and `/bootstrap` are mounted directly by the host; everything else goes through `app.all('/api/*')` → handler.

---

## Common Conventions

### Response Structure

A successful response returns a JSON object, with the HTTP status code depending on the endpoint (see below).
All responses (both success and error) carry a protocol-version response header and response-body field (the current protocol version is `0.1.0`, defined in `packages/protocol/src/version.ts`):

```
X-Pi-Protocol-Version: 0.1.0
```

Successful response bodies also have a `protocolVersion` field injected (uniformly appended by `jsonResponse`).

Error responses use a uniform structure:

```json
{
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Session \"abc\" not found.",
    "fields": ["source"]
  },
  "protocolVersion": "0.1.0"
}
```

`fields` appears only when request-body validation fails (400); its value is a list of the offending field paths.

### Error Code Mapping

| Scenario | HTTP status | code |
|---|---|---|
| `SessionNotFoundError` / `:id` not found | 404 | `SESSION_NOT_FOUND` |
| `SessionStoppedError` | 409 | `SESSION_STOPPED` |
| `UnknownExtensionUIError` | 409 | `UNKNOWN_EXTENSION_UI` |
| `MissingInputError` | 400 | `MISSING_INPUT` |
| body is not JSON | 400 | `INVALID_JSON` |
| body DTO validation failed | 400 | `VALIDATION_FAILED` (with `fields`) |
| shutting down (no longer accepting new sessions) | 503 | `SHUTTING_DOWN` |
| upstream RPC command failed | 502 | `UPSTREAM_ERROR` |
| no path match | 404 | `NOT_FOUND` |
| path matched but method mismatched | 405 | `METHOD_NOT_ALLOWED` |
| unknown exception | 500 | `INTERNAL` |

> Source of the code literals: the session-engine error codes are in `packages/server/src/session/session.errors.ts:7` (`SESSION_STOPPED` / `SESSION_NOT_FOUND` / `UNKNOWN_EXTENSION_UI` / `MISSING_INPUT`); the HTTP-layer codes are in `packages/server/src/http/error-map.ts` and the individual route handlers.

Version incompatibility (the client declares an `X-Pi-Protocol-Version` whose major version does not match the server's `0`; if not declared, the request is allowed through):
→ 426 `PROTOCOL_VERSION_MISMATCH`

Auth seam (allows through by default):
→ `authResolver` rejects: 401 `UNAUTHORIZED`; `authorizeSession` returns false: 403 `FORBIDDEN`

---

## Bootstrap API — `/api/bootstrap`

### GET /api/bootstrap — SPA Runtime Configuration

On startup the SPA fetches this endpoint first, retrieving the runtime configuration needed to render the source picker / session page. It is mounted directly by the host (`server/index.ts:67`, **bypassing** `createPiWebHandler`) and replaces the two injection points of the Next.js era: the server component's props, and the 15 `NEXT_PUBLIC_*` gates — the latter were **inlined at build time** under Next (so setting those envs at CLI runtime had no effect). Now folded into this endpoint, they become **true runtime configuration**, so runtime switches like `pi-web --canvas` actually take effect.

**Query parameters**:

| Parameter | Description |
|---|---|
| `sessionId` | Optional. Pass it when cold-loading `/session/:id`; the response then carries that session's agent-source recovery result (`resumeSource`), otherwise the webext extension surface silently disappears after a refresh |

**Success response** 200 (`BootstrapPayload`, see `server/bootstrap.ts:28`):

```jsonc
{
  "defaultCwd": "/workspace",
  "autoStart": false,
  "multiTenant": false,
  "hostApiVersion": "0.1.0",
  "defaultSource": "/path/to/agent",   // optional (when a default source is configured)
  "defaultModel": "claude-opus-4-5",   // optional
  "resumeSource": "/path/to/agent",    // optional (when ?sessionId= matches and can be recovered)
  "features": {
    "canvas": false,          // NEXT_PUBLIC_PI_WEB_CANVAS
    "sourcePicker": false,    // NEXT_PUBLIC_PI_WEB_SOURCE_PICKER
    "launcherRail": false,    // NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL
    "bashEnabled": false,     // NEXT_PUBLIC_PI_WEB_BASH_ENABLED
    "sessionsGlobal": false,  // NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL
    "sessionsManage": true,   // off only when explicitly false/0
    "sessionsSlot": "sidebar",
    "extensionCommands": "",
    "extensionAllowlist": "",
    "extensionBaseUrl": "",
    "disableReadinessHandshake": false
  }
}
```

> **Provider secrets never appear in the response**. The `supabase` field is emitted only when `PI_WEB_MULTI_TENANT=1` and a URL/anon key are configured (the anon key is already a public, browser-side key). For each gate env see [06 · Configuration](06-configuration.md) and [14 · Sessions List](14-sessions-list.md).
>
> **Implementation reference**: `server/bootstrap.ts`

---

## Sessions API — `/api/sessions/**`

### POST /api/sessions — Create a Session

Establishes a new agent session and returns a server-generated `sessionId` (driven by the main process's `randomUUID()`, then passed down to the agent to align with the persistence file id).

**Request body** (`CreateSessionRequestSchema`, see `packages/protocol/src/transport/rest-dto.ts:38`):

```json
{
  "source": "/path/to/agent",
  "cwd": "/working/dir",
  "model": "claude-opus-4-5",
  "env": { "MY_VAR": "value" }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | string | Yes | agent source path or identifier |
| `cwd` | string | No | working directory |
| `model` | string | No | override the default model |
| `env` | object (string→string) | No | additional environment variables |
| `trust` | boolean | No | explicit project-trust intent; gates loading of `.pi/` extensions/subagents/skills; when omitted, decided by the server's trust policy |
| `resumeId` | string | No | when given, "resume an existing session" rather than create a new one; the server resumes from persisted metadata; when absent, a new session is created |

**Success response** 201:

```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000", "protocolVersion": "0.1.0" }
```

> `sessionId` is a UUID (the `sess_abc` used in other endpoints is merely a placeholder).

**Errors**: 400 (missing `source` or DTO validation failure), 503 (service shutting down)

**curl example**:

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"source": "/path/to/.pi", "cwd": "/workspace"}'
```

---

### GET /api/sessions — List Historical Sessions

Lists locally persisted historical sessions (only lightweight session-header metadata; the body is not read), used for browsing and resuming in the Sessions List panel. Mounted via the `routes:` injection seam (`createSessionListRoutes()`), coexisting with the built-in sessions endpoints. Sorted by `updatedAt ?? createdAt` descending, with keyset cursor pagination.

**Query parameters** (`ListSessionsRequestSchema`, see `packages/protocol/src/transport/rest-dto.ts:187`):

| Parameter | Type | Required | Description |
|---|---|---|---|
| `scope` | `"cwd"` \| `"all"` | No | defaults to `cwd` (the current directory); `all` (system/whole-machine) is subject to a global gate |
| `cwd` | string | No | the target directory for `scope=cwd` (fallback when `sessionId` is unavailable) |
| `sessionId` | string | No | when `scope=cwd`, prefer this session's persisted cwd as the target directory |
| `limit` | positive integer | No | per-page cap, defaults to 50, hard-clamped to 200 |
| `cursor` | string | No | opaque keyset cursor (`base64url(JSON.stringify({ ts, id }))`), to fetch the next page |
| `q` | string | No | name search keyword (sidebar-launcher-rail): when non-empty, filters by session name/id substring (case-insensitive), applied before sort/pagination; absent/empty keeps the existing behavior (backward compatible). Max length 100. Matches names only, not body content |

**Success response** 200 (`ListSessionsResponse`, see `rest-dto.ts:222`):

```jsonc
{
  "sessions": [
    {
      "sessionId": "550e8400-...",
      "name": "Refactor auth module",   // optional
      "cwd": "/workspace",
      "createdAt": "2025-06-01T08:00:00.000Z",
      "updatedAt": "2025-06-01T09:30:00.000Z"  // optional (some storage backends lack this value)
    }
  ],
  "nextCursor": "eyJ0cyI6...",  // absent means no more pages
  "scope": "cwd",                // echoes back the effective scope
  "globalEnabled": true,         // whether the system view is enabled, so the frontend can confirm entry-point availability
  "protocolVersion": "0.1.0"
}
```

**Errors**:

| Status | code | Trigger |
|---|---|---|
| 400 | `INVALID_REQUEST` | `scope` / `limit` / `cursor` invalid (the response includes the offending fields) |
| 403 | `SESSIONS_GLOBAL_DISABLED` | `scope=all` but the system view is not enabled (storage is not touched; no session data is returned) |
| 500 | `INTERNAL` | storage read exception |

```bash
curl "http://localhost:3000/api/sessions?scope=cwd&limit=50"
```

> The system view (`scope=all`) is off by default and requires the deployer to set `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=true`. For the full mechanism of pagination, gating, the frontend's three states, and relocation, see [14 · Sessions List](14-sessions-list.md).
>
> **Implementation reference**: `packages/server/src/session-list/session-list-routes.ts`

### GET /api/agent-sources — List Available Agent Sources

Read-only enumeration of "agent sources available in the current environment," for the new-session picker (`AgentSourcePicker`) to browse and pick — clicking an item creates a session with its `source` directly (equivalent to typing it). Data comes from **two merged channels**: a directory scan (first-level subdirectories under `PI_WEB_SOURCES_ROOT`, reusing source-probe semantics to classify custom/cli) ∪ a registry file (`PI_WEB_SOURCES_REGISTRY` JSON), deduplicated by `id` (registry overrides scan). Mounted via the `routes:` injection seam (`createAgentSourcesRoutes()`).

**Strictly read-only**: handling a request performs no writes, no git clone, and no resolve/spawn of a session subprocess. Returns an empty list (success) when no source is configured.

**Query parameters** (`ListAgentSourcesRequestSchema`, see `packages/protocol/src/transport/rest-dto.ts`):

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | positive integer | No | page size, default 100, hard-clamped to 500 |
| `cursor` | string | No | opaque keyset cursor (`base64url(JSON.stringify({ id }))`), to fetch the next page |

**Success response** 200 (`ListAgentSourcesResponse`):

```jsonc
{
  "sources": [
    {
      "id": "/abs/examples/hello-agent",   // stable id: dir→realpath; git→url@ref
      "source": "/abs/examples/hello-agent", // source string passed to POST /sessions
      "name": "hello-agent",                // technical name: package.json name > dir/repo basename
      "kind": "dir",                        // "dir" | "git"
      "origin": "scan",                     // "scan" | "registry"
      "mode": "custom",                     // "custom" (has entry) | "cli"
      "title": "Hello Agent",               // optional display title (pi-web.title / registry.title); list uses title ?? name
      "description": "…",                   // optional (pi-web.description / registry.description / package.json description)
      "avatar": "🤖"                        // optional avatar: image URL/data-URI → <img>; else short text/emoji; falls back to the title's initial
    }
  ],
  "nextCursor": "eyJpZCI6...",  // absent means no more pages
  "protocolVersion": "0.1.0"
}
```

**Display-metadata source**: scanned sources read `title` / `description` / `avatar` from their `package.json` `pi-web` field (the same place as `pi-web.entry`); `name` still comes from the top-level `package.json` name, and `description` falls back to the top-level one. Registry entries may declare `title` / `description` / `avatar` directly. The frontend renders the source list as a widescreen card grid: each card has an avatar + `title ?? name` + mode badge + description + favorite star.

```jsonc
// package.json fragment of an example source
{
  "name": "hello-agent",
  "pi-web": {
    "entry": "index.ts",
    "title": "Hello Agent",
    "description": "The simplest echo agent, for a first walkthrough",
    "avatar": "🤖"
  }
}
```

**Errors**:

| Status | code | Trigger |
|---|---|---|
| 400 | `INVALID_REQUEST` | `limit` / `cursor` invalid (the response includes the offending field) |
| 500 | `INTERNAL` | unexpected assembly/serialization failure (missing/corrupt sources do not count — they degrade to an empty contribution) |

```bash
curl "http://localhost:3000/api/agent-sources?limit=100"
```

> Whether the frontend shows the source list is gated by `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1` — now delivered at **runtime** via `features.sourcePicker` after `GET /api/bootstrap` reads the env server-side (no longer inlined at build time as in the Next.js era). The backend sources are configured via `PI_WEB_SOURCES_ROOT` (`path.delimiter`-separated for multiple) and `PI_WEB_SOURCES_REGISTRY` (default `<agentDir>/sources.json`). See [06 · Configuration](06-configuration.md) for all three.
>
> **Implementation reference**: `packages/server/src/agent-source-list/`

### GET·PUT /api/agent-sources/favorites — Agent Source Favorites (Read/Write)

Favorites are a **user preference** (sidebar-launcher-rail), independent of the read-only source enumeration `/agent-sources`; persisted at `<agentDir>/agent-source-favorites.json`, used by the sidebar launcher rail to render one-click launch anchors. Injected via `createFavoritesRoutes()` and mounted at `/agent-sources/favorites` (GET+PUT). Favoriting/unfavoriting does **not** modify the enumeration sources (scan dir / registry).

- **GET** → `ListFavoritesResponse`: `{ "favorites": [ { "source": "...", "name": "..." } ] }`. A missing/corrupt file degrades to the remaining available items.
- **PUT** `{ favorites }` → `ListFavoritesResponse` (echoes the persisted result): **full replace** (idempotent), atomic tmp+rename write. Invalid body → `400 INVALID_REQUEST`.

```bash
curl -X PUT "http://localhost:3000/api/agent-sources/favorites" \
  -H "Content-Type: application/json" \
  -d '{"favorites":[{"source":"./examples/hello-agent","name":"hello-agent"}]}'
```

| Status | code | Trigger |
|---|---|---|
| 400 | `INVALID_REQUEST` | PUT body invalid JSON / shape mismatch |
| 500 | `INTERNAL` | read/write preference file error |

> **Implementation reference**: `packages/server/src/agent-source-list/favorites-store.ts`, `favorites-routes.ts`

---

### GET /api/sessions/:id/stream — SSE Event Stream

Establishes a long-lived connection to receive session events in real time (text deltas, tool calls, control frames, etc.). This subscription is established **per turn**: each turn's reply is carried by a fresh `/stream` connection the client opens for that turn — it is not a single session-level persistent connection, and having no stream while idle is normal.

**Call-ordering convention (important)**: the client must first create the session, **open this turn's `/stream` subscription first, and only then** `POST /messages` to submit the prompt — the turn's reply frames come back over that already-established stream. The order must not be reversed: reply frames are broadcast transiently via the server's EventEmitter with no buffering, so if the stream is not yet connected, frames broadcast before the connection window are lost permanently (see "Race-condition note" below).

**Response headers**:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
Content-Encoding: identity
X-Pi-Protocol-Version: <semver>
```

**SSE frame format**:

```
event: uiMessageChunk
id: 42
data: {"kind":"uiMessageChunk","protocolVersion":"0.1.0","chunk":{"type":"text-delta","id":"t1","delta":"Hello"}}

event: control
id: 43
data: {"kind":"control","protocolVersion":"0.1.0","payload":{"control":"error","message":"session ended: stopped","code":"stopped"}}

: keep-alive

```

- The `event:` line = frame kind (`uiMessageChunk` or `control`, i.e. the frame's `kind` field)
- The `id:` line = a monotonic frame sequence number, to be carried as `Last-Event-ID` on reconnect
- Heartbeat frames (`: keep-alive`) are sent every 15 seconds (`DEFAULT_HEARTBEAT_MS = 15_000`) to prevent proxy timeouts
- The control-frame payload lives in the `payload` field and is discriminated by `payload.control` (**not** `type`); when the session ends, the server sends one frame with `payload.control = "error"` (`message` describes the reason, `code` is the end reason) and then closes the connection

**Reconnection and replay boundary**: GET this endpoint again with a `Last-Event-ID` header; the server re-subscribes and continues pushing subsequent frames. `Last-Event-ID` serves only as the **starting sequence number** (`startSeq`) for continued delivery — the gateway **does not buffer historical frames and does not replay historical message frames by sequence number**. All a late subscriber (including a reconnection) can "recover" is: the log ring-buffer, plus the **sticky** frames `session-status` / `session-state` / `queue` / state-bridge `state` (registered per key) (`packages/server/src/session/pi-session.ts:271,396,436,578,640`); **the `uiMessageChunk` reply frames already broadcast for the current turn are not replayed** — they are broadcast transiently via the EventEmitter with no buffering. To retrieve missed reply content, use the history endpoint `GET /sessions/:id/messages`.

```bash
curl -N "http://localhost:3000/api/sessions/sess_abc/stream" \
  -H "Last-Event-ID: 42"
```

**Errors**: 404 (session not found), 409 `SESSION_ENDED` (session already ended; returns an explicit response rather than hanging on an empty stream)

> **Important**: session stats (usage statistics) are **not pushed over a dedicated `control:"stats"` frame**. Although the SSE control-frame schema defines a `stats` type, `pi-session` never actually sends a `payload.control = "stats"` frame; usage data must be actively pulled via the `GET /sessions/:id/stats` REST endpoint (or read from the sticky `control:"session-state"` snapshot frame's `snapshot.stats`). For the control frames actually emitted, see [SSE Frame Reference](#kind-control) below.

> **Race-condition note**: `POST /messages` can trigger the agent's first frame extremely fast (measured ~32ms), whereas the same turn's `/stream` may take several seconds to connect under a dev cold compile or heavy load (measured ~3237ms cold, ~79ms warm). If the `POST` happens before the stream connects, the `uiMessageChunk` frames broadcast before the connection window are lost permanently because the server does not buffer them, and the turn's reply becomes visible only after a refresh (via the `GET /sessions/:id/messages` history endpoint) — appearing as "you must manually refresh to see the reply after sending a message," and intermittently so, since it depends on whether the stream connects ahead of the agent's first frame. To avoid it, strictly follow the call-ordering convention above: open this turn's `/stream` subscription first, then `POST /messages`.

---

### POST /api/sessions/:id/messages — Send a Message

Sends a user message to the session, triggering agent inference. Inference results are pushed asynchronously via **this turn's already-established** `/stream` connection. **You must open this turn's `/stream` subscription before calling this endpoint**: reply frames are broadcast transiently via the server's EventEmitter with no buffering, so if this endpoint runs before `/stream` connects, the reply frames before the connection window are lost permanently and can only be recovered by refreshing via the `GET /sessions/:id/messages` history endpoint (see the "Race-condition note" under `GET /sessions/:id/stream`).

**Request body** (`PromptRequestSchema`, see `packages/protocol/src/transport/rest-dto.ts:67`):

```json
{
  "message": "Please help me analyze this code",
  "images": [],
  "attachmentIds": ["att_xyz789"],
  "streamingBehavior": "steer"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `message` | string | Yes | user message text (note the field name is `message`, not `prompt`) |
| `images` | array | No | vision image content (base64) |
| `attachmentIds` | string[] | No | public ids of already-persisted attachments (`att_<nanoid>`); the server injects structured text references |
| `streamingBehavior` | `"steer"` \| `"followUp"` | No | behavior when submitting while inference is in progress |

**Success response** 200: `{ "ok": true }` (the message has been forwarded to the agent)

**Errors**: 400 (validation failure), 404 (session not found), 409 (session stopped)

```bash
curl -X POST http://localhost:3000/api/sessions/sess_abc/messages \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, agent!"}'
```

---

### POST /api/sessions/:id/steer — Steer Output

Injects steering text while inference is in progress.

**Request body** (`SteerRequestSchema`): `{ "message": "Please answer in Chinese", "images": [] }` (`images` is optional; the field name is `message`, not `text`)

**Success response** 200: `{ "ok": true }`
**Errors**: 400, 404, 409

---

### POST /api/sessions/:id/follow_up — Follow-up

**Request body**: same structure as steer (`SteerRequestSchema`): `{ "message": "Continue" }`

**Success response** 200: `{ "ok": true }`
**Errors**: 400, 404, 409

---

### POST /api/sessions/:id/abort — Abort Inference

Aborts the current in-progress inference round.

**Request body**: none (empty body)

**Success response** 200: `{ "ok": true }`

**Errors**: 404, 409

---

### POST /api/sessions/:id/model — Switch Model

**Request body** (`SetModelRequestSchema`): `{ "provider": "anthropic", "modelId": "claude-sonnet-4-5" }` (both fields are required; note it is `provider` + `modelId`, not a single `model` field)

**Success response** 200: `{ "ok": true }`
**Errors**: 400, 404, 409

---

### POST /api/sessions/:id/thinking — Set Extended Thinking

**Request body** (`SetThinkingRequestSchema`): `{ "level": "high" }`

`level` takes a value from the `ThinkingLevel` enum: `"minimal"` | `"low"` | `"medium"` | `"high"` | `"xhigh"` (see `packages/protocol/src/rpc/model.ts:19`). There are **no** `enabled` / `budget` fields.

**Success response** 200: `{ "ok": true }`
**Errors**: 400, 404, 409

---

### POST /api/sessions/:id/ui-response — Extension UI Response

Returns the response a user produced in an extension UI interaction back to the agent. The request body is pi's `RpcExtensionUIResponse` (aliased as `UiResponseRequestSchema`, see `rest-dto.ts:118`), whose `id` field identifies the corresponding UI request.

**Success response** 200: `{ "ok": true }`
**Errors**: 400 (validation failure), 404 (session not found), 409 (unknown UI request id, or session stopped)

---

### POST /api/sessions/:id/ui-rpc — Tier3 UI↔agent RPC

The upstream RPC request from a Web UI extension (Tier3) (`UiRpcRequestSchema`). The response is not returned at this endpoint; instead it flows back via an SSE control frame (`payload.control = "ui-rpc"`), paired by `correlationId`.

**Success response** 200: `{ "ok": true }`
**Errors**: 400, 404, 409

---

### POST /api/sessions/:id/state — Write Back Session Shared State (State-Injection Bridge)

The **state-injection bridge** is a session-level shared-KV route separate from the LLM conversation history, with the authoritative state living in the agent subprocess. This endpoint is its **UI→agent write-back** direction: validate `StateSetRequest` → `PiSession.setState` (dispatched to the subprocess via an internal stdin line) → 200 synchronous ack. The frontend converges via the downstream SSE `control:"state"` frame (not awaited at this endpoint) — see [SSE Frame Reference](#kind-control) below. For the author-side read/write API (`getSessionState()`), see [04 · Surface Authoritative Surface Stack](04-surface-stack.md) and [08 · Custom Agent Development](08-agent-development.md).

**Request body** (`StateSetRequestSchema`, see `packages/protocol/src/web-ext/state.ts:27`):

```json
{ "key": "aigc.selectedModel", "value": "gemini-3.1-flash-image", "op": "set" }
```

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | Yes | state key (non-empty) |
| `value` | any JSON-serializable value | No | the new value when `op=set`; transport-agnostic, not limited to text |
| `op` | `"set"` \| `"delete"` | No | defaults to `set`; `value` is ignored when `delete` |

**Success response** 200: `{ "ok": true }` (synchronous ack; the actual state change flows back via the `control:state` frame)
**Errors**: 400 (payload violates the contract, authoritative state unchanged), 404 (session not found)

```bash
curl -X POST http://localhost:3000/api/sessions/sess_abc/state \
  -H "Content-Type: application/json" \
  -d '{"key":"aigc.selectedModel","value":"gemini-3.1-flash-image"}'
```

> **Implementation reference**: `packages/server/src/http/routes/state-routes.ts:25`

---

### POST /api/sessions/:id/fork — Fork a Session

Forks from a specified history entry. **Request body** (`ForkRequestSchema`): `{ "entryId": "..." }`

**Success response** 200: `{ "text"?: string, "cancelled"?: boolean }`
**Errors**: 400, 404, 409, 502 (upstream command failed)

---

### GET /api/sessions/:id/state — Query Session State

**Success response** 200 (`state` is `RpcSessionState`, see `session-state.ts:18`):

```json
{
  "state": {
    "sessionId": "550e8400-...",
    "thinkingLevel": "high",
    "isStreaming": false,
    "isCompacting": false,
    "steeringMode": "...",
    "followUpMode": "...",
    "autoCompactionEnabled": true,
    "messageCount": 12,
    "pendingMessageCount": 0,
    "model": { "...": "..." }
  },
  "protocolVersion": "0.1.0"
}
```

**Errors**: 404, 502 (upstream command failed)

---

### GET /api/sessions/:id/stats — Query Usage Statistics

> Note: stats data is pulled only via this endpoint; the SSE stream does not push usage frames.

**Success response** 200 (`stats` is `SessionStats`, see `session-state.ts:54`):

```json
{
  "stats": {
    "sessionId": "550e8400-...",
    "userMessages": 6,
    "assistantMessages": 6,
    "toolCalls": 5,
    "toolResults": 5,
    "totalMessages": 12,
    "tokens": { "input": 3200, "output": 800, "cacheRead": 0, "cacheWrite": 0, "total": 4000 },
    "cost": 0.0042
  },
  "protocolVersion": "0.1.0"
}
```

**Errors**: 404, 502 (upstream command failed)

```bash
curl http://localhost:3000/api/sessions/sess_abc/stats
```

---

### GET /api/sessions/:id/messages — Query Message History

**Success response** 200: `{ "messages": [...] }`
**Errors**: 404, 502

---

### GET /api/sessions/:id/commands — Query Available Commands

Returns the list of commands currently available to the session (a pure query, with no install/trust semantics).

**Success response** 200: `{ "commands": [...] }`
**Errors**: 404, 502

---

### GET /api/sessions/:id/models — Query Available Models

Returns the list of models available to the session's agent (`{ models: Model[] }`, with elements in pi's `Model` shape), filtered by the `PI_WEB_HIDE_PROVIDERS` environment variable (removes models of hidden providers; uses the same list as the settings page's `/config/models`).

**Success response** 200: `{ "models": [...] }`
**Errors**: 404, 502

---

### GET /api/sessions/:id/fork-messages — Query Forkable Entries

Returns the list of history entries that can serve as fork starting points.

**Success response** 200: `{ "messages": [{ "entryId": "...", "text": "..." }] }`
**Errors**: 404, 502

---

### GET /api/sessions/:id/completion — Trigger Completion

The query endpoint of the trigger-completion framework (e.g. `@file:` to reference a file). Paired with `GET /api/sessions/:id/completion/triggers`, which returns the registered triggers. See [02 · Core Concepts](02-core-concepts.md).

**Success response** 200: completion result JSON
**Errors**: 404

---

### GET /api/sessions/:id/agent-routes — Agent-Declared Route Listing

The HTTP routes an agent declares in `AgentDefinition.routes` (for the declaration-side contract, see [08 · Custom Agent Development Guide](08-agent-development.md)) are automatically mounted under the session namespace when the session is created. This endpoint returns the route listing declared by that session — a **pure-data projection** (`name` / `methods` / `description`); the handler functions live only in the agent subprocess and never cross the process boundary.

**Success response** 200 (an agent with no declarations returns an empty array — that's success, not an error):

```json
{
  "routes": [
    {
      "name": "gallery-stats",
      "methods": ["GET"],
      "description": "Canvas gallery statistics (asset counts / origin breakdown / generating flag)"
    }
  ],
  "protocolVersion": "0.1.0"
}
```

**Errors**: 404 (session not found), 401/403 (rejected by the existing `:id` auth seam). When operationally disabled (`PI_WEB_AGENT_ROUTES_DISABLED=1`, see the env table below), the endpoint returns a generic 404 `NOT_FOUND` without revealing its existence.

```bash
curl -s http://localhost:3000/api/sessions/sess_abc/agent-routes
```

---

### GET·POST /api/sessions/:id/agent-routes/:name — Invoke a Declared Route

Forwards one HTTP call into the session's agent subprocess, where the handler bound by the declaration processes it, and returns the result synchronously **within the same HTTP request-response cycle** — external systems (curl / webhooks / third-party services) can invoke agent capabilities without subscribing to any SSE stream. Under the hood this rides the existing stdin/stdout JSONL channel with a declaration frame plus a dedicated request/result frame pair; no new SSE frames are added.

**Invocation semantics**:

- The handler executes only inside the agent subprocess; an invocation **does not trigger LLM inference, does not enter the conversation history, and produces no UI change whatsoever**.
- Calls are accepted as usual while the session is busy (mid-inference), without interfering with the conversation.
- GET invocations ignore the request body (it is not read); an empty POST body is leniently allowed (`body` is passed to the handler as undefined), while a non-empty body that is not valid JSON → 400.
- **The success response body is the raw JSON returned by the handler** (object, array, or scalar; `undefined` is normalized to `null`), with **no** `protocolVersion` envelope; the protocol version is carried only via the `X-Pi-Protocol-Version` response header.

**Errors** (check order: gate → session/auth → name → method → size → JSON → forwarding):

| Status | code | Trigger |
|---|---|---|
| 404 | `NOT_FOUND` | operationally disabled via `PI_WEB_AGENT_ROUTES_DISABLED=1` (does not reveal endpoint existence) |
| 404 | `SESSION_NOT_FOUND` | session not found |
| 401 / 403 | `UNAUTHORIZED` / `FORBIDDEN` | rejected by the existing `:id` auth seam |
| 404 | `ROUTE_NOT_FOUND` | route name not declared by this session's agent definition |
| 405 | `METHOD_NOT_ALLOWED` | method not in the route's declared `methods` allowlist (defaults to `["GET"]`) |
| 413 | `PAYLOAD_TOO_LARGE` | POST body exceeds the limit (default 1 MiB; rejected early via the `Content-Length` header, with a fallback re-check against actual bytes after reading when the header is missing/untrusted) |
| 400 | `INVALID_BODY` | non-empty POST body is not valid JSON |
| 502 | `ROUTE_HANDLER_ERROR` | handler threw an error (the error message carries the handler-side message) |
| 504 | `ROUTE_TIMEOUT` | subprocess response timed out (default 20000 ms) |
| 409 | `SESSION_STOPPED` | session already stopped |

**Environment variables**:

| env | Default | Description |
|---|---|---|
| `PI_WEB_AGENT_ROUTES_DISABLED` | unset (feature enabled) | `=1` — server-authoritative kill switch; all agent-routes endpoints return a generic 404; read per request |
| `PI_WEB_AGENT_ROUTE_TIMEOUT_MS` | `20000` | response timeout (ms) for forwarding into the subprocess; timeout → 504 |
| `PI_WEB_AGENT_ROUTE_BODY_LIMIT` | `1048576` (1 MiB) | POST request-body limit in bytes; exceeded → 413 |

```bash
# Invoke (GET; query parameters are flattened to single values and passed to the handler)
curl -s "http://localhost:3000/api/sessions/sess_abc/agent-routes/gallery-stats?verbose=1"

# Invoke (POST; the route must declare "POST" in its methods)
curl -s -X POST http://localhost:3000/api/sessions/sess_abc/agent-routes/my-route \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
```

> For a runnable demo, see `examples/aigc-canvas-agent` (the "Agent Routes demo (`gallery-stats`)" section of its README: a read-only stats route invoked directly with curl, returning structured JSON). For the declaration-side contract (name format, default methods, handler constraints, assembly-time validation), see [08 · Custom Agent Development Guide](08-agent-development.md).
>
> **Implementation reference**: `packages/server/src/http/routes/agent-route-routes.ts`

---

### DELETE /api/sessions/:id — Delete a Session

Stops and removes the session. After the handler returns, the **host layer** (the DELETE branch of `app.all` in `server/index.ts:80-88`), when the response is `res.ok`, additionally calls `forgetSessionSource(id)` to clear the app-level `sessionId → source` mapping (best-effort, without rewriting the handler response; prevents unbounded growth of the mapping table). Deletion of sub-resources (extra path segments) does not trigger it.

**Success response** 200: `{ "ok": true }`
**Errors**: 404

```bash
curl -X DELETE http://localhost:3000/api/sessions/sess_abc
```

---

## Config API — `/api/config/**`

Read/write interface for configuration domains. There are five known domains: `auth`, `settings`, `sandbox`, `logging`, `aigc` (`packages/server/src/config/config-routes.ts:30`); `models` is a special endpoint. For the schema-driven settings UI, see [13 · Config UI](13-config-ui.md).

### GET /api/config/:domain — Read Configuration

**Path parameter**: `domain` = `auth` | `settings` | `sandbox` | `logging` | `aigc`

**Success response** 200:

```json
{
  "formSchema": { "...": "..." },
  "values": { "apiKey": "sk-***", "model": "claude-opus-4-5" },
  "protocolVersion": "0.1.0"
}
```

Secret fields in `values` return a masked value (`sk-***`); plaintext is not returned.

**Errors**: 404 `DOMAIN_NOT_FOUND` (unknown domain), 401 `UNAUTHORIZED` / 403 `FORBIDDEN` (admin auth seam rejected)

---

### PUT /api/config/:domain — Write Configuration

**Request body**:

```json
{ "values": { "apiKey": "sk-new-key", "model": "claude-opus-4-5" } }
```

A masked value (`sk-***`) is automatically merged back to the on-disk original value on write (it does not overwrite unchanged secrets).

**Success response** 200: `{ "ok": true }`
**Errors**: 400 `INVALID_JSON` (JSON parse failure) / `VALIDATION_FAILED` (DTO validation failure), 422 `SCHEMA_VALIDATION_FAILED` (domain schema validation failure, with `fields`), 404 `DOMAIN_NOT_FOUND`, 401/403

---

### GET /api/config/models — List Available Models (Config Side)

Provides data for the settings page's provider/model dropdown controls. Filtered by the `PI_WEB_HIDE_PROVIDERS` environment variable (a comma-separated list of provider names, case-sensitive).

**Success response** 200:

```json
{
  "providers": ["anthropic", "openai"],
  "models": [
    { "id": "claude-opus-4-5", "provider": "anthropic" },
    { "id": "gpt-4o", "provider": "openai" }
  ]
}
```

When the `listModelOptions` seam is not configured, returns `{ "providers": [], "models": [] }`, and the frontend falls back to free-text input.

> When `PI_WEB_HIDE_PROVIDERS=anthropic`, all of `anthropic`'s providers and models are removed from the result. This filter uses the same list as the chat area's `GET /sessions/:id/models`.

**Implementation reference**: `packages/server/src/config/config-routes.ts`, `packages/server/src/config/model-options-filter.ts`

---

## Model Enumeration API — Tool-Side Model Enumeration

Two **read-only** endpoints that feed the AIGC/vision tools' settings controls and the Canvas picker with model lists. They are independent of the text-conversation models (`/config/models` and `GET /sessions/:id/models`): image/vision models do not go through `models.json`/`ModelRegistry`, but through their own module-level route tables (see [11 · AIGC & Vision Tools](11-aigc-and-vision-tools.md)).

### GET /api/aigc/models — List the AIGC Image-Model Catalog

Used by the "model switches" custom widget on `/settings` for enumeration (that page has no session state, so it cannot get the `aigc.models` delivered at runtime by `aigcExtension`). The data source is the tool-kit main entry's pure `AIGC_MODEL_CATALOG` (zero pi SDK). The "disabled models" read/write goes through the standard config domain `/api/config/aigc` (persisted to `<agentDir>/aigc.json`), not here.

**Success response** 200:

```json
{
  "models": [
    { "model": "gemini-3.1-flash-image", "label": "Gemini 3.1 Flash Image", "provider": "openrouter" }
  ]
}
```

> **Implementation reference**: `packages/server/src/aigc-settings/aigc-models-routes.ts:14`

### GET /api/vision/models — List Available Vision Models

Read-only, returns the list of models "with configured credentials and image-input support," for the vision-model picker in the Canvas prompt bar. `value` is `provider/modelId`, which can be **passed verbatim** into the `image_vision` tool's `model` parameter (note this format must not be mixed with the bare ids of image-generation models).

**Success response** 200:

```json
{
  "models": [
    { "value": "anthropic/claude-opus-4-5", "label": "Claude Opus 4.5", "provider": "anthropic" }
  ]
}
```

**Degradation**: if fetching throws (e.g. `models.json` corrupt) → returns **200 + an empty list**, rather than leaking a 500 to the frontend; the frontend degrades to "pick the model from the tool's popover," and the readout feature still works.

```bash
curl http://localhost:3000/api/vision/models
```

> **Implementation reference**: `packages/server/src/vision-settings/vision-models-routes.ts:27`

---

## Attachments API — `/api/attachments/**`

### POST /api/sessions/:id/attachments — Upload an Attachment

> This endpoint is registered in the **sessions** namespace (`POST /sessions/:id/attachments`, not the attachments route), reusing the Router's `:id` session gating (session not found → 404, unauthorized → 401/403).

**Request**: `multipart/form-data`, file field name `file`

**Size limit**: 25 MiB by default (`DEFAULT_MAX_UPLOAD_BYTES`). When exceeded, the request is pre-rejected (413) via the `Content-Length` header before the body is read.

**Success response** 200:

```json
{
  "attachment": {
    "id": "att_xyz789",
    "name": "screenshot.png",
    "mimeType": "image/png",
    "size": 102400,
    "origin": "upload",
    "sessionId": "550e8400-..."
  },
  "displayUrl": "/api/attachments/att_xyz789/raw?exp=1750000000000&sig=abc...",
  "protocolVersion": "0.1.0"
}
```

`attachment` is in the `Attachment` shape (`id`/`name`/`mimeType`/`size`/`origin`/`sessionId`, see `packages/protocol/src/attachment/attachment-dto.ts`). `displayUrl` is an instantly signed delivery URL (`presignUrl`) with a limited validity period. The attachment id has the form `att_<base64url>`.

**Errors**: 400 `NO_FILE` (no file part or empty file), 413 `PAYLOAD_TOO_LARGE` (exceeds size limit), 404 (session not found), 401/403 (auth seam rejected)

```bash
curl -X POST http://localhost:3000/api/sessions/sess_abc/attachments \
  -F "file=@/path/to/image.png"
```

---

### GET /api/attachments/:id/raw?exp=&sig= — Download an Attachment

Self-contained signature authentication, **not bound to a session**; can be accessed directly in the browser (`<img src="...">`, etc.).

**Query parameters**:

| Parameter | Description |
|---|---|
| `exp` | expiry time (epoch ms) |
| `sig` | HMAC-SHA256 signature (hex), generated via `PI_WEB_ATTACHMENT_SECRET` |

**Security policy** (anti-enumeration): **verify the signature first**; a missing/invalid/expired signature always yields 401 (existence is not checked, so an attacker cannot tell from the response whether the id exists). Only when the signature is valid are the bytes read and streamed back.

**Success response** 200: byte stream
Response headers: `Content-Type: <attachment mime>`, `Cache-Control: private, max-age=300`

**Errors**: 401 `INVALID_SIGNATURE` (missing/invalid/expired signature), 404 `ATTACHMENT_NOT_FOUND` (attachment not found; this code can only be returned when the signature is valid)

**Implementation reference**: `packages/server/src/http/routes/attachment-routes.ts`

---

## Session Source Mapping (sessionId → source)

The app-level `sessionId → agent source` mapping is used on a cold load (directly accessing `/session/:id`) to restore the `.pi/web` UI extension configuration; the read happens in `GET /api/bootstrap?sessionId=` (see `resolveResumeSource`).

> **Note**: the standalone `POST /api/session-source` endpoint of the Next.js era was removed along with `app/` — **no** such route is registered on `main` (`recordSessionSource` exists only in tests). The current recovery path reads that mapping first and falls back to the persisted session metadata (`resume-meta`), so a new session can be recovered by id even without an explicit POST. Cleanup is done incidentally by `DELETE /api/sessions/:id` (`forgetSessionSource`, see above).
>
> **Implementation reference**: `lib/app/session-source-map.ts`, `server/bootstrap.ts:46`

---

## createPiWebHandler — Framework-Agnostic Integration

A framework-agnostic factory that returns a standard Web Fetch handler `(Request) => Promise<Response>`, mountable on any framework compatible with Web Fetch. The host on `main` mounts it with Hono (see `server/index.ts`):

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  createPiWebHandler,
  createConfigRoutes,
  createAttachmentRoutes,
} from "@blksails/pi-web-server";

const handler = createPiWebHandler({
  manager,          // SessionManager (from session-engine)
  store,            // SessionStore
  authResolver,     // optional, allows through by default
  authorizeSession, // optional, allows through by default
  routes: [         // optional, inject external routes (config / attachment / vision-models …)
    ...createConfigRoutes({ listModelOptions }),
    ...createAttachmentRoutes(attachmentStore),
  ],
  sse: {
    heartbeatMs: 15_000,  // heartbeat interval (milliseconds)
    basePath: "/api",     // route prefix (aligned with the browser side's /api/**)
  },
});

const app = new Hono();
// c.req.raw is a standard Request; the Response returned by the handler (including an SSE ReadableStream body) is passed through verbatim.
app.all("/api/*", (c) => handler(c.req.raw));
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });
```

> The production host also registers the webext resources and the `/api/bootstrap` endpoint **before** `app.all('/api/*')` (see [Architecture Overview](#architecture-overview)), and cleans up the source mapping after a successful DELETE. The above is the minimal runnable skeleton.

**Notes on the injection seams**:

- External routes in `opts.routes` are merged with the built-in routes, with the built-in routes taking priority (external routes cannot override/shadow a built-in endpoint that has an exact `method`+`path` conflict)
- `authResolver(req)` rejects → 401; `authorizeSession(ctx)` returns false → 403
- For graceful shutdown on `SIGTERM`, use `createPiWebHandlerBundle(opts)` instead; it additionally returns `shutdown: () => Promise<void>` (passing through to `manager.shutdown()`), and the handler behaves identically to `createPiWebHandler`

**Implementation reference**: `packages/server/src/http/create-handler.ts`

---

## Complete SSE Frame Reference

The SSE stream contains two top-level frame kinds, defined by `@blksails/pi-web-protocol`'s `SseFrameSchema`:

### kind: uiMessageChunk

Incremental content frame; the payload lives in the `chunk` field, and `chunk.type` is an AI SDK v5 standard chunk subtype (see `packages/protocol/src/transport/ui-message-chunk.ts`), primarily including:

| chunk.type | Description |
|---|---|
| `text-start` / `text-delta` / `text-end` | text stream (`text-delta` carries the delta in the `delta` field, paired with `id`) |
| `reasoning-start` / `reasoning-delta` / `reasoning-end` | reasoning-process stream |
| `tool-input-start` / `tool-input-delta` / `tool-input-available` | tool-call input |
| `tool-output-available` / `tool-output-error` | tool-call output |
| `start` / `finish` / `start-step` / `finish-step` / `error` / `abort` | message lifecycle markers |
| `data-${string}` (e.g. `data-pi-queue`) | custom structured data-part (see `data-part.ts`) |

> Note: `finish` is a `chunk.type` of **uiMessageChunk** (a message-stream end marker), not a control-frame type.

### kind: control

Control frame; the payload lives in the `payload` field and is discriminated by `payload.control`. `ControlPayloadSchema` is a **nine-way discriminated union** (`packages/protocol/src/transport/sse-frame.ts:21-54`):

| payload.control | Description | Actually sent? |
|---|---|---|
| `error` | error / session end (`message` + optional `code`) | Yes |
| `ui-rpc` | Tier3 UI↔agent RPC downstream response (paired by `correlationId`) | Yes |
| `session-status` | session-readiness handshake state (`SessionLifecycleState`: initializing/ready/error/ended), **sticky**, replayed on subscribe | Yes |
| `session-state` | authoritative session snapshot (six fields: lifecycle/busy/turn/stats/model/title), **sticky** | Yes (when snapshot authority is enabled) |
| `state` | state-injection bridge: authoritative KV change agent→UI downstream mirror (`key`/`value`/`rev`/`deleted`), **sticky** per key | Yes |
| `logs` | structured logs batch-pushed to the frontend panel (`entries`) | Yes |
| `queue` | queue status (`steering` / `followUp` arrays), **sticky** | Sent in message-queue scenarios |
| `extension-ui` | extension UI request (needs `POST /ui-response` to reply) | Sent in extension scenarios |
| `stats` | usage statistics | **never sent** (usage goes through REST or `session-state.snapshot.stats`) |

> When writing an SSE control parser (frontend/integrator), you must cover the discriminants above (an unknown `control` can fall through to a default branch and be safely ignored, staying backward compatible). For `session-status` (readiness handshake) see `packages/protocol/src/transport/session-status.ts`; for `session-state` (authoritative snapshot) see `session-state.ts`; for `state` (state bridge) see `packages/protocol/src/web-ext/state.ts:15`.

JSON structure of each frame:

```json
{
  "kind": "uiMessageChunk",
  "protocolVersion": "0.1.0",
  "chunk": { "type": "text-delta", "id": "t1", "delta": "Hello" }
}
```

---

## Complete Main-Path Example

The following steps demonstrate the complete flow from creating a session to receiving a response:

1. **Create a session**:

   ```bash
   SESSION=$(curl -s -X POST http://localhost:3000/api/sessions \
     -H "Content-Type: application/json" \
     -d '{"source": "/path/to/.pi"}' | jq -r .sessionId)
   echo "Session: $SESSION"
   ```

2. **Subscribe to the SSE stream** (run in the background; **must precede** the next step's `POST /messages`, or the turn's reply frames are lost because there is no buffering — see the "Race-condition note" under `/stream`):

   ```bash
   curl -N "http://localhost:3000/api/sessions/$SESSION/stream" &
   STREAM_PID=$!
   ```

3. **Send a message**:

   ```bash
   curl -X POST "http://localhost:3000/api/sessions/$SESSION/messages" \
     -H "Content-Type: application/json" \
     -d '{"message": "Hello, agent! What can you do?"}'
   ```

4. **Query usage** (after inference finishes):

   ```bash
   curl "http://localhost:3000/api/sessions/$SESSION/stats"
   ```

5. **Delete the session** (incidentally cleaning up the `sessionId → source` mapping):

   ```bash
   kill $STREAM_PID
   curl -X DELETE "http://localhost:3000/api/sessions/$SESSION"
   ```

> Common remedies when it doesn't work: the connection is closed immediately and you receive one `payload.control = "error"` frame → usually the source path does not exist or the agent failed to start; `/messages` returns 409 → the session has stopped and must be recreated; the SSE stream emits no frames at all → usually the stream connected later than `POST /messages` (see the "Race-condition note"), or the host was deployed to Edge/stateless Serverless (which does not support resident subprocesses + long-lived SSE connections). See more in [23 · Troubleshooting FAQ](23-troubleshooting-faq.md).

---

## Next Steps / Related

- [02 · Core Concepts](02-core-concepts.md) — session lifecycle and the SSE dual-connection model
- [03 · Architecture](03-architecture.md) — where the Hono host and `createPiWebHandler` sit in the system
- [04 · Surface Authoritative Surface Stack](04-surface-stack.md) — the author side of the state-injection bridge (`getSessionState`) and the `control:state` frame context
- [06 · Configuration](06-configuration.md) — environment variables such as `PI_WEB_HIDE_PROVIDERS`, `PI_WEB_ATTACHMENT_SECRET`, and the `NEXT_PUBLIC_*` gates
- [09 · Attachment System](09-attachment-system.md) — the full mechanism of attachment storage, signed URLs, and the tool-bridge
- [11 · AIGC & Vision Tools](11-aigc-and-vision-tools.md) — the tool semantics of `GET /aigc/models` and `GET /vision/models`
- [14 · Sessions List](14-sessions-list.md) — `GET /sessions` pagination/gating and the `/bootstrap` runtime features
- [18 · CLI](18-cli.md) — usage of bin/pi-web.mjs for standalone deployment
- [19 · Deployment & Operations](19-deployment.md) — the esbuild single-file `dist/server.mjs` artifact and production CSP
- [21 · Logging](21-logging.md) — server-side logging and SSE `control:logs` frame observability
- [23 · Troubleshooting FAQ](23-troubleshooting-faq.md) — common errors such as session startup failures, no SSE frames, 409/426
