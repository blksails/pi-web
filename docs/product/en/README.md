# pi-web Product Documentation

> [简体中文](../README.md) · This is the English edition; the Chinese edition lives in `../`.

> Put a **production-ready Web UI on any agent written with the pi SDK in seconds**.
>
> This directory is the **complete product documentation** for pi-web, with each topic as a standalone document. The authoritative requirements and low-level design still live in the repo-root `PLAN.md`, `.kiro/steering/`, and the individual `.kiro/specs/`; this doc set targets users, integrators, agent authors, and contributors, providing a systematic, product-level walkthrough.

## What is this

pi-web auto-loads a directory or git repository (containing an `index.[js|ts]` written with the [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) SDK) and brings up a **streaming web chat UI**. It can also serve the general-purpose pi coding agent as a web service, and is designed as the kernel + open layer for a future "pi cloud".

**Fastest start**: at the repo root run `pnpm install && pnpm dev`, open http://localhost:3000 in your browser, and enter the absolute path of `examples/hello-agent` in the agent source picker to enter a session. For the full steps, see [01 · Quickstart](./01-quickstart.md).

> Looking for a runnable example to get started? The repo's `examples/` directory provides a **runnable example index organized by capability** → [examples index](https://github.com/blksails/pi-web/blob/main/examples/README.md).

## Documentation map

Pick a reading path by role:

| I am… | Recommended order |
| --- | --- |
| **First encounter (evaluating/trying out)** | [00 · Product Overview](./00-product-overview.md) → [01 · Quickstart](./01-quickstart.md) → [02 · Core Concepts](./02-core-concepts.md) |
| **Agent author** (want to put a UI on your own agent) | [01 · Quickstart](./01-quickstart.md) → [08 · Custom Agent Development](./08-agent-development.md) → [09 · Attachment System](./09-attachment-system.md) → [14 · Sessions List](./14-sessions-list.md) → [12 · Web UI Extension](./12-web-ui-extension.md) → [11 · AIGC Tools](./11-aigc-and-vision-tools.md) → [15 · Message Queue](./15-message-queue.md) |
| **Integrator** (embedding pi-web into your own stack) | [03 · Architecture](./03-architecture.md) → [05 · Packages](./05-packages.md) → [24 · HTTP/SSE API Reference](./24-http-api-reference.md) → [14 · Sessions List](./14-sessions-list.md) → [13 · Config UI](./13-config-ui.md) |
| **Ops / Deployment** | [06 · Configuration](./06-configuration.md) → [18 · CLI](./18-cli.md) → [19 · Deployment & Operations](./19-deployment.md) → [21 · Logging](./21-logging.md) |
| **Contributor** | [03 · Architecture](./03-architecture.md) → [05 · Packages](./05-packages.md) → [22 · Development & Testing](./22-development-and-testing.md) → [25 · Roadmap](./25-roadmap.md) |

## All chapters

| # | Document | One-liner |
| --- | --- | --- |
| 00 | [Product Overview](./00-product-overview.md) | Positioning, capabilities, value, target scenarios |
| 01 | [Quickstart](./01-quickstart.md) | From a working environment to running your first agent |
| 02 | [Core Concepts](./02-core-concepts.md) | Agent Source / dual-mode / Session / RPC / translation layer |
| 03 | [Architecture](./03-architecture.md) | Data flow, transport-agnostic channel, stateful constraints, extension seams |
| 04 | [Packages](./05-packages.md) | Responsibilities and dependency direction of the 7 `@blksails/*` packages |
| 05 | [Configuration](./06-configuration.md) | Environment variables, `~/.pi/agent`, hiding providers |
| 06 | [Providers & Models](./07-providers-and-models.md) | Built-in and custom OpenAI-compatible gateway integration |
| 07 | [Custom Agent Development](./08-agent-development.md) | `defineAgent()`, the `index.ts` contract, example index, hot reload |
| 08 | [Attachment System](./09-attachment-system.md) | Layered storage, two consumption paths, `attachmentId` round-trip |
| 09 | [Extensions / Skills / Templates](./10-extensions-and-skills.md) | Native pi resources, permission prompts, install management |
| 10 | [Web UI Extension](./12-web-ui-extension.md) | The agent-web-extension five-tier model |
| 11 | [AIGC Image Tools](./11-aigc-and-vision-tools.md) | Generation/editing, default model, image normalization |
| 12 | [Config UI](./13-config-ui.md) | JSON Schema → form IR, dynamic widgets |
| 13 | [HTTP/SSE API Reference](./24-http-api-reference.md) | REST + SSE endpoint contracts |
| 14 | [CLI](./18-cli.md) | The `pi-web` global command, standalone, `--watch` |
| 15 | [Deployment & Operations](./19-deployment.md) | standalone artifact, sticky routing, production hardening |
| 16 | [Logging](./21-logging.md) | Isomorphic logger, server-side gating |
| 17 | [Development & Testing](./22-development-and-testing.md) | TS strict, hard testing requirements, the spec workflow |
| 18 | [Troubleshooting / FAQ](./23-troubleshooting-faq.md) | Common errors and remedies |
| 19 | [Roadmap](./25-roadmap.md) | Capability matrix and planning |
| 20 | [Glossary](./26-glossary.md) | Definitions of key terms |
| 21 | [Sessions List](./14-sessions-list.md) | Browse historical sessions and resume in one click |
| 22 | [Message Queue](./15-message-queue.md) | Queue messages while busy with interject/follow-up semantics, visualize pending items and take them back; `control:queue` sticky frames converge on reconnect, `clearQueue` closes the loop via a state-bridge-style custom frame (zero changes to pi). |

## Conventions

- This is the **English** edition; the Chinese edition lives in [`../README.md`](../README.md). Technical terms and code identifiers are kept in their original form.
- Code paths are written in `path:line` form for easy navigation within the repo.
- This doc set does not reference the early, scattered design drafts under `./docs`; content follows the README, steering, and the actual code.

---

_Private repository — © blksails._
