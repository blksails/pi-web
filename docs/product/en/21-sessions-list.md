# 21 · Sessions List

The Sessions List lets users **browse historical sessions** inside the Web UI and **resume any session with one click** to continue the conversation—without manually remembering or typing a session id. Session history has always been persisted by the underlying layer (each session is bucketed by its working directory cwd, carrying header metadata such as id / cwd / created/modified time / optional name), yet it was never surfaced in the interface before. This feature embeds that history as a relocatable, read-only panel into the chat interface, without occupying or replacing the existing conversation area.

---

## 1. What It Solves / Capability Boundaries

**In scope**

- Two kinds of views: **current-directory sessions** (current cwd only) and **system sessions** (all directories on the machine), the latter being off by default and requiring the deployer to explicitly enable it.
- List items display **lightweight metadata** sufficient to tell sessions apart: name or identifier, time (created or last modified), and the owning working directory.
- **Resume** a historical session directly by clicking anywhere on a list row, replaying the historical context.
- **Pagination** (keyset cursor continuation) and **descending sort** for large session collections.
- The display position is config-controlled (sidebar by default) and can be relocated to other interface regions.

**Out of scope**

- Deleting / renaming / archiving / searching (full-text search) sessions (not in this round, left for later).
- Showing list items with message counts, first-message summaries, or other heavy fields that require reading the **session body**—this round only uses lightweight file-header metadata.
- Cross-machine / remote session aggregation (limited to sessions persisted on the local machine).
- A new-session entry point (already provided by the existing interface, not reworked within this feature).

By design: the server is responsible only for "read + sort + paginate + gate", the frontend only for "display + switch + trigger resume", and the resume itself reuses the existing `resumeId` cold-resume path—without altering the session runtime / streaming kernel, and without altering the persistent storage schema.

---

## 2. Two Kinds of Views

| View | `scope` | Range | Default state |
|---|---|---|---|
| Current directory | `cwd` | Persisted sessions under the current working directory | Always available |
| System (whole machine) | `all` | Sessions under all working directories on the machine | **Off by default**, requires `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` to enable |

Both views are sorted by `updatedAt ?? createdAt` in **descending order** (newest first), consistently across fs / sqlite / postgres backends. When a single session's header metadata is corrupted / unparseable, the store adapter **skips** that session and continues returning the rest, rather than failing the entire list request.

**Dual gating of the system view**:

- Server: when `scope=all` and the global switch is off, `GET /api/sessions` returns `403` directly and **does not touch storage** (no scanning of whole-machine session buckets, no manifest exposure).
- Frontend: when the global switch is off, the panel does not render the "All" Tab at all (keeping only the "Current directory" view).

To enable the system view, the deployer must set `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=true` (or `=1`) at build time—this value is read client-side and inlined at build time (`components/chat-app.tsx:172`).

> **How the current-directory view determines the target cwd**: the frontend cannot reliably infer the "real cwd after agent resolution", so a `scope=cwd` request carries the currently active `sessionId`, and the server uses that session's persisted cwd as the source of truth (`session-list-routes.ts:168-177`); only when `sessionId` is missing / unresolvable does it fall back to the `cwd` parameter or the server's default cwd.

---

## 3. Display Position and Relocation (slot)

The panel is injected via the host `PiChat`'s `slots`, **located in the sidebar (`sidebar`) by default**. It occupies its region additively, without replacing or obstructing the existing conversation area; if the same region holds content contributed by an extension (webext), it coexists with that content following the established host priority.

The display position is controlled by `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT`, whose value is limited to the subset of `PiChatSlots` that can host block-level panels:

| Value | Position |
|---|---|
| `sidebar` (default) | Sidebar |
| `header` | Top |
| `footer` | Bottom |
| `empty` | Empty-state slot region |

Invalid / absent values all fall back to `sidebar` (`components/chat-app.tsx:184-189`). The host accordingly places `<SessionListPanel>` into the corresponding slot (`sessionListSlots()`, `components/chat-app.tsx:192-204`).

> The wiring is concentrated in the host `chat-app.tsx`; the UI package does not read env—`SessionListPanel`'s data source and callbacks are all injected by the host, and the component itself holds no pi wiring.

---

## 4. Full-Row Click-to-Resume

List items are **clickable across the entire row** (no separate "Resume" button):

- Each item shows `name ?? sessionId` (primary title) + `time · cwd` (subtitle, where time is `updatedAt ?? createdAt`, `session-list-panel.tsx:52-56`).
- The click is raised to the host via `onResume(sessionId)` (`session-list-panel.tsx:208-211`).
- The host navigates to that session's route with `window.location.assign('/session/:id')` (`components/chat-app.tsx:363-368`).

Cold-resume path: the `/session/:id` route passes `resumeId` into `chat-app`, and `usePiSession` rebuilds the session from `resumeId`—this path also **traces back the agent source** (otherwise `create.source` falls back to `"."`, breaking the extension's region slots / background, etc.), after which `GET /sessions/:id/messages` replays the historical messages so the conversation picks up where it left off. A failed resume does not disrupt the currently ongoing session.

```
Click a list item
  → onResume(sessionId)                          [SessionListPanel]
  → window.location.assign('/session/:id')       [chat-app host]
  → resumeId enters chat-app → usePiSession rebuilds the session   [cold resume + trace back agent source]
  → GET /sessions/:id/messages replays history   [pick up the context]
```

---

## 5. HTTP Contract

The read-only list endpoint is mounted via the existing `routes:` injection seam (`createSessionListRoutes()`, isomorphic with `createConfigRoutes`), coexisting with the built-in `POST /sessions` and `GET /sessions/:id/*`.

```
GET /api/sessions?scope=&cwd=&sessionId=&limit=&cursor=
→ ListSessionsResponse
```

**Request parameters** (query, `packages/protocol/src/transport/rest-dto.ts:177`)

| Parameter | Value | Description |
|---|---|---|
| `scope` | `cwd` \| `all` | Defaults to `cwd`; `all` is subject to the global gate |
| `cwd` | string | Target directory for `scope=cwd` (fallback when `sessionId` is unavailable) |
| `sessionId` | string | When `scope=cwd`, the session's persisted cwd is preferred as the target directory |
| `limit` | positive integer | Per-page cap, defaults to 50, hard-clamped to 200 |
| `cursor` | string | Opaque keyset cursor, for fetching the next page |

**Response** (`rest-dto.ts:207`)

```jsonc
{
  "sessions": [
    { "sessionId": "...", "cwd": "...", "createdAt": "...", "updatedAt": "...", "name": "..." }
  ],
  "nextCursor": "...",     // absent means no more
  "scope": "cwd",          // echoes the effective scope
  "globalEnabled": true     // lets the frontend confirm system-view availability
}
```

**Pagination (keyset)**: the cursor is `base64url(JSON.stringify({ ts, id }))`, where `ts = updatedAt ?? createdAt` and `id = sessionId`, taken from the last item of the previous page; the server returns items that lie strictly after `{ts,id}` in the sorted sequence, guaranteeing that continuation **does not repeat** already-returned sessions and eventually converges (`session-list-routes.ts:60-89`, `181-187`). Pagination is done by in-memory slicing; the store only provides the lightweight header metadata of `list(cwd)` / `listAll()`.

**Errors**

| Status | code | Trigger |
|---|---|---|
| `400` | `INVALID_REQUEST` | `scope` / `limit` / `cursor` invalid (the response includes the offending field) |
| `403` | `SESSIONS_GLOBAL_DISABLED` | `scope=all` but the system view is not enabled (no session data returned) |
| `500` | `INTERNAL` | Storage read error (the frontend shows a retryable error) |

> Lazy store singleton: on the first request, `await createSessionEntryStore(storeConfig)` constructs and caches it, with configuration sharing the same source as cold resume (`sessionStoreConfigFromEnv()`), ensuring the list and resume read from the same backend (`session-list-routes.ts:115-120`).

---

## 6. Frontend State and Interaction

The three visible states of `SessionListPanel` (`packages/ui/src/elements/session-list-panel.tsx`):

- **Loading**: the first-screen load shows `loadingLabel` (default "Loading…").
- **Empty**: when there are no sessions in the current range, it shows `emptyLabel` (default "No sessions") rather than an error or blank.
- **Error**: when loading fails, it shows `errorLabel` + a clickable **Retry** button, rather than a silent blank.

The view-switch "Current directory / All" Tab appears only when `globalEnabled`; switching Tabs or a change in data source resets and reloads the first page. When `nextCursor` is present, a "Load more" button is shown to fetch and append. The component has a **race guard** (`reqIdRef`) that discards stale responses during rapid Tab switching / continuation (`session-list-panel.tsx:87`, `108`).

> List items, Tabs, the three states, and Load more all carry `data-pi-session-list-*` attributes, for e2e and host location.

---

## 7. Configuration and Environment Variables Summary

| Variable | Default | Effect | Read at |
|---|---|---|---|
| `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` | `false` | `true`/`1` enables the system (whole-machine) view: shows the "All" Tab + allows `scope=all` | `chat-app.tsx:172` (frontend) + `pi-handler` injects `globalEnabled` (server gating) |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` | `sidebar` | Panel display position (`sidebar`/`header`/`footer`/`empty`) | `chat-app.tsx:184` |

Both are `NEXT_PUBLIC_*`, read client-side and **inlined at build time**—changes require a rebuild to take effect. The session storage backend is determined by the existing `sessionStoreConfigFromEnv()`, sharing the same source as cold resume; this feature introduces no new storage configuration.

---

## 8. Troubleshooting / Notes

- **The "All" Tab does not appear / switching to the system view returns 403**: `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` is not enabled, or was enabled without a rebuild (the value is inlined at build time). The server 403 and the frontend hiding the Tab are the dual safeguards of the same gate, which is expected behavior.
- **The session directory listed by the current-directory view is not as expected**: `scope=cwd` uses the persisted cwd of the active `sessionId` as the source of truth; if there is currently no active session or that session is unresolvable, it falls back to the `cwd` parameter / the server's default cwd.
- **The panel position is wrong**: check whether the `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` value falls within `sidebar`/`header`/`footer`/`empty`; invalid values silently fall back to `sidebar`.
- **Slow first screen under a large history**: `scope=all` goes through `listAll`, a full bucket scan + in-memory slicing, with overhead growing linearly with the history size—keeping the global view off by default + pagination (`limit` defaults to 50, capped at 200) are the primary mitigations.
- **Extension UI (region slots / background) breaks after clicking resume**: resume must go through the `/session/:id` cold-resume path to trace back the agent source; re-mounting in any way other than via `resumeId` loses the source.

---

## Next Steps / Related

- Session lifecycle and the rest of the `/sessions/**` endpoints → [13 · HTTP/SSE API Reference](./13-http-api-reference.md)
- Host `slots` and interface layout → [10 · Web UI Extension](./10-web-ui-extension.md)
- Environment variables overview → [05 · Configuration Reference](./05-configuration.md)
