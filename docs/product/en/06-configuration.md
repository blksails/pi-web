# 06 · Configuration Reference

pi-web is fully configured through two paths — the `.env.local` file and the `~/.pi/agent` directory. This chapter documents the purpose, default value, and an example for every variable.

---

## Getting Started

1. Copy the example file:

   ```bash
   cp .env.local.example .env.local
   ```

2. Fill in variables as needed. By default `.env.local.example` lists only credentials and session defaults; add the remaining variables (attachments, session store, hot reload, etc.) manually as needed. For the full list, see [Full Variable Table](#full-variable-table) below.

3. Start the dev server:

   ```bash
   pnpm dev
   ```

   **Expected result**: `pnpm dev` is `node scripts/dev-all.mjs` (`package.json:17`), which launches two processes concurrently — the backend API host `server/index.ts` listens on `127.0.0.1:3000`, and the Vite dev server listens on `http://localhost:5173` (`vite.config.ts:73`). **The browser should open 5173**; `/api` requests are reverse-proxied by Vite to 3000 (`vite.config.ts:76-81`). If you open 3000 by mistake, you get the bare API host rather than the source-selection page.

If you have already logged in with `pi`, your API key is already present in `~/.pi/agent/auth.json`, so **you do not need to set any provider key** — you can skip step 2 entirely and start directly. If the page reports an authentication error after startup, see [23 · Troubleshooting FAQ](./23-troubleshooting-faq.md).

---

## Runtime Gating and `GET /api/bootstrap`

pi-web has moved off Next.js (the frontend is Vite + SPA, the backend is a Hono host, and the server side is bundled by esbuild into a single file `dist/server.mjs`). This introduces a **semantic inversion** you must understand when configuring:

Variable names prefixed with `NEXT_PUBLIC_` are **all retained**, but they are **no longer inlined at build time**. The old host (Next) would **bake** `NEXT_PUBLIC_*` referenced in client components into the bundle during `next build`, which meant that setting them at runtime as a CLI user actually **had no effect**. After the SPA migration:

1. The server reads these env vars in `server/bootstrap.ts:buildBootstrap` (`server/bootstrap.ts:92-107`).
2. On startup the frontend fetches `GET /api/bootstrap` once (`server/index.ts:67`), injects the result into `lib/app/runtime-features.ts` via `setRuntimeFeatures()`, and the `<BootstrapGate>` in `src/bootstrap.tsx` **does not render** gated subtrees until the config arrives (to avoid flicker).

**Result**: runtime switches such as `pi-web --canvas` and `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1 node dist/server.mjs` now actually take effect — change the env var, restart the process, no rebuild required.

The table below lists the frontend gating fields emitted by `/api/bootstrap` and their env sources (`server/bootstrap.ts:92-107`):

| env variable | gating field | default | purpose |
|---|---|---|---|
| `NEXT_PUBLIC_PI_WEB_CANVAS` | `canvas` | off | Canvas workbench panel (see the deprecation note under "Canvas Gate" below) |
| `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` | `sourcePicker` | off | Shows the browsable source list on the source-selection page |
| `NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL` | `launcherRail` | off | Sidebar launcher rail |
| `NEXT_PUBLIC_PI_WEB_BASH_ENABLED` | `bashEnabled` | off | Frontend recognition of the `!`/`!!` bash prefix (experience switch) |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` | `sessionsGlobal` | off | Shows the "All" system sessions tab |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE` | `sessionsManage` | **on** | Session write operations (delete / rename / favorite); `false`/`0` turns it off |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` | `sessionsSlot` | `sidebar` | Host slot for the session list |
| `NEXT_PUBLIC_PI_WEB_DISABLE_READINESS_HANDSHAKE` | — | off | Disables the session-readiness handshake (for debugging) |

> **Two-sided consistency still matters**: the frontend gate now flows through `/api/bootstrap`, but the **backend** still reads the same variable names **directly from `process.env`** for authoritative gating (for example, a `scope=all` request is decided against `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` in `lib/app/pi-handler.ts:464-465`). Both ends read the same variable name from the same process env, so you only set it once when starting the process and both sides align; there is no longer a "baked into the frontend at build time, changed on the backend at runtime" mismatch.

---

## Full Variable Table

### 1. pi agent directory

| Variable | Default | Description |
|---|---|---|
| `PI_WEB_AGENT_DIR` | `~/.pi/agent` | pi config directory; the agent process reads `auth.json` / `settings.json` from it; takes precedence over `PI_CODING_AGENT_DIR` |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | Matches the env variable of the `pi` CLI itself; used as a fallback when `PI_WEB_AGENT_DIR` is unset |

> Resolution logic (`lib/app/config.ts:resolveAgentDir`): `PI_WEB_AGENT_DIR` → `PI_CODING_AGENT_DIR` → `~/.pi/agent`.

```bash
# Multi-tenant scenario: isolate config per user
PI_WEB_AGENT_DIR=/srv/tenants/acme/.pi/agent
```

---

### 2. Provider API Key (optional passthrough)

These keys only need to be filled in when you want to **override or supplement** `~/.pi/agent/auth.json`. After the server reads them, they are passed to the agent subprocess through the spawn env, and are **never** written into the response body, logs, or the client.

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude family |
| `OPENAI_API_KEY` | OpenAI / compatible gateways |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini (AI SDK) |
| `GEMINI_API_KEY` | Google Gemini (native) |
| `MISTRAL_API_KEY` | Mistral |
| `OPENROUTER_API_KEY` | OpenRouter gateway |

> The allowlist for the 6 text-conversation keys above is in `lib/app/config.ts:52-58` (`PROVIDER_KEY_NAMES`). Authentication source priority: `env key` (additive) > `~/.pi/agent/auth.json` (read by the agent process).

**AIGC image / vision-specific keys** (expanded by the tool-kit runtime var-resolver when it calls an endpoint, and likewise passed through the spawn env):

| Variable | Default | Description |
|---|---|---|
| `NEWAPI_API_KEY` | (unset) | NewAPI gateway (gpt-image generation/editing); see `packages/tool-kit/src/aigc/providers/newapi.ts:33` |
| `SUFY_API_KEY` | (unset) | sufy (Qiniu) gateway (gpt-image / Gemini 3.1 Flash Lite); see `providers/sufy.ts:37` |
| `DASHSCOPE_API_KEY` | (unset) | Alibaba Cloud DashScope (Qwen-Image editing, token plan); see `providers/dashscope.ts:40` |
| `DASHSCOPE_TOKENPLAN_BASE_URL` | `https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1` | token plan endpoint override; see `tools/image-generation.ts:40` (placeholder default of the form `${VAR:-default}`) |

> The model routing, cost, and gateway gotchas of the AIGC tools are covered in [11 · AIGC and Vision Tools](./11-aigc-and-vision-tools.md).

---

### 3. Session default provider / model

| Variable | Default | Description |
|---|---|---|
| `PI_WEB_DEFAULT_PROVIDER` | (unset, read from `settings.json`) | Force a specific provider, e.g. `openrouter` |
| `PI_WEB_DEFAULT_MODEL` | (unset, read from `settings.json`) | Force a specific model, e.g. `anthropic/claude-sonnet-4.6` |

> When left unset, the `defaultModel` / `defaultProvider` in `~/.pi/agent/settings.json` take effect, and the UI respects your local `pi` configuration.

```bash
PI_WEB_DEFAULT_PROVIDER=openrouter
PI_WEB_DEFAULT_MODEL=anthropic/claude-opus-4-5
```

---

### 4. Hide providers (deployment control)

| Variable | Default | Description |
|---|---|---|
| `PI_WEB_HIDE_PROVIDERS` | (unset, all visible) | Comma-separated provider names to remove from the `GET /config/models` response and the settings dropdown |

```bash
# Deploy to an environment that only allows OpenRouter routing; hide direct-connect providers
PI_WEB_HIDE_PROVIDERS=anthropic,openai,google
```

The implementation lives in `packages/server/src/config/model-options-filter.ts` (exports `parseHiddenProviders` / `excludeProviders`) and `lib/app/pi-handler.ts:448-449` (the `/config/models` route calls `parseHiddenProviders` + `excludeProviders`); the in-session `get_available_models` RPC applies the same filter (`packages/server/src/http/routes/query-routes.ts`), keeping the dropdown and the runtime-selectable set consistent. The frontend fetches data via `GET /api/config/models`. See [07 · Providers and Models](./07-providers-and-models.md) for details.

---

### 5. Default agent source / working directory

| Variable | Default | Description |
|---|---|---|
| `PI_WEB_DEFAULT_SOURCE` | (unset) | Default value on the source-selection page; a local directory or a git URL are both accepted |
| `PI_WEB_DEFAULT_CWD` | the server process's `process.cwd()` | Session working directory; affects the file tree the agent can see |

```bash
PI_WEB_DEFAULT_SOURCE=./examples/hello-agent
PI_WEB_DEFAULT_CWD=/workspace/myproject
```

---

### 6. Attachment system

| Variable | Default | Description |
|---|---|---|
| `PI_WEB_ATTACHMENT_DIR` | `~/.pi/agent/attachments` | Root directory where attachments are persisted (the sole source for the local backend); the main process delivers it to the subprocess through the spawn env, and both ends must match |
| `PI_WEB_ATTACHMENT_SECRET` | (random per process when unset) | HMAC signing secret; **must be set explicitly in subprocess-sharing scenarios**, otherwise signed URLs produced by the subprocess fail with 401 when verified by the main process |
| `PI_WEB_ATTACHMENT_URL_BASE` | `/api` (injected by pi-handler) | Prefix for attachment signed URLs; usually does not need to be set manually |

> The default directory resolution logic is in `packages/server/src/attachment/config.ts:resolveAttachmentDir`.

```bash
PI_WEB_ATTACHMENT_DIR=/data/pi-attachments
PI_WEB_ATTACHMENT_SECRET=your-stable-hmac-secret-min-32-chars
```

---

### 7. Development / e2e only

| Variable | Default | Description |
|---|---|---|
| `PI_WEB_STUB_AGENT=1` | off | Switches every session to a deterministic local stub agent (consumes no API key); enabled by default for Playwright e2e |
| `PI_RUNNER_HOT_RELOAD=1` | off | In dev mode, watches `packages/tool-kit/src` and automatically restarts idle runners on source changes (no need to open a new session) |
| `PI_RUNNER_HOT_RELOAD_PATHS` | `packages/tool-kit/src` (absolute path) | Comma-separated list of directories to watch; overrides the default path |
| `PI_WEB_AUTOSTART=1` | off | Automatically creates a session on the home page and skips the source-selection page; injected automatically at startup by both the CLI (`bin/pi-web.mjs`) and the desktop shell (`server_supervisor.rs:88`) |
| `PI_WEB_WATCH=1` | off | Written by the CLI `--watch` mode; also enables hot reload under the production single-file bundle (not gated by `NODE_ENV`) |
| `PI_WEB_DEV_CLIENT_PORT` | `5173` | Vite dev server port (`vite.config.ts:73`) |
| `PI_WEB_DEV_API_PORT` | `3000` | The backend port the Vite dev proxy targets for `/api` (`vite.config.ts:78`) |
| `PI_WEB_DIST_DIR` | `dist` | Overrides the dist directory the CLI launches (`bin/pi-web.mjs:226`); once set, `resolveRuntime` uses that directory directly and **skips first-launch unpacking of the bundled payload** (for isolated builds / e2e); see [18 · CLI](./18-cli.md) |

> The build output is Vite (`dist/client`) + an esbuild single file (`dist/server.mjs`) — there is no `.next` directory and no `NEXT_DIST_DIR` (that variable has been removed from main). e2e isolation relies on `PI_WEB_STUB_AGENT=1` plus a separate output directory, no longer on changing the build output directory.

```bash
# Offline run (stub agent, consumes no key): just start the dev server
PI_WEB_STUB_AGENT=1 pnpm dev

# Or run the production single-file bundle
pnpm build:dist
PI_WEB_STUB_AGENT=1 node dist/server.mjs

# Dev-time hot reload (edit tool-kit/src without reopening a session)
PI_RUNNER_HOT_RELOAD=1 pnpm dev
```

> Unlike the Next era, the Vite + esbuild pipeline has **no shared `.next` pollution** problem: running `pnpm build:dist` while the dev server is up writes to a separate `dist/` and does not interrupt development. For build pipeline details, see [22 · Development and Testing](./22-development-and-testing.md).

---

### 8. Session store

| Variable | Default | Description |
|---|---|---|
| `SESSION_STORE` | `fs` | Session persistence backend: `fs` (file) / `sqlite` / `postgres` (falls back to `fs` when unset or empty) |
| `SESSION_STORE_ROOT` | `~/.pi/agent/sessions` | Storage root directory for `fs` mode (default produced by `defaultSessionsRoot()`); session files are bucketed under the root by working directory `cwd` |
| `SESSION_STORE_PATH` | `:memory:` | Database path for `sqlite` mode |
| `DATABASE_URL` | (unset) | Connection string for `postgres` mode (required when `SESSION_STORE=postgres`) |

```bash
SESSION_STORE=sqlite
SESSION_STORE_PATH=/data/pi-web-sessions.db
```

---

### 9. Sessions List view (sessions-list)

The visibility and placement of the Sessions List panel are controlled by the `NEXT_PUBLIC_PI_WEB_SESSIONS_*` variables. As described in "Runtime Gating" above, they are **no longer inlined at build time**: the frontend gets its gating from `GET /api/bootstrap`, while the backend reads the same variable names directly from `process.env` for authoritative decisions, and both ends read the same process env.

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` | (unset, off) | When set to `true` / `1`, shows the "All" (system / cross-machine) sessions tab; when off, the backend returns `403 SESSIONS_GLOBAL_DISABLED` for `scope=all` directly, without touching storage |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE` | (unset, **on by default**) | Gate for session write operations (delete / rename / favorite); when set to `false` / `0` the write endpoints return `403` without touching storage, and the frontend hides the write entry points |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` | `sidebar` | The host slot for the Sessions List panel: `sidebar` / `header` / `footer` / `empty`; invalid values fall back to `sidebar` |

> The backend gating is in `lib/app/pi-handler.ts:464-478` (`scope=all` and write-operation decisions); the frontend gating fields are in `lib/app/runtime-features.ts:59-64`. See [14 · Sessions List](./14-sessions-list.md) for the complete explanation.

```bash
# Enable the system sessions view and move the list to the header
NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=1
NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT=header
```

---

### 9b. Agent Source List (agent-sources-list)

Beyond typing a source, the new-session picker (`AgentSourcePicker`) can show a **browsable list of available agent sources** (`GET /agent-sources`). Data comes from two merged, deduplicated channels: a directory scan ∪ a registry file (see [24 · HTTP API](./24-http-api-reference.md) and the implementation `packages/server/src/agent-source-list/`). The endpoint is strictly read-only: no writes, no clone, no resolve/spawn.

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` | (unset, off) | **Frontend gate** (emitted via `/api/bootstrap`). When `true` / `1`, the picker shows the source list; when off, only the text input is shown |
| `PI_WEB_SOURCES_ROOT` | `~/.pi-web/agents` | Directory scan roots, `path.delimiter`-separated (`:` / `;`); relative paths resolve against `PI_WEB_DEFAULT_CWD`. Scans each root's first-level subdirectories: with an `index.[jt]s` entry → `custom`, otherwise → `cli`. Setting it **fully replaces** the default root (override, not append); a missing default root is silently skipped |
| `PI_WEB_SOURCES_REGISTRY` | `<agentDir>/sources.json` | Registry JSON path (read only if present). Shape: `{ "sources": [ { "source", "name?", "description?" } ] }`. Missing or corrupt files degrade gracefully (returns the remaining available sources) |

> Two-sided consistency: with `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` off the frontend renders no list; when the default root `~/.pi-web/agents` is absent and no registry file exists, the backend returns an empty list. Together they present as "nothing to browse," and the text input always remains as a fallback. Assembly in `lib/app/pi-handler.ts` (`createAgentSourcesRoutes`).
>
> Note: the default root lets the backend *discover* sources, but the frontend is still gated by `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` (emitted via `/api/bootstrap`). Both sides must be on for agents under `~/.pi-web/agents` to actually appear.

```bash
# Enable the source list and use the examples directory as a scan root
NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1
PI_WEB_SOURCES_ROOT=/abs/path/to/examples
PI_WEB_SOURCES_REGISTRY=/abs/path/to/sources.json
```

---

### 9c. Sidebar Launcher Rail (sidebar-launcher-rail)

Renders a fixed launcher rail above the sidebar session list: session-history search, a fixed new-chat entry, one-click launch anchors for favorite agent sources, and a webext contribution slot (`launcherRail` SlotKey, see [12 · Web UI Extension](./12-web-ui-extension.md)).

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL` | (unset, off) | **Frontend gate** (emitted via `/api/bootstrap`). When `true` / `1`, the sidebar renders the launcher rail |

> **The gate is not the only trigger**: when the loaded source declares a `launcherRail` contribution, the launcher rail (including that contribution slot) still renders even if this global gate is off (`components/chat-app.tsx:787-790`, "a source declaration is intent, no global gate required"). Favorites are read/written via `GET·PUT /api/agent-sources/favorites` (persisted at `<agentDir>/agent-source-favorites.json`). Search reuses `GET /sessions?q=` (name substring).

```bash
# Enable the sidebar launcher rail (usually together with the source list)
NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL=1
NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1
PI_WEB_SOURCES_ROOT=/abs/path/to/examples
```

---

### 9d. Canvas Gate (canvas)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_CANVAS` | (unset, off) | **Deprecated forced override**. When `true` / `1`, forces the Canvas workbench panel on |

> **Deprecation note** (`packages/canvas-ui/src/canvas-launcher.tsx:30-38`): Canvas panel visibility is now **driven by source declaration** — the panel shows when an agent source mounts a canvas slot contribution, and no longer depends on this env gate. `isCanvasEnabled()` and `NEXT_PUBLIC_PI_WEB_CANVAS` are retained only for backward compatibility / as an optional forced override. For the Canvas workbench editor, generation actions, and gallery, see [16 · Canvas Workbench](./16-canvas-workbench.md).

---

### 10. Vision recognition model

| Variable | Default | Description |
|---|---|---|
| `PI_WEB_VISION_MODEL` | (unset; chosen at runtime via modelRegistry) | Default vision model for the `image_vision` tool / `/img_vision` command, **in the format `provider/modelId`** (e.g. `openrouter/google/gemini-2.5-flash`). Note this differs from the bare-id format of image-generation models and must not be mixed up |

> Defined in `packages/tool-kit/src/vision/types.ts:104-109` (`VISION_MODEL_ENV = "PI_WEB_VISION_MODEL"`). For the semantics of the vision tools, see [11 · AIGC and Vision Tools](./11-aigc-and-vision-tools.md).

---

### 11. Logging

Logging is handled by the isomorphic package `packages/logger`, which parses the following env config (parsing logic in `packages/logger/src/config.ts`); the client and server share the same variable names.

| Variable | Default | Description |
|---|---|---|
| `PI_WEB_LOG_ENABLED` | (unset = off) | **Logging is off by default**; set to any non-`false` value (e.g. `1`/`true`) to force-enable server-side log gating (no Settings needed); set to `false` to explicitly disable |
| `PI_WEB_LOG_LEVEL` | `info` | Log level: `debug` / `info` / `warn` / `error` |
| `PI_WEB_LOG_NAMESPACES` | (all) | Comma-separated namespace allowlist (e.g. `agent,ext`); only the listed namespaces are enabled |
| `PI_WEB_LOG_FILE` | (unset, no file written) | Absolute path of the log file; setting it enables file output |
| `PI_WEB_LOG_FILE_MAXSIZE` | `10` | Per-file rotation threshold (MB) |
| `PI_WEB_LOG_FILE_MAXFILES` | `5` | Maximum number of rotated backup files |

```bash
PI_WEB_LOG_LEVEL=debug
PI_WEB_LOG_NAMESPACES=agent,ext
PI_WEB_LOG_FILE=/var/log/pi-web/app.log
```

> For the level semantics, namespace layering, and the Node/browser differences of the logging system, see [21 · Logging](./21-logging.md).

---

### 12. Bang Shell Commands (off by default)

Bang (`!`) shell commands let you run a shell command straight from the chat input: `!cmd` executes and feeds the output into the LLM context; `!!cmd` executes but keeps the output out of context. **This is equivalent to arbitrary command execution (RCE) on the server host. It is off by default and should only be enabled in trusted single-user / controlled environments.** Enabling requires setting both variables below (deliberately split: the server side is the authoritative security gate, the frontend is experience-only):

| Variable | Default | Description |
|---|---|---|
| `PI_WEB_BASH_ENABLED` | (unset = off) | **Server-authoritative gate** (server-only). Set to any non-`false`/`0` value (e.g. `1`/`true`) to enable the `POST /sessions/:id/bash` endpoint; when off the endpoint returns 404 (without leaking its existence). Even if the frontend switch is bypassed, execution is refused while this is off |
| `NEXT_PUBLIC_PI_WEB_BASH_ENABLED` | (unset = off) | **Frontend experience switch** (emitted via `/api/bootstrap`). When `1`/`true`, the chat input recognizes the `!`/`!!` prefix and shows the bash-mode hint; when off, `!` text is sent to the LLM as a normal message |

> Both must be on for full functionality; frontend-on/backend-off → endpoint 404 (frontend shows an error card); frontend-off → `!` falls back to a normal message. The switch is **not exposed in the Settings UI** (it is a deployment-level security switch, controlled only via env). For the security risk and hardening guidance, see [19 · Deployment](./19-deployment.md).

---

## Desktop (Tauri) specific environment variables

The desktop shell (`desktop/src-tauri`, Tauri v2) is pi-web's second delivery form, and it spawns **the same** `dist/server.mjs` backend. In the desktop scenario there is a set of env vars the shell itself reads or injects (see [20 · Desktop (Tauri)](./20-desktop-tauri.md)).

| Variable | Default | Description |
|---|---|---|
| `PI_WEB_DESKTOP_PORT` | built-in starting port | Backend starting port (`desktop/src-tauri/src/main.rs:47-52`, incremented if occupied) |
| `PI_WEB_DESKTOP_DEV_URL` | (unset) | When non-empty and not packaged, loads this dev URL and **does not launch the backend** (dev mode); in the packaged state it is force-ignored even if set (`runtime_mode.rs:13`) |
| `PI_WEB_DESKTOP_SERVER_JS` | the `server.mjs` unpacked from the bundle | Overrides the backend entry (`resolve_artifact.rs:22`) |
| `PI_WEB_DESKTOP_STUB_PICK_DIR` | (unset) | e2e stub: when non-empty, the directory-selection dialog returns this path directly without opening (`dialog.rs:21`) |
| `PI_WEB_RUNTIME_ROOT` | `~/.pi/web/runtime` | Root for first-launch unpacking of the shared runtime (`src/runtime/unpack.src.mjs:144-148`); actual files land under `<root>/<version>-<digest>/` |

**Env the shell injects into the backend subprocess** (`desktop/src-tauri/src/server_supervisor.rs:75-95`):

- Injects `PORT` / `HOSTNAME` / `PI_WEB_AUTOSTART=1` / `PI_WEB_NODE_BIN` (the absolute path of the bundled node, reused by the pi runner grandchild process).
- **Deliberately does not inject `PI_WEB_AGENT_DIR`** (Req 5.5): so the desktop version's sessions default to `~/.pi/agent`, sharing the same agent directory as the CLI; it is passed through only when the user has explicitly set it in the outer env.

---

## `~/.pi/agent` directory structure and priority

```
~/.pi/agent/
├── auth.json        # API key / OAuth token (written by pi login)
├── settings.json    # default provider / model, installed packages, theme
├── models.json      # custom provider model list (non-built-in providers go through this file)
├── aigc.json        # AIGC image tool settings (disabledModels / enablePromptOptimization)
├── attachments/     # default attachment persistence directory (when PI_WEB_ATTACHMENT_DIR is unset)
└── sessions/        # session history (when SESSION_STORE=fs)
```

**Priority rules:**

1. `auth.json` — read directly by the agent process; env keys (`ANTHROPIC_API_KEY`, etc.) are layered on top of it.
2. `settings.json` — read by the agent process; `PI_WEB_DEFAULT_PROVIDER` / `PI_WEB_DEFAULT_MODEL` can override at the env layer.
3. `models.json` — model registration for non-built-in providers; the format must include `baseUrl` + `apiKey`, and setting the `api` field to `openai-completions` lets you connect to gateways such as NewAPI.
4. `PI_WEB_AGENT_DIR` / `PI_CODING_AGENT_DIR` — pointing them at different directories enables multi-tenant isolation.

### aigc config domain (`aigc.json`)

AIGC image tool settings land in `~/.pi/agent/aigc.json`, read by `aigcExtension` at assembly time (schema in `packages/protocol/src/config/domains/aigc.ts:19-45`):

| Field | Type | Default | Description |
|---|---|---|---|
| `disabledModels` | `string[]` | `[]` | List of disabled image model ids. Toggle them via the settings page's custom widget `aigcModelToggles`: **unchecking disables** — a disabled model is no longer exposed to the LLM enumeration and no longer appears in the picker. Changes take effect **on the next session / after reload** |
| `enablePromptOptimization` | `boolean` | `false` | Optimize the description into a prompt before generation (**currently a placeholder seam, no rewriting**) |

```jsonc
// ~/.pi/agent/aigc.json — disable two models, turn off prompt optimization
{
  "disabledModels": ["gpt-5-image-mini", "gemini-2.5-flash-image"],
  "enablePromptOptimization": false
}
```

> The schema-driven settings UI for this config domain (the `aigcModelToggles` widget + the `GET /api/aigc/models` data endpoint) is covered in [13 · Config UI](./13-config-ui.md); how disabled models are removed from both the LLM enumeration and the emitted list from a single source is covered in [11 · AIGC and Vision Tools](./11-aigc-and-vision-tools.md).

---

## Minimal `.env.local` example

```dotenv
# Simplest: rely on the key already present in ~/.pi/agent/auth.json
# No need to set any ANTHROPIC_API_KEY or similar

# If you need to force a model (optional)
PI_WEB_DEFAULT_PROVIDER=openrouter
PI_WEB_DEFAULT_MODEL=anthropic/claude-sonnet-4.6

# Attachment system (recommended to set explicitly when enabling attachments)
PI_WEB_ATTACHMENT_DIR=/data/my-attachments
PI_WEB_ATTACHMENT_SECRET=stable-secret-at-least-32-chars-here
```

---

## Next Steps / Related

- [01 · Quickstart](./01-quickstart.md) — `pnpm dev` dual-process orchestration and ports
- [07 · Providers and Models](./07-providers-and-models.md) — custom providers and the models.json format
- [11 · AIGC and Vision Tools](./11-aigc-and-vision-tools.md) — AIGC provider keys, `PI_WEB_VISION_MODEL`, aigc config domain semantics
- [13 · Config UI](./13-config-ui.md) — the frontend settings page and the aigc/logging schema-driven UI
- [14 · Sessions List](./14-sessions-list.md) — the system sessions view toggle and its placement
- [18 · CLI](./18-cli.md) — `pi-web` command-line arguments, `PI_WEB_DIST_DIR`, and first-launch unpacking
- [19 · Deployment](./19-deployment.md) — the production single-file bundle, CSP hardening, and Bang security
- [20 · Desktop (Tauri)](./20-desktop-tauri.md) — desktop-specific env and the shared runtime
- [21 · Logging](./21-logging.md) — logging level environment variables
- [22 · Development and Testing](./22-development-and-testing.md) — build pipeline and e2e isolation
