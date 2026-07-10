# 08 · Custom Agent Development Guide

This chapter explains how to write, from scratch, a custom agent that the pi-web runner can load. It covers the entry contract, tool definitions, model inheritance, session-shared state (`getSessionState`), static slash completions, declarative HTTP routes, the examples directory index, and development-time hot reload.

> **Learn by running**: Every key concept in this chapter ships with a runnable example, scattered under `examples/` in the repo. Recommended learning path (easy to hard): `minimal-agent` → `hello-agent` → `builtin-tools-agent` → `state-bridge-agent` → `agent-routes-demo` → `server-driven-ui-agent`. For a master index of what each example does and how to run it, see [`examples/README.md`](https://github.com/blksails/pi-web/blob/main/examples/README.md); the "Learning Path" table at the end of this chapter is also a quick reference.

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
- **`emitUi(onUpdate, spec)`** — emits a `UiSpec` from within a tool's `execute`, triggering server-driven UI rendering (for the corresponding practice, see `examples/server-driven-ui-agent`).
- Type exports: `AgentDefinition`, `AgentContext`, `AgentModel`, `ToolDefinition`, `AgentRouteDecl`, `AgentRouteRequest`, `AttachmentToolContext`, etc. (all pure types, with no value dependencies).

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
```

---

## `AgentDefinition` Field Reference

Source: `packages/agent-kit/src/types.ts:110`

| Field | Type | Description |
|------|------|------|
| `model` | `AgentModel \| undefined` | Omitted → inherits `defaultProvider/defaultModel` from `~/.pi/agent/settings.json` |
| `thinkingLevel` | `ThinkingLevel \| undefined` | Reasoning effort |
| `systemPrompt` | `string \| (() => string) \| undefined` | System prompt; may be a lazy thunk |
| `customTools` | `ToolDefinition[]` | List of custom tools |
| `tools` | `string[]` | Allowlist of built-in/extension tool names |
| `excludeTools` | `string[]` | Tool exclusion list (applied after `tools`) |
| `noTools` | `"all" \| "builtin"` | `"builtin"` disables the built-in tool set (keeps custom/extension); `"all"` disables everything |
| `extensions` | `Array<string \| ExtensionFactory>` | Additional extensions to load (path or factory) |
| `allowExtensions` | `string[] \| undefined` | Allowlist of system extensions; `[]` = disable all disk-discovered system extensions |
| `skills` | `SkillsOverride \| undefined` | Override hook; receives the discovered skill set and returns a filtered set |
| `promptTemplates` | `PromptsOverride \| undefined` | Override hook |
| `contextFiles` | `AgentsFilesOverride \| undefined` | Overrides the AGENTS.md/CLAUDE.md discovery result |
| `scopedModels` | `Array<{model, thinkingLevel?}>` | List of models switchable at runtime |
| `slashCompletions` | `SlashCompletionDecl[] \| undefined` | Static slash pseudo-command completion candidates; selecting one only fills the input box, it does not execute (see the "Static Slash Completions" section) |
| `routes` | `AgentRouteDecl[] \| undefined` | Declarative HTTP routes; each is mounted per session at `GET·POST /api/sessions/:id/agent-routes/:name` (see the "Declarative HTTP Routes" section) |

> Each of the three tool postures has a runnable example to compare against: `noTools: "all"` (zero-capability baseline) — see `examples/minimal-agent`; `noTools: "builtin"` (keep only custom tools) — see `examples/hello-agent`; using the `tools` allowlist to explicitly enable pi's built-in filesystem/shell tool set — see `examples/builtin-tools-agent`.

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

## Session-Shared State: `getSessionState()` (author side)

Source: `packages/tool-kit/src/session-state.ts:61`

When an agent tool needs to **share a single session-level piece of state read/written by both human and machine** (a counter, a currently selected item, etc.), use `getSessionState()`. It is the author-side entry point of the "state-injection-bridge": the authoritative KV lives inside the runner **subprocess**, self-built by pi-web's `wireStateBridge` and attached to an agreed globalThis seam; reads and writes inside a tool are zero-cross-process and take effect immediately, and a write is mirrored to the UI in real time via a downstream `control:"state"` frame (outside the LLM context, never entering conversation history).

**Authorization and availability semantics** (use it exactly this way):

- `getSessionState()` is only meaningful when **called inside an agent tool's `execute`** — at that point the code runs inside the runner subprocess, where the seam has been wired by `wireStateBridge`.
- When the seam is unavailable (not a subprocess / bridge not wired / frontend environment), it returns a degraded view with `available: false`: `get` returns `undefined`, `set`/`delete` are no-ops, and it **never throws**. A tool should therefore check `available` first and decide accordingly, rather than assuming the state is always writable.
- Pure globalThis reads, with no pi SDK / Node dependency, frontend-safe (always degrades on the browser side).

The `SessionStateAccess` interface (`session-state.ts:18`): `available` / `get<T>(key)` / `set(key, value)` / `delete(key)` / `snapshot()`.

```ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { getSessionState } from "@blksails/pi-web-tool-kit";

// increment: read count → +1 → write back → return the new value; the write mirrors to the UI in real time
const increment = defineTool({
  name: "increment",
  label: "Increment State",
  description: "Bump a shared counter and return the new value.",
  parameters: Type.Object({
    key: Type.Optional(Type.String({ description: "State key (default 'count')." })),
  }),
  async execute(_id, params) {
    const state = getSessionState();
    if (!state.available) {
      return { content: [{ type: "text", text: "Shared state unavailable." }], details: { ok: false } };
    }
    const key = params.key ?? "count";
    const next = (typeof state.get<number>(key) === "number" ? state.get<number>(key)! : 0) + 1;
    state.set(key, next);
    return { content: [{ type: "text", text: `${key} = ${next}` }], details: { ok: true, key, value: next } };
  },
});
```

> `getSessionState` is exported from the main entry of `@blksails/pi-web-tool-kit` (pure globalThis reads, frontend-safe, no pi SDK value dependency). The canonical two-sided example is `examples/state-bridge-agent`: the AI side exposes `increment`/`read_state` tools while the human side renders and writes back via `.pi/web` using `useExtensionState("count")` — both ends read and write the same piece of live state. That example's tools deliberately inline the seam read (without importing tool-kit) to stay hermetic; it is equivalent to the `getSessionState()` form above, and you may use either.
>
> For the overall architecture of the state-injection bridge (subprocess authority, `control:"state"` downstream mirroring, monotonic `rev` numbers), see [04 · Surface Authoritative Stack](04-surface-stack.md); for the human-side write-back endpoint `POST /api/sessions/:id/state`, see [24 · HTTP API Reference](24-http-api-reference.md).

---

## Static Slash Completions (`slashCompletions`)

Source: field type `packages/agent-kit/src/types.ts:162`; protocol schema `packages/protocol/src/transport/slash-completion.ts:16`

An agent may declare a set of **static slash pseudo-command completion candidates** so that when a user types `/` in the input box, they see prompts specific to this agent. Key semantics: these candidates **are just completion items — selecting one only fills `insertText` into the input box and executes nothing**. The filled text is sent as an ordinary message and interpreted by the LLM per the system prompt. This differs from an executable command registered via `pi.registerCommand`.

`SlashCompletionDecl` (pure data, frontend-safe):

- `name` — the command name (no leading `/`), e.g. `"img-gen"`.
- `description?` — subtext shown in the completion popover.
- `insertText?` — the text filled into the input box on selection; when omitted, the consumer derives it as `"/" + name + " "`.

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  systemPrompt:
    "When the user sends '/img-gen <description>', treat it as a request to generate an image.",
  slashCompletions: [
    { name: "img-gen", description: "Generate an image from a prompt", insertText: "/img-gen " },
    { name: "img-edit", description: "Edit the most recently uploaded image", insertText: "/img-edit " },
  ],
});
```

**End-to-end path** (declaration → assembly-time frame → command palette):

1. The declaration lives in `AgentDefinition.slashCompletions` (pure data, no functions, no pi SDK imports).
2. At assembly time (before `runRpcMode`), the subprocess pushes a one-shot `slash_completions` frame over stdout (a pi-web self-built JSONL frame, of the same nature as `ui_rpc_response`); the server caches it per session.
3. The frontend `/` completion merges these candidates into the command palette; when the user selects one → it only fills the input box → and is sent as an ordinary message.

> A real-data example: `aigcSlashCompletions` (`packages/tool-kit/src/aigc/slash-completions.ts:12`) is exactly the `/img-gen` and `/img-edit` candidates declared by the AIGC extension, mounted by `examples/aigc-agent` via `import { aigcSlashCompletions }`. The reason "selecting fills instead of executing" works is that the real image tools are `image_generation` / `image_edit` (invoked by the LLM); the slash candidates merely drop the phrasing of the request into the input box for the model.

---

## Declarative HTTP Routes (`AgentDefinition.routes`)

Source: `packages/agent-kit/src/types.ts:85` (`AgentRouteDecl`), `:57` (`AgentRouteRequest`)

An agent may declare named HTTP routes in its definition: once a session is created, each route automatically becomes an endpoint under that session's namespace, `GET·POST /api/sessions/:id/agent-routes/:name`, letting external systems (curl / webhooks / third-party services) invoke agent capabilities synchronously without subscribing to any SSE stream — **declaring is enabling, with zero host-side configuration**. Agents that do not declare `routes` are entirely unaffected by this feature.

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import type { AgentRouteRequest } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  routes: [
    {
      name: "gallery-stats",        // required: lowercase letters/digits/hyphens, unique within the definition
      // methods defaults to ["GET"] (the primary use case is read-only queries); may declare ["GET", "POST"]
      description: "Gallery statistics", // optional: surfaces in the route-listing endpoint's projection
      handler: async (req: AgentRouteRequest) => {
        // req: { name, method: "GET" | "POST", query: Record<string, string>, body?: unknown }
        return { ok: true, echo: req.query };  // return value must be JSON-serializable → becomes the HTTP response body
      },
    },
  ],
});
```

**Handler contract** (`AgentRouteHandler`, `packages/agent-kit/src/types.ts:77`):

- Input `AgentRouteRequest`: `name` (the invoked route name), `method` (`"GET" | "POST"`), `query` (query parameters flattened to single string values), and `body` (the parsed JSON carried by a POST, possibly absent; GET invocations never have a body).
- The return value (may be async) **must be JSON-serializable** and becomes the HTTP response body verbatim; a thrown error surfaces to the caller as a 502.
- The handler **executes only inside the agent subprocess** — the function body never crosses the process boundary; the main process only receives the pure-data projection of `name` / `methods` / `description` (under the hood: an assembly-time declaration frame plus a dedicated request/result frame pair, riding the existing stdin/stdout JSONL channel).

**Assembly-time validation** (performed by the assembly layer; violations fail session creation):

- `name` must be non-empty, containing only lowercase letters, digits, and hyphens (`^[a-z0-9][a-z0-9-]*$`), and unique within one definition.
- `methods` allows only `"GET"` / `"POST"`; defaults to `["GET"]`.

**Invocation semantics** (the key points; for the full error-code table, the timeout / size-limit env vars, and curl examples, see [24 · HTTP API Reference](24-http-api-reference.md)):

- An invocation **does not trigger LLM inference, does not enter the conversation history, and produces no UI change whatsoever**; calls are accepted as usual while the session is busy (mid-inference).
- A handler can only be invoked through its declaration binding — an undeclared name → 404; the endpoints reuse the existing session auth gate (401/403 / session 404).
- Operators can disable the feature wholesale and tune the forwarding timeout and the POST body limit (`PI_WEB_AGENT_ROUTES_DISABLED` / `PI_WEB_AGENT_ROUTE_TIMEOUT_MS` / `PI_WEB_AGENT_ROUTE_BODY_LIMIT`; defaults and behavior are listed in full in chapter 24).

### File organization for declarative routes

As routes multiply, cramming them all into `index.ts` gets bloated. The convention:

- **1 route**: inline it in `index.ts`; no need to over-split.
- **≥2 routes, or a handler that grows complex**: extract into a `routes/` subdirectory.
  - **One route per file**: `routes/<route-name>.ts`, where the file name **=== the route `name` (kebab-case) === the URL segment**, so `/agent-routes/ping` maps at a glance to `routes/ping.ts`.
  - Each route file **co-locates** the handler + its `AgentRouteDecl`: the handler is `export`ed separately (for easy unit testing), and the decl is exported (named `<camelName>Route`) for the barrel to aggregate.
  - `routes/index.ts` is the **barrel**, assembling into an `AgentRouteDecl[]` in a stable order.
  - `index.ts` only does `import { routes } from "./routes/index.js"` and passes it to `defineAgent`, holding no handler logic.
  - Agent sources are loaded via jiti (NodeNext), so relative imports carry the `.js` suffix.

Canonical multi-route example: `examples/agent-routes-demo` (`ping` / `echo` / `whoami`, three routes).

```
examples/agent-routes-demo/
├── index.ts               # defineAgent; import { routes } from "./routes/index.js", no handler logic
├── routes/
│   ├── index.ts           # barrel: export const routes = [pingRoute, echoRoute, whoamiRoute]
│   ├── ping.ts            # pingHandler + pingRoute
│   ├── echo.ts            # echoHandler + echoRoute (GET·POST)
│   └── whoami.ts          # whoamiHandler + whoamiRoute
├── package.json
└── README.md
```

```ts
// routes/ping.ts — one route per file, handler + decl co-located
import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";

export function pingHandler(): unknown {
  return { pong: true };
}

export const pingRoute: AgentRouteDecl = {
  name: "ping",                          // === file name === URL segment
  description: "Liveness probe: returns { pong: true }",
  handler: pingHandler,
};

// routes/index.ts — barrel
import { pingRoute } from "./ping.js";
import { echoRoute } from "./echo.js";
import { whoamiRoute } from "./whoami.js";
export const routes: AgentRouteDecl[] = [pingRoute, echoRoute, whoamiRoute];

// index.ts — aggregate only
import { routes } from "./routes/index.js";
export default defineAgent({ /* … */ routes });
```

**Try it**: start a session with this directory as the agent source (`pi-web ./examples/agent-routes-demo`), grab the session id, and call over HTTP directly (no SSE subscription needed):

```bash
# liveness
curl http://127.0.0.1:3000/api/sessions/<id>/agent-routes/ping
# → {"pong":true}

# echo query
curl "http://127.0.0.1:3000/api/sessions/<id>/agent-routes/echo?foo=bar"
# → {"method":"GET","query":{"foo":"bar"},"body":null}

# echo POST body
curl -X POST http://127.0.0.1:3000/api/sessions/<id>/agent-routes/echo \
  -H 'content-type: application/json' -d '{"hello":"world"}'
# → {"method":"POST","query":{},"body":{"hello":"world"}}
```

The payoff: `index.ts` only says "what this agent is"; each route's logic/docs/types are concentrated in a same-named file that can be unit-tested independently; and URL ↔ file map one-to-one.

---

## Surface Authoritative State: a one-line pointer

If an agent needs to maintain a piece of **domain-authoritative state** (like Canvas's canvas/gallery) and let the frontend consume it in a CQRS single-writer way ("commands upstream + state snapshots downstream"), the author-side entry point is `createSurface` (`packages/tool-kit/src/surface/create-surface.ts`, loaded in `ExtensionFactory` form). It differs from this chapter's `getSessionState` (an unstructured session KV): a surface is an authoritative projection built per domain + structured command forwarding (bypassing the LLM). For the full concept, the `createSurface`/`useSurface`/`wireSurfaceBridge` API, and the Canvas end-to-end instance, see [04 · Surface Authoritative Stack](04-surface-stack.md); the author-side example is `examples/surface-demo-agent`.

---

## examples/ Directory Index

Repo path: `examples/` (for the master index and how to run each example, see [`examples/README.md`](https://github.com/blksails/pi-web/blob/main/examples/README.md))

| Subdirectory | One-line description |
|--------|-----------|
| `hello-agent` | Minimal complete example: custom `echo` tool + system prompt, with the built-in tool set disabled |
| `minimal-agent` | Zero-capability baseline: `defineMinimalAgent` preset, with noTools/skills/extensions all disabled |
| `builtin-tools-agent` | Enables pi's built-in tool set (the opposite posture to hello-agent's `noTools: "builtin"`) |
| `state-bridge-agent` | Two-sided session-shared-state example: AI-side `increment`/`read_state` tools + human-side `.pi/web` writing back the same piece of live state |
| `agent-routes-demo` | Multi-route declarative HTTP routes example: a `routes/` subdirectory with one route per file (`ping`/`echo`/`whoami`), directly curl-able |
| `aigc-agent` | Assembles `extensions: [aigcExtension, visionExtension]` (`image_generation` / `image_edit` / `image_vision`), demonstrating the AIGC + vision + attachment seams |
| `vision-agent` | Vision-recognition focus: `image_vision` tool + `/img_vision` command |
| `attachment-tool-agent` | Demonstrates the attachment-tool-bridge: a custom image tool persists its outputs to the attachment store via `AttachmentToolContext` |
| `file-session-agent` | A minimal agent paired with the file-store session demo (session storage is runtime configuration, not part of the AgentDefinition) |
| `pi-probe-agent` | A probe agent used to verify that `.pi/` project-level resources (extensions/skills) are correctly discovered and loaded |
| `surface-demo-agent` | Surface authoritative-state author-side example (`createSurface`; see chapter 04) |
| `server-driven-ui-agent` | Calls `emitUi(onUpdate, spec)` within a tool's `execute` to emit a `UiSpec`, with zero-config rendering on the frontend |
| `system-status-agent` | Combines server-driven UI + ambient status/notifications; one tool demonstrates both paths at once |
| `ui-demo-agent` | Demonstrates all of the extension UI interaction surfaces (`ctx.ui.*`: status push, ambient notifications, etc.) |
| `webext-*` (a group) | `.pi/web` WebExtension Tier 1–5 layer examples (background/region slots/renderer/contribution points/artifact/declarative/runtime code); see [12 · Web UI Extension](12-web-ui-extension.md) |

### Learning Path (easy to hard)

The table below strings the core concepts covered in "Custom Agent Development" above into a hands-on route from shallow to deep, each mapped to one runnable example. We recommend running them through in order:

| Order | Example | Concepts you'll learn | Corresponding section in this chapter |
|------|------|---------------|-------------|
| 1 | `examples/minimal-agent` | `defineMinimalAgent` preset / `noTools: "all"` zero-capability baseline | Core Concepts, Minimal Baseline |
| 2 | `examples/hello-agent` | Custom `defineTool` + `systemPrompt`, `noTools: "builtin"` (e2e target) | hello-agent Example |
| 3 | `examples/builtin-tools-agent` | Using the `tools` allowlist to enable pi's built-in filesystem/shell tool set | `noTools` / `tools` Fields |
| 4 | `examples/state-bridge-agent` | `getSessionState()` reading/writing session-shared state (human-machine co-driving) | Session-Shared State |
| 5 | `examples/agent-routes-demo` | `routes` declarative HTTP endpoints + `routes/` file organization | Declarative HTTP Routes |
| 6 | `examples/server-driven-ui-agent` | `emitUi(onUpdate, spec)` emits `data-pi-ui`, with zero-config frontend rendering | `emitUi` |

> The table above is the recommended order for the "Custom Agent Development" main line; `aigc-agent`, `vision-agent`, `attachment-tool-agent`, `surface-demo-agent`, and the `webext-*` series are specialized topics, covered respectively in [11 · AIGC & Vision Tools](11-aigc-and-vision-tools.md), [09 · Attachment System](09-attachment-system.md), [04 · Surface Authoritative Stack](04-surface-stack.md), and [12 · Web UI Extension](12-web-ui-extension.md). For the full list and how to run each, see [`examples/README.md`](https://github.com/blksails/pi-web/blob/main/examples/README.md).

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
              ├─ wireStateBridge(runtime)       # session-shared-state bridge wiring (getSessionState seam)
              ├─ wireSurfaceBridge(runtime)     # Surface authoritative-state bridge wiring (see chapter 04)
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
6. **(Optional) Declare the extension surfaces**: use `routes` for HTTP endpoints (see "Declarative HTTP Routes"), `slashCompletions` for `/` completion prompts, and `getSessionState()` inside a tool for human-machine shared state.
7. **Enable hot reload** (when editing tool-kit source): set `PI_RUNNER_HOT_RELOAD=1`; to edit the agent's own `index.ts`, use `pi-web --watch /path/to/my-agent`. Changes automatically restart the runner while idle and resume the session, with no need to manually open a new session.

**Common error remedies**:

| Symptom | Likely cause | Remedy |
|------|---------|------|
| `module has no default export` | `index.ts` has no `export default`, or exports only named exports | Confirm the default export is an `AgentDefinition` object / factory / branded factory |
| Model call 401 / auth failure | The provider specified by an explicit `model` has no valid credentials | Drop `model` to use the default, or provision auth for that provider; see [23 · Troubleshooting §2.1](23-troubleshooting-faq.md) |
| Code changes don't take effect | The runner is a resident subprocess and imports only once | Enable hot reload (see step 7) or manually open a new session |
| `getSessionState().available === false` | Called outside the subprocess / bridge wiring, or on the frontend | Call it only inside a tool's `execute`; read state on the frontend via `useExtensionState` |

For more troubleshooting, see [23 · Troubleshooting FAQ](23-troubleshooting-faq.md).

---

## Related Links

- [02 · Core Concepts](02-core-concepts.md) — AgentDefinition, runner, the session model
- [03 · Architecture](03-architecture.md) — runner subprocess isolation and the RPC channel
- [04 · Surface Authoritative Stack](04-surface-stack.md) — the overall architecture of `createSurface` / the `getSessionState` state bridge, and the Canvas instance
- [10 · Extensions & Skills](10-extensions-and-skills.md) — detailed coverage of the `extensions` / `allowExtensions` / `skills` fields
- [11 · AIGC & Vision Tools](11-aigc-and-vision-tools.md) — `aigcExtension` / `visionExtension` and the aigc-agent integration pattern
- [12 · Web UI Extension (WebExtension)](12-web-ui-extension.md) — the `.pi/web` Tier 1–5 UI extension system
- [09 · Attachment System](09-attachment-system.md) — `AttachmentToolContext` and the attachment-tool-bridge
- [18 · CLI](18-cli.md) — `pi-web --watch` and command-line arguments
- [24 · HTTP API Reference](24-http-api-reference.md) — the agent-routes invocation surface, error codes/env, and the `POST /sessions/:id/state` write-back endpoint
- [23 · Troubleshooting FAQ](23-troubleshooting-faq.md) — remedies for agent load failures, provider auth, hot reload not taking effect, and more
