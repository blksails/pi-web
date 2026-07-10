# 01 · Quickstart

From zero to your first running agent in about 5 minutes.

## Prerequisites

| Dependency | Requirement | Notes |
| --- | --- | --- |
| **Node** | `>=22.19.0` | pi's `engines` constraint; production images use `node:24-bookworm-slim`. Stick with Node at runtime (Bun is only used for the toolchain). |
| **pnpm** | 9.x (`packageManager: pnpm@9.12.0`) | workspace monorepo. |
| **pi config directory** | `~/.pi/agent` exists | Run `pi` once and log in so that `auth.json` / `settings.json` are generated. Or provide a provider key via environment variables (see below). |

> Never installed pi? First run `npm i -g @earendil-works/pi-coding-agent` (or follow its docs), then run `pi` and log in once.

## Install & Run (Development Mode)

```bash
pnpm install
pnpm dev          # next dev — http://localhost:3000
```

Open the browser and enter a source in the **agent source picker**, in one of three forms:

- **A directory containing `index.ts`** → runs your custom agent (custom mode);
- **Any directory** → general CLI mode (`pi --mode rpc`);
- **A git source** → resolved, then same as above.

## Pick One from examples/ to Get Started

The repo's `examples/` directory ships several **ready-to-point-at** examples, organized by capability in the [examples index](https://github.com/blksails/pi-web/blob/main/examples/README.md). For your first run, we recommend either of these two introductory examples:

| Example | Best for | Notes |
| --- | --- | --- |
| `examples/hello-agent` | Your first run | A self-contained, minimal custom agent that exposes a single `echo` tool and does not load system tools or on-disk skills. |
| `examples/minimal-agent` | Seeing the leanest entry | A skeleton with only the required fields of `defineAgent()`, handy for modeling your own entry file. |

For more examples organized by capability (attachments, AIGC, Web UI extensions, etc.), see the [examples index](https://github.com/blksails/pi-web/blob/main/examples/README.md).

## Run the Example Agent in 5 Minutes

The following uses the minimal example `examples/hello-agent`:

```ts
// examples/hello-agent/index.ts (excerpt)
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const echo = defineTool({
  name: "echo",
  label: "Echo",
  description: "Echo the provided text back to the caller.",
  parameters: Type.Object({ text: Type.String() }),
  async execute(_id, params) {
    return { content: [{ type: "text", text: params.text }], details: undefined };
  },
});

export default defineAgent({
  // model omitted → inherits the default provider/model from ~/.pi/agent/settings.json
  systemPrompt: "You are hello-agent, a minimal pi-web example agent.",
  customTools: [echo],
});
```

> The above is an excerpt. The real `examples/hello-agent/index.ts:1` also sets `noTools: "builtin"` and `skills: () => ({ skills: [], ... })`, making the example **self-contained** — it exposes only the custom `echo` tool and loads neither system built-in tools nor disk-discovered skills. The meaning of these two switches is covered in [08 · Custom Agent Development](./08-agent-development.md).

Steps:

1. After `pnpm dev` starts, open http://localhost:3000
2. Enter the **absolute path** to `examples/hello-agent` in the picker (the picker requires an absolute path; or set `PI_WEB_DEFAULT_SOURCE`, see below)
3. Enter the session and send a message → **expected**: you see a streaming reply
4. Make it call the tool: send "use the echo tool to echo hello" (or a similar instruction) → **expected**: an `echo` tool card appears in the session

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

You can verify the full chain without an LLM key (using a deterministic stub agent):

```bash
PI_WEB_STUB_AGENT=1 pnpm dev
# or run the offline Node-level streaming e2e:
pnpm e2e:node
```

## Common Scripts at a Glance

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Dev server (`next dev`, :3000) |
| `pnpm build` / `pnpm start` | Production build / start |
| `pnpm test` | Tests for all workspace packages |
| `pnpm test:app` | App-level vitest |
| `pnpm e2e` | Playwright browser e2e |
| `pnpm e2e:node` | Offline Node-level streaming e2e (stub agent) |
| `pnpm typecheck` | Typecheck for all packages + app |
| `pnpm build:cli` / `pnpm start:cli` | Build / start the global CLI (standalone, see [18 · CLI](./18-cli.md)) |

## Common First-Time Issues

- **Don't run `pnpm build` during dev** — it pollutes the shared `.next` and causes webpack 500s. CLI/e2e builds use isolated directories (`NEXT_DIST_DIR=.next-cli` / `.next-e2e`).
- **Changed an injected route / config domain but the route didn't take effect** — the handler singleton is pinned on `globalThis`, and hot reload does not refresh new routes, so you need to restart dev.
- For more, see [23 · Troubleshooting / FAQ](./23-troubleshooting-faq.md).

## Next Steps

- Understand loading and session mechanics → [02 · Core Concepts](./02-core-concepts.md)
- Write your own agent → [08 · Custom Agent Development](./08-agent-development.md)
- Integrate a custom model gateway → [07 · Providers and Models](./07-providers-and-models.md)
