# 10 · Extensions, Skills & Prompt Templates

pi-web exposes pi's extension / skills / prompt-template capabilities to the Web side via **automatic resource discovery + two install lanes (agent-turn tools + controlled REST) + inline permission interactions**. This chapter covers resource auto-discovery and injection, the two install lanes and their governance pipeline, the trust policy, the extension UI sub-protocol, the slash-command palette, and the correct usage of the system-resource toggles.

---

## Resource Auto-Discovery and Injection

On every new session, the runner subprocess auto-discovers and loads resources. The SDK's (`@earendil-works/pi-coding-agent`) resource-loader looks up each resource type by the following directory conventions (priority **project > user > built-in**, with same-name override; `settings.json` only does enable/disable configuration and is not a registry):

| Resource type | User level (always loaded) | Project level (trusted only) |
|---------|------------------|---------------------|
| extensions | `~/.pi/agent/extensions/` | `<cwd>/.pi/extensions/` |
| skills | `~/.pi/agent/skills/` (three-tier progressive L1/L2/L3) | `<cwd>/.pi/skills/<name>/SKILL.md` |
| subagents | `~/.pi/agent/agents/` | `<cwd>/.pi/agents/<name>.md` |
| prompts / commands | — | `<cwd>/.pi/commands/` |
| settings | `~/.pi/agent/settings.json` | `<cwd>/.pi/settings.json` |

> The user/global directory default is the SDK's `agentDir` (defaulting to `~/.pi/agent/`); pi-web can override this directory via the `PI_CODING_AGENT_DIR` environment variable.

The **project-level** resources under `<cwd>/.pi/` are merged into loading only when that project directory is trusted; user/global resources, built-in resources, and `AGENTS.md`/`CLAUDE.md` context files are **not** subject to trust gating (see the "Trust Policy in Practice" section).

Beyond the resources shipped by the user/project, pi-web also **force-injects a handful of framework built-in extensions into every session** through the runner's `forcedExtensionPaths` (no user-agent declaration required)—among them the star of this chapter, the extension-management extension (`extension-manager`, detailed below). The injection wiring lives at `lib/app/pi-handler.ts:380` (`PI_WEB_EXT_TOOLS_ENTRY` is delivered through the spawn env).

> **Hands-on verification**: To empirically test whether "project-level `.pi/` resources (extensions / subagents / skills) are loaded correctly" along with the trust-gating behavior, run the probe example `examples/pi-probe-agent`—it ships with a set of project-level `.pi/` probe resources (one each of `extensions/agents/skills`). Run it with this directory as `cwd`, then observe whether the `pi_probe_ping` tool, the `/pi-probe` command, and the `pi-probe-subagent` subagent appear to determine the loading result (if they don't appear, trust most likely wasn't granted). See `examples/pi-probe-agent/README.md` for the run procedure and decision table.

---

## The Two Install Lanes

Installing an extension is equivalent to **granting remote code full system-privilege execution**. pi-web offers two complementary install lanes; both share the same source allowlist and admin gating, and both take effect on running sessions by "re-resolving resources, restarting the runner":

| Lane | Triggered by | Entry point | Gating implementation |
|------|--------|------|---------|
| **Agent turn** (current primary lane) | LLM tools / user slash commands | `install_extension` and other tools + `/plugin` / `/reload-runtime` commands | `gate.ts` (inside the agent subprocess) |
| **Controlled REST** | Host / ops scripts | `POST /extensions`, `DELETE /extensions/:extId` | `adminPolicy` + `source-allowlist.ts` (in the main process) |

The allowlist logic of the two lanes shares one source: the agent-side `packages/tool-kit/src/extension-tools/gate.ts` is **ported** from the server-side `packages/server/src/extensions/install/source-allowlist.ts` (kept aligned by unit tests to prevent drift). Their grant toggles are likewise one set of env vars (`PI_WEB_EXT_ADMIN_ALLOW_ANY` / `PI_WEB_EXT_ALLOW_LOCAL` / `PI_WEB_EXT_ALLOW_NPM`), read in one place in `lib/app/pi-handler.ts` and dispatched separately (the REST side gets `adminPolicy` injected; the agent side receives them through the spawn env).

> **⚠ Difference from older docs**: earlier docs claimed `/plugin` was a harness built-in command that, when selected, opened a `plugin-panel.tsx` modal panel—that implementation has been **deleted from main**. Current pi-web has **no extension-management frontend panel** at all; install / uninstall / list are all surfaced through `ctx.ui` (status bar / notification / widget). `BUILTIN_COMMANDS` now retains only `/clear` (`packages/tool-kit/src/commands/builtin.ts:22`).

---

## Extension Management REST API

The extension-management routes are exported by `createExtensionRoutes()` in `packages/server/src/extensions/routes.ts`, and merged into the route table via the `routes?` injection seam of `createPiWebHandler`, **without** modifying the internal implementation of `http-api`.

> **Current status (as of HEAD):** `createExtensionRoutes` is **already mounted unconditionally in pi-web's own host**—the assembly point is `lib/app/pi-handler.ts:517`, and it injects a real `reloadSession` (`reloadRunner` → `PiSession.restartRunner()`). Install governance is env-gated: it defaults to safe defaults (admin gating rejects anonymous / non-admin; the allowlist permits only the `@pi-web`/`@earendil-works` npm scopes + `github.com`, and forbids local). Setting `PI_WEB_EXT_ADMIN_ALLOW_ANY=1` makes pi-handler inject `adminPolicy: () => true` to permit installs (aimed at dev / single-user self-hosting; production should use a real `adminPolicy`). All handler-internal routes are mounted under `/api/**` (see the curl prefix below).

### Endpoint Overview

| Method | Path (relative to handler; actual path carries the `/api` prefix) | Description | Auth requirement |
|------|------|------|---------|
| `GET` | `/extensions` | List installed extensions (source type / version / scope) | No mandatory admin requirement |
| `GET` | `/sessions/:id/install-sources` | Shallow-scan the session `cwd` for directories usable as `local:` sources (used by `/plugin` subcommand completion) | Read-only, no admin gating |
| `POST` | `/extensions` | Install extension (source → allowlist → `pi install`) | **Admin only** |
| `DELETE` | `/extensions/:extId` | Uninstall extension (`pi remove`) | **Admin only** |
| `POST` | `/sessions/:id/reload` | Reload an existing session runtime to load new extensions | **Admin only** |

> `DELETE /extensions/:extId` deliberately names its path parameter `:extId` (not `:id`) to avoid colliding with the `:id` session gating of the http-api Router. `GET /sessions/:id/commands` (the data source for the slash-command palette) is owned by `http-api`; the extension-management layer only consumes its output in integration/e2e and does not implement this route.

### Route Registration Contract

Both `createExtensionRoutes` and `createPiWebHandler` are exported from the `@blksails/pi-web-server` main entry (the package does **not** expose the `@blksails/pi-web-server/extensions` subpath). The assembly in pi-web's own host is equivalent to:

```typescript
import { createExtensionRoutes, createPiWebHandler } from "@blksails/pi-web-server";

const handler = createPiWebHandler({
  // …core options such as manager / store / resolver / createChannel…
  routes: [
    // …other injected routes…
    ...createExtensionRoutes({
      piCli,         // PiCli (defaults to ChildProcessPiCli, the only subprocess IO) — required
      store,         // SessionStore (retrieves the session on reload) — required
      manager,       // SessionManager (rebuilds the runtime on reload) — required
      adminPolicy,   // optional; defaults to defaultAdminPolicy (default-deny). pi-web injects () => true when PI_WEB_EXT_ADMIN_ALLOW_ANY=1
      allowlist,     // optional; defaults to DEFAULT_ALLOWLIST, relaxable via PI_WEB_EXT_ALLOW_LOCAL/NPM
      reloadSession, // optional; pi-web injects reloadRunner (defaults to defaultSessionReloader, which rejects with 501)
      // onAudit / trustPolicy / piInstallTimeoutMs are also optional
    }),
  ],
});
```

> In `ExtManagementOptions` (`packages/server/src/extensions/ext.types.ts`), `piCli` / `store` / `manager` are required; all others have explicit defaults. **The default `defaultSessionReloader` rejects with `501 RELOAD_NOT_CONFIGURED`**—this is only hit when a third party assembles `createExtensionRoutes` elsewhere without injecting `reloadSession`; pi-web's own host already injects a real implementation.

---

## Install Governance Pipeline (REST Lane)

`POST /extensions` makes all rejection decisions **before** running `pi install`:

```
POST /extensions
  │
  ├─ adminPolicy(AuthContext) → non-admin → 403/401 + audit (rejected)
  │
  ├─ DTO safeParse(source) → invalid field → 400
  │
  ├─ checkAllowlist(source, cfg) → not allowlisted / version not pinned → 422 + audit (rejected)
  │
  ├─ assembleInstallArgs(source) → args + non-interactive env
  │     ├─ always includes --ignore-scripts
  │     └─ git source: GIT_TERMINAL_PROMPT=0 + GIT_SSH_COMMAND BatchMode
  │
  └─ pi-cli.runPiCommand(args, env, { timeoutMs }) → success/failure + audit
```

### Source Allowlist

The default allowlist is defined in `packages/server/src/extensions/install/source-allowlist.ts:24` (the agent-side `gate.ts` ports the same copy):

```typescript
export const DEFAULT_ALLOWLIST: AllowlistConfig = {
  npmScopes: ["@pi-web", "@earendil-works"],
  gitHosts: ["github.com"],
  allowLocal: false,          // local: disabled by default in production
};
```

**Source format specification:**

| Type | Format example | Version-pinning requirement |
|------|---------|------------|
| npm | `npm:@blksails/my-ext@1.2.3` | exact semver `@x.y.z` (no range/dist-tag allowed) |
| git | `git:github.com/user/repo@v1.2.3` | pinned ref (40-hex commit or `v*.*.*` tag; branch names rejected) |
| local | `local:/abs/path` | none (requires `allowLocal: true`, i.e. `PI_WEB_EXT_ALLOW_LOCAL=1`) |

Any bare `http(s)://` URL, an npm scope not on the allowlist, or a git host not on the allowlist is rejected **before** `pi install` runs. Setting `PI_WEB_EXT_ALLOW_NPM=1` permits any npm package (including unscoped ones), but exact version pinning is still enforced.

---

## Agent-Turn Extension Management (extension-manager)

This is the current primary install lane. The extension-management extension `extension-manager` (`packages/tool-kit/src/extension-tools/extension-manager.ts`) is force-injected into **every** session via `forcedExtensionPaths`, and provides three capabilities to the agent inside the agent subprocess, all surfaced through pi's native `ctx.ui` (`setStatus` status bar / `notify` notification / `setWidget` widget) with **no frontend panel whatsoever**:

| Capability | Name | Triggered by | Notes |
|------|------|--------|------|
| LLM-callable tools | `install_extension` / `uninstall_extension` / `list_extensions` | The model (natural language "install X") | After install/uninstall, queues `/reload-runtime` to apply |
| User-facing command | `/plugin <install\|uninstall\|list>` | User via the slash-completion palette | Subcommand-style; the handler calls `ctx.reload()` directly |
| reload command | `/reload-runtime` | Queued by a tool after install, or triggered manually | Re-resolves extensions / skills / prompts / themes |

### Why Tools and Commands Use Two reload Paths

The key constraint comes from the pi SDK: a **tool**'s `ctx` is an `ExtensionContext` and **cannot** call `ctx.reload()` directly (it would deadlock), so `install_extension`, after installing, calls `pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" })` to queue the reload as a follow-up command; a **command**'s `ctx` is an `ExtensionCommandContext` and can call `ctx.reload()` directly, in one step. Package installation uniformly uses `pi.exec("pi", ["install", …])` (pi exposes no in-process package-management API), landing in the current session agent's config directory (determined by the subprocess env, so it does not pollute the real `~/.pi`).

### Gating (gate.ts)

Before installing, `gateInstall(source)` applies gating with semantics identical to the REST side, reading the same set of env vars:

- `PI_WEB_EXT_ADMIN_ALLOW_ANY=1` → permit install/uninstall (`allowMutate`; off by default, otherwise everything is rejected with the prompt "install is disabled (requires PI_WEB_EXT_ADMIN_ALLOW_ANY=1)")
- `PI_WEB_EXT_ALLOW_LOCAL=1` → permit `local:<path>` sources
- `PI_WEB_EXT_ALLOW_NPM=1` → permit any npm package (exact version still enforced)

### Runnable Example

As a user, type the following command into the slash-command palette. Because `@blksails` is **not** in the default allowlist scopes (the default is only `@pi-web`/`@earendil-works`, see "Source Allowlist" above), in addition to `PI_WEB_EXT_ADMIN_ALLOW_ANY=1` to permit installs, you must also set `PI_WEB_EXT_ALLOW_NPM=1` (permit any npm scope, exact version still enforced) before launching pi-web—otherwise this source is rejected at the gate (`422` / agent-side "not allowlisted" prompt):

```
/plugin install npm:@blksails/code-review@2.0.0
```

Expected: the status bar shows "Installing: npm:@blksails/code-review@2.0.0…", and on success a notification "Installed: … (applying…)", followed by `ctx.reload()` to make the new extension's tools/commands take effect. A bare `/plugin` (no subcommand) lists installed extensions by default (a non-modal widget). You can also have the model trigger the tool via natural language—for example, tell the agent "install the code-review extension for me" and the model will call `install_extension`. Runnable templates: `examples/plugin-code-review-agent/` (dual-role) and `examples/plugin-consumer-agent/` (consumer).

---

## Taking Effect After Install: New Session vs. reload

After installation completes, the extension is written to the target session agent's config (landing in the project `.pi/settings.json` or the global `settings.json`, depending on `-l`):

1. **New session** (`POST /api/sessions`) — auto-loaded when the session spawns, no extra action needed.
2. **Existing session** — requires triggering a reload: the agent lane goes through `/reload-runtime` (`ctx.reload()` / follow-up); the REST lane goes through `POST /api/sessions/:id/reload`. Under the hood both are `PiSession.restartRunner()`, which re-spawns the runner, continues the session, and re-resolves resources.

```bash
# Assume the local self-hosted entry is http://localhost:3000 (replace per your actual deployment).
# The handler is mounted under /api/** (server/index.ts:75 app.all('/api/*')), so internal routes must carry the /api prefix.
# Install/uninstall/reload all require admin auth (or PI_WEB_EXT_ADMIN_ALLOW_ANY=1); attach the appropriate credential header per adminPolicy.
# The @blksails source below is not a default allowlist scope, so you must also set PI_WEB_EXT_ALLOW_NPM=1, otherwise it hits 422 (not allowlisted).

# 1. Install extension (admin)
curl -X POST http://localhost:3000/api/extensions \
  -H "Content-Type: application/json" \
  -d '{"source": "npm:@blksails/code-review@2.0.0"}'
# Expected success: 200 + { "ok": true, ... }; rejected source: 422; non-admin: 403/401

# 2. Reload an existing session <sessionId> to take effect (admin)
curl -X POST http://localhost:3000/api/sessions/<sessionId>/reload
# Expected success: { "ok": true, "reloaded": "<sessionId>" }
# If the host has not injected reloadSession: 501 RELOAD_NOT_CONFIGURED (pi-web's own host already injects it, so this is not hit)
```

> Status code semantics: `422` = source not on allowlist / version not pinned, `501` = host has not injected `reloadSession`, `403/401` = failed `adminPolicy`. For troubleshooting the `--no-skills` toggle not taking effect, `.pi/` project resources not loading, and similar issues, see [23 · Troubleshooting FAQ](./23-troubleshooting-faq.md).

---

## Trust Policy in Practice

Whether the skills/extensions/prompts under a project's `.pi/` directory are loaded depends on the return value of `trustPolicy` (which consumes the `agent-source-resolver` decision rather than redefining it):

`landTrust(source, mode, trustPolicy)` (`packages/server/src/extensions/install/trust-landing.ts`) calls `trustPolicy(source)` to obtain a `TrustDecision`, then maps it to a spawn fragment via `applyTrust(mode, decision)` (`packages/server/src/agent-source/trust-apply.ts`):

| `trustPolicy` return | CLI mode | custom mode |
|------------------|---------|------------|
| `"always"` | `extraArgs += ["--approve"]` | `extraEnv.PI_WEB_TRUST_PROJECT="1"` (the runner `startRunner` reads it and sets `makeResolveProjectTrust(true)`) |
| `"never"` | `extraArgs += ["--no-approve"]` | no grant signal passed |
| `"ask"` (default) | no trust flag | no grant signal passed |

Under `"ask"`/`"never"`, headless safely ignores `.pi/` project resources (no TTY means no interactive approval). No value **suppresses** the loading of `AGENTS.md`/`CLAUDE.md` context files or global/user extensions.

---

## Extension UI Sub-Protocol (Permission Prompt → Inline Interaction)

During execution, the agent can issue interaction requests (confirm / select / input / editor) via RPC, formatted as `extension_ui_request`. These flow to the frontend through `ControlStore.extensionUiQueue` (a FIFO queue) and are rendered as **inline cards** at the end of the conversation stream by the `PiInteraction` component (`packages/ui/src/elements/pi-interaction.tsx`).

Protocol flow:

```
agent subprocess
  │  extension_ui_request (RPC frame)
  ▼
PiSession → ControlStore.extensionUiQueue (FIFO, only interactive requests are enqueued)
  │  SSE control frame
  ▼
frontend useExtensionUI (@blksails/pi-web-react)
  │  queue / current / respond / pending / error
  ▼
PiInteraction (packages/ui/src/elements/pi-interaction.tsx)
  │  active card (head of queue, answerable) + resolved trace (read-only terminal state)
  ▼
extensionUI.respond(requestId, response)  →  UiResponseRequest → backend dequeues
```

**Key invariants:**
- Only `queue[0]` (the FIFO head) is answerable (active); subsequent queued items cannot be answered concurrently.
- After `respond` succeeds, the request is retained as a read-only terminal-state trace for the lifetime of the mount (not persisted).
- A failed `respond` keeps the active state and allows retry; while `pending` is true, all action controls are disabled.

**Interaction types and return payloads** (responses go through `respond(requestId, response)`, where `response` is `UiResponseRequest`=`RpcExtensionUIResponse`, uniformly carrying `type: "extension_ui_response"` and `id`; the schema is in `packages/protocol/src/rpc/extension-ui.ts:85`):

| Request method | Return discriminating payload |
|--------|---------|
| `confirm` | `{ confirmed: true/false }` |
| `select` | `{ value: "<option>" }` |
| `input` | `{ value: "<input text>" }` |
| `editor` | `{ value: "<editor text>" }` |
| cancel (select/input/editor) | `{ cancelled: true }` |

> Push-type requests (`notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text`) do **not** enter `extensionUiQueue` (no response packet needed); instead they write to the ambient slices of `ControlStore` (notification / status / widget / one-shot input-box write), avoiding blocking the interaction dialog (see `packages/react/src/sse/control-store.ts`).

### The Two Sides of setTitle: Transient Display + Persisted Session Name

Beyond driving the frontend's transient `ambient.title`, `setTitle` additionally lands on the session name. The runner assembles `wireSessionTitlePersistence` (`packages/server/src/runner/session-title-wiring.ts`), which **prototype-patches `session.bindExtensions`** to wrap `uiContext.setTitle` as "first call the original setTitle (preserving the ambient frame display) → then best-effort `persistTitle(title)` writes the session name (`appendSessionInfo`)". The two are each wrapped in try/catch and do not affect one another. Effect: titles set by an extension (such as the auto-title extension) show up in the "session history" list and are preserved after a cold recovery (see [14 · Sessions List](./14-sessions-list.md)).

---

## Slash-Command Palette (slash-command-palette)

`/` command completion is implemented by `PiCommandPalette` (`packages/ui/src/controls/pi-command-palette.tsx`) and wired through the `PiChat` assembly layer:

1. The input box value starts with `"/"` → enter command mode, rendering the command-completion overlay (`absolute bottom-full z-40`).
2. Candidate source: pulled via `controls.getCommands()` (backed by `PiSession.getCommands()`), producing `RpcSlashCommand[]` (schema in `packages/protocol/src/rpc/session-state.ts:49`: `{ name, description?, source: "extension"|"prompt"|"skill"|"builtin", sourceInfo }`).
3. Selecting a command → fills in `"/<name> "` (with a trailing space awaiting arguments), without sending immediately.
4. In command mode, Enter yields to the overlay selection (`suppressEnterSubmit`), while Shift+Enter still inserts a newline.

**Command data source (`GET /sessions/:id/commands`, owned by `http-api`; actual path carries the `/api` prefix):**

```bash
curl http://localhost:3000/api/sessions/<sessionId>/commands
# Returns { commands: [{ name: "my-skill", description: "...", source: "skill", sourceInfo: { … } }, …] }
```

The command palette only consumes this endpoint's output; it does not parse or expand commands on the frontend—the slash text is sent as-is via `sendMessage`, recognized and expanded by the pi backend.

### Execution Semantics of Extension Commands: fire-and-forget

Commands with `source: "extension"` (registered by the agent via `registerCommand`, such as `/plugin`, `/img_vision`, `/reload-runtime`) do **not** go through `useChat`'s regular turn on the web side; instead they are delivered **fire-and-forget** through `client.prompt` directly (`components/chat-app.tsx:233`, `packages/ui/src/chat/pi-chat.tsx:968`). The reason: these commands produce no user bubble and never wait for a `finish` frame, so going through a regular turn would permanently stick `busy`. The cost is that they **do not enter message history, do not block on pending**, and their result is surfaced only through `ctx.ui` (notify / widget). To carry the `ctx.ui` feedback of a fire-and-forget command, the frontend first lights up an extension-command control window (`extCtrlActive`), then delivers the command.

> The platform hides `source: "extension"` commands by default (a historical safety net against busy hangs, now fixed by fire-and-forget). A unified plugin can explicitly opt its commands into being visible by default via `web.commands` in `pi-web.json` (see "Unified Plugin Package Standard" below).

---

## Built-in Command Layer (`source: "builtin"`)

Beyond agent-registered commands (`source: extension|prompt|skill`, which when selected are sent to the LLM as a prompt), the harness provides a layer of **built-in commands** (`source: "builtin"`) that **execute harness logic and do not go to the LLM**.

- Built-in commands are defined in purely declarative form in tool-kit's frontend-safe subentry: `@blksails/pi-web-tool-kit/commands` (`BuiltinCommandSpec` / `BUILTIN_COMMANDS`). Currently `BUILTIN_COMMANDS` contains **only `/clear`** (`packages/tool-kit/src/commands/builtin.ts:22`).
- Frontend merge: `mergeBuiltinCommands` maps built-in commands to `RpcSlashCommand{ source:"builtin" }`, **appended after the agent commands**, with the built-in winning on same-name collisions. The command palette renders a "built-in" badge for built-in commands (`data-pi-command-source="builtin"`).
- Execution dispatch: selecting a `builtin` command calls `onBuiltinSelect`, which executes harness logic per `target` (`client` / `server-action` / `ui-surface`) and **clears the input without sending**.

`/clear` is the sole example (`target: server-action`): it both clears the agent context (server via `new_session`) and clears the frontend chat view (UI effect: clear-transcript), keeping "visual" and "context" consistent, overriding the agent's own same-name `/clear`.

> There was historically a `/plugin` built-in command + modal panel design, which has been deleted from main; extension installation is now handled by "Agent-Turn Extension Management" above.

---

## System-Resource Toggles (`--no-skills` / `--no-extensions`)

The Settings UI "Settings → Extensions → System Resources" provides two independent toggles:

| Toggle key | Injected arg when off | Effect |
|---------|-------------|------|
| `loadSystemSkills` | `--no-skills` | New sessions do not load system/package/built-in skills (no `/skill:*` in the slash palette) |
| `loadSystemExtensions` | `--no-extensions` | New sessions do not load system/package extensions (sandbox and `forcedExtensionPaths` force-injected paths are unaffected) |

Injection chain (`lib/app/system-resource-args.ts:50`):

```
settings.json (project <cwd>/.pi/settings.json overrides global <agentDir>/settings.json key by key)
  → systemResourceArgs(agentDir, cwd)            # lib/app/system-resource-args.ts:50
  → ["--no-skills"] / ["--no-extensions"] (each independent, triggered only by an explicit false)
  → assemble-spawn → runner argv
  → parseRunnerArgs                              # packages/server/src/runner/runner.ts:88 (--no-skills branch: 129)
  → RunnerArgs.noSkills / noExtensions
  → mapResourceLoaderOptions                     # packages/server/src/runner/option-mapper.ts:97
  → resourceLoaderOptions.skillsOverride = ({ diagnostics }) => ({ skills: [], diagnostics })   # :191
  → resourceLoaderOptions.noExtensions = true    # :199
```

> **Historical bug (fixed):** `parseRunnerArgs` once silently dropped `--no-skills`/`--no-extensions`, making the custom-mode toggle entirely ineffective. The spec `system-resource-toggle-fix` has added the recognition logic on the runner side, with evidence under `.kiro/specs/system-resource-toggle-fix/evidence/`.

**Important:** This affects **new sessions only**; runtime hot-switching of running sessions is not supported.

---

## Audit Records (REST Lane)

Every operation of `POST /extensions` / `DELETE /extensions/:extId` (including rejected install requests) produces one audit record, with fields:

```typescript
interface AuditRecord {
  actor: string;               // operator (userId or "anonymous")
  at: string;                  // ISO timestamp
  action: "install" | "remove";
  source: string;              // source identifier (redacted)
  outcome: "success" | "failure" | "rejected";
  reason?: string;             // failure/rejection reason summary (env/credentials stripped)
}
```

The default implementation (`packages/server/src/extensions/security/audit.ts:64`) writes structured output to `stderr`:

```
[ext-audit] {"actor":"alice","at":"2026-06-24T10:00:00.000Z","action":"install","source":"npm:@blksails/code-review@2.0.0","outcome":"success"}
```

In production, the `onAudit` seam can replace this with persistent storage.

---

## Security Boundaries

- **Extension install = RCE**: production deployments must enable the install capability inside a sandbox/container environment (the sandbox implementation belongs to production hardening; this layer only leaves a seam). By default, when `PI_WEB_EXT_ADMIN_ALLOW_ANY` is unset, the mutate operations of both lanes are rejected.
- **Admin gating**: the REST lane's install/uninstall/reload are decided by `adminPolicy` before any subprocess executes; anonymous is always rejected.
- **Version pinning**: prevents installing to a mutable tag/branch that gets supply-chain poisoned (exact npm semver, git pinned ref).
- **`--ignore-scripts`** (REST lane): disables npm lifecycle-script RCE.
- **Subprocess timeout + non-interactive env**: prevents `pi install` from hanging while waiting for terminal input.
- After changing injected routes, dev must be restarted (the handler singleton is pinned on `globalThis`).

---

## Unified Plugin Package Standard (plugin-system-unification)

pi-web unifies the **pi native extension (CLI standard)** and **webext (5-tier web UI extension)** into a single **plugin package standard that flattens across the two layers**: one package uses a single `pi-web.json` to declare both layers' entries, reuses a pi extension with zero changes, and makes "install take effect on both paths instantly".

### `pi-web.json` Manifest (Single Source of Truth)

Placed at the package root, it declares both layer entries of the same logical plugin; **when absent, it falls back to the existing directory conventions** (backward compatible):

```jsonc
{
  "id": "code-review",            // logical plugin identifier (shared by both layers)
  "version": "1.0.0",
  "pi": {                          // layer one: pi native resources (following DefaultPackageManager directory conventions)
    "extensions": ["extensions/code-review.ts"],
    "skills": ["skills/code-review"]
  },
  "web": { "dist": ".pi/web/dist" },        // layer two: webext build output (following the .pi/web/dist convention)
  "bindings": { "tools": ["code_review"] }  // the two-layer contract anchor (see below)
}
```

The resolver `resolvePiPlugin` (`packages/server/src/plugin/resolve-plugin.ts`) synthesizes a `PluginDescriptor` from the manifest; illegal manifest fields / missing build output degrade to `diagnostics` and **do not fail the whole package**. With no manifest, it falls back to scanning the package root's `extensions/`/`skills/`/`prompts/`/`themes/` + probing `.pi/web/dist`.

### The Two-Layer Contract Anchor: Tool Name

`bindings.tools` declares which pi tools are taken over for rendering by the webext. **The tool name is the anchor where the two layers mesh**: the `tool-code_review` part produced by the pi-side `registerTool("code_review")` is taken over and rendered into a rich card by the webext's `renderers.tools.code_review`—one capability, agent emits data, web emits UI, zero glue.

### Declaring Web-Visible Slash Commands (`web.commands`)

The platform hides `source:"extension"` commands by default (a historical safety net against busy hangs; busy is already fixed by fire-and-forget). A unified plugin can explicitly opt its commands into being visible by default via `web.commands` in `pi-web.json`:

```jsonc
{ "web": { "dist": ".pi/web/dist", "commands": ["review"] } }
```

The server's `GET /sessions/:id/commands` resolves a command's plugin manifest from its `sourceInfo`, and for commands matching `web.commands` it backfills `webVisible:true`; the frontend completion **allows `webVisible` commands by default** (no `NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST` needed), while undeclared extension commands remain hidden by default (the safety net is unchanged).

> Note: project-level `.pi/extensions` still require **trust** to load (unrelated to visibility)—dev grants it via `PI_WEB_TRUST_PROJECT=1` or by passing `trust:true` when creating the session; see "Trust Policy in Practice".

### Dual Role: An agent source Doubles as a Plugin Provider

The same repository can satisfy both discovery scenarios at once; the unified manifest points at a **single real body** to eliminate duplication:

| Scenario | Discovery origin | Resource path | webext lane |
|------|------------|---------|------------|
| Self-running (as an agent source) | `top-level` | `<cwd>/.pi/extensions` | build-time integration |
| Being installed (as a plugin package) | `package` | package root `extensions/` | runtime `.pi/web/dist` |

`.pi/extensions/x.ts` thinly forwards to the package root `extensions/x.ts`, avoiding maintaining two copies. Runnable templates: `examples/plugin-code-review-agent/` (dual-role) and `examples/plugin-consumer-agent/` (consumer).

### Install Takes Effect on Both Paths Instantly

After `/plugin install <source>` (or `/reload-runtime`) completes, **both paths are triggered in parallel** without blocking each other:

- **Path ① (pi resources)**: runner reload (`SessionReloader` / `restartRunner`) makes tools/commands take effect;
- **Path ② (webext)**: the frontend bumps `webextReloadNonce` → re-resolves and loads via `/api/webext/resolve`, and the rich-card renderers take effect.

The orchestration logic is dispatched by `runInstallEffects` (`packages/server/src/plugin/effect-orchestrator.ts`) per `PluginDescriptor` into three branches: pi-only / webext-only / both; a failure on either path does not block the other (when only one layer is present, the other path spins safely as a no-op).

> For the browser-side loading, signature verification, and runtime lane of webext, see [12 · Web UI Extensions](./12-web-ui-extension.md#webext-package-install-and-runtime-loading-webext-package-install).

---

## Related Chapters

- [02 · Core Concepts](./02-core-concepts.md) — dual mode, sessions, RPC channel
- [03 · Architecture](./03-architecture.md) — layering and dependency direction
- [06 · Configuration](./06-configuration.md) — `settings.json` structure, override logic, and the `PI_WEB_EXT_*` gating env vars
- [08 · Agent Development](./08-agent-development.md) — `.pi/` directory structure and skill/extension authoring
- [11 · AIGC and Vision Tools](./11-aigc-and-vision-tools.md) — real-world instances of extension commands like `/img_vision`
- [12 · Web UI Extensions](./12-web-ui-extension.md) — the `.pi/web` UI control layer of an agent source
- [14 · Sessions List](./14-sessions-list.md) — the origin of the session name after `setTitle` persistence
- [24 · HTTP API Reference](./24-http-api-reference.md) — complete endpoints and SSE frame formats
- [23 · Troubleshooting FAQ](./23-troubleshooting-faq.md) — common errors such as `--no-skills` not taking effect and `.pi/` project resources not loading
</content>
</invoke>
