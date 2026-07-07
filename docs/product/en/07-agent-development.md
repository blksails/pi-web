# 07 · Custom Agent Development Guide

This chapter explains how to write, from scratch, a custom agent that the pi-web runner can load, covering the entry contract, tool definitions, model inheritance, the examples directory index, and development-time hot reload.

> **Learn by running**: Every key concept in this chapter ships with a runnable example, scattered under `examples/` in the repo. Recommended learning path (easy to hard): `minimal-agent` → `hello-agent` → `builtin-tools-agent` → `file-session-agent` → `server-driven-ui-agent` → `system-status-agent` → `ui-demo-agent`. For a master index of what each example does and how to run it, see [`examples/README.md`](https://github.com/blksails/pi-web/blob/main/examples/README.md); the "Example Index (Learning Path)" section at the end of this chapter also has a quick-reference table.

---

## Core Concepts

A pi-web agent is carried by **a single TypeScript/JavaScript file** (`index.ts`), whose `default export` must be one of the following three shapes:

| Shape | Description |
|------|------|
| (a) `AgentDefinition` object | The most common; returned directly by `defineAgent({...})` |
| (b) `(ctx: AgentContext) => AgentDefinition \| Promise<AgentDefinition>` factory | Use when you need to read the runtime environment |
| (c) `CreateAgentSessionRuntimeFactory` marked with `RUNTIME_FACTORY_BRAND` | Advanced usage; bypasses the normalization layer to build your own runtime |

The runner bootstrap (`packages/server/runner-bootstrap.mjs`) loads `index.ts` via jiti, normalizes it through `loadAgentDefinition` (`packages/server/src/runner/agent-loader.ts`) into a unified runtime factory, then calls `createAgentSessionRuntime` to build the session, and finally enters `runRpcMode` to continuously handle RPC calls.

---

## `@blksails/pi-web-agent-kit`

Package path: `packages/agent-kit/src/index.ts`

`@blksails/pi-web-agent-kit` is a lightweight helper package with **zero hard runtime dependencies**:

- **`defineAgent(def)`** — an identity function used solely for compile-time type inference; it returns its input verbatim at runtime. An equivalent `AgentDefinition` object written without this package can still be loaded by the runner.
- **`defineMinimalAgent(overrides?)`** — shallow-merges author overrides on top of `minimalAgentPreset` (`noTools: "all"` + empty skills + `allowExtensions: []`), yielding a zero-capability baseline in one line.
- **`emitUi(onUpdate, spec)`** — emits a `UiSpec` from within a tool's `execute`, triggering server-driven UI rendering (for the corresponding practice, see `examples/server-driven-ui-agent`: two trust paths — built-in allowlist components + sandboxed node trees; for the form combined with ambient status/notifications, see `examples/system-status-agent`).
- Type exports: `AgentDefinition`, `AgentContext`, `AgentModel`, `ToolDefinition`, `AttachmentToolContext`, etc. (all pure types, with no value dependencies).

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
```

---

## `AgentDefinition` Field Reference

Source: `packages/agent-kit/src/types.ts`

| Field | Type | Description |
|------|------|------|
| `model` | `AgentModel \| undefined` | Omitted → inherits `defaultProvider/defaultModel` from `~/.pi/agent/settings.json` |
| `thinkingLevel` | `ThinkingLevel \| undefined` | Reasoning effort |
| `systemPrompt` | `string \| (() => string) \| undefined` | System prompt; may be a lazy thunk |
| `customTools` | `ToolDefinition[]` | List of custom tools |
| `tools` | `string[]` | Allowlist of built-in/extension tool names |
| `excludeTools` | `string[]` | Tool exclusion list (applied after `tools`) |
| `noTools` | `"all" \| "builtin"` | `"builtin"` disables the built-in tool set (keeps custom/extension); `"all"` disables everything |

> Each of the three tool postures has a runnable example to compare against: `noTools: "all"` (zero-capability baseline) — see `examples/minimal-agent`; `noTools: "builtin"` (keep only custom tools) — see `examples/hello-agent`; using the `tools` allowlist to explicitly enable pi's built-in filesystem/shell tool set — see `examples/builtin-tools-agent`.
| `extensions` | `Array<string \| ExtensionFactory>` | Additional extensions to load (path or factory) |
| `allowExtensions` | `string[] \| undefined` | Allowlist of system extensions; `[]` = disable all disk-discovered system extensions |
| `skills` | `SkillsOverride \| undefined` | Override hook; receives the discovered skill set and returns a filtered set |
| `promptTemplates` | `PromptsOverride \| undefined` | Override hook |
| `contextFiles` | `AgentsFilesOverride \| undefined` | Overrides the AGENTS.md/CLAUDE.md discovery result |
| `scopedModels` | `Array<{model, thinkingLevel?}>` | List of models switchable at runtime |
| `routes` | `AgentRouteDecl[] \| undefined` | Declarative HTTP routes; each is mounted per session at `GET·POST /api/sessions/:id/agent-routes/:name` (see the "Declarative HTTP Routes" section below) |

---

## Complete Runnable Examples

### hello-agent (recommended starting reference)

Source: `examples/hello-agent/index.ts` (also the target agent for integration / e2e)

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

// Custom tool: echo
const echo = defineTool({
  name: "echo",
  label: "Echo",
  description: "Echo the provided text back to the caller.",
  parameters: Type.Object({
    text: Type.String({ description: "Text to echo back." }),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: params.text }],
      details: undefined,
    };
  },
});

export default defineAgent({
  // model omitted → inherits defaultProvider/defaultModel from ~/.pi/agent/settings.json
  systemPrompt: "You are hello-agent, a minimal pi-web example agent.",
  customTools: [echo],
  noTools: "builtin",          // disable the built-in tool set, keep only echo
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }), // clear system skills
});
```

**Key points:**

1. `defineTool` comes from `@earendil-works/pi-coding-agent` and `Type` from `@earendil-works/pi-ai`; the runner resolves both packages automatically via jiti alias, with no need to install dependencies in the agent directory.
2. When the `model` field is omitted, the runner reads `defaultProvider` and `defaultModel` from `~/.pi/agent/settings.json`, and resolves credentials from `~/.pi/agent/auth.json` — working out of the box with any pi account.
3. To pin a model, add `model: { provider: "anthropic", modelId: "claude-opus-4-5" }`, but the corresponding provider must have valid credentials.

### Minimal Baseline (defineMinimalAgent)

Source: `examples/minimal-agent/index.ts`

```ts
import { defineMinimalAgent } from "@blksails/pi-web-agent-kit";

export default defineMinimalAgent({
  // model omitted → inherits configuration
  systemPrompt: "You are minimal-agent, a zero-capability pi-web baseline example.",
  // noTools: "all" + empty skills + allowExtensions: [] are provided by the preset, no need to redeclare
});
```

### Factory Shape (shape b)

When an agent needs to read the runtime environment (such as `cwd`, `env`), use a factory function:

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import type { AgentContext } from "@blksails/pi-web-agent-kit";

export default async function (ctx: AgentContext) {
  const apiKey = ctx.env["MY_API_KEY"];
  return defineAgent({
    systemPrompt: `Working directory: ${ctx.cwd}`,
    customTools: apiKey ? [buildMyTool(apiKey)] : [],
  });
}
```

`AgentContext` provides:
- `ctx.cwd` — the runner's effective working directory
- `ctx.agentDir` — the global agent config directory (typically `~/.pi/agent`)
- `ctx.env` — a snapshot of the process environment

---

## Declarative HTTP Routes (`AgentDefinition.routes`)

An agent may declare named HTTP routes in its definition: once a session is created, each route automatically becomes an endpoint under that session's namespace, `GET·POST /api/sessions/:id/agent-routes/:name`, letting external systems (curl / webhooks / third-party services) invoke agent capabilities synchronously without subscribing to any SSE stream — **declaring is enabling, with zero host-side configuration**. Agents that do not declare `routes` are entirely unaffected by this feature.

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  routes: [
    {
      name: "gallery-stats",        // required: lowercase letters/digits/hyphens, unique within the definition
      // methods defaults to ["GET"] (the primary use case is read-only queries); may declare ["GET", "POST"]
      description: "Gallery statistics", // optional: surfaces in the route-listing endpoint's projection
      handler: async (req) => {
        // req: { name, method: "GET" | "POST", query: Record<string, string>, body?: unknown }
        return { ok: true, echo: req.query };  // return value must be JSON-serializable → becomes the HTTP response body
      },
    },
  ],
});
```

**Handler contract** (`AgentRouteHandler`; types in `packages/agent-kit/src/types.ts`):

- Input `AgentRouteRequest`: `name` (the invoked route name), `method` (`"GET" | "POST"`), `query` (query parameters flattened to single string values), and `body` (the parsed JSON carried by a POST, possibly absent; GET invocations never have a body).
- The return value (may be async) **must be JSON-serializable** and becomes the HTTP response body verbatim; a thrown error surfaces to the caller as a 502.
- The handler **executes only inside the agent subprocess** — the function itself never crosses the process boundary; the main process only receives the pure-data projection of `name` / `methods` / `description` (under the hood: an assembly-time declaration frame plus a dedicated request/result frame pair, riding the existing stdin/stdout JSONL channel).

**Assembly-time validation** (performed by the assembly layer; violations fail session creation):

- `name` must be non-empty, containing only lowercase letters, digits, and hyphens (`^[a-z0-9][a-z0-9-]*$`), and unique within one definition.
- `methods` allows only `"GET"` / `"POST"`; defaults to `["GET"]`.

**Security and invocation semantics**:

- An invocation **does not trigger LLM inference, does not enter the conversation history, and produces no UI change whatsoever**; calls are accepted as usual while the session is busy (mid-inference).
- A handler can only be invoked through its declaration binding — an undeclared name → 404; the endpoints reuse the existing session auth gate (401/403 / session 404).
- Operators can disable the feature wholesale: `PI_WEB_AGENT_ROUTES_DISABLED=1` → all agent-routes endpoints return a generic 404 (enabled by default).
- Forwarding timeout (`PI_WEB_AGENT_ROUTE_TIMEOUT_MS`, default 20000 ms) → 504; POST request-body limit (`PI_WEB_AGENT_ROUTE_BODY_LIMIT`, default 1 MiB) → 413.

For the full invocation-side contract (endpoint paths, error-code table, env details, curl examples), see [13 · HTTP API Reference](./13-http-api-reference.md); for a runnable demo, see `examples/aigc-canvas-agent` (the "Agent Routes demo (`gallery-stats`)" section of its README).

---

## examples/ Directory Index

Repo path: `examples/` (for the master index and how to run each example, see [`examples/README.md`](https://github.com/blksails/pi-web/blob/main/examples/README.md))

| Subdirectory | One-line description |
|--------|-----------|
| `hello-agent` | Minimal complete example: custom `echo` tool + system prompt, with the built-in tool set disabled |
| `minimal-agent` | Zero-capability baseline: `defineMinimalAgent` preset, with noTools/skills/extensions all disabled |
| `aigc-agent` | Assembles `buildAigcTools()` (`image_generation` / `image_edit`), demonstrating AIGC tools + the attachment seam |
| `attachment-tool-agent` | Demonstrates the attachment-tool-bridge: a custom image tool persists its outputs to the attachment store via `AttachmentToolContext` |
| `builtin-tools-agent` | Enables pi's built-in tool set (the opposite posture to hello-agent's `noTools: "builtin"`) |
| `file-session-agent` | A minimal agent paired with the file-store session demo (session storage is runtime configuration, not part of the AgentDefinition) |
| `pi-probe-agent` | A probe agent used to verify that `.pi/` project-level resources (extensions/skills) are correctly discovered and loaded |
| `server-driven-ui-agent` | Calls `emitUi(onUpdate, spec)` within a tool's `execute` to emit a `UiSpec`, with zero-config rendering on the frontend |
| `system-status-agent` | Combines server-driven UI + ambient status/notifications; one tool demonstrates both paths at once |
| `ui-demo-agent` | Demonstrates all of the extension UI interaction surfaces (`ctx.ui.*`: status push, ambient notifications, etc.) |
| `webext-artifact-agent` | Tier 4 artifact isolated-surface example: `.pi/web` declares the artifact entry, and the host renders it in a sandboxed iframe |
| `webext-background-agent` | Tier 1 background slot example: a `.pi/web` WebExtension renders an animated background layer (the `background` region) |
| `webext-contrib-agent` | Tier 3 contribution point example: slash / @mention, fetching candidates back from the agent via ui-rpc |
| `webext-declarative-agent` | Tier 5 pure-declarative example: `.pi/web/manifest.json` inlines theme tokens + layout, a zero-code UI extension |
| `webext-layout-agent` | Tier 1 region slot example: fills the `panelRight` and `headerCenter` regions |
| `webext-renderer-agent` | Tier 2 renderer example: registers a custom `data-metric` data-part renderer + `echo` tool |
| `webext-slots-agent` | Acceptance fixture: declares 18 region slots (the protocol's `SlotKeySchema` has 19 slots total; the fixture does not yet include `logs`), verifying that the host has wired up a `SlotHost` for each slot |

### Learning Path (easy to hard)

The table below strings the core concepts covered in "Custom Agent Development" above into a hands-on route from shallow to deep, each mapped to one runnable example. We recommend running them through in order:

| Order | Example | Concepts you'll learn | Corresponding section in this chapter |
|------|------|---------------|-------------|
| 1 | `examples/minimal-agent` | `defineMinimalAgent` preset / `noTools: "all"` zero-capability baseline | Core Concepts, Minimal Baseline |
| 2 | `examples/hello-agent` | Custom `defineTool` + `systemPrompt`, `noTools: "builtin"` (e2e target) | hello-agent Example |
| 3 | `examples/builtin-tools-agent` | Using the `tools` allowlist to enable pi's built-in filesystem/shell tool set | `noTools` / `tools` Fields |
| 4 | `examples/file-session-agent` | Session storage is **runtime** configuration, not part of the `AgentDefinition` | `AgentDefinition` Field Reference |
| 5 | `examples/server-driven-ui-agent` | `emitUi(onUpdate, spec)` emits `data-pi-ui`, with zero-config frontend rendering | `emitUi` |
| 6 | `examples/system-status-agent` | server-driven UI + ambient status/notifications combined (`ctx.ui.setStatus/notify`) | `emitUi` |
| 7 | `examples/ui-demo-agent` | extension UI interaction surfaces: `ctx.ui.select/confirm/input` | — |

> The table above is the recommended order for the "Custom Agent Development" main line; `aigc-agent`, `attachment-tool-agent`, `pi-probe-agent`, and the `webext-*` series are specialized topics, covered respectively in [11 · AIGC Tools](./11-aigc-tools.md), [08 · Attachment System](./08-attachment-system.md), [09 · Extensions & Skills](./09-extensions-and-skills.md), and [10 · Web UI Extension](./10-web-ui-extension.md). For the full list and how to run each, see [`examples/README.md`](https://github.com/blksails/pi-web/blob/main/examples/README.md).

---

## Development-Time Hot Reload

**Background**: the runner is a per-session resident subprocess that imports the agent entry only once, in-process, via jiti. After you modify `packages/tool-kit/src`, the runner for an existing session still runs the old code, requiring a new session to take effect.

**How to enable**:

```bash
# Enable hot reload in development mode
PI_RUNNER_HOT_RELOAD=1 pnpm dev
```

Or via the CLI's `--watch` flag (works in any environment, not gated by `NODE_ENV`). Note that the two have different watch targets: `PI_RUNNER_HOT_RELOAD=1` watches `packages/tool-kit/src` by default (good for editing tool source), whereas `--watch <source>` injects `PI_WEB_WATCH=1` + `PI_RUNNER_HOT_RELOAD_PATHS=<source>` and watches the agent source directory you pass in (good for editing the agent's own `index.ts`; a git source has no local directory, so watching is skipped):

```bash
pi-web --watch /path/to/my-agent
```

**Mechanism** (source: `packages/server/src/rpc-channel/hot-reload.ts:24`, `bin/pi-web.mjs:138`):

1. `isHotReloadEnabled()` checks `PI_WEB_WATCH=1` (injected by `--watch`) or `NODE_ENV !== production && PI_RUNNER_HOT_RELOAD=1`.
2. Once enabled, `registerForHotReload(target)` watches the directory: by default `packages/tool-kit/src`, overridable via `PI_RUNNER_HOT_RELOAD_PATHS` (`--watch` uses exactly this to change the target to the agent source directory); debounced by 200 ms, responding only to `.ts/.tsx/.js/.mjs/.cjs/.json` changes.
3. On a source change, `requestRestart()` is called on all registered `PiRpcProcess` instances, and the runner restarts the subprocess **while idle** (no pending commands).
4. The new process re-reads the source with a fresh jiti instance; the session id is reused via `spawnSpec`, and the new runner **resumes the conversation** from the persisted jsonl, with no need for the user to restart the session.

**Custom watch directories**:

```bash
PI_RUNNER_HOT_RELOAD=1 \
PI_RUNNER_HOT_RELOAD_PATHS=/abs/path/to/my-tools,/abs/path/to/another-dir \
pnpm dev
```

`PI_RUNNER_HOT_RELOAD_PATHS` accepts a comma-separated list of absolute paths, overriding the default `packages/tool-kit/src`.

---

## Bootstrap Flow

```
pi-web backend process
  └─ spawn node runner-bootstrap.mjs
       --agent <entry>  --cwd <work>  [--agent-dir <dir>]  [--session-id <id>]
         │
         ├─ createJiti(here)              # jiti root anchored at the @blksails/pi-web-server package dir
         ├─ jiti.import("src/runner/runner.ts")
         └─ runner.ts: main(argv)
              ├─ parseRunnerArgs(argv)    # parse --agent / --cwd / --agent-dir etc.
              ├─ loadAgentDefinition(agent, ctx, trust)
              │    ├─ jiti.import(agentPath)  # load index.ts (shape a/b/c)
              │    └─ buildRuntimeFactory(def) # normalize into a unified runtime factory
              ├─ createAgentSessionRuntime(factory, {cwd, agentDir, sessionManager})
              ├─ wireAttachmentBridge(runtime)  # attachment-tool-bridge wiring
              └─ runRpcMode(runtime)       # enter the RPC loop, never returns
```

Key source files:

- `packages/server/runner-bootstrap.mjs` — the launcher; pure ESM, needs no jiti to start itself
- `packages/server/src/runner/runner.ts` — `main()` / `startRunner()` / `parseRunnerArgs()`
- `packages/server/src/runner/agent-loader.ts` — `loadAgentDefinition()`, normalizes the three shapes
- `packages/server/src/runner/option-mapper.ts` — `buildRuntimeFactory()`, `AgentDefinition` → SDK calls

---

## Development Steps

End-to-end from an empty directory to a working custom agent, as follows. Each step gives the expected result, for easy independent verification. If you'd rather start from a runnable minimal project directly, look first at `examples/minimal-agent` (zero-capability baseline) or `examples/hello-agent` (with one custom tool).

1. **Create the agent directory** and add a new `index.ts` inside it:

   ```bash
   mkdir -p /path/to/my-agent
   ```

2. **Declare an `AgentDefinition`**, providing at least a `systemPrompt`:

   ```ts
   // /path/to/my-agent/index.ts
   import { defineAgent } from "@blksails/pi-web-agent-kit";
   export default defineAgent({
     systemPrompt: "You are my custom agent.",
   });
   ```

   When `model` is omitted, it inherits the default provider/model from `~/.pi/agent/settings.json`, with credentials resolved from `~/.pi/agent/auth.json` — as long as pi is logged in on this machine, no extra configuration is needed.

3. **Start pi-web pointed at that directory**; the simplest way is the CLI (`PI_WEB_AUTOSTART=1` jumps straight into a session and skips the source-picker page):

   ```bash
   pi-web /path/to/my-agent
   ```

   **Expected result**: after the terminal prints the ready log, the browser opens automatically and enters the chat page; typing a sentence gets a model reply. You can also point at this directory manually from the source-picker page in the pi-web UI.

4. **Add a custom tool**: use `defineTool` (`@earendil-works/pi-coding-agent`) + `Type` (`@earendil-works/pi-ai`), adding it to the `customTools` array (for the syntax, see the hello-agent example above).
   **Verification**: after reopening the session, ask the agent a question that requires the tool; the tool takes effect once its bubble appears.
5. **Adjust the tool switches**:
   - `noTools: "builtin"` — disables built-in tools, keeping only `customTools` and `.pi/extensions` tools.
   - `noTools: "all"` — disables everything, equivalent to the tool posture of `minimalAgentPreset`.
   - Omit `noTools` — keeps the default built-in tool set.
6. **Enable hot reload** (when editing tool-kit source): set `PI_RUNNER_HOT_RELOAD=1`; to edit the agent's own `index.ts`, use `pi-web --watch /path/to/my-agent`. Changes automatically restart the runner while idle and resume the session, with no need to manually open a new session.

**Common error remedies**:

| Symptom | Likely cause | Remedy |
|------|---------|------|
| `module has no default export` | `index.ts` has no `export default`, or exports only named exports | Confirm the default export is an `AgentDefinition` object / factory / branded factory |
| Model call 401 / auth failure | The provider specified by an explicit `model` has no valid credentials | Drop `model` to use the default, or provision auth for that provider; see [18 · Troubleshooting §2.1](./18-troubleshooting-faq.md) |
| Code changes don't take effect | The runner is a resident subprocess and imports only once | Enable hot reload (see step 6) or manually open a new session |

For more troubleshooting, see [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md).

---

## Related Links

- [02 · Core Concepts](./02-core-concepts.md) — AgentDefinition, runner, the session model
- [03 · Architecture](./03-architecture.md) — runner subprocess isolation and the RPC channel
- [09 · Extensions & Skills](./09-extensions-and-skills.md) — detailed coverage of the `extensions` / `allowExtensions` / `skills` fields
- [10 · Web UI Extension (WebExtension)](./10-web-ui-extension.md) — the `.pi/web` Tier 1–5 UI extension system
- [11 · AIGC Tools](./11-aigc-tools.md) — `buildAigcTools()` and the aigc-agent integration pattern
- [08 · Attachment System](./08-attachment-system.md) — `AttachmentToolContext` and the attachment-tool-bridge
- [14 · CLI](./14-cli.md) — `pi-web --watch` and command-line arguments
- [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md) — remedies for agent load failures, provider auth, hot reload not taking effect, and more
