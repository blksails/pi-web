# 23 · Troubleshooting / FAQ

This chapter collects the known high-frequency issues encountered during pi-web development, builds, distribution, and operations, each laid out in a three-part "Symptom → Cause → Remedy" form. When you need a quick answer, jump straight to the [8. Diagnostic Quick Reference](#8-diagnostic-quick-reference) at the end and locate the issue by keyword.

> Architecture premise: the frontend is a **Vite-driven SPA** (root `index.html` static entry + `src/main.tsx`, output `dist/client`), the server host is **Hono** (`server/index.ts` with a single `app.all('/api/*')` forwarding to the `createPiWebHandler` singleton), and the server is **bundled by esbuild into a single file** `dist/server.mjs`. Next.js has been deleted from the codebase — if you see `next dev` / `next build` / `.next` / `NEXT_DIST_DIR` / webpack 500 in other documents, those are historical residue; this chapter gives the real failure model for the current architecture.

---

## 1. Dev Server Issues

### 1.1 After `pnpm dev`, opening 3000 in the browser shows a bare API / no chat UI

**Symptom**: You run `pnpm dev`, open `http://localhost:3000` out of habit, and see JSON or a 404 instead of the chat interface.

**Cause**: `pnpm dev` = `node scripts/dev-all.mjs` (`package.json:17`), which **spawns two processes concurrently**: the Hono API server listening on `:3000`, and the Vite dev server listening on `:5173` (`scripts/dev-all.mjs:2`). During development the SPA frontend is served by **Vite (5173)**; `3000` is merely the proxied API host and does not emit HTML itself.

**Remedy**:
1. During development, **open `http://localhost:5173`** in the browser. Vite reverse-proxies `/api` requests to `127.0.0.1:3000` (`vite.config.ts:76-78`), so frontend and backend cooperate under the same origin.
2. Ports are overridable: `PI_WEB_DEV_CLIENT_PORT` (frontend, default 5173) and `PI_WEB_DEV_API_PORT` (API, default 3000), see `vite.config.ts:73,78`.
3. To run only one side: `pnpm dev:client` (Vite only) or `pnpm dev:server` (API only).
4. Offline smoke tests work the same way — still open 5173 in the browser:
   ```bash
   PI_WEB_STUB_AGENT=1 pnpm dev   # stub agent, no real model needed
   # open http://localhost:5173
   ```

> Production mode has no such split: `node dist/server.mjs` is a single process, and Hono serves the frontend static assets and `/api` on the same port.

---

### 1.2 Changing an injected route or config domain has no effect after hot reload

**Symptom**: You modified an injected route wired up in `lib/app/pi-handler.ts`, or some config-domain-related code, and after saving the process reports no error but the new behavior does not appear (404 or unchanged behavior).

**Cause**: The `createPiWebHandler` instance is **pinned to `globalThis` after its first assembly** (`lib/app/pi-handler.ts:232`, `GLOBAL_KEY = Symbol.for("pi-web.app.handler")`, read/write at `:540-543`). Within the API server process the singleton is constructed only once; changing a module does not rebuild it.

**Remedy**:
1. Manually restart the API process: `Ctrl-C` to end `pnpm dev`, then `pnpm dev` again (dev-all tears down and re-spawns both processes together).
2. To restart the backend only, re-run `pnpm dev:server` on its own; the Vite frontend does not need to be touched.
3. After restarting, if your change involves session assembly, prefer **creating a new session** for testing rather than reusing an old session URL.

---

### 1.3 A session throws `node:fs` / pi-SDK-related resolution errors

**Symptom**: A route or tool call fails, and the stack contains `node:fs` / `node:os` / an unresolvable dynamic `require`, or `@earendil-works/pi-coding-agent` gets unexpectedly bundled into the frontend bundle.

**Cause**: The two pi SDK packages (`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`) contain `node:*` built-ins and dynamic `require`, and can only run in the Node runtime — they cannot be bundled into the frontend. The current architecture isolates them with two mechanisms:
- The frontend Vite build **does not bundle** the pi SDK — it runs only inside the Hono/Node-side API server, and during dev it is naturally separated into the `:3000` process.
- The production server is bundled into a single file by `scripts/build-server.mjs` via esbuild, whose `external` list explicitly externalizes the **two pi SDK packages + `jiti` + `pg`** (`scripts/build-server.mjs`), so they are not inlined into `dist/server.mjs`.

**Remedy**:
1. Any code in the main process (handler / server) that uses the pi SDK must go through **`@blksails/pi-web-tool-kit/runtime`** or an explicit subpath import — never through a barrel that would drag in the frontend.
2. If you add a server dependency that contains `node:*` or a native module, add it to the esbuild `external` list in `scripts/build-server.mjs`; otherwise the single-file build will try to inline it and fail.
3. Confirm you are not `import`ing any `@blksails/pi-web-server` or pi SDK value exports from the frontend `src/` (type-only imports excepted).

---

### 1.4 A reply requires a manual refresh to appear (reply not real-time)

**Symptom**: You send a message and the assistant bubble never appears, the streaming text never scrolls; after manually refreshing the page, that turn's reply shows up in full. The behavior is **intermittent**, mostly reproducing on the first dev access or when the machine is under high load.

**Cause**: pi-web's reply stream is **one `/stream` SSE subscription per turn**, not a session-level persistent connection. The client first calls `openChunkStream()` to open `GET /sessions/:id/stream`, then `POST /sessions/:id/messages` to submit this turn's prompt, and reply frames come back over that stream. The race is: if `/stream` has not yet established a subscription on the server, the agent may already have broadcast its first frame, and the server **neither buffers nor replays** reply frames `uiMessageChunk` (late subscribers only get the log ring-buffer and the two sticky frame types `session-status` / `session-state`) — frames within that window are lost permanently. A refresh recovers because it goes through the history endpoint `GET /sessions/:id/messages` (reconstructing from persisted messages).

**Trigger conditions**: dev cold compilation or high load amplifies this race — just-in-time compilation on first access to a route slows `/stream` connection setup, landing it after the agent's first frame. In warm production, `/stream` usually connects before the first frame, so it rarely reproduces.

**Remedy**:
1. **Already fixed on the framework side**: `sendMessages` now `await`s `connection.whenSubscribed()` before `POST /messages` — receiving the `GET /stream` response proves the subscription is established server-side (the SSE response's `ReadableStream.start()` runs `subscribe()` synchronously before the handler returns), eliminating the race at its root. The items below are fallbacks.
2. **Warm up `/stream`**: under dev, visit a session page once to compile the route, or trigger compilation ahead of time with `curl -N http://localhost:3000/api/sessions/<id>/stream` (note this hits the API host on 3000), then send your message.
3. **Temporary recovery**: for a turn that already dropped frames, refresh the page to recover them from the history endpoint.

---

### 1.5 A session is stuck on "connecting to agent…"

**Symptom**: After creating or opening a session, the input box is disabled and the UI stays on "connecting to agent…" without entering the ready state, no matter how long you wait.

**Cause**: The session-readiness handshake (spec `session-readiness-handshake`) uses the first response of the read-only probe `channel.getCommands()` as the readiness anchor; the server broadcasts a sticky `control:session-status` frame (`SessionLifecycleState`: initializing/ready/error/ended), and the frontend gates the input accordingly (`packages/ui/src/chat/pi-chat.tsx:704-707`, copy in `packages/ui/src/i18n/messages.ts:71`). If the **dev frontend and backend code are out of sync** (e.g. you restarted only Vite but not the API, or vice versa), the handshake protocol mismatches, the readiness frame never arrives, and the session deadlocks in the connecting state.

**Remedy**:
1. **Fully restart dev**: `Ctrl-C` to end `pnpm dev` and re-run it, so both the API (3000) and Vite (5173) come up on the same version of the code.
2. If you only changed the backend, restart it with `pnpm dev:server`; if you only changed the frontend, Vite HMR usually applies automatically and the backend need not be touched.
3. After reproducing, use `curl -N http://localhost:3000/api/sessions/<id>/stream` to observe whether the `control: session-status` frame arrives, to determine whether the sticking point is the server handshake or frontend rendering.

---

## 2. Build and Production Issues

### 2.1 Blank page in production / code webext silently fails to load (CSP block)

**Symptom**: In production mode under `node dist/server.mjs` the page is blank, or chat works but a code webext (an extension loaded via same-origin dynamic import) does not mount; the browser console reports a Content-Security-Policy violation involving `eval` or an inline `<script>`.

**Cause**: The production CSP is generated by `productionCsp()` and injected via Hono middleware only when `NODE_ENV=production` (`server/index.ts:51`), tightening two things relative to dev (`server/static.ts:171-184`):
- **`unsafe-eval` is forbidden** — `eval` / `new Function` are blocked. Runtime code-construction patterns (such as some extensions' dynamic compilation) are unavailable in production.
- **`script-src 'unsafe-inline'` is removed** — replaced by a precise sha256-hash allowance for the **inline singleton import map** (`server/static.ts:124-146`). If the import map's text in the artifact does not match the computed hash (e.g. it was rewritten by middleware, or a proxy injected an extra inline script), the browser refuses to execute the import map, causing all code webexts to fail to load.

**Remedy**:
1. A code webext should load via **same-origin native dynamic import** (no `eval` required); do not construct logic with `new Function` / `eval` inside an extension, or the production CSP will block it.
2. Do not insert a proxy/middleware between server and browser that rewrites HTML or injects inline scripts — any change to the inline import map's text breaks its sha256 match.
3. If the build artifact is **missing the inline script**, `productionCsp()` **warns loudly** rather than degrading silently (`server/static.ts:154-159`): watch for warnings like "production CSP will forbid the import map" in the server startup logs — it means the allowance hash was not generated and the page will fail to load code.
4. When investigating, first confirm the feature works under dev (no production CSP), then switch to production to reproduce, which pinpoints whether CSP is the cause. See the production-CSP section of [19-deployment.md](19-deployment.md).

---

### 2.2 CLI reports "self-contained artifact not found"

**Symptom**: After a local `git clone`, running `node bin/pi-web.mjs` or `pi-web` directly reports:

```
[pi-web] self-contained artifact not found <...>/dist/server.mjs
  Build first: `pnpm build:dist` (or `npm run build:dist`).
```

**Cause**: The CLI locates the backend entry via a three-tier `resolveRuntime()` (`bin/pi-web.mjs:263`): ① `PI_WEB_DIST_DIR` override (isolated/e2e, no unpack) → ② in-repo `dist/server.mjs` (dev, no unpack) → ③ first-launch unpack of the packaged compressed payload. A source clone takes ②, but `dist/` has not been built yet, hence the error (`bin/pi-web.mjs:303-304`).

**Remedy**:
```bash
pnpm build:dist   # = build:client(vite) + build:server(esbuild) + pack-dist + build:unpacker + build:payload
node bin/pi-web.mjs <source>
```
Once the build finishes, `dist/server.mjs` (which must live at the artifact root) is in place and the CLI can launch. To use an isolated directory, set `PI_WEB_DIST_DIR=<other-dir>` to override (that directory must also contain `server.mjs`). See [18-cli.md](18-cli.md) for full CLI details.

---

### 2.3 First-launch shared-runtime unpack fails under an npm install

**Symptom**: After `npm i -g @blksails/pi-web`, the first run reports something like `[pi-web] failed to prepare runtime (<code>): ...`, followed by a human-readable remediation hint.

**Cause**: An npm install takes tier ③ of `resolveRuntime()` — it unpacks the packaged compressed payload (`payload/dist.tar.zst`) on first launch into the shared-runtime directory `~/.pi/web/runtime/<version>-<digest>/` (overridable via `PI_WEB_RUNTIME_ROOT`), with a concurrency lock / heartbeat, and `scheduleRuntimeGc` retains the most recent N old runtimes (`bin/pi-web.mjs:284,451`). On failure it throws a **discriminant error code**, and `RUNTIME_ERROR_HINTS` (`bin/pi-web.mjs:392-401`) translates it into user-readable copy.

**Error code → meaning → remedy**:

| code | meaning | remedy |
|---|---|---|
| `runtime-root-unwritable` | runtime directory not writable | check path permissions, or set `PI_WEB_RUNTIME_ROOT` to a writable directory |
| `disk-full` | insufficient disk space | free up disk and retry |
| `payload-missing` | packaged payload missing | reinstall `@blksails/pi-web` |
| `payload-corrupt` | packaged payload corrupted | reinstall `@blksails/pi-web` |
| `zstd-unsupported` | Node version too old to decompress zstd | upgrade to **Node >= 22.15.0** |
| `lock-timeout` | timed out waiting for another process to unpack | confirm no other instance is stuck, clear locks under `~/.pi/web/runtime`, and retry |
| `extract-failed` | unpacker produced no valid output (fallback) | reinstall; if it still fails, attach the full error and file a report |

**Self-help quick reference**:
```bash
# 1) confirm Node version (zstd requires >= 22.15.0)
node -v
# 2) retry with a different writable runtime root
PI_WEB_RUNTIME_ROOT="$HOME/.pi-web-runtime" pi-web <source>
# 3) clear a possibly stale unpack directory and retry
rm -rf ~/.pi/web/runtime && pi-web <source>
```

---

## 3. Desktop (Tauri) First-Launch Unpack Issues

### 3.1 The desktop app reports an unpack error on first launch

**Symptom**: After installing the dmg/nsis/appimage, the app shows an unpack-failure prompt on first launch; the background log contains a discriminant error code.

**Cause**: In packaged form the desktop shell (Tauri v2) unpacks the shared runtime from packaged resources — the Rust side `unpack_runtime.rs` spawns the packaged Node to run `unpack.mjs`, consumes the discriminant `code` from a single line of JSON, and translates it into user copy (`desktop/src-tauri/src/unpack_runtime.rs:147-154`). Its error-code set shares the same source as the CLI.

**Error code → meaning → remedy**:

| code | meaning | remedy |
|---|---|---|
| `runtime-root-unwritable` | runtime directory not writable | check `~/.pi/web/runtime` permissions, or set `PI_WEB_RUNTIME_ROOT` |
| `disk-full` | insufficient disk space | free up disk and restart the app |
| `payload-missing` / `payload-corrupt` | packaged runtime payload missing or corrupted | reinstall the app |
| `zstd-unsupported` | packaged Node does not support zstd decompression | the app may be corrupted; reinstall |
| `lock-timeout` | timed out waiting for another process to unpack | confirm no other instance is stuck, then retry |
| `extract-failed` | unpacker output invalid / missing fields (fallback) | reinstall the app |

**Remedy**: Most codes point to "reinstall" or "switch to a writable runtime root". The desktop shell injects `PI_WEB_NODE_BIN` (the absolute path to the packaged node) into the backend child process, and deliberately **does not inject** `PI_WEB_AGENT_DIR` (so sessions default to `~/.pi/agent`, shared with the CLI). See [20-desktop-tauri.md](20-desktop-tauri.md) for desktop packaging/distribution and run modes.

> Note: the two specs corresponding to `desktop/` and its payload line (electron-to-tauri, shared-runtime-payload) are in the **implemented-partial** state, and cross-platform support is not fully verified; for platform-specific issues, use this table's error codes as the starting point.

---

## 4. Provider / Model Issues

### 4.1 Custom provider auth 401

**Symptom**: You configured a custom provider in `~/.pi/agent/models.json`, but calls return HTTP 401, or the logs show "channel does not exist" / "This token has no access to model (model name is empty)".

**Possible causes**:
- **A — config file in the wrong location**: a custom provider must be written in `~/.pi/agent/models.json`, **not** in `auth.json` (the latter is managed by the pi CLI login flow; manual edits get overwritten and are not recognized by `ModelRegistry`).
- **B — required fields missing**: missing either `baseUrl` or `apiKey` prevents constructing the request.
- **C — DashScope / MAAS key does not match the endpoint**: a DashScope MAAS token (the Tongyi Qianwen primary-account API key) **cannot** be used for the image-generation endpoint; the two are independent key systems, and using one against the other's endpoint always returns 401.

**Remedy**:

**Step 1** — confirm the location and format of `models.json`:
```bash
cat ~/.pi/agent/models.json
jq . ~/.pi/agent/models.json   # verify it is valid JSON
```
Minimal valid structure:
```json
{
  "providers": {
    "my-gateway": {
      "name": "My Gateway",
      "baseUrl": "https://example.com/v1",
      "apiKey": "sk-...",
      "api": "openai-completions",
      "models": [
        {
          "id": "some-model",
          "name": "Some Model",
          "input": ["text"],
          "contextWindow": 131072,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

**Step 2** — verify the model appears in the list (requires the global `pi` CLI on PATH; `--list-models` shares the same source as pi-web's in-process model enumeration, see `packages/server/src/config/model-options.ts:7`):
```bash
pi --list-models             # list all available models
pi --list-models my-gateway  # fuzzy search, only this provider
```
Expected result: `some-model` under `my-gateway` appears in the output. If you don't see it, go back to Step 1 and check the JSON.

**Step 3** (DashScope scenario): split text chat and image generation into two provider entries, each configured with its own key and endpoint.

> Boundary reminder: `models.json` / `ModelRegistry` **only govern text-chat models**. The models for the AIGC image tools (`image_generation` / `image_edit`) and the vision tool (`image_vision`) do not go through `ModelRegistry`, but through their own module-level routing tables — see [11-aigc-and-vision-tools.md](11-aigc-and-vision-tools.md).

---

### 4.2 iPhone multi-image JPEG upload causes the gateway to report "empty model name" or "channel does not exist"

**Symptom**: After uploading multiple photos taken on an iPhone (HEIC converted to JPEG, or JPEG directly), the image-editing request returns "no available channel exists" or "This token has no access to model", with the model name being an empty string; the same image via a regular screenshot works fine.

**Cause**: iPhone multi-image JPEGs contain an MPF (Multi-Picture Format, `APP2` segment) index, plus a second JPEG (HDR gain map) appended after the main image's `EOI`. NewAPI-class gateways fail upstream-channel matching when parsing such files and return a misleading error.

**Fix status**: `normalizeImageDataUri()` in `packages/tool-kit/src/engine/normalize-image.ts` already implements **pure-JS, zero-dependency** MPF stripping and trailing-truncation (it strips `MPF`-class `APP2` segments and truncates at the main image's first `EOI`; it preserves `ICC_PROFILE`, EXIF orientation, and other metadata, lossless and without re-encoding), and the image tool calls it automatically before uploading to the gateway — the call site is `packages/tool-kit/src/aigc/run-image-tool.ts:204` (imported from `../engine/normalize-image.js` at `run-image-tool.ts:29`). No manual intervention is needed.

**If you still hit this** (e.g. a custom tool that did not go through `normalizeImageDataUri`), preprocess manually:
```bash
# Use ImageMagick to take only the first frame (main image) of the multi-image JPEG, discarding the MPF index and trailing gain map
convert 'input.jpg[0]' output.jpg
```

---

## 5. Web Extension / UI Issues

### 5.1 webext artifact region is blank, no iframe

**Symptom**: You configured `.pi/web/web.config.tsx` and expected content to render in the artifact region, but the right side is completely blank and no `<iframe>` can be found in the DOM.

**Cause**: `ArtifactSurface` mounts the iframe only when it has an extension base URL (no base URL means no mount — this is **correct security gating**, not a bug). The value comes from the environment variable `NEXT_PUBLIC_PI_EXTENSION_BASE_URL`. **Note the semantics have changed**: it is no longer inlined at build time, but read from env at **runtime** on the server by `GET /api/bootstrap` and pushed down to the frontend (`server/bootstrap.ts:105`, `lib/app/runtime-features.ts:67`).

**Remedy**:
```bash
# dev mode (use the API address when webext and the main app are same-origin)
NEXT_PUBLIC_PI_EXTENSION_BASE_URL=http://localhost:3000 pnpm dev
# still open http://localhost:5173 in the browser

# or persist it in .env.local
echo 'NEXT_PUBLIC_PI_EXTENSION_BASE_URL=http://localhost:3000' >> .env.local
```
Because this value is now pushed down at runtime, **changing env and restarting the server takes effect immediately, with no rebuild needed** (the frontend no longer inlines the variable). See [12-web-ui-extension.md](12-web-ui-extension.md) for the artifact / Tier4 surface.

---

### 5.2 Canvas workbench panel does not show

**Symptom**: You expect the Canvas remix canvas/gallery, but there is no entry in the sidebar or panels at all.

**Cause**: The Canvas panel is **gated by the environment variable `NEXT_PUBLIC_PI_WEB_CANVAS`, off by default** (`bool(env.NEXT_PUBLIC_PI_WEB_CANVAS)`, see `server/bootstrap.ts:93`, `lib/app/runtime-features.ts:55`). When not enabled, the canvas/gallery not mounting is correct gating, not a fault. Same family as 5.1 — this gate is now read and pushed down at runtime by `GET /api/bootstrap`.

**Remedy**:
```bash
NEXT_PUBLIC_PI_WEB_CANVAS=1 pnpm dev   # open 5173 in the browser
# production: set this env on the server process and restart, no rebuild needed
NEXT_PUBLIC_PI_WEB_CANVAS=1 node dist/server.mjs
```
See [16-canvas-workbench.md](16-canvas-workbench.md) for the Canvas workbench's editor interactions, generation actions, gallery, and the "readout" button.

---

### 5.3 `split` layout right side is empty

**Symptom**: You set `config.layout = "split"` in `web.config.tsx` but see no right-side content.

**Cause**: `layout: "split"` is marked `hasAside: true`. The early implementation rendered the clearance region unconditionally, so when both `panelRight` and the artifact are empty, it left roughly a 384px blank floating column under the lg viewport.

**Fix status**: from `packages/ui/src/chat/pi-chat.tsx:1094` (the `showAside` decision) onward, the `<aside>` is rendered only when the clearance region has actual content (`pi-chat.tsx:1715`); with no content it **gracefully degrades to the centered layout**, leaving no blank space (fix in `72394b6`).

**Remedy**: if you genuinely want a split, put content into the `panelRight` slot. A runnable reference: `examples/webext-layout-agent/.pi/web/web.config.tsx` (uses `config.panelRatio: "3:7"` + `slots.panelRight`). The equivalent with `layout: "split"`:
```tsx
// .pi/web/web.config.tsx
import { defineWebExtension } from "@blksails/pi-web-kit";

export default defineWebExtension({
  manifestId: "my-ext",
  capabilities: ["slots", "config"],
  config: { layout: "split", panelRatio: "2:1" },
  slots: { panelRight: <MyPanel /> },
});
```

---

### 5.4 Background slot is covered by the shell base (`backgroundLayer` not visible)

**Symptom**: You injected content into the `backgroundLayer` slot (e.g. a background image), but it's not visible in the browser and the default background still shows.

**Cause**: A negative-`z-index` element in a parent container without its own stacking context escapes to the `<body>` root context and is covered by the opaque app-shell.

**Fix status**: `packages/ui/src/chat/pi-chat.tsx:1645` already adds `isolate` (CSS `isolation: isolate`) on the wrapper, confining `backgroundLayer`'s `z-index: -10` within that column.

**If you hit a similar issue implementing a slot yourself**, establish an independent stacking context on the container holding the negative-`z-index` child:
```css
.my-container {
  isolation: isolate; /* or position: relative + z-index: 0 */
}
```

---

### 5.5 A conversation turn fails but the assistant bubble is blank (the error cause is invisible)

**Symptom**: A turn fails due to a provider / streaming error (e.g. `Connection error.`, auth failure), but the assistant bubble is empty, so you can't tell whether the model didn't respond or an error occurred.

**Cause**: The session translation layer used to discard or translate-as-normal-completion the runtime events carrying the real error (`message_end`'s `stopReason:"error"` + `errorMessage`, `agent_end`'s `willRetry`, `auto_retry_end`'s `finalError`).

**Fix status** (spec `stream-error-surfacing`, implemented):
- The translation layer `packages/server/src/session/translate/translate-event.ts`, when retries are exhausted or the error is non-retryable, translates the terminal error into a visible error signal and passes through the real `errorMessage`.
- The real-time stream renders it via the `<ChatError>` element (`role="alert"`, destructive color); history replay appends a `data-pi-error` part to messages with `stopReason === "error"` and renders it inline as a red block.
- A user-initiated abort is not misreported as an error.

**If you still see a blank bubble**: confirm the running version already includes this spec; use dev tools to check whether the failed turn's message node carries `data-pi-error`, and inspect the raw `agent_end` / `message_end` events in the server logs to verify `errorMessage`.

---

## 6. Testing and Toolchain Issues

### 6.1 Tool-call JSON code block `textContent` is empty under jsdom

**Symptom**: In vitest (`environment: "jsdom"`) you assert on tool-argument JSON via `textContent` and get an empty result, but it displays fine in a real browser.

**Cause**: The `<Response>` component uses `streamdown` underneath (`packages/ui/src/ui/response.tsx:14` imports `Streamdown`), whose code-block highlighting is **asynchronous** (Shiki). jsdom has no real layout engine, so `textContent` is empty while async rendering has not completed.

**Fix status (tool / data JSON)**: `<ToolInput>` in `packages/ui/src/parts/pi-tool-part.tsx` renders with a **synchronous** `<pre><code className="language-json">` + `highlightJson()`, ensuring it can be read synchronously under jsdom (`pi-tool-part.tsx:314`, `highlightJson` defined at `:137`).

**Remedy (custom components)**:
- For tool arguments and data-class JSON display, use the synchronous `<pre><code className="language-json">`, not `<Response>`.
- If you must use `<Response>`, `await act(async () => { ... })` in tests to wait for shiki, or mock `streamdown`.

---

### 6.2 `--no-skills` argument is dropped (fixed)

**Symptom** (historical): after passing `--no-skills`, the system skills were still loaded; toggling the "System Resources" switch on the settings page had no effect.

**Fix status**: `packages/server/src/runner/runner.ts:115-134` now correctly parses the flag and writes it into `RunnerArgs.noSkills`, and `option-mapper.ts:184` downstream overrides with empty `skills`.

**If the switch still has no effect**: confirm the version includes the fix. Note that `--no-skills` is a **runtime argument** parsed by the runner at session activation (from URL parameter / session config); it does **not** land in `settings.json`, so `GET /api/config/extensions/global` (which returns `settings.json` extension config) will not reflect it.

---

## 7. Concurrency and Worktree Issues

### 7.1 Concurrent sessions reset the main worktree branch and destroy commits

**Symptom**: when multiple AI agent sessions run in parallel, `git` operations interfere — after one session switches branches, another session's file state gets scrambled, or commits get lost.

**Cause**: multiple processes concurrently doing `git checkout / reset` on the same git worktree (`agents/pi-web/`) overwrite each other's `HEAD`.

**Remedy**: run long tasks (implementation-class tasks lasting more than a few minutes) in an **isolated git worktree**, not on the main worktree:
```bash
# Create an isolated worktree (one level up from the repo root)
git worktree add ../pi-web-attach -b feat/my-feature HEAD

cd ../pi-web-attach
# ... edit, commit ...

# When done, merge back to the main branch and remove the worktree
cd ../pi-web
git merge feat/my-feature
git worktree remove ../pi-web-attach
```

---

## 8. Diagnostic Quick Reference

| Issue keyword | Check first |
|---|---|
| dev opens 3000 and shows a bare API | during dev the browser should open **5173** (Vite); 3000 is the proxied API host |
| route/config-domain change has no effect | handler singleton pinned to `globalThis`; restart dev (or `dev:server`) |
| `node:fs` / pi SDK resolution failure | pi SDK runs only on the Node side; externalized in esbuild `external` (`build-server.mjs`) — don't bundle into the frontend |
| reply needs a refresh to appear | per-turn `/stream` not subscribed before the agent's first frame + server has no replay; fixed by `whenSubscribed`, fallback is to warm up the route |
| session stuck on "connecting to agent…" | dev frontend/backend out of sync deadlocks the readiness handshake; fully restart dev |
| production blank page / webext not loading | production CSP forbids `unsafe-eval` + sha256-allows the import map; don't use eval, don't rewrite inline scripts |
| CLI reports "dist/server.mjs not found" | run `pnpm build:dist` first; or set `PI_WEB_DIST_DIR` |
| npm first-launch unpack fails | check the error code (zstd→upgrade Node 22.15+ / disk-full / lock-timeout / switch `PI_WEB_RUNTIME_ROOT`) |
| desktop app first-launch unpack fails | same discriminant codes; mostly reinstall or switch to a writable runtime root, see [20](20-desktop-tauri.md) |
| custom provider 401 | `models.json` location (`~/.pi/agent/`), `baseUrl`+`apiKey` required, DashScope key hits the right endpoint |
| iPhone JPEG "empty model name" | whether `normalizeImageDataUri` (`run-image-tool.ts:204`) is on the chain; custom tools must call it explicitly |
| webext no iframe | `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` not set; now pushed at runtime, restart the server to take effect |
| Canvas panel not showing | `NEXT_PUBLIC_PI_WEB_CANVAS` off by default; set to 1 and restart the server |
| split right side empty | `slots.panelRight` not configured; newer versions degrade to centered with no content, not blank |
| blank assistant bubble, error invisible | terminal-error translation; check `data-pi-error` / server-side `agent_end` event |
| background slot covered | outer container missing `isolation: isolate` |
| empty jsdom textContent | streamdown async highlighting; switch tool JSON to synchronous `pre + language-json` |
| `--no-skills` no effect | it's a runtime argument that does not land in `settings.json`; confirm the version includes the fix |
| concurrent sessions lose commits | put long tasks in an isolated worktree (`git worktree add`) |

---

## Related Links

- [06-configuration.md](06-configuration.md) — full env variable table (`PI_WEB_DIST_DIR` / `PI_WEB_RUNTIME_ROOT` / `NEXT_PUBLIC_PI_WEB_CANVAS` / `NEXT_PUBLIC_PI_EXTENSION_BASE_URL`, etc.)
- [07-providers-and-models.md](07-providers-and-models.md) — `models.json` format and DashScope key
- [11-aigc-and-vision-tools.md](11-aigc-and-vision-tools.md) — AIGC image/vision tools, `normalizeImageDataUri`, model-routing boundary
- [12-web-ui-extension.md](12-web-ui-extension.md) — webext five-tier model, artifact/slot and gating
- [13-config-ui.md](13-config-ui.md) — schema-driven settings UI
- [16-canvas-workbench.md](16-canvas-workbench.md) — Canvas workbench and gating
- [18-cli.md](18-cli.md) — CLI startup, three-tier `resolveRuntime`, first-launch unpack
- [19-deployment.md](19-deployment.md) — esbuild single-file artifact, packaged payload, production CSP hardening
- [20-desktop-tauri.md](20-desktop-tauri.md) — desktop packaging/distribution, run modes, first-launch unpack error codes
- [22-development-and-testing.md](22-development-and-testing.md) — `pnpm dev` two-process orchestration, `build:dist` pipeline, isolated builds
- [24-http-api-reference.md](24-http-api-reference.md) — HTTP/SSE API, `GET /api/bootstrap`, SSE control frames
