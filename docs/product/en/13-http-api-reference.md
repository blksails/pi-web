# 13 · HTTP API Reference

pi-web exposes all session, configuration, and attachment operations as standard REST + SSE interfaces through four Next.js catch-all Route Handlers, driven under the hood by the framework-agnostic `createPiWebHandler` factory.

---

## Architecture Overview

```
Next.js Route Handler (app/api/*/route.ts)
         │
         ▼
  getHandler()  ← lib/app/pi-handler.ts singleton
         │
         ▼
  createPiWebHandler(opts)
  packages/server/src/http/create-handler.ts
         │
         ├── Router  (method + path dispatch)
         ├── Built-in endpoint handlers  (sessions / config / attachments)
         └── Injected endpoints  (config-routes / attachment-routes)
```

**The four catch-all routes**:

| Route file | Path prefix covered | Methods supported |
|---|---|---|
| `app/api/sessions/[[...path]]/route.ts` | `/api/sessions/**` | GET, POST, DELETE |
| `app/api/config/[[...path]]/route.ts` | `/api/config/**` | GET, PUT |
| `app/api/attachments/[[...path]]/route.ts` | `/api/attachments/**` | GET |
| `app/api/session-source/route.ts` | `/api/session-source` | POST |

All routes force `runtime = "nodejs"` (subprocess residency + long-lived SSE connections; Edge/Serverless are not supported).

**Endpoint quick reference** (grouped by purpose; see the corresponding sections for details):

| Purpose | Endpoint |
|---|---|
| Session lifecycle | `POST /sessions`, `DELETE /sessions/:id` |
| Sessions list | `GET /sessions` (lists historical sessions, paginated) |
| Event subscription | `GET /sessions/:id/stream` (SSE) |
| Send message / steer | `POST /sessions/:id/messages`, `/steer`, `/follow_up`, `/abort` |
| Session control | `POST /sessions/:id/model`, `/thinking`, `/fork`, `/ui-response`, `/ui-rpc` |
| Session queries | `GET /sessions/:id/state`, `/stats`, `/messages`, `/commands`, `/models`, `/fork-messages`, `/completion` |
| Configuration | `GET·PUT /config/:domain`, `GET /config/models` |
| Attachments | `POST /sessions/:id/attachments`, `GET /attachments/:id/raw` |
| Source mapping | `POST /session-source` |

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

> Source of the code literals: session-engine error codes are in `packages/server/src/session/session.errors.ts:7` (`SESSION_STOPPED` / `SESSION_NOT_FOUND` / `UNKNOWN_EXTENSION_UI` / `MISSING_INPUT`); HTTP-layer codes are in `packages/server/src/http/error-map.ts` and the individual route handlers.

Version incompatibility (the client declares an `X-Pi-Protocol-Version` whose major version does not match the server's `0`; if not declared, the request is allowed through):
→ 426 `PROTOCOL_VERSION_MISMATCH`

Auth seam (allows through by default):
→ `authResolver` rejects: 401 `UNAUTHORIZED`; `authorizeSession` returns false: 403 `FORBIDDEN`

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
curl -X POST http://localhost:3010/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"source": "/path/to/.pi", "cwd": "/workspace"}'
```

---

### GET /api/sessions — List Historical Sessions

Lists locally persisted historical sessions (only lightweight session-header metadata; the body is not read), used for browsing and resuming in the Sessions List panel. Mounted via the `routes:` injection seam (`createSessionListRoutes()`), coexisting with the built-in sessions endpoints. Sorted by `updatedAt ?? createdAt` descending, with keyset cursor pagination.

**Query parameters** (`ListSessionsRequestSchema`, see `packages/protocol/src/transport/rest-dto.ts:177`):

| Parameter | Type | Required | Description |
|---|---|---|---|
| `scope` | `"cwd"` \| `"all"` | No | defaults to `cwd` (the current directory); `all` (system/whole-machine) is subject to a global gate |
| `cwd` | string | No | the target directory for `scope=cwd` (fallback when `sessionId` is unavailable) |
| `sessionId` | string | No | when `scope=cwd`, prefer this session's persisted cwd as the target directory |
| `limit` | positive integer | No | per-page cap, defaults to 50, hard-clamped to 200 |
| `cursor` | string | No | opaque keyset cursor (`base64url(JSON.stringify({ ts, id }))`), to fetch the next page |
| `q` | string | No | Name search keyword (sidebar-launcher-rail): when non-empty, filters by session name/id substring (case-insensitive) before sort/pagination; absent/empty keeps existing behavior (backward compatible). Max length 100. Matches names only, not body content |

**Success response** 200 (`ListSessionsResponse`, see `rest-dto.ts:207`):

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
curl "http://localhost:3010/api/sessions?scope=cwd&limit=50"
```

> The system view (`scope=all`) is off by default and requires the deployer to set `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=true`. For the full mechanism of pagination, gating, the frontend's three states, and relocation, see [21 · Sessions List](./21-sessions-list.md).
>
> **Implementation reference**: `packages/server/src/session-list/session-list-routes.ts`

### GET /api/agent-sources — List Available Agent Sources

Read-only enumeration of "agent sources available in the current environment," for the new-session picker (`AgentSourcePicker`) to browse and pick — clicking an item creates a session with its `source` directly (equivalent to typing it). Data comes from **two merged channels**: a directory scan (first-level subdirectories under `PI_WEB_SOURCES_ROOT`, reusing source-probe semantics to classify custom/cli) ∪ a registry file (`PI_WEB_SOURCES_REGISTRY` JSON), deduplicated by `id` (registry overrides scan). Mounted via the `routes:` injection seam (`createAgentSourcesRoutes()`).

**Strictly read-only**: handling a request performs no writes, no git clone, and no resolve/spawn of a session subprocess. Returns an empty list (success) when no source is configured.

**Query parameters** (`ListAgentSourcesRequestSchema`, see `packages/protocol/src/transport/rest-dto.ts`):

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | positive int | No | Page size, default 100, hard-clamped to 500 |
| `cursor` | string | No | Opaque keyset cursor (`base64url(JSON.stringify({ id }))`), fetch next page |

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
      "avatar": "🤖"                        // optional avatar: image URL/data-URI → <img>; else short text/emoji; falls back to initial
    }
  ],
  "nextCursor": "eyJpZCI6...",  // absent means no more pages
  "protocolVersion": "0.1.0"
}
```

**Display metadata source**: scanned sources read `title` / `description` / `avatar` from their `package.json` `pi-web` field (same place as `pi-web.entry`); `name` still comes from top-level `package.json` name, `description` falls back to the top-level one. Registry entries may declare `title` / `description` / `avatar` directly. The frontend renders the source list as a widescreen card grid: each card has an avatar + `title ?? name` + mode badge + description + favorite star.

**Errors**:

| Status | code | Trigger |
|---|---|---|
| 400 | `INVALID_REQUEST` | `limit` / `cursor` invalid (response includes offending field) |
| 500 | `INTERNAL` | Unexpected assembly/serialization failure (missing/corrupt sources do not count — they degrade to an empty contribution) |

```bash
curl "http://localhost:3010/api/agent-sources?limit=100"
```

> Whether the frontend shows the source list is gated by the build-time `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1`; the backend sources are configured via `PI_WEB_SOURCES_ROOT` (`path.delimiter`-separated for multiple) and `PI_WEB_SOURCES_REGISTRY` (default `<agentDir>/sources.json`). See [05 · Configuration](05-configuration.md) for all three.
>
> **Implementation reference**: `packages/server/src/agent-source-list/`

### GET·PUT /api/agent-sources/favorites — agent source favorites (read/write)

Favorites are a **user preference** (sidebar-launcher-rail), independent of the read-only source enumeration `/agent-sources`; persisted at `<agentDir>/agent-source-favorites.json`, used by the sidebar launcher rail to render one-click launch anchors. Injected via `createFavoritesRoutes()`, mounted under the `/api/agent-sources/**` catch-all forwarder (GET+PUT). Favoriting/unfavoriting does **not** modify the enumeration sources (scan dir / registry).

- **GET** → `ListFavoritesResponse`: `{ "favorites": [ { "source": "...", "name": "..." } ] }`. Missing/corrupt file degrades to the remaining available items.
- **PUT** `{ favorites }` → `ListFavoritesResponse` (echoes the persisted result): **full replace** (idempotent), atomic tmp+rename write. Invalid body → `400 INVALID_REQUEST`.

```bash
curl -X PUT "http://localhost:3010/api/agent-sources/favorites" \
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

Establishes a long-lived connection to receive session events in real time (text deltas, tool calls, control frames, etc.).
The client must first create a session, then subscribe to this stream, and only then send `POST /messages` to trigger inference.

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

**Reconnection**: GET this endpoint again with a `Last-Event-ID` header; the server re-subscribes and continues pushing subsequent frames (the gateway does not buffer historical frames):

```bash
curl -N "http://localhost:3010/api/sessions/sess_abc/stream" \
  -H "Last-Event-ID: 42"
```

**Errors**: 404 (session not found), 409 `SESSION_ENDED` (session already ended; returns an explicit response rather than hanging on an empty stream)

> **Important**: session stats (usage statistics) are **not pushed over SSE**. Although the SSE control-frame schema defines a `stats` type, `pi-session` never actually sends a `payload.control = "stats"` frame (in practice only the `error` and `ui-rpc` control frames are emitted). Usage data must be actively pulled via the `GET /sessions/:id/stats` REST endpoint.

---

### POST /api/sessions/:id/messages — Send a Message

Sends a user message to the session, triggering agent inference. Inference results are pushed asynchronously via `/stream`.

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
curl -X POST http://localhost:3010/api/sessions/sess_abc/messages \
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
curl http://localhost:3010/api/sessions/sess_abc/stats
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

The query endpoint of the trigger-completion framework (e.g. `@file:` to reference a file). Paired with `GET /api/sessions/:id/completion/triggers`, which returns the registered triggers. See [02 · Core Concepts](./02-core-concepts.md).

**Success response** 200: completion result JSON
**Errors**: 404

---

### DELETE /api/sessions/:id — Delete a Session

Stops and removes the session. After the handler returns, the sessions catch-all route (`app/api/sessions/[[...path]]/route.ts:34`), when the response is `res.ok`, additionally clears the app-level `sessionId → source` mapping (best-effort, without rewriting the handler response; prevents unbounded growth of the mapping table).

**Success response** 200: `{ "ok": true }`
**Errors**: 404

```bash
curl -X DELETE http://localhost:3010/api/sessions/sess_abc
```

---

## Config API — `/api/config/**`

Read/write interface for configuration domains. Supports three known domains—`auth`, `settings`, `sandbox`—and `models` is a special endpoint.

### GET /api/config/:domain — Read Configuration

**Path parameter**: `domain` = `auth` | `settings` | `sandbox`

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

## Attachments API — `/api/attachments/**`

### POST /api/sessions/:id/attachments — Upload an Attachment

> This endpoint is served by the **sessions** catch-all route (not the attachments route), reusing the Router's `:id` session gating (session not found → 404, unauthorized → 401/403).

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
curl -X POST http://localhost:3010/api/sessions/sess_abc/attachments \
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

## Session Source API — `/api/session-source`

### POST /api/session-source — Record the Session Source Mapping

The client calls this after a session is created (upon receiving the `onSessionId` callback) to persist the `sessionId → agent source` mapping to the app layer. On a cold load (directly accessing `/session/:id`), the `.pi/web` UI extension configuration is restored from it.

**Request body**:

```json
{ "id": "sess_abc123", "source": "/path/to/agent" }
```

**Success response** 204: no content (best-effort; a failure to write the mapping does not affect the session itself, and 204 is still returned)

**Errors**: 400 (request body is not JSON, or `id`/`source` is not a string)

> Note: this route is a standalone Next.js handler (it does not go through `createPiWebHandler`), and its 400 response is plain text (e.g. `"id and source must be strings"`)—it does **not** use the uniform `{ error, protocolVersion }` JSON error structure.

**Implementation reference**: `app/api/session-source/route.ts:14`

---

## createPiWebHandler — Framework-Agnostic Integration

A framework-agnostic factory that returns a standard Web Fetch handler `(Request) => Promise<Response>`, mountable on any compatible framework.

```typescript
import {
  createPiWebHandler,
  createConfigRoutes,
  createAttachmentRoutes,
} from "@blksails/pi-web-server";

// Next.js Route Handler
const handler = createPiWebHandler({
  manager,          // SessionManager (from session-engine)
  store,            // SessionStore
  authResolver,     // optional, allows through by default
  authorizeSession, // optional, allows through by default
  routes: [         // optional, inject external routes (e.g. config-routes)
    ...createConfigRoutes({ listModelOptions }),
    ...createAttachmentRoutes(attachmentStore),
  ],
  sse: {
    heartbeatMs: 15_000,  // heartbeat interval (milliseconds)
    basePath: "/api",     // optional route prefix
  },
});

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
```

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

Control frame; the payload lives in the `payload` field and is discriminated by `payload.control` (see `transport/sse-frame.ts:17`):

| payload.control | Description | Actually sent? |
|---|---|---|
| `extension-ui` | extension UI request (needs `POST /ui-response` to reply) | Yes |
| `queue` | queue status (`steering` / `followUp` arrays) | schema-defined |
| `stats` | usage statistics | **never sent** (usage goes through REST, see above) |
| `error` | error / session end (`message` + optional `code`) | Yes |
| `ui-rpc` | Tier3 UI↔agent RPC downstream response (paired by `correlationId`) | Yes |

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
   SESSION=$(curl -s -X POST http://localhost:3010/api/sessions \
     -H "Content-Type: application/json" \
     -d '{"source": "/path/to/.pi"}' | jq -r .sessionId)
   echo "Session: $SESSION"
   ```

2. **Record the source mapping** (optional, for cold-load recovery):

   ```bash
   curl -X POST http://localhost:3010/api/session-source \
     -H "Content-Type: application/json" \
     -d "{\"id\": \"$SESSION\", \"source\": \"/path/to/.pi\"}"
   ```

3. **Subscribe to the SSE stream** (run in the background):

   ```bash
   curl -N "http://localhost:3010/api/sessions/$SESSION/stream" &
   STREAM_PID=$!
   ```

4. **Send a message**:

   ```bash
   curl -X POST "http://localhost:3010/api/sessions/$SESSION/messages" \
     -H "Content-Type: application/json" \
     -d '{"message": "Hello, agent! What can you do?"}'
   ```

5. **Query usage** (after inference finishes):

   ```bash
   curl "http://localhost:3010/api/sessions/$SESSION/stats"
   ```

6. **Delete the session**:

   ```bash
   kill $STREAM_PID
   curl -X DELETE "http://localhost:3010/api/sessions/$SESSION"
   ```

> Common remedies when it doesn't work: the connection is closed immediately and you receive one `payload.control = "error"` frame → usually the source path does not exist or the agent failed to start; `/messages` returns 409 → the session has stopped and must be recreated; the SSE stream emits no frames at all → confirm that `runtime = "nodejs"` is in effect (Edge/Serverless is not supported). See more in [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md).

---

## Next Steps / Related

- [02 · Core Concepts](./02-core-concepts.md) — session lifecycle and the SSE dual-connection model
- [03 · Architecture](./03-architecture.md) — where `createPiWebHandler` sits in the system
- [05 · Configuration](./05-configuration.md) — environment variables such as `PI_WEB_HIDE_PROVIDERS`, `PI_WEB_ATTACHMENT_SECRET`
- [08 · Attachment System](./08-attachment-system.md) — the full mechanism of attachment storage, signed URLs, and the tool-bridge
- [14 · CLI](./14-cli.md) — usage of bin/pi-web.mjs for standalone deployment
- [16 · Logging](./16-logging.md) — server-side logging and SSE-frame observability
- [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md) — common errors such as session startup failures, no SSE frames, 409/426
