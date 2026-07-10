# 迁移动机的实测验收报告

_spec `electron-to-tauri` 任务 8.2 — Req 11.1–11.6_

本报告以**实测数值**裁定迁移的两项动机（内存与启动开销、包体积）是否兑现。
不以「新方案理论上更轻」一类论证替代任何一项数值（Req 11.6）。

## 测量条件

| 项 | 值 |
|---|---|
| 平台 | macOS (Darwin 24.6.0)，Apple Silicon (`aarch64-apple-darwin`) |
| Electron 基线 | commit `5af999b`（本分支的 fork 基点），Electron `^43.0.0`，`electron-builder --mac --dir` |
| Tauri 侧 | 本分支，Tauri `2.11.5`，`tauri build --bundles app` |
| 两侧自包含产物 | 同一 `pnpm build:dist` 流程产出 |
| 测量脚本 | `scripts/measure-desktop-baseline.mjs`（两侧同一脚本、同一口径） |
| 原始数据 | `evidence/baseline-electron.json`、`evidence/baseline-tauri.json` |

**口径定义**（两侧完全一致）：

- **冷启动**：从进程 `spawn` 到**后端首次响应 `GET /`**。衡量「壳把后端拉起来并可用」的必经路径；不依赖 WebDriver（macOS 无 Tauri WebDriver）。
- **空闲常驻内存**：启动 → 后端就绪 → 空闲 30 秒 → 汇总**应用进程树全部进程**的 RSS。测整棵树而非主进程，否则会系统性低估 Electron（其渲染进程往往是内存大头）。
- **包体**：`.app` 目录实际字节数（`du -sk`）。

## 结果

| 指标 | Electron | Tauri | 变化 |
|---|---:|---:|---:|
| **冷启动至后端可用** | 5751 ms | **1756 ms** | **−69.5%** |
| **空闲常驻内存（进程树）** | 760.7 MB（6 进程） | **361.5 MB**（3 进程） | **−52.5%** |
| **安装包体积（.app）** | 788.5 MB | **275.7 MB** | **−65.0%** |

### 包体拆解（Req 11.4：显式计入随包 JS 运行时）

| 组成 | Electron | Tauri |
|---|---:|---:|
| 壳运行时 | Electron Framework **274.5 MB** | 随包 Node **85.6 MB** |
| 壳本体 | （含于 Framework 及 Helper） | **约 5.1 MB** |
| 随包自包含产物 `dist/` | 198.7 MB | 185.0 MB |
| 其余（Helper、资源、签名等） | 约 315.3 MB | 约 0 |
| **合计** | **788.5 MB** | **275.7 MB** |

- 扣除两侧都有的 `dist/` 后，**壳部分**为 Electron 589.8 MB vs Tauri 90.7 MB（**−84.6%**）。
- 随包 Node 二进制贡献 85.6 MB（已 `strip`，未 strip 为 106.5 MB）。这是本迁移为保住「无系统 Node 可用」保证所付出的体积代价，已计入上表。
- Electron 侧 `dist/` 略大（198.7 vs 185.0 MB），源于 `electron-builder.yml` 为绕开「`node_modules` 被剥空」的坑而**显式重复列入**该目录一次。这部分冗余不应记作 Tauri 的功劳。

### 内存拆解

| 进程 | Electron | Tauri |
|---|---:|---:|
| 壳主进程 | `pi-web` 152.8 MB | `pi-web` 75.6 MB |
| 渲染 / WebView | Helper (Renderer) 147.1 MB | *见下方说明* |
| 其他 Helper（GPU / Utility） | 40.1 + 83.1 MB | — |
| 后端 `server.mjs` | 151.4 MB（Electron-as-Node） | 137.0 MB（随包 node） |
| pi runner | 186.3 MB | 148.9 MB |
| **合计（进程树）** | **760.7 MB** | **361.5 MB** |

## 测量偏差的诚实声明

**该内存对比对 Tauri 有利，存在一处系统性偏差，必须指出：**

macOS 上 Tauri 的 WebView 由系统 WebKit 的 XPC 服务托管（`com.apple.WebKit.WebContent` / `.GPU` / `.Networking`），这些进程**不是应用的子进程，因而不在其进程树内**，故未被计入上表的 361.5 MB。Electron 的渲染进程则是其亲子进程，被完整计入。

实测：启动 pi-web 后系统中新增的 WebKit 相关进程约 **36.8 MB**（GPU 服务）。即便按保守上界 **+90 MB** 计入，Tauri 侧仍为约 **451 MB**，相对 Electron 的 760.7 MB 仍有 **−41%** 的优势。**结论方向不因该偏差而改变。**

（该偏差无法通过进程树遍历消除，因为系统 WebKit 进程可能同时服务其他应用；上述数值取自「启动前后系统进程差集」，已尽量排除干扰。）

## 阈值裁定（Req 11.5）

design 规定的裁定阈值：以 **macOS arm64 安装包**为基准，若

> `tauri_size > electron_size × 0.75` → 判定「净收益不显著」→ **停止并交回决策者**

实测：

```
tauri_size / electron_size = 275.7 / 788.5 = 0.3496
0.3496 ≤ 0.75  →  达标
```

**裁定：三项动机全部大幅兑现，迁移继续。** 无需交回决策者重新裁定。

- 包体积：**省 512.8 MB（65.0%）**，远优于 25% 的最低期望。
- 空闲内存：**省 399.2 MB（52.5%）**；即便计入未被统计的系统 WebView 进程，仍省 ≥41%。
- 冷启动：**快 3995 ms（69.5%）**，从 5.75 秒降至 1.76 秒。

## 尚未覆盖的平台

本报告仅覆盖 **macOS arm64**。Windows 与 Linux 的三项数值需在对应平台或 CI 上实测后补入，本分支未做，**不得据本报告推断其他平台的收益**（Req 11.3 要求三平台数值；见任务 6.2 / 7.1 的状态说明）。
