# 16 · Logging System

> This feature is already merged into main (spec `.kiro/specs/logging-system`, phase=implemented, all tasks checked off, including isolated-build E2E).

The logging system provides unified structured logging for pi-web's three component types — agent source, pi extension, and webext — aggregating from subprocess stderr into the main process, pushing in real time to the browser logs panel via the session stream, and supporting on-demand history retrieval.

---

## Architecture Overview

```
agent source / pi extension (Node subprocess)
  └─ createLogger() → nodeSink → stderr (prefixed with LOG_SENTINEL)
                                        │
                               main process parseLogLine parses
                                        │
                               PiSession per-session ring buffer (LogRingBuffer)
                                        │
                               control:logs SSE frame ──► browser
                                        │
                              LogsStore (merge/dedupe entries from three sources)
                                        │
                   kernel PiChat renders LogsPanel by panelPosition
                   (bottom / right / drawer, with webext logs slot alongside)

webext (browser)
  └─ createLogger() → browserSink → in-memory ring buffer (2000 entries) → LogsStore
```

Three core paths:

1. **Node subprocess** — `nodeSink` serializes each `LogEntry` to JSON and writes it to stderr prefixed with `LOG_SENTINEL` (`\x02PILOG\x03 `); the main process `parseLogLine` recognizes the prefix, deserializes the entry, and routes it to the corresponding `PiSession`.
2. **Browser webext** — `browserSink` writes entries into an in-memory ring buffer (`BROWSER_LOG_CAPACITY = 2000`); subscribers (`LogsStore`) update their state once notified.
3. **Isomorphic `@blksails/logger` package** — zero runtime dependencies, no static Node module references, safe to import on both the Node and browser sides.

---

## The `@blksails/logger` Package

**Package name**: `@blksails/logger`  
**Location**: `packages/logger/`

### Core API

```typescript
import { createLogger, configureLogger, initConfigFromEnv } from "@blksails/logger";

// Create a logger (Node subprocess side)
const logger = createLogger({ namespace: "agent:hello", level: "debug" });
logger.info("started", { version: "1.0" });
logger.debug("tool called", { toolName: "search" });

// Derive a child logger (namespace becomes "agent:hello:tool")
const toolLogger = logger.child("tool");
toolLogger.warn("rate limit approaching");

// Initialize config from environment variables at Node service startup (one-time)
initConfigFromEnv();
```

### Type Definitions

| Type | Description |
|------|------|
| `LogLevel` | `"debug" \| "info" \| "warn" \| "error"` |
| `LogEntry` | `{ id?, level, ns, msg, data?, ts }` |
| `Logger` | `{ debug, info, warn, error, child }` |
| `LoggerRuntimeConfig` | `{ enabled, level, namespaces? }` |
| `Sink` | `(entry: LogEntry) => void` |

### Three-Level Gating (inside createLogger)

`createLogger` applies the following to each logging call in order:

1. **enabled gate** — globally discards when `LoggerRuntimeConfig.enabled` is `false`
2. **level gate** — takes the stricter of the per-logger static level and the runtime global level
3. **namespace gate** — discards when the namespace is explicitly disabled

Gating takes effect immediately — no need to rebuild the logger instance: `configureLogger(partial)` mutates the module-level singleton, and the next call automatically reads the new config.

### Node Sink: stderr sentinel

```typescript
// packages/logger/src/node-sink.ts
export const LOG_SENTINEL = "\x02PILOG\x03 ";
// Per-line format: LOG_SENTINEL + JSON.stringify(entry) + "\n"
```

The main process parses with `parseLogLine` (`packages/protocol/src/logging/log-entry.ts`): it uses `LOG_SENTINEL` as the recognition marker, and stderr output that does not match (such as native Node diagnostics) is wrapped as a raw log entry, without interfering with RPC protocol message routing.

### Browser Sink: in-memory ring buffer

```typescript
// packages/logger/src/browser-sink.ts
export const BROWSER_LOG_CAPACITY = 2000; // max entries in the ring buffer
```

When over capacity, the oldest entry is evicted; subscribers register a callback via `subscribeBrowserLogs(cb)`, which returns an unsubscribe function.

### File Output (P1)

Enabled via env variables or `configureFileOutput()`:

```bash
PI_WEB_LOG_FILE=/var/log/pi-web/app.log
PI_WEB_LOG_FILE_MAXSIZE=10    # MB, default 10
PI_WEB_LOG_FILE_MAXFILES=5    # number of rotated backups, default 5
```

Rotation strategy: `app.log` → `app.log.1` → `app.log.2` … → `app.log.N`, with backups exceeding `maxFiles` deleted automatically. On the Node side, `fs` access is injected through `globalThis.__PI_WEB_FS__` (preset by the server-side runner bootstrap); in the browser environment this seam does not exist, so the file sink becomes a no-op, preserving isomorphic safety.

---

## Environment Variable Reference

| Variable | Default | Description |
|------|--------|------|
| `PI_WEB_LOG_ENABLED` | (unset = off) | **Logging is off by default.** Set to any non-`false` value (e.g. `1`/`true`) to force-enable server-side log gating without going through Settings; set to `false` to explicitly disable. |
| `PI_WEB_LOG_LEVEL` | `info` | Global minimum level: `debug / info / warn / error` (gating default when unconfigured) |
| `PI_WEB_LOG_NAMESPACES` | —— | Comma-separated; enables the specified namespaces, e.g. `agent:hello,ext:probe` |
| `PI_WEB_LOG_FILE` | —— | Absolute path of the log file (setting it enables file output) |
| `PI_WEB_LOG_FILE_MAXSIZE` | `10` | Max MB per file |
| `PI_WEB_LOG_FILE_MAXFILES` | `5` | Number of rotated backups to keep |

---

## Using It in an Agent Source

The runner injects a namespace-bound Logger into the agent source via `AgentContext.logger`:

```typescript
// examples/logging-demo-agent/index.ts (excerpt)
import type { AgentContext, AgentDefinition } from "@blksails/pi-web-agent-kit";
import { defineAgent } from "@blksails/pi-web-agent-kit";

export default function (ctx: AgentContext): AgentDefinition {
  const logger = ctx.logger;                        // injected by the runner; namespace taken from the agent source directory name

  if (logger !== undefined) {
    logger.debug("factory invoked", { cwd: ctx.cwd });
    logger.info("started", { env: Object.keys(ctx.env).length });
    logger.warn("this is a sample warn");
    logger.error("this is a sample error (not a real error)");

    const childLogger = logger.child("tool");       // namespace: <agent>:tool
    childLogger.info("child logger created with namespace :tool");
  }

  return defineAgent({ systemPrompt: "..." });
}
```

A pi extension can reference this package directly, without depending on the pi SDK:

```typescript
// .pi/extensions/my-ext.ts
import { createLogger } from "@blksails/logger";
const log = createLogger({ namespace: "ext:my-ext" });
log.info("extension loaded");
```

---

## Server Side: Authoritative Gating

> The design calls this "server-side authoritative gating" (design.md / task 4.4): changing enabled/level/namespaces in Settings affects not only the browser — Node subprocess logs are also filtered again by the server before they "enter the ring buffer / produce a frame," ensuring that the Node logs of agents and extensions are likewise controlled.

> **Off by default**: when no logging config has been saved in Settings (no `logging.json`), `loggingConfigProvider` uses the result of `resolveLoggingEnvDefault()` (`lib/app/logging-default.ts`) — `enabled` defaults to `false`, and only force-enables when `PI_WEB_LOG_ENABLED` is present and not `"false"` (level/namespaces likewise come from `PI_WEB_LOG_*`). Note: the subprocess logger still emits to stderr per its library default; visibility is decided by this server-side gating — so by default the agent/extension logs are dropped by the gate and never reach the panel.

```
runner bootstrap        — initConfigFromEnv() reads PI_WEB_LOG_* env (packages/server/src/runner/runner.ts)
        │
PiSession.handleStderr  — loads the logging config via loggingConfigProvider at session start (ConfigCodec.load("logging"))
        │                  buffers chunks before the config is ready, replays them once ready
        ▼
PiSession.processStderrChunk — filters entry by entry per the gates, ingests into LogRingBuffer, then merges into a control:logs frame to broadcast
```

1. **runner bootstrap** — at runner startup, `initConfigFromEnv()` is called to initialize the Node-side logger config from `PI_WEB_LOG_*` env (`packages/server/src/runner/runner.ts:199`).
2. **PiSession gating** — `handleStderr` loads the logging config via the injected `loggingConfigProvider` when the session activates; before the config is ready it buffers the stderr chunks, then replays and filters them once ready.
3. **Per-entry filtering + ingest** — `processStderrChunk` applies `gate.enabled` / `isLevelEnabled` / `isNamespaceEnabled` (from `@blksails/logger`) to each `LogEntry` in turn; those that pass are assigned an id by `LogRingBuffer.ingest` into the per-session ring buffer, then merged into a `control:logs` frame to broadcast (`packages/server/src/session/pi-session.ts`).
4. **SSE backfill** — when a browser subscription is established, `PiSession` first backfills the existing ring buffer entries as a single `control:logs` frame (to avoid races on early logs), then pushes subsequent new entries in real time.

REST endpoint (history retrieval): `GET /api/sessions/[sessionId]/logs?level=info&limit=200&since=<ts>` (the internal handler routes `/sessions/:id/logs`, see `packages/server/src/http/routes/query-routes.ts`, returning `{ entries }`).

---

## Browser Side: LoggingConfigLoader

`LoggingConfigLoader` (`components/logging-config-loader.tsx`) fetches the logging config from the config API when the client mounts, calls `configureLogger()` to sync the browser-side gating, renders nothing (returns `null`), and handles failures silently. In this branch it is mounted inside `components/chat-app.tsx` (the PiChat shell), sharing the lifecycle of the session UI.

> **Off by default**: browser-side webext logs are off by default — the loader sets `enabled:true` only when the endpoint returns `values.enabled === true` (i.e. the user explicitly enabled it in Settings); when the config is absent or the endpoint is unreachable it always sets `enabled:false` rather than falling back to the library default. After saving in Settings, reload the page for the loader to re-fetch and take effect.

```tsx
// Mount once in the app shell (e.g. chat-app.tsx)
import { LoggingConfigLoader } from "@/components/logging-config-loader";

export default function ChatShell({ children }) {
  return (
    <>
      <LoggingConfigLoader />
      {children}
    </>
  );
}
```

Config source endpoint: `GET /api/config/logging`, returning `{ values: { enabled, level, namespaces } }`.

---

## The Logs Panel (LogsPanel)

The panel is rendered directly by the kernel `PiChat` (`packages/ui/src/chat/pi-chat.tsx`), not as a standalone slot. `PiChat` decides whether and where to mount the panel based on three props — `showLogs` / `logsPanelVisible` (corresponding to `outputs.panelVisible`) / `logsPanelPosition` (corresponding to `outputs.panelPosition`); each of the three positions renders a container marked with `data-pi-logs-region`:

| `panelPosition` | Render location | Behavior |
|-----------------|----------|------|
| `bottom` (default) | Below the input dock (`pi-chat.tsx:960`) | A horizontal panel stacked in the same column as the session usage bar |
| `right` | A standalone block inside the right-hand `aside` (`pi-chat.tsx:1112`) | Coexists with `panelRight` / artifact in the same aside |
| `drawer` | A fixed bottom overlay (`pi-chat.tsx:974`) | Toggled by the "Logs" button with `data-pi-logs-drawer-toggle`; a `fixed` drawer at `max-h-[40vh]` |

Alongside the kernel `LogsPanel` at each position there coexists a webext `logs` slot (`ExtSlotRegion slot="logs"`, `pi-chat.tsx:966 / 989 / 1117`): an extension's contributions to the `logs` slot render after the kernel panel with **append semantics** — the two coexist rather than replace each other. See `slots.logs` of the webext in `examples/*` for an example (wired in task 8.3).

Panel features (the filtering logic lives in `LogsStore`, `packages/react/src/logging/logs-store.ts`; the panel merely consumes its result):

- Filter by level (dropdown selecting `debug / info / warn / error`, with minimum-level semantics)
- Filter by namespace (colon-segmented prefix match, automatically including child namespaces, e.g. `agent:hello` matches `agent:hello:tool` but not `agentx:other`)
- Text search (**case-sensitive** substring match against `msg`, i.e. `e.msg.includes(filterText)`)
- Automatic history retrieval (mounting the panel triggers `fetchHistory`, hitting the REST endpoint above)

### Smart-follow (smart-follow + jump-to-unread)

Auto-scroll is implemented by `LogsPanel` itself (`packages/ui/src/logs/logs-panel.tsx`); its `handleScroll` determines bottom-pinning via `scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD` (`logs-panel.tsx:178`) — independent of the `use-auto-scroll.ts` hook used generally by the conversation area, which the panel does not reuse:

- **Pinned follow** — when at the bottom, a new entry arriving sets `ul.scrollTop = ul.scrollHeight` to keep following, and `unreadCount` is reset to zero (`logs-panel.tsx:157`).
- **Pause on scroll-up** — scrolling up away from the bottom pauses the follow; during the pause new entries accumulate as the unread count by positive increments, while entry reductions caused by filtering (negative increments) are not counted (`logs-panel.tsx:164`).
- **Jump-to-unread button** — when paused and `unreadCount > 0`, a `data-pi-logs-jump-latest` button floats at the bottom right of the panel, with the text `↓ N new logs`; clicking it returns to the bottom, resumes the follow, and resets unread to zero (`logs-panel.tsx:190 / 305`).

### Narrow-Column Adaptive Wrapping

`LogRow` uses an adaptive row layout (`logs-panel.tsx:81`): in a wide container the four columns — time / level / namespace / message — lay out on a single row; in a narrow container (such as the `right`-side column), the message column triggers `flex-wrap` via `min-w` 12rem to wrap onto a full-width row and break by word (`break-words`), avoiding fixed columns squeezing the message into a character-by-character vertical layout.

---

## Settings UI Config Domain

The logging system registers a `logging` config domain on the Settings page (`packages/protocol/src/config/domains/logging.ts`, with schema `loggingConfigSchema`), split into three groups:

| Group ID | Fields |
|-------|------|
| `general` | `enabled` (enable logging, the master switch, **default `false`**), `level` (global level, default `info`) |
| `components` | `namespaces` (per-namespace toggles, custom widget `logNamespaceToggles`) |
| `output` | `outputs` (nested object: `console` console, `file` file path/rotation, `panelVisible` panel visibility, `panelPosition` panel position), `panelDefaultLevel` (panel default level) |

> Note: the config domain's `enabled` defaults to `false` (logging is off by default; enable it here or set `PI_WEB_LOG_ENABLED`); `level` defaults to `info` (see the schema), whereas the Node-side library's `initConfigFromEnv` defaults internally to `debug` when `PI_WEB_LOG_LEVEL` is not read — these are default values at different layers.

---

## Quick Verification Steps

> For hands-on practice see [`examples/logging-demo-agent`](https://github.com/blksails/pi-web/tree/main/examples/logging-demo-agent/) (with its own README): it converges the three paths above — the agent-injected `ctx.logger`, the pi extension's direct `createLogger`, and the webext browser log bus — into a single logs panel, the fastest entry point for comparing logs from the three sources. The steps below operate on this example.

1. Start the dev server with logging enabled (**logging is off by default**; the env flag is the quickest way):

   ```bash
   PI_WEB_LOG_ENABLED=1 pnpm dev
   ```

   Or run `pnpm dev`, then go to Settings → Logging, turn on "Enable logging" and save (the browser side needs a reload, the Node side needs a new session to take effect).

2. Open pi-web in the browser, select `logging-demo-agent` (located at `examples/logging-demo-agent/`), and start a session.

3. Once the session is established, the logs panel should show the startup logs emitted by the demo agent during the factory phase: four main-namespace entries (`debug / info / warn / error`) plus one `info` entry from the child namespace `<agent>:tool`.

4. Verify env gating (force-enable, then raise the level):

   ```bash
   PI_WEB_LOG_ENABLED=1 PI_WEB_LOG_LEVEL=warn pnpm dev
   ```

   The `debug` and `info` entries should not appear in the panel.

6. Verify file output:

   ```bash
   PI_WEB_LOG_FILE=/tmp/pi-web.log pnpm dev
   tail -f /tmp/pi-web.log   # you should see JSONL-formatted log lines (one JSON.stringify(entry) per line, with no sentinel prefix)
   ```

**If the panel stays empty**, troubleshoot in the following order:

- **First confirm logging is enabled (off by default)**: "Enable logging" under Settings → Logging is `true` (after saving, reload the browser and start a new session for the Node side), or start with `PI_WEB_LOG_ENABLED=1`. When disabled, agent / extension / webext logs all stay out of the panel.
- Confirm the panel is not hidden or moved: `outputs.panelVisible` is `true` in Settings (otherwise it does not render even with `showLogs`), and when `outputs.panelPosition` is `drawer` the panel is collapsed by default — click the "Logs" button (`data-pi-logs-drawer-toggle`) to expand it.
- Confirm the level is not filtering entries out: `PI_WEB_LOG_LEVEL` is not higher than the lowest level the demo agent emits (the demo emits `debug`, so setting it to `warn` gates the two `debug/info` entries).
- The server-side gating is independent of the browser (see "Server Side: Authoritative Gating" above): raising the level via env filters out the lower-level entries before they "enter the ring buffer," so the panel never receives them.
- If there is still no output, see [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md).

---

## Protocol: SSE Log Control Frame

Logs are pushed over the existing SSE control-frame channel. The top-level SSE frame is discriminated by `kind`; logs travel on a `kind: "control"` frame, with the inner `payload.control` being `"logs"` (plural), distinguished from other control events (`extension-ui` / `queue` / `stats` / `error`) via the same `discriminatedUnion("control", …)` (`packages/protocol/src/transport/sse-frame.ts`). A single frame can carry multiple `entries`:

```jsonc
// SSE frame example (the product of makeControlFrame({ control: "logs", entries: [...] }))
data: {"kind":"control","protocolVersion":"0.1.0","payload":{"control":"logs","entries":[{"id":"seq-42","level":"info","ns":"agent:hello","msg":"started","ts":1719000000000}]}}
```

`parseLogLine` in `packages/protocol/src/logging/log-entry.ts` is responsible for the sentinel recognition of subprocess stderr lines and `LogEntrySchema` (zod) validation; on validation failure it returns `null`, which the main process silently ignores.

---

## Related Chapters

- [03 · System Architecture](./03-architecture.md) — the three-stage subprocess / main-process / browser structure
- [05 · Configuration](./05-configuration.md) — `PI_WEB_*` env variables and the Settings UI framework
- [07 · Agent Development](./07-agent-development.md) — `AgentContext.logger` injection
- [09 · Extensions and Skills](./09-extensions-and-skills.md) — referencing the logging library directly in a pi extension
- [17 · Development and Testing](./17-development-and-testing.md) — unit tests and isolated-build E2E
- [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md) — common log-related issues
