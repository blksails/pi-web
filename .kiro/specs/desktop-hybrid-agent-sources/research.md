# Research Log — desktop-hybrid-agent-sources

## Discovery Scope

- 类型：既有系统扩展（agent-source-list + desktop-cloud-login + 云端 capabilities）
- 深度：integration-focused（light full 混合）
- 日期：2026-07-24

## Key Findings

### 1. 本地列表已就绪

- `ScanSourceProvider` 扫描一级子目录 + `probeEntry`。
- `resolveSourcesScanRoots`：未设 `PI_WEB_SOURCES_ROOT` → **`~/.pi-web/agents`**。
- 本地 `RegistrySourceProvider` 读 `sources.json`（文件登记，`origin: "registry"`）。
- `CompositeSourceProvider` 现为**二元**（registry ∪ scan），registry 优先去重。
- `createAgentSourcesRoutes({ provider? })` 已支持注入整包 provider。

### 2. 云端授予已就绪（pi-clouds）

- `POST /api/desktop/capabilities`（spec `desktop-capabilities-endpoint`，已 implemented）：
  - 鉴权：桌面凭据 Bearer
  - 返回 `StaticCapabilitySnapshot`：`tenant` + **`sources: { baseUrl, token, expiresAt }`** + 可选 egress
  - `sources.token` = `signConsumeToken(companyId)`（短期 HMAC）
  - `sources.baseUrl` = `PI_CLOUDS_REGISTRY_HTTP_BASE_URL`
- Registry `GET /sources` + consume token → 可见 `SourceSummary` 列表
- 云宿主 `RegistryAgentSourceProvider` 是**进程内** RegistryApi，桌面不能复用，需 HTTP 版

### 3. 桌面登录已就绪（pi-web）

- `AuthSessionState`：进程内凭据 + `currentCredential()` / `isValid()` / `snapshot()`
- 凭据形态：`base64url(JSON).HMAC`；本仓只解析 payload，验签在云端
- UI：`use-desktop-auth` + keychain bridge

### 4. 集成设计既有提案

- `docs/desktop-cloud-integration-design.md` §6.3：
  - 未登录：sources.json ∪ 扫描
  - 已登录：sources.json ∪ **云 registry** ∪ 扫描
  - 新增 `RegistryHttpSourceProvider`；**不**引入 `@pi-clouds/registry-client` 到 server 主路径
  - Composite 扩可变参数；勿改 `compareAgentSourceRecords` 语义

### 5. 风险与张力

| 风险 | 处置 |
|---|---|
| 线上失败拖垮 `/agent-sources` | 云 provider fail-soft → `[]` |
| token 落盘 | 仅内存缓存至 expiresAt |
| origin 只有 `scan`\|`registry` | 云与本地文件登记共用 `registry`；去重靠 id + 合并顺序 |
| 线上源选中不可跑 | P1 明确非目标；P2 另开 |
| 分页比较器漂移 | 禁止改 compare 语义 |
| registry-client 进 server | 手写 fetch |

## Architecture Pattern Evaluation

| 方案 | 结论 |
|---|---|
| A. 注入 hybrid `AgentSourceProvider` | **采用** — 接缝已有 |
| B. 前端分别打本地 + 云 API | 否 — 破坏单一端点与分页 |
| C. 云列表代理到 pi-web 新路由 | 否 — 重复 `/agent-sources` |
| D. 引 registry-client | 否 — 构建/依赖风险 |

## Decisions Recorded for Design

1. Hybrid = N-way composite：HTTP 云（登录时）+ 本地文件 registry + scan
2. Grant：`POST capabilities` with desktop credential；内存缓存
3. 投影：`source = id@stable`，滤 plugin
4. P1 = 列表 only
