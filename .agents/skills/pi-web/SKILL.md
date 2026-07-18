---
name: pi-web
description: >-
  Assist development OF the pi-web framework itself — the full-stack system that
  wraps a pi coding agent in a streaming web chat UI. Use when working on pi-web
  internals: the backend RPC bridge / session engine, HTTP+SSE API, React
  transport & hooks, UI renderer registry, the 5-tier web extensions, attachment
  system, AIGC tools, config UI, trigger/completion framework, CLI / standalone,
  logging, or the sessions list; when adding an agent-source example; when running
  the dev server / e2e / isolated builds; or when answering architecture, layered
  `@blksails/*` package, or convention questions. NOT for merely authoring a user's
  own pi agent `index.ts` (that needs no pi-web internals) unless it integrates with
  pi-web seams. Routes you to the authoritative `docs/product/` manual first, then
  supplies the operational commands and non-obvious gotchas that prose docs omit.
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
---

# pi-web Skill

Develop **pi-web**: point it at a directory/git repo containing a pi SDK
`index.[js|ts]` and it auto-loads the agent and serves a streaming web chat UI
(dual-mode: custom `runRpcMode`, or fallback `pi --mode rpc` — same RPC protocol
to the frontend).

## 0. First move — read the authoritative chapter, don't guess

The full product manual lives in **`docs/product/`** (22 chapters + nav, also the
English mirror under `docs/product/en/`). It is the source of truth for usage,
contracts, and design. **Before editing, open the relevant chapter.** Map:

| Area | Chapter |
| --- | --- |
| Orientation / concepts | `00-product-overview`, `02-core-concepts`, `03-architecture` |
| Layered packages | `04-packages` |
| Config & env vars | `05-configuration` · providers/models `06` |
| Authoring an agent source | `07-agent-development` (+ `examples/README.md`) |
| Attachments + @-mention completion | `08-attachment-system` |
| Extensions / skills / templates | `09-extensions-and-skills` |
| Web UI extensions (5-tier model) | `10-web-ui-extension` |
| AIGC image tools | `11-aigc-tools` |
| Config UI (schema → form IR) | `12-config-ui` |
| HTTP / SSE API reference | `13-http-api-reference` |
| CLI / standalone | `14-cli` |
| Deployment / hardening | `15-deployment` |
| Logging | `16-logging` |
| Dev & testing | `17-development-and-testing` |
| Troubleshooting / FAQ | `18-troubleshooting-faq` |
| Sessions list | `21-sessions-list` |
| Glossary | `20-glossary` |

Deeper authority, in order: chapter → `.kiro/steering/{product,tech,structure}.md`
→ the relevant `.kiro/specs/<feature>/{requirements,design,tasks}.md` → `PLAN.md`.
Runnable examples for every capability are indexed in **`examples/README.md`**.

## 1. Architecture in one breath

```
Browser (AI Elements + useChat) ─ SSE/HTTP ─→ Next.js Route Handler (runtime "nodejs",
   session process resident) ─ stdin/stdout JSONL ─→ agent subprocess (bootstrap
   runRpcMode, or pi --mode rpc) · one process per session
```

- The backend core is a **transport-agnostic RPC channel** (`PiRpcChannel`:
  `{send/onLine/close}`); `PiRpcProcess` is only its `local` (child_process) impl —
  seams kept for e2b / ssh / device later.
- The **event → AI SDK UIMessage translation layer** is the hinge between back and front.
- Three RPC message kinds: `response`, `event`, `extension_ui_request`.

## 2. Layered packages (dependency flows one way: `protocol ← everything`)

| Package | Role |
| --- | --- |
| `@blksails/pi-web-protocol` | Single contract root: zod schema + inferred types, zero-runtime, isomorphic. Changes need semver; SSE frames carry `protocolVersion`. |
| `@blksails/pi-web-server` | Engine: agent-source resolve → runner → session engine → `createPiWebHandler` (REST+SSE). Also `attachment/` (store) + `attachment-bridge/` (tool bridge) + `session-list/`. |
| `@blksails/pi-web-react` | Headless: transport / hooks / `PiClient`. |
| `@blksails/pi-web-ui` | Styled components + renderer registry + 4-axis customization. |
| `@blksails/pi-web-agent-kit` | `defineAgent()` type helper for user `index.ts` (not a runtime dep). |
| `@blksails/pi-web-tool-kit` | Built-in web tools (AIGC image gen/edit, attachment seams). |
| `@blksails/pi-web-logger` | Isomorphic logger (server-authoritative gating). |
| `@blksails/pi-web-kit` (web-kit) | Web-extension authoring SDK (`bin pi-web`). |

App assembly lives in `app/` (Next catch-all `app/api/sessions/[[...path]]/route.ts`)
and `lib/app/` (e.g. `pi-handler.ts` — the globalThis-pinned singleton handler).

## 3. Dev / test / build commands

```bash
pnpm dev                 # Next dev server (default :3000)
pnpm typecheck           # workspace typecheck + tsc --noEmit
pnpm test                # all workspace package tests
pnpm test:app            # app-level vitest
pnpm e2e                 # Playwright browser e2e
pnpm e2e:node            # PI_WEB_STUB_AGENT=1 node-side e2e (stubbed agent)
pnpm build:cli           # NEXT_DIST_DIR=.next-cli build + pack standalone
pnpm start:cli           # run the standalone CLI (bin/pi-web.mjs)
```

**Isolated builds — never pollute the shared `.next`.** Use a distinct dist dir per
purpose: `NEXT_DIST_DIR=.next-e2e` (browser e2e), `.next-cli` (CLI), `.next-stub`
(stub). e2e runs against an external server in its own build dir.

## 4. Non-obvious gotchas (the high-value part)

- **Never run `next build` while `pnpm dev` is running** — it corrupts the shared
  `.next` and dev routes start throwing webpack 500s. Use `NEXT_DIST_DIR` isolation.
- **pi SDK must be webpack-externalized in dev.** A main-process `import` of the pi
  SDK crashes dev routes with `node:fs` errors; keep it external (see `next.config.ts`).
- **The handler is a singleton pinned on `globalThis`.** After changing *injected
  routes* or *config domains*, hot reload won't pick them up — **restart dev**.
- **Config UI**: the frontend does **not** read a backend-injected `formSchema`.
  Dynamic options must go through a **widget + data endpoint + custom renderer**
  (see `12-config-ui`), not server-pushed schema.
- **JSONL framing**: split strictly on `\n`, strip `\r`; never use Node `readline`
  (it mis-splits `U+2028/2029`).
- **Attachment env must match across processes**: `PI_WEB_ATTACHMENT_DIR` +
  `PI_WEB_ATTACHMENT_SECRET` are handed to the runner subprocess via spawn env; if
  main and child disagree, child-produced signed URLs 401 in the main process.
- **agentDir env is `PI_CODING_AGENT_DIR`** (not `PI_AGENT_DIR`).
- **References, not base64**: history/context carry `att_<id>` references; base64 is
  materialized only at the "feed the LLM for vision" exit to save context.
- **Runner hot reload**: `PI_RUNNER_HOT_RELOAD=1` restarts per-session runners on
  `tool-kit/src` changes (while idle, resuming the session).
- **Long / concurrent work → isolated git worktree.** Concurrent sessions can reset
  the main worktree's branch and clobber commits; do long tasks in a sibling worktree.
- **Stats have no SSE frame** — pull session usage via `getStats()` REST, not a
  `control:stats` event.

## 5. Common extension recipes

- **Add a backend route**: extend via the `createPiWebHandler` injection seam
  (`routes:`), same shape as `createConfigRoutes` / `createSessionListRoutes`. See `13`.
- **Add a renderer or web-extension tier**: 5-tier model in `10`; copy the matching
  `examples/webext-{layout,renderer,contrib,artifact,declarative,...}-agent`.
- **Add an agent-source example**: drop a dir under `examples/`, give it a README in
  the existing style, and register a row in `examples/README.md`.
- **Custom provider / model**: not in `auth.json` — put it in `~/.pi/agent/models.json`
  (`baseUrl`+`apiKey`, `api: openai-completions`). See `06`.

## 6. Process — spec-driven, test-gated

Features go through the kiro flow: **requirements → design → tasks → impl** (skills
`kiro-spec-*`, `kiro-impl`). This project's hard rule: **every spec needs unit/
integration tests + an e2e check, proven with fresh run output** (`kiro-verify-completion`).
Backend RPC bridge → integration tests against a real subprocess; the translation
layer → pure-function unit tests; the loop → browser e2e (pick source → prompt →
streamed reply). TypeScript is `strict`, no `any`. Follow surrounding code's idioms.

> Authoritative requirements/design: `PLAN.md` + `.kiro/`. This skill routes and
> warns; it does not replace the chapter you're about to edit against.
