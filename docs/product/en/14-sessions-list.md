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
- **Item-level management** for each session item: **delete** (irreversible physical deletion), **rename** (persisted as the latest display name), **favorite / pin** (an independent preference, pinned in a top section)—see [§9 Session Item Operations](#9-session-item-operations-rename--favorite--delete). All three write operations can be turned off wholesale by the deployer via a gate.

**Out of scope**

- **Archiving** (archived state), **forking** (fork), **exporting** (download jsonl / markdown), and **searching / full-text search** of sessions (not in this round, left for later).
- **Batch selection / batch deletion**; **manual drag-to-reorder / grouping / tagging** of favorites.
- Showing list items with message counts, first-message summaries, or other heavy fields that require reading the **session body**—this round only uses lightweight file-header metadata.
- Cross-machine / remote session aggregation and management (limited to sessions persisted on the local machine).
- A new-session entry point (already provided by the existing interface, not reworked within this feature).

By design: in the read-only list path the server is responsible only for "read + sort + paginate + gate", and the frontend only for "display + switch + trigger resume", with the resume itself reusing the existing `resumeId` cold-resume path—without altering the session runtime / streaming kernel, and without altering the persistent storage schema. The item-level write operations (delete / rename / favorite, [§9](#9-session-item-operations-rename--favorite--delete)) layer an independent set of write seams on top, likewise without touching the runtime kernel or the cold-resume path: delete reuses the session store's existing physical deletion, rename reuses its append event model, and favorites land in an independent user-preference file.

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

To enable the system view, the deployer must set `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=true` (or `=1`) at build time—this value is read client-side and inlined at build time (`components/chat-app.tsx`).

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

Invalid / absent values all fall back to `sidebar` (`components/chat-app.tsx`). The host accordingly places `<SessionListPanel>` into the corresponding slot (`sessionListSlots()`, `components/chat-app.tsx`).

> The wiring is concentrated in the host `chat-app.tsx`; the UI package does not read env—`SessionListPanel`'s data source and callbacks are all injected by the host, and the component itself holds no pi wiring.

---

## 4. Full-Row Click-to-Resume

List items are **clickable across the entire row** (no separate "Resume" button):

- Each item shows `name ?? sessionId` (primary title) + `time · cwd` (subtitle, where time is `updatedAt ?? createdAt`, `session-list-panel.tsx`).
- The click is raised to the host via `onResume(sessionId)` (`session-list-panel.tsx`).
- The host navigates to that session's route with `window.location.assign('/session/:id')` (`components/chat-app.tsx`).

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

**Request parameters** (query, `packages/protocol/src/transport/rest-dto.ts:187`)

| Parameter | Value | Description |
|---|---|---|
| `scope` | `cwd` \| `all` | Defaults to `cwd`; `all` is subject to the global gate |
| `cwd` | string | Target directory for `scope=cwd` (fallback when `sessionId` is unavailable) |
| `sessionId` | string | When `scope=cwd`, the session's persisted cwd is preferred as the target directory |
| `limit` | positive integer | Per-page cap, defaults to 50, hard-clamped to 200 |
| `cursor` | string | Opaque keyset cursor, for fetching the next page |

**Response** (`rest-dto.ts:222`)

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

### 5.1 Session Action Endpoints (delete / rename / favorite)

The item-level write operations are mounted via **another set of injected routes** `createSessionActionsRoutes()` (injected side by side with `createSessionListRoutes` into the same `routes:` seam, `packages/server/src/session-actions/session-actions-routes.ts`), four endpoints in total, all under the `/sessions/**` segment:

| Method | Endpoint | Request body | Response | Gate | Errors |
|---|---|---|---|---|---|
| `POST` | `/api/sessions/delete` | `{ "sessionId": string }` | `{ "ok": true }` | Write gate | 400 / 403 / 500 |
| `POST` | `/api/sessions/rename` | `{ "sessionId": string, "name": string }` | `{ "sessionId": string, "name": string }` | Write gate | 400 / 403 / 404 / 500 |
| `GET` | `/api/sessions/favorites` | — | `{ "sessionIds": string[] }` | **Not gated** | 500 |
| `POST` | `/api/sessions/favorites` | `{ "sessionIds": string[] }` | `{ "sessionIds": string[] }` | Write gate | 400 / 403 / 500 |

**Why they are all `POST` and the path has no `:id`**: the Router applies an in-memory session-existence gate to any route containing `:id` (`router.ts:168`), so a historical (not-running) session would inevitably 404; therefore these endpoints have **no `:id` path parameter**, and `sessionId` travels in the request body/query, bypassing the gate to act on historical sessions. Write operations uniformly use `POST` (the existing `/sessions/**` forwarder only exports GET/POST/DELETE), and deliberately avoid the built-in `DELETE /sessions/:id` (which stops the in-memory session—entirely different semantics).

**Per-endpoint behavior** (all validate the request body with a zod schema, `packages/protocol/src/transport/rest-dto.ts:337-377`):

- **`POST /sessions/delete`** — `DeleteSessionRequestSchema` (`sessionId` non-empty). Hits `store.delete(sessionId)` for **physical deletion** (including the header and all event entries); a target that no longer exists (`SessionStoreNotFoundError`) is treated as **idempotent success** (`{ ok: true }`) rather than an error.
- **`POST /sessions/rename`** — `RenameSessionRequestSchema` (`sessionId` non-empty; `name` raw string `≤ 200`, non-empty after `trim`). First `store.readHeader(sessionId)` probes existence—**a nonexistent session returns `404 SESSION_NOT_FOUND`** (does not name a nonexistent session); if it exists, `store.append` writes a `session_info{ name, id: randomUUID(), parentId: null, timestamp }`, making it the **latest display name** (the server persists the `trim`med result and echoes that name in the response).
- **`GET /sessions/favorites`** — no request body, returns the set of favorited `sessionIds` (deduplicated, no empty strings); **not subject to the write gate**, so a read-only deployment can still read out favorites for pinned display (Req 4.9).
- **`POST /sessions/favorites`** — `SetSessionFavoritesRequestSchema` (`sessionIds` string array). **Fully replaces** the favorites set and persists it atomically, reading back the persisted result to return (deduplicated and fault-tolerated by the store), so the frontend can confirm the latest set.

**Favorites are an independent user-preference store**: the favorites set lands in `<agentDir>/session-favorites.json` (shape `{ "sessionIds": string[] }`, `SessionFavoritesStore`, `packages/server/src/session-actions/session-favorites-store.ts`), **completely independent** from the read-only session enumeration—it records the preference of "which `sessionId`s the user pinned" and is not part of session-event persistence. A missing file / bad JSON falls back to an empty set with fault tolerance (`list()` does not fail the request); `set()` uses an atomic write (write `<file>.<pid>.<counter>.tmp` then `rename`) to avoid a half-written file being read. It is **semantically different, file-independent, and not shared** with the agent-source favorites used by the Launcher Rail (`agent-source-favorites.json` / `listFavorites` / `setFavorites`).

**Error codes**

| Status | code | Trigger |
|---|---|---|
| `400` | `INVALID_REQUEST` | Request body does not match the schema (missing `sessionId`, empty/over-length `name`, `sessionIds` not an array, etc.) |
| `403` | `SESSIONS_MANAGE_DISABLED` | The write gate is off when delete / rename / favorite-write is hit (no storage is modified) |
| `404` | `SESSION_NOT_FOUND` | The rename target session does not exist in storage |
| `500` | `INTERNAL` | Storage read/write error (the frontend shows a visible error and rolls back the optimistic update) |

> Corresponding `PiClient` methods (`packages/react/src/client/pi-client.ts`): `deleteSessionHistory(sessionId)` → `CommandAck`, `renameSession(sessionId, name)` → `RenameSessionResponse`, `listSessionFavorites()` / `setSessionFavorites({ sessionIds })` → `ListSessionFavoritesResponse`. The naming is deliberately distinguished from the existing `deleteSession` (stop the in-memory session) / `listFavorites` (agent-source favorites) to avoid confusion.

---

## 6. Frontend State and Interaction

The three visible states of `SessionListPanel` (`packages/ui/src/elements/session-list-panel.tsx`):

- **Loading**: the first-screen load shows `loadingLabel` (default "Loading…").
- **Empty**: when there are no sessions in the current range, it shows `emptyLabel` (default "No sessions") rather than an error or blank.
- **Error**: when loading fails, it shows `errorLabel` + a clickable **Retry** button, rather than a silent blank.

The view-switch "Current directory / All" Tab appears only when `globalEnabled`; switching Tabs or a change in data source resets and reloads the first page. When `nextCursor` is present, a "Load more" button is shown to fetch and append. The component has a **race guard** (`reqIdRef`) that discards stale responses during rapid Tab switching / continuation (`session-list-panel.tsx`, `108`).

> List items, Tabs, the three states, and Load more all carry `data-pi-session-list-*` attributes, for e2e and host location.

---

## 7. Configuration and Environment Variables Summary

| Variable | Default | Effect | Read at |
|---|---|---|---|
| `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` | `false` | `true`/`1` enables the system (whole-machine) view: shows the "All" Tab + allows `scope=all` | `chat-app.tsx` (frontend) + `pi-handler` injects `globalEnabled` (server gating) |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` | `sidebar` | Panel display position (`sidebar`/`header`/`footer`/`empty`) | `chat-app.tsx` |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE` | Enabled | **Write gate**: set to `false` / `0` to turn off item-level delete / rename / favorite (frontend hides write entries + server write endpoints return `403`); any other value (including unset) defaults to enabled. Reading favorites (`GET /sessions/favorites`) is not subject to this gate | `chat-app.tsx` (frontend `manageEnabled`) + `pi-handler.ts` (injects `createSessionActionsRoutes({ manageEnabled })`) |

All three are `NEXT_PUBLIC_*`, read client-side and **inlined at build time**—changes require a rebuild to take effect. The session storage backend is determined by the existing `sessionStoreConfigFromEnv()`, sharing the same source as cold resume; session favorites land separately in the independent file `<agentDir>/session-favorites.json` (without altering the session store schema, see [§5.1](#51-session-action-endpoints-delete--rename--favorite)); this feature introduces no new storage-backend configuration.

---

## 8. Troubleshooting / Notes

- **The "All" Tab does not appear / switching to the system view returns 403**: `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` is not enabled, or was enabled without a rebuild (the value is inlined at build time). The server 403 and the frontend hiding the Tab are the dual safeguards of the same gate, which is expected behavior.
- **The session directory listed by the current-directory view is not as expected**: `scope=cwd` uses the persisted cwd of the active `sessionId` as the source of truth; if there is currently no active session or that session is unresolvable, it falls back to the `cwd` parameter / the server's default cwd.
- **The panel position is wrong**: check whether the `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` value falls within `sidebar`/`header`/`footer`/`empty`; invalid values silently fall back to `sidebar`.
- **Slow first screen under a large history**: `scope=all` goes through `listAll`, a full bucket scan + in-memory slicing, with overhead growing linearly with the history size—keeping the global view off by default + pagination (`limit` defaults to 50, capped at 200) are the primary mitigations.
- **Extension UI (region slots / background) breaks after clicking resume**: resume must go through the `/session/:id` cold-resume path to trace back the agent source; re-mounting in any way other than via `resumeId` loses the source.
- **The ⋯ action menu does not appear / the delete·rename·favorite write entries are gone**: `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE` was explicitly set to `false` / `0` (write gate off), or was changed without a rebuild (the value is inlined at build time). In this case the server also returns `403 SESSIONS_MANAGE_DISABLED` for write requests, which is expected behavior for a read-only deployment; note that the "Favorites" section still pins already-read favorites (reading favorites is not gated).
- **Deleting the session currently being viewed**: after a successful delete, the host navigates to the new-session empty state with `window.location.assign("/")`; other ongoing sessions are unaffected.
- **Rename returns 404**: the target session no longer exists in storage (e.g. concurrently deleted); rename does not create a record for a nonexistent session. Delete is the opposite—deleting a session that is already gone is treated as idempotent success.

---

## 9. Session Item Operations: Rename / Favorite / Delete

Beyond full-row click-to-resume ([§4](#4-full-row-click-to-resume)), **each session item** in the sessions list also carries a right-side `⋯` action menu offering three historical-session management capabilities—**rename**, **favorite / pin**, and **delete**—letting users organize session history without leaving the chat interface. The menu and item-level interactions are handled by `SessionItemMenu` (`packages/ui/src/elements/session-item-menu.tsx`), mounted into both of `SessionListPanel`'s render paths (the regular list and the Launcher Rail `LauncherRail`).

### 9.1 Action-Menu Entry and "No Accidental Resume"

- Each session item renders an action-menu trigger entry on the right (`⋯` button), which **appears on hover / keyboard focus** and can be hidden otherwise to keep the list tidy.
- The trigger entry `stopPropagation`s, so activating the menu **does not** trigger the full row's `onResume` (resume)—menu interaction and full-row resume never accidentally trigger each other.
- Once the menu is open, clicking outside the menu or pressing Esc closes it with no side effect.
- Write entries render only when **the write gate is enabled and the corresponding callback is present**; when the gate is off, the entire group of write entries is hidden (see [§9.5](#95-deployment-gate)).
- The menu, each menu item, the inline edit input, the delete confirmation, etc. all carry stable `data-*` location attributes (`data-pi-session-item-menu` / `-menu-rename` / `-menu-delete` / `-menu-favorite` / `-rename-input` / `-delete-confirm`), for e2e and host location.

### 9.2 Rename (inline edit → latest display name)

- Selecting "Rename" from the menu enters the item's **inline edit state**, initialized with the current display name.
- Submitting a name that is non-empty after `trim` → raised to the host via `onRenameSession(id, name)` → `POST /sessions/rename` → the server `append`s a `session_info` to that session, making it the **latest display name**. After the frontend optimistically renames, the host bumps a refresh to pull the authoritative state, so the name is **consistent across refreshes and across views**.
- A submission that is empty after `trim` sends no write request and simply exits the edit keeping the original name; Esc / cancel likewise abandons the edit without sending a request.
- A write failure (`500`, etc.) shows a visible error and rolls back to the original name.
- The **read / derivation rule** for the display name follows the existing sessions-list rule (header name at creation → latest `session_info.name`, sharing the same rule as auto-session-title, see [§4](#4-full-row-click-to-resume) and the auto-title feature); this feature only adds a "write new name" entry and does not change the read rule.

### 9.3 Favorite / Pin (independent preference store)

- Selecting "Favorite / Unfavorite" from the menu → raised to the host via `onToggleFavorite(id, favorite)`, and the host **reads → computes → writes**: first `listSessionFavorites()`, adds/removes that `sessionId` according to the target state, then `setSessionFavorites({ sessionIds })` to fully replace and persist it, reading back the result to update the interface.
- Favorites are persisted **keyed by `sessionId`** in the independent file `<agentDir>/session-favorites.json` (see [§5.1](#51-session-action-endpoints-delete--rename--favorite)), **unrelated** to the read-only session enumeration and to agent-source favorites. Therefore the same session has a consistent favorite state across the "Current directory" and "All" views.
- The panel intersects `favoriteSessionIds ∩ sessions in the current view`, pinning the hit items in a separate "**Favorites**" section at the top of the list and excluding them from the regular list to avoid duplicate rendering; when the intersection is empty, the section is **not rendered** (no empty placeholder). A stale favorite `sessionId` pointing at a deleted session is naturally skipped because it is not in the current session set, without erroring or rendering an empty row.
- Favorited items **consistently** show the name, resume entry, and `⋯` menu (also allowing rename / delete / unfavorite) in both the Favorites section and the regular list.
- **Reading favorites is not subject to the write gate**: under a read-only deployment, already-persisted favorites are still fetched for pinned display, and only writes (favorite / unfavorite) are rejected by the gate.

### 9.4 Delete (confirmation + irreversible physical deletion)

- Selecting "Delete" from the menu → first pops a **confirmation** (`dialog`); no deletion is initiated before confirmation, and canceling leaves the list unchanged.
- After confirmation, via `onDeleteSession(id)` → `POST /sessions/delete` → the server `store.delete()` **physically deletes** that session's header and all event entries. Deletion is **irreversible**—afterward the session no longer appears in any view and can no longer be resumed.
- After a successful delete the item is immediately removed from the list (optimistic removal + host bump refresh to pull the authoritative state), with **no need for a full-page manual refresh**.
- When the deleted session is the **one currently being viewed**, after a successful delete the host navigates to the new-session empty state with `window.location.assign("/")`; other ongoing sessions are unaffected.
- A target session that no longer exists is treated as **idempotent success** (still removed from the list); a delete that fails due to a storage error shows a visible error and keeps the item (no silent loss, no false success).

### 9.5 Deployment Gate

The three **write** operations (delete / rename / favorite) are gated wholesale by `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE`, **enabled by default**, and can be turned off wholesale for read-only / restricted deployments. The gate is a dual safeguard:

- Frontend: gate off → the panel **does not render** any write entry (`⋯` write menu items are hidden).
- Server: gate off → the delete / rename / favorite-write endpoints all return `403 SESSIONS_MANAGE_DISABLED` and **modify no storage**; `GET /sessions/favorites` is the exception, always readable.

The value is read by `chat-app.tsx` and inlined at build time (`manageEnabled = value !== "false" && value !== "0"`), and the server `pi-handler.ts` injects `createSessionActionsRoutes({ manageEnabled })` with the same determination—frontend and server read the same env with consistent semantics.

### 9.6 Consistency and Concurrency

- On any successful write operation → the panel updates optimistically (delete removes / rename renames / favorite moves the section) + the host bumps `refreshSignal` to pull the authoritative state so the display matches the latest persistence, with no full-page refresh needed by the user (reusing the same refresh channel as new sessions and auto_title).
- While an item has a write request in flight, perceptible in-progress feedback is provided (e.g. disabling repeated triggering) to avoid firing conflicting requests on the same item.
- The panel's existing `reqIdRef` **race guard** is retained: when the list refreshes for another reason, a stale response does not overwrite a newer state.
- While transient interactions such as an open menu / inline edit / confirmation are in progress, existing states like "current-session highlight" and "the view's Tab" are not interrupted.

---

## Next Steps / Related

- Session action endpoints (delete / rename / favorite) and the rest of the `/sessions/**` endpoints → [24 · HTTP/SSE API Reference](./24-http-api-reference.md), this chapter's [§5.1](#51-session-action-endpoints-delete--rename--favorite)
- Host `slots` and interface layout → [12 · Web UI Extension](./12-web-ui-extension.md)
- The session-management write gate `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE` and environment-variables overview → [06 · Configuration Reference](./06-configuration.md), this chapter's [§9.5](#95-deployment-gate)
