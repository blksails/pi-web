# 15 · Deployment & Operations

This chapter covers the complete deployment path from local build to production container: standalone artifact packaging, isolated build directory conventions, topology constraints, and production hardening essentials.

---

## 15.1 Topology Constraint: Stateful, Long-Lived Connections

pi-web's core constraint stems from its architecture: **each session corresponds to one long-lived pi subprocess**, and that process's LLM context and tool state live in the memory of a single instance.

- **It cannot be deployed as a Serverless/Edge Function** (unless you split the control and data planes, see §15.9).
- **Horizontal scaling must use sticky routing keyed by `sessionId`**, otherwise the SSE stream and subsequent commands get routed to an instance that does not hold the subprocess, resulting in a 404 or a silent disconnect.
- Recommended deployment shape: `next build` standalone output + a long-lived Node service (Docker / K8s Deployment + Session-Affinity).

> Technical basis: comments in `next.config.ts` and PLAN.md §11.1.

---

## 15.2 Isolated Build Directory Convention

pi-web uses the `NEXT_DIST_DIR` environment variable to switch the build output directory, preventing different build scenarios from polluting each other:

| Scenario | `NEXT_DIST_DIR` | Artifact location |
|---|---|---|
| Day-to-day development (`next dev`) | `.next` (default) | `.next/` |
| Production CLI standalone build | `.next-cli` | `.next-cli/standalone/` |
| Browser e2e isolated build | `.next-e2e` | `.next-e2e/` |
| stub dev (UI testing) | `.next-stub` | `.next-stub/` |

`next.config.ts:55`:
```ts
distDir: process.env.NEXT_DIST_DIR ?? ".next",
```

**Key rule: never run `next build` while development is in progress (`next dev` running).** Both share the `.next/` cache directory, and concurrent writes cause webpack 500 errors or corrupted artifacts. When you need to build, first stop the dev process, or switch to an isolated directory (such as `.next-cli`) via `NEXT_DIST_DIR`.

---

## 15.3 Building the Standalone Artifact

### 15.3.1 next.config.ts Key Configuration

`next.config.ts` is already configured with `output: "standalone"`, so a minimal Node server bundle is generated automatically at build time. Key configuration items (already in effect in the repo, no changes needed):

```ts
// next.config.ts
output: "standalone",
outputFileTracingRoot: path.resolve(),
outputFileTracingIncludes: {
  "/**/*": [
    "./packages/server/runner-bootstrap.mjs",
    "./packages/server/src/**/*",
    "./packages/server/node_modules/@earendil-works/**/*",
    "./packages/server/node_modules/jiti/**/*",
    "./packages/agent-kit/**/*",
    "./packages/tool-kit/**/*",
    "./examples/**/*",
  ],
},
```

What `outputFileTracingIncludes` does: by default nft (Node File Tracing) cannot trace the subprocess dependencies that the main process spawns at session activation (the runner source imported by the `jiti` runtime, and the pi SDK). These must be explicitly included, otherwise real sessions cannot start under standalone.

### 15.3.2 Build Steps

**Step 1: Install dependencies**
```bash
# The repo uses pnpm (package.json packageManager: pnpm@9.12.0)
pnpm install --frozen-lockfile
```

**Step 2: Run the CLI standalone build**
```bash
# Run in the pi-web app root
pnpm build:cli
# Equivalent to:
NEXT_DIST_DIR=.next-cli next build && NEXT_DIST_DIR=.next-cli node scripts/pack-standalone.mjs
```

The `build:cli` script does two things:
1. Runs `next build` with `.next-cli` as the output directory, producing `.next-cli/standalone/`.
2. Runs `scripts/pack-standalone.mjs` (`scripts/pack-standalone.mjs`): copies `.next-cli/static/` into the corresponding location inside standalone, and copies `public/` — this is a necessary finishing step for Next.js standalone artifacts, otherwise page styles and public assets are missing.

**Step 3: Verify the artifact**
```bash
ls .next-cli/standalone/server.js   # success if the entry file exists
```
Expected: the path `.next-cli/standalone/server.js` is printed (no `No such file` error). If the build reports webpack 500 / corrupted artifacts, it is most likely that the dev process is still running and polluting `.next/` (see §15.2); otherwise consult [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md).

### 15.3.3 Standalone Artifact Structure

```
.next-cli/
└── standalone/
    ├── server.js                   # Next.js self-contained server entry
    ├── package.json
    ├── .next-cli/                  # Runtime resources (server chunks, etc.)
    │   └── static/                 # Copied by the pack-standalone script
    ├── public/                     # Copied by the pack-standalone script
    ├── lib/                        # App runtime code
    ├── examples/                   # Included via outputFileTracingIncludes (built-in example agents)
    ├── packages/                   # Workspace packages included via outputFileTracingIncludes
    │   ├── server/
    │   │   ├── runner-bootstrap.mjs
    │   │   ├── src/
    │   │   └── node_modules/@earendil-works/   # pi-ai, pi-coding-agent (the pi SDK)
    │   ├── agent-kit/
    │   ├── tool-kit/
    │   └── protocol/
    └── node_modules/               # Minimal runtime dependencies
```
(The above is a representative structure; the actual artifact is whatever `ls .next-cli/standalone/` shows on your machine.)

---

## 15.4 Running the Standalone Service

### 15.4.1 Start via the CLI (Recommended)

`bin/pi-web.mjs` is a thin launcher that translates command-line arguments into env, then spawns `standalone/server.js`:

```bash
# Start, pointing at an agent source directory
node bin/pi-web.mjs /path/to/agent-source -p 3000

# Or after global install:
pi-web /path/to/agent-source --port 3000 --host 0.0.0.0
```

| Option | Description | Default |
|---|---|---|
| `[source]` | Agent source directory (omit to use `cwd`) | `process.cwd()` |
| `-p, --port <n>` | Listen port | `3000` |
| `--host <h>` | Bind host | `127.0.0.1` |
| `--cwd <dir>` | Session working directory | Current `cwd` |
| `--agent-dir <d>` | pi agent directory | `~/.pi/agent` |
| `--open` | Automatically open the browser after startup | `false` |
| `--stub` | Run with the deterministic stub agent (offline smoke test) | `false` |
| `--watch` | Hot-reload mode (watch the agent source directory and auto-restart the runner on change; local directories only) | `false` |

### 15.4.2 Start server.js Directly

```bash
PORT=3000 HOSTNAME=0.0.0.0 node .next-cli/standalone/server.js
```

---

## 15.5 Environment Variable Reference

The following are the core deployment-related environment variables (for the full configuration reference see [05 · Configuration](./05-configuration.md)):

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP service listen port | `3000` |
| `HOSTNAME` | Bind address | `127.0.0.1` |
| `NODE_ENV` | Run mode (`production` enables CSP and other security headers) | — |
| `NEXT_DIST_DIR` | Build output directory (for isolating multiple builds) | `.next` |
| `PI_WEB_AGENT_DIR` | pi agent config root directory (overrides `~/.pi/agent`) | `~/.pi/agent` |
| `PI_WEB_DEFAULT_SOURCE` | Default agent source directory | Current `cwd` |
| `PI_WEB_DEFAULT_CWD` | Default working directory | — |
| `PI_WEB_AUTOSTART` | `1` = automatically start the default agent session on entering the home page | — |
| `PI_WEB_ATTACHMENT_DIR` | Attachment persistence root directory | `~/.pi/agent/attachments` |
| `PI_WEB_ATTACHMENT_SECRET` | Attachment HMAC signing secret (must match between main and child processes) | Random (single process) |
| `PI_WEB_ATTACHMENT_URL_TTL_MS` | Attachment signed URL validity (milliseconds) | `315360000000` (~10 years) |
| `PI_WEB_ATTACHMENT_URL_BASE` | Attachment URL base path (inherited by the child process via spawn env) | — |
| `PI_WEB_HIDE_PROVIDERS` | Comma-separated provider names to hide in the model list | — |
| `PI_WEB_STUB_AGENT` | `1` = use the stub agent (for UI testing, does not start a real runner) | — |
| `PI_WEB_WATCH` | `1` = enable runner hot-reload (the `--watch` equivalent in production standalone mode) | — |
| `PI_WEB_TRUST_PROJECT` | `1` = trust `.pi/` project extensions (custom agent mode) | — |
| `PI_WEB_SANDBOX_ENTRY` | Sandbox entry path (injected into the child process by the main process, custom mode) | — |
| `PI_CODING_AGENT_DIR` | The agent directory read by the pi SDK (child process), injected by the main process via spawn env (note: not `PI_AGENT_DIR`) | `~/.pi/agent` |
| `PI_WEB_BASH_ENABLED` | **Server-authoritative gate**: enables the bang shell command endpoint (`!`/`!!`, equivalent to arbitrary command execution / RCE). When off, `POST /sessions/:id/bash` returns 404 | — (off) |
| `NEXT_PUBLIC_PI_WEB_BASH_ENABLED` | **Frontend experience switch** (build-time inlined): recognizes the `!` prefix and shows the bash-mode hint; must be on together with the server gate for full use | — (off) |

> **The difference between the two agent-dir variables**: `PI_WEB_AGENT_DIR` is the config root directory read by the pi-web main process (global settings, sandbox policy persistence; corresponds to the CLI's `--agent-dir`, see `bin/pi-web.mjs:130`, `packages/server/src/config/config-codec.ts:16`); `PI_CODING_AGENT_DIR` is the directory the main process passes down to the pi SDK child process (trust store / session persistence, see `packages/server/test/agent-source/mode-trust.test.ts:159`). For multi-tenant isolation, both should be partitioned per tenant (see §15.6.4).

> **Note**: `PI_WEB_ATTACHMENT_SECRET` must be explicitly passed down by the main process to the child process via spawn env, with both using the same secret, otherwise the signed URLs produced by the child process will fail verification (401) in the main process.

---

## 15.6 Production Hardening

### 15.6.1 Security Sandbox (Highest Priority)

In production, pi-web **must never run bare on the host**:

- **Agent source `index.ts`**: loaded and executed by the `jiti` runtime, which means running user code — equivalent to RCE.
- **pi tools** (bash/write/edit): hold full system permissions by default.

Sandbox options (by isolation strength):

| Option | Isolation granularity | Use case |
|---|---|---|
| Per-session dedicated container (sidecar) | Process-level filesystem/network | Multi-tenant SaaS |
| Gondolin micro-VM (pi extension) | VM-level, tools routed into the VM | Strong isolation + host-held auth |
| OpenShell sandbox | Policy-based (FS/network/credentials/inference) | Managed/remote sandbox |

Minimum requirements: confine `cwd` to the workspace, container with read-only root + writable working volume, deny outbound network or allow on demand.

> **Bang shell commands (`PI_WEB_BASH_ENABLED`)**: pi-web's `!`/`!!` chat commands execute arbitrary shell directly in the session agent's working directory — equivalent to RCE. **Off by default**; enable only in trusted single-user / controlled environments, and always behind the sandbox above. Keep it off for any multi-user / public deployment (when off, `POST /sessions/:id/bash` returns 404 without leaking the endpoint's existence). The frontend experience switch `NEXT_PUBLIC_PI_WEB_BASH_ENABLED` is deliberately separate from the server-authoritative switch so the server can be hard-killed. See [05 · Configuration](./05-configuration.md) §11 for the variables.

### 15.6.2 Graceful Shutdown

Recommended order in response to `SIGTERM`:

1. Stop accepting new sessions (reject new `POST /api/sessions`).
2. Notify all online frontends (push a close event over SSE).
3. Call `stop()` on all subprocesses.
4. Close SSE connections and exit the process.

### 15.6.3 Subprocess Resource Limits

| Dimension | Mechanism |
|---|---|
| Memory / CPU | Container cgroups limits |
| bash execution timeout | pi tool built-in timeout configuration |
| Output truncation | pi `fullOutputPath` (write large output to a file instead of inlining) |
| Concurrency cap | Global + per-tenant max session count; queue/reject when exceeded |
| Idle reclamation | N minutes of inactivity → `stop()` + evict from the registry |

### 15.6.4 Secrets and Multi-Tenancy

- Provider API keys are injected into the child process via `env`; **do not mount the host `~/.pi/agent`** (it would expose auth/session).
- Use a dedicated `PI_CODING_AGENT_DIR` per tenant (isolating settings/extensions/session), a dedicated `cwd`, and dedicated auth.
- Recommended: dynamically inject via a secret manager, with a dedicated secret per container.

### 15.6.5 Reverse Proxy (Critical SSE Configuration)

SSE long-lived connections have special requirements for the reverse proxy:

```nginx
# nginx example
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_http_version 1.1;
proxy_set_header Connection "";
# Or disable buffering via the response header
# add_header X-Accel-Buffering "no";
```

- Turn off proxy buffering (`proxy_buffering off`), otherwise SSE frames get buffered and cannot be pushed in real time.
- Do not enable gzip compression on the SSE endpoint.
- Configure a periodic heartbeat comment frame to prevent intermediate layers from disconnecting.

---

## 15.7 Container Image

### 15.7.1 Base Image

```dockerfile
FROM node:24-bookworm-slim
```

The runtime requires Node >= 22.19.0 (the pi `engines` constraint); `node:24-bookworm-slim` satisfies this requirement.

### 15.7.2 Required System Tools

The pi toolset (bash/git/ripgrep, etc.) must be pre-installed in the image:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ripgrep bash ca-certificates \
    && rm -rf /var/lib/apt/lists/*
```

### 15.7.3 Minimal Dockerfile Example

```dockerfile
FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ripgrep bash ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the standalone artifact (already includes minimal node_modules)
COPY .next-cli/standalone ./

# Attachment storage mount point
VOLUME ["/data/attachments"]

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PI_WEB_ATTACHMENT_DIR=/data/attachments

EXPOSE 3000

# Use the CLI launcher, or run node server.js directly
CMD ["node", "server.js"]
```

> **Note**: The image should not contain `~/.pi/agent` (to avoid auth leakage); provider API keys are injected via container env or a secret manager.

---

## 15.8 Observability and Billing

- Collect per-session token/cost via the RPC `get_session_stats` for quota management, billing, and rate limiting.
- Recommended structured log events to collect:
  - Session lifecycle (create / idle-reclaim / stop / crash)
  - Extension install audit (who, when, which source was installed)
  - Subprocess stderr
  - auto-retry / compaction events
- For the logging system, see [16 · Logging](./16-logging.md).

---

## 15.9 Edge Deployment (Control/Data Plane Split)

If you need a stateless gateway on Edge/Serverless, you must split the control and data planes:

- **Control plane** (can be stateless, can run on Edge): catalog management, authentication/multi-tenancy, routing, billing.
- **Data plane** (stateful): the RPC channel to the agent host (SSE/command forwarding); state lives in the host (sandbox/device) rather than the gateway.

Sticky routing is solved by an external SessionRouter (e.g. Redis-backed) that routes to the correct host instance.

---

## Next Steps / Related Documents

- [05 · Configuration](./05-configuration.md) — Full environment variables and config file reference
- [14 · CLI](./14-cli.md) — All `pi-web` CLI options and `--watch` hot-reload
- [16 · Logging](./16-logging.md) — Logging system and structured logging configuration
- [17 · Development and Testing](./17-development-and-testing.md) — Dev-time build isolation and e2e test build conventions
- [18 · Troubleshooting FAQ](./18-troubleshooting-faq.md) — Common deployment troubleshooting
