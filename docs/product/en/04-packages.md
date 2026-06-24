# 04 · Packages and Dependencies

pi-web consists of 7 independently publishable npm packages, with a single, converging dependency direction: `@blksails/pi-web-protocol` is the contract root, every package depends on it one-directionally, and there is no reverse reference between backend and frontend.

---

## Dependency Overview

```
@blksails/pi-web-protocol  (contract root, zero runtime dependencies)
    ├── @blksails/pi-web-server          (Node only)
    ├── @blksails/pi-web-agent-kit       (Node only, lightweight helper)
    │       └── @blksails/pi-web-tool-kit        (declaration layer + runtime layer)
    └── @blksails/pi-web-kit         (author-side UI control layer SDK)
            └── @blksails/pi-web-react   (headless hooks)
                    └── @blksails/pi-web-ui      (AI Elements component library)
```

Core attributes of each package:

| Package | Directory | Runtime | Publish form | Status |
|---|---|---|---|---|
| `@blksails/pi-web-protocol` | `packages/protocol/` | Isomorphic (browser/Node) | ✅ | Implemented |
| `@blksails/pi-web-server` | `packages/server/` | Node ≥22.19 | ✅ | Implemented |
| `@blksails/pi-web-react` | `packages/react/` | Browser (SSR-safe) | ✅ | Implemented |
| `@blksails/pi-web-ui` | `packages/ui/` | Browser (SSR-safe) | ✅ | Implemented |
| `@blksails/pi-web-agent-kit` | `packages/agent-kit/` | Node (dev/runtime optional) | ✅ | Implemented |
| `@blksails/pi-web-tool-kit` | `packages/tool-kit/` | Main entry isomorphic / `./runtime` Node only | ✅ | Implemented |
| `@blksails/pi-web-kit` | `packages/web-kit/` | Browser (build-time) | ✅ | Implemented |
| `@blksails/embed` | _(not created)_ | Browser | 🔲 | Planned |

> **Note on publish form**: In the table, ✅ indicates the package is intended for public release (`package.json` is non-`private`), but all 7 packages are **not yet published to npm**. Inside the repository they consume each other exclusively via pnpm `workspace:*`, with a unified version of `0.1.0`. The `publishConfig` required for publishing (the `dist` build artifact + `types`/`import` mappings) is currently **fully configured only for `@blksails/pi-web-protocol`**; the rest still need to be completed before publishing.
>
> `@blksails/embed` (Web Component `<pi-web-chat>` + iframe widget) is listed under the roadmap `embed-integrations` and has not yet entered this implementation batch.

---

## Package Details

### @blksails/pi-web-protocol

**Responsibility**: The single contract root for the whole project. Defines RPC types/schemas, SSE frames, UIMessage data-part, REST DTOs, attachment descriptors, the config form IR (`config/`), and the agent-web-extension control-layer contract (`web-ext/`).

**Runtime dependencies**: Only `zod` (zero other runtime dependencies), isomorphic, safe to bring into a browser bundle.

**Export surface** (`packages/protocol/src/index.ts`):

| Submodule | Main exports |
|---|---|
| `version` | `protocolVersion`, `ProtocolVersion` |
| `rpc/*` | RPC model/command/response/event/extension-ui/session-state |
| `transport/*` | `SpawnSpec`, `UiSpec`, `DataPart`, `UiMessageChunk`, SSE frames, REST DTO, completion DTO |
| `attachment/` | `AttachmentDto` and upload response DTOs |
| `config/` | Config form IR + adapter + config-domain contract |
| `web-ext/` | WebExtension manifest / ui-rpc / descriptor / artifact contracts |

**exports field**:

```json
{
  ".": "./src/index.ts"
}
```

> Protocol changes must follow semantic versioning; SSE frames carry `protocolVersion` for runtime compatibility detection.

---

### @blksails/pi-web-server

**Responsibility**: The backend engine. Contains six modules: agent source resolution, bootstrap runner path resolution, the RPC channel, session registry and translation, the HTTP route handler abstraction, attachment storage (L0/L1), the attachment tool-bridge (L2), the completion interface, and extension management.

**Runtime dependencies**: `@blksails/pi-web-protocol`, `@earendil-works/pi-ai` (≥0.79.6), `@earendil-works/pi-coding-agent` (≥0.79.6), `jiti`, `pg`, `zod`. Node ≥22.19 only.

**exports field** (three export subpaths):

```json
{
  ".":               "./src/index.ts",
  "./trust":         "./src/trust/index.ts",
  "./model-options": "./src/config/model-options.ts"
}
```

**The six modules aggregated by the main entry (`.`)** (`packages/server/src/index.ts`):

| Module | Path | Description |
|---|---|---|
| `rpc-channel` | `./rpc-channel/index.js` | `PiRpcChannel` interface + `PiRpcProcess` local impl (child_process JSONL framing) |
| `agent-source` | `./agent-source/index.js` | Agent source resolution (directory\|git) + entry detection + dual-mode determination + `SpawnSpec` generation |
| `session` | `./session/index.js` | `PiSession` (event broadcasting + lifecycle) + event → UIMessage translation |
| `session-store` | `./session-store/index.js` | `SessionStore`/Registry in-memory impl (interface externalized for extension) |
| `http` | `./http/index.js` | Framework-agnostic `createPiWebHandler` (Web Fetch API), REST + SSE routes |
| `extensions` | `./extensions/index.js` | Extension install/list/uninstall + source allowlist + command palette integration |

Additional standalone exports:
- `attachment` / `attachment-bridge` — Attachment system L0-L2 (all pure node builtins, safe to re-export through the barrel)
- `completion` — Completion DTO routes
- `config` — Config reading and the model-options factory
- `resolveSandboxEntry` — Sandbox entry resolution
- `runnerBootstrapPath` — Runner subprocess bootstrap script path

> **Note**: The `./runner` subpath is **not** re-exported from the main-entry barrel, to prevent Next.js/webpack from bundling the pi SDK into the route bundle. The runner is loaded only by `runner-bootstrap.mjs` in the subprocess via `jiti`.

**`./trust` subpath**: Exports the trust policy (`FsProjectTrustStore`), reads/writes `<agentDir>/trust.json`, has zero pi SDK value dependencies, and is kept as a stable, explicit trust surface.

**`./model-options` subpath**: Exports the model-options factory, used by Next.js routes to obtain the list of available models.

---

### @blksails/pi-web-react

**Responsibility**: The headless client layer. Provides the transport, REST client, SSE connection management, and React hooks — unstyled, with no JSX components.

**Dependencies**: `@blksails/pi-web-protocol`, `@blksails/pi-web-kit`; peer deps: `react`, `ai` (AI SDK v5), `@ai-sdk/react`.

**Main exports**:

| Category | Key symbols |
|---|---|
| transport | `PiTransport` (AI SDK v5 `ChatTransport` impl), `uploadAttachment` |
| client | `createPiClient`, `PiClient`, `PiHttpError`, `PiProtocolVersionError` |
| SSE | `PiSessionConnection`, `ControlStore`, `parseSse`, `decodeUiMessageChunk` |
| provider | `PiProvider`, `usePiContext` |
| hooks | `usePiSession`, `usePiControls`, `useExtensionUI`, `useModels`, `useAttachments`, `useBranches`, `useSuggestions` |
| web-ext | `verifyExtension`, `loadExtension`, `buildImportMap`, `createUiRpcBus` |
| config | Config form state + settings panel registry + domain IO |

**exports field**:

```json
{ ".": "./src/index.ts" }
```

---

### @blksails/pi-web-ui

**Responsibility**: The AI Elements component library (styled). Built on shadcn/ui + Tailwind CSS, it provides `<PiChat>`, tool widgets, reasoning blocks, the prompt input box, model/thinking/stats control panels, permission prompts, and the schema-driven config UI (renderer registry + searchable dropdown).

**Dependencies**: `@blksails/pi-web-protocol`, `@blksails/pi-web-react`, `@blksails/pi-web-kit`; external UI libraries: `@radix-ui/*`, `cmdk`, `lucide-react`, `streamdown`, `clsx`, `tailwind-merge`.

**exports field**:

```json
{
  ".":           "./src/index.ts",
  "./styles.css": "./src/styles.css"
}
```

> Consumers must also import `@blksails/pi-web-ui/styles.css` (the Tailwind styles entry).

Storybook development is supported: `pnpm --filter @blksails/pi-web-ui storybook` (port 6006).

---

### @blksails/pi-web-agent-kit

**Responsibility**: A lightweight helper package for custom agent authors. `defineAgent()` is a pure identity function that provides only compile-time type checking with zero runtime side effects — even if you don't use this package, the `AgentDefinition` structure you define is fully compatible with what the runner requires.

**Dependencies**: `@blksails/pi-web-protocol`; peer dep: `@earendil-works/pi-coding-agent` (types only).

**Main exports**:

```typescript
// definition entry
export function defineAgent(def: AgentDefinition): AgentDefinition

// types
export type { AgentDefinition, AgentContext, AgentModel }
export type { ToolDefinition, SystemPromptValue, ThinkingLevel, ... }

// convenience
export { defineMinimalAgent, minimalAgentPreset }
export { emitUi }                    // emit a data-pi-ui widget from within a tool

// attachment tool context (types only; runtime construction lives in @blksails/pi-web-server)
export type { AttachmentToolContext, AttachmentToolHandle, ... }
```

**Usage example**:

```typescript
// <agent-dir>/index.ts
import { defineAgent } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  // Omit model → inherit the default provider/model from ~/.pi/agent/settings.json, works out of the box.
  // To pin a model: model: { provider: "anthropic", modelId: "claude-opus-4-5" }
  // (but the corresponding provider must have valid credentials, otherwise the LLM call will fail).
  systemPrompt: "You are a helpful assistant.",
});
```

> You can directly refer to the repository's `examples/hello-agent/index.ts:1` (a minimal runnable agent with a custom `echo` tool). For detailed usage, see [07 · Agent Development](./07-agent-development.md).

---

### @blksails/pi-web-tool-kit

**Responsibility**: A general-purpose tooling kit. Split into two layers — the main entry (frontend-safe declaration layer) and the `./runtime` sub-entry (Node-only runtime layer).

**Dependencies**: `@blksails/pi-web-agent-kit`, `undici` (runtime layer); peer deps: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`.

**exports field**:

```json
{
  ".":         "./src/index.ts",    // declaration layer, frontend-safe
  "./runtime": "./src/runtime.ts"   // runtime layer, Node only
}
```

**Main entry (declaration layer)**:

```typescript
export * from "./engine/types.js"         // engine types
export { AIGC_TOOLS, imageGeneration, imageEdit }  // AIGC tool declarations
```

**`./runtime` sub-entry (runtime layer)**:

| Category | Key symbols |
|---|---|
| engine | `runEndpoint`, `resolveVars`, `proxyFetch` |
| attachment | `getAttachmentToolContext`, `persistPicked`, `resolveInputToDataUri` |
| tool compilation | `compileTool` |
| AIGC tool set | `buildAigcTools`, `AIGC_TOOLS` |

> Any logic containing pi SDK value imports must go into `./runtime` and must never be mixed into the main entry, in order to guard the Next/webpack externals boundary.

---

### @blksails/pi-web-kit

**Responsibility**: The author-side SDK (UI control layer) for an agent source's `.pi/web`, symmetric with `@blksails/pi-web-agent-kit` — `defineAgent()` corresponds to `defineWebExtension()`. The author writes the `.pi/web` entry with a default-exported `WebExtension`; the `pi-web build` CLI shipped with the package pre-builds it into an ESM bundle + manifest.

**Dependencies**: `@blksails/pi-web-protocol`, `esbuild` (build tool); peer deps: `react`, `ai`.

**exports field**:

```json
{
  ".":       "./src/index.ts",
  "./build": "./build/index.ts"    // build CLI entry
}
```

**bin entry**: `pi-web` → `./build/cli.ts`

**Main exports** (stable core):

```typescript
export { defineWebExtension }         // identity helper + types
export type { WebExtension, SlotContribution, ContributionPoints, ... }
export { SLOTS }                      // slot constants table
export type { UiRpcClient }           // host↔extension RPC types
export type { WebExtHostContext }
// protocol re-export (serializable contract)
export type { SlotKey, WebExtConfig, ArtifactDeclaration, UiRpcPoint, ... }
```

**Usage example**:

```tsx
// <agent-dir>/.pi/web/web.config.tsx
import { defineWebExtension } from "@blksails/pi-web-kit";

export default defineWebExtension({
  manifestId: "my-ext",            // required: unique extension id
  capabilities: ["slots"],
  slots: {
    // SlotKey is camelCase (panelRight / headerLeft / artifactSurface …);
    // the contributed value can be a ReactNode, or a component taking { extId } props.
    panelRight: <MyPanel />,
  },
});
```

> Slot keys are taken from the `SLOTS` constants table (`SLOTS.panelRight`, etc.), or you may write the literal directly; for the full set of available slots see `packages/web-kit/src/slots.ts:8` and [10 · Web UI Extension](./10-web-ui-extension.md). For a complete runnable example, see the repository's `examples/webext-slots-agent/.pi/web/web.config.tsx:1`.

---

## Planned Packages

| Package | Planned spec | Description |
|---|---|---|
| `@blksails/embed` | `embed-integrations` | Web Component `<pi-web-chat>` + iframe widget, supporting embedding into non-React projects |

---

## Dependency Direction Cheat Sheet

```
@blksails/pi-web-protocol  ←──────── all packages
@blksails/pi-web-server    ───depends──→ @blksails/pi-web-protocol only
@blksails/pi-web-agent-kit ───depends──→ @blksails/pi-web-protocol only
@blksails/pi-web-tool-kit  ───depends──→ @blksails/pi-web-agent-kit
@blksails/pi-web-kit   ───depends──→ @blksails/pi-web-protocol
@blksails/pi-web-react     ───depends──→ @blksails/pi-web-protocol + @blksails/pi-web-kit
@blksails/pi-web-ui        ───depends──→ @blksails/pi-web-protocol + @blksails/pi-web-react + @blksails/pi-web-kit

Forbidden: server ↔ react/ui (backend and frontend do not depend on each other)
Forbidden: protocol depending in reverse on any package
```

---

## Next Steps / Related Docs

- [03 · Architecture Overview](./03-architecture.md) — runtime topology and process boundaries of each package
- [05 · Configuration Reference](./05-configuration.md) — `@blksails/pi-web-server/model-options` and environment variables
- [07 · Agent Development](./07-agent-development.md) — detailed usage of `@blksails/pi-web-agent-kit` and `defineAgent()`
- [09 · Extensions and Skills](./09-extensions-and-skills.md) — `@blksails/pi-web-kit` and `defineWebExtension()`
- [11 · AIGC Tools](./11-aigc-tools.md) — `buildAigcTools` from `@blksails/pi-web-tool-kit/runtime`
- [13 · HTTP API Reference](./13-http-api-reference.md) — route conventions of the `@blksails/pi-web-server` HTTP module
