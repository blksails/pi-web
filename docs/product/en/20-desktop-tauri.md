# 20 · Desktop (Tauri): Packaging & Distribution

**pi-web's second delivery form: a thin Tauri v2 shell that bundles the `dist/server.mjs` backend from [19 Deployment & Operations](./19-deployment.md), together with a bundled Node runtime, into a `.dmg` / `.exe` installer / `.AppImage` — so users double-click and go, with no pre-installed Node required.** The shell carries no business logic of its own — it only unpacks the runtime, supervises the backend startup, navigates the window to the local loopback UI once ready, and cleanly tears the whole process tree down on exit.

> **Scope discipline (read this first)**
> The desktop shell genuinely lives on main (`desktop/src-tauri/` is a git-tracked Rust crate). The two related specs (`electron-to-tauri`, `shared-runtime-payload`) are both currently at phase **`implemented-partial`**. **Only the macOS end-to-end chain (build → package → launch → teardown → black-box e2e) has been verified**; the Windows (nsis) and Linux (appimage) targets are declared in `bundle.targets` and the code carries their branches, but **cross-platform is not yet verified end-to-end**. Everywhere this chapter touches Windows/Linux it is honestly marked "unverified".

---

## 20.1 Architecture Overview

The desktop shell is a Tauri v2 application whose executable name is always `pi-web` (`desktop/src-tauri/Cargo.toml:10-12`). The biggest difference from the Electron era: **there is no Node inside the shell** — Node ships as a standalone sidecar binary, and the business backend is still the same `dist/server.mjs`.

```
┌─ pi-web.app (or .exe / .AppImage) ─────────────────────────┐
│                                                            │
│  Tauri thin shell (Rust, main.rs)                          │
│    ├─ Create window + bundled loading page (before all,    │
│    │  so there is never a blank window)                    │
│    ├─ Determine runtime mode (packaged / dev / unpackaged) │
│    ├─ Unpack the shared runtime (once, on first launch)    │
│    ├─ Supervised backend launch → readiness probe →        │
│    │  navigate to 127.0.0.1:<port>                         │
│    └─ On exit, tear down the process tree                  │
│       (SIGTERM→SIGKILL / taskkill /T)                      │
│                                                            │
│  Bundled resources:                                        │
│    ├─ binaries/node        (externalBin, Node v22.22.0)    │
│    └─ payload/             (resources: compressed backend) │
│         ├─ dist.tar.zst    (zstd-compressed dist/ tree)    │
│         ├─ payload.json    (digest / version / entry count)│
│         └─ unpack.mjs      (zero-dependency single-file    │
│            unpacker)                                        │
└────────────────────────────────────────────────────────────┘
        │ bundled node runs unpack.mjs (first launch)
        ▼
   ~/.pi/web/runtime/<version>-<digest>/dist/server.mjs
        │ bundled node launches it (injects PORT / PI_WEB_NODE_BIN …)
        ▼
   Hono backend (127.0.0.1:<port>) ─── spawn ──▶ pi runner grandchild
```

Key identity information (`desktop/src-tauri/tauri.conf.json`):

| Field | Value |
| --- | --- |
| `productName` | `pi-web` |
| `identifier` | `com.blksails.pi-web-desktop` |
| `version` | `0.2.0` |
| `bundle.category` | `DeveloperTool` |
| `bundle.targets` | `["dmg", "nsis", "appimage"]` |
| `bundle.externalBin` | `["binaries/node"]` |
| `bundle.resources` | `{"../../payload/": "payload/"}` |
| `macOS.minimumSystemVersion` | `10.15` |

The Tauri dependency floor is pinned to **2.11.1** (`Cargo.toml:19`), because lower versions carry the `is_local_url()` origin bypass on Windows/Android (GHSA-7gmj-67g7-phm9). `profile.release` uses `opt-level="s" + lto + strip + panic="abort"` (`Cargo.toml:38-44`) — a thin shell has no hot compute, so everything trades for size.

> The `frontendDist: "frontend"` and `app.security.csp` in `tauri.conf.json` apply **only to the shell's own loading/error pages** (`tauri://` resources), not to the chat UI. Once the window is ready it navigates to the loopback backend, and from that point what takes effect is **the server's own CSP** (`productionCsp()`, see [19 Deployment & Operations §Production CSP](./19-deployment.md)).

---

## 20.2 Three Installer Forms

A single `tauri build` produces installers for three platforms according to `bundle.targets`:

| Target | Artifact | Platform | Verification status |
| --- | --- | --- | --- |
| `dmg` | `pi-web_0.2.0_<arch>.dmg` | macOS | **full chain verified** |
| `nsis` | `pi-web_0.2.0_x64-setup.exe` | Windows | code has the branch, **cross-platform unverified** |
| `appimage` | `pi-web_0.2.0_amd64.AppImage` | Linux | code has the branch, **cross-platform unverified** |

The executable name is explicitly pinned to `pi-web` (rather than derived from the package name) because Linux AppImage rejects derived names containing `@` — the old electron-builder once derived an illegal name from `@blksails/pi-web-desktop` (`Cargo.toml:8-9` comment).

---

## 20.3 Bundled Node Runtime (sidecar)

To run the backend you need Node. The desktop shell bundles official Node **v22.22.0** as a sidecar (`desktop/node-sidecar.lock.json`), with one code-reviewable trust anchor per target:

| triple | archive | checksum subject |
| --- | --- | --- |
| `aarch64-apple-darwin` | `node-v22.22.0-darwin-arm64.tar.xz` | official archive sha256 |
| `x86_64-apple-darwin` | `node-v22.22.0-darwin-x64.tar.xz` | official archive sha256 |
| `x86_64-unknown-linux-gnu` | `node-v22.22.0-linux-x64.tar.xz` | official archive sha256 |
| `x86_64-pc-windows-msvc` | `node-v22.22.0-win-x64.zip` | official archive sha256 |

**Trust model** (`node-sidecar.lock.json` header comment + `scripts/fetch-node-sidecar.mjs:1-13`):

- Checksums are committed and reviewable; the build script only compares against this file and **does not trust the downloaded `SHASUMS256.txt`** (it is same-origin as the binary — a tampered upstream would ship both altered together).
- The sha256 subject is the **official archive**, not the extracted `bin/node` (which varies with the tar implementation and stripping — not stable).
- Upgrading Node = a single explicit, code-reviewable commit.
- The binaries themselves are not committed (~86MB each even after stripping); they are fetched and verified on demand by `pnpm desktop:sidecar` into `desktop/src-tauri/binaries/` (excluded by `.gitignore`).

> ★ **`fetch-node-sidecar.mjs` is a compile prerequisite, not just a packaging step**: Tauri's `externalBin` validates file existence at `cargo build` time (with the target-triple suffix, e.g. `node-aarch64-apple-darwin`); at packaging time the suffix is stripped and the file lands beside the main executable. So **without fetching the sidecar first, `cargo check`/`tauri build` fail outright**.

After packaging, the bundled node always sits **beside the main executable** (`Contents/MacOS/node` on macOS), which is a different origin from `payload/` (which comes from `resource_dir()`) — **the two must not be conflated** (`resolve_artifact.rs:6-9`).

---

## 20.4 Shared Runtime Payload & First-Launch Unpack

`dist/` itself is **no longer bundled directly**. It is compressed into a payload that ships with the app and, on first launch, is unpacked into a shared runtime under the user's home directory — the CLI ([18 CLI](./18-cli.md)) and the desktop shell reuse the same unpack semantics.

### Packaging side: produce the payload

`scripts/pack-payload.mjs` packs `dist/` into `payload/dist.tar.zst` + `payload/payload.json` (`pack-payload.mjs:1-17`):

- **zstd level 19** (measured 9.4MB / ~21s to pack; level 3 gives 13.2MB / 1.2s — the 21 seconds is a one-time cost per release, the 3.8MB is a repeated cost on every user download).
- **`follow: true` to expand symlinks is a necessity, not an optimization**: `dist/node_modules/@blksails/pi-web-*` are symlinks pointing to `../../packages/*` on POSIX; if symlinks are left in the archive, Windows unpacking replays the realpath EPERM pitfall. The cost: `packages/*` is copied once, so the unpacked tree has ~489 more files / ~4MB than `dist/`.
- The digest (sha256) is taken over the **compressed payload bytes**, not the content tree — the same measure used by the streaming check at unpack time; "archive correct but disk write failed" is backstopped by the `entries` file count in `payload.json`.

`scripts/build-unpacker.mjs` uses esbuild to bundle `src/runtime/unpack.src.mjs` into a **zero-runtime-dependency single file** `payload/unpack.mjs` (~115KB, inlining the npm `tar`). Inlining is mandatory: the unpacker has no `node_modules` available at runtime — it is precisely what unpacks that `node_modules` (chicken-and-egg, `build-unpacker.mjs:5-9`).

### Runtime side: Rust only spawns, never implements unpacking

The key design constraint (`desktop/src-tauri/src/unpack_runtime.rs:1-16`): **there is exactly one implementation of unpack semantics**, inside `payload/unpack.mjs`. Since the desktop shell must already hold the bundled node (to launch the backend), it uses the same binary to run the same unpacker. The Rust side only handles spawn, timeout, and translating a single-line JSON into a discriminated error — it **never adds an archive/compression crate**, otherwise "how long should the lock wait", "what counts as corrupt", and "what does GC delete" would have two implementations and inevitably drift.

Process-boundary contract (`unpack_runtime.rs:11-16`):

```
node unpack.mjs --payload-dir <dir> --json
  → stdout is exactly one line of JSON (diagnostics go to stderr)
  → success: {"ok":true,"serverJs":…,"runtimeRoot":…,"runtimeDir":…,"unpacked":…}
  → failure: {"ok":false,"code":…,"message":…}, exit code 1
```

Rust **only consumes `code`, never parses the human-readable `message`** (`parse_ensure_output`, `unpack_runtime.rs:46-86`; parsing takes the last non-empty line, because node or a module it loads occasionally writes extra content to stdout).

Unpack destination: `~/.pi/web/runtime/<version>-<digest>/` by default, overridable via `PI_WEB_RUNTIME_ROOT` (`defaultRuntimeRoot` in `src/runtime/unpack.src.mjs`). `<digest>` is the first 12 hex of the payload-bytes sha256 — the same version with changed content lands in a different directory.

### Discriminated error codes

An unpack failure always lands on the shell's retryable error page (never a silent exit, `main.rs:154-161`). Error codes and user-facing copy (`describe_unpack_error`, `unpack_runtime.rs:145-157`):

| `code` | Meaning | User copy gist |
| --- | --- | --- |
| `payload-missing` | Payload/unpacker missing | Reinstall the app |
| `payload-corrupt` | Digest mismatch | Reinstall the app |
| `zstd-unsupported` | Bundled Node lacks zstd decompression | The app may be corrupted |
| `runtime-root-unwritable` | Runtime directory not writable | Check permissions, or set `PI_WEB_RUNTIME_ROOT` |
| `disk-full` | Insufficient disk space | Free up disk and retry |
| `lock-timeout` | Timed out waiting for another process to unpack | Confirm no instance is stuck, then retry |
| `extract-failed` | Unpacker did not run per contract (empty output / non-JSON / missing field) | Generic failure |

> These same error codes also appear in the desktop first-launch section of [23 Troubleshooting / FAQ](./23-troubleshooting-faq.md), with step-by-step self-recovery for each.

### Old-runtime garbage collection (GC)

Triggered only **after the backend launches successfully** (GC must not block backend startup, `main.rs:186-190`); best-effort, non-blocking, failures unreported (`spawn_gc`, `unpack_runtime.rs:124-142`):

```
node unpack.mjs --gc --runtime-root <root> --keep <current runtime dir>
```

The eviction criteria are deliberately conservative and multi-conditional (`selectGcVictims`, `src/runtime/unpack.src.mjs:119-142`) — better to keep than to wrongly delete a runtime still in use by another instance:

- The currently-in-use runtime directory (`--keep`) is **never eligible**.
- The remaining runtime directories are sorted by most-recent-use descending, and the **2 most recent are kept** (`GC_KEEP=2`); anything beyond that is deleted only if **older than 7 days** (`GC_MIN_AGE_MS`).
- Leftover `.staging-` / `.trash-` temp directories and stale `.lock-` lock directories are cleaned per their own age thresholds (`GC_TEMP_AGE_MS` / `STALE_LOCK_MS`).

---

## 20.5 Three-State Runtime-Mode Resolution

`resolve_runtime_mode(dev_url, is_packaged)` (`runtime_mode.rs:19-29`) uses "packaged or not" as the primary discriminator, layered with an explicit dev switch:

| Mode | Condition | Behavior |
| --- | --- | --- |
| **packaged** | packaged | Unpack from bundled `payload/` → launch backend |
| **dev** | not packaged **and** `PI_WEB_DESKTOP_DEV_URL` non-empty | Navigate to that URL, **do not launch the backend** (preserves frontend hot reload) |
| **unpackaged** | not packaged **and** no dev url | Run the build output `dist/server.mjs` directly (e2e and the local non-packaged path) |

★ **Safety constraint (pinned by a unit test)**: in the packaged state, even if `PI_WEB_DESKTOP_DEV_URL` is set, it **forces the packaged path** and never takes the dev branch — preventing a distributed app from connecting to some developer's server (`runtime_mode.rs:50-53`, unit test `packaged_takes_precedence_over_dev_url`).

---

## 20.6 Supervised Backend Launch & Readiness Probe

`ServerSupervisor::start` (`server_supervisor.rs:129-243`): pick a free loopback port → spawn `server.mjs` with the **bundled node** (set as its own process-group leader) → reuse the readiness probe to wait for availability → return the url, or a discriminated startup error (on failure it first tears down what it already launched, leaving no orphans).

**Environment overrides injected into the child** (`build_child_env`, `server_supervisor.rs:76-98`):

| Key | Value | Purpose |
| --- | --- | --- |
| `PORT` | the chosen free port | backend listen |
| `HOSTNAME` | `127.0.0.1` | backend bind |
| `PI_WEB_AUTOSTART` | `1` | tells the backend to auto-start a session (same injector as the CLI — see [06 Configuration · PI_WEB_AUTOSTART](./06-configuration.md); the CLI is not the only source) |
| `PI_WEB_NODE_BIN` | absolute path of the bundled node | **so the pi runner grandchild reuses the same bundled node** |

★ **`PI_WEB_AGENT_DIR` is deliberately not injected** (`server_supervisor.rs:75`, unit test `child_env_never_generates_agent_dir`): so sessions default to `~/.pi/agent`, sharing the same agent config as the CLI. But a `PI_WEB_AGENT_DIR` **explicitly set by the user** is inherited (the child inherits the parent environment, which is also how `HOME`/`PATH` are reachable). It also **strips** `ELECTRON_RUN_AS_NODE` (an Electron leftover, meaningless under Tauri, `STRIPPED_ENV_KEYS`).

**Readiness probe** (`ready_probe.rs` header contract table, kept in sync with `bin/pi-web.mjs`):

| Behavior | Value |
| --- | --- |
| Max port attempts | 20 (incrementing from `start_port`) |
| "occupied" criterion | TCP connect succeeds |
| Readiness endpoint | `GET /` |
| Readiness criterion | **any HTTP response** (status code ignored) |
| Poll interval / per-request timeout | 300ms / 2000ms |
| Total readiness timeout | 60_000ms |
| Abort condition | child already exited → fail immediately |

★ **Snapshot before teardown** (`server_supervisor.rs:213-215`, unit test `ready_timeout_is_not_misclassified_as_early_exit`): when the probe fails it must **first read** the child's exit-status snapshot, **then** `stop()`. Otherwise `stop()` killing a still-alive server would misclassify a `ReadyTimeout` as an `EarlyExit`. There are three discriminated startup errors: `NoFreePort` / `EarlyExit` (with exit code + stderr tail) / `ReadyTimeout`, each mapped to readable error-page copy (`startup_error.rs`).

---

## 20.7 Process-Tree Teardown (no orphans)

The backend spawns the pi runner as a **grandchild**, so teardown must reach the entire process tree (`server_supervisor.rs:245-297`):

- **POSIX**: the server is made its own process-group leader via `process_group(0)`; at teardown, `SIGTERM` is sent to the **negative pid** (`killpg`, reaching grandchildren), escalating to `SIGKILL` after a 3s grace period, with a 5s hard backstop. **It does not use `tauri_plugin_shell`'s Command** — that does not expose the process group, and its `kill()` only kills the direct child, never reaching grandchildren (`server_supervisor.rs:6-8`).
- **Windows (unverified)**: `taskkill /PID <pid> /T /F` (`/T` tree / `/F` force).

★ **Signal handling is a necessity, not a nicety** (`main.rs:222-245`): **tao does not handle SIGTERM/SIGINT** — the process is terminated directly by the kernel, and neither `RunEvent::ExitRequested` nor `Drop` runs, so the server and runner become orphans and the port is not released (confirmed by measurement). The shell uses `signal-hook` to catch these two signals and forwards to `app.exit(0)`, taking the normal `ExitRequested → stop()` exit path. The macOS black-box e2e (no WebDriver) relies precisely on this signal exit path.

`stop()` is idempotent, and `ServerSupervisor`'s `Drop` also calls it as a backstop.

---

## 20.8 Native Directory-Picker Bridge

The only "filesystem-related" host capability reachable by the render layer (the loopback UI), used for interactions like "pick an agent directory" (`dialog.rs:1-15`):

- The render layer calls via `invoke('pick_directory')`, which returns `Option<String>` — **only the absolute path string of the chosen directory is returned back**, statically guaranteeing that no directory contents, file listing, or any fs metadata is returned.
- **Cancel / no selection / exception → always "no result", never an IPC reject** (`normalize_pick_result`, `dialog.rs:26-43`); exceptions are logged to stderr.
- Authorization: for the app's own command to be called by the loopback UI, `allow-pick-directory` must be declared in `permissions/pick-directory.toml` and added to the capability; the render layer is **not** granted `dialog:allow-open` — the dialog is invoked from the Rust side.
- e2e seam: when `PI_WEB_DESKTOP_STUB_PICK_DIR` is non-empty, that path is returned directly with no dialog shown (this only changes the dialog's source, without relaxing any permission, `dialog.rs:13-15`).

Relatedly, **external-link governance** (`external_link.rs` + `window.rs`): in-app navigation interception has three branches — pages of this app (`tauri://` resources or the already-launched loopback origin) are allowed; non-loopback http(s) is handed to the system default browser; everything else (non-http(s) schemes, loopback on other hosts, malformed urls) is rejected, to avoid handing untrusted input to the system opener.

---

## 20.9 Desktop-Specific Environment Variables

Input env read by the desktop shell (`grep PI_WEB_ desktop/src-tauri/src`):

| Variable | Default | Effect | Evidence |
| --- | --- | --- | --- |
| `PI_WEB_DESKTOP_PORT` | `3000` | backend starting probe port | `main.rs:48-53` |
| `PI_WEB_DESKTOP_DEV_URL` | unset | dev-mode load address (ignored when packaged) | `runtime_mode.rs:13` |
| `PI_WEB_DESKTOP_SERVER_JS` | unset | override the unpackaged-state backend entry | `resolve_artifact.rs:22` |
| `PI_WEB_RUNTIME_ROOT` | `~/.pi/web/runtime` | shared-runtime unpack root | `unpack.src.mjs` |
| `PI_WEB_DEFAULT_SOURCE` | unset | default agent source in the backend base env | `main.rs:58` |
| `PI_WEB_DEFAULT_CWD` | current directory | default cwd in the backend base env | `main.rs:63` |
| `PI_WEB_DESKTOP_STUB_PICK_DIR` | unset | e2e: skip the native dialog and return this path | `dialog.rs:21` |

The shell **injects into the backend** `PORT`/`HOSTNAME`/`PI_WEB_AUTOSTART=1`/`PI_WEB_NODE_BIN`; it **deliberately does not inject** `PI_WEB_AGENT_DIR` (see §20.6). For the full env list, see the desktop grouping in [06 Configuration Reference](./06-configuration.md).

---

## 20.10 Building from Source (macOS, verified path)

The following steps have been verified end-to-end on macOS + Apple Silicon.

1. **Build the self-contained output and generate the payload** (this step already includes `build:unpacker` + `build:payload`):
   ```bash
   pnpm build:dist
   ```
   Expected: produces `dist/client`, `dist/server.mjs`, plus `payload/dist.tar.zst` + `payload/payload.json` + `payload/unpack.mjs`.

2. **Fetch the bundled Node sidecar** (must precede `tauri build` — its existence is validated at `cargo build` time):
   ```bash
   pnpm desktop:sidecar          # host triple; for CI cross-builds add --target <triple>
   ```
   Expected: `desktop/src-tauri/binaries/node-<triple>` is written, its sha256 matching `node-sidecar.lock.json`; a mismatch or absence exits non-zero.

3. **Package**:
   ```bash
   pnpm desktop:build            # = tauri build, produces dmg/nsis/appimage per bundle.targets
   ```
   Expected: on macOS, `desktop/src-tauri/target/release/bundle/dmg/pi-web_0.2.0_*.dmg`.

4. **First-launch verification**: install and open, or run the packaged e2e directly:
   ```bash
   pnpm e2e:desktop:packaged     # black-box: unpack → launch → ready → teardown (macOS verified)
   ```
   Expected: the first-launch log shows `[desktop] first launch, runtime unpacked → ~/.pi/web/runtime/0.2.0-<digest>`, and the window navigates to `http://127.0.0.1:<port>`.

> Local **unpackaged** development (running the Rust shell but with the in-repo `dist/server.mjs`): after `pnpm build:dist`, enter `desktop/` and run `pnpm dev` (`tauri dev`). To have the shell load an already-running Vite dev server ([01 Quickstart](./01-quickstart.md)'s `pnpm dev` starts on 5173), set `PI_WEB_DESKTOP_DEV_URL=http://localhost:5173` to take the dev path (no backend launch).

---

## 20.11 Size & Cold Start (macOS arm64, measured)

The following numbers are taken from the git-tracked `.kiro/specs/shared-runtime-payload/evidence/measure-summary.json` (2026-07-09, macOS 24.6.0 / Apple Silicon; `before` is the Electron baseline, `after` is Tauri + shared-runtime payload). **macOS arm64 only; other platforms/architectures untested.**

| Metric | before (Electron) | after (Tauri) |
| --- | --- | --- |
| `.app` | 177 MB | 101 MB |
| dmg | 81.4 MB | 47.6 MB |
| npm package (CLI) | 86 MB | 10 MB |
| unpacked runtime | — | 89 MB |
| desktop-only disk | 177 MB | **190 MB** |
| desktop + CLI both installed | 263 MB | 200 MB (−24%) |
| steady-state cold-start median | 1101 ms | 1137 ms |
| first cold start (incl. unpack) | — | 6974 ms |

★ **"desktop-only is actually +13MB" is an inherent tradeoff**: the installer stores the compressed payload (the ~47.6MB dmg contains a ~9.4MB `dist.tar.zst`), and first launch unpacks it into a ~89MB runtime — so two copies exist, one each. The benefit shows in the "desktop + CLI both installed" scenario: the two reuse the same shared runtime, dropping total disk from 263MB to 200MB. First cold start is markedly higher because it includes a one-time unpack (~6974ms); steady state returns to ~1137ms.

---

## 20.12 Test Surface

| Command | Coverage | Platform |
| --- | --- | --- |
| `pnpm --filter @blksails/pi-web-desktop test` | Rust unit tests (mode resolution / env assembly / process-tree teardown / unpack parsing / external links / directory picker) | runs on all platforms |
| `pnpm e2e:desktop:real` | unpackaged-state black box (real server + teardown) | macOS verified |
| `pnpm e2e:desktop:packaged` | packaged-state black box (incl. first-launch unpack) | macOS verified |
| `pnpm e2e:desktop:nonode` | failure path with the bundled node missing | macOS verified |
| `pnpm e2e:desktop:corrupt` | corrupted payload → `payload-corrupt` error page | macOS verified |
| `pnpm e2e:runtime:conc` / `:recovery` | shared-runtime unpack concurrency lock / crash recovery | macOS verified |

The Rust unit tests cover a wide surface (e.g. `stop_kills_grandchild_and_frees_port` verifies process-tree teardown with real child/grandchild processes, and `ready_timeout_is_not_misclassified_as_early_exit` pins the snapshot ordering) — they are this shell's most reliable regression net.

---

## Related

- The backend's own build/deploy/CSP (the desktop shell reuses its `dist/server.mjs`) → [19 Deployment & Operations (Web Server)](./19-deployment.md)
- The CLI launcher and the shared-runtime first-launch unpack (same `unpack.mjs` semantics) → [18 CLI](./18-cli.md)
- The full table of desktop-specific and injected env → [06 Configuration Reference](./06-configuration.md)
- Step-by-step self-recovery for first-launch unpack error codes → [23 Troubleshooting / FAQ](./23-troubleshooting-faq.md)
- Where the supervised backend launch sits in the overall architecture → [03 System Architecture](./03-architecture.md)
- The two-process startup during web development (contrast with desktop dev mode) → [01 Quickstart](./01-quickstart.md)
