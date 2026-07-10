# 20 · Glossary

A quick reference for pi-web terminology across the whole stack—each entry gives a 1–3 sentence definition and cross-links to the chapter where it is detailed.

---

## A

### Agent Source

The entry descriptor from which an agent is loaded. It can be a **local directory** (absolute path) or a **git source** (resolved and pulled down into a local directory). The source resolver (`agent-source-resolver` spec) does three things: resolve the directory or git → local working directory; detect the entry (`index.[js|ts]`); and combine the trust policy to produce a `SpawnSpec` (how the subprocess is started).

See [02 · Core Concepts](./02-core-concepts.md) and [08 · Agent Development](./08-agent-development.md).

### AgentDefinition

The **static declaration structure** of a custom agent, provided by the agent's `index.ts` default export (it may also be a factory function that returns this structure). Key fields include `model`, `systemPrompt`, `customTools`, `noTools`, `extensions`, `allowExtensions`, `skills`, `scopedModels`, and more. After the runner bootstrap loads it, `loadAgentDefinition()` (`packages/server/src/runner/agent-loader.ts`) normalizes it into a unified runtime factory.

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
export default defineAgent({ systemPrompt: "…", noTools: "builtin" });
```

See [08 · Agent Development](./08-agent-development.md).

### agentHostProvider (planned / not yet implemented)

A **planned interface isolation point** intended to abstract "how to spawn the agent subprocess." This factory is **not yet implemented** in the current code—the transport seam is carried by the already-implemented `PiRpcChannel` (with the local implementation `PiRpcProcess`, a local `child_process` spawn). `agentHostProvider` appears in `.kiro/steering/roadmap.md` and [25 · Roadmap](./25-roadmap.md); it is the factory layer reserved for remote hosts such as docker / e2b / ssh / device. See [03 · Architecture](./03-architecture.md) and [25 · Roadmap](./25-roadmap.md).

### att\_\<id\> (public attachment id)

The globally unique attachment identifier minted by `AttachmentStore.put()`, formatted as `att_` + 16-byte `randomBytes` encoded as base64url (`mintAttachmentId()` — `packages/server/src/attachment/id.ts`). History and the LLM context **store only the `att_<id>` reference**; base64 is briefly materialized only at two named exits (fed to the LLM for vision, and tool reads).

See [09 · Attachment System](./09-attachment-system.md).

### Artifact / Artifact iframe (Tier 4)

A WebExtension may declare a standalone HTML surface (`artifact.entry`) in `.pi/web/dist/`, which the host loads via `<iframe sandbox="allow-scripts">`—without `allow-same-origin`, so the iframe gets an opaque origin and cannot access the host's cookies/DOM/credentials. Bidirectional communication goes through `postMessage`, with message types constrained by `ArtifactMessage` from `@blksails/pi-web-protocol`. Mount gating: **`NEXT_PUBLIC_PI_EXTENSION_BASE_URL` must be set**, otherwise `ArtifactSurface` does not render.

See [12 · Web UI Extension](./12-web-ui-extension.md).

---

## B

### BlobStore (object-store port)

The pluggable storage interface for **L0** of the attachment system (`packages/server/src/attachment/blob-store.ts`), defining five capabilities—put / get / stream / delete / exists—plus `BlobNotFoundError`. The current implementation is `LocalFsBlobBackend` (persisting to `$PI_WEB_ATTACHMENT_DIR`); the interface is S3-style, making it easy to switch to other object-store backends in the future.

See [09 · Attachment System](./09-attachment-system.md).

### bootstrap runner

The subprocess entry script for custom agents (custom mode): `packages/server/runner-bootstrap.mjs` (pure ESM, requiring no jiti to start itself). It creates a jiti instance, loads `src/runner/runner.ts`, parses arguments via `parseRunnerArgs`, normalizes the agent via `loadAgentDefinition`, builds the session via `createAgentSessionRuntime`, and finally enters the never-returning RPC loop in `runRpcMode`.

See [08 · Agent Development](./08-agent-development.md).

---

## C

### CompletionProvider

A trigger-driven **completion registration framework** (`completion-provider-framework` spec). Taking `@` as an example, `AttachmentCompletionProvider` registers in `packages/server/src/completion/providers/attachment-provider.ts` and returns the list of attachments already present in the current session; the token form is `@attachment:<id>`, which is resolved into a canonical reference marker on submit. Developers can register custom providers that plug into the same completion endpoint.

See [09 · Attachment System](./09-attachment-system.md) and [10 · Extensions & Skills](./10-extensions-and-skills.md).

### createPiWebHandler

The **framework-agnostic HTTP handler factory** exported by `@blksails/pi-web-server` (`packages/server/src/http/create-handler.ts`). `createPiWebHandler(opts)` returns a value of type `PiWebHandler = (req: Request) => Promise<Response>` (Web Fetch API). The Next.js catch-all route merely forwards the standard `Request` to it losslessly and returns the `Response`—whose body contains an SSE `ReadableStream`—as-is, without rewriting status/headers/body and without buffering. The app mounts it under `/api/**`, and internally the handler routes to `/sessions/**` and `/config/**` (with the prefix stripped via `sse.basePath:"/api"`). This means the backend engine can in principle be mounted on any runtime that supports Web Fetch, without being tied to Next.js.

See [03 · Architecture](./03-architecture.md) and [24 · HTTP API Reference](./24-http-api-reference.md).

### ContributionPoints

A WebExtension Tier 3 capability, declared in `defineWebExtension({ contributions: { slash, mention, keybindings, … } })`. Slash command completion, @mention candidates, keybindings—the behavior of these contribution points is implemented by extension code and called back into the agent process for results via the **UI↔Agent RPC bus** (`POST /api/sessions/:id/ui-rpc`, internally routed by the handler to `/sessions/:id/ui-rpc`). The extension must declare `capabilities: ["contributions"]`, and the host automatically opens `openControlOnlyStream` when the session is idle.

See [12 · Web UI Extension](./12-web-ui-extension.md).

---

## D

### defineAgent

The **identity helper** exported by `@blksails/pi-web-agent-kit`; at runtime it returns its argument unchanged, serving only compile-time type inference. An equivalent `AgentDefinition` object written without this package can be loaded by the runner just the same.

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
export default defineAgent({ systemPrompt: "…" });
```

See [08 · Agent Development](./08-agent-development.md) and [05 · Packages](./05-packages.md).

### Dual-mode loading

The two modes in which pi-web loads an agent source, which nonetheless **expose the same RPC protocol** externally:

| Mode | Trigger | Spawn target |
|------|----------|------------|
| **custom** | Source directory has `index.[js\|ts]` | `runner-bootstrap.mjs` → jiti → `runRpcMode` |
| **cli** | Source directory has no entry | `pi --mode rpc` |

Both modes have identical underlying RPC implementations, the front-end/back-end bridge is fully reused, and only the spawn target differs. See [02 · Core Concepts](./02-core-concepts.md).

---

## E

### event → UIMessage translation layer

The **hinge between front and back** where the backend converts the RPC events emitted by the agent subprocess (text deltas, thinking blocks, tool calls, tool results, etc.) into AI SDK v5 `UIMessage` data-parts, then pushes them to the browser's `useChat` over SSE. The backend RPC bridge is guarded by integration tests against real subprocesses; the front-end translation layer is pure functions covered by unit tests.

See [02 · Core Concepts](./02-core-concepts.md) and [03 · Architecture](./03-architecture.md).

### extension UI sub-protocol

During execution, the agent subprocess can issue an `extension_ui_request` (confirm / select / input / editor) over RPC. The full path `RPC frame → PiSession.ControlStore.extensionUiQueue → SSE control frame → front-end useExtensionUI → PiInteraction inline card → ui-response → backend dequeue` is the extension UI sub-protocol. The pi SDK's built-in `RpcClient` does not expose this sub-protocol, which is one of the core reasons pi-web writes its own `PiRpcProcess`.

See [10 · Extensions & Skills](./10-extensions-and-skills.md) and [02 · Core Concepts](./02-core-concepts.md).

---

## F

### formSchema / Form IR

The normalized intermediate representation of the config UI, composed of `FormSchema` + `FieldDescriptor[]` (`packages/protocol/src/config/form-schema.ts`). Any source (a zod schema, JSON Schema, or hand-written) is first converted by an adapter into a `FormSchema`; the rendering layer `<SchemaForm>` recognizes only this IR, decoupling source from rendering. The `FieldDescriptor.widget` field lets you specify a custom renderer (e.g. `"providerSelect"`), dispatched through the `FieldRegistry` registry.

```ts
// GET /api/config/:domain returns:
{ formSchema: FormSchema, values: Record<string, unknown>, protocolVersion: string }
```

See [13 · Config UI](./13-config-ui.md).

---

## J

### jiti

A runtime TypeScript/ESM loader. The bootstrap runner creates an instance via `createJiti()` and imports the user's `index.ts` directly inside the subprocess, with no precompilation. The jiti root is anchored at the `@blksails/pi-web-server` package directory, ensuring dependencies such as the pi SDK resolve from the correct location.

See [08 · Agent Development](./08-agent-development.md) and [03 · Architecture](./03-architecture.md).

### JSONL framing

The inter-process communication format between `PiRpcProcess` and the agent subprocess: each message is a JSON object serialized as a single line terminated by `\n`. It splits strictly on `\n` and strips `\r`, and **disables Node `readline`**—because readline treats `U+2028` (LS) and `U+2029` (PS) as line separators, which would break those two characters when embedded inside JSON.

Messages fall into three classes: `response` (command response), `event` (streaming event), and `extension_ui_request` (extension UI request).

See [02 · Core Concepts](./02-core-concepts.md) and [03 · Architecture](./03-architecture.md).

---

## K

### Kiro (steering / spec)

Kiro is the **Spec-Driven Development framework** adopted by the pi-web project.

- **Steering** (`.kiro/steering/`): project-level AI steering files (`product.md`, `tech.md`, `structure.md`, etc.), loaded as persistent context across all sessions to constrain AI behavior.
- **Spec** (`.kiro/specs/<feature>/`): the formal specification for a single feature, containing `requirements.md`, `design.md`, `tasks.md`, and `evidence/` (acceptance evidence). Development follows a requirements → design → tasks 3-phase approval flow, with human confirmation at each phase before advancing to the next.

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
| L3 | context gate | `beforeToolCall` ownership check + `afterToolCall` base64 stripping; composed into pi's `agent.beforeToolCall`/`afterToolCall` by `wireAttachmentBridge()` (`packages/server/src/runner/attachment-wiring.ts`) |

See [09 · Attachment System](./09-attachment-system.md).

---

## O

### openControlOnlyStream

A dedicated SSE downstream connection that the host automatically opens when a WebExtension needs `ui-rpc` callbacks (i.e. it declares `contributions`, or carries an Artifact with a configured base URL—`needsIdleControl = hasContributions || hasArtifactRpc`) **and** the session is **idle** (`!isBusy`), used to receive the control frames for `ui-rpc` responses. This connection is closed while the per-prompt message stream is being emitted (the message stream takes over), avoiding concurrency conflicts. Source at `packages/ui/src/chat/pi-chat.tsx:400-410`.

See [12 · Web UI Extension](./12-web-ui-extension.md).

---

## P

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

The **local implementation** of `PiRpcChannel`, wrapping Node `child_process.spawn` and handling the three message classes (`response`, `event`, `extension_ui_request`) via JSONL framing. pi-web writes this class itself instead of using the SDK's built-in `RpcClient` because that SDK version hardcodes spawning `pi` and does not expose the extension UI sub-protocol.

See [03 · Architecture](./03-architecture.md).

### protocolVersion

The **semantic version string** exported by the `@blksails/pi-web-protocol` package, carried with every SSE frame. Clients can use it to detect version compatibility (`PiProtocolVersionError`). Any change to the protocol types/schemas must follow semantic versioning.

See [05 · Packages](./05-packages.md) and [24 · HTTP API Reference](./24-http-api-reference.md).

---

## R

### renderer (Tier 2)

The **custom card renderer components** a WebExtension registers in `defineWebExtension({ renderers: { tools: {…}, dataParts: {…} } })`, isolated by per-session namespace so multiple extensions do not override one another. When the host receives a matching `tool-*` or `data-*` part, it calls the corresponding renderer. In a real dev environment, triggering requires the LLM to actually call a tool; you can verify offline with `PI_WEB_STUB_AGENT=1`.

See [12 · Web UI Extension](./12-web-ui-extension.md).

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

The function exported by the pi SDK (`@earendil-works/pi-coding-agent`) that, inside the agent subprocess, starts a **never-returning RPC loop**: listening for stdin JSONL frames, routing requests such as `command` / `run` / `get_commands`, and writing streaming events to stdout. Both custom mode and cli mode reuse the same `runRpcMode` implementation, which is the technical basis for the two modes being fully protocol-compatible.

See [08 · Agent Development](./08-agent-development.md) and [02 · Core Concepts](./02-core-concepts.md).

---

## S

### Session

One session = **one resident agent subprocess + one long-lived SSE connection**. `POST /api/sessions` creates a session and returns a `sessionId`; `PiSession` (`session-engine` spec) handles event broadcasting, lifecycle management, and the extension UI suspension table. Session state is bound to the instance hosting the resident process, which is the fundamental reason pi-web **cannot run Serverless/Edge** and requires sticky routing for horizontal scaling.

See [02 · Core Concepts](./02-core-concepts.md) and [03 · Architecture](./03-architecture.md).

### SessionStore

The active session registry interface (`packages/server/src/session/session-store.ts`), with the default implementation `InMemorySessionStore`—a `Map` keyed by `sessionId`, hung on `globalThis` (`Symbol.for("@blksails/pi-web-server:InMemorySessionStore")`) to survive dev hot-reload. The interface is externalized, reserving a seam for future distributed backends such as Redis / Durable Object.

> Note: this is a different abstraction from the session history **persistence** layer `SessionEntryStore` (`packages/server/src/session-store/`, with three backends—`fs` / `sqlite` / `postgres`—selected by the `SESSION_STORE` environment variable, defaulting to `fs`); do not confuse the two.

See [03 · Architecture](./03-architecture.md).

### Slots

A WebExtension Tier 1 capability that injects content into the host's 19 named regions (`background`, `headerLeft/Center/Right`, `panelRight`, `empty`, `toolbar`, `statusBar`, `logs`, etc.) via `defineWebExtension({ slots: { [SlotKey]: ReactNode } })`. Slots mount in an **additive** manner, not replacing the host's kernel surface. When the host has not declared the corresponding slot, it is silently ignored.

See [12 · Web UI Extension](./12-web-ui-extension.md).

### SSE frame (Server-Sent Events frame)

The unit of streaming data that the front end and back end push over the `text/event-stream` protocol. Each frame carries `protocolVersion`, and the event types include: `ui-message-chunk` (message stream), `control` (control frame, containing `ui-rpc` responses, `extension_ui_request`, `stats`), and so on. On the browser side, `PiSessionConnection` (`@blksails/pi-web-react`) parses frames and routes them to `ControlStore` or `useChat`.

See [24 · HTTP API Reference](./24-http-api-reference.md).

### standalone (build artifact)

The minimal Node server bundle generated by Next.js `output: "standalone"`, which can run independently outside the monorepo source tree. `scripts/pack-standalone.mjs` fills in static assets (`static/`, `public/`). The `outputFileTracingIncludes` setting in `next.config.ts` explicitly includes runtime dynamic dependencies such as runner-bootstrap, the pi SDK, and jiti—without this configuration, real sessions cannot start.

CLI build command: `pnpm build:cli` (`NEXT_DIST_DIR=.next-cli next build`).

See [18 · CLI](./18-cli.md) and [19 · Deployment](./19-deployment.md).

### steering

See **Kiro**.

### sticky routing

The routing policy under horizontal scaling whereby **all requests for the same `sessionId` must be routed to the same instance** (the instance hosting the corresponding subprocess). nginx implements it via `ip_hash` or `$cookie_SESSION`; K8s implements it via `Service.sessionAffinity=ClientIP` or an Ingress annotation. Without it, subsequent requests are routed to an instance lacking that subprocess, causing 404s or silent disconnects.

See [03 · Architecture](./03-architecture.md) and [19 · Deployment](./19-deployment.md).

### Declarative layout (Declarative Config, Tier 5)

Without carrying any JS bundle, a WebExtension can simply declare in the `config` field of `manifest.json` such settings as `layout` (the host `LayoutPreset` takes `"centered"` / `"wide"` / `"full"` / `"split"`, see `packages/ui/src/customization/layout.ts`), `theme` (CSS variables), `documentTitle`, and `empty` (empty-state copy and starters); the host reads and applies them directly. The lightest-weight path to zero-code UI customization.

See [12 · Web UI Extension](./12-web-ui-extension.md).

---

## T

### trustPolicy

The **replaceable policy plugin point** that decides whether an agent source, or resources under a project `.pi/` directory (skills/extensions/prompts), may be loaded. Its values are `"always"` to allow, `"ask"` (default), or `"never"` to deny. cli mode allows via `--approve` / `defaultProjectTrust:"always"`; custom mode passes the trust signal via the `PI_WEB_TRUST_PROJECT` environment variable. Persistence implementation: `FsProjectTrustStore`, which reads and writes `<agentDir>/trust.json` (exported from the `@blksails/pi-web-server/trust` subpath).

See [10 · Extensions & Skills](./10-extensions-and-skills.md) and [03 · Architecture](./03-architecture.md).

---

## W

### WebExtension

The **UI control layer** that each agent source can carry in its `.pi/web/` directory, which the host dynamically loads when a session of that source becomes active. The entry file `web.config.tsx` default-exports the return value of `defineWebExtension(…)`, and `pi-web build` produces `web-extension.mjs` + `manifest.json` (with SRI). The host verifies SRI + signature allowlist + version compatibility before loading. It comprises five capability tiers (Tier 1–5): slots, renderers, contribution points, Artifact iframe, and pure declarative config.

See [12 · Web UI Extension](./12-web-ui-extension.md).

---

## Quick Index

| Term | Detailed chapter |
|------|---------|
| Agent Source | [02](./02-core-concepts.md), [07](./08-agent-development.md) |
| AgentDefinition / defineAgent | [07](./08-agent-development.md), [04](./05-packages.md) |
| agentHostProvider | [03](./03-architecture.md) |
| att\_\<id\> | [08](./09-attachment-system.md) |
| Artifact iframe | [10](./12-web-ui-extension.md) |
| BlobStore / L0–L3 | [08](./09-attachment-system.md) |
| bootstrap runner | [07](./08-agent-development.md) |
| CompletionProvider | [08](./09-attachment-system.md), [09](./10-extensions-and-skills.md) |
| createPiWebHandler | [03](./03-architecture.md), [13](./24-http-api-reference.md) |
| ContributionPoints | [10](./12-web-ui-extension.md) |
| Dual-mode loading | [02](./02-core-concepts.md) |
| extension UI sub-protocol | [09](./10-extensions-and-skills.md), [02](./02-core-concepts.md) |
| formSchema / Form IR | [12](./13-config-ui.md) |
| JSONL framing | [02](./02-core-concepts.md), [03](./03-architecture.md) |
| Kiro steering / spec | [CLAUDE.md](../../CLAUDE.md) |
| openControlOnlyStream | [10](./12-web-ui-extension.md) |
| PiRpcChannel / PiRpcProcess | [02](./02-core-concepts.md), [03](./03-architecture.md) |
| protocolVersion | [04](./05-packages.md), [13](./24-http-api-reference.md) |
| renderer | [10](./12-web-ui-extension.md) |
| resolve projection | [08](./09-attachment-system.md) |
| runRpcMode | [07](./08-agent-development.md), [02](./02-core-concepts.md) |
| Session | [02](./02-core-concepts.md), [03](./03-architecture.md) |
| SessionStore | [03](./03-architecture.md) |
| Slots | [10](./12-web-ui-extension.md) |
| SSE frame | [13](./24-http-api-reference.md) |
| standalone | [14](./18-cli.md), [15](./19-deployment.md) |
| sticky routing | [03](./03-architecture.md), [15](./19-deployment.md) |
| Declarative layout | [10](./12-web-ui-extension.md) |
| trustPolicy | [09](./10-extensions-and-skills.md), [03](./03-architecture.md) |
| WebExtension | [10](./12-web-ui-extension.md) |

---

## Next / Related

- To understand the overall runtime model, start with [02 · Core Concepts](./02-core-concepts.md).
- To see process boundaries and dependency constraints: [03 · Architecture](./03-architecture.md).
- To start developing a custom agent: [08 · Agent Development](./08-agent-development.md).
- To start writing a WebExtension: [12 · Web UI Extension](./12-web-ui-extension.md).
