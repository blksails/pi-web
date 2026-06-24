# 18 · Troubleshooting / FAQ

This chapter collects the known high-frequency issues encountered during pi-web development and operations. Each entry is laid out in a three-part form: "Symptom → Cause → Remedy". When you need a quick answer, jump straight to the [6. Diagnostic Quick Reference](#6-diagnostic-quick-reference) at the end and locate the issue by keyword.

---

## 1. Dev Server Issues

### 1.1 Webpack 500 on the page after running `pnpm build` while dev is running

**Symptom**: `pnpm dev` is running, you open another terminal and run `pnpm build`, and afterward the browser refresh shows a webpack module-resolution 500 error, or the page goes completely blank.

**Cause**: `pnpm build` (i.e. `next build`) writes to `.next/` by default, sharing the same output directory as `pnpm dev`. The build process overwrites chunks that the dev server has already memory-mapped, scrambling file handles.

**Remedy**:
1. Never run `pnpm build` without an isolated directory while `pnpm dev` is running.
2. Both the CLI build and the e2e build use `NEXT_DIST_DIR` for isolation:
   ```bash
   # CLI standalone artifact
   NEXT_DIST_DIR=.next-cli next build

   # e2e isolated build (does not affect dev)
   PI_WEB_STUB_AGENT=1 NEXT_DIST_DIR=.next-e2e pnpm build
   PI_WEB_STUB_AGENT=1 NEXT_DIST_DIR=.next-e2e next start -p 3100
   ```
3. If `.next/` is already polluted, stop dev, delete `.next/`, then re-run `pnpm dev`:
   ```bash
   rm -rf .next && pnpm dev
   ```

Related config: `next.config.ts:55` (`distDir: process.env.NEXT_DIST_DIR ?? ".next"`)

---

### 1.2 Injected routes or config-domain changes don't take effect

**Symptom**: You modified a route file under `app/api/` or config-domain-related code, Next.js hot reload triggers on save, but the new route is still unavailable (404 or unchanged behavior).

**Cause**: The `createPiWebHandler` instance in `lib/app/pi-handler.ts` is **pinned to `globalThis` after the first call** (`lib/app/pi-handler.ts:342`). In `dev` mode, hot reload only replaces the module and does not reset `globalThis`, so the old handler instance keeps serving requests.

**Remedy**:
1. Manually restart the dev server (`Ctrl-C` → `pnpm dev`).
2. It listens on `:3000` by default (the review checklist notes that some machines conventionally use `:3010`; rely on the port actually printed by `pnpm dev`).
3. After restarting, if your change involves session state, prefer creating a new session for testing rather than reusing an old session URL.

---

### 1.3 Importing the pi SDK in the main process crashes dev routes with `node:fs`

**Symptom**: Under `pnpm dev`, accessing any route throws an error, and the logs contain something like `Cannot read properties of undefined (reading 'existsSync')` or `Module not found: Can't resolve 'node:fs'`.

**Cause**: `@earendil-works/pi-coding-agent` and its transitive dependencies (`@earendil-works/pi-ai`) contain `node:fs / node:os / node:path` and dynamic `require()`. If these packages get bundled into the route bundle (instead of being externalized into the Node runtime), webpack fails to resolve these imports.

**Root-cause location**: `serverExternalPackages` in `next.config.ts` (`next.config.ts:96`) plus the webpack `externals` configuration (the `webpack()` hook starting at `next.config.ts:131`).

**Remedy**:
1. Confirm that `serverExternalPackages` in `next.config.ts` includes:
   ```ts
   serverExternalPackages: [
     "jiti",
     "@earendil-works/pi-coding-agent",
     "@earendil-works/pi-ai",
   ],
   ```
2. Also confirm that the `piSdkExternal` function in webpack `externals` returns the `module <absolute-path>` form for `@earendil-works/pi-coding-agent` (`next.config.ts:148`, where the absolute path is resolved by `piSdkEntryAbsPath()`).
3. Any code that imports the pi SDK in the main process (route handler) must use subpath imports (e.g. `@blksails/pi-web-server/trust`, `@blksails/pi-web-server/model-options`); it must not go through a barrel that lets webpack bundle the pi SDK.

---

## 2. Provider / Model Issues

### 2.1 Custom provider auth 401

**Symptom**: You configured a custom provider in `~/.pi/agent/models.json`, but calls return HTTP 401, or the logs show "channel does not exist" / "This token has no access to model (model name is empty)".

**Possible cause A — config file in the wrong location**: A custom provider must be written in `~/.pi/agent/models.json`, not in `auth.json`. `auth.json` is managed by the pi CLI login flow; manual edits get overwritten and are not recognized by `ModelRegistry` as a custom provider.

**Possible cause B — required fields missing**: `baseUrl` and `apiKey` are required fields; missing either one prevents the SDK from constructing the request.

**Possible cause C — DashScope / MAAS key does not match the endpoint**: A DashScope MAAS token (the Tongyi Qianwen primary-account API key) **cannot** be used for the image-generation endpoint (`/api/v1/services/aigc/multimodal-generation`); the two are independent key systems, and using one against the other's endpoint always returns 401.

**Remedy**:

**Step 1**: Confirm the location and format of `models.json`:
```bash
cat ~/.pi/agent/models.json
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

**Step 2**: Verify the model appears in the list (requires the global `pi` CLI on PATH; `--list-models` shares the same source as the in-process model enumeration of pi-web, see `packages/server/src/config/model-options.ts:7`):
```bash
pi --list-models           # list all available models
pi --list-models my-gateway # fuzzy search, only this provider
```
Expected result: `some-model` under `my-gateway` appears in the output. If you still don't see it, go back to Step 1 and check whether `models.json` is valid JSON (you can validate with `jq . ~/.pi/agent/models.json`).

**Step 3** (DashScope scenario): Split text chat and image generation into two provider entries, each configured with its own key and endpoint; AIGC images use the native DashScope protocol — see [11-aigc-tools.md](./11-aigc-tools.md).

---

### 2.2 iPhone multi-image JPEG upload causes the gateway to report "empty model name" or "channel does not exist"

**Symptom**: After uploading multiple photos taken on an iPhone (HEIC converted to JPEG, or JPEG directly), the image-editing request returns "no available channel exists" or "This token has no access to model", with the model name being an empty string; taking a screenshot of the same image with a regular JPEG tool works fine.

**Cause**: iPhone multi-image JPEGs contain an MPF (Multi-Picture Format, `APP2` segment) index, plus a second JPEG (HDR gain map) appended after the main image's `EOI`. NewAPI-class gateways fail upstream-channel matching when parsing such files and return a misleading error.

**Fix status**: The `normalizeImageDataUri()` function in `packages/tool-kit/src/engine/normalize-image.ts` already implements **pure-JS, zero-dependency** MPF stripping and trailing-truncation logic (it strips `MPF`-class `APP2` segments and truncates at the main image's first `EOI`; it preserves `ICC_PROFILE`-class `APP2`, EXIF orientation, and other metadata, lossless and without re-encoding). The image-editing tool calls it automatically before uploading to the gateway (`packages/tool-kit/src/engine/compile-tool.ts:263`). No manual intervention is needed.

**If you still hit this issue** (for example, you used a custom tool that did not go through `normalizeImageDataUri`), preprocess manually:
```bash
# Use ImageMagick to take only the first frame (main image) of the multi-image JPEG, discarding the MPF index and trailing gain map
convert 'input.jpg[0]' output.jpg
```

---

## 3. Web Extension / UI Issues

### 3.1 webext artifact region is blank, no iframe

**Symptom**: You configured `.pi/web/web.config.tsx` and expected content to render in the artifact region, but the right region is completely blank, and no `<iframe>` can be found in the browser DOM.

**Cause**: `components/chat-app.tsx:375` passes `extensionBaseUrl` into `<PiChat>` only when `process.env.NEXT_PUBLIC_PI_EXTENSION_BASE_URL` has a value; if the `ArtifactSurface` component does not receive a base URL, it does not mount the iframe (this is correct security gating, not a bug).

**Remedy**:
```bash
# dev mode (when webext and the main app are same-origin, use the dev address directly)
NEXT_PUBLIC_PI_EXTENSION_BASE_URL=http://localhost:3000  pnpm dev

# or persist it in .env.local
echo 'NEXT_PUBLIC_PI_EXTENSION_BASE_URL=http://localhost:3000' >> .env.local
```

Note: This variable is prefixed with `NEXT_PUBLIC_` and must be injected at build time (Next.js inlines it into the client bundle), so after modifying `.env.local` you must restart `pnpm dev` for it to take effect.

---

### 3.2 `split` layout right side is empty (historical issue: once produced a 384px blank floating region)

**Symptom**: You set `config.layout = "split"` in `web.config.tsx` but did not configure `panelRight`; you expected a left/right split but see no right-side content.

**Cause**: `layout: "split"` is marked `hasAside: true` in the layout table (`packages/ui/src/customization/layout.ts:49`). The early implementation rendered the `<aside>` clearance region unconditionally, so when both the `panelRight` slot and the artifact were empty, it left a full column of about 384px — a "detached blank floating region" — under the lg viewport.

**Fix status**: From `packages/ui/src/chat/pi-chat.tsx:1058` onward, the `<aside>` is rendered only when the clearance region has actual content (`panelRight` slot or artifact); when `config.layout="split"` but there is no content, it **gracefully degrades to the centered layout** (`content` width is `max-w-3xl`, same as `centered`), leaving no blank space (fix in commit `72394b6`).

**Remedy**: If you genuinely need right-side split content, put the content into the `panelRight` slot — the real config API is `defineWebExtension`, where `layout` (`LayoutPreset`, defined at `packages/ui/src/chat/pi-chat.tsx:110`) and `panelRatio` live under the `config` field, and `panelRight` lives under the `slots` field. A runnable reference: `examples/webext-layout-agent/.pi/web/web.config.tsx` (that example uses `config.panelRatio: "3:7"` + `slots.panelRight`, and the host renders the split clearance region accordingly). Below is the equivalent with `layout: "split"`:
```tsx
// .pi/web/web.config.tsx
import { defineWebExtension } from "@blksails/pi-web-kit";

export default defineWebExtension({
  manifestId: "my-ext",
  capabilities: ["slots", "config"],
  config: { layout: "split", panelRatio: "2:1" },
  slots: { panelRight: <MyPanel /> },
});

// or switch to a non-split layout preset
export default defineWebExtension({
  manifestId: "my-ext",
  capabilities: ["config"],
  config: { layout: "wide" }, // "centered" / "wide" / "full"
});
```

---

### 3.3 Background slot is covered by the shell base (`backgroundLayer` not visible)

**Symptom**: You injected content into the `backgroundLayer` slot in the webext config (e.g. a custom background image), but it's not visible in the browser and the page still shows the default white background.

**Cause**: A negative-`z-index` element in a parent container that has not established its own stacking context escapes to the `<body>` root context and is covered by the opaque app-shell `<div>`.

**Fix status**: `packages/ui/src/chat/pi-chat.tsx:938` already adds the `isolate` Tailwind class (i.e. CSS `isolation: isolate`) on the wrapper, confining `backgroundLayer`'s `z-index: -10` within that column so it is no longer covered by the outer layer.

**If you hit a similar issue implementing a slot yourself**, make sure the container holding the negative-`z-index` child sets `isolation: isolate` or `position: relative` + `z-index: 0` to establish its own stacking context:
```css
.my-container {
  isolation: isolate; /* establish a stacking context */
}
```

---

### 3.4 A conversation turn fails but the assistant bubble is blank (the error cause is invisible)

**Symptom**: A conversation turn fails due to a provider / streaming error (e.g. `Connection error.`, auth failure), but the assistant bubble in the Web UI is empty, looking "as if it had nothing to say". You can't tell whether the model didn't respond or an error occurred, and you can't see the real error message.

**Cause**: The session translation layer used to either discard or translate-as-normal-completion the runtime events carrying the real error (`message_end`'s `stopReason:"error"` + `errorMessage`, `agent_end`'s `willRetry`, `auto_retry_end`'s `finalError`), so the frontend rendered only an empty assistant bubble.

**Fix status** (spec `stream-error-surfacing`, implemented):
- The translation layer `packages/server/src/session/translate/translate-event.ts`, **when retries are exhausted or the error is non-retryable**, translates the terminal error into a user-visible error signal and passes through the real `errorMessage` (no longer overriding it with hardcoded copy).
- Real-time frontend stream: `packages/ui/src/chat/pi-chat.tsx:871` renders it via the `<ChatError>` element (`role="alert"`, destructive color).
- History replay: `packages/react/src/transport/agent-message-to-ui.ts:212` appends a `data-pi-error` part to assistant messages with `stopReason === "error"`, rendered inline as a red block by `part-renderer.tsx:115`.
- A user-initiated abort is not misreported as an error.

**If you still see a blank bubble**: confirm that the running version already includes this spec's implementation; use browser dev tools to check whether the failed turn's assistant message node carries `data-pi-error`, and inspect the raw `agent_end` / `message_end` events in the dev server logs to verify whether `errorMessage` is empty (when the provider itself returns no error copy, the translation layer uses fallback copy).

---

## 4. Testing and Toolchain Issues

### 4.1 Tool-call JSON code block `textContent` is empty under jsdom

**Symptom**: In vitest (`environment: "jsdom"`), you assert on tool-call argument JSON content via `screen.getByRole(...)?.textContent` and get an empty string or `undefined`, but it displays fine in a real browser.

**Cause**: The `<Response>` component uses `streamdown` underneath (`packages/ui/src/ui/response.tsx:7`), whose code-block highlighting is **asynchronous** (Shiki). jsdom has no real layout engine, so `textContent` is empty while async rendering has not completed.

**Fix status (tool / data JSON)**: `<ToolInput>` in `packages/ui/src/parts/pi-tool-part.tsx` renders with a **synchronous** `<pre><code className="language-json">` together with `highlightJson()`, not going through `<Response>` / streamdown, ensuring `textContent` can be read synchronously under jsdom (`pi-tool-part.tsx:238`).

**Remedy (custom components)**:
- For tool arguments and data-class JSON display, use the synchronous `<pre><code className="language-json">` approach, not `<Response>`.
- If you must use `<Response>`, in jsdom tests `await act(async () => { ... })` to wait for shiki to finish, or mock `streamdown`.

---

### 4.2 `--no-skills` argument is dropped (fixed)

**Symptom** (historical issue, fixed): After passing `--no-skills` via URL parameter or session config, the system skills were still loaded; toggling the "System Resources" switch on the settings page had no effect.

**Cause (fixed)**: `parseRunnerArgs` had a path that did not correctly parse the `--no-skills` flag and write it into `RunnerArgs`.

**Fix status**: `packages/server/src/runner/runner.ts:115–134` now handles it correctly:
```ts
} else if (arg === "--no-skills" || arg!.startsWith("--no-skills=")) {
  noSkills = arg === "--no-skills" ? true : takeValue("--no-skills") !== "false";
}
// ...
if (noSkills !== undefined) result.noSkills = noSkills;
```
`option-mapper.ts:184` downstream also correctly applies the `noSkills` override (clearing skills).

**If the switch still has no effect**: confirm you are on the `system-resource-toggle-fix` branch or a version merged into `main` afterward. Note that `--no-skills` is a runtime argument parsed by the runner at session activation (from URL parameter / session config), and does **not** land in `settings.json`, so `GET /api/config/extensions/global` (which returns the extension config from `<agentDir>/settings.json`) will not reflect it. To verify, cross-check the arguments the runner actually receives: `parseRunnerArgs` writes `--no-skills` into `RunnerArgs.noSkills` (`runner.ts:115`), and `option-mapper.ts:184` uses it to override with empty `skills` (`skillsOverride` returns `{ skills: [] }`).

---

## 5. Concurrency and Worktree Issues

### 5.1 Concurrent sessions reset the main worktree branch and destroy commits

**Symptom**: When multiple AI agent sessions run in parallel, `git` operations interfere with each other — after one session switches branches, another session's file state gets scrambled, or commits get lost.

**Cause**: Multiple processes concurrently doing `git checkout / reset` on the same git worktree (`agents/pi-web/`) overwrite each other's `HEAD` pointer.

**Remedy**: Run long tasks (implementation-class tasks lasting more than a few minutes) in an **isolated git worktree**, not on the main worktree:
```bash
# Create an isolated worktree (one level up from the repo root)
git worktree add ../pi-web-attach -b feat/my-feature HEAD

# Work inside the isolated directory
cd ../pi-web-attach
# ... edit, commit ...

# When done, merge back to the main branch and remove the worktree
cd ../pi-web
git merge feat/my-feature
git worktree remove ../pi-web-attach
```

---

## 6. Diagnostic Quick Reference

| Issue keyword | Check first |
|---|---|
| webpack 500 / chunk error | whether `pnpm build` ran while dev was running; delete `.next/` and restart |
| new route not taking effect | handler singleton pinned to globalThis; restart dev |
| `node:fs` resolution failure | `next.config.ts` `serverExternalPackages` + `externals` |
| custom provider 401 | `models.json` location (`~/.pi/agent/`); `baseUrl`+`apiKey` are required |
| DashScope image 401 | MAAS token and native DashScope key are independent; hit the right endpoint |
| iPhone JPEG "empty model name" | whether `normalizeImage` is on the call chain; custom tools must call it explicitly |
| webext no iframe | `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` not set; restart dev |
| split right side empty | `slots.panelRight` not configured; newer versions degrade to centered, not blank |
| blank assistant bubble, error invisible | terminal error translation; check `data-pi-error` / server-side `agent_end` event |
| background slot covered | outer container missing `isolation: isolate` |
| empty jsdom textContent | streamdown async highlighting; switch tool JSON to synchronous `pre+language-json` |
| `--no-skills` no effect | confirm the `system-resource-toggle-fix` fix is included |
| concurrent sessions lose commits | put long tasks in an isolated worktree (`git worktree add`) |

---

## Related Links

- [05-configuration.md](./05-configuration.md) — full env variable table, including `NEXT_DIST_DIR`, `NEXT_PUBLIC_PI_EXTENSION_BASE_URL`
- [06-providers-and-models.md](./06-providers-and-models.md) — `models.json` format and DashScope key details
- [10-web-ui-extension.md](./10-web-ui-extension.md) — webext config, layout/slot usage
- [11-aigc-tools.md](./11-aigc-tools.md) — AIGC image tools, `normalizeImage`, DashScope endpoint
- [14-cli.md](./14-cli.md) — CLI startup, `--port` argument
- [17-development-and-testing.md](./17-development-and-testing.md) — test environment isolation, e2e build workflow
