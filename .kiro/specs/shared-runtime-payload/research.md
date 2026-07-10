# Research & Design Decisions

## Summary

- **Feature**: `shared-runtime-payload`
- **Discovery Scope**: Extension（既有系统的产物分发与定位契约改造）
- **Key Findings**:
  1. **dmg 本身就是压缩格式（UDZO）**。现状 176MB 的 `.app` 做成 dmg 只有 **80.7MB**，其中 dist 早已被压到 ~15MB。因此「压缩载荷」的下载收益是 −32.7%（gz）而非「85→15.7MB」暗示的量级。这直接决定了 Req 12 的阈值只能定在 25% 而非某个乐观数字。
  2. **dereference 会让解包树比源树大 4MB**。`dist/node_modules/@blksails/pi-web-*` 的 11 个符号链接展开后，`dist/packages/*`（3.3MB / 489 个文件）被复制一份，解包结果是 **89MB** 而非 85MB。这笔账必须计入 Req 12 的磁盘对比，否则会高估收益。
  3. **PoC 证明 `tar` + `node:zlib` zstd + esbuild 组合可行**，且能一次性满足三个硬约束（dereference / 可执行位 / 155 字符长路径）。打包产物 115KB，零运行时依赖。

## Research Log

### 归档与压缩方案的可行性（PoC）

- **Context**: Node 无内置 tar 读写。载荷必须在 Ubuntu 上构建一次分发到三平台，且必须 dereference（否则 Windows 解包重演既有的 realpath EPERM 坑）、保留 38 个文件的可执行位、承载 155 字符的相对路径（超 ustar `name` 字段 100 字符上限）。
- **方法**: 写 `poc-payload.mjs`，用 esbuild 打成单文件后，在**无 `node_modules` 的目录**下运行，对真实的 85MB `dist/` 完成打包 → 解包 → 逐项比对。
- **Findings**:
  - esbuild `--bundle --platform=node --format=esm` 把 `tar@7.5.19` 打成 **115KB** 单文件，脱离 `node_modules` 可直接运行。
  - `tar.create({ follow: true })` 正确展开全部 11 个符号链接；解包树中符号链接数为 **0**。
  - `createZstdCompress()` / `createZstdDecompress()` 与 tar 流管道对接无碍。
  - 解包后相对路径集合与源树（`find -L`，即跟随符号链接）**完全一致**：9284 个文件，`diff` 零差异。
  - 可执行位保留：源（跟随链接）39 个 ↔ 解包 39 个。
  - 155 字符长路径条目存在且内容非空；`server.mjs` 与 `jiti-cli.mjs` 的 sha256 与源一致。
- **一个被 PoC 纠正的错误**: 首轮比对报「文件数 8795 vs 9284、exec 38 vs 39」，看似归档损坏。实为**比对方法错误**——`find -type f` 不计符号链接，而 dereference 后目标内容成为实体。正确的不变式是「解包树 == 源树跟随符号链接后的集合」。若当时据此否决 `follow: true`，会误杀正确方案。
- **Implications**: 采用 `tar` + zstd + esbuild。解包树 89MB（含 3.3MB 重复）写入 Req 12 的磁盘账。

### 压缩级别的取舍

- **Context**: zstd 级别直接换算为「每次下载的字节」与「每次 CI 构建的秒数」。
- **实测**（真实 85MB `dist/`，同机）：

  | 级别 | 载荷 | 打包耗时 |
  |---:|---:|---:|
  | 3（默认） | 13.2 MB | 1.2 s |
  | 10 | 10.4 MB | 2.0 s |
  | **19** | **9.4 MB** | **21.0 s** |

- **Decision**: 取 **19**。19 秒是每次发布构建的一次性成本，1MB 是每次用户下载的重复成本。解压耗时与级别基本无关（zstd 的非对称特性），故不影响首启预算。

### zstd 的运行时可用性

- **Context**: `node:zlib` 的 zstd 流 API 自 Node 22.15.0 起可用（v23.8.0 引入后回移）。若用户 node < 22.15，`createZstdDecompress` 为 `undefined`，会以晦涩的 `TypeError` 崩溃。
- **Findings**: 根 `package.json` 已声明 `engines.node >= 22.19.0`；实测宿主 node v22.22.0 与随包 sidecar node v22.22.0 均提供 `createZstdCompress` / `createZstdDecompress`。`zlib.constants.ZSTD_c_compressionLevel = 100`，默认级别 3。
- **Implications**: 桌面版恒用随包 sidecar node，永不触发该风险；仅 CLI 在用户 node 上运行。选 zstd（省 3.8MB / 每份载荷 vs gzip），并在解包器入口做能力探测，抛出指明最低 Node 版本的可读错误（Req 4.4）。gzip 方案被否决：它用 3.8MB 的永久双存储换一个 `engines` 已经排除的场景。

### 单一解包实现 vs Rust 侧重写

- **Context**: 桌面壳是 Rust，CLI 是 Node。两侧若各写一份解包逻辑，必然漂移。本仓已有前车之鉴：就绪探针的语义靠 design 里的一张对照表在 `bin/pi-web.mjs` 与 `ready_probe.rs` 之间强行同步。
- **候选**:
  - (A) Rust 用 `tar` + `zstd` crate 重写一份。
  - (B) 桌面壳用**随包 sidecar node** 执行同一个 JS 解包器，Rust 只负责 spawn、超时与错误分类。
- **Decision**: **(B)**。
  - 解包语义（目录命名、`.ok` 标记、锁协议、损坏判定、GC 命名形态守卫）是本 spec 的核心复杂度所在，只应存在一份。
  - 桌面壳**已经**必须持有 `node_bin`（用来拉起后端），复用它零新增依赖。
  - 失败以判别式错误码经单行 JSON 回传，Rust 映射到既有的可重试错误页（Req 4.6），与现有 `ServerStartError` 的判别式风格一致。
  - 代价：多一次进程启动（实测 node 冷启 ~40ms），可忽略。
- **被否决的理由**: (A) 会把「锁超时该等多久」「什么算损坏」这类判断复制两份，且 Rust 侧无法被 vitest 覆盖，只能靠 e2e 间接验证。

### 现有 `cli-reloc.mjs` 的新语义

- **Context**: 它原本把整棵 `dist/` tar 到临时目录、藏起原构建目录后运行，用以证明「构建期绝对路径未被烤进 bundle」（Req 9.4）。新契约下 npm 包不再含 `dist/`。
- **Findings**: 这条测试的检验力恰好可以**升级**——模拟 npm 安装后的包根（只有 `bin/` + `payload/`，无 `dist/`），把 `PI_WEB_RUNTIME_ROOT` 指向临时目录，则一次运行同时覆盖：首启解包路径、运行时落在与构建目录完全无关的绝对路径、真实会话可用。
- **Implications**: 它从「重定位测试」变成「npm 安装态端到端测试」，检验力严格增强，且是 CLI 侧唯一覆盖解包路径的 e2e。

### 解析顺序的向后兼容

- **Context**: 若 CLI 与桌面壳在仓库中也走解包，开发迭代与既有 e2e 都会被拖慢并污染 `~/.pi/web`。
- **Decision**: 两侧都保留「仓库内已构建的 `dist/` 优先」这一分支。
  - CLI：`PI_WEB_DIST_DIR` 覆盖 → `PKG_ROOT/dist/server.mjs` 存在 → 否则解包。
  - 桌面壳：dev 不拉后端 → unpackaged 走既有 `discover_cli_entry` 上溯 → packaged 才解包。
- **Implications**: `cli-smoke` / `cli-real` / `cli-watch` / `desktop-real` / `desktop-no-node` **无需改动即继续通过**，因为仓库里有 `dist/`。解包路径由 `cli-reloc`（重写）与 `desktop-packaged`（更新）两条 e2e 覆盖。这也意味着**解包路径的回归只会被这两条抓到**，须在 Testing Strategy 中明确标注。

### GC 的固有局限

- **Context**: Req 5.3 要求「不删正在被其他进程使用的目录」，但跨进程无引用计数可用。
- **Findings**: 可用的近似是「每次成功解析时 touch `.ok` 的 mtime」→ 正在被使用的目录 mtime 必然新鲜。配合「只删 mtime 早于 7 天且非当前目录」与「保留最近使用的 K 个」，可把误删窗口压到「某进程持续运行超过 7 天且期间从未重启」。
- **Implications**: 这是**启发式而非保证**，design 必须如实标注为已知局限（D-3），不得声称满足了强不变式。另有兜底：POSIX 上删除已被打开的文件不影响运行中的进程；Windows 上删除会失败，而 GC 失败一律吞掉（Req 5.4）。

## 设计决策一览

| # | 决策 | 取舍 | 被否决的选项 |
|---|---|---|---|
| D-1 | 归档用 npm `tar`，经 esbuild 打成零依赖单文件 | 成熟实现覆盖长路径 / 可执行位 / 跨平台；避免手写 ustar 的静默截断风险 | 自研最小 ustar 读写器（静默损坏风险与 Req 6.3 的「静默失败」正面冲突）；外壳调系统 `tar`（Windows 上 `tar.exe` 行为与 gz/zstd 支持不可控） |
| D-2 | 压缩用 zstd 级别 19 | 9.4MB，比 gzip 省 3.8MB 永久双存储 | gzip（省心但更大）；zstd 级别 3（省 20s 构建，多 3.8MB 下载） |
| D-3 | 解包器单一 JS 实现，桌面壳用 sidecar node 执行 | 语义只有一份；复用已有的 `node_bin` | Rust 侧 `tar`/`zstd` crate 重写（双份语义必然漂移） |
| D-4 | 运行时目录名含载荷摘要前 12 位 | dev 反复重建 `dist` 时同版本内容不同，无摘要会永久命中陈旧运行时 | 仅用 version（陈旧命中）；用内容树摘要（需 hash 9284 个文件） |
| D-5 | 原子落地 = staging + 先把旧目录移开再 rename | POSIX/Windows 上 rename 到非空目录一律失败，先移开是唯一跨平台一致的路径 | 直接 rename 覆盖（两平台都失败）；逐文件覆盖（无原子性） |
| D-6 | 锁用 `mkdir` 的原子性 + 陈旧锁超时 | 无需额外依赖，POSIX/Windows 语义一致 | `O_EXCL` 文件锁（残留清理同样复杂）；无锁并发解包（浪费 IO 且 rename 竞争） |
| D-7 | 仓库内 `dist/` 优先，dev/unpackaged/e2e 不解包 | 既有 5 条 e2e 零改动继续通过；开发迭代不被拖慢 | 一律解包（污染 `~/.pi/web`，拖慢迭代） |
| D-8 | GC 为启发式（mtime + 保留 K + 最小年龄 + 命名形态守卫） | 无跨进程引用计数可用 | 引用计数/PID 文件（进程崩溃后残留，反而更糟） |

## 风险

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R-1 | 解包路径仅被 2 条 e2e 覆盖（`cli-reloc` / `desktop-packaged`） | 回归可能只在发布态暴露 | 二者均纳入 CI；`desktop-release.yml` 的 smoke 强制经历一次真实首启解包（Req 11.4） |
| R-2 | GC 误删正在使用的旧版本目录 | 运行中的旧实例崩溃 | 7 天最小年龄 + 每次解析 touch `.ok` + 保留最近 K 个；失败一律吞掉。**如实标注为启发式** |
| R-3 | 磁盘满 / 无写权限的失败路径难以跨平台自动化 | Req 4.1 / 4.2 可能只有手工验证 | macOS 上用 `hdiutil` 小容量磁盘映像 + `chmod 555` 覆盖；其余平台标注为盲区 |
| R-4 | 单产品磁盘增量（+13.5MB）逼近 20MB 阈值 | Req 12.5 可能不通过 | 阈值判定以**实测**为准；不达标即按 Req 12.7 停止并交回决策者 |
| R-5 | 首启解包耗时（PoC 实测 5.3s，热缓存）计入首次冷启动 | 用户首次启动明显变慢 | 加载页已存在；Req 10.3 只要求实测并记录，不设硬上限 |
| R-6 | `.app` 内的载荷与 `~/.pi/web` 内的解包副本各存一份 | 单产品用户磁盘变差 | 这是本方案的固有取舍，已由 Req 12.3/12.5 正面裁定 |
