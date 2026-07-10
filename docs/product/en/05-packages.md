# 05 · Layered Packages

pi-web is composed of **11** independently publishable `@blksails/*` npm packages, with a single, converging dependency direction. The true zero-dependency leaf root is `@blksails/pi-web-logger` (`deps: {}`); the contract package `@blksails/pi-web-protocol` depends on it one-directionally; and there is no reverse reference between the backend (server) and the frontend (react/ui).

> **Naming convention**: Except for logger, every published name carries the `pi-web` infix (e.g. `@blksails/pi-web-protocol`). The only mismatch between directory name and published name is `packages/web-kit/`, whose published name is **`@blksails/pi-web-kit`** (no `web`) — see `packages/web-kit/package.json:2`. This chapter refers to packages by their published names in prose, and by their directory names in paths.

---

## Dependency Overview

```
@blksails/pi-web-logger      (true zero-dependency leaf root, deps:{})
    ▲
    ├── @blksails/pi-web-protocol       (contract root → logger + zod)
    │       ├── @blksails/pi-web-server        (Node only)
    │       ├── @blksails/pi-web-agent-kit     (agent-author side)
    │       │       └── @blksails/pi-web-tool-kit    (declaration layer + ./runtime execution layer)
    │       └── @blksails/pi-web-kit           (webext-author side SDK)
    │               └── @blksails/pi-web-react       (headless hooks)
    │
@blksails/pi-web-primitives  (zero @blksails deps, thin shadcn wrapper base)
@blksails/pi-web-canvas-kit  (zero @blksails deps, Canvas L2 kernel)
    │
    └── @blksails/pi-web-canvas-ui      (canvas-kit + web-kit + primitives + react + tool-kit)
            └── @blksails/pi-web-ui          (component library aggregating 8 @blksails packages)
```

The core attributes of each package are as follows (all at `version: 0.1.0`, consuming each other inside the repo via pnpm `workspace:*`):

| Package | Directory | Runtime | Responsibility in one line |
|---|---|---|---|
| `@blksails/pi-web-logger` | `packages/logger/` | Isomorphic | Zero-dependency isomorphic structured logging library (leaf root of the whole dependency tree) |
| `@blksails/pi-web-protocol` | `packages/protocol/` | Isomorphic | Project-wide contract root: RPC/SSE/DTO/config/web-ext schemas |
| `@blksails/pi-web-server` | `packages/server/` | Node ≥22.19 | Backend engine: sessions/RPC/HTTP/attachments/extensions |
| `@blksails/pi-web-react` | `packages/react/` | Browser (SSR-safe) | Headless transport + client + hooks |
| `@blksails/pi-web-ui` | `packages/ui/` | Browser (SSR-safe) | Styled AI Elements component library + i18n + config UI |
| `@blksails/pi-web-agent-kit` | `packages/agent-kit/` | Node (optional) | `defineAgent()` and agent types |
| `@blksails/pi-web-tool-kit` | `packages/tool-kit/` | Main entry isomorphic / `./runtime` Node only | AIGC/vision tool execution layer, surface, state seam |
| `@blksails/pi-web-kit` | `packages/web-kit/` | Browser / build-time | `defineWebExtension()` + `pi-web build` CLI + SurfaceOp canonical |
| `@blksails/pi-web-primitives` | `packages/primitives/` | Browser | 6 thin shadcn wrappers + `cn` |
| `@blksails/pi-web-canvas-kit` | `packages/canvas-kit/` | Browser | Canvas L2 kernel (triad + 8 built-in tools + kernel facade) |
| `@blksails/pi-web-canvas-ui` | `packages/canvas-ui/` | Browser | Canvas domain components (workbench/gallery/generate actions/vision) |

> **Note on publish form**: All 11 packages above are intended for public release (`private:false` or unset `private`, most with `publishConfig.access:public`), but **none has been published to npm yet**; inside the repository they consume each other exclusively via `workspace:*`. The `publishConfig` required for publishing (the `dist` build artifact plus `types`/`import` mappings) is currently fully configured only for `@blksails/pi-web-logger` (`main`/`types`/`exports` all point at `./dist/*`); the rest (including `@blksails/pi-web-protocol`) mostly declare only `publishConfig.access:public` and still need their `dist` mappings completed before publishing.

---

## Package Details

### @blksails/pi-web-logger

**Responsibility**: An isomorphic (browser/Node) structured logging library — the only `deps: {}` **zero-runtime-dependency leaf root** in the entire dependency tree, consumed jointly by protocol/server/react/agent-kit/tool-kit/web-kit/ui. It has no static Node-only imports and is safe to bring into a browser bundle.

**Dependencies**: none. **exports**: `{ ".": "./src/index.ts" }`.

**Main exports** (`packages/logger/src/index.ts`): `createLogger`, `configureLogger`/`getRuntimeConfig`/`initConfigFromEnv`, `isLevelEnabled`/`isNamespaceEnabled`, the Node sink (`nodeSink`/`serializeLogLine`/`LOG_SENTINEL`), the file sink (`createFileSink`), the browser bus (`browserSink`/`subscribeBrowserLogs`/`getBrowserLogs`), and `getDefaultSink`. For runtime behavior see [21 · Logging](21-logging.md).

---

### @blksails/pi-web-protocol

**Responsibility**: The project-wide contract root. It defines the RPC types/schemas, SSE frames, UIMessage data-parts, REST DTOs, attachment descriptors, the config form IR (`config/`), the agent-web-extension control-layer contract (`web-ext/`), and the agent declarative-routes triad frames (`agent-routes/`).

**Dependencies**: `@blksails/pi-web-logger` + `zod` (`packages/protocol/package.json`). Isomorphic, safe to bring into a browser bundle. **exports**: `{ ".": "./src/index.ts" }`.

**Export surface** (`packages/protocol/src/index.ts`):

| Submodule | Main exports |
|---|---|
| `version` | `protocolVersion`, `ProtocolVersion` |
| `rpc/*` | model/command/response/event/extension-ui/session-state |
| `transport/*` | `SpawnSpec`, `UiSpec`, `DataPart`, `UiMessageChunk`, `session-status`, `session-state`, `sse-frame`, REST DTO, completion DTO, `slash-completion` |
| `agent-routes/` | Declarative route DTO + triad-frame contract (`AgentRoutesFrame`, etc.) |
| `attachment/` | `AttachmentDto` and upload response DTOs |
| `config/` | Config form IR + adapter + config-domain contract |
| `web-ext/` | WebExtension manifest / ui-rpc / descriptor / artifact / surface contracts |

> Protocol changes follow semantic versioning; SSE frames carry `protocolVersion` for runtime compatibility detection. The `surfaceStateKey`/`SurfaceCommandPayload`/`SurfaceCommandResult` in `web-ext/surface.ts` are the contracts for the Surface communication plane — see [04 · Surface Authoritative Stack](04-surface-stack.md).

---

### @blksails/pi-web-server

**Responsibility**: The backend engine. It contains modules for agent source resolution, runner startup path resolution, the RPC channel, session registry and translation, the HTTP route handler abstraction, attachment storage (L0/L1), the attachment tool-bridge (L2), the completion interface, extension management, and more.

**Dependencies**: `@blksails/pi-web-logger`, `@blksails/pi-web-protocol`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` (both ≥0.80.3), `jiti`, `pg`, `zod`. Node ≥22.19 only.

**exports (4 subpaths)**:

```json
{
  ".":                     "./src/index.ts",
  "./trust":               "./src/trust/index.ts",
  "./model-options":       "./src/config/model-options.ts",
  "./vision-model-options":"./src/vision-settings/vision-model-options.ts"
}
```

The main entry (`.`) aggregates the session/RPC/HTTP/attachment modules. Its core is the framework-agnostic `createPiWebHandler` (Web Fetch API: takes a standard `Request`, returns a `Response`, with an SSE `ReadableStream` body), carried by a single `app.all('/api/*')` forward in the Hono host `server/index.ts` — see [03 · Architecture](03-architecture.md) and [24 · HTTP/SSE API Reference](24-http-api-reference.md).

- `./trust`: the trust policy `FsProjectTrustStore`, which reads/writes `<agentDir>/trust.json` and has zero pi SDK value dependencies.
- `./model-options`: the text-model enumeration factory ([07 · Providers and Models](07-providers-and-models.md)).
- `./vision-model-options`: the vision-model enumeration factory used by `GET /vision/models` ([11 · AIGC and Vision Tools](11-aigc-and-vision-tools.md)).

> **Barrel discipline** (`packages/server/src/index.ts:3-8`): the `./runner` subpath is **not** re-exported from the main-entry barrel. When loaded, the runner statically imports the entire pi SDK; if it went through a barrel `export *`, the SDK would get bundled into the built artifact and break the esbuild external boundary. The runner is loaded only by `runner-bootstrap.mjs` inside the subprocess, via `jiti` loading `./runner/runner.ts`; the App/Handler never import the runner directly.

---

### @blksails/pi-web-react

**Responsibility**: The headless client layer. It provides the transport, REST client, SSE connection management, and React hooks — no styling, no JSX components.

**Dependencies**: `@blksails/pi-web-logger`, `@blksails/pi-web-protocol`, `@blksails/pi-web-kit`; peers: `react`, `ai` (AI SDK v5), `@ai-sdk/react`. **exports**: `{ ".": "./src/index.ts" }`.

**Main exports**:

| Category | Key symbols |
|---|---|
| transport | `PiTransport` (AI SDK v5 `ChatTransport` impl), `uploadAttachment` |
| client | `createPiClient`, `PiClient`, `PiHttpError`, `PiProtocolVersionError` |
| SSE | `PiSessionConnection`, `ControlStore`, `parseSse`, `decodeUiMessageChunk` |
| provider | `PiProvider`, `usePiContext` |
| hooks | `usePiSession`, `usePiControls`, `useExtensionUI`, `useModels`, `useAttachments`, `useBranches`, `useSuggestions` |
| surface | `useSurface`, `useConversationBridge` (see [04](04-surface-stack.md)) |
| web-ext | `verifyExtension`, `loadExtension`, `buildImportMap`, `createUiRpcBus` |
| config | Config form state + settings panel registry + domain IO |

---

### @blksails/pi-web-ui

**Responsibility**: The AI Elements component library (styled). Built on shadcn/ui + Tailwind CSS, it provides `<PiChat>`, tool widgets, reasoning blocks, the prompt input box, the model/thinking/stats control panels, permission prompts, plus the schema-driven config UI (renderer registry + searchable dropdown) and an in-house i18n.

**Dependencies**: this is the widest dependency surface in the whole repo — it aggregates **8 `@blksails` packages** (canvas-kit, canvas-ui, logger, primitives, protocol, react, pi-web-kit, tool-kit) plus `@radix-ui/*`, `cmdk`, `lucide-react`, `streamdown`, `rehype-sanitize`, `clsx`, `tailwind-merge`; peers: `react`, `react-dom`, `ai`, `@ai-sdk/react`.

**exports**:

```json
{ ".": "./src/index.ts", "./styles.css": "./src/styles.css" }
```

> Consumers must also import `@blksails/pi-web-ui/styles.css` (the Tailwind styles entry). Storybook development: `pnpm --filter @blksails/pi-web-ui storybook` (port 6006).

#### In-house i18n runtime

`@blksails/pi-web-ui` ships a **lightweight, in-house internationalization runtime** (`packages/ui/src/i18n/`), deliberately avoiding `react-i18next`/`formatjs`: the dictionary is a plain object, translation is a pure string-table lookup, isomorphic and with zero runtime dependencies, exported together with the component library through the whole-package barrel.

- **Dictionary structure**: `Locale` is `"zh"`/`"en"`, each a `Record<string, string>` (`packages/ui/src/i18n/messages.ts`); keys use dot-separated `domain.subitem` naming, and the two tables are maintained in parallel against the same set of keys.
- **The `t()` contract** (the `translate` in `packages/ui/src/i18n/context.tsx`): **never throws**; **missing-key fallback** order is "current locale → `zh` → return the key verbatim"; **parameter substitution** interpolates `{name}` placeholders, leaving missing parameters as-is, with no ICU plural/date support.
- **Defaults to zh without a Provider**: `useI18n()` does not require an outer Provider — the `defaultContext` of `I18nContext` is bound directly to `translate("zh", …)`. Language switching only appears once `I18nProvider` is mounted: after client mount it reads the preference back from the `pi-web.locale` key in `localStorage`, and `setLocale` writes it back to persist.
- **The switching UI belongs to the host app layer**: the component library exports only the three primitives `I18nProvider`/`useI18n`/`useLocale`; switching controls such as `LocaleToggleButton` are assembled by the integrator.

**Usage note for component authors**: when a piece of text has a corresponding **overridable prop**, do not write `t("…")` as a destructured parameter default (it would be frozen when `t` is unavailable and would not change with locale). The convention is to receive the prop as `undefined` (e.g. `xxxProp`), then fall back to `t()` with `??` inside the function body:

```tsx
// packages/ui/src/chat/pi-chat.tsx (convention example)
function PiChat({ emptyTitle: emptyTitleProp /* … */ }: PiChatProps) {
  const t = useI18n();
  const emptyTitle = emptyTitleProp ?? t("chat.empty.title"); // pushed into the function body
  // …
}
```

Purely internal text with no corresponding prop can just use `t("…")` directly.

---

### @blksails/pi-web-primitives

**Responsibility**: The lowered thin-shadcn-wrapper base — six components `Button`/`Card`/`Input`/`Popover`/`Select`/`Textarea` plus the `cn` className merge utility, forming the shared UI primitive layer for ui / canvas-ui. Semantics match the pre-migration `packages/ui/src/ui/*` one-for-one; all theming is expressed through design tokens (CSS variables), and this package introduces no independent theming system.

**Dependencies**: **zero `@blksails` deps** (`@radix-ui/react-popover`/`react-select`, `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`; peer `react`). **exports**: `{ ".": "./src/index.ts" }`.

**Exports** (`packages/primitives/src/index.ts`, explicit manifest, no `export *`): `Button`/`buttonVariants`, `Card`, `Input`, `Popover` (with `PopoverAnchor`/`PopoverContent`/`PopoverTrigger`), `Select` (with `SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue`/`SelectGroup`), `Textarea`, `cn`.

---

### @blksails/pi-web-canvas-kit

**Responsibility**: The Canvas **L2 developer-facing kernel** — the plugin triad contract, the per-instance registry, the 8 built-in drawing tools, and the interaction-kernel assembly facade. The `kernel/` L1 internals (stage/pointer/history/layers/tool-runtime) are **deliberately not exported**, so L1 can be freely refactored without a breaking change. For plugin-author usage see [17 · Canvas Plugins](17-canvas-plugins.md).

**Dependencies**: **zero `@blksails` deps** (`lucide-react`; peer `react`) — the dependency direction is ui/canvas-ui consuming canvas-kit, and the reverse is forbidden. **exports**: `{ ".": "./src/index.ts" }`.

**Export surface** (`packages/canvas-kit/src/index.ts`):

| Category | Key symbols |
|---|---|
| actions | `defineCanvasAction`, `resolveAction` (scoring-based decider) |
| layers | `defineCanvasLayer`, `registerPluginBundles` (namespace prefix + requires topology check) |
| tools | `defineCanvasTool`, `createCanvasRegistry` |
| built-in tools | `registerBuiltinTools` (the eight arrow/draw/erase/expand/line/mask/move/text, individual tools not exported) |
| kernel facade | `createCanvasKernel` (consolidates stage/history/layers/pointer/renderOverlay assembly) |
| bitmap | `bitmap-io.js` (`export *`) |

---

### @blksails/pi-web-canvas-ui

**Responsibility**: The canonical home of Canvas domain components — the re-creation workbench editor, the gallery, the six built-in generate actions, and the vision "readout" entry. It is the package that carries the frontend reference implementation of the Surface communication plane (`CanvasWorkbench` uses `useConversationBridge`/`buildSurfaceOp`/`renderSurfaceOp`). For the full user/integrator-facing description see [16 · Canvas Workbench](16-canvas-workbench.md).

**Dependencies** (forming a full dependency-chain layer): `@blksails/pi-web-canvas-kit`, `@blksails/pi-web-kit`, `@blksails/pi-web-primitives`, `@blksails/pi-web-react`, `@blksails/pi-web-tool-kit` + `lucide-react`; peer `react`. **exports**: `{ ".": "./src/index.ts", "./styles.css": "./src/styles.css" }`.

**Export surface** (`packages/canvas-ui/src/index.ts`, explicit manifest):

| Category | Key symbols |
|---|---|
| workbench | `CanvasWorkbench`, `decideGenerate`, `buildSurfaceOp`, `buildToolPrompt`, `composeInpaintBack` |
| gating/assembly | `CanvasLauncher`, `CanvasPanel`, `isCanvasEnabled` (reads `NEXT_PUBLIC_PI_WEB_CANVAS`, off by default, see [06](06-configuration.md)) |
| gallery | `CanvasGallery` (the `domain="canvas"` Surface projection, see [04](04-surface-stack.md)) |
| generate actions | `BUILTIN_GENERATE_ACTIONS`, `registerBuiltinGenerateActions` (the six outpaint/inpaint/reference/variants/reframe/edit actions) |
| quick settings | `AigcQuickSettings` (mounted in the `promptToolbar` slot) |
| provider metadata | `PROVIDER_META`, `displayNameOf`, `ProviderBadge` |

---

### @blksails/pi-web-agent-kit

**Responsibility**: A lightweight helper package for custom agent authors. `defineAgent()` is a pure identity function that provides only compile-time type checking with zero runtime side effects — even without this package, the `AgentDefinition` structure you define is fully compatible with what the runner requires.

**Dependencies**: `@blksails/pi-web-logger`, `@blksails/pi-web-protocol`; peer: `@earendil-works/pi-coding-agent` (types only). **exports**: `{ ".": "./src/index.ts" }`.

**Main exports**: `defineAgent`; types `AgentDefinition`/`AgentContext`/`AgentModel`/`ToolDefinition`/`SystemPromptValue`/`ThinkingLevel`, etc. (including the two extension-surface fields `routes?` and `slashCompletions?`); the conveniences `defineMinimalAgent`/`minimalAgentPreset`, `emitUi`; and the attachment tool context types `AttachmentToolContext`, etc. (runtime construction lives in server). For detailed author-facing usage see [08 · Agent Development](08-agent-development.md).

---

### @blksails/pi-web-tool-kit

**Responsibility**: A general-purpose tooling kit, split into two layers — the **main entry** (frontend-safe declaration layer) and **`./runtime`** (the Node-only execution layer, where any logic containing a pi SDK value import must land, guarding the esbuild/vite external boundary).

**Dependencies**: `@blksails/pi-web-agent-kit`, `@blksails/pi-web-logger`, `undici`, `zod`; peers: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`.

**exports (6 subpaths)**:

```json
{
  ".":                    "./src/index.ts",   // declaration layer, frontend-safe
  "./runtime":            "./src/runtime.ts", // execution layer, Node only
  "./aigc-canvas-schema": "./src/aigc/canvas/schema.ts",
  "./commands":           "./src/commands/index.ts",
  "./extension-entry":    "./src/extension-tools/entry-path.ts",
  "./auto-title-entry":   "./src/auto-title/entry-path.ts"
}
```

**Main entry (declaration layer, `packages/tool-kit/src/index.ts`)** exports only frontend-safe pure data/types: `BUILTIN_COMMANDS` (built-in slash command declarations), `getSessionState`/`SESSION_STATE_SEAM_KEY` (the state-injection-bridge author hook-in point, see [04](04-surface-stack.md)), `aigcSlashCompletions`, `AIGC_MODEL_CATALOG`.

> **Note**: the `export * from "./engine/types.js"` and `AIGC_TOOLS`/`imageGeneration`/`imageEdit` written in the old docs have been removed from the main entry (detoolspec-unify-builtin-tools) — copying them verbatim will fail to resolve.

**`./runtime` (execution layer, `packages/tool-kit/src/runtime.ts`)**:

| Category | Key symbols |
|---|---|
| engine | `runEndpoint`, `resolveVars`/`resolveVarsOptional`/`checkRequiredVars`, `proxyFetch`, `normalizeImageDataUri` |
| attachment | `getAttachmentToolContext`/`SEAM_KEY`, `persistPicked`, `resolveInputToDataUri` |
| Surface | `createSurface`, `getSurfaceRegistry`, `SURFACE_REGISTRY_SEAM_KEY` ([04](04-surface-stack.md)) |
| AIGC extension | `aigcExtension`, `registerImageGeneration`, `registerImageEdit` ([11](11-aigc-and-vision-tools.md)) |
| Canvas surface | `canvasSurfaceExtension`, `createCanvasCommands`, `rebuildGalleryFromAttachments`, `CANVAS_DOMAIN` |
| vision | `visionExtension`, `createVisionRunner`, `listVisionModels`, `VISION_MODEL_ENV` |
| image-tool orchestration | `runImageTool`, `buildModelsDescription`, `optionalModelEnum` |

> The `compileTool`/`buildAigcTools` listed in the old docs' runtime table have both been deleted and no longer exist.

---

### @blksails/pi-web-kit (directory `packages/web-kit/`)

**Responsibility**: The author-side SDK (webext control layer) for an agent source's `.pi/web`, symmetric with agent-kit — `defineAgent()` ↔ `defineWebExtension()`. The author writes the `.pi/web` entry with a default-exported `WebExtension`; the `pi-web build` CLI shipped with the package pre-builds it into an ESM bundle + manifest. This package is also the canonical home of `renderSurfaceOp`/`SurfaceOp` (surface-runtime-facade, see [04](04-surface-stack.md)).

**Dependencies**: `@blksails/pi-web-logger`, `@blksails/pi-web-protocol`, `esbuild`; peers: `react`, `ai`.

**exports**: `{ ".": "./src/index.ts", "./build": "./build/index.ts" }`. **bin**: `pi-web` → `./build/cli.ts`.

**Main exports**: `defineWebExtension`; types `WebExtension`/`SlotContribution`/`ContributionPoints`/`RendererContributions`/`UiRpcClient`/`WebExtHostContext`; the `SLOTS` slot constants table (`packages/web-kit/src/slots.ts`); `renderSurfaceOp`/`SurfaceOp`/`SubmitOpResult`; protocol re-exports (`SlotKey`/`WebExtConfig`/`ArtifactDeclaration`/`UiRpcPoint`, etc.). For usage and the full set of available slots see [12 · Web UI Extension](12-web-ui-extension.md); for a runnable example see `examples/webext-slots-agent/.pi/web/web.config.tsx`.

> **bin name-collision note**: this package's bin `pi-web` (the webext build CLI) and the repo-root bin `pi-web` (`bin/pi-web.mjs`, the self-contained instance launcher, see [18 · CLI](18-cli.md)) share the same name but differ in meaning; installing both globally may collide.

---

## A Minimal Runnable Consumption Example

The minimal consumption surface for a custom agent uses only `@blksails/pi-web-agent-kit`. The repo's `examples/hello-agent/index.ts` is a complete, runnable example:

```typescript
// examples/hello-agent/index.ts (excerpt)
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const echo = defineTool({
  name: "echo",
  label: "Echo",
  description: "Echo the provided text back to the caller.",
  parameters: Type.Object({ text: Type.String({ description: "Text to echo back." }) }),
  async execute(_toolCallId, params) {
    return { content: [{ type: "text", text: params.text }], details: undefined };
  },
});

export default defineAgent({
  // model omitted → inherit the default provider/model from ~/.pi/agent/settings.json, works out of the box.
  systemPrompt: "You are hello-agent, a minimal pi-web example agent.",
  customTools: [echo],
  noTools: "builtin",
});
```

Load it with the repo's development server:

```bash
# 1) Install dependencies (the pnpm workspace links all 11 packages via workspace:*)
pnpm install

# 2) Start dev (dev-all.mjs concurrently starts the API on :3000 + Vite on :5173)
pnpm dev

# 3) Open http://localhost:5173 in the browser, enter examples/hello-agent on the source picker,
#    send a message and you should see a streaming reply; asking it to echo something triggers the echo tool
```

**Expected result**: the Vite frontend renders the chat UI on 5173, `/api` requests are proxied by Vite to the Hono host on 3000, and each session spawns an independent subprocess that loads the agent. If you only want to verify that the package links are in place, run `pnpm -r list --depth -1` to list all 11 `@blksails/*` workspace packages.

---

## Dependency Direction Cheat Sheet

```
@blksails/pi-web-logger      ←──────── all @blksails packages (true zero-dependency leaf root)
@blksails/pi-web-protocol    ──depends──→ logger + zod
@blksails/pi-web-primitives  ──depends──→ (zero @blksails; radix/clsx/cva/lucide)
@blksails/pi-web-canvas-kit  ──depends──→ (zero @blksails; lucide-react)
@blksails/pi-web-server      ──depends──→ logger + protocol
@blksails/pi-web-agent-kit   ──depends──→ logger + protocol
@blksails/pi-web-tool-kit    ──depends──→ agent-kit + logger
@blksails/pi-web-kit         ──depends──→ logger + protocol
@blksails/pi-web-react       ──depends──→ logger + protocol + pi-web-kit
@blksails/pi-web-canvas-ui   ──depends──→ canvas-kit + pi-web-kit + primitives + react + tool-kit
@blksails/pi-web-ui          ──depends──→ 8 @blksails packages (canvas-kit/canvas-ui/logger/
                                          primitives/protocol/react/pi-web-kit/tool-kit)

Forbidden: server ↔ react/ui (backend and frontend do not depend on each other)
Forbidden: logger / protocol depending in reverse on any @blksails package
Forbidden: ui/canvas-ui → canvas-kit/primitives in reverse (kernel/primitives must not depend on upper layers)
```

---

## Planned Packages

| Package | Planned spec | Description |
|---|---|---|
| `@blksails/embed` | `embed-integrations` | Web Component `<pi-web-chat>` + iframe widget, supporting embedding into non-React projects (**planned/not implemented**; no such directory exists yet under `packages/`) |

---

## Related

- [03 · Architecture](03-architecture.md) — the process boundaries and Hono/esbuild topology of each package at runtime
- [04 · Surface Authoritative Stack](04-surface-stack.md) — `createSurface`/`useSurface`/`renderSurfaceOp`/the state-injection bridge
- [06 · Configuration Reference](06-configuration.md) — env and the `NEXT_PUBLIC_PI_WEB_CANVAS` gate
- [08 · Agent Development](08-agent-development.md) — `@blksails/pi-web-agent-kit` and `defineAgent()`
- [11 · AIGC and Vision Tools](11-aigc-and-vision-tools.md) — the AIGC/vision extensions of `@blksails/pi-web-tool-kit/runtime`
- [12 · Web UI Extension](12-web-ui-extension.md) — `@blksails/pi-web-kit` and `defineWebExtension()`
- [16 · Canvas Workbench](16-canvas-workbench.md) / [17 · Canvas Plugins](17-canvas-plugins.md) — canvas-ui / canvas-kit from the user and plugin-author perspectives
- [21 · Logging](21-logging.md) — the runtime behavior of `@blksails/pi-web-logger`
- [24 · HTTP/SSE API Reference](24-http-api-reference.md) — route conventions of the `@blksails/pi-web-server` HTTP module
