# 19 · Deployment & Operations (Web Server)

This chapter covers building and deploying pi-web as a **web server**: the structure of the single-file esbuild artifact produced by `pnpm build:dist`, how to run it in production, production CSP hardening, and the topology constraints imposed by stateful long-lived connections. The desktop edition (Tauri) is a separate delivery form, covered on its own in [20-desktop-tauri.md](./20-desktop-tauri.md).

> The frontend is now a Vite-driven SPA, the server host is Hono (`server/index.ts`, a single `app.all('/api/*')`), and the server is bundled by esbuild into a single file `dist/server.mjs`. **Next.js has been removed from main** — there is no `.next*` directory, no `next build`, no `NEXT_DIST_DIR`, no `output: "standalone"`, no `outputFileTracingIncludes`, and no `pack-standalone.mjs`. If any older doc or script you have still mentions these, treat it as obsolete.

---

## 19.1 Topology Constraint: Stateful, Long-Lived Connections

pi-web's core constraint stems from its architecture: **each session corresponds to one long-lived pi subprocess**, and that process's LLM context and tool state live in the memory of a single instance (for the architecture, see [03-architecture.md](./03-architecture.md)).

- **It cannot be deployed as a Serverless/Edge Function** (unless you split the control and data planes, see §19.10). This is a genuine, framework-independent constraint: the host process must be resident, spawn subprocesses, and hold long-lived SSE connections.
- **Horizontal scaling must use sticky routing keyed by `sessionId` (session affinity)**, otherwise the SSE stream and subsequent commands get routed to an instance that does not hold the subprocess, resulting in a 404 or a silent disconnect.
- Recommended deployment shape: the `dist/` artifact from `pnpm build:dist` + a long-lived Node service (Docker / K8s Deployment + Session-Affinity).

---

## 19.2 Building: `pnpm build:dist`

The production build is a single entry point, `pnpm build:dist` (`package.json:22`), chaining five steps:

| Step | Script | Output |
|---|---|---|
| ① `build:client` | `vite build` | `dist/client/` (SPA static assets + `public/`) |
| ② `build:server` | `node scripts/build-server.mjs` | `dist/server.mjs` (single-file esbuild entry) |
| ③ pack-dist | `node scripts/pack-dist.mjs` | Collects `packages/*` and `node_modules/` into `dist/` (preserving the original pnpm layout) |
| ④ `build:unpacker` | `node scripts/build-unpacker.mjs` | `payload/unpack.mjs` (the unpacker, used on first launch by the CLI / desktop) |
| ⑤ `build:payload` | `node scripts/pack-payload.mjs` | `payload/dist.tar.zst` + `payload/payload.json` (the compressed payload shipped with the npm package) |

For **direct server deployment** you only need the `dist/` directory produced by the first three steps: the artifact root is `dist/`, and the executable entry is `dist/server.mjs`. The `payload/` produced by steps ④⑤ is the compressed payload shipped inside the npm package for the **CLI** (`files: ["bin", "payload", "vite.config.ts"]`, `package.json:11-15`); it is unpacked into a shared runtime directory by `unpack.mjs` only on the first run of `pi-web` — that path is described in [18-cli.md](./18-cli.md).

### 19.2.1 The single-file esbuild entry

`scripts/build-server.mjs` uses esbuild to bundle `server/index.ts` into `dist/server.mjs` (`bundle` + `format: "esm"` + `target: "node22"`, `build-server.mjs:73-80`). Two decisive constraints:

1. **The entry must sit at the artifact root** (`dist/server.mjs`, not `dist/server/index.mjs`). `packages/server`'s `runnerBootstrapPath()` / `resolvePiCliEntry()` follow "① derive from `import.meta.url` → ② fall back to `process.cwd()` on failure". esbuild inlines `import.meta.url` as the **build machine's absolute path**, which is guaranteed to break on a different machine, so it can only rely on fallback ②; and `bin/pi-web.mjs` uses `dirname(serverJs)` as cwd — if the entry lived in a subdirectory, every fallback would break and real sessions would inevitably crash (`build-server.mjs:4-11`, `server/index.ts:15-19`).
2. **The external list** (`build-server.mjs:29-35`): the two pi SDK packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`) + `jiti` + `pg`/`pg-native` stay external. The first three are dynamically imported at runtime by the agent subprocess via jiti; static bundling would break pnpm's realpath resolution layout. `pg` contains an optional `require('pg-native')`, kept external to avoid esbuild failing on static resolution. `zod` is pure JS and `node:sqlite` is built in — both are safe to bundle.

### 19.2.2 Build steps

**Step 1: Install dependencies**
```bash
# The repo uses pnpm (package.json packageManager: pnpm@9.12.0)
pnpm install --frozen-lockfile
```

**Step 2: Run the production build**
```bash
pnpm build:dist
```

**Step 3: Verify the artifact**
```bash
ls dist/server.mjs dist/client/index.html   # success if both exist
```
Expected: both paths are printed (no `No such file` error). `dist/server.mjs` is the executable entry, and `dist/client/` holds the frontend static assets. If it errors, see [23-troubleshooting-faq.md](./23-troubleshooting-faq.md).

### 19.2.3 Artifact structure

```
dist/                              ← cwd (server.mjs starts with this as the artifact root)
├── server.mjs                     ← single-file esbuild entry (the only executable entry)
├── client/                        ← vite output (includes public/'s webext-artifact/)
│   ├── index.html                 ← SPA entry (inlined singleton import map)
│   └── assets/                    ← fingerprinted JS/CSS (long-cache immutable)
├── packages/<pkg>/{src,package.json,runner-bootstrap.mjs}
├── lib/app/stub-agent-process.mjs ← --stub mode; stubAgentPath() resolves via cwd
└── node_modules/
    ├── @blksails/<pkg> → ../../packages/<pkg>   (relative link, isomorphic with the source tree)
    └── <pi SDK closure>                          (hoisted from .pnpm sibling dirs)
```
(The structure follows the contract in the comments of `scripts/pack-dist.mjs:11-30`; the set of top-level entries is the definition of "artifact root" — a missing top-level entry raises no error, it only **fails silently** on some runtime path.)

---

## 19.3 Running the Service

### 19.3.1 Start directly (recommended for server deployment)

`dist/server.mjs` is a self-contained entry that reads two envs, `PORT` and `HOST` (`server/index.ts:100-101`):

```bash
# Start with the artifact root as cwd
cd dist && PORT=3000 HOST=0.0.0.0 NODE_ENV=production node server.mjs
```
The repo also has an equivalent script, `pnpm start` (= `node dist/server.mjs`, `package.json:25`). On successful startup it prints `pi-web on http://<host>:<port>`.

| Env | Purpose | Default |
|---|---|---|
| `PORT` | HTTP listen port | `3000` |
| `HOST` | Bind address | `127.0.0.1` |
| `NODE_ENV` | When `production`, injects the production CSP via Hono middleware (see §19.5) | — |

> The server entry reads `HOST` (not `HOSTNAME`). The `--host` option mapping and port conventions when starting via the CLI (`pi-web`) are covered separately in [18-cli.md](./18-cli.md).

### 19.3.2 Start via the CLI

If the npm package is installed globally, `pi-web <source>` resolves the runtime, unpacks the payload on first launch if needed, then brings up `dist/server.mjs`. The full options (`-p`/`--host`/`--cwd`/`--stub`/`--watch`, etc.) and the three-tier `resolveRuntime` resolution are covered in [18-cli.md](./18-cli.md).

---

## 19.4 Runtime Feature Flags (`NEXT_PUBLIC_*` semantics inverted)

The `NEXT_PUBLIC_PI_WEB_*` prefix on the variable names is retained, but **the semantics have flipped from "inlined at build time" to "read at server runtime"**. On startup the frontend requests `GET /api/bootstrap`, and the server reads the env and hands the values down (`server/bootstrap.ts:58-116`). This means:

- **Setting these flags at runtime now actually takes effect** — for example, `NEXT_PUBLIC_PI_WEB_CANVAS=1 node dist/server.mjs` is what opens the Canvas panel. The old doc's claim that they are "inlined at build time, no effect if set at CLI runtime" no longer holds.
- The server-authoritative gate (e.g. `PI_WEB_BASH_ENABLED`) and the frontend experience switch (e.g. `NEXT_PUBLIC_PI_WEB_BASH_ENABLED`) are still two independent variables: the former decides whether the endpoint exists at all (when off, `POST /sessions/:id/bash` returns 404), while the latter only affects UI hints. Both must be on for full functionality.

Common runtime flags: `NEXT_PUBLIC_PI_WEB_CANVAS` (Canvas Workbench, off by default), `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER`, `NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL`, `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL`. For the complete list see [06-configuration.md](./06-configuration.md).

---

## 19.5 Production CSP Hardening

In production mode (`NODE_ENV=production`), a Hono post-middleware injects a `content-security-policy` header into every response, with the value generated by `productionCsp()` (`server/static.ts:178-192`, `server/index.ts:34,49-52`). Compared to the old host it tightens two things:

1. **`unsafe-eval` is forbidden** — code webext is loaded via same-origin native dynamic import, which does not need it (proven in P0: the artifact has 0 `new Function` / `eval(`, and injecting one is immediately blocked by the browser).
2. **`unsafe-inline` is removed from `script-src`** — in the old host it existed only for Next's inline hydration bootstrap. Under the SPA the only inline script is the **singleton import map** in `index.html` (the browser only honors the first import map before any import, and support for external import maps is insufficient). Instead it is **allowlisted precisely by a sha256 hash**: `inlineScriptHashes()` reads `index.html`, extracts every inline `<script>` by regex, computes `'sha256-<base64>'` for each, and appends them to `script-src` (`server/static.ts:124-164`).

`style-src 'unsafe-inline'` is retained (needed by Tailwind's runtime injection and webext's scoped CSS). The complete policy:

```
default-src 'self';
script-src 'self' 'sha256-…';   ← hash of the inline import map
style-src 'self' 'unsafe-inline';
connect-src 'self';
frame-src 'self' blob: data:;   ← artifact isolation iframe
img-src 'self' data: blob:;
object-src 'none';
base-uri 'self'
```

> **On failure it does not silently degrade — it warns loudly**: if `index.html` yields no inline scripts (`hashes.length === 0`), `inlineScriptHashes()` writes a warning to stderr instead of falling back to `script-src 'self'` (`server/static.ts:154-161`). Because a silent degrade would disable the import map — the page looks fine, but every runtime-installed code webext fails to load. If you see this warning at deploy time, the frontend artifact is corrupt and you must rebuild with `pnpm build:client`.

### 19.5.1 Verify the CSP did not break the import map

The repo ships a browser-driving regression check, `pnpm e2e:csp` (`package.json:37` → `e2e/csp/import-map-csp.mjs`), which asserts against a production-mode instance that "there are no CSP violations and the import map has been applied":

```bash
# First start an instance in production mode (in another terminal; cwd MUST be the artifact root dist/, otherwise frontend static asset resolution fails)
cd dist && NODE_ENV=production PORT=3100 node server.mjs
# Back in the repo root, run the check (the e2e script ships with the source, not inside dist/)
node e2e/csp/import-map-csp.mjs http://127.0.0.1:3100
```
Expected: no violations, exit code 0. The counter-check `PI_WEB_CSP_EXPECT_VIOLATION=1 node e2e/csp/import-map-csp.mjs <url>` expects a violation. See [22-development-and-testing.md](./22-development-and-testing.md).

---

## 19.6 Environment Variable Reference

Core deployment-related variables (for the full reference see [06-configuration.md](./06-configuration.md)):

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP listen port | `3000` |
| `HOST` | Bind address (read by the server entry, not `HOSTNAME`) | `127.0.0.1` |
| `NODE_ENV` | `production` enables the production CSP (§19.5) | — |
| `PI_WEB_AGENT_DIR` | pi-web main-process config root directory (corresponds to the CLI `--agent-dir`) | `~/.pi/agent` |
| `PI_WEB_DEFAULT_SOURCE` | Default agent source directory | Current `cwd` |
| `PI_WEB_DEFAULT_CWD` | Default working directory | — |
| `PI_WEB_AUTOSTART` | `1` = automatically start the default agent session on entering the home page | — |
| `PI_WEB_ATTACHMENT_DIR` | Attachment persistence root directory | `~/.pi/agent/attachments` |
| `PI_WEB_ATTACHMENT_SECRET` | Attachment HMAC signing secret (must match between main and child processes) | Random (single process) |
| `PI_WEB_ATTACHMENT_URL_BASE` | Attachment URL base path (inherited by the child process via spawn env) | — |
| `PI_WEB_HIDE_PROVIDERS` | Comma-separated provider names to hide in the model list | — |
| `PI_WEB_STUB_AGENT` | `1` = use the stub agent (for UI testing, does not start a real runner) | — |
| `PI_WEB_BASH_ENABLED` | **Server-authoritative gate**: enables the bang shell endpoint (equivalent to RCE). When off, `POST /sessions/:id/bash` returns 404 | — (off) |
| `PI_CODING_AGENT_DIR` | The agent directory read by the pi SDK (child process), injected by the main process via spawn env (note: not `PI_AGENT_DIR`) | `~/.pi/agent` |

> **The difference between the two agent-dir variables**: `PI_WEB_AGENT_DIR` is the config root read by the main process (global settings, sandbox policy persistence); `PI_CODING_AGENT_DIR` is the directory the main process hands down to the pi SDK child process (trust store / session persistence). For multi-tenant isolation, both should be partitioned per tenant (see §19.7.4).
>
> **Note**: `PI_WEB_ATTACHMENT_SECRET` must be explicitly passed down by the main process to the child process via spawn env, with both using the same secret, otherwise the signed URLs produced by the child process fail verification (401) in the main process.
>
> The `NEXT_PUBLIC_PI_WEB_*` runtime feature flags are covered in §19.4 and [06-configuration.md](./06-configuration.md), and are not repeated here.

---

## 19.7 Production Hardening

### 19.7.1 Security Sandbox (Highest Priority)

In production, pi-web **must never run bare on the host**:

- **Agent source `index.ts`**: loaded and executed by the `jiti` runtime, which means running user code — equivalent to RCE.
- **pi tools** (bash/write/edit): hold full system permissions by default.

| Option | Isolation granularity | Use case |
|---|---|---|
| Per-session dedicated container (sidecar) | Process-level filesystem/network | Multi-tenant SaaS |
| Gondolin micro-VM (pi extension) | VM-level, tools routed into the VM | Strong isolation + host-held auth |
| OpenShell sandbox | Policy-based (FS/network/credentials/inference) | Managed/remote sandbox |

Minimum requirements: confine `cwd` to the workspace, container with read-only root + writable working volume, deny outbound network or allow on demand.

> **Bang shell commands (`PI_WEB_BASH_ENABLED`)**: pi-web's `!`/`!!` chat commands execute arbitrary shell directly in the session agent's working directory — equivalent to RCE. **Off by default**; when off, `POST /sessions/:id/bash` returns 404 without leaking the endpoint's existence. Keep it off for any multi-user / public deployment. For the variable, see [06-configuration.md](./06-configuration.md).

### 19.7.2 Graceful Shutdown

The server already registers `SIGTERM` / `SIGINT` handlers (`server/index.ts:107-113`): `server.close()` stops accepting new connections → `shutdownHandler()` closes all subprocesses and handles → `process.exit(0)`. Under container orchestration, delivering `SIGTERM` triggers this. If you need to additionally notify online frontends before shutdown (push a close event over SSE), you can extend above `shutdownHandler`.

### 19.7.3 Subprocess Resource Limits

| Dimension | Mechanism |
|---|---|
| Memory / CPU | Container cgroups limits |
| bash execution timeout | pi tool built-in timeout configuration |
| Output truncation | pi `fullOutputPath` (write large output to a file instead of inlining) |
| Concurrency cap | Global + per-tenant max session count; queue/reject when exceeded |
| Idle reclamation | N minutes of inactivity → `stop()` + evict from the registry |

### 19.7.4 Secrets and Multi-Tenancy

- Provider API keys are injected into the child process via `env`; **do not mount the host `~/.pi/agent`** (it would expose auth/session).
- Use a dedicated `PI_CODING_AGENT_DIR` per tenant (isolating settings/extensions/session), a dedicated `cwd`, and dedicated auth.
- Recommended: dynamically inject via a secret manager, with a dedicated secret per container.

### 19.7.5 Reverse Proxy (Critical SSE Configuration)

```nginx
# nginx example
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_http_version 1.1;
proxy_set_header Connection "";
# Or disable buffering via the response header: add_header X-Accel-Buffering "no";
```

- Turn off proxy buffering (`proxy_buffering off`), otherwise SSE frames get buffered and cannot be pushed in real time.
- Do not enable gzip compression on the SSE endpoint.
- Configure a periodic heartbeat comment frame to prevent intermediate layers from disconnecting.

---

## 19.8 Container Image

The repo contains no git-tracked `Dockerfile` — the following is a **reference example**, containerizing the `dist/` directory produced by `pnpm build:dist`.

### 19.8.1 Base Image

The runtime requires Node ≥ 22.19.0 (`package.json` `engines`); the esbuild artifact is `target: "node22"`. Choosing `node:22-bookworm-slim` satisfies this.

### 19.8.2 Reference Dockerfile

```dockerfile
FROM node:22-bookworm-slim

# The pi toolset (bash/git/ripgrep, etc.) must be pre-installed
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ripgrep bash ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the self-contained artifact (includes minimal node_modules and client/)
COPY dist ./

# Attachment storage mount point
VOLUME ["/data/attachments"]

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PI_WEB_ATTACHMENT_DIR=/data/attachments

EXPOSE 3000

# The artifact root is WORKDIR, so run the single-file entry directly
CMD ["node", "server.mjs"]
```

> **Note**: The image should not contain `~/.pi/agent` (to avoid auth leakage); provider API keys are injected via container env or a secret manager.

---

## 19.9 Observability and Billing

- Collect per-session token/cost via the RPC `get_session_stats` for quota management, billing, and rate limiting.
- Recommended structured log events to collect: session lifecycle (create / idle-reclaim / stop / crash), extension install audit, subprocess stderr, auto-retry / compaction events.
- For the logging system, see [21-logging.md](./21-logging.md).

---

## 19.10 Edge Deployment (Control/Data Plane Split)

If you need a stateless gateway on Edge/Serverless, you must split the control and data planes:

- **Control plane** (can be stateless, can run on Edge): catalog management, authentication/multi-tenancy, routing, billing.
- **Data plane** (stateful): the RPC channel to the agent host (SSE/command forwarding); state lives in the host (sandbox/device) rather than the gateway.

Sticky routing is solved by an external SessionRouter (e.g. Redis-backed) that routes to the correct host instance.

---

## Next Steps / Related Documents

- [06-configuration.md](./06-configuration.md) — Full environment variables and config file reference
- [18-cli.md](./18-cli.md) — The `pi-web` CLI, three-tier runtime resolution, and first-launch shared-runtime unpacking
- [20-desktop-tauri.md](./20-desktop-tauri.md) — Desktop edition (Tauri) packaging and distribution
- [21-logging.md](./21-logging.md) — Logging system and structured logging configuration
- [22-development-and-testing.md](./22-development-and-testing.md) — Dev-time dual-process orchestration, the build pipeline, and e2e (including `e2e:csp`)
- [23-troubleshooting-faq.md](./23-troubleshooting-faq.md) — Common deployment troubleshooting
