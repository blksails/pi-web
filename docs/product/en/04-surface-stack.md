# 04 · The Surface Authoritative-Surface Stack

**Surface treats the agent subprocess as a "domain micro-backend": the authoritative state lives with a single writer inside the subprocess, and the frontend does nothing more than a thin projection (reading snapshots) plus a command originator (dispatching intents) — the two never talk to each other directly.** This is a **second cross-process communication plane**, orthogonal to the chat-stream RPC channel. It is already implemented on `main` (`createSurface` / `wireSurfaceBridge` / `useSurface`, backed by real subprocess integration tests) and drives the Canvas workbench end to end. This chapter first explains what problem it solves and what the mental model is, then defers the API details to the end.

---

## Why a Second Communication Plane

Up to this point, your mental model of pi-web has been a single chat stream: "browser ↔ RPC channel ↔ agent subprocess" — the user sends a message, the LLM streams back events, and they are translated into `UIMessage`s for rendering (see [02 · Core Concepts](./02-core-concepts.md) and [03 · System Architecture](./03-architecture.md)). This plane is a great fit for **conversation**, but a poor fit for carrying a **rich interactive application surface** — a canvas, a drill-down report, a video workbench. What they all share is:

- The UI holds a piece of **structured state** (which images are in the gallery, the current version, the mask overlay) that must stay in sync in real time;
- The user's operations on the UI (rotate, register an uploaded image, switch versions) are **deterministic mutations**, most of which never need to bother the LLM;
- That state may be very hot and update very frequently, yet **it does not fit inside the LLM context** (tokens are too expensive).

Cramming all of this into the chat stream would immediately hit pi's physical constraints (`docs/surface-app-runtime-contract-v1.md:23-27`): the agent has only three downstream types (`event` / `response` / `extension_ui_request`), tools cannot pull on their own, pi has no `ctx.state`, and the sole pipe is stdin/stdout JSONL (`writeSync` is atomic only up to ≤ 64KB).

**The one stable solution** (not a matter of taste, but the necessary outcome filtered out by stress-testing four scenarios):

> The authoritative state lives inside the agent process as a **single writer**; the UI only receives snapshots and only dispatches commands; the host (server) acts as a neutral proxy and message bus.

In the code this paradigm is called **agent-authoritative-surface**, see `packages/tool-kit/src/surface/create-surface.ts:1-16`. Its single authoritative framework-level document is [`docs/surface-app-runtime-contract-v1.md`](../../surface-app-runtime-contract-v1.md) (the Surface App Runtime Contract v1).

> **About the term "AAS"**: an earlier document `docs/agent-authoritative-surface-design.md` called this paradigm "AAS (Agent-Authoritative Surface)" and sketched a "five-channel" framework. That is a design draft **explicitly marked as pre-spec** — Contract v1 has since folded its five channels into C1 and reconciled its eight open questions (`surface-app-runtime-contract-v1.md:14,363-374`). Wherever "AAS" appears in this chapter, it is cited **only as the historical vocabulary of that design draft**; what is actually shipped and backed by code is the `createSurface` / `wireSurfaceBridge` / `useSurface` trio described below, not a finished product called an "AAS SDK".

---

## Three Mental-Model Laws

### Law 1 · Single-Writer CQRS

The authoritative state (S) can be written only by the agent process. Any bypass — the UI writing the snapshot directly, or a route handler writing domain state — is an "unpermitted structure". Commands (C) are mutation intents; the read model (R) is a rev-tagged snapshot broadcast. Writes and reads are split into two paths: **commands go up, snapshots come down** — that is CQRS.

This eliminates concurrency control by construction: since there is only one writer, there can be no write conflicts.

### Law 2 · The Two-Client Theorem

The same "domain micro-backend" has **two clients**:

| Client | How it changes state | Example |
|---|---|---|
| Conversation stream (LLM via tools) | LLM calls a tool → deterministic code inside the tool mutates the snapshot | "Please inpaint this part of the image" |
| Application-surface UI (via ui-rpc commands) | User clicks a button → the command mutates the snapshot | Click "Rotate 90°" |

**The two clients never communicate directly.** Consistency comes from the single writer: no matter who triggers a change, everything ultimately lands in the same authoritative snapshot and is projected back to the UI. So "conversation-driven surface" does not exist architecturally; what exists is "conversation drives the authority, the authority projects to the surface" (`surface-app-runtime-contract-v1.md:31,181-183`).

### Law 3 · A Command Returns "What Happened"; the Snapshot Is "What Is Now"

A command's return value only reports "what this operation did" (e.g. `{count: 3}`). The UI **must never** render authoritative data from a command's return value — that comes from the snapshot. This law makes the frontend naturally immune to "dropped response frames" (empirically observed under dev StrictMode's double-mount idle-stream race), and as a corollary yields **v1 having no optimistic-update protocol**: when you need instant feedback, render it with local transient state rather than pre-writing a snapshot mirror (`surface-app-runtime-contract-v1.md:110-118`).

---

## The Foundation: The State-Injection Bridge (Bidirectional Shared KV)

Surface did not spring up from nothing; it stands on a more basic piece of infrastructure — the **state-injection bridge**: a **session-scoped shared KV** whose authority lives in the agent subprocess and which is readable and writable in both directions across front and back ends.

- **Authoritative side**: inside the subprocess, the server's `wireStateBridge` builds a KV provider of its own and hangs it on the globalThis seam `__piWebSessionState__`. The agent author reads and writes it synchronously via `getSessionState()` inside a tool's `execute` (`packages/tool-kit/src/session-state.ts:14-73`). Writes take effect immediately, with zero cross-process cost.
- **Downstream**: any write is mirrored to the UI in real time via a `control:"state"` frame (carrying a monotonic `rev` and a `deleted` flag). This mirror **travels outside the context and never enters the LLM history**.
- **Upstream write-back**: the frontend may write back **preference-class keys** (`<ns>.<pref>`, e.g. `aigc.model`) via `POST /sessions/:id/state`; **writing `surface:*` is forbidden** — the authoritative snapshot may be written only by the agent process (single writer, `surface-app-runtime-contract-v1.md:262-263`).

Surface reuses exactly this bridge: a domain's authoritative snapshot lands on the KV key `surface:<domain>`. What `createSurface` does internally to mutate the snapshot is essentially `getSessionState().set("surface:<domain>", snapshot)` — it **does not fabricate any control frame of its own**, borrowing the state-injection bridge's downstream primitive wholesale (`create-surface.ts:36-37,150-154`).

> The authorized use of the agent-author-facing `getSessionState()` is covered in [08 · Custom Agent Development](./08-agent-development.md); the HTTP/SSE contract for the write-back endpoint and the `control:"state"` frame is in [24 · HTTP/SSE API Reference](./24-http-api-reference.md).

Each of the four state classes has a single home; do not co-mingle them (`surface-app-runtime-contract-v1.md:248-254`):

| Class | Home | Lifecycle | Example |
|---|---|---|---|
| Transient interaction | UI/engine local | Dies on component unmount | Gesture draft, zoom, hover |
| Session preference | State-bridge KV (`<ns>.<pref>`) | Within the session | `aigc.model` / `size` |
| Authoritative domain snapshot | `surface:<domain>` (agent process) | Rebuilt via hydrate when the subprocess dies | Gallery, DAG, view descriptor |
| Persistent state | Artifact store / attachment store | Across restarts | Image + lineage |

---

## Surface's Three Planes

A surface is a triple `Surface<S> = (S, C, R)`, laid out across three channels:

```
Application-surface UI (React: useSurface / useConversationBridge)
   │  ▲
   │  │  State plane: control:"state" snapshot downstream (sticky, rev-converging, replay on reconnect)
   │  └──────────────────────────────────────────────
   │  Control plane: ui-rpc command upstream (point=command / action=execute)
   ▼
Hono host (server/index.ts, neutral message bus, zero domain semantics)
   │  stdin JSONL: {"type":"ui_rpc",...}         ▲ fd1: {"type":"ui_rpc_response",...}
   ▼                                             │
Agent subprocess
   ├─ wireSurfaceBridge: intercept ui_rpc lines → dispatch by domain → write fd1 directly to reply
   └─ createSurface: __piWebSurfaces__ registry · authoritative-snapshot single writer · probe command surface:<domain>
```

- **State plane (downstream)**: `control:"state"` snapshot push, sticky (last-value overwrite), replayed on reconnect. Small and hot, full state, rev-converging.
- **Control plane (upstream)**: commands travel up over Tier3 ui-rpc's **agent forwarding path** — the key trick is that the command payload **has no top-level `name` field**, so `safeParse` fails to catch it in the host's host-command interception and it naturally falls through to `session.uiRpc` forwarding into the subprocess (`packages/protocol/src/web-ext/surface.ts:11-13,30-34`).
- **Data plane (planned)**: Contract v1 reserves a slot for a "large and cold, read-only, cacheable" data plane (fetching data pages via Agent Routes), but the whole chapter is marked **[to be finalized]** and takes effect with a future M-B (`surface-app-runtime-contract-v1.md:284-288,412-425`). This stack **does not include** it today; do not treat it as a shipped capability.

A domain is **unique** within a session: re-registration is an assembly error (the later registrant is rejected + diagnostics, `surface-app-runtime-contract-v1.md:103-105`).

---

## The Conversation Bridge: Letting Surface Operations Flow Back into the Conversation

Some surface operations genuinely need the LLM in the loop (to have it pick a tool or fill in arguments), for example "generate an image". Such operations **must** go through the host's Prompt channel, be assembled into a structured user message, and enter the conversation stream — so the operation also flows back into the conversation history, becoming visible, replayable, and referenceable ("make that last one brighter"). This layer is capped inside the `useConversationBridge` facade (`packages/react/src/hooks/use-conversation-bridge.ts`).

It gathers the three raw props injected by the host (session-submit capability / turn-end signal / control-plane access) into four capabilities, at whose core is the **opChannel three-state degradation** (`use-conversation-bridge.ts:75-88`) — the application surface must not skip a level:

| opChannel | Condition | Behavior | LLM in the loop? |
|---|---|---|---|
| `prompt` | Prompt channel is injected | `renderSurfaceOp(op)` renders it as a user message, going through the conversation stream | **In the loop** |
| `command` | Prompt is missing, but the probe `surface:<domain>` is present | Degrades to `surface.run(domain, action, args)` (requires `op.fallback`) | Not in the loop |
| `unavailable` | Neither is available | Action disabled / read-only degradation | — |

`prompt` and `command` differ in semantics (the latter is invisible to the LLM), so the **UI must present the degraded state perceptibly** (Canvas even shows a line "surface unavailable, only local tools available", `surface-app-runtime-contract-v1.md:212-214`).

The **positive criteria** for deciding which path to take (satisfy any one to go through Prompt): ① it needs LLM judgment; ② the operation should enter history visibly and replayably; ③ later conversation must be able to refer to it. Pure data operations (`register` / `delete` / `sync`) always go through the control plane and never enter the conversation (`surface-app-runtime-contract-v1.md:203-207`).

`renderSurfaceOp` is a **pure function** that renders a `SurfaceOp` (title + tool + ordered arguments) into a fenced user message; the same input always yields the same output (`packages/web-kit/src/surface-op.ts:57-66`). It lives in web-kit (the framework-agnostic canonical home), and the facade hook assembles on top of it.

---

## Canvas: An End-to-End Positive Instance

The Canvas workbench is the reference consumer of the Surface stack, and the only application surface that exercises the full chain. Watch how it uses each of the pieces above:

1. **On the agent side**, `canvasSurfaceExtension` installs a `domain="canvas"` authoritative surface via the upstream `createSurface`, whose snapshot is the gallery materialized view `GalleryState`; the command table includes the six A-tier re-creation actions plus `register` / `sync` / `delete` (`packages/tool-kit/src/aigc/canvas/extension.ts:27,87-107`).
2. **hydrate**: on subprocess restart the gallery is rebuilt by enumerating via the attachment seam, without blocking session startup (`extension.ts:97-104`).
3. **State plane**: the gallery, the current version, and `livePreview` (the "blurry-to-sharp" during generation) all come down inside the `surface:canvas` snapshot. Note that `livePreview` deliberately **carries only the stage and discards the large-image data URI** — large frames written concurrently with pi RPC to fd1 would interleave and corrupt the JSONL (upholding the "no binary in frames" invariant, `extension.ts:108-117`).
4. **Control plane + conversation bridge**: "generate" hits all three positive criteria → goes through the Prompt channel (the LLM calls the `image_edit` tool); "rotate 90°" hits none → goes through the control plane `register`. The tool persists the artifact and pushes the snapshot, the UI subscribes to the snapshot and shows the new image — **the return trip is always the state plane, never a message**.
5. **Turn-end convergence**: `agent_end` triggers a full rebuild that wholesale-replaces the snapshot and clears the `livePreview` overlay (`extension.ts:122-135`).

In one sentence: **Canvas can let human and machine co-edit the same canvas precisely because the canvas state is the single-writer snapshot of `domain=canvas` inside the agent process, and the conversation stream and the user UI are merely its two clients.** The Canvas user surface is covered in [16 · Canvas Workbench](./16-canvas-workbench.md), and the plugin-author surface in [17 · Canvas Plugin Development](./17-canvas-plugins.md).

---

## Getting Started: Running a Domain-Agnostic Surface End to End

The repo ships a **zero-AIGC-dependency** minimal example `surface-demo-agent`, a counter + echo-log surface.

### Step 1 · Launch It

```bash
pi-web ./examples/surface-demo-agent
```

Omitting the model → inherits the default provider/model from `~/.pi/agent/settings.json`. The command interaction itself **needs no provider credentials** (commands execute deterministically inside the subprocess, bypassing the LLM); only the conversation reply uses the LLM (`examples/surface-demo-agent/README.md:22-27`).

**Expected result**: a surface panel appears in the browser, showing `count: 0` and an empty log.

### Step 2 · See How the Agent Side Declares It

`examples/surface-demo-agent/index.ts:33-53` lands the whole paradigm as a single config:

```ts
import { createSurface, type SurfaceCtx } from "@blksails/pi-web-tool-kit/runtime";

interface DemoState { count: number; log: string[]; }

export default defineAgent({
  extensions: [
    (pi) => {
      createSurface<DemoState>(pi, {
        domain: "demo",
        initialState: { count: 0, log: [] },
        commands: {
          // A command returns "what happened"; the snapshot is "what is now".
          increment: (_args, ctx: SurfaceCtx<DemoState>) => {
            ctx.setState((s) => ({ ...s, count: s.count + 1 }));
            return { count: ctx.get().count };
          },
          echo: (args, ctx: SurfaceCtx<DemoState>) => {
            const text = String((args as { text?: unknown })?.text ?? "");
            ctx.setState((s) => ({ ...s, log: [...s.log, text] }));
            return { echoed: text, size: ctx.get().log.length };
          },
        },
      });
    },
  ],
});
```

**Key points**: `initialState` is constructed inside the closure (no reference shared across sessions); commands mutate the snapshot via `ctx.setState(reducer)`, and the SDK automatically pushes a `control:"state"` downstream frame through the state-injection bridge; the probe command `surface:demo` is **registered automatically** by `createSurface`, with no explicit declaration needed.

### Step 3 · Click increment on the Panel

**Expected result**: `count` becomes 1, and the log/count updates in real time. The path is: the UI dispatches `run("increment")` → ui-rpc (payload has no `name`, escaping host interception) → the subprocess's `wireSurfaceBridge` dispatches by domain to `commands.increment` → mutates the snapshot → `control:"state"` mirrors it back. The command **never touches the LLM at any point**.

### Step 4 · Verify Degradation

Switch the source to one that is not that domain (e.g. `pi-web ./examples/hello-agent`); the panel's probe `surface:demo` is missing → `available===false`.

**Expected result**: the panel degrades to read-only and **does not error** — which is exactly the behavior the opChannel `unavailable` state should have.

---

## API Details (Deferred to Chapter End)

Four edges, five symbols, remembered by "who is on which side":

| Symbol | Side | Responsibility | Evidence |
|---|---|---|---|
| `createSurface(pi, config)` | Agent subprocess | Builds a domain-named authoritative surface: writes the registry, registers the probe, pushes the first frame at assembly time | `packages/tool-kit/src/surface/create-surface.ts:130-232` |
| `getSurfaceRegistry()` / `__piWebSurfaces__` | Agent subprocess | In-process `domain→dispatch` registry seam, independent of assembly order | `packages/tool-kit/src/surface/surface-registry.ts:16,49-68` |
| `wireSurfaceBridge(runtime, …)` | Server runner | A second stdin JSONL reader: intercept `ui_rpc` lines → dispatch by domain → `writeSync(1)` writes fd1 directly to reply | `packages/server/src/runner/surface-wiring.ts:109-228` |
| `useSurface(domain, opts)` | React frontend | `{state, run, available, rev}`: mirrors the snapshot + command upstream + probe | `packages/react/src/hooks/use-surface.ts:56-155` |
| `useConversationBridge(opts)` | React frontend | `{opChannel, submitOp, bringToConversation, onTurnEnd}` conversation-bridge facade | `packages/react/src/hooks/use-conversation-bridge.ts:70-189` |
| `renderSurfaceOp(op)` / `SurfaceOp` | web-kit | Pure function from `SurfaceOp` → user-message text | `packages/web-kit/src/surface-op.ts:57-66` |

The root contract types live in the protocol package (`packages/protocol/src/web-ext/surface.ts`): `surfaceStateKey(domain)`→`surface:${domain}`, `SurfaceCommandPayloadSchema{domain,action,args}` (**no top-level `name`**), and `SurfaceCommandResultSchema{ok,data?,error{code,message}?}`.

### The Command-Handler Contract

`SurfaceCtx<S>` gives a command handler three things (`create-surface.ts:33-41`): `get()` reads the current snapshot, `setState(reducer)` mutates the snapshot (auto-pushing a downstream frame), and `attachments` reuses the existing attachment tool context (resolve `att_` / persist artifacts, binary never enters the snapshot).

A command handler's return value has three normalization paths (`create-surface.ts:167-190`): a normal return value → dispatch wraps it as `{ok:true,data}`; returning `{ok:false,error:{code,message}}` → passed through, preserving a stable domain code; throwing `SurfaceCommandError(code,msg)` → `.code` propagates into the result.

### Assembly Order (Server Runner)

`wireSurfaceBridge` is assembled inside `startRunner`, **before** `runRpcMode(runtime)` and **after** `wireStateBridge` (`packages/server/src/runner/runner.ts:337-348`). The reason it must write fd1 directly rather than `process.stdout.write`: pi's `runRpcMode` calls `takeOverStdout()` to redirect stdout to stderr, so RPC frames are written over the original fd1, and this bridge must likewise write fd1 directly to be read by the server's `PiRpcProcess` (`surface-wiring.ts:15-21`). When no surface is registered, non-surface lines pass through as usual (a lazy no-op that does not affect sessions not using this stack).

---

## Next Steps / Related

- Where this plane sits in the overall architecture (its relationship with RPC/SSE) → [03 · System Architecture](./03-architecture.md)
- The other orthogonal plane, "event → UIMessage" → [02 · Core Concepts](./02-core-concepts.md)
- The package boundaries carrying this stack (protocol / server / react / web-kit / tool-kit) → [05 · Packages](./05-packages.md)
- The authorized use of the agent-author-facing `getSessionState()` → [08 · Custom Agent Development](./08-agent-development.md)
- Its orthogonality to the 5-tier mounting mechanism, and Tier4 `artifactSurface` (an iframe surface, a different concept from this stack's Surface) → [12 · Web UI Extensions](./12-web-ui-extension.md)
- The user-facing canvas editor built on top of this stack → [16 · Canvas Workbench](./16-canvas-workbench.md)
- The Canvas plugin-author surface → [17 · Canvas Plugin Development](./17-canvas-plugins.md)
- The HTTP/SSE contract for the `POST /sessions/:id/state` write-back endpoint, the `control:"state"` mirror frame, and ui-rpc forwarding → [24 · HTTP API Reference](./24-http-api-reference.md)
- Terms such as Surface / AAS (design vocabulary) / CQRS single writer / SurfaceOp / opChannel → [26 · Glossary](./26-glossary.md)
- The single authoritative framework-level design document → [`docs/surface-app-runtime-contract-v1.md`](../../surface-app-runtime-contract-v1.md)
