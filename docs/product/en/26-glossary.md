# 26 · Glossary

A quick reference for pi-web terminology across the whole stack—each entry gives a 1–3 sentence definition and cross-links to the chapter where it is detailed. Technical terms and code identifiers are kept in their original form.

---

## A

### AAS (Agent-Authoritative Surface · pre-spec design vocabulary)

> **Note: AAS is design vocabulary, not a shipped SDK/API.** On main, only a single comment at `packages/ui/src/index.ts:186` mentions "AAS instance UI," and the dedicated design draft `docs/agent-authoritative-surface-design.md` is explicitly marked as a pre-spec draft. It describes a communication mindset in which "the agent process holds the authoritative domain state and the front end is only a thin projection"; **the real, code-backed implementation of that idea is the Surface stack** (see **Surface**), whose single authoritative specification is `docs/surface-app-runtime-contract-v1.md` (a contract that declares it subsumes the AAS draft). When you encounter "AAS," read it as "the design vocabulary behind the Surface stack," not as a standalone product surface.

See [04 · Surface Stack](./04-surface-stack.md).

### Agent Source

The entry descriptor from which an agent is loaded. It can be a **local directory** (absolute path) or a **git source** (resolved, pulled, and materialized as a local directory). The source resolver does three things: resolve the directory or git → local working directory; detect the entry (`index.[js|ts]`); and combine the trust policy to produce a `SpawnSpec` (how the subprocess is started).

See [02 · Core Concepts](./02-core-concepts.md) and [08 · Agent Development](./08-agent-development.md).

### AgentDefinition

The **static declaration structure** of a custom agent, provided by the agent's `index.ts` default export (it may also be a factory function that returns this structure). Key fields include `model`, `systemPrompt`, `customTools`, `noTools`, `extensions`, `allowExtensions`, `skills`, `scopedModels`, `routes`, `slashCompletions`, and more. After the runner bootstrap loads it, `loadAgentDefinition()` (`packages/server/src/runner/agent-loader.ts`) normalizes it into a unified runtime factory.

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
export default defineAgent({ systemPrompt: "…", noTools: "builtin" });
```

See [08 · Agent Development](./08-agent-development.md).

### agentHostProvider (planned / not yet implemented)

A **planned interface isolation point** intended to abstract "how to spawn the agent subprocess." This factory is **not yet implemented** in the current code—the transport seam is carried by the already-implemented `PiRpcChannel` (with the local implementation `PiRpcProcess`, a local `child_process` spawn). It is the factory layer reserved for remote hosts such as docker / e2b / ssh / device.

See [03 · Architecture](./03-architecture.md) and [25 · Roadmap](./25-roadmap.md).

### att\_\<id\> (public attachment id)

The globally unique attachment identifier minted by `AttachmentStore.put()`, formatted as `att_` + 16-byte `randomBytes` encoded as base64url (`mintAttachmentId()` — `packages/server/src/attachment/id.ts`). History and the LLM context **store only the `att_<id>` reference**; base64 is briefly materialized only at two named exits (fed to the LLM for vision, and tool reads).

See [09 · Attachment System](./09-attachment-system.md).

### Artifact / Artifact iframe (Tier 4)

A WebExtension may declare a standalone HTML surface (`artifact.entry`) in `.pi/web/dist/`, which the host loads via `<iframe sandbox="allow-scripts">`—without `allow-same-origin`, so the iframe gets an opaque origin and cannot access the host's cookies/DOM/credentials. Bidirectional communication goes through `postMessage`, with message types constrained by `ArtifactMessage` from `@blksails/pi-web-protocol`. Mount gating: **`NEXT_PUBLIC_PI_EXTENSION_BASE_URL` must be set** (this env is now read at runtime by the server during `GET /api/bootstrap` and shipped down—see **bootstrap delivery**), otherwise `ArtifactSurface` does not render.

> This is a **distinct concept** from **Surface (authoritative surface)** below: the artifactSurface here is the Tier 4 iframe-isolated surface (a mounting mechanism); the Surface stack is a domain-authoritative communication convention that is **orthogonal** to the five-tier mounting mechanism.

See [12 · Web UI Extension](./12-web-ui-extension.md).

---

## B

### BlobStore (object-store port)

The pluggable storage interface for **L0** of the attachment system (`packages/server/src/attachment/blob-store.ts`), defining five capabilities—put / get / stream / delete / exists—plus `BlobNotFoundError`. The current implementation is `LocalFsBlobBackend` (persisting to `$PI_WEB_ATTACHMENT_DIR`); the interface is S3-style, making it easy to switch to other object-store backends in the future.

See [09 · Attachment System](./09-attachment-system.md).

### bootstrap runner

The subprocess entry script for custom agents (custom mode): `packages/server/runner-bootstrap.mjs` (pure ESM, requiring no jiti to start itself). It creates a jiti instance, loads `src/runner/runner.ts`, parses arguments via `parseRunnerArgs`, normalizes the agent via `loadAgentDefinition`, builds the session via `createAgentSessionRuntime`, and finally enters the never-returning RPC loop in `runRpcMode`.

See [08 · Agent Development](./08-agent-development.md).

### bootstrap delivery (GET /api/bootstrap)

The **runtime configuration endpoint** for the SPA front end (`server/bootstrap.ts`, mounted at `server/index.ts:67`). After the move to Vite+SPA, the `NEXT_PUBLIC_PI_WEB_*` family of gates (sessions/source-picker/launcher-rail/canvas, etc.) are **no longer build-time inlined constants**—the server reads `process.env` on every request to `/api/bootstrap` and ships the result down as JSON, which the front end injects via `setRuntimeFeatures()` (`lib/app/runtime-features.ts`). The direct consequence of this semantic inversion: **runtime switches like `pi-web --canvas` now actually take effect**, and after changing an env you only need to restart the server, with no rebuild required.

See [14 · Sessions List](./14-sessions-list.md) and [24 · HTTP API Reference](./24-http-api-reference.md).

---

## C

### canvas-kit (@blksails/pi-web-canvas-kit)

The independently published **Canvas L2 developer-facing kernel** package, whose public face exports four contract families: actions `defineCanvasAction`/`resolveAction`, layers `defineCanvasLayer`/`registerPluginBundles`, tools `defineCanvasTool`/`createCanvasRegistry`, and the interaction-kernel assembly facade `createCanvasKernel`; the `kernel/` L1 internals (stage/pointer/history/layers/tool-runtime) are deliberately not exported. It bundles 8 built-in drawing tools (arrow/draw/erase/expand/line/mask/move/text). Zero `@blksails` dependencies.

See [05 · Packages](./05-packages.md) and [17 · Canvas Plugins](./17-canvas-plugins.md).

### canvas-ui (@blksails/pi-web-canvas-ui)

The independently published **canonical home of Canvas domain components**, carrying the `CanvasWorkbench` remix canvas editor, 6 built-in generation actions (outpaint/inpaint/reference/variants/reframe/edit), the `CanvasGallery` gallery, and the vision "readout" button. It depends on canvas-kit + web-kit + primitives + react + tool-kit, forming a full layer of the canvas dependency chain.

See [05 · Packages](./05-packages.md) and [16 · Canvas Workbench](./16-canvas-workbench.md).

### Canvas Workbench (CanvasWorkbench)

The remix canvas editor component provided by canvas-ui (`packages/canvas-ui/src/canvas-workbench.tsx`): stage zoom/pan + tool rail + overlay masks/annotations + prompt bar + version strip. Panel visibility is **driven by agent-source declaration**—when a source mounts `CanvasLauncher`/`CanvasPanel` into the `launcherRail`/`panelRight` named slots in its `.pi/web` it appears (`enabled` defaults to `true`), whereas an ordinary source that does not declare these two slots is naturally absent. The historical environment-variable gate `NEXT_PUBLIC_PI_WEB_CANVAS` (surfaced via **bootstrap delivery** as the runtime feature `canvas`, off by default) and the component-level `isCanvasEnabled()` read path are both now **`@deprecated`** (`packages/canvas-ui/src/canvas-launcher.tsx:29-37`), retained only for backward compatibility / forced override. Its architecture is built on top of the **Surface stack** (a `domain="canvas"` CQRS single-writer).

See [16 · Canvas Workbench](./16-canvas-workbench.md).

### CompletionProvider

A trigger-driven **completion registration framework**. Taking `@` as an example, `AttachmentCompletionProvider` (`packages/server/src/completion/providers/attachment-provider.ts`) returns the list of attachments already present in the current session; the token form is `@attachment:<id>`, which is resolved into a canonical reference marker on submit. Developers can register custom providers that plug into the same completion endpoint.

See [09 · Attachment System](./09-attachment-system.md) and [10 · Extensions & Skills](./10-extensions-and-skills.md).

### CQRS single-writer (Command-Query separation / single-writer)

The communication principle adopted by the **Surface stack**: the authoritative domain state has exactly one writer (the surface inside the agent subprocess), and the front end **reads** via the downstream state mirror while it **writes** via upstream commands (`{point:command, action:execute, payload:{domain,action,args}}`), keeping the two separate. Commands do not pass through the LLM; `wireSurfaceBridge` dispatches them directly by domain. This is the core convention of the surface plane among pi-web's "two orthogonal communication planes," driving Canvas end to end.

See [04 · Surface Stack](./04-surface-stack.md).

### createPiWebHandler

The **framework-agnostic HTTP handler factory** exported by `@blksails/pi-web-server` (`packages/server/src/http/create-handler.ts`). `createPiWebHandler(opts)` returns a value of type `PiWebHandler = (req: Request) => Promise<Response>` (Web Fetch API). The **Hono host** uses a single `app.all("/api/*")` to forward a standard `Request` (`c.req.raw`) losslessly to its singleton, returning the `Response`—whose body contains an SSE `ReadableStream`—as-is, without rewriting status/headers/body and without buffering; internally the handler routes to `/sessions/**` and `/config/**` (with the prefix stripped via `sse.basePath:"/api"`). This lets the backend engine be mounted on any runtime that supports Web Fetch.

See [03 · Architecture](./03-architecture.md) and [24 · HTTP API Reference](./24-http-api-reference.md).

### createSurface (agent-side authoritative-surface facade)

The agent-side entry point of the **Surface stack** (`packages/tool-kit/src/surface/create-surface.ts`). It establishes an authoritative surface by domain; `write` snapshots go through the session's shared state via `set(surface:<domain>)`, commands are normalized into a `SurfaceCommandResult`, the probe command `surface:<domain>` is registered, and the in-process registry `__piWebSurfaces__` is written. It loads in `ExtensionFactory` form (runtime-only). As a capability an agent author can declare, see the pointer in chapter 08.

See [04 · Surface Stack](./04-surface-stack.md) and [08 · Agent Development](./08-agent-development.md).

### ContributionPoints

A WebExtension Tier 3 capability, declared in `defineWebExtension({ contributions: { slash, mention, keybindings, … } })`. The behavior is implemented by extension code and called back into the agent process for results via the **UI↔Agent RPC bus** (`POST /api/sessions/:id/ui-rpc`). The extension must declare `capabilities: ["contributions"]`, and the host automatically opens `openControlOnlyStream` when the session is idle. The runtime behavior of `keybindings` in particular: within session scope, once a `document keydown` matches the combo, `/${commandId} ` is **filled into the input box** (a visible effect) rather than executing the command directly.

See [12 · Web UI Extension](./12-web-ui-extension.md).

---

## D

### defineAgent

The **identity helper** exported by `@blksails/pi-web-agent-kit`; at runtime it returns its argument unchanged, serving only compile-time type inference. An equivalent `AgentDefinition` object written without this package can be loaded by the runner just the same.

See [08 · Agent Development](./08-agent-development.md) and [05 · Packages](./05-packages.md).

### defineCanvasLayer / defineCanvasTool / defineCanvasAction (the Canvas plugin trio)

The Canvas plugin-development contracts exported by canvas-kit: the three declarations of layer, tool, and action. They are wired in after `registerPluginBundles` applies a namespace prefix + `requires` topological validation; the front-end plugin bundle and the agent-side command channel form a two-end wiring (canonical example `examples/canvas-plugin-stickers`). `registerLayer` is an internal registry method (called by `registerPluginBundles`), not a top-level export.

See [17 · Canvas Plugins](./17-canvas-plugins.md).

### dev-all (two-process dev orchestration)

`pnpm dev` actually runs `node scripts/dev-all.mjs`—which **concurrently** brings up two processes: the API server (Hono, `127.0.0.1:3000`) and the Vite dev server (`http://localhost:5173`, reverse-proxying `/api` to 3000). **The browser opens 5173 during development** (SPA + HMR); 3000 is the proxied API host. When either process exits / on Ctrl-C, both are torn down together. This is not `next dev` (Next.js has been removed from main).

```bash
pnpm dev            # dev-all: front end http://localhost:5173 (/api proxied to 3000)
```

See [01 · Quickstart](./01-quickstart.md) and [22 · Development & Testing](./22-development-and-testing.md).

### Dual-mode loading

The two modes in which pi-web loads an agent source, which nonetheless **expose the same RPC protocol** externally:

| Mode | Trigger | Spawn target |
|------|----------|------------|
| **custom** | Source directory has `index.[js\|ts]` | `runner-bootstrap.mjs` → jiti → `runRpcMode` |
| **cli** | Source directory has no entry | `pi --mode rpc` |

Both modes have identical underlying RPC implementations, the front-end/back-end bridge is fully reused, and only the spawn target differs. See [02 · Core Concepts](./02-core-concepts.md).

---

## E

### esbuild single-file server (dist/server.mjs)

The server is bundled by esbuild into a **single file** `dist/server.mjs` (bundle + esm + node22, `scripts/build-server.mjs`); the two pi SDK packages (`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`), `jiti`, and `pg` are kept external, and a `createRequire` banner shim is injected. **The entry must sit at the artifact root**—because once `import.meta.url` is inlined and stops working, it falls back to `process.cwd()`, so putting it in the wrong directory fails to resolve runtime resources. This is the current form that replaces the Next.js `standalone` artifact (see the **standalone** entry).

See [19 · Deployment](./19-deployment.md) and [18 · CLI](./18-cli.md).

### event → UIMessage translation layer

The **hinge between front and back** where the backend converts the RPC events emitted by the agent subprocess (text deltas, thinking blocks, tool calls, tool results, etc.) into AI SDK v5 `UIMessage` data-parts, then pushes them to the browser's `useChat` over SSE. The backend RPC bridge is guarded by integration tests against real subprocesses; the front-end translation layer is pure functions covered by unit tests. This is the **chat stream** plane among pi-web's "two orthogonal communication planes" (the other being the **Surface** plane).

See [02 · Core Concepts](./02-core-concepts.md) and [03 · Architecture](./03-architecture.md).

### extension UI sub-protocol

During execution, the agent subprocess can issue an `extension_ui_request` (confirm / select / input / editor) over RPC. The full path `RPC frame → PiSession.ControlStore.extensionUiQueue → SSE control frame → front-end useExtensionUI → PiInteraction inline card → ui-response → backend dequeue` is the extension UI sub-protocol. The pi SDK's built-in `RpcClient` does not expose this sub-protocol, which is one of the core reasons pi-web writes its own `PiRpcProcess`.

See [10 · Extensions & Skills](./10-extensions-and-skills.md) and [02 · Core Concepts](./02-core-concepts.md).

---

## F

### formSchema / Form IR

The normalized intermediate representation of the config UI, composed of `FormSchema` + `FieldDescriptor[]` (`packages/protocol/src/config/form-schema.ts`). Any source (a zod schema, JSON Schema, or hand-written) is first converted by an adapter into a `FormSchema`; the rendering layer `<SchemaForm>` recognizes only this IR. The `FieldDescriptor.widget` field lets you specify a custom renderer (e.g. `"providerSelect"`, `"aigcModelToggles"`), dispatched through the `FieldRegistry` registry.

```ts
// GET /api/config/:domain returns:
{ formSchema: FormSchema, values: Record<string, unknown>, protocolVersion: string }
```

See [13 · Config UI](./13-config-ui.md).

---

## G

### getSessionState (subprocess state-bridge seam)

The agent-author-facing entry point exported by tool-kit (`packages/tool-kit/src/index.ts:22`, seam key `SESSION_STATE_SEAM_KEY = "__piWebSessionState__"`). Within an agent tool you can read and write the **session-scoped shared KV**, shared for read/write between human and machine. Authority lives in the agent subprocess; downstream it mirrors via SSE `control:"state"` frames (carrying a monotonic `rev` / `deleted`), and the front end can write back via `POST /api/sessions/:id/state`. This is infrastructure beneath Surface/Canvas—namely the **state injection bridge**.

See [08 · Agent Development](./08-agent-development.md) and [24 · HTTP API Reference](./24-http-api-reference.md).

---

## H

### Hono host

The server's HTTP host framework (`server/index.ts`, `hono` ^4.12.28 + `@hono/node-server` acting only as a fetch↔Node adapter, pulling in no heavy framework abstraction). The entire `/api/*` surface converges onto a **single** `app.all("/api/*")` forwarding to the `createPiWebHandler` singleton (the webext/bootstrap endpoints must be registered **before** that catch-all forward). It replaces the 11 Route Handler forwarder files under `app/api/**` from the Next.js era. In production it injects a hardened CSP via Hono middleware (see **productionCsp**).

See [03 · Architecture](./03-architecture.md) and [24 · HTTP API Reference](./24-http-api-reference.md).

---

## I

### image_vision / /img_vision (vision recognition tool)

The **image-understanding** capability registered by `visionExtension`: the `image_vision` tool for the LLM to call autonomously (look at an existing / the most recent image in the session and answer a question), and the `/img_vision` command for the user to initiate directly. It selects a vision model via pi's `ctx.modelRegistry` (reading the environment variable `PI_WEB_VISION_MODEL` by default, in the form `provider/modelId`), and carries the conclusion as a `VisionResult` in text `details`. The `/img_vision` handler has no return value and is presented via `ctx.ui.notify`; on the front end, `source=extension` commands go fire-and-forget (not entering history, not blocking on busy).

See [11 · AIGC & Vision Tools](./11-aigc-and-vision-tools.md).

---

## J

### jiti

A runtime TypeScript/ESM loader. The bootstrap runner creates an instance via `createJiti()` and imports the user's `index.ts` directly inside the subprocess, with no precompilation. The jiti root is anchored at the `@blksails/pi-web-server` package directory, ensuring dependencies such as the pi SDK resolve from the correct location; it is kept external in the esbuild bundle.

See [08 · Agent Development](./08-agent-development.md) and [03 · Architecture](./03-architecture.md).

### JSONL framing

The inter-process communication format between `PiRpcProcess` and the agent subprocess: each message is a JSON object serialized as a single line terminated by `\n`. It splits strictly on `\n` and strips `\r`, and **disables Node `readline`**—because readline treats `U+2028` (LS) and `U+2029` (PS) as line separators, which would break those two characters when embedded inside JSON. Messages fall into three classes: `response`, `event`, and `extension_ui_request`.

See [02 · Core Concepts](./02-core-concepts.md) and [03 · Architecture](./03-architecture.md).

---

## K

### Kiro (steering / spec)

Kiro is the **Spec-Driven Development framework** adopted by the pi-web project.

- **Steering** (`.kiro/steering/`): project-level AI steering files (`product.md`, `tech.md`, `structure.md`, etc.), loaded as persistent context across all sessions.
- **Spec** (`.kiro/specs/<feature>/`): the formal specification for a single feature, containing `requirements.md`, `design.md`, `tasks.md`, and `evidence/`. Development follows a requirements → design → tasks 3-phase approval flow.

See [CLAUDE.md](../../CLAUDE.md).

---

## L

### L0 / L1 / L2 / L3 (attachment layers)

The four-layer architecture of the attachment system:

| Layer | Name | Core responsibility |
|----|------|----------|
| L0 | Object store | `BlobStore` (`LocalFsBlobBackend` / S3-ready) persists/reads bytes |
| L1 | Descriptor and public id | The `AttachmentStore` facade mints `att_<id>`, and `AttachmentRegistry` persists descriptors |
| L2 | resolve projection | `resolveAttachment()` → `AttachmentHandle` (`bytes/stream/localPath/url`) |
| L3 | context gate | `beforeToolCall` ownership check + `afterToolCall` base64 stripping; composed into pi's `agent.beforeToolCall`/`afterToolCall` by `wireAttachmentBridge()` |

See [09 · Attachment System](./09-attachment-system.md).

---

## N

### Node sidecar (bundled Node runtime)

The standalone Node binary bundled and shipped with the desktop build (Tauri) (`externalBin=binaries/node`, version pinned to **v22.22.0**). Each of the four platforms (darwin arm64/x64, linux x64, win x64) carries a sha256 trust anchor (`desktop/node-sidecar.lock.json`), downloaded and verified on demand by `scripts/fetch-node-sidecar.mjs`; the binaries themselves are gitignored. The desktop shell injects its absolute path as `PI_WEB_NODE_BIN` into the backend subprocess, for reuse by the pi runner grandchild process.

See [20 · Desktop (Tauri)](./20-desktop-tauri.md).

---

## O

### opChannel (three-state conversation-bridge fallback)

The **channel-probe result** exposed by `useConversationBridge` (the surface-runtime-facade facade, `packages/react/src/hooks/use-conversation-bridge.ts:56`), taking `"prompt" | "command" | "unavailable"`, evaluated synchronously at render time. `submitOp(op)` submits along different paths by opChannel: the `prompt` state renders to user-message text via the pure function `renderSurfaceOp`, the `command` state goes upstream as a surface command, and the `unavailable` state degrades. This is the Surface stack's fallback ordering for wiring domain operations into the conversation stream (contract C3-4).

See [04 · Surface Stack](./04-surface-stack.md).

### openControlOnlyStream

A dedicated SSE downstream connection that the host automatically opens when a WebExtension needs `ui-rpc` callbacks (`needsIdleControl = hasContributions || hasArtifactRpc`) **and** the session is **idle** (`!isBusy`), used to receive control frames. This connection is closed while the per-prompt message stream is being emitted (the message stream takes over), avoiding concurrency conflicts. Source at `packages/ui/src/chat/pi-chat.tsx`.

See [12 · Web UI Extension](./12-web-ui-extension.md).

---

## P

### payload / shared runtime (first-launch unpack)

The **bundled compressed payload** mechanism for the CLI/desktop builds: `dist/` is not shipped raw with the package but is instead compressed by `scripts/pack-payload.mjs` into `payload/dist.tar.zst` (zstd level 19, measured at roughly 9.4MB) + `payload/payload.json`; the unpacker `payload/unpack.mjs` is bundled by `scripts/build-unpacker.mjs`, with esbuild inlining tar into a roughly 115KB zero-dependency single file. On first launch it unpacks into the **shared runtime directory** `~/.pi/web/runtime/<version>-<digest>/` (overridable via `PI_WEB_RUNTIME_ROOT`), with a concurrency lock/heartbeat, GC that retains the most recent N old runtimes, and discriminated error codes (`payload-missing`/`payload-corrupt`/`zstd-unsupported`/`runtime-root-unwritable`/`disk-full`/`lock-timeout`/`extract-failed`).

See [18 · CLI](./18-cli.md), [20 · Desktop (Tauri)](./20-desktop-tauri.md), and [23 · Troubleshooting & FAQ](./23-troubleshooting-faq.md).

### PiRpcChannel

The **transport-agnostic RPC channel interface** (`packages/server/src/rpc-channel/`), with three methods:

```ts
interface PiRpcChannel {
  send(line: string): void;
  onLine(cb: (line: string) => void): void;
  close(): void;
}
```

The current local implementation is `PiRpcProcess` (based on `child_process` spawn); the interface is designed to leave replacement room for remote hosts such as e2b / ssh / device.

See [02 · Core Concepts](./02-core-concepts.md) and [03 · Architecture](./03-architecture.md).

### PiRpcProcess

The **local implementation** of `PiRpcChannel`, wrapping Node `child_process.spawn` and handling the three message classes via JSONL framing. pi-web writes this class itself instead of using the SDK's built-in `RpcClient` because that SDK version hardcodes spawning `pi` and does not expose the extension UI sub-protocol.

See [03 · Architecture](./03-architecture.md).

### productionCsp (production CSP hardening)

The content security policy generated by `productionCsp()` in `server/static.ts`, injected via Hono middleware **in production only** (`server/index.ts`). It tightens two things relative to the old host: **`unsafe-eval` is forbidden**, and **`unsafe-inline` is removed from script-src** (replaced by allowing the inline import map through a sha256 hash; an empty hash raises a loud warning rather than degrading silently). Hardening side effect: runtime `new Function`/`eval` is blocked (declarative webext installation must work around this).

See [19 · Deployment](./19-deployment.md) and [23 · Troubleshooting & FAQ](./23-troubleshooting-faq.md).

### protocolVersion

The **semantic version string** exported by the `@blksails/pi-web-protocol` package, carried with every SSE frame. Clients can use it to detect version compatibility (`PiProtocolVersionError`). Any change to the protocol types/schemas must follow semantic versioning.

See [05 · Packages](./05-packages.md) and [24 · HTTP API Reference](./24-http-api-reference.md).

---

## R

### renderer (Tier 2)

The **custom card renderer components** a WebExtension registers in `defineWebExtension({ renderers: { tools: {…}, dataParts: {…} } })`, isolated by per-session namespace. When the host receives a matching `tool-*` or `data-*` part, it calls the corresponding renderer. In a real dev environment, triggering requires the LLM to actually call a tool; you can verify offline with `PI_WEB_STUB_AGENT=1`.

See [12 · Web UI Extension](./12-web-ui-extension.md).

### renderSurfaceOp

The **pure function** exported by `@blksails/pi-web-kit` (`packages/web-kit/src/surface-op.ts:57`) that renders a channel-agnostic `SurfaceOp` (title/tool/ordered args) into user-message text in the `prompt` state (contract C3-1). It is the assembler for the `prompt` path in the opChannel fallback.

See [04 · Surface Stack](./04-surface-stack.md).

### resolve projection (L2)

`resolveAttachment(store, id)` returns an `AttachmentHandle` that provides four ways to access the attachment:

```ts
handle.bytes()      // whole bytes (small files)
handle.stream()     // ReadableStream (large files)
handle.localPath()  // local path (LocalFs backend, zero-copy)
handle.url()        // HMAC-signed delivery URL (cross-process safe)
```

Inside a subprocess, the same backend is instantiated via `createChildAttachmentStore(process.env)`, without calling back into the main process.

See [09 · Attachment System](./09-attachment-system.md).

### runRpcMode

The function exported by the pi SDK (`@earendil-works/pi-coding-agent`) that, inside the agent subprocess, starts a **never-returning RPC loop**: listening for stdin JSONL frames, routing requests such as `command` / `run` / `get_commands`, and writing streaming events to stdout. Both custom mode and cli mode reuse the same `runRpcMode` implementation.

See [08 · Agent Development](./08-agent-development.md) and [02 · Core Concepts](./02-core-concepts.md).

### three run modes (packaged / dev / unpackaged)

The launch decision for the desktop build (Tauri) (`desktop/src-tauri/src/runtime_mode.rs`): **packaged** (packaged state → unpack from bundled resources and bring up the backend), **dev** (not packaged and `PI_WEB_DESKTOP_DEV_URL` is non-empty → load that URL, do not bring up the backend), and **unpackaged** (not packaged, no dev url → run the build artifact directly, the e2e path). Even with a dev url set, the packaged state forces the packaged path (to prevent a distributed build from connecting to a dev server).

See [20 · Desktop (Tauri)](./20-desktop-tauri.md).

---

## S

### Session

One session = **one resident agent subprocess + one long-lived SSE connection**. `POST /api/sessions` creates a session and returns a `sessionId`; `PiSession` handles event broadcasting, lifecycle management, and the extension UI suspension table. Session state is bound to the instance hosting the resident process, which is the fundamental reason pi-web **cannot run Serverless/Edge** and requires sticky routing for horizontal scaling.

See [02 · Core Concepts](./02-core-concepts.md) and [03 · Architecture](./03-architecture.md).

### SessionLifecycleState / session-readiness handshake

The session lifecycle state model (`packages/protocol/src/transport/session-status.ts`): `initializing` / `ready` / `error` / `ended`. The readiness handshake takes the first response of the read-only probe `channel.getCommands()` as the true readiness anchor, broadcasts it over a sticky `control:"session-status"` frame, and replays the current state to new subscribers. It answers "when can a session send messages"; a dev version mismatch (new vs. old) can leave a session stuck on "connecting to agent…", which requires restarting dev.

See [02 · Core Concepts](./02-core-concepts.md) and [24 · HTTP API Reference](./24-http-api-reference.md).

### SessionStore

The active session registry interface (`packages/server/src/session/session-store.ts`), with the default implementation `InMemorySessionStore`—a `Map` keyed by `sessionId`, hung on `globalThis` to survive dev hot-reload.

> Note: this is a different abstraction from the session history **persistence** layer `SessionEntryStore` (with three backends—`fs` / `sqlite` / `postgres`—selected by the `SESSION_STORE` environment variable, defaulting to `fs`); do not confuse the two.

See [03 · Architecture](./03-architecture.md) and [14 · Sessions List](./14-sessions-list.md).

### Slots

A WebExtension Tier 1 capability that injects content into the host's named regions via `defineWebExtension({ slots: { [SlotKey]: ReactNode } })`. `SlotKeySchema` now enumerates **21** slots (`packages/protocol/src/web-ext/descriptor.ts`, including `background`, `headerLeft/Center/Right`, `panelRight`, `empty`, `toolbar`, `statusBar`, `logs`, `launcherRail`, `promptToolbar`, etc.). Slots mount in an **additive** manner, not replacing the host's kernel surface; when the host has not declared the corresponding slot, it is silently ignored. `promptToolbar` (the inline slot in the input box's tool rail) is the mount point for the AIGC quick-settings control.

See [12 · Web UI Extension](./12-web-ui-extension.md).

### SSE frame (Server-Sent Events frame)

The unit by which the front end and back end push streaming data over the `text/event-stream` protocol. Each frame carries `protocolVersion`. Aside from `ui-message-chunk` (the message stream), the `control` frame is now a discriminated union of several kinds, including `ui-rpc`, `error`, `session-status` (the readiness-handshake sticky frame), `session-state` (the session authoritative snapshot sticky frame), `state` (the state-injection-bridge mirror frame), `logs`, and more. On the browser side, `PiSessionConnection` (`@blksails/pi-web-react`) parses frames and routes them to `ControlStore` or `useChat`.

See [24 · HTTP API Reference](./24-http-api-reference.md).

### standalone (self-contained single-file artifact · dist/server.mjs)

pi-web's **self-contained server artifact**. **Next.js has been removed from main**—the `output:"standalone"` / `pack-standalone.mjs` / `outputFileTracingIncludes` / `.next-cli` referenced by old docs no longer exist. The current artifact is the esbuild single file `dist/server.mjs` (**which must sit at the artifact root**, see **esbuild single-file server**), whose build chain is `pnpm build:dist` (five steps: `build:client` (vite build) + `build:server` (`scripts/build-server.mjs`) + `pack-dist.mjs` + `build:unpacker` + `build:payload`). On first launch the CLI unpacks into the shared runtime via `payload/unpack.mjs`; the old `standaloneServerJs` in `bin/pi-web.mjs` has been demoted to a `@deprecated` alias pointing at `distServerJs` (`dist/server.mjs`).

See [18 · CLI](./18-cli.md) and [19 · Deployment](./19-deployment.md).

### steering

See **Kiro**.

### sticky routing

The routing policy under horizontal scaling whereby **all requests for the same `sessionId` must be routed to the same instance** (the instance hosting the corresponding subprocess). nginx implements it via `ip_hash` or `$cookie_SESSION`; K8s implements it via `Service.sessionAffinity=ClientIP` or an Ingress annotation. Without it, subsequent requests are routed to an instance lacking that subprocess, causing 404s or silent disconnects.

See [03 · Architecture](./03-architecture.md) and [19 · Deployment](./19-deployment.md).

### Surface (authoritative surface)

The **second** of pi-web's "two orthogonal communication planes" (orthogonal to the chat-stream plane, and also orthogonal to the WebExtension five-tier mounting mechanism). It communicates across processes under the **CQRS single-writer** convention: the surface inside the agent subprocess holds the authoritative state for a given `domain`, and the front end reads via the downstream state mirror while writing via upstream commands. The whole stack comprises `createSurface` (agent facade), `wireSurfaceBridge` (runner bridge), `useSurface` (front-end hook), `__piWebSurfaces__` (in-process registry), and `protocol surface.ts` (the `surfaceStateKey`/`SurfaceCommandPayload`/`SurfaceCommandResult` contracts); it is implemented and backed by real-subprocess integration tests, driving Canvas end to end. **Take care not to confuse it with the Tier 4 artifactSurface (iframe-isolated surface)**; also do not treat the design vocabulary **AAS** as a shipped API of this stack.

See [04 · Surface Stack](./04-surface-stack.md).

### SurfaceOp

The **channel-agnostic operation type** exported by `@blksails/pi-web-kit` (`packages/web-kit/src/surface-op.ts:17`): it assembles a single domain operation into a structure of title / tool / ordered args, submitted along different paths by the facade according to **opChannel** (in the `prompt` state it renders to user-message text via `renderSurfaceOp`). Canvas's six generation actions and the vision "readout" button are all assembled into a SurfaceOp and dispatched into the conversation stream.

See [04 · Surface Stack](./04-surface-stack.md) and [16 · Canvas Workbench](./16-canvas-workbench.md).

### state injection bridge

See **getSessionState**. A session-scoped bidirectional shared KV: authority lives in the agent subprocess (seam `__piWebSessionState__`), the write-back endpoint is `POST /api/sessions/:id/state`, and downstream it mirrors via SSE `control:"state"` frames (carrying a monotonic `rev` / `deleted`). It is infrastructure beneath Surface/Canvas, and is also reused by the message queue UI.

See [08 · Agent Development](./08-agent-development.md) and [24 · HTTP API Reference](./24-http-api-reference.md).

---

## T

### Tauri desktop shell (Tauri v2)

pi-web's **second delivery form** (`desktop/src-tauri`, a Rust crate, Tauri 2.x). Three installer forms: `dmg` (macOS), `nsis` (Windows), and `appimage` (Linux). It ships with the **Node sidecar** v22.22.0 + the **shared runtime payload** unpacked on first launch, with the three run modes (packaged/dev/unpackaged). The backend entry the shell spawns is the same `dist/server.mjs`, into which it injects `PORT`/`HOSTNAME`/`PI_WEB_AUTOSTART=1`/`PI_WEB_NODE_BIN` and **deliberately does not inject** `PI_WEB_AGENT_DIR` (so sessions default to `~/.pi/agent`, shared with the CLI).

See [20 · Desktop (Tauri)](./20-desktop-tauri.md).

### trustPolicy

The **replaceable policy plugin point** that decides whether an agent source, or resources under a project `.pi/` directory (skills/extensions/prompts), may be loaded. Its values are `"always"` to allow, `"ask"` (default), or `"never"` to deny. cli mode allows via `--approve` / `defaultProjectTrust:"always"`; custom mode passes the trust signal via the `PI_WEB_TRUST_PROJECT` environment variable. Persistence implementation: `FsProjectTrustStore`, which reads and writes `<agentDir>/trust.json`.

See [10 · Extensions & Skills](./10-extensions-and-skills.md) and [03 · Architecture](./03-architecture.md).

---

## U

### useConversationBridge

The **conversation-bridge facade hook** of surface-runtime-facade (`packages/react/src/hooks/use-conversation-bridge.ts`): it exposes `opChannel` (three-state fallback) + `submitOp` + `bringToConversation` + `onTurnEnd`, converging the four raw injection items conversation / onSubmitPrompt / surface / syncSignal. The Canvas workbench uses it to wire generation actions into the conversation stream.

See [04 · Surface Stack](./04-surface-stack.md).

### useSurface

The **front-end hook** of the Surface stack (`packages/react/src/hooks/use-surface.ts`), returning `{ state, run, available, rev }`: downstream it mirrors the `surface:<domain>` slice of `ControlStore.states`; upstream it sends `{point:command, action:execute, payload:{domain,action,args}}` via `createUiRpcBus` (no top-level `name` → escaping the host interceptor); `available` is determined by the `getCommands` probe.

See [04 · Surface Stack](./04-surface-stack.md).

---

## V

### Vite SPA (front-end form)

The pi-web front end is now a **Vite-driven single-page app**: the root `index.html` is the static entry (with an inline single-instance import map), `src/main.tsx` is the module entry, `@vitejs/plugin-react` does the build, and artifacts go to `dist/client`. The alias table in `vite.config.ts` must replicate the `tsconfig` paths verbatim; `target` must be `esnext` and `modulePreload.polyfill` must be `false` (otherwise it injects unsafe-eval/inline scripts that break webext dynamic import). This replaces the removed Next.js App Router/RSC.

See [03 · Architecture](./03-architecture.md) and [22 · Development & Testing](./22-development-and-testing.md).

---

## W

### WebExtension

The **UI control layer** that each agent source can carry in its `.pi/web/` directory, which the host dynamically loads when a session of that source becomes active. The entry file `web.config.tsx` default-exports the return value of `defineWebExtension(…)`, and `pi-web build` produces `web-extension.mjs` + `manifest.json` (with SRI). The host verifies SRI + signature allowlist + version compatibility before loading. It comprises five capability tiers (Tier 1–5): slots, renderers, contribution points, Artifact iframe, and pure declarative config.

> `pi-web`, as a build CLI, is provided by the `bin` of `@blksails/pi-web-kit` (directory `web-kit`), which is the **same name** as the repo-root `bin/pi-web.mjs` (the standalone launcher); a global install may collide.

See [12 · Web UI Extension](./12-web-ui-extension.md).

### wireSurfaceBridge

The **server-runner-side bridge** of the Surface stack (`packages/server/src/runner/surface-wiring.ts`): a second stdin JSONL reader that intercepts `ui_rpc` lines → dispatches by domain → `writeSync(1)` writes directly to fd1 to return `ui_rpc_response`; non-surface lines pass through, and with no registration it is a lazy no-op. It is wired into the runner's `startRunner` (before `runRpcMode`, after `wireStateBridge`).

See [04 · Surface Stack](./04-surface-stack.md).

### Declarative layout (Declarative Config, Tier 5)

Without carrying any JS bundle, a WebExtension can simply declare in the `config` field of `manifest.json` such settings as `layout` (the host `LayoutPreset` takes `"centered"` / `"wide"` / `"full"` / `"split"`), `theme`, `documentTitle`, and `empty`; the host reads and applies them directly. The lightest-weight path to zero-code UI customization.

See [12 · Web UI Extension](./12-web-ui-extension.md).

---

## Quick Index

| Term | Detailed chapter |
|------|---------|
| AAS (pre-spec design vocabulary) | [04](./04-surface-stack.md) |
| Agent Source | [02](./02-core-concepts.md), [08](./08-agent-development.md) |
| AgentDefinition / defineAgent | [08](./08-agent-development.md), [05](./05-packages.md) |
| agentHostProvider (planned) | [03](./03-architecture.md), [25](./25-roadmap.md) |
| att\_\<id\> | [09](./09-attachment-system.md) |
| Artifact iframe | [12](./12-web-ui-extension.md) |
| BlobStore / L0–L3 | [09](./09-attachment-system.md) |
| bootstrap runner | [08](./08-agent-development.md) |
| bootstrap delivery (/api/bootstrap) | [14](./14-sessions-list.md), [24](./24-http-api-reference.md) |
| canvas-kit / canvas-ui | [05](./05-packages.md), [16](./16-canvas-workbench.md), [17](./17-canvas-plugins.md) |
| Canvas Workbench | [16](./16-canvas-workbench.md) |
| CompletionProvider | [09](./09-attachment-system.md), [10](./10-extensions-and-skills.md) |
| CQRS single-writer | [04](./04-surface-stack.md) |
| createPiWebHandler | [03](./03-architecture.md), [24](./24-http-api-reference.md) |
| createSurface | [04](./04-surface-stack.md), [08](./08-agent-development.md) |
| ContributionPoints / keybindings | [12](./12-web-ui-extension.md) |
| defineCanvasLayer/Tool/Action | [17](./17-canvas-plugins.md) |
| dev-all (two-process) | [01](./01-quickstart.md), [22](./22-development-and-testing.md) |
| Dual-mode loading | [02](./02-core-concepts.md) |
| esbuild dist/server.mjs | [19](./19-deployment.md), [18](./18-cli.md) |
| extension UI sub-protocol | [10](./10-extensions-and-skills.md), [02](./02-core-concepts.md) |
| formSchema / Form IR | [13](./13-config-ui.md) |
| getSessionState / state injection bridge | [08](./08-agent-development.md), [24](./24-http-api-reference.md) |
| Hono host | [03](./03-architecture.md), [24](./24-http-api-reference.md) |
| image_vision / /img_vision | [11](./11-aigc-and-vision-tools.md) |
| JSONL framing | [02](./02-core-concepts.md), [03](./03-architecture.md) |
| Kiro steering / spec | [CLAUDE.md](../../CLAUDE.md) |
| Node sidecar | [20](./20-desktop-tauri.md) |
| opChannel | [04](./04-surface-stack.md) |
| openControlOnlyStream | [12](./12-web-ui-extension.md) |
| payload / shared runtime | [18](./18-cli.md), [20](./20-desktop-tauri.md), [23](./23-troubleshooting-faq.md) |
| PiRpcChannel / PiRpcProcess | [02](./02-core-concepts.md), [03](./03-architecture.md) |
| productionCsp | [19](./19-deployment.md), [23](./23-troubleshooting-faq.md) |
| protocolVersion | [05](./05-packages.md), [24](./24-http-api-reference.md) |
| renderer | [12](./12-web-ui-extension.md) |
| renderSurfaceOp | [04](./04-surface-stack.md) |
| resolve projection | [09](./09-attachment-system.md) |
| runRpcMode | [08](./08-agent-development.md), [02](./02-core-concepts.md) |
| three run modes | [20](./20-desktop-tauri.md) |
| Session | [02](./02-core-concepts.md), [03](./03-architecture.md) |
| SessionLifecycleState / readiness handshake | [02](./02-core-concepts.md), [24](./24-http-api-reference.md) |
| SessionStore | [03](./03-architecture.md), [14](./14-sessions-list.md) |
| Slots (21 slots) | [12](./12-web-ui-extension.md) |
| SSE frame | [24](./24-http-api-reference.md) |
| standalone (dist/server.mjs) | [18](./18-cli.md), [19](./19-deployment.md) |
| sticky routing | [03](./03-architecture.md), [19](./19-deployment.md) |
| Surface (authoritative surface) | [04](./04-surface-stack.md) |
| SurfaceOp | [04](./04-surface-stack.md), [16](./16-canvas-workbench.md) |
| Tauri desktop shell | [20](./20-desktop-tauri.md) |
| trustPolicy | [10](./10-extensions-and-skills.md), [03](./03-architecture.md) |
| useConversationBridge / useSurface | [04](./04-surface-stack.md) |
| Vite SPA | [03](./03-architecture.md), [22](./22-development-and-testing.md) |
| WebExtension | [12](./12-web-ui-extension.md) |
| wireSurfaceBridge | [04](./04-surface-stack.md) |
| Declarative layout | [12](./12-web-ui-extension.md) |

---

## Next / Related

- To understand the overall runtime model, start with [02 · Core Concepts](./02-core-concepts.md).
- To see process boundaries and dependency constraints: [03 · Architecture](./03-architecture.md).
- To go deeper into the second communication plane: [04 · Surface Stack](./04-surface-stack.md).
- To start developing a custom agent: [08 · Agent Development](./08-agent-development.md).
- To start writing a WebExtension: [12 · Web UI Extension](./12-web-ui-extension.md).
- To get hands-on with the canvas editor: [16 · Canvas Workbench](./16-canvas-workbench.md).
