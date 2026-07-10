# 00 · Product Overview

## One-Line Positioning

**pi-web is the instant Web UI for custom pi agents.** Given a directory or git repository (containing an `index.[js|ts]` entry written with the pi SDK), it automatically loads the agent and spins up a streaming web chat UI—turning any agent written with the [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) SDK into a UI-equipped product in seconds.

## What Problem It Solves

Writing the logic of a pi agent (system prompt, tools, model, extensions) is only half the work; to make it **usable by humans**, you also need a full frontend: streaming rendering, tool-call display, thinking blocks, permission prompts, attachment uploads, model switching, session management… all repetitive and expensive engineering.

pi-web shrinks the distance between "having written a pi agent" and "it being a web product" to nearly zero.

## Core Capabilities

- **Dual-mode loading** — If an entry is detected in the source (`index.ts` > `index.js` > `index.mjs`, or overridden by `package.json#pi-web.entry`) → your custom agent runs via the SDK's `runRpcMode`; if there is no entry → it falls back to the general `pi --mode rpc`. Both expose **the same RPC protocol**, the front-to-back bridge is fully reused, and only the spawn target differs. See [02 Core Concepts](./02-core-concepts.md) for entry detection and trust policy.
- **Streaming chat UI** — Next.js 15 + shadcn/ui + Vercel AI Elements, rendering text / thinking / tool calls over SSE + a custom AI SDK v5 `ChatTransport`.
- **Native pi resources** — extensions / skills / prompt templates are auto-discovered and declaratively injected; permission prompts flow through the extension UI sub-protocol into frontend dialogs.
- **Sessions list and resume** — Browse historical sessions and resume any of them by `sessionId` with one click, re-subscribing to its event stream to continue the conversation. See [14 Sessions List](./14-sessions-list.md).
- **Attachment system** — Image/file uploads are persisted through a pluggable object store (local first) with signed delivery URLs. Two consumption paths: **base64 fed to the LLM for vision**, and **files handed to a server-side tool** (image editing/generation) that resolves and executes via `attachmentId`, with outputs flowing back and available for re-use on the next turn.
- **Custom providers** — Any OpenAI-compatible gateway (NewAPI, DashScope…) can be wired in via `~/.pi/agent/models.json`; the settings UI offers a searchable model dropdown grouped by provider.
- **Web UI extensions** — Each agent source can carry a `.pi/web` control layer, contributing buttons/panels/declarative layouts/custom renderers/artifact iframes through a five-tier model.
- **Open & embeddable** — Layered npm packages (`@blksails/{protocol,server,react,ui,agent-kit,tool-kit,web-kit}`) + a language-agnostic HTTP/SSE protocol (carrying `protocolVersion`) + a renderer registry. It can be deployed as a full site (a Next.js app), or integrated into your own React stack via the protocol/headless hooks; the React-free embed package `@blksails/embed` (Web Component `<pi-web-chat>` + iframe widget) aimed at "any web stack" is **planned**.

## Target Use Cases

1. **Quickly putting a production-ready web frontend on a custom pi SDK agent.** This is the primary scenario.
2. **Offering a general pi coding agent as a web service.**
3. **Serving as the kernel + open layer for a future pi cloud (multi-agent management / e2b sandboxes / edge / device onboarding).**

## Value Proposition

> Shrink the distance between "having written a pi agent" and "it being a web product" to nearly zero; at the same time, through layered openness, it can be deployed as a full site or integrated on demand by any stack.

## Relationship to pi / pi cloud

```
            ┌─────────────────────────────────────────────────────────┐
            │   pi cloud (future: multi-agent / sandbox / onboarding) │
            └─────────────────────────────────────────────────────────┘
                                      ▲ kernel + open layer
            ┌─────────────────────────────────────────────────────────┐
            │   pi-web                                                │  ← this project
            │   (UI + HTTP/SSE protocol + layered packages)           │
            └─────────────────────────────────────────────────────────┘
                                      ▲ runtime
            ┌─────────────────────────────────────────────────────────┐
            │   @earendil-works/pi-coding-agent SDK                   │
            │   (agent logic / RPC / tools)                           │
            └─────────────────────────────────────────────────────────┘
```

- **The pi SDK** provides the agent's runtime and tool protocol.
- **pi-web** sits on top of it, providing product capabilities such as the UI, HTTP/SSE protocol, attachments/extensions/configuration, and stays layered and embeddable.
- **pi cloud** (planned) builds multi-agent orchestration, remote sandboxes, and billing/onboarding on top of pi-web.

## What It Is Not

- **Not** a Serverless / Edge app. pi-web holds stateful, long-lived connections (one resident subprocess + SSE per session), and horizontal scaling requires sticky routing by `sessionId`. See [03 Architecture](./03-architecture.md).
- **Not** an attempt to stuff file capabilities into the pi protocol. The content of the pi tool protocol is only `text | image(base64)`, with no file-reference primitive; pi-web's attachment capabilities are all implemented in its own layer, without polluting the protocol.

## Next Steps

- Want to run it right away → [01 Quickstart](./01-quickstart.md)
- Want to understand how it works → [02 Core Concepts](./02-core-concepts.md) and [03 Architecture](./03-architecture.md)
- Want to put a UI on your own agent → [08 Agent Development](./08-agent-development.md)
