# 09 · Extensions, Skills, and Prompt Templates

pi-web exposes pi's extension/skills/prompt-template capabilities to the Web side via a **controlled REST API + declarative injection + inline permission interactions**. This chapter covers resource auto-discovery, extension lifecycle management, the UI sub-protocol, the slash-command palette, and the correct usage of system-resource toggles.

---

## Resource Auto-Discovery and Injection

On every new session, pi-web auto-discovers and loads resources on the runner subprocess side. The SDK's (`@earendil-works/pi-coding-agent`) resource-loader looks up each resource type by the following directory conventions (priority **project > user > built-in**, with same-name override; `settings.json` only does enable/disable configuration and is not a registry):

| Resource type | User level (always loaded) | Project level (trusted only) |
|---------|------------------|---------------------|
| extensions | `~/.pi/agent/extensions/` | `<cwd>/.pi/extensions/` |
| skills | `~/.pi/agent/skills/` (three-tier progressive L1/L2/L3) | `<cwd>/.pi/skills/<name>/SKILL.md` |
| subagents | `~/.pi/agent/agents/` | `<cwd>/.pi/agents/<name>.md` |
| prompts / commands | — | `<cwd>/.pi/commands/` |
| settings | `~/.pi/agent/settings.json` | `<cwd>/.pi/settings.json` |

> The user/global directory default is the SDK's `agentDir` (defaulting to `~/.pi/agent/`); pi-web can override this directory via the `PI_CODING_AGENT_DIR` environment variable.

The **project-level** resources under `<cwd>/.pi/` are merged into loading only when that project directory is trusted; user/global resources, built-in resources, and `AGENTS.md`/`CLAUDE.md` context files are **not** subject to trust gating (see the "Trust Policy in Practice" section).

> **Hands-on verification**: To empirically test whether "project-level `.pi/` resources (extensions / subagents / skills) are loaded correctly" along with the trust-gating behavior, run the probe example `examples/pi-probe-agent`—it ships with a set of project-level `.pi/` probe resources (one each of `extensions/agents/skills`). Run it with this directory as `cwd`, then observe whether the `pi_probe_ping` tool, the `/pi-probe` command, and the `pi-probe-subagent` subagent appear to determine the loading result (if they don't appear, trust most likely wasn't granted). See `examples/pi-probe-agent/README.md` for the run procedure and decision table.

---

## Extension Management REST API

The extension management routes are exported by `createExtensionRoutes()` in `packages/server/src/extensions/routes.ts`, and merged into the route table via the `routes?` injection seam of `createPiWebHandler`, **without** modifying the internal implementation of `http-api`.

> **Current status (as of HEAD):** `createExtensionRoutes` is implemented and covered by integration/e2e tests under `packages/server/test/extensions/`, but is **not yet wired up in `apps/web`**—there is currently no production entry point calling it. To enable it in a self-hosted deployment, you must inject the `routes` shown in the example below where you assemble `createPiWebHandler` yourself (see [19 · Deployment](./19-deployment.md)). The endpoints below are the contract for this route set, not a built-in API enabled by default.

### Endpoint Overview

| Method | Path | Description | Auth requirement |
|------|------|------|---------|
| `GET` | `/extensions` | List installed extensions (source type/version/scope) | No mandatory admin requirement |
| `POST` | `/extensions` | Install extension (source → allowlist → `pi install`) | **Admin only** |
| `DELETE` | `/extensions/:extId` | Uninstall extension (`pi remove`) | **Admin only** |
| `POST` | `/sessions/:id/reload` | Reload an existing session runtime to load new extensions | **Admin only** |

> `GET /sessions/:id/commands` (the data source for the slash-command palette) is owned by `http-api`; the extension management layer only consumes its output in integration/e2e and does not implement this route.

### Route Registration Example

Both `createExtensionRoutes` and `createPiWebHandler` are exported from the `@blksails/pi-web-server` main entry (`packages/server/src/index.ts` re-exports `extensions/index.js` via the barrel `export *`; this package does **not** expose the `@blksails/pi-web-server/extensions` subpath):

```typescript
import { createExtensionRoutes, createPiWebHandler } from "@blksails/pi-web-server";

const handler = createPiWebHandler({
  // …core options such as manager / store / resolver / createChannel…
  routes: createExtensionRoutes({
    piCli,         // PiCli (defaults to ChildProcessPiCli, the only subprocess IO) — required
    store,         // SessionStore (retrieves the session on reload) — required
    manager,       // SessionManager (rebuilds the runtime on reload) — required
    adminPolicy,   // optional; defaults to defaultAdminPolicy (default-deny, requires an explicit adminUserIds list)
    onAudit,       // optional; defaults to defaultOnAudit (structured output to stderr)
    trustPolicy,   // optional; defaults to defaultTrustPolicy (always returns "ask")
    allowlist,     // optional; defaults to DEFAULT_ALLOWLIST
    // reloadSession, piInstallTimeoutMs are also optional
  }),
});
```

> In `ExtManagementOptions` (`packages/server/src/extensions/ext.types.ts:124`), `piCli` / `store` / `manager` are required; all others have explicit defaults.

---

## Install Governance Pipeline

Installing an extension is equivalent to **granting remote code full system-privilege execution**. pi-web uses the following pipeline to make all rejection decisions before running `pi install`:

```
POST /extensions
  │
  ├─ adminPolicy(AuthContext) → non-admin → 403/401 + audit (rejected)
  │
  ├─ DTO safeParse(source) → invalid field → 400
  │
  ├─ checkAllowlist(source, cfg) → not allowlisted/version not pinned → 422 + audit (rejected)
  │
  ├─ assembleInstallArgs(source) → args + non-interactive env
  │     ├─ always includes --ignore-scripts
  │     └─ git source: GIT_TERMINAL_PROMPT=0 + GIT_SSH_COMMAND BatchMode
  │
  └─ pi-cli.runPiCommand(args, env, { timeoutMs }) → success/failure + audit
```

### Source Allowlist (`source-allowlist.ts`)

The default allowlist is defined in `packages/server/src/extensions/install/source-allowlist.ts:24`:

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
| git | `git:github.com/user/repo@v1.2.3` | pinned ref (40-hex commit or `v*.*.*` tag, branch names rejected) |
| local | `local:/abs/path` | none (requires `allowLocal: true`) |

Any bare `http(s)://` URL, an npm scope not on the allowlist, or a git host not on the allowlist is rejected **before** `pi install` runs.

---

## Taking Effect After Install: New Session vs. reload

After installation completes, the extension is written to `settings.json`:

1. **New session** (`POST /api/sessions`) — auto-loaded when the session spawns, no extra action needed.
2. **Existing session** — requires calling `POST /sessions/:id/reload`, which restarts the runner subprocess / `new_session` rebuilds the runtime before it can take effect.

> Restart orchestration belongs to `session-engine`; this route layer only consumes the `SessionReloader` seam as a trigger. **The default `defaultSessionReloader` rejects with `501 RELOAD_NOT_CONFIGURED`**—the host must inject a real `reloadSession` implementation to enable this endpoint (success returns `{ ok: true, reloaded: <sessionId> }`).

```bash
# Assume the local self-hosted entry is http://localhost:3000 (replace per your actual deployment);
# install/uninstall/reload all require admin authentication, so attach the appropriate credential header per adminPolicy.

# 1. Install extension (admin)
curl -X POST http://localhost:3000/extensions \
  -H "Content-Type: application/json" \
  -d '{"source": "npm:@blksails/code-review@2.0.0"}'
# Expected success: 200 + { "ok": true, ... }; rejected source: 422; non-admin: 403/401

# 2. Reload an existing session <sessionId> to take effect (admin)
curl -X POST http://localhost:3000/sessions/<sessionId>/reload
# Expected success: { "ok": true, "reloaded": "<sessionId>" }
# If reloadSession is not injected: 501 RELOAD_NOT_CONFIGURED (see note above)
```

> Status code semantics: `422` = source not on allowlist / version not pinned (see "Source Allowlist"), `501` = host has not injected `reloadSession` (see note above), `403/401` = failed `adminPolicy`. For troubleshooting issues such as the `--no-skills` system-resource toggle not taking effect or `.pi/` project resources not loading, see [23 · Troubleshooting FAQ](./23-troubleshooting-faq.md).

---

## Trust Policy in Practice

Whether the skills/extensions/prompts under a project's `.pi/` directory are loaded depends on the return value of `trustPolicy` (which consumes the `agent-source-resolver` decision rather than redefining it):

`landTrust(source, mode, trustPolicy)` (`packages/server/src/extensions/install/trust-landing.ts`) calls `trustPolicy(source)` to obtain a `TrustDecision`, then maps it to a spawn fragment via `applyTrust(mode, decision)` (`packages/server/src/agent-source/trust-apply.ts`):

| `trustPolicy` return | CLI mode | custom mode |
|------------------|---------|------------|
| `"always"` | `extraArgs += ["--approve"]` | `extraEnv.PI_WEB_TRUST_PROJECT="1"` (the runner `startRunner` reads it and sets `makeResolveProjectTrust(true)`) |
| `"never"` | `extraArgs += ["--no-approve"]` | no grant signal passed |
| `"ask"` (default) | no trust flag | no grant signal passed |

Under `"ask"`/`"never"`, headless safely ignores `.pi/` project resources (no TTY means no interactive approval).

No value **suppresses** the loading of `AGENTS.md`/`CLAUDE.md` context files or global/user extensions.

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

**Interaction types and return payloads** (responses go through `respond(requestId, response)`, where `response` is `UiResponseRequest`=`RpcExtensionUIResponse`, uniformly carrying `type: "extension_ui_response"` and `id`; the table below lists only the discriminating payload, see the schema in `packages/protocol/src/rpc/extension-ui.ts:85`):

| Request method | Return discriminating payload |
|--------|---------|
| `confirm` | `{ confirmed: true/false }` |
| `select` | `{ value: "<option>" }` |
| `input` | `{ value: "<input text>" }` |
| `editor` | `{ value: "<editor text>" }` |
| cancel (select/input/editor) | `{ cancelled: true }` |

> Push-type requests (`notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text`) do **not** enter `extensionUiQueue` (no response packet needed); instead they write to the ambient slices of `ControlStore` (notification / status / widget / one-shot input-box write), avoiding blocking the interaction dialog (see `packages/react/src/sse/control-store.ts:178`).

---

## Slash-Command Palette (slash-command-palette)

`/` command completion is implemented by `PiCommandPalette` (`packages/ui/src/controls/pi-command-palette.tsx`) and wired through the `PiChat` assembly layer:

1. The input box value starts with `"/"` → enter command mode, rendering the command-completion overlay (`absolute bottom-full z-40`).
2. Candidate source: pulled via `controls.getCommands()` (backed by `PiSession.getCommands()`), producing `RpcSlashCommand[]` (see the schema in `packages/protocol/src/rpc/session-state.ts:45`: `{ name, description?, source: "extension"|"prompt"|"skill", sourceInfo }`).
3. Selecting a command → fills in `"/<name> "` (with a trailing space awaiting arguments), without sending immediately.
4. In command mode, Enter yields to the overlay selection (`suppressEnterSubmit`), while Shift+Enter still inserts a newline.

**Command data source (`GET /sessions/:id/commands`, owned by `http-api`):**

```bash
curl http://localhost:3000/sessions/<sessionId>/commands
# Returns { commands: [{ name: "my-skill", description: "...", source: "skill", sourceInfo: { … } }, …] }
```

The command palette only consumes this endpoint's output; it does not parse or expand commands on the frontend—the slash text is sent as-is via `sendMessage`, recognized and expanded by the pi backend.

---

## System-Resource Toggles (`--no-skills` / `--no-extensions`)

The Settings UI "Settings → Extensions → System Resources" provides two independent toggles:

| Toggle key | Injected arg when off | Effect |
|---------|-------------|------|
| `loadSystemSkills` | `--no-skills` | New sessions do not load system/package/built-in skills (no `/skill:*` in the slash palette) |
| `loadSystemExtensions` | `--no-extensions` | New sessions do not load system/package extensions (sandbox-enforced injected paths are unaffected) |

Injection chain (`lib/app/system-resource-args.ts:50`):

```
settings.json (project <cwd>/.pi/settings.json overrides global <agentDir>/settings.json key by key)
  → systemResourceArgs(agentDir, cwd)            # lib/app/system-resource-args.ts:50
  → ["--no-skills"] / ["--no-extensions"] (each independent, triggered only by an explicit false)
  → assemble-spawn → runner argv
  → parseRunnerArgs                              # packages/server/src/runner/runner.ts:74 (--no-skills branch: 115)
  → RunnerArgs.noSkills / noExtensions
  → mapResourceLoaderOptions                     # packages/server/src/runner/option-mapper.ts:96
  → resourceLoaderOptions.skillsOverride = ({ diagnostics }) => ({ skills: [], diagnostics })   # :186
  → resourceLoaderOptions.noExtensions = true    # :191
```

> **Historical bug (fixed):** `parseRunnerArgs` once silently dropped `--no-skills`/`--no-extensions`, making the custom-mode toggle entirely ineffective. The spec `system-resource-toggle-fix` has added the recognition logic on the runner side, with evidence under `.kiro/specs/system-resource-toggle-fix/evidence/`.

**Important:** This affects **new sessions only**; runtime hot-switching of running sessions is not supported.

---

## Audit Records

Every install/uninstall operation (including rejected install requests) produces one audit record, with fields:

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

- **Extension install = RCE**: production deployments must enable the install API inside a sandbox/container environment (the sandbox implementation belongs to production hardening; this layer only leaves a seam).
- **Admin gating**: install/uninstall/reload are decided by `adminPolicy` before any subprocess executes; anonymous is always rejected.
- **Version pinning**: prevents installing to a mutable tag/branch that gets supply-chain poisoned.
- **`--ignore-scripts`**: disables npm lifecycle-script RCE.
- **Subprocess timeout + non-interactive env**: prevents `pi install` from hanging while waiting for terminal input.

---

## Related Chapters

- [02 · Core Concepts](./02-core-concepts.md) — dual mode, sessions, RPC channel
- [03 · Architecture](./03-architecture.md) — layering and dependency direction
- [06 · Configuration](./06-configuration.md) — settings.json structure and override logic
- [08 · Agent Development](./08-agent-development.md) — `.pi/` directory structure and skill/extension authoring
- [12 · Web UI Extension](./12-web-ui-extension.md) — the `.pi/web` UI control layer of an agent source
- [24 · HTTP API Reference](./24-http-api-reference.md) — complete endpoints and SSE frame formats
- [19 · Deployment](./19-deployment.md) — injecting extension management routes and sandbox isolation at the self-hosted assembly point
- [23 · Troubleshooting FAQ](./23-troubleshooting-faq.md) — common errors such as `--no-skills` not taking effect and `.pi/` project resources not loading
