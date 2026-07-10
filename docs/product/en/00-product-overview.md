# 00 · Product Overview

## One-Line Positioning

**pi-web is the instant Web UI for custom pi agents.** Given a directory or git repository (containing an `index.[js|ts]` entry written with the pi SDK), it automatically loads the agent and spins up a streaming web chat UI—turning any agent written with the [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) SDK into a UI-equipped product in seconds.

## What Problem It Solves

Writing the logic of a pi agent (system prompt, tools, model, extensions) is only half the work; to make it **usable by humans**, you also need a full frontend: streaming rendering, tool-call display, thinking blocks, permission prompts, attachment uploads, model switching, session management… all repetitive and expensive engineering.

pi-web shrinks the distance between "having written a pi agent" and "it being a web product" to nearly zero.

## 30-Second Taste

From the repository root, a single command brings up the one-session-one-process streaming UI (script defined in `package.json:17`):

```bash
pnpm dev
# dev-all.mjs concurrently launches two processes:
#   · Vite frontend dev server → http://localhost:5173 (HMR + SPA)
#   · Hono API host            → http://127.0.0.1:3000 (/api is reverse-proxied by Vite)
# Open http://localhost:5173 in the browser to reach the source-picker page
```

> The browser entry point during development is **5173** (Vite); 3000 is the proxied API host—opening 3000 directly only shows the bare API. For the full first-streaming-reply + tool-call walkthrough, see [01 Quickstart](./01-quickstart.md).

## Core Capabilities

- **Dual-mode loading** — If an entry is detected in the source (`index.ts` > `index.js` > `index.mjs`, or overridden by `package.json#pi-web.entry`) → your custom agent runs via the SDK's `runRpcMode`; if there is no entry → it falls back to the general `pi --mode rpc`. Both expose **the same RPC protocol** externally, the front-to-back bridge is fully reused, and only the spawn target differs. See [02 Core Concepts](./02-core-concepts.md) for entry detection and trust policy.
- **Streaming chat UI** — The frontend is a Vite-driven SPA (React + shadcn/ui + AI Elements, with the root `index.html` as the static entry and `src/main.tsx` as the module entry, building to `dist/client`); the server host is Hono (`server/index.ts` has a single `app.all('/api/*')` forwarding to the singleton handler). Text / thinking / tool calls are rendered over SSE + a custom AI SDK v5 `ChatTransport`.
- **Native pi resources, straight through** — extensions / skills / prompt templates are auto-discovered and declaratively injected; permission prompts flow through the extension UI sub-protocol into frontend dialogs. See [10 Extensions / Skills / Templates](./10-extensions-and-skills.md).
- **Sessions list and resume** — Browse historical sessions and resume any of them by `sessionId` with one click, re-subscribing to its event stream to continue the conversation. See [14 Sessions List](./14-sessions-list.md).
- **Attachment system** — Image/file uploads are persisted through a pluggable object store (local first) with signed delivery URLs. Two consumption paths: **base64 fed to the LLM for vision**, and **files handed to a server-side tool** (image editing/generation) that resolves and executes via `attachmentId`, with outputs flowing back and available to be referenced again on the next turn. See [09 Attachment System](./09-attachment-system.md).
- **AIGC and vision tools** — Built-in `image_generation` / `image_edit` tools for image generation and editing (multi-provider routing), plus an `image_vision` image-understanding tool + `/img_vision` command (answer questions about an existing image in the session or the most recent one). All are loaded via `extensions:[aigcExtension, visionExtension]`. See [11 AIGC and Vision Tools](./11-aigc-and-vision-tools.md).
- **Canvas Workbench** (optional) — An image-focused, remix-oriented canvas editor: stage zoom/pan, a tool rail, mask/annotation overlays, six generation actions, a version bar and gallery, plus a "Read" button on the prompt bar that assembles the current working image into a vision-tool request looped back into the conversation. It is carried by the independently published `canvas-kit` / `canvas-ui` packages and is not mounted by default. See [16 Canvas Workbench](./16-canvas-workbench.md) and [17 Canvas Plugin Development](./17-canvas-plugins.md).
- **Custom providers** — Any OpenAI-compatible gateway (NewAPI, DashScope…) can be wired in via `~/.pi/agent/models.json`; the settings UI offers a searchable model dropdown grouped by provider. See [07 Providers and Models](./07-providers-and-models.md).
- **Web UI extensions** — Each agent source can carry a `.pi/web` control layer, contributing buttons/panels/declarative layouts/custom renderers/artifact iframes through a five-tier model. See [12 Web UI Extension](./12-web-ui-extension.md).
- **Two orthogonal communication planes** — Beyond the chat stream (RPC / SSE), pi-web has a second, orthogonal **Surface authoritative-surface** plane: the agent subprocess holds authoritative state per domain, mirrors it downstream to the frontend, and executes commands upstream (a single-writer CQRS convention), driving Canvas end to end. See [04 Surface Authoritative-Surface Stack](./04-surface-stack.md).

## Delivery Forms

pi-web has two parallel delivery paths:

- **Web server** — Bundled by esbuild into a single-file `dist/server.mjs` (the entry must sit at the build root) plus the frontend build `dist/client`; `pi-web <dir>` brings up a self-contained instance in one command. See [18 CLI](./18-cli.md) and [19 Deployment and Operations](./19-deployment.md).
- **Desktop (Tauri)** — main already carries a Tauri v2 desktop shell, producing dmg / nsis / appimage installers across three forms, shipping a Node sidecar and unpacking the shared runtime into `~/.pi/web/runtime` on first launch. Suited to users who just want to double-click and run. See [20 Desktop (Tauri) Packaging and Distribution](./20-desktop-tauri.md).

## Target Use Cases

1. **Quickly putting a production-ready web frontend on a custom pi SDK agent.** This is the primary scenario.
2. **Offering a general pi coding agent as a web service.**
3. **Serving as the kernel + open layer for a future pi cloud (multi-agent management / e2b sandboxes / edge / device onboarding).**

## Value Proposition

> Shrink the distance between "having written a pi agent" and "it being a web product" to nearly zero; at the same time, through layered openness, it can be deployed as a full site or integrated on demand by any stack.

## Relationship to pi / pi cloud

```
            ┌───────────────────────────────────────┐
            │  pi cloud (future: multi-agent / sandbox / onboarding)  │
            └───────────────────────────────────────┘
                              ▲ kernel + open layer
            ┌───────────────────────────────────────┐
            │                pi-web                  │  ← this project
            │  (UI + HTTP/SSE protocol + layered packages)  │
            └───────────────────────────────────────┘
                              ▲ runtime
            ┌───────────────────────────────────────┐
            │   @earendil-works/pi-coding-agent SDK   │
            │      (agent logic / RPC / tools)        │
            └───────────────────────────────────────┘
```

- **The pi SDK** provides the agent's runtime and tool protocol.
- **pi-web** sits on top of it, providing product capabilities such as the UI, HTTP/SSE protocol, attachments/extensions/configuration, and stays layered and embeddable.
- **pi cloud** (planned) builds multi-agent orchestration, remote sandboxes, and billing/onboarding on top of pi-web.

## Open and Integrable

pi-web is composed of **11** independently publishable `@blksails/pi-web-*` npm packages (`protocol` / `server` / `react` / `ui` / `agent-kit` / `tool-kit` / `web-kit` (published as `@blksails/pi-web-kit`) / `logger` / `primitives` / `canvas-kit` / `canvas-ui`), plus a language-agnostic HTTP/SSE protocol (carrying `protocolVersion`) and a renderer registry. For full responsibilities and dependency direction, see [05 Packages](./05-packages.md).

There are three ways to integrate:

- **Full-site deployment** — Vite SPA frontend + the single-file Hono server `dist/server.mjs`; `node dist/server.mjs` is all it takes to run.
- **Protocol / headless-hooks integration** — Wire into your own React stack via `@blksails/pi-web-protocol` and the `@blksails/pi-web-react` hooks.
- **React-free embed package** `@blksails/embed` (Web Component `<pi-web-chat>` + iframe widget) is **planned**.

## What It Is Not

- **Not** a Serverless / Edge app. pi-web holds stateful, long-lived connections (one resident subprocess + SSE per session); the host process must stay resident to spawn subprocesses and hold long-lived SSE, and horizontal scaling requires sticky routing by `sessionId`. See [03 Architecture](./03-architecture.md).
- **Not** an attempt to stuff file capabilities into the pi protocol. The content of the pi tool protocol is only `text | image(base64)`, with no file-reference primitive; pi-web's attachment capabilities are all implemented in its own layer, without polluting the protocol.

## Next Steps

- Want to run it right away → [01 Quickstart](./01-quickstart.md)
- Want to understand how it works → [02 Core Concepts](./02-core-concepts.md) and [03 Architecture](./03-architecture.md)
- Want to put a UI on your own agent → [08 Agent Development](./08-agent-development.md)
