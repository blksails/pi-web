# 01 · Quickstart

From zero to your first running agent in about 5 minutes: start the dev server, point it at an `examples/` source, send a message, and watch a streaming reply with a tool call.

## Prerequisites

| Dependency | Requirement | Notes |
| --- | --- | --- |
| **Node** | `>=22.19.0` | See the `engines` field in `package.json:5-7`. The runtime commits to Node (Bun is only used by a few toolchain scripts). |
| **pnpm** | 9.x (`packageManager: pnpm@9.12.0`) | This repo is a pnpm workspace monorepo. |
| **pi config directory** | `~/.pi/agent` exists | Run `pi` once and log in so that `auth.json` / `settings.json` get generated; or provide a provider key via environment variables (see below). |

> Never installed pi? First `npm i -g @earendil-works/pi-coding-agent` (or follow its docs), then run `pi` and log in once.

## Install & Run (Development Mode)

```bash
pnpm install
pnpm dev          # dev-all: Vite frontend at http://localhost:5173 (/api is auto-proxied to :3000)
```

**Open your browser at http://localhost:5173** (not 3000).

### Why two processes, and which port to open

`pnpm dev` actually runs `node scripts/dev-all.mjs` (`package.json:17`), which launches **two** processes concurrently and tears both down when either exits or on Ctrl-C (`scripts/dev-all.mjs:32-36`):

| Process | Port | Role |
| --- | --- | --- |
| Hono API host (`server/index.ts`) | `127.0.0.1:3000` | Backend: `/api/*` routes, SSE session streams, spawning agent subprocesses |
| Vite dev server | `http://localhost:5173` | Frontend: SPA + HMR, reverse-proxies `/api` requests to 3000 (`vite.config.ts:72-81`) |

During development the entry point you interact with is Vite's **5173** (HMR, serves the SPA); 3000 is the bare API host being proxied — opening it directly shows you the API, not the chat UI. Production mode is the opposite: after `pnpm build`, `pnpm start` (= `node dist/server.mjs`) is a **single process on a single port**, where the same `:3000` (or `PORT`) serves both the SPA static assets and `/api` (`server/index.ts:94-104`).

Once 5173 is open, enter a source in the **agent source picker**, in one of three forms:

- **A directory containing `index.ts`** → runs your custom agent (custom mode);
- **Any directory** → general CLI mode (`pi --mode rpc`);
- **A git source** → resolved, then same as above.

> Just want to double-click to run without opening a terminal? pi-web also ships a Tauri desktop shell (`desktop/`) that spawns the same `dist/server.mjs` backend internally. See [20 · Desktop (Tauri)](./20-desktop-tauri.md).

## Pick One from examples/ to Get Started

The repo's `examples/` directory ships several **ready-to-point-at** examples (around 28, organized by capability in the [examples index](https://github.com/blksails/pi-web/blob/main/examples/README.md)). For your first run, we recommend either of these two introductory examples:

| Example | Best for | Notes |
| --- | --- | --- |
| `examples/hello-agent` | Your first run | A self-contained, minimal custom agent that exposes a single `echo` tool and loads neither system tools nor on-disk skills. |
| `examples/minimal-agent` | Seeing the leanest entry | A skeleton with only the required fields of `defineAgent()`, handy for modeling your own entry file. |

## Run the Example Agent in 5 Minutes

The following uses the minimal example `examples/hello-agent` (`examples/hello-agent/index.ts`):

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const echo = defineTool({
  name: "echo",
  label: "Echo",
  description: "Echo the provided text back to the caller.",
  parameters: Type.Object({
    text: Type.String({ description: "Text to echo back." }),
  }),
  async execute(_toolCallId, params) {
    return { content: [{ type: "text", text: params.text }], details: undefined };
  },
});

export default defineAgent({
  // model omitted → inherits the default provider/model from ~/.pi/agent/settings.json
  systemPrompt: "You are hello-agent, a minimal pi-web example agent.",
  customTools: [echo],
  // self-contained: pulls in no system built-in tools, and loads no disk-discovered skills
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
```

> The meaning of `noTools: "builtin"` and the `skills` override hook is covered in [08 · Custom Agent Development](./08-agent-development.md).

Steps (each independently verifiable):

1. After `pnpm dev` starts, open **http://localhost:5173** in your browser → **expected**: the source-picker page.
2. Enter the **absolute path** to `examples/hello-agent` in the picker (the picker requires an absolute path; or set `PI_WEB_DEFAULT_SOURCE`, see below) → **expected**: you enter the session UI.
3. Send a message → **expected**: a streaming reply appears character by character.
4. Make it call the tool: send "use the echo tool to echo hello" (or a similar instruction) → **expected**: an `echo` tool card appears in the session.

> **No reply / authentication error?** Most likely the default provider/model has no valid key. First use the stub agent under "Offline Quick Verification" below to get the chain working; for authentication issues, see [23 · Troubleshooting / FAQ](./23-troubleshooting-faq.md).

> `hello-agent` deliberately omits `model`, letting it inherit the default provider/model from your pi login, so it works out of the box. To pin the model, add `model: { provider, modelId }`, but that provider must have valid authentication.

## Configuration (Optional)

Credentials and defaults come from `~/.pi/agent` by default (if you've logged in to pi, no environment keys are needed). To override, copy `.env.local.example` to `.env.local`. The most common ones:

```bash
# .env.local
PI_WEB_DEFAULT_SOURCE=/abs/path/to/examples/hello-agent  # default source for the picker
PI_WEB_DEFAULT_CWD=/abs/path/to/workdir                  # default working directory for sessions
PI_WEB_DEFAULT_PROVIDER=openrouter                       # force the provider (otherwise from settings.json)
PI_WEB_DEFAULT_MODEL=anthropic/claude-sonnet-4.6         # force the model (value must match the provider)
```

For the complete set of variables, see [06 · Configuration Reference](./06-configuration.md).

## Offline Quick Verification (No Model Quota Consumed)

You can verify the full chain without an LLM key (using a deterministic stub agent). Again, open it at **5173**:

```bash
PI_WEB_STUB_AGENT=1 pnpm dev
# or run the offline Node-level streaming e2e (no browser needed):
pnpm e2e:node
```

## Common Scripts at a Glance

| Command | Purpose |
| --- | --- |
| `pnpm dev` | dev-all: Vite frontend `:5173` + API host `:3000` (open 5173 in the browser) |
| `pnpm build` / `pnpm start` | Production build (`build:dist` five-step pipeline) / start the single-file `dist/server.mjs` (single process on `:3000`) |
| `pnpm test` | Tests for all workspace packages |
| `pnpm test:app` | App-level vitest |
| `pnpm e2e` | Playwright browser e2e |
| `pnpm e2e:node` | Offline Node-level streaming e2e (stub agent) |
| `pnpm typecheck` | Typecheck for all packages + app |
| `pnpm build:cli` / `pnpm start:cli` | Build / start the global CLI (`bin/pi-web.mjs` boots `dist/server.mjs`, see [18 · CLI](./18-cli.md)) |

## Common First-Time Issues

- **Opening 3000 shows a bare API / JSON?** In development you should visit **5173** (Vite serves the SPA); 3000 is the backend host that Vite proxies to and does not serve the frontend page directly.
- **Changed an injected route / config domain but nothing took effect** — the handler singleton is pinned on `globalThis`, and hot reload does not refresh newly assembled routes, so you need to restart `pnpm dev`.
- For more, see [23 · Troubleshooting / FAQ](./23-troubleshooting-faq.md).

## Next Steps

- Understand loading and session mechanics → [02 · Core Concepts](./02-core-concepts.md)
- Write your own agent → [08 · Custom Agent Development](./08-agent-development.md)
- Integrate a custom model gateway → [07 · Providers and Models](./07-providers-and-models.md)
- Package it as a desktop app → [20 · Desktop (Tauri)](./20-desktop-tauri.md)
