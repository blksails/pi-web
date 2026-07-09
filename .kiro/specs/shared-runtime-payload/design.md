# Design Document — shared-runtime-payload

## Overview

**Purpose**: 把 85MB 的自包含产物 `dist/` 从「CLI 与桌面版各内嵌一份」改为「各携带一份 9.4MB 压缩载荷 + 首启解包到共享的版本化运行时目录」，让两者共用同一份运行时，并把桌面版下载体积从 80.7MB 降到约 48MB。

**Users**: 下载桌面版安装包的用户（下载更小）；同时安装 CLI 与桌面版的用户（磁盘上只留一份运行时）。

**Impact**: 这是一次**产物分发与定位契约**的变更，牵动 CLI 启动器、桌面壳的 Rust 编排层、产物构建脚本、npm 发布形态、Tauri 打包配置与发布流水线六处。它引入两个今天不存在的东西：**首次启动解包**（新失败模式）与**用户级运行时目录**（新的磁盘增长来源）。

### Goals

- 一份载荷、一份解包结果，被 CLI 与桌面版共享（版本与内容摘要一致时命中同一目录）。
- 解包原子落地：要么完整可用，要么不存在；中断、损坏、并发都能自愈。
- 开发与既有 e2e 路径**不触发解包**，迭代速度与 5 条既有真实会话 e2e 零改动。
- 净收益以实测裁定，不达标即停止（Req 12.7）。

### Non-Goals

- 随包 Node 二进制（86MB）的压缩内嵌 —— 体积三层计划的第三层，另立 spec。
- `dist/` 内容的进一步裁剪 —— 第一层已完成（`cb45637`）。
- 安装包签名与公证。
- 跨版本增量更新、运行时目录的网络下载。

## Boundary Commitments

### This Spec Owns

- 压缩载荷及其元数据的**生成**（`scripts/pack-payload.mjs`）与**格式契约**。
- 运行时目录的**命名规则**（`<runtimeRoot>/<version>-<digest12>/dist/`）、**完整性标记**（`.ok`）与**锁协议**。
- 解包器的唯一实现（`payload/unpack.mjs`）：解析顺序、原子落地、并发互斥、损坏自愈、错误码、GC。
- CLI 与桌面壳两侧的**接线**：`bin/pi-web.mjs` 的运行时解析、`resolve_artifact.rs` 的 `ServerSource` 判别式、`unpack_runtime.rs` 的 spawn 与错误映射。
- npm 与 Tauri 的**分发形态**（`files` / `bundle.resources`）。
- 净收益的实测脚本与验收报告。

### Out of Boundary

- 随包 Node 二进制的获取、校验、落盘位置 —— 由 `scripts/fetch-node-sidecar.mjs` 与 `bundle.externalBin` 拥有，本 spec **不得**改动其位置。
- `dist/` 树的内容构成 —— 由 `scripts/pack-dist.mjs` 拥有；本 spec 只**消费**它，唯一的新增是把它打成载荷。
- 后端进程的端口选取、就绪探针、进程树收尾 —— 由 `bin/pi-web.mjs` 与 `server_supervisor.rs` 拥有，本 spec 不触碰。
- `~/.pi/agent`（会话目录）的定位 —— 由 pi SDK 经继承的 `HOME` 自行完成；本 spec 新增的 `~/.pi/web` 与它是**并列的兄弟目录，互不引用**。

### Allowed Dependencies

- npm `tar`（devDependency，经 esbuild 内联，**不进入运行时依赖**）。
- `node:zlib` 的 zstd 流 API（Node ≥ 22.15；`engines` 已要求 ≥ 22.19）。
- 桌面壳可依赖已解析出的 `node_bin` 来执行解包器。**不得**新增 Rust 侧的归档/压缩 crate。

### Revalidation Triggers

以下任一变化都必须回头复检本 spec 的消费方：

- 运行时目录命名规则或 `.ok` 标记的字段变化 → 影响 GC 命名形态守卫与跨版本共存。
- `unpack.mjs` 的 `--json` 输出契约（字段名、错误码集合）变化 → 影响 `unpack_runtime.rs` 的解析与错误页文案。
- 载荷落盘目录名 `payload/` 变化 → 同时影响 npm `files`、`bundle.resources`、Rust `resource_dir` 拼接、CI 工件。
- `dist/` 顶层条目集合变化 → 影响 Req 6.1「解包结果是完整产物根」。
- `pack-dist.mjs` 是否产出符号链接的行为变化 → 影响载荷的 dereference 假设。

## Architecture

```
                      ┌──────────────────────────────┐
   构建期             │  scripts/pack-dist.mjs        │  （既有，不改逻辑）
                      │    → dist/  (85MB, 11 符号链接) │
                      └───────────────┬──────────────┘
                                      │
                      ┌───────────────▼──────────────┐
                      │  scripts/pack-payload.mjs     │  （新）
                      │   tar(follow) → zstd(19)      │
                      │   → payload/dist.tar.zst 9.4MB│
                      │   → payload/payload.json      │
                      └───────────────┬──────────────┘
                      ┌───────────────▼──────────────┐
                      │  scripts/build-unpacker.mjs   │  （新）
                      │   esbuild bundle → 115KB      │
                      │   → payload/unpack.mjs        │
                      └───────────────┬──────────────┘
                                      │
        ┌─────────────────────────────┴─────────────────────────────┐
        │ 分发                                                       │
   npm files: ["bin","payload",…]              tauri resources: {"../../payload/": "payload/"}
        │                                                            │
   ┌────▼─────────────┐                            ┌────────────────▼─────────────────┐
   │ bin/pi-web.mjs   │                            │ desktop  main.rs                  │
   │  resolveRuntime()│                            │   resolve_artifact → ServerSource │
   │   1 PI_WEB_DIST_DIR                           │     Direct(path)  │ Payload{dir}  │
   │   2 PKG_ROOT/dist                             │                   └──────┬────────┘
   │   3 ensureRuntime() ──┐                       │  unpack_runtime::ensure(node_bin, │
   └───────────────────────┼───────────────────────┤     payload_dir) ── spawn ────────┤
                           │                       └──────────────────┬────────────────┘
                           │                                          │
                    ┌──────▼──────────────────────────────────────────▼──────┐
                    │          payload/unpack.mjs  （唯一实现）               │
                    │  ensureRuntime() → { distRoot, serverJs, unpacked }    │
                    │  锁 · staging · 摘要校验 · .ok 标记 · GC                │
                    └──────────────────────┬────────────────────────────────┘
                                           │
                            ~/.pi/web/runtime/0.1.3-<digest12>/
                              ├── dist/          （89MB，完整产物根）
                              └── .ok            （最后写入，内含完整摘要）
```

**关键点**：桌面壳**不实现**解包。它已经必须持有 `node_bin`（用来拉起后端），于是用同一个二进制执行同一个 `unpack.mjs`。解包语义只存在一份。

## Boundary Commitments 的具体化：三个不可混用的路径来源

| 路径 | 来源 | macOS 打包态 | 备注 |
|---|---|---|---|
| `node_bin` | **主可执行同目录**（`bundle.externalBin`） | `Contents/MacOS/node` | 本 spec **不得**改动 |
| `payload_dir` | **资源目录**（`bundle.resources`） | `Contents/Resources/payload/` | 由 `dist/` 改为 `payload/` |
| `dist_root` | **用户运行时目录**（解包产出） | `~/.pi/web/runtime/<v>-<d12>/dist/` | 全新，不在安装包内 |

混用任意两者都会在**打包态**崩溃，且只有 `desktop-packaged.mjs` 能捕获。`resolve_artifact.rs` 的既有回归测试（`node_bin_comes_from_exe_dir_not_resource_dir`）必须保留并扩展一条 `payload_dir_comes_from_resource_dir`。

## 解析顺序

任一分支命中即停止，**不再向下**。

### CLI（`bin/pi-web.mjs`）

| 序 | 条件 | 结果 | 是否解包 | 需求 |
|---|---|---|---|---|
| 1 | `PI_WEB_DIST_DIR` 非空 | `PKG_ROOT/<它>/server.mjs` | 否 | 8.1 |
| 2 | `PKG_ROOT/dist/server.mjs` 存在 | 该路径 | 否 | 8.1（仓库/开发态） |
| 3 | 否则 | `ensureRuntime({ payloadDir: PKG_ROOT/payload })` → `distRoot/server.mjs` | **是** | 1.1–1.6 |
| — | 3 失败 | 打印可读错误，退出码 1 | — | 4.1–4.5 |

### 桌面壳（`resolve_artifact.rs`）

| 序 | 运行模式 | `ServerSource` | 是否解包 | 需求 |
|---|---|---|---|---|
| 1 | `Dev { dev_url }` | 不拉后端 | 否 | 8.3 |
| 2 | `Unpackaged` | `Direct(discover_cli_entry())` | 否 | 8.2 |
| 3 | `Packaged` | `Payload { payload_dir: resource_dir/payload }` | **是** | 1.1–1.6 |

**后果（必须写进 Testing Strategy）**：`cli-smoke` / `cli-real` / `cli-watch` / `desktop-real` / `desktop-no-node` 五条既有 e2e 走的都是「仓库内已有 `dist/`」分支，**零改动继续通过，但也完全测不到解包路径**。解包路径只由 `cli-reloc`（重写）与 `desktop-packaged`（更新）覆盖。

## 载荷格式契约

### `payload/payload.json`

```jsonc
{
  "schema": 1,
  "version": "0.1.3",          // 取自根 package.json
  "archive": "dist.tar.zst",
  "compression": "zstd",
  "algorithm": "sha256",
  "digest": "<64 hex>",        // 对 dist.tar.zst 的**字节流**取 sha256
  "bytes": 9853021,            // dist.tar.zst 字节数
  "entries": 9284,             // 归档中的文件条目数（解包后自检用）
  "root": "dist"               // 归档内的顶层目录名
}
```

### `payload/dist.tar.zst`

- 由 `tar.create({ cwd: repoRoot, follow: true, portable: true, noMtime: true }, ["dist"])` 经 `createZstdCompress({ params: { ZSTD_c_compressionLevel: 19 } })` 产出。
- `follow: true` → 11 个符号链接展开为实体（Req 2.2）。解包树因此为 **89MB / 9284 文件**，比 `dist/` 多 489 个文件（`packages/*` 的副本）。
- `portable: true, noMtime: true` → 剥除 uid/gid/mtime，使同一输入在不同机器上产出**尽量一致**的字节流。
- `tar` 自动使用 pax 扩展承载 >100 字符路径（Req 2.4），并保留 mode 的可执行位（Req 2.3）。

**摘要为什么取载荷字节而非内容树**：内容树摘要需要 hash 9284 个文件（数秒）；载荷字节摘要在 pack 时算一次、在解包时**流式**边读边算，零额外 IO。它唯一无法覆盖的是「解包器写盘出错但归档本身正确」，由**落盘文件数**自检兜底。

⚠ **实测修正**：`entries` 的自检必须统计**磁盘上实际写出的文件数**，而不是从归档里读出的条目数——后者与写盘成败无关，兜不住任何写盘故障。同时 `tar` 的 `extract` 必须开 `strict: true`：它默认把写盘错误当作**可恢复的 warning 丢掉**（`unpack.js`：“Other errors are warnings, which raise the error in strict”）。实测在 20MB 卷上解 89MB 的树，tar 写满 1437 个文件后**正常返回**，摘要校验也通过，最终在写 `.ok` 时才炸；若那点残余空间刚好够写 `.ok`，就会落地一个带合法完整性标记、却只有 1437/9284 个文件的运行时。

## 运行时目录布局与状态机

```
<runtimeRoot>/                                   默认 ~/.pi/web/runtime，可经 PI_WEB_RUNTIME_ROOT 覆盖
├── 0.1.3-a1b2c3d4e5f6/                          ← 目标目录 target
│   ├── dist/                                    ← 完整产物根（89MB）
│   └── .ok                                      ← 完整性标记，最后写入
├── .staging-a1b2c3d4e5f6-<pid>-<rand>/          ← 解包中；崩溃残留由 GC 清理
├── .lock-a1b2c3d4e5f6/                          ← mkdir 原子锁
└── .trash-<rand>/                               ← 被替换的损坏目录，尽力删除
```

`.ok` 内容：`{ "schema": 1, "version": "0.1.3", "digest": "<64 hex>", "entries": 9284, "unpackedAt": "<ISO>" }`

**目录名为什么含摘要**（Req 1.3）：开发期在同一 `version` 下反复重建 `dist/`。仅以版本命名会永久命中陈旧运行时，且无任何症状。摘要前 12 位（48 bit）足以区分。

### 解包状态机

| 起始状态 | 动作 | 终止状态 | 需求 |
|---|---|---|---|
| `target/.ok` 存在且 `digest` 匹配 | touch `.ok` 的 mtime（供 GC 判活）；直接返回 | 命中，`unpacked=false` | 1.4, 10.1 |
| `target` 不存在 | 取锁 → 解包到 staging → 写 `.ok` → `rename(staging → target)` | 已解包 | 3.1, 3.2 |
| `target` 存在但无 `.ok`，或 `.ok` 的 `digest` 不匹配 | 取锁 → 解包到 staging → `rename(target → .trash-*)` → `rename(staging → target)` → 尽力删 trash | 已修复 | 3.5 |
| 取锁时 `.lock-*` 已存在 | 轮询 `target/.ok`（250ms）直至出现或超 `LOCK_WAIT_MS`(120s) | 复用他人结果 / `lock-timeout` | 3.3, 3.6 |
| `.lock-*` 的持有者进程**已死**（`owner.json` 记录 pid+host，`kill(pid,0)` 探测） | 立即判为陈旧，删除后重新竞争 | 继续 | 3.3 |
| `.lock-*` 的 mtime 早于 `STALE_LOCK_MS`(10min) | 兜底判据（跨主机 / owner 文件缺失） | 继续 | 3.3 |
| 解包中途进程被杀 | staging 残留，`target` 不存在或无 `.ok` | 下次启动重新解包；staging 由 GC 清理 | 3.4 |
| 摘要不匹配 | 删除 staging，抛 `payload-corrupt` | 失败，**不留下带 `.ok` 的目录** | 2.6, 4.3, 4.5 |

**`rename` 为什么必须先把旧目录移开**（D-5）：POSIX 上 `rename(dir → 非空 dir)` 返回 `ENOTEMPTY`，Windows 上直接失败。「先移开再 rename」是唯一跨平台一致的原子替换路径。

**锁的陈旧判据为什么必须看存活而非年龄**（实测修正）：只按年龄判断的话，解包途中崩溃（或被 SIGKILL）留下的锁在 10 分钟内都算「新鲜」，下一次启动要空等满 `lockWaitMs`(120s) 才报 `lock-timeout`——**崩一次，应用两分钟起不来**。故锁内写 `owner.json`（pid + host + at），后来者用 `kill(pid, 0)` 探测存活；年龄阈值退居兜底（跨主机共享盘、owner 文件缺失）。误判方向是安全的：把活的当死的只可能发生在 pid 极短时间内被复用，而那时 `kill(0)` 返回存活，我们选择**等待**而非接管。

**失败时为什么必须等流关闭再删 staging**（实测修正）：`pipeline` 一旦 reject 就 destroy 各流，但 tar 的 `Unpack` **仍可能有在途的 `mkdir`/`open` 落盘**。立刻 `rm` staging 会删到一半又被重新写出来，磁盘满时必然残留一个半成品目录——而那正是用户最需要回收的空间。

## 解包器接口（`payload/unpack.mjs`）

同时是**库**（被 `bin/pi-web.mjs` 动态 `import()`）与 **CLI**（被桌面壳 spawn）。

```ts
// 库接口
export interface EnsureOptions {
  payloadDir: string;              // 含 dist.tar.zst 与 payload.json
  runtimeRoot?: string;            // 默认 PI_WEB_RUNTIME_ROOT ?? ~/.pi/web/runtime
  lockWaitMs?: number;             // 默认 120_000
}
export interface EnsureResult {
  distRoot: string;                // <target>/dist
  serverJs: string;                // <target>/dist/server.mjs
  unpacked: boolean;               // 本次是否真的解了包
  elapsedMs: number;
}
export type RuntimeErrorCode =
  | "payload-missing" | "payload-corrupt" | "zstd-unsupported"
  | "runtime-root-unwritable" | "disk-full" | "lock-timeout" | "extract-failed";
export class RuntimeError extends Error { readonly code: RuntimeErrorCode }

export function ensureRuntime(opts: EnsureOptions): Promise<EnsureResult>;
export function gcRuntimeRoot(runtimeRoot: string, keepDir: string): Promise<GcReport>;

// 以下为纯函数，直接单测（不碰文件系统）
export function runtimeDirName(version: string, digest: string): string;  // "0.1.3-a1b2c3d4e5f6"
export function isRuntimeDirName(name: string): boolean;                  // GC 命名形态守卫
export function classifyFsError(err: NodeJS.ErrnoException): RuntimeErrorCode;
export function selectGcVictims(entries: GcEntry[], keepDir: string, now: number): string[];
```

### CLI 模式（供桌面壳）

```
node unpack.mjs --payload-dir <dir> [--runtime-root <dir>] --json
node unpack.mjs --gc --runtime-root <dir> --keep <dirName>
```

`--json` 在 **stdout 输出恰好一行 JSON**，其余诊断一律走 stderr：

```jsonc
{"ok":true,"distRoot":"…","serverJs":"…","unpacked":true,"elapsedMs":5312}
{"ok":false,"code":"payload-corrupt","message":"载荷摘要不匹配：期望 a1b2… 实得 f9e8…"}
```

失败时退出码 1。**Rust 侧只解析这一行，不解析人类可读文案**（与既有 `ServerStartError` 的判别式风格一致）。

### 错误码 → 用户可见行为

| 码 | 触发 | CLI 行为 | 桌面壳行为 | 需求 |
|---|---|---|---|---|
| `runtime-root-unwritable` | `EACCES`/`EPERM`/`EROFS` 于 runtimeRoot | stderr 打印路径+权限原因，退出 1 | 可重试错误页 | 4.1, 4.6, 1.6 |
| `disk-full` | `ENOSPC` | 打印空间不足；清除 staging | 可重试错误页 | 4.2 |
| `payload-missing` | `payload.json` 或归档缺失 | 打印损坏；提示重装 | 可重试错误页 | 4.3 |
| `payload-corrupt` | 摘要不匹配 / 解压失败 | 同上 | 同上 | 2.6, 4.3 |
| `zstd-unsupported` | `createZstdDecompress` 非函数 | 打印「需 Node ≥ 22.15.0，当前 vX」 | 不可能发生（sidecar 恒 22.22） | 4.4 |
| `lock-timeout` | 等待他人解包超 120s | 打印超时与锁路径 | 可重试错误页 | 3.6 |
| `extract-failed` | 其余 IO 错误 | 打印底层 errno | 可重试错误页 | 4.5 |

**所有失败路径的共同后置条件**：不存在带 `.ok` 的 `target`（Req 4.5）。

## GC 设计（Req 5）

在**后端进程已被拉起之后**触发，尽力而为，失败一律吞掉（Req 5.4/5.5）。

- CLI：`launch()` spawn 子进程后，fire-and-forget 调 `gcRuntimeRoot()`。
- 桌面壳：`server_supervisor.start()` 返回后，`unpack_runtime::spawn_gc()` 起一个 detached 进程，不等待。

**受删条目**（`selectGcVictims`，纯函数）：

1. `.staging-*` / `.trash-*`：mtime 早于 1 小时。
2. `.lock-*`：mtime 早于 10 分钟（陈旧锁）。
3. 运行时目录：**必须**匹配 `/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?-[0-9a-f]{12}$/`（Req 5.6），且
   - 不是 `keepDir`（当前正在使用的），且
   - 不在「按 `.ok` mtime 排序后最近的 K=2 个」之内，且
   - `.ok` 的 mtime 早于 7 天。

命名形态守卫是**防灾条款**：若 `PI_WEB_RUNTIME_ROOT` 被误设为 `$HOME`，GC 也只会删掉形如 `1.2.3-abcdef012345` 的条目，不会碰 `Documents/`。

### 已知局限（D-3，如实记录）

Req 5.3 要求「不删正在被其他进程使用的目录」，但跨进程无引用计数可用。本设计的近似是「每次成功解析时 touch `.ok`」→ 正在使用的目录 mtime 新鲜。误删窗口 = 某进程持续运行 **超过 7 天且期间从未重启**。兜底：POSIX 上删除已被打开的文件不影响运行中的进程；Windows 上删除会失败而 GC 吞掉异常。**这是启发式，不是保证**，不得在验收中声称满足了强不变式。

## 启动开销（Req 10）

| 路径 | 额外 IO | 预算 |
|---|---|---|
| 命中已解包目录 | `stat(payload.json)` + `readFile(.ok)` + `utimes(.ok)` | ≤ 200ms 增量（Req 10.2） |
| 首次解包 | 读 9.4MB + 写 89MB / 9284 文件 | 实测记录，不设硬上限（Req 10.3） |

**不读取载荷内容、不重算摘要**（Req 10.1）：`.ok` 里存的完整摘要与 `payload.json` 里的比对即可，二者都是小文件。

## File Structure Plan

### 新建

| 路径 | 职责 |
|---|---|
| `scripts/pack-payload.mjs` | 由 `dist/` 产出 `payload/dist.tar.zst` + `payload/payload.json`；计算 sha256 与 entries 计数 |
| `scripts/build-unpacker.mjs` | esbuild 把 `src/runtime/unpack.src.mjs` 打成零依赖的 `payload/unpack.mjs` |
| `src/runtime/unpack.src.mjs` | **解包器唯一实现**（源码）：`ensureRuntime` / `gcRuntimeRoot` / 纯函数族 / CLI 入口 |
| `desktop/src-tauri/src/unpack_runtime.rs` | spawn `node_bin unpack.mjs --json`、超时、解析单行 JSON、错误分类；`parse_ensure_output` 为纯函数 |
| `scripts/measure-payload-baseline.mjs` | Req 12 的三场景磁盘 / dmg / 首启与稳态冷启动实测 |
| `e2e/runtime-payload-concurrency.mjs` | N 个解包器并发打同一 runtimeRoot：恰好一个解包，全部成功，最终一个目录 |
| `e2e/runtime-payload-recovery.mjs` | 载荷损坏 / 无 `.ok` 的目录 / 解包中途被杀 / runtimeRoot 只读 / 磁盘满 |
| `test/runtime-payload/unpack-pure.test.ts` | `runtimeDirName` / `isRuntimeDirName` / `classifyFsError` / `selectGcVictims` |
| `test/runtime-payload/ensure-runtime.test.ts` | 用**合成小载荷**在临时目录跑完整 `ensureRuntime`：首解、命中、损坏自愈、摘要不匹配 |

### 修改

| 路径 | 改动 |
|---|---|
| `bin/pi-web.mjs` | `distServerJs()` → `resolveRuntime()`（async，三级解析）；`main()` 改 await；spawn 后 fire-and-forget GC。**`buildEnv`/`findFreePort`/`waitForReady`/`launch` 的 cwd 语义不动** |
| `package.json` | `files: ["bin","payload","vite.config.ts"]`；新增 `build:payload`、`build:unpacker`；`build:dist` 末尾串接二者；`tar` 入 devDependencies |
| `scripts/pack-dist.mjs` | 不改逻辑。仅在文件头补一句：它是载荷的**唯一上游**，符号链接由 `pack-payload` 负责展开 |
| `desktop/src-tauri/tauri.conf.json` | `resources`: `{"../../dist/": "dist/"}` → `{"../../payload/": "payload/"}` |
| `desktop/src-tauri/src/types.rs` | 新增 `ServerSource` 判别式、`UnpackError`；`ArtifactPaths` 的 `server_js` → `server_source` |
| `desktop/src-tauri/src/resolve_artifact.rs` | Packaged 返回 `Payload { payload_dir }`；新增 `payload_dir_comes_from_resource_dir` 回归测试；保留 `node_bin_comes_from_exe_dir_not_resource_dir` |
| `desktop/src-tauri/src/main.rs` | `Payload` 分支调 `unpack_runtime::ensure`；失败经 `describe_*` 进既有可重试错误页；server 就绪后 `spawn_gc` |
| `desktop/src-tauri/Cargo.toml` | 无新增依赖（`serde_json` 已在） |
| `.github/workflows/desktop-release.yml` | `build-dist` job 产出 `payload/` 工件（非 `dist.tgz`）；各平台矩阵下载 `payload/` 并校验 `payload.json` 摘要；smoke 强制真实首启解包 |
| `e2e/cli-reloc.mjs` | 重写为 **npm 安装态**模拟：临时包根只含 `bin/` + `payload/`，`PI_WEB_RUNTIME_ROOT` 指临时目录，断言发生解包 + 真实会话 |
| `e2e/desktop/desktop-packaged.mjs` | 断言 `Contents/Resources/payload/` 存在且 `Contents/Resources/dist` **不存在**；设 `PI_WEB_RUNTIME_ROOT` 为临时目录；断言解包后 `dist/node_modules` 非空 |
| `e2e/desktop/shared.mjs` | 新增临时 runtimeRoot 的创建与清理；`ensurePrerequisites` 追加 `payload/` 存在性守卫 |
| `e2e/cli-smoke.mjs` | 产物完整性清单改为断言 `payload/{dist.tar.zst,payload.json,unpack.mjs}` 存在（仓库 `dist/` 仍走分支 2，不变） |
| `.gitignore` | 忽略 `payload/` |

### 不改（明确记录，防止误伤）

`bin/pi-web.mjs` 的 `buildEnv`/`isPortFree`/`findFreePort`/`waitForReady`；`server_supervisor.rs` 全部（含 `build_child_env` 不注入 `PI_WEB_AGENT_DIR`、cwd = `server_cwd(server_js)`）；`ready_probe.rs`；`fetch-node-sidecar.mjs`；`bundle.externalBin`。

## Requirements Traceability（12 需求 / 65 条）

| 需求 | 条 | 落点 |
|---|---|---|
| 1 共享运行时目录 | 1.1 | `runtimeDirName()` + `~/.pi/web/runtime` 默认根 |
| | 1.2 | 同 version+digest → 同目录名（`ensure-runtime.test.ts` 双次调用命中） |
| | 1.3 | digest 前 12 位入目录名；不同摘要互不覆盖 |
| | 1.4 | `.ok` 匹配即返回，`unpacked=false` |
| | 1.5 | `PI_WEB_RUNTIME_ROOT` |
| | 1.6 | `mkdir -p` runtimeRoot；失败 → `runtime-root-unwritable` |
| 2 载荷 | 2.1 | `pack-payload.mjs` 产出归档 + `payload.json` |
| | 2.2 | `tar.create({follow:true})`；e2e 断言解包树符号链接数 = 0 |
| | 2.3 | `tar` 保留 mode；e2e 断言 exec 文件数一致 |
| | 2.4 | `tar` pax 扩展；e2e 断言 155 字符条目非空 |
| | 2.5 | 跨平台一致：CI 在 Ubuntu 打包，三平台解包后断言 `entries` 与 exec 数 |
| | 2.6 | 流式 sha256 校验；不匹配 → 删 staging + `payload-corrupt` |
| 3 原子与并发 | 3.1 | staging → `rename` |
| | 3.2 | `.ok` 最后写 |
| | 3.3 | `.lock-*` mkdir 互斥 + 轮询复用；陈旧锁超时接管 |
| | 3.4 | 中断 → 无 `.ok` → 下次重解（`runtime-payload-recovery.mjs`） |
| | 3.5 | 无 `.ok` 判损坏 → trash + 重解 |
| | 3.6 | `lockWaitMs` 超时 → `lock-timeout` |
| 4 失败可观测 | 4.1 | `classifyFsError` EACCES/EPERM/EROFS |
| | 4.2 | ENOSPC → `disk-full` + 清 staging |
| | 4.3 | `payload-missing` / `payload-corrupt` |
| | 4.4 | 入口处 `typeof createZstdDecompress !== "function"` → `zstd-unsupported` |
| | 4.5 | 所有失败路径的共同后置条件：无带 `.ok` 的 target |
| | 4.6 | `unpack_runtime.rs` 错误 → `show_startup_error` → 既有可重试错误页 |
| 5 GC | 5.1 | `gcRuntimeRoot` 在后端拉起后触发 |
| | 5.2 | 保留 `keepDir` + 最近 K=2 |
| | 5.3 | 7 天最小年龄 + 每次解析 touch `.ok`（**启发式，见 D-3**） |
| | 5.4 | 全部异常吞掉 |
| | 5.5 | CLI fire-and-forget；桌面壳 detached spawn，均在 spawn 后端**之后** |
| | 5.6 | `isRuntimeDirName()` 正则守卫 |
| 6 产物根 | 6.1 | 归档根为 `dist`，含全部顶层条目；`entries` 计数自检 |
| | 6.2 | CLI `launch()` 与 `server_supervisor` 的 cwd = `dirname(serverJs)`（未改） |
| | 6.3 | `cli-reloc` / `desktop-packaged` 跑真实会话，覆盖 5 处 cwd 回退 |
| | 6.4 | 归档内入口恒为 `dist/server.mjs` |
| 7 分发形态 | 7.1 | `files: ["bin","payload",…]` |
| | 7.2 | `bundle.resources` → `payload/` |
| | 7.3 | `bundle.externalBin` 不动 |
| | 7.4 | `resolve_artifact.rs` 两条独立回归测试 |
| 8 不触发解包 | 8.1 | 解析顺序表 CLI 第 1/2 级 |
| | 8.2 | `Unpackaged` → `Direct(discover_cli_entry())` |
| | 8.3 | `Dev` 不拉后端（未改） |
| | 8.4 | `PI_WEB_RUNTIME_ROOT` 由 e2e 指向临时目录 |
| 9 行为等价 | 9.1 | `desktop-no-node.mjs`（未改，仍绿） |
| | 9.2 | `desktop-packaged.mjs`（更新） |
| | 9.3 | `cli-real.mjs`（未改，仍绿） |
| | 9.4 | `cli-reloc.mjs`（重写：运行时落在与构建目录无关的绝对路径） |
| | 9.5 | `desktop-real.mjs` 的端口释放与孤儿检查（未改） |
| | 9.6 | 覆盖范围不弱化：新增 2 条 e2e，无一条被删除或降级 |
| 10 开销 | 10.1 | 命中路径只 stat/read 小文件 |
| | 10.2 | `measure-payload-baseline.mjs` 实测稳态增量 ≤ 200ms |
| | 10.3 | 实测并记录首启解包耗时 |
| | 10.4 | 验收报告给出首启 / 稳态两组数值 |
| 11 流水线 | 11.1 | `build-dist` job 产出 `payload/` 工件 |
| | 11.2 | 矩阵各 job 下载工件，不重建 `dist/` |
| | 11.3 | 各 job 校验 `payload.json` 的 digest 与实际归档一致，不一致即失败 |
| | 11.4 | smoke job 清空 runtimeRoot 后跑 `desktop-packaged.mjs`，强制经历真实首启解包 |
| | 11.5 | `release` job `needs: smoke` |
| 12 净收益 | 12.1–12.3 | `measure-payload-baseline.mjs` + `evidence/payload-comparison.md` |
| | 12.4–12.6 | 三条阈值在测量脚本中以断言实现，输出 PASS/FAIL |
| | 12.7 | FAIL → 停止，写入报告并交回决策者 |
| | 12.8 | 报告只填实测值，不填推算值 |

## Testing Strategy

### Rust 单测（`cargo test`）

- `resolve_artifact`：`Packaged → ServerSource::Payload { resource_dir/payload }`；`Unpackaged → Direct`；`Dev → None`。
- **两条来源分离回归测试**：`node_bin` 恒来自 `exe_dir`（既有，保留）；`payload_dir` 恒来自 `resource_dir`（新增）。
- `unpack_runtime::parse_ensure_output`（纯函数）：合法 ok / 合法 err / 空输出 / 多行输出取最后一行 / 非 JSON 垃圾 → 分类为 `extract-failed`。

### vitest

- `unpack-pure.test.ts`：`runtimeDirName`；`isRuntimeDirName`（**必须拒绝** `Documents`、`.staging-x`、`1.2.3-XYZ`、`1.2.3-abc`(位数不足)）；`classifyFsError`（ENOSPC/EACCES/EPERM/EROFS/其他）；`selectGcVictims`（keepDir 永不入选、最近 K 个保留、未满 7 天不删、非法命名不删）。
- `ensure-runtime.test.ts`：用**合成的小载荷**（3 个文件，含 1 个 exec、1 个 >100 字符路径）在临时目录：首解 `unpacked=true` → 二次调用 `unpacked=false`；删 `.ok` 后自愈重解；篡改归档一字节 → `payload-corrupt` 且不留 `.ok`；runtimeRoot `chmod 555` → `runtime-root-unwritable`。

### node e2e

| 脚本 | 覆盖 | 为什么不可替代 |
|---|---|---|
| `e2e/runtime-payload-concurrency.mjs` | 并发首启（Req 3.3/3.6） | 锁协议只有真并发能证伪 |
| `e2e/runtime-payload-recovery.mjs` | 中断 / 损坏 / 只读 / 磁盘满（Req 3.4/3.5/4.1–4.3） | 失败路径无法由单测覆盖 `rename` 的跨平台行为 |
| `e2e/cli-reloc.mjs`（重写） | npm 安装态首启解包 + 重定位（Req 9.4） | CLI 侧**唯一**覆盖解包路径的 e2e |
| `e2e/desktop/desktop-packaged.mjs`（更新） | 打包态首启解包 + 真实会话（Req 9.2/11.4） | 桌面侧**唯一**能抓 `resource_dir` 布局漂移的 e2e |
| `e2e/desktop/desktop-no-node.mjs`（未改） | 无系统 node 保证（Req 9.1） | 走仓库 `dist/` 分支，不涉解包 |

### ⚠ 自动化覆盖盲区（如实登记）

| 需求 | 盲区 | 原因 |
|---|---|---|
| 4.2 磁盘满 | 仅 macOS 用 `hdiutil` 小容量映像验证；Linux/Windows 无等价手段 | 跨平台模拟 ENOSPC 无可移植方案 |
| 2.5 跨平台一致 | 仅在 CI 三平台上验证；本地只有 macOS arm64 | 无本地跨平台环境 |
| 5.3 GC 不删使用中目录 | 只能验证「7 天内不删」与「keepDir 不删」，无法验证真实的跨进程占用 | 无跨进程引用计数（D-3） |
| 12.2 三场景磁盘 | Windows/Linux 数值需 CI 补测 | 同上 |

## 已知差异（相对改造前）

| # | 差异 | 影响 | 是否可接受 |
|---|---|---|---|
| D-1 | 解包树 89MB > `dist/` 85MB | dereference 复制了 `packages/*` 489 个文件 | 是；已计入 Req 12 磁盘账 |
| D-2 | 首次启动多出一次解包（PoC 热缓存 5.3s） | 首启变慢 | 是；加载页已存在，Req 10.3 只要求实测记录 |
| D-3 | GC 的「不删使用中目录」是启发式 | 极端情况（进程连续运行 >7 天）可能误删 | 是；已在设计与验收中如实标注，不声称强保证 |
| D-4 | 单产品用户磁盘占用上升约 13.5MB | 载荷 + 解包副本各存一份 | **由 Req 12.5 的 20MB 阈值裁定**；实测超阈值即停止 |
| D-5 | CLI 的 `distServerJs()` 由同步变异步 | 外部若有调用方会断裂 | 是；该函数仅被 `bin/pi-web.mjs` 自身与桌面壳（已弃用路径）消费；保留同步的 `distServerJs()` 作为分支 1/2 的实现细节 |
| D-6 | CLI 用 `createRequire` 而非 `await import(变量)` 载入解包器 | 看起来是倒退 | 是；`await import(<非字面量>)` 经 vite 的 ssrTransform 会产出 rollup 解析不了的代码（`Expected ident`），使 `test/cli/cli-args.test.ts` 整个套件无法收集。`@vite-ignore` 与包一层函数均无效；唯一不引入 `eval` 的出路是 `require`（Node ≥ 22.12 支持 `require(esm)`） |
| D-7 | 首次解包耗时由 5.6s 升至约 6s | 多了一次全树文件计数 | 是；换来「摘要正确但落盘不全」这一静默灾难的闸门 |
