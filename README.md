# pi-web

**English** | [简体中文](./README.zh-CN.md)

> Instant web UI for custom **pi** agents — point it at a directory or git repo containing a pi SDK `index.[js|ts]`, and it auto-loads the agent and serves a streaming web chat UI.

pi-web turns any agent written with the [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) SDK into a UI-equipped product with near-zero extra work. It also serves the general-purpose pi coding agent as a web service, and is designed as the kernel + open layer for a future "pi cloud".

📖 **Documentation:** [pi-web.blksails.ai](https://pi-web.blksails.ai) — full product docs (overview, quickstart, architecture, API, deployment).

> Packages are published under the **`@blksails/*`** scope (`@blksails/pi-web-protocol`, `@blksails/pi-web-server`, `@blksails/pi-web-react`, `@blksails/pi-web-ui`, `@blksails/pi-web-agent-kit`, `@blksails/pi-web-tool-kit`, `@blksails/pi-web-kit`).

## Features

- **Dual-mode loading** — a source with `index.[js|ts]` runs your custom agent via the SDK's `runRpcMode`; a source without an entry falls back to the general `pi --mode rpc`. Both speak the same RPC protocol to the frontend.
- **Streaming chat UI** — Vite + React SPA with shadcn/ui + Vercel AI Elements, rendering text / thinking / tool calls over SSE with an AI SDK v5 custom `ChatTransport`.
- **Native pi resources** — extensions / skills / prompt templates are auto-discovered and declaratively injected; permission prompts flow through the extension UI sub-protocol.
- **Attachment system** — image/file uploads persist to a pluggable object store (local-first) with signed delivery URLs. Two consumption paths: **base64 fed to the LLM** for vision, and **files handed to server-side tools** (image edit/generation) resolved by `attachmentId`, with outputs flowing back for re-use in the next turn.
- **Custom providers** — bring any OpenAI-compatible gateway (NewAPI, DashScope, …) via `~/.pi/agent/models.json`; the settings UI offers a searchable provider/model dropdown sourced from your configured, available models.
- **Open & embeddable** — layered npm packages + a language-agnostic HTTP/SSE protocol + a renderer registry, so it can be embedded into any web stack.

## Architecture

```
Browser (Vite SPA — AI Elements + useChat)
   │  SSE / HTTP
   ▼
Hono host (server/index.ts — one app.all("/api/*") → createPiWebHandler)
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
| `@blksails/pi-web-protocol` | Stable contract: RPC types/schemas, config form-schema IR. Changes are semver-gated; SSE frames carry `protocolVersion`. |
| `@blksails/pi-web-server` | Backend engine: agent-source resolution, bootstrap runner, RPC channel, session registry & translation, config/attachment routes. |
| `@blksails/pi-web-react` | Headless hooks & transport (unstyled). |
| `@blksails/pi-web-ui` | shadcn/ui + AI Elements components and the schema-driven config UI. |
| `@blksails/pi-web-agent-kit` | `defineAgent()` typing helper for writing your `index.ts`. |
| `@blksails/pi-web-tool-kit`, `@blksails/pi-web-kit` | Supporting kits for tools and web integration. |
| `@blksails/pi-web-primitives` | Framework-neutral UI primitives, decoupled from the chat shell. |
| `@blksails/pi-web-canvas-kit` | Canvas kernel: layer model, ops, history. Headless. |
| `@blksails/pi-web-canvas-ui` | Canvas workbench UI, actions, and the plugin registration surface. |
| `@blksails/pi-web-logger` | Isomorphic logger shared by browser and Node. |

## Getting Started

### Prerequisites

- Node `>=22.19.0` (pi `engines` constraint)
- [pnpm](https://pnpm.io/) (workspace monorepo)
- A pi config dir at `~/.pi/agent` — run `pi` and log in once so `auth.json` / `settings.json` exist. (Or supply provider keys via env; see below.)

### Install & run

```bash
pnpm install
pnpm dev          # API host on :3000 + Vite dev server — open http://localhost:5173
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
| `pnpm dev` | Start both dev processes (`scripts/dev-all.mjs`): API host on `:3000` + Vite on `:5173`. |
| `pnpm dev:client` | Vite dev server only. |
| `pnpm build` | Production build (`build:dist`): Vite client → esbuild server → `pack-dist` → payload. |
| `pnpm start` | Serve the production build (`node dist/server.mjs`). |
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
