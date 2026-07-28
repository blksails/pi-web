# Implementation Plan

> P1：桌面 hybrid agent source 列表（线上凭证 → capabilities → registry ∪ 本地 `~/.pi-web/agents`）。  
> 范围铁律：不实现线上源自动 install/建会话；不改 `compareAgentSourceRecords` 语义；token 不落盘；不引 `@pi-clouds/registry-client` 进 server 主路径。

- [x] 1. Composite 扩展为 N 路 provider
  - 将 `createCompositeSourceProvider` 改为接受可变数量的 `AgentSourceProvider`（或 `providers: readonly AgentSourceProvider[]`），保持「先注册优先、按 id 去重、最后 `compareAgentSourceRecords` 排序」与每路 `safeList`。
  - 二元调用 `createCompositeSourceProvider(registry, scan)` 行为与今日逐断言等价（回归既有 composite 测试）。
  - 观察性完成态：新增三路去重用例（同 id 保留第一路）；既有 binary 用例全绿。
  - _Requirements: 2.3, 6.3_
  - _Boundary: composite-provider_

- [x] 2. RegistryHttpSourceProvider (P)
  - 新建 `registry-http-provider.ts`：`getGrant()` 无授予 → `[]`；有授予则 `GET {baseUrl}/sources`（Authorization Bearer token），投影为 `AgentSourceRecord`（`source=id@stable`、`origin:"registry"`、`kind:"dir"`、`mode:"cli"`、name/title←displayName），过滤 `kind==="plugin"`。
  - 网络/非 2xx/解析失败：log 不含 token → 返回 `[]`（不抛）。
  - `fetchImpl` 可注入；导出经 `agent-source-list/index`。
  - 观察性完成态：单测覆盖成功投影、plugin 过滤、401/网络 → `[]`、无 grant 不发请求。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.2_
  - _Boundary: registry-http-provider_

- [x] 3. DesktopCapabilitiesClient 与 grant 缓存 (P)
  - 新建 `auth/desktop-capabilities-client.ts`：`getSourcesGrant()` 读 `getDesktopCredential()`；无/无效 → `undefined`；`POST capabilitiesUrl` Bearer 桌面凭据；解析 `sources: { baseUrl, token, expiresAt }`；内存缓存至到期前偏斜刷新；401/403 清缓存；5xx/网络 → `undefined`。
  - 禁止将 token/凭据写入文件或 logger 参数。
  - 观察性完成态：单测覆盖命中缓存、过期重拉、401 清缓存、缺 sources 字段 → undefined。
  - _Requirements: 2.1, 4.1, 4.2, 4.3, 4.4, 5.1, 5.3, 8.1_
  - _Boundary: desktop-capabilities-client_

- [x] 4. 装配 hybrid provider 到 agent-sources 路由
  - 在 `lib/app/pi-handler.ts`（及任何并行装配点）构造：`httpReg`（绑 `authSessionState` + capabilities client）+ 本地 file registry + scan（`resolveSourcesScanRoots`，默认 `~/.pi-web/agents`）。
  - `createCompositeSourceProvider(httpReg, fileReg, scan)` 注入 `createAgentSourcesRoutes({ provider: hybrid, ... })`。
  - capabilities URL：`PI_WEB_CLOUD_CAPABILITIES_URL` 或由既有云登录配置推导；无法推导时 http 路恒空（仅本地）。
  - 未启用云登录时不强制挂载 http 路（或 getGrant 恒 undefined），行为=今日本地。
  - 观察性完成态：装配后未登录列表与改前一致（夹具扫描根）；代码路径可读且 typecheck 绿。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.4, 2.5, 6.1, 8.2, 8.3_
  - _Boundary: pi-handler assembly_
  - _Depends: 1, 2, 3_

- [x] 5. 登录态变化与列表一致性
  - 确认登录成功/登出后前端会重拉 `/agent-sources`（复用既有 picker refresh / auth hook）；若缺口则在登录/登出成功回调触发既有 refresh 信号（最小改动，不新造 SSE）。
  - 登出后服务端 `getGrant` 无凭据 → 列表无纯线上 id。
  - 观察性完成态：集成或组件级测试/手动清单：登录前后列表 diff 符合 Req 2.5。
  - _Requirements: 2.5, 6.4_
  - _Boundary: auth UI / picker refresh_
  - _Depends: 4_

- [x] 6. 垂直验证与安全烟雾
  - `packages/server` 相关单测全绿；typecheck 0。
  - 可选 e2e/node：mock capabilities + registry + 临时 sources root，断言并集与 fail-soft。
  - 确认默认扫描根文档/注释仍指向 `~/.pi-web/agents`；P1 不声称线上源可建会话（Req 7）。
  - 观察性完成态：测试计数 + 简短 verification 笔记（可写在 tasks 勾选备注或 `verification/`）。
  - _Requirements: 5.1, 5.4, 6.2, 6.3, 7.1, 7.2, 7.3_
  - _Depends: 4, 5_

## Validation (validate-impl · 2026-07-27 · DECISION: GO)

特性级终验通过，`phase` → `implemented`。代码见 `01df222`。**覆盖 21/21 条验收准则、8/8 条需求。**

- **机械检查**：全仓 14 包 `pnpm -r run test` EXIT=0（0 FAIL）；TBD/TODO CLEAN；硬编码密钥 CLEAN。
- **运行时烟雾**：真实 server 启动后 `GET /api/agent-sources` → 扫描根不存在时 200 空列表不报 500（Req 1.3）；根指向 `examples/` 时产出 5 条 `origin:"scan"` 且字段形状合规（Req 6.2）；未登录态**不发** capabilities 请求（Req 2.4）。
- **边界审计 CLEAN**：`@pi-clouds/registry-client` 零真实 import（范围铁律成立）；新增代码零 `install/resolve/spawn`（无 P2 越界，Req 7）；装配序 `[registryHttp, fileRegistry, scan]` 合设计；推导不出 capabilities URL 时退化为二元 composite 而非挂空壳（`pi-handler.ts:844`）。
- **最高风险项 Req 2.5 已清**：grant 缓存**与凭据绑定**，`desktop-capabilities-client.ts:134-138` 在**读缓存之前**先验凭据（缺失即清并返回 undefined），故缓存不可能活过凭据 —— 不依赖调用方记得调 `clearCache()`。
- **Req 5.4 静态证明**：线上三路（registry-http / capabilities-client / composite）**零个**文件写入或删除操作，线上失败不可能改动本地源。
- **Req 6.3 机制可证**：keyset 游标载荷即排序键三分量，与列表**共用同一全序比较器**（origin→name→id，`name` 固定 `"en"` locale 防跨环境漂移）。

⚠ **Warning（不阻断）**：hybrid 并集下的**跨页分页无专门回归测试** —— 排序有 `composite-provider.test.ts:51`、分页有 `agent-sources-routes` 8 例，但缺「第 1 页含 registry 项、第 2 页含 scan 项」这类跨源翻页用例。判为测试覆盖薄弱而非缺陷，建议接 P2 时补。

📌 **流程记录**：本次派出的三个并行验证子代理**均未交件**（反复进入空闲却不返回结构化结果，催两轮无效），上述结论全部由主上下文独立取证，未采信任何未经核实的转述。

## Implementation Notes

- **合并顺序**：`[httpReg, fileReg, scan]` — 云优先，再本地登记，再扫描。
- **与云内 provider 差异**：云只有 registry 一路故 listSources 失败 rethrow；桌面 hybrid 必须 fail-soft。
- **source settings resolver**：P1 保持 file+scan，不把 `id@channel` 当本地包根。
- **Channel**：默认 `stable`，与 pi-clouds `RegistryAgentSourceProvider` 一致。
