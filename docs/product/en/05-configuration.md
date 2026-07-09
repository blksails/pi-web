# 05 · Configuration Reference

pi-web is fully configured through two paths: the `.env.local` file and the `~/.pi/agent` directory. This chapter documents the purpose, default value, and an example for every variable.

---

## Getting Started

1. Copy the example file:

   ```bash
   cp .env.local.example .env.local
   ```

2. Fill in variables as needed. By default `.env.local.example` only lists credentials and session defaults; add the remaining variables (attachments, session store, hot reload, etc.) manually as needed. For the full list, see [Full Variable Table](#full-variable-table) below.

3. Start the dev server:

   ```bash
   pnpm dev
   ```

   **Expected result**: Next.js listens on http://localhost:3000 (the default `next dev` port); opening it in the browser lands you on the source-selection page.

If you have already logged in with `pi`, your API key is already present in `~/.pi/agent/auth.json`, so **you do not need to set any provider key** and can skip step 2 entirely and start directly. If the page reports an authentication error after startup, see [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md).

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

Authentication source priority: `env key` (additive) > `~/.pi/agent/auth.json` (read by the agent process).

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

The implementation lives in `packages/server/src/config/model-options-filter.ts` (exports `parseHiddenProviders` / `excludeProviders`) and `lib/app/pi-handler.ts:338` (the `/config/models` route calls `parseHiddenProviders` + `excludeProviders`); the in-session `get_available_models` RPC applies the same filter (`packages/server/src/http/routes/query-routes.ts:113`), keeping the dropdown and the runtime-selectable set consistent. The frontend fetches data via `GET /api/config/models`. See [06 · Providers and Models](./06-providers-and-models.md#42-hiding-specific-providers) for details.

---

### 5. Default agent source / working directory

| Variable | Default | Description |
|---|---|---|
| `PI_WEB_DEFAULT_SOURCE` | (unset) | Default value on the source-selection page; a local directory or git URL are both accepted |
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
| `PI_WEB_AUTOSTART=1` | off | Automatically creates a session on the home page and skips the source-selection page; injected automatically when the CLI (`bin/pi-web.mjs`) starts |
| `PI_WEB_WATCH=1` | off | Written by the CLI `--watch` mode; also enables hot reload under production standalone (not gated by `NODE_ENV`) |
| `NEXT_DIST_DIR` | `.next` | Specifies the Next.js build output directory; the CLI build uses `.next-cli` and the e2e build uses `.next-e2e` to avoid polluting the shared `.next` |

```bash
# Offline e2e run
PI_WEB_STUB_AGENT=1 NEXT_DIST_DIR=.next-e2e pnpm build
PI_WEB_STUB_AGENT=1 NEXT_DIST_DIR=.next-e2e next start -p 3100

# Dev-time hot reload (edit tool-kit/src without reopening a session)
PI_RUNNER_HOT_RELOAD=1 pnpm dev
```

> **Note**: Do not run `pnpm build` while the dev server is running, as it pollutes the shared `.next` and causes route webpack 500 errors. The CLI / e2e builds are isolated via `NEXT_DIST_DIR`. If you hit such a 500, see [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md).

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

The visibility and placement of the Sessions List panel are controlled by two `NEXT_PUBLIC_*` variables. `NEXT_PUBLIC_*` variables are inlined into the client bundle at build time and are **readable on both ends** (the frontend reads them to decide rendering, the backend reads them to gate `scope=all` requests), so be sure to keep their values consistent across both ends.

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` | (unset, off) | When set to `true` / `1`, shows the "All" (system / cross-machine) sessions tab; when off, the backend returns `403 SESSIONS_GLOBAL_DISABLED` for `scope=all` directly, without touching storage |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` | `sidebar` | The host slot for the Sessions List panel: `sidebar` / `header` / `footer` / `empty`; invalid values fall back to `sidebar` |

> The frontend read logic is in `components/chat-app.tsx:172` (`SESSIONS_GLOBAL_ENABLED`) and `components/chat-app.tsx:184` (`SESSIONS_SLOT`); the backend gating is in `packages/server/src/session-list/session-list-routes.ts:136` (`scope=all && !globalEnabled` → 403). See [21 · Sessions List](./21-sessions-list.md) for the complete explanation.

```bash
# Enable the system sessions view and move the list to the header
NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=1
NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT=header
```

---

### 9b. Agent Source List (agent-sources-list)

Beyond typing a source, the new-session picker (`AgentSourcePicker`) can show a **browsable list of available agent sources** (`GET /agent-sources`). Data comes from two merged, deduplicated channels: a directory scan ∪ a registry file (see [13 · HTTP API](13-http-api-reference.md) and the implementation `packages/server/src/agent-source-list/`). The endpoint is strictly read-only: no writes, no clone, no resolve/spawn.

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` | (unset, off) | **Frontend gate** (build-time inlined). When `true` / `1`, the picker shows the source list; when off, only the text input is shown |
| `PI_WEB_SOURCES_ROOT` | `~/.pi-web/agents` | Directory scan roots, `path.delimiter`-separated (`:` / `;`); relative paths resolve against `PI_WEB_DEFAULT_CWD`. Scans each root's first-level subdirectories: with an `index.[jt]s` entry → `custom`, otherwise → `cli`. Setting it **fully replaces** the default root (override, not append); a missing default root is silently skipped |
| `PI_WEB_SOURCES_REGISTRY` | `<agentDir>/sources.json` | Registry JSON path (read only if present). Shape: `{ "sources": [ { "source", "name?", "description?" } ] }`. Missing or corrupt files degrade gracefully (returns the remaining available sources) |

> Two-sided consistency: with `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` off the frontend renders no list; when the default root `~/.pi-web/agents` is absent and no registry file exists, the backend returns an empty list. Together they present as "nothing to browse," and the text input always remains as a fallback. Frontend gate read in `components/chat-app.tsx` (`SOURCE_PICKER_ENABLED`); assembly in `lib/app/pi-handler.ts` (`createAgentSourcesRoutes`).
>
> Note: the default root lets the backend *discover* sources, but the frontend is still gated by `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` (build-time inlined). Both sides must be on for agents under `~/.pi-web/agents` to actually appear.

```bash
# Enable the source list and use the examples directory as a scan root
NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1
PI_WEB_SOURCES_ROOT=/abs/path/to/examples
PI_WEB_SOURCES_REGISTRY=/abs/path/to/sources.json
```

---

### 9c. Sidebar Launcher Rail (sidebar-launcher-rail)

Renders a fixed launcher rail above the sidebar session list: session search, a fixed new-chat entry, one-click launch anchors for favorite agent sources, and a webext contribution slot (`launcherRail` SlotKey, see [10 · Web UI Extension](10-web-ui-extension.md)).

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL` | (unset, off) | **Frontend gate** (build-time inlined). When `true` / `1`, the sidebar renders the launcher rail; when off, the sidebar shows only the existing session list (unchanged) |

> Favorites are read/written via `GET·PUT /api/agent-sources/favorites` (persisted at `<agentDir>/agent-source-favorites.json`), independent of the read-only source enumeration. Users favorite a source by clicking the star on a source-list item in the picker (`AgentSourcePicker`). Search reuses `GET /sessions?q=` (name substring, backward compatible). Frontend gate read in `components/chat-app.tsx` (`LAUNCHER_RAIL_ENABLED`).

```bash
# Enable the sidebar launcher rail (usually together with the source list)
NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL=1
NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1
PI_WEB_SOURCES_ROOT=/abs/path/to/examples
```

---

### 10. Logging

Logging is handled by the isomorphic package `packages/logger`, which parses the following env config (parsing logic in `packages/logger/src/config.ts:48`); the client and server share the same variable names.

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

> For the level semantics, namespace layering, and the Node/browser differences of the logging system, see [16 · Logging](./16-logging.md).

### 11. Bang Shell Commands (off by default)

Bang (`!`) shell commands let you run a shell command straight from the chat input: `!cmd` executes and feeds the output into the LLM context; `!!cmd` executes but keeps the output out of context. **This is equivalent to arbitrary command execution (RCE) on the server host. It is off by default and should only be enabled in trusted single-user / controlled environments.** Enabling requires setting both variables below (deliberately split: the server side is the authoritative security gate, the frontend is experience-only):

| Variable | Default | Description |
|---|---|---|
| `PI_WEB_BASH_ENABLED` | (unset = off) | **Server-authoritative gate** (server-only). Set to any non-`false`/`0` value (e.g. `1`/`true`) to enable the `POST /sessions/:id/bash` endpoint; when off the endpoint returns 404 (without leaking its existence). Even if the frontend switch is bypassed, execution is refused while this is off |
| `NEXT_PUBLIC_PI_WEB_BASH_ENABLED` | (unset = off) | **Frontend experience switch** (build-time inlined). When `1`/`true`, the chat input recognizes the `!`/`!!` prefix and shows the bash-mode hint; when off, `!` text is sent to the LLM as a normal message |

> Both must be on for full functionality; frontend-on/backend-off → endpoint 404 (frontend shows an error card); frontend-off → `!` falls back to a normal message. The switch is **not exposed in the Settings UI** (deployment-level security switch, controlled only via env). See [15 · Deployment](./15-deployment.md) §15.6 for the security risk and hardening guidance.

---

## `~/.pi/agent` directory structure and priority

```
~/.pi/agent/
├── auth.json        # API key / OAuth token (written by pi login)
├── settings.json    # default provider / model, installed packages, theme
├── models.json      # custom provider model list (non-built-in providers go through this file)
├── attachments/     # default attachment persistence directory (when PI_WEB_ATTACHMENT_DIR is unset)
└── sessions/        # session history (when SESSION_STORE=fs)
```

**Priority rules:**

1. `auth.json` — read directly by the agent process; env keys (`ANTHROPIC_API_KEY`, etc.) are layered on top of it.
2. `settings.json` — read by the agent process; `PI_WEB_DEFAULT_PROVIDER` / `PI_WEB_DEFAULT_MODEL` can override at the env layer.
3. `models.json` — model registration for non-built-in providers; the format must include `baseUrl` + `apiKey`, and setting the `api` field to `openai-completions` lets you connect to gateways such as NewAPI.
4. `PI_WEB_AGENT_DIR` / `PI_CODING_AGENT_DIR` — pointing them at different directories enables multi-tenant isolation.

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

- [06 · Providers and Models](./06-providers-and-models.md) — custom providers and the models.json format
- [12 · Config UI](./12-config-ui.md) — the frontend settings page and the rendering mechanism of the provider/model dropdown
- [14 · CLI](./14-cli.md) — `pi-web` command-line arguments and `--watch` hot reload
- [16 · Logging](./16-logging.md) — logging level environment variables
- [17 · Development and Testing](./17-development-and-testing.md) — e2e isolated-build conventions
- [21 · Sessions List](./21-sessions-list.md) — the system sessions view toggle and its placement
