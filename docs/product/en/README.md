# pi-web Product Documentation

> [简体中文](../README.md)

> Put a **production-ready Web UI on any agent written with the pi SDK, in seconds.**
>
> This directory is the **complete product documentation** for pi-web, with each topic as a standalone chapter. The authoritative requirements and low-level design still live in the root `PLAN.md`, `.kiro/steering/`, and the individual `.kiro/specs/`; this documentation set targets users, integrators, agent authors, and contributors, giving a systematic, product-level walkthrough.

## What is this

pi-web takes a directory or git repository (containing an `index.[js|ts]` written with the [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) SDK) and loads it automatically, standing up a **streaming Web chat UI**. The frontend is a **Vite-driven SPA**, the server host is **Hono** (a single `app.all('/api/*')` forwarding to a singleton handler), and the server itself is bundled by esbuild into a single-file `dist/server.mjs`. Beyond the Web server, it also ships a **Tauri v2 desktop shell** as a second delivery form (see [20 Desktop (Tauri)](./20-desktop-tauri.md)), and is designed to become the kernel and open layer of a future "pi cloud."

**Fastest path to running**: from the repo root, `pnpm install && pnpm dev`. `pnpm dev` is the `scripts/dev-all.mjs` two-process orchestrator—it concurrently launches the **API server (:3000)** and **vite dev (:5173, with `/api` proxied to 3000)**; **open http://localhost:5173 in your browser** (not 3000, which is a pure API surface), then paste the absolute path of `examples/hello-agent` into the agent source picker to enter a session. Full steps in [01 Quickstart](./01-quickstart.md).

> Looking for a runnable example to get started? The repo's `examples/` directory provides a **capability-indexed catalog of runnable samples** → [examples index](https://github.com/blksails/pi-web/blob/main/examples/README.md).

## Documentation map

Pick a reading path by role:

| I am… | Recommended order |
| --- | --- |
| **First encounter (evaluating / trying out)** | [00 Product Overview](./00-product-overview.md) → [01 Quickstart](./01-quickstart.md) → [02 Core Concepts](./02-core-concepts.md) |
| **Agent author** (want to put a UI on my own agent) | [01 Quickstart](./01-quickstart.md) → [08 Custom Agent Development](./08-agent-development.md) → [09 Attachment System](./09-attachment-system.md) → [14 Sessions List](./14-sessions-list.md) → [12 Web UI Extensions](./12-web-ui-extension.md) → [11 AIGC & Vision Tools](./11-aigc-and-vision-tools.md) → [15 Message Queue](./15-message-queue.md) |
| **Integrator** (embedding pi-web into my own stack) | [03 System Architecture](./03-architecture.md) → [04 Surface Authoritative-Surface Stack](./04-surface-stack.md) → [05 Layered Packages](./05-packages.md) → [24 HTTP/SSE API Reference](./24-http-api-reference.md) → [13 Config UI](./13-config-ui.md) |
| **Frontend / plugin extension author** | [12 Web UI Extensions](./12-web-ui-extension.md) → [04 Surface Authoritative-Surface Stack](./04-surface-stack.md) → [16 Canvas Workbench](./16-canvas-workbench.md) → [17 Canvas Plugin Development](./17-canvas-plugins.md) |
| **Ops / deployment** | [06 Configuration Reference](./06-configuration.md) → [18 CLI](./18-cli.md) → [19 Deployment & Operations](./19-deployment.md) → [20 Desktop (Tauri)](./20-desktop-tauri.md) → [21 Logging](./21-logging.md) |
| **Contributor** | [03 System Architecture](./03-architecture.md) → [05 Layered Packages](./05-packages.md) → [22 Development Standards and Testing](./22-development-and-testing.md) → [25 Roadmap](./25-roadmap.md) |

## All chapters

| # | Document | In one line |
| --- | --- | --- |
| 00 | [Product Overview](./00-product-overview.md) | Instant Web UI for a custom pi agent: positioning, the problem it solves, capabilities, and target scenarios |
| 01 | [Quickstart](./01-quickstart.md) | From zero to your first running agent in about 5 minutes (`pnpm dev` two-process + examples source) |
| 02 | [Core Concepts](./02-core-concepts.md) | Concept map: Agent Source / dual modes / Session / RPC channels / the two communication planes / lifecycle |
| 03 | [System Architecture](./03-architecture.md) | The three-tier browser (Vite SPA) ↔ Hono host ↔ agent subprocess split, with two orthogonal communication planes |
| 04 | [Surface Authoritative-Surface Stack](./04-surface-stack.md) | The second communication plane orthogonal to the chat stream (single-writer CQRS), driving Canvas end to end |
| 05 | [Layered Packages](./05-packages.md) | The responsibilities and one-way dependency direction of the 11 `@blksails/*` packages |
| 06 | [Configuration Reference](./06-configuration.md) | Environment variables, `~/.pi/agent`, and desktop / AIGC / vision-provider configuration |
| 07 | [Providers and Models](./07-providers-and-models.md) | Text-chat model discovery plus built-in / custom OpenAI-compatible gateway integration |
| 08 | [Custom Agent Development](./08-agent-development.md) | The `index.ts` contract, `getSessionState`, slash completions, declarative routes, and hot reload |
| 09 | [Attachment System](./09-attachment-system.md) | Four-tier file management by reference rather than base64, with the `att_<id>` round-trip |
| 10 | [Extensions / Skills / Templates](./10-extensions-and-skills.md) | Automatic resource discovery + two install lanes (in-turn tool / controlled REST) + inline permissions |
| 11 | [AIGC & Vision Tools](./11-aigc-and-vision-tools.md) | `image_generation`/`image_edit` generation + `image_vision` recognition, all in-process extensions |
| 12 | [Web UI Extensions](./12-web-ui-extension.md) | The agent-web-extension five-tier mounting model (Tier 1–5) |
| 13 | [Config UI](./13-config-ui.md) | A schema-driven form IR (`FormSchema`) and a pluggable renderer registry |
| 14 | [Sessions List](./14-sessions-list.md) | A relocatable, read-only panel for browsing historical sessions and resuming with one click |
| 15 | [Message Queue](./15-message-queue.md) | Queue with interject / follow-up semantics while busy, visualize pending items, and reclaim on backfill |
| 16 | [Canvas Workbench](./16-canvas-workbench.md) | Gallery + a re-creation canvas editor (off by default, gated by `NEXT_PUBLIC_PI_WEB_CANVAS`) |
| 17 | [Canvas Plugin Development](./17-canvas-plugins.md) | The `defineCanvasLayer`/`Tool`/`Action` trio and its frontend / agent dual-side wiring |
| 18 | [CLI](./18-cli.md) | The `pi-web` global thin launcher: parse args → env → spawn `dist/server.mjs` (no subcommands) |
| 19 | [Deployment & Operations](./19-deployment.md) | The esbuild single-file artifact layout, production CSP hardening, and stateful long-connection topology constraints |
| 20 | [Desktop (Tauri)](./20-desktop-tauri.md) | The dmg/nsis/appimage triad + a bundled Node sidecar + shared-runtime first-launch unpack |
| 21 | [Logging](./21-logging.md) | Structured logging across three component classes, subprocess stderr aggregation, and the browser log panel |
| 22 | [Development Standards and Testing](./22-development-and-testing.md) | TS strict, the `pnpm dev` two-process loop, the `build:dist` pipeline, and the test layering |
| 23 | [Troubleshooting / FAQ](./23-troubleshooting-faq.md) | A symptom → cause → remedy quick-reference appendix |
| 24 | [HTTP/SSE API Reference](./24-http-api-reference.md) | The converged REST + SSE endpoint contract (aggregating the endpoints from each feature chapter) |
| 25 | [Roadmap](./25-roadmap.md) | The delivered-capability matrix + planned seams (including the unmerged-branch quarantine note) |
| 26 | [Glossary](./26-glossary.md) | A quick reference of key terms across the stack (including the Surface / AAS design-vocabulary distinction) |

## Conventions

- The documentation language is **Chinese**; this `en/` directory is the English mirror. Technical terms and code identifiers keep their original form.
- Code paths are written as `path:line` for easy in-repo navigation.
- This documentation set does not cite the scattered early design drafts under `./docs`; content follows the README, steering, and the actual code.
- **Where to append new feature chapters**: to maximize continuous readability, chapters keep the contiguous numbering `00–26`; any later feature chapter should be **appended before the reference tail (24 API Reference / 25 Roadmap / 26 Glossary)** (i.e., inserted at the end of the feature cluster, before the reference chapters), so that each addition does not trigger a full renumber.
- **Scope discipline**: roadmap / planned capabilities must be explicitly marked "planned / not implemented" and never mixed in with currently available capabilities; AAS is pre-spec design vocabulary (not a delivered SDK), and its landed, code-backed counterpart is the **Surface stack** (see [04](./04-surface-stack.md) and [26 Glossary](./26-glossary.md)).

---

_Private repository — © blksails._
