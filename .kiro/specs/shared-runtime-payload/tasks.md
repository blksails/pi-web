# Implementation Plan — shared-runtime-payload

> **风险靠任务顺序控制**：原地替换契约、无并存期。阶段 4（CLI 端到端跑通解包）是首个闸门，**通过前不得动桌面壳**。阶段 9 是**可能的中止点**（Req 12.7）。
>
> **贯穿全程的实现陷阱**（design D-1~D-5 / research 已记录）：
> - 解包树是 **89MB / 9284 文件**（比 `dist/` 多 489 个），因为 dereference 复制了 `packages/*`。比对必须用 `find -L`（跟随符号链接），否则会像 PoC 首轮那样把正确的归档误判为损坏。
> - `rename(dir → 非空 dir)` 在 POSIX 报 `ENOTEMPTY`、Windows 直接失败 ⇒ 必须**先把旧目录移到 `.trash-*` 再 rename**。
> - `.ok` 必须是**最后一个写入**的条目；所有失败路径的共同后置条件是「不存在带 `.ok` 的 target」。
> - 桌面壳**不得**新增 Rust 归档/压缩 crate；只 spawn `node_bin unpack.mjs --json`，且**只解析 stdout 最后一行 JSON**，不解析人类可读文案。
> - `node_bin`（exe 同目录）/ `payload_dir`（resource_dir）/ `dist_root`（用户运行时目录）**三者来源不可混用**。
> - 既有 5 条 e2e 走「仓库内 `dist/` 优先」分支，零改动仍应通过——**它们也测不到解包路径**，不得据其绿灯宣称解包路径已验证。

## 1. 解包器纯函数内核

- [x] 1.1 建立 `src/runtime/unpack.src.mjs` 骨架与纯函数族
  - 实现 `runtimeDirName(version, digest)` → `"0.1.3-a1b2c3d4e5f6"`（取 digest 前 12 位）
  - 实现 `isRuntimeDirName(name)`：正则 `/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?-[0-9a-f]{12}$/`
  - 实现 `classifyFsError(err)`：`ENOSPC → disk-full`；`EACCES|EPERM|EROFS → runtime-root-unwritable`；其余 → `extract-failed`
  - 实现 `selectGcVictims(entries, keepDir, now)`：keepDir 永不入选；按 `.ok` mtime 降序保留最近 K=2；仅删 mtime 早于 7 天者；`.staging-*`/`.trash-*` 早于 1 小时、`.lock-*` 早于 10 分钟
  - 定义 `RuntimeError`（含 `code`）与 7 个错误码常量
  - 完成条件：文件存在且以上函数均被导出，`node -e` 可 import 并调用
  - _Requirements: 1.1, 1.3, 4.1, 4.2, 4.5, 5.2, 5.3, 5.6_
  - _Boundary: src/runtime/unpack.src.mjs_

- [x] 1.2 纯函数单测 `test/runtime-payload/unpack-pure.test.ts`
  - `isRuntimeDirName` **必须拒绝**：`Documents`、`.staging-abc`、`1.2.3-ABCDEF012345`（大写）、`1.2.3-abc`（位数不足）、`1.2-abcdef012345`（非 semver）
  - `isRuntimeDirName` 必须接受：`0.1.3-a1b2c3d4e5f6`、`1.0.0-beta.1-0123456789ab`
  - `classifyFsError` 五个分支各一例
  - `selectGcVictims`：keepDir 不入选 / 最近 2 个保留 / 未满 7 天不删 / 非法命名条目不删 / staging 与 lock 按各自年龄阈值
  - 完成条件：`pnpm vitest run test/runtime-payload/unpack-pure.test.ts` 全绿
  - _Requirements: 1.3, 4.1, 4.2, 5.2, 5.3, 5.6_
  - _Boundary: test/runtime-payload/unpack-pure.test.ts_
  - _Depends: 1.1_

## 2. 载荷生产线

- [x] 2.1 `tar` 入 devDependencies 并忽略生成物
  - `pnpm add -D -w tar`（已在调研中安装，确认 lockfile 落盘）
  - `.gitignore` 追加 `payload/`
  - 完成条件：`git status` 显示 `pnpm-lock.yaml` 变更且 `payload/` 不被跟踪
  - _Requirements: 2.1_
  - _Boundary: package.json, .gitignore_

- [x] 2.2 `scripts/pack-payload.mjs`：由 `dist/` 产出载荷与元数据
  - `tar.create({ cwd: repoRoot, follow: true, portable: true, noMtime: true }, ["dist"])` → `createZstdCompress({ params: { ZSTD_c_compressionLevel: 19 } })` → `payload/dist.tar.zst`
  - 流式计算 sha256；统计归档中的文件条目数
  - 写 `payload/payload.json`（schema/version/archive/compression/algorithm/digest/bytes/entries/root）
  - 缺少 `dist/server.mjs` 时报错退出，提示先跑 `pnpm build:dist`
  - 完成条件：对真实 `dist/` 跑一次，`payload/dist.tar.zst` ≈ 9.4MB，`payload.json` 的 `entries` = 9284
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - _Boundary: scripts/pack-payload.mjs_
  - _Depends: 1.1_

- [x] 2.3 `scripts/build-unpacker.mjs`：esbuild 打成零依赖单文件
  - `--bundle --platform=node --format=esm --target=node22` → `payload/unpack.mjs`
  - 完成条件：产物 ≈ 115KB；在**不含 `node_modules` 的目录**下 `node payload/unpack.mjs --help` 可运行
  - _Requirements: 2.1_
  - _Boundary: scripts/build-unpacker.mjs_
  - _Depends: 1.1, 2.1_

- [x] 2.4 串接构建脚本
  - `package.json` 新增 `build:unpacker`、`build:payload`；`build:dist` 末尾串接二者
  - 完成条件：`pnpm build:dist` 一条命令后 `payload/` 三件套齐备
  - _Requirements: 2.1, 11.1_
  - _Boundary: package.json_
  - _Depends: 2.2, 2.3_

- [x] 2.5 载荷格式的真实校验（一次性验证任务）
  - 解包 `payload/dist.tar.zst` 到临时目录，与 `find -L dist` 比对：文件数 9284、exec 数 39、符号链接数 0、相对路径集合 `diff` 零差异
  - 抽验 155 字符长路径条目非空；`server.mjs` 与 `jiti-cli.mjs` 的 sha256 与源一致
  - 完成条件：上述断言全部通过，输出贴入 `evidence/payload-format-verification.md`
  - _Requirements: 2.2, 2.3, 2.4, 2.5_
  - _Boundary: .kiro/specs/shared-runtime-payload/evidence/payload-format-verification.md_
  - _Depends: 2.2_

## 3. `ensureRuntime` 全语义

- [x] 3.1 摘要校验、staging 与原子落地
  - `ensureRuntime({payloadDir, runtimeRoot, lockWaitMs})`：读 `payload.json` → 算 target 名 → 命中 `.ok` 且 digest 匹配则 touch mtime 并返回 `unpacked:false`
  - 未命中：解包到 `.staging-<d12>-<pid>-<rand>`，**流式**校验 sha256；不匹配则删 staging 抛 `payload-corrupt`
  - `.ok` 最后写入；`target` 已存在则先 `rename(target → .trash-<rand>)` 再 `rename(staging → target)`，尽力删 trash
  - 入口处能力探测：`typeof createZstdDecompress !== "function"` → `zstd-unsupported`，文案含最低 Node 版本与当前版本
  - 完成条件：函数导出且对合成小载荷可跑通首解与命中两条路径
  - _Requirements: 1.4, 1.6, 2.6, 3.1, 3.2, 3.5, 4.3, 4.4, 4.5, 10.1_
  - _Boundary: src/runtime/unpack.src.mjs_
  - _Depends: 1.1_

- [x] 3.2 锁协议与并发互斥
  - `mkdir(.lock-<d12>)` 取锁；EEXIST 时以 250ms 轮询 `target/.ok`，超 `lockWaitMs`(120s) 抛 `lock-timeout`
  - 锁目录 mtime 早于 10 分钟判为陈旧，删除后重试取锁一次
  - 取锁成功后**重新检查** `.ok`（他人可能在取锁间隙完成）
  - 完成条件：单测模拟「锁已存在且 `.ok` 随后出现」→ 复用；「锁已存在且始终无 `.ok`」→ `lock-timeout`
  - _Requirements: 3.3, 3.6_
  - _Boundary: src/runtime/unpack.src.mjs_
  - _Depends: 3.1_

- [x] 3.3 `gcRuntimeRoot` 与 CLI 入口
  - `gcRuntimeRoot(runtimeRoot, keepDir)`：调 `selectGcVictims` 后逐个 `rm -rf`，**全部异常吞掉**并计入 `GcReport`
  - CLI 入口：`--payload-dir --runtime-root --json` 输出**恰好一行** JSON 到 stdout（诊断走 stderr），失败退出码 1；`--gc --runtime-root --keep <dirName>`
  - 完成条件：`node src/runtime/unpack.src.mjs --payload-dir <d> --json` 输出可被 `JSON.parse` 的单行
  - _Requirements: 3.3, 4.1, 4.2, 4.3, 5.1, 5.2, 5.4, 5.6_
  - _Boundary: src/runtime/unpack.src.mjs_
  - _Depends: 3.2_

- [x] 3.4 `ensureRuntime` 集成单测（合成小载荷）
  - `test/runtime-payload/ensure-runtime.test.ts`：构造含 1 个 exec 文件与 1 个 >100 字符路径的 3 文件小载荷
  - 用例：首解 `unpacked=true` → 二次 `unpacked=false`；删 `.ok` 后自愈重解；篡改归档一字节 → `payload-corrupt` 且**不留 `.ok`**；`chmod 555` runtimeRoot → `runtime-root-unwritable`
  - 完成条件：`pnpm vitest run test/runtime-payload/` 全绿
  - _Requirements: 1.2, 1.4, 2.3, 2.4, 2.6, 3.1, 3.2, 3.5, 4.1, 4.5_
  - _Boundary: test/runtime-payload/ensure-runtime.test.ts_
  - _Depends: 3.3_

## 4. CLI 接线（闸门：首个端到端跑通解包）

- [x] 4.1 `bin/pi-web.mjs` 三级解析与 async 化
  - 新增 `resolveRuntime()`：① `PI_WEB_DIST_DIR` 覆盖 → ② `PKG_ROOT/dist/server.mjs` 存在 → ③ 动态 `import("../payload/unpack.mjs")` 调 `ensureRuntime`
  - `distServerJs()` 降为分支 ①② 的实现细节（D-5）；`main()` 改 await
  - **不动** `buildEnv` / `isPortFree` / `findFreePort` / `waitForReady` / `launch` 的 cwd 语义
  - 解包失败：打印错误码对应的可读文案，退出码 1
  - 完成条件：仓库内 `pnpm build:dist` 后 `node bin/pi-web.mjs --help` 正常（走分支 ②，不解包）
  - _Requirements: 1.1, 1.5, 4.1, 4.2, 4.3, 4.4, 6.2, 6.4, 8.1_
  - _Boundary: bin/pi-web.mjs_
  - _Depends: 3.3_

- [x] 4.2 CLI 侧 GC 触发
  - `launch()` spawn 子进程**之后** fire-and-forget 调 `gcRuntimeRoot`，异常吞掉
  - 完成条件：`test/runtime-payload/cli-gc.test.ts` 5 绿。「解包器缺失」经**注入接缝**强制触发（否则在标准 `pnpm build:dist` 流程下 `payload/` 已存在，该用例会静默退化成另一个用例的重复）
  - _Requirements: 5.1, 5.4, 5.5_
  - _Boundary: bin/pi-web.mjs_
  - _Depends: 4.1_

- [x] 4.3 npm 分发形态
  - `package.json` 的 `files` 由 `["bin","dist","vite.config.ts"]` 改为 `["bin","payload","vite.config.ts"]`
  - 完成条件：`npm pack --dry-run` 的文件清单含 `payload/` 三件套且**不含** `dist/`
  - _Requirements: 7.1_
  - _Boundary: package.json_
  - _Depends: 2.4_

- [x] 4.4 重写 `e2e/cli-reloc.mjs` 为 npm 安装态模拟
  - 临时包根只放 `bin/` + `payload/`（**无 `dist/`**）；`PI_WEB_RUNTIME_ROOT` 指向另一个临时目录
  - 断言：确实发生解包（`unpacked` 路径被走到 / 运行时目录被创建）、真实会话跑通、运行时落在与构建目录无关的绝对路径
  - 完成条件：`node e2e/cli-reloc.mjs` 通过；这是 CLI 侧**唯一**覆盖解包路径的 e2e
  - _Requirements: 6.1, 6.2, 6.3, 8.4, 9.3, 9.4_
  - _Boundary: e2e/cli-reloc.mjs_
  - _Depends: 4.1, 4.3_

## 5. 桌面壳接线

- [x] 5.1 `types.rs`：`ServerSource` 判别式与 `UnpackError`
  - `ServerSource::Direct(PathBuf)` / `ServerSource::Payload { payload_dir: PathBuf }`
  - `ArtifactPaths.server_js` → `server_source`；新增 `UnpackError { code: String, message: String }`
  - 完成条件：`cargo check` 通过（下游编译错误由 5.2/5.3 修复）
  - _Requirements: 7.4_
  - _Boundary: desktop/src-tauri/src/types.rs_

- [x] 5.2 `resolve_artifact.rs` 改判别式 + 两条来源分离回归测试
  - Packaged → `Payload { payload_dir: resource_dir/payload }`；Unpackaged → `Direct(discover_cli_entry())`；Dev → `None`
  - **保留** `node_bin_comes_from_exe_dir_not_resource_dir`；**新增** `payload_dir_comes_from_resource_dir`
  - 完成条件：`cargo test resolve_artifact` 全绿，含两条来源分离断言
  - _Requirements: 7.3, 7.4, 8.2, 8.3_
  - _Boundary: desktop/src-tauri/src/resolve_artifact.rs_
  - _Depends: 5.1_

- [x] 5.3 `unpack_runtime.rs`：spawn、超时、单行 JSON 解析
  - `parse_ensure_output(stdout) -> Result<EnsureOk, UnpackError>` 为**纯函数**：取最后一非空行；非 JSON/空输出 → `extract-failed`
  - `ensure(node_bin, payload_dir, timeout_ms)` spawn `node_bin unpack.mjs --payload-dir … --json`，**继承 env**（`PI_WEB_RUNTIME_ROOT` 需可达）
  - `spawn_gc(node_bin, payload_dir, keep)`：detached，不等待
  - **不新增任何 Rust 归档/压缩依赖**
  - 完成条件：`cargo test unpack_runtime` 覆盖 ok / err / 空输出 / 多行取末行 / 垃圾输入五例
  - _Requirements: 4.6, 5.5_
  - _Boundary: desktop/src-tauri/src/unpack_runtime.rs_
  - _Depends: 5.1_

- [x] 5.4 `main.rs` 编排与错误页接线
  - `Payload` 分支调 `unpack_runtime::ensure` 取 `server_js`；失败经 `describe_*` 走**既有可重试错误页**（`show_startup_error`）
  - 后端就绪后 `spawn_gc`（在 `server_supervisor.start()` 返回之后）
  - 完成条件：`cargo build` 通过；**在真实 `.app` 上实测**——篡改 `Contents/Resources/payload/dist.tar.zst` 一字节后启动，进程 20s 内保持存活（停在可重试错误页而非静默退出），stderr 打印「无法准备运行时 / payload-corrupt / 请重新安装应用」，且运行时根下无任何带 `.ok` 的目录
  - _Requirements: 4.6, 5.1, 5.5, 6.2_
  - _Boundary: desktop/src-tauri/src/main.rs_
  - _Depends: 5.2, 5.3_

- [x] 5.5 `tauri.conf.json` 资源改为载荷
  - `resources`: `{"../../dist/": "dist/"}` → `{"../../payload/": "payload/"}`；`externalBin` **不动**
  - ⚠ `bundle.resources` 的路径在 **`cargo build` 期**即被 tauri-build 校验存在（electron-to-tauri 实测）⇒ 编译前必须先 `pnpm build:dist`
  - 完成条件：`cargo build` 通过且 `.app/Contents/Resources/payload/` 三件套齐备
  - _Requirements: 7.2, 7.3_
  - _Boundary: desktop/src-tauri/tauri.conf.json_
  - _Depends: 2.4, 5.4_

## 6. 打包态 e2e

- [x] 6.1 `e2e/desktop/shared.mjs`：临时 runtimeRoot 与载荷守卫
  - `ensurePrerequisites` 追加 `payload/` 三件套存在性守卫
  - 新增临时 `PI_WEB_RUNTIME_ROOT` 的创建与清理助手
  - 完成条件：`desktop-real.mjs` / `desktop-no-node.mjs` 仍全绿（它们走 Unpackaged 分支，不解包）
  - _Requirements: 8.2, 8.4, 9.1, 9.5_
  - _Boundary: e2e/desktop/shared.mjs_
  - _Depends: 4.3_

- [x] 6.2 更新 `e2e/desktop/desktop-packaged.mjs`
  - 断言 `Contents/Resources/payload/` 存在且 `Contents/Resources/dist` **不存在**
  - 设 `PI_WEB_RUNTIME_ROOT` 为临时目录；启动后断言运行时目录被创建、`.ok` 存在、`dist/node_modules` 非空
  - 跑真实会话；退出后端口释放、无孤儿进程
  - 完成条件：实跑 `tauri build --bundles app` 后 `node e2e/desktop/desktop-packaged.mjs` 通过；这是桌面侧**唯一**覆盖解包与 `resource_dir` 布局漂移的 e2e
  - _Requirements: 6.1, 6.3, 7.2, 8.4, 9.2, 9.5_
  - _Boundary: e2e/desktop/desktop-packaged.mjs_
  - _Depends: 5.5, 6.1_

## 7. 失败模式与并发 e2e

- [x] 7.1 `e2e/runtime-payload-concurrency.mjs`
  - 并发启动 N=4 个 `unpack.mjs --json` 打同一 runtimeRoot
  - 断言：全部退出码 0；恰好一个 `unpacked:true`；最终只有一个运行时目录且 `.ok` 存在；无 `.staging-*` / `.lock-*` 残留
  - 使用 **2.4 产出的真实载荷**（非合成小载荷），以覆盖真实解包耗时下的锁竞争
  - 完成条件：连续跑 3 次均通过（锁协议只有真并发能证伪）
  - _Requirements: 3.2, 3.3, 3.6_
  - _Boundary: e2e/runtime-payload-concurrency.mjs_
  - _Depends: 2.4, 3.3_

- [x] 7.2 `e2e/runtime-payload-recovery.mjs`
  - **中断**：解包中途 SIGKILL → 下次启动重新解包成功，无残留 `.ok`
  - **损坏**：target 存在但删掉 `.ok` → 自愈重解；篡改归档字节 → `payload-corrupt` 且不留 `.ok`
  - **只读**：`chmod 555` runtimeRoot → `runtime-root-unwritable`
  - **磁盘满**：macOS 用 `hdiutil create -size 20m` 小容量映像作 runtimeRoot → `disk-full` 且 staging 被清除；非 macOS 跳过并**如实登记盲区**
  - 「篡改归档字节」用例需要 **2.4 产出的真实载荷**；其余用例可用合成小载荷
  - 完成条件：四组用例通过（磁盘满在非 macOS 上打印跳过原因）
  - _Requirements: 3.4, 3.5, 4.1, 4.2, 4.3, 4.5_
  - _Boundary: e2e/runtime-payload-recovery.mjs_
  - _Depends: 2.4, 3.3_

## 8. 发布流水线

- [ ] 8.1 `desktop-release.yml` 改产出载荷工件
  - `build-dist` job：`pnpm build:dist` 后上传 `payload/`（非 `dist.tgz`）
  - 各平台矩阵下载 `payload/` 并**校验** `payload.json.digest` 与实际归档的 sha256 一致，不一致即 job 失败
  - `smoke` job：清空 runtimeRoot 后跑 `desktop-packaged.mjs`，强制经历一次真实首启解包
  - `release` job 仍 `needs: smoke`
  - 完成条件：**在真实 GitHub Actions 上跑通一次**
  - ⚠ 现状：工作流结构已自检（4 个 job 的 needs 链、release 的 tag 门控、smoke 含冷解包步骤均正确），
    `scripts/verify-payload.mjs` 已做正反两向验证（正常载荷通过 / 篡改一字节退出码 1）。
    但**从未在真实 GitHub Actions 上运行过**，也未在 Windows / Linux 上打包过。故不打勾。
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - _Boundary: .github/workflows/desktop-release.yml_
  - _Depends: 6.2_

## 9. 净收益实测与裁定（**可能的中止点**）

- [x] 9.1 `scripts/measure-payload-baseline.mjs`
  - 三场景磁盘：仅桌面版（`.app` + 运行时目录）、仅 CLI（`npm pack` 解包 + 运行时目录）、两者都装（共享一个运行时目录）
  - dmg 体积：`hdiutil create -format UDZO`，与改造前口径一致
  - 冷启动：首启（含解包）与稳态（命中 `.ok`）两组，口径沿用 `measure-desktop-baseline.mjs`（spawn → 后端首次响应 `GET /`）
  - 稳态冷启动必须 `--repeat N` 取中位数：单次噪声可达 ±400ms，用单次值裁定 200ms 预算等于掷硬币
  - 完成条件：脚本输出 JSON（含每轮原始值）与 `.log`，涵盖三场景磁盘、dmg、首启与稳态冷启动
  - _Requirements: 10.2, 10.3, 10.4, 12.1, 12.2, 12.3_
  - _Boundary: scripts/measure-payload-baseline.mjs_
  - _Depends: 6.2_

- [x] 9.2 阈值断言与裁定报告
  - 四条阈值以断言实现并输出 PASS/FAIL：dmg 降幅 ≥25%；**任一**单产品磁盘增量 ≤20MB；两者都装净省 ≥50MB；**稳态冷启动增量 ≤200ms（Req 10.2）**
  - 写 `evidence/payload-comparison.md`：改造前数值取自 `evidence/pre-spec-measurements.md`（同机同口径），改造后为本次实测
  - **若任一 FAIL：停止实现，在报告中写明裁定并交回决策者，不得默认继续**（Req 12.7）
  - 报告不得以「压缩后理论上更小」替代任何一项实测数值
  - 完成条件：报告存在且给出明确的 PASS/FAIL 裁定
  - _Requirements: 10.2, 12.4, 12.5, 12.6, 12.7, 12.8_
  - _Boundary: .kiro/specs/shared-runtime-payload/evidence/payload-comparison.md_
  - _Depends: 9.1_

## 10. 回归与收尾

- [x] 10.1 更新 `e2e/cli-smoke.mjs` 的产物断言
  - 保留既有 `dist/` 完整性清单（仓库态走分支 ②）；追加 `payload/` 三件套存在性断言
  - 完成条件：`node e2e/cli-smoke.mjs` 通过
  - _Requirements: 7.1, 8.1_
  - _Boundary: e2e/cli-smoke.mjs_
  - _Depends: 4.3_

- [x] 10.4 打包态「载荷损坏」的失败呈现 e2e
  - `e2e/desktop/desktop-corrupt-payload.mjs`：篡改真实 `.app` 内嵌载荷一字节后启动
  - 断言：进程不静默退出（停在可重试错误页）、错误码 `payload-corrupt`、给出「重新安装」、不留带 `.ok` 的目录、后端从未拉起
  - ⚠ 复制出的 `.app` **不能放在 `os.tmpdir()`**：那里 Tauri 的 `resource_dir()` 会失败，壳在触及载荷前就报错。已加前置断言防止该用例退化为「测了个寂寞」。改造前的 `.app` 在同一位置同样失败，故与本 spec 无关
  - 完成条件：8 项断言全绿
  - _Requirements: 4.5, 4.6_
  - _Boundary: e2e/desktop/desktop-corrupt-payload.mjs_
  - _Depends: 6.2_

- [x] 10.2 全量回归
  - `pnpm vitest run`（全量）、`cargo test`（desktop/src-tauri）
  - 5 条既有 e2e 零改动仍绿：`cli-smoke` / `cli-real` / `cli-watch` / `desktop-real` / `desktop-no-node`
  - 新增 4 条 e2e 绿：`cli-reloc` / `desktop-packaged` / `runtime-payload-concurrency` / `runtime-payload-recovery`
  - **不得据既有 5 条的绿灯宣称解包路径已验证**——它们走仓库 `dist/` 分支（已登记盲区）
  - 完成条件：以上全部通过，输出贴入实现总结
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - _Boundary: e2e/, test/_
  - _Depends: 7.1, 7.2, 8.1, 9.2, 10.1_

- [x] 10.3 文档与盲区登记
  - `scripts/pack-dist.mjs` 头部补注：它是载荷的唯一上游，符号链接由 `pack-payload` 展开
  - 在 spec 中登记自动化盲区：磁盘满（仅 macOS）、跨平台一致（仅 CI）、GC 不删使用中目录（启发式 D-3）、三场景磁盘的 Windows/Linux 数值
  - 完成条件：盲区表存在且与实际验证情况一致，不出现「已验证」与免责声明并存
  - _Requirements: 2.5, 5.3, 12.2_
  - _Boundary: .kiro/specs/shared-runtime-payload/tasks.md, scripts/pack-dist.mjs_
  - _Depends: 10.2_


## ⚠ 已知的自动化覆盖盲区（如实登记，不得据「测试全绿」推断已覆盖）

| 需求 | 盲区 | 原因 | 现状 |
|---|---|---|---|
| 11.1–11.5 | 发布流水线从未在真实 CI 上运行 | 无法本地触发 GitHub Actions | 仅结构自检；任务 8.1 未打勾 |
| 2.5 | 跨平台一致性（Ubuntu 构建 → Windows/Linux 解包） | 本地只有 macOS arm64 | 未验证 |
| 12.2 | Windows / Linux 的三场景磁盘与下载体积 | 同上 | 未验证；报告已声明「不得据此推断其他平台」 |
| 4.2 | 非 macOS 的磁盘满路径 | 无可移植的 ENOSPC 模拟手段 | `recovery.mjs` 在非 macOS 上打印跳过原因 |
| 5.3 | 「GC 不删正在被其他进程使用的目录」 | 跨进程无引用计数可用 | **启发式**（存活探测 + 7 天最小年龄 + 保留最近 K 个），见 design D-3。只验证了「7 天内不删」与「keepDir 不删」 |
| 1.6 / 3.3 | 跨主机共享盘上的锁语义 | 无 NFS/SMB 测试环境 | 依赖年龄阈值兜底，未验证 |

## 与本 spec 无关的既有缺陷（已在改造前的提交 `98e7e94` 上复现，不予修复）

| 位置 | 症状 | 证据 |
|---|---|---|
| `e2e/cli/cli-watch.mjs:71` | 断言英文标签 `Start session`，而 UI 默认 locale 为 zh（「开始会话」）。该行自 `377d237`(2026-06-24) 未变，早于 i18n 中文化 | 在 `98e7e94` 的干净 worktree 上复现同一失败 |
| Tauri `resource_dir()` | `.app` 位于 `os.tmpdir()`（macOS `/var/folders/<hash>/T/`）时解析失败，壳报「缺少资源目录」。`/private/tmp`、`$HOME`、`/private/var/tmp` 均正常 | 改造前的 `.app` 在同一位置同样失败 |
| `test/bash-route.integration.test.ts` | 全量 vitest 并行负载下 5s 超时（单独跑 3/3 通过） | 在 `98e7e94` 上跑全量同样失败 |
