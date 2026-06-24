# pi-web

**English** | [简体中文](./README.zh-CN.md)

> Instant web UI for custom **pi** agents — point it at a directory or git repo containing a pi SDK `index.[js|ts]`, and it auto-loads the agent and serves a streaming web chat UI.

pi-web turns any agent written with the [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) SDK into a UI-equipped product with near-zero extra work. It also serves the general-purpose pi coding agent as a web service, and is designed as the kernel + open layer for a future "pi cloud".

📖 **Documentation:** [pi-web.blksails.ai](https://pi-web.blksails.ai) — full product docs (overview, quickstart, architecture, API, deployment).

> Packages are published under the **`@blksails/*`** scope (`@blksails/protocol`, `@blksails/server`, `@blksails/react`, `@blksails/ui`, `@blksails/agent-kit`, `@blksails/tool-kit`, `@blksails/web-kit`).

## Features

- **Dual-mode loading** — a source with `index.[js|ts]` runs your custom agent via the SDK's `runRpcMode`; a source without an entry falls back to the general `pi --mode rpc`. Both speak the same RPC protocol to the frontend.
- **Streaming chat UI** — Next.js + shadcn/ui + Vercel AI Elements, rendering text / thinking / tool calls over SSE with an AI SDK v5 custom `ChatTransport`.
- **Native pi resources** — extensions / skills / prompt templates are auto-discovered and declaratively injected; permission prompts flow through the extension UI sub-protocol.
- **Attachment system** — image/file uploads persist to a pluggable object store (local-first) with signed delivery URLs. Two consumption paths: **base64 fed to the LLM** for vision, and **files handed to server-side tools** (image edit/generation) resolved by `attachmentId`, with outputs flowing back for re-use in the next turn.
- **Custom providers** — bring any OpenAI-compatible gateway (NewAPI, DashScope, …) via `~/.pi/agent/models.json`; the settings UI offers a searchable provider/model dropdown sourced from your configured, available models.
- **Open & embeddable** — layered npm packages + a language-agnostic HTTP/SSE protocol + a renderer registry, so it can be embedded into any web stack.

## Architecture

```
Browser (AI Elements + useChat)
   │  SSE / HTTP
   ▼
Next.js Route Handler (Node runtime, session process resident)
   │  stdin/stdout JSONL
   ▼
Agent subprocess  — bootstrap runner `runRpcMode`  OR  `pi --mode rpc`
                    (one process per session)
```

The core is a **transport-agnostic RPC channel** (`PiRpcChannel`); the event → AI SDK `UIMessage` translation layer is the hinge between front and back. Because both modes share the same RPC implementation, the bridge is fully reused — only the spawn target differs.

> Stateful, long-lived connections — **not** Serverless/Edge (unless control/data planes are split); horizontal scaling requires sticky routing by `sessionId`.

## Packages

Layered, independently-publishable packages with a single dependency direction (`protocol ← everything`; `server` depends only on `protocol`; `react`/`ui` are decoupled from the backend):

| Package | Role |
| --- | --- |
| `@blksails/protocol` | Stable contract: RPC types/schemas, config form-schema IR. Changes are semver-gated; SSE frames carry `protocolVersion`. |
| `@blksails/server` | Backend engine: agent-source resolution, bootstrap runner, RPC channel, session registry & translation, config/attachment routes. |
| `@blksails/react` | Headless hooks & transport (unstyled). |
| `@blksails/ui` | shadcn/ui + AI Elements components and the schema-driven config UI. |
| `@blksails/agent-kit` | `defineAgent()` typing helper for writing your `index.ts`. |
| `@blksails/tool-kit`, `@blksails/web-kit` | Supporting kits for tools and web integration. |

## Getting Started

### Prerequisites

- Node `>=22.19.0` (pi `engines` constraint)
- [pnpm](https://pnpm.io/) (workspace monorepo)
- A pi config dir at `~/.pi/agent` — run `pi` and log in once so `auth.json` / `settings.json` exist. (Or supply provider keys via env; see below.)

### Install & run

```bash
pnpm install
pnpm dev          # next dev — http://localhost:3000
```

Open the app, enter an **agent source** in the picker:
- a directory containing `index.ts` → your custom agent,
- any directory → general CLI mode,
- or a git source.

### Configuration

Credentials and defaults come from `~/.pi/agent` by default (no env key required if you've logged in with `pi`). Copy `.env.local.example` to `.env.local` to override. Key variables (all read at runtime by `lib/app/config.ts`, never logged):

| Variable | Purpose |
| --- | --- |
| `PI_WEB_AGENT_DIR` / `PI_CODING_AGENT_DIR` | Override the pi config dir (default `~/.pi/agent`). |
| `PI_WEB_DEFAULT_PROVIDER` / `PI_WEB_DEFAULT_MODEL` | Force a provider/model (else `settings.json` decides). |
| `PI_WEB_HIDE_PROVIDERS` | Comma-separated provider names to hide from the settings model/provider dropdown (their models are filtered out of `GET /config/models`). |
| `PI_WEB_DEFAULT_SOURCE` | Default agent source offered by the picker. |
| `PI_WEB_DEFAULT_CWD` | Default working directory for sessions. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, … | Optional additive passthrough to override `auth.json`. |
| `PI_WEB_STUB_AGENT=1` | Run sessions against a deterministic offline stub (used by e2e). |

#### Custom OpenAI-compatible providers

Add any OpenAI-compatible gateway in `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "my-gateway": {
      "name": "My Gateway",
      "baseUrl": "https://example.com/v1",
      "apiKey": "sk-...",
      "api": "openai-completions",
      "models": [
        { "id": "some-model", "name": "Some Model", "input": ["text"], "contextWindow": 131072, "maxTokens": 16384, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } }
      ]
    }
  }
}
```

Non-built-in providers require `baseUrl` + `apiKey`; verify with `pi --list-models`. The model then appears in the settings provider/model dropdown.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the dev server (`next dev`). |
| `pnpm build` | Production build. |
| `pnpm start` | Serve the production build. |
| `pnpm test` | Run all workspace package tests. |
| `pnpm test:app` | App-level vitest. |
| `pnpm e2e` | Playwright e2e. |
| `pnpm e2e:node` | Offline Node-level streaming e2e (stub agent). |
| `pnpm typecheck` | Typecheck all packages + the app. |

## Development standards

- **TypeScript strict**, no `any`.
- **Testing is a hard requirement**: every spec ships unit/integration tests **and** e2e verification with fresh evidence. Backend RPC bridges use integration tests against real subprocesses; the frontend translation layer uses pure-function unit tests.
- Transport / isolation / storage are behind interfaces (`PiRpcChannel`, `SessionStore`, `BlobStore`) as seams for future e2b/edge/device and object-storage backends.

This repo follows Kiro-style spec-driven development — see `.kiro/steering/` (project memory) and `.kiro/specs/` (per-feature specs). Authoritative requirements live in `PLAN.md`.

---

_Private repository — © blksails._
