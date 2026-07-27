# Brief: desktop-online-source-runnable

> Discovery 日期:2026-07-27 · Path C(新建单一 spec)· 上游 `desktop-hybrid-agent-sources`(P1,已 `implemented`)

## Problem

桌面用户登录后已经**能在选择器里看见**线上 registry 的 agent(P1 交付),但**选中它什么也跑不起来** —— P1 的 Req 7 明确只承诺「能看见」,不承诺「能直接跑」。用户看到一个可选项却无法使用,是个悬空的半成品体验:要真正用上云端分发的 agent，今天仍得离开界面手动 `pi-web install`。

## Current State

**已经具备的(本 spec 不重造)**：

- `server/cli/install/registry-install.ts:120` `installFromRegistry(port, sourceId, {channel, version, targetDir})` —— 完成度很高：resolve → **经 registry 代理下载**（安装侧不接触 OSS 凭据）→ staging 解包 → sha384 **逐项完整性复核** → 失败**回滚**（删 staging）/ 成功**原子移入** targetDir → 写回执 `.pi-web-registry.json`（记 `sourceId`/`version`/`channel`/`pinnedVersion`）。只处理 `oss` origin。归属 spec `cli-package-commands` 任务 9。
- `server/cli/registry/http-registry-adapter.ts` `HttpRegistryAdapter implements RegistryPort` —— 自持 baseUrl + **消费面 `consumeToken`**（`resolve` 用），token 不外泄给上层。
- P1 的 `DesktopCapabilitiesClient.getSourcesGrant()` 正好产出 `{ baseUrl, token }`（短期 consume 授予，内存缓存、与凭据绑定）。
- P1 的默认扫描根 `~/.pi-web/agents`；本地目录源建会话通路既有且 P1 Req 7.2 保证未变。

**缺口**：没有任何东西把「线上条目被选中」这件事接到上面这条链上。

## Desired Outcome

桌面已登录用户在选择器中选中一个线上源后，系统在**同一次建会话请求内**完成安装并进入会话；失败时给出结构化错误且不留下半成品目录。装完的源成为本机资产 —— **离线后仍可继续使用**。

## Approach

**装进扫描根，复用本地源通路**（用户 2026-07-27 拍板）：

```
选中 acme/canvas@stable
  ↓ P1 的 grant（baseUrl + consumeToken）
  ↓ HttpRegistryAdapter（消费面）
  ↓ installFromRegistry(targetDir = <扫描根>/<目录名>)
  ↓ 完整性复核 + 原子落盘 + 写回执
  ↓
成为一个普通的本地扫描源 → 既有建会话通路照常接手
```

**为什么选它**：零新增运行时概念 —— 装完之后「线上源」不再是特殊物种，重启、离线、建会话、resolver 全部走既有本地目录源路径，不需要为云端源新造一条 spawn 通路。代价是占磁盘、以及需要处理同名覆盖与后续卸载（卸载留给后续 spec）。

**反馈形态**：同步等待 + 结果态（用户拍板）。建会话请求内同步完成安装，成功即进会话，失败返回结构化错误。与既有 `/install` 命令的同步语义一致，不新增 SSE 帧类型与前端状态机。

## Scope

- **In**：
  - 由 P1 grant 构造消费面 registry 端口
  - 选中线上源 → 安装到扫描根 → 建会话，端到端打通
  - 目录命名与同名/重装的确定性行为
  - **装后列表去重**（见下方 Boundary Candidates 的 ★ 项）
  - 结构化失败态（resolve/下载/解包/完整性/落盘 各阶段可区分）
  - 未登录 / grant 失效 / 非 `oss` origin 的明确拒绝行为
- **Out**：
  - 更新（`pi-web update` 的 registry 通道对齐）、卸载、版本切换、已装版本展示 —— 后续 spec（回执机制已就绪，接得上）
  - 安装进度条、重试 UI、「可运行/需安装」徽标、版本选择器等完整前端形态
  - plugin kind（P1 已在列表侧过滤 plugin，本 spec 维持）
  - `git` / `npm` origin 的安装（既有 AgentInstaller 直连路径，不经代理，不在本 spec）
  - pi-clouds 侧任何改动

## Boundary Candidates

- **grant → RegistryPort 适配**：把 P1 的 `{baseUrl, token}` 变成一个消费面 `RegistryPort`。天然接缝，可独立实现与测试。
- **安装编排**：调用 `installFromRegistry` + 决定 targetDir + 失败分类。不含下载/校验细节（那属既有模块）。
- **★ 装后列表归一（本 spec 最需要设计判断的一处）**：线上条目 `id` = sourceId（`registry-http-provider.ts:82`），装完后的扫描条目 `id` = **绝对路径**，而 composite 按 `r.id` 去重（`composite-provider.ts:56`）—— 两者 id 不同则**去重命不中，同一个 agent 会在列表里出现两条**。原料已在：回执 `.pi-web-registry.json` 记着 `sourceId`。候选解法（设计阶段定）：
  - (a) 扫描侧读回执，把带回执目录的 `id` 归一为 `sourceId` → 去重命中（registry 路在前故 registry 元数据胜出），再由建会话侧用回执反查已装目录；
  - (b) 保留两条但给已装线上源打 `installed` 标记，由列表侧合并展示。
  两者对 `AgentSourceItem` 契约的影响不同，须一并评估是否触发 P1 的复验触发器。
- **建会话接入点**：选中 `sourceId@channel` 形态时先装后跑的判定位置（路由层 / resolver 层）。
- **目录命名**：`sourceId` 含 `/`，需文件系统安全的映射。注意 `packages/server/src/source-key.ts` 已有稳定 sourceKey 约定（sha256 前 16 hex，跨版本稳定、无路径穿越风险），但它**不可读**；直接用作 agent 目录名会让扫描条目的 `id`/`source`（绝对路径）变成哈希串。是复用它还是另立可读映射，须在设计阶段权衡（勿随手发明第三套）。

## Out of Boundary

- 不改 `compareAgentSourceRecords` 排序语义（P1 复验触发器之一）
- 不在本仓签发 registry token —— 一律经 P1 的桌面 capabilities 授予
- 不把 `@pi-clouds/registry-client` 引入 `packages/server/src`（见 Constraints）
- 不实现更新/卸载/版本切换
- 不改 pi-clouds 服务端契约

## Upstream / Downstream

- **Upstream**：
  - `desktop-hybrid-agent-sources`（P1，`implemented`）—— grant 链路、扫描根、列表契约
  - `cli-package-commands`（`tasks-generated`）—— 拥有 `installFromRegistry` / `HttpRegistryAdapter` / 回执格式
  - `desktop-cloud-login`（`implementation-complete`）—— 桌面凭据
  - `agent-source-resolver`（`implemented`）—— 本地目录源 → spawnSpec
- **Downstream**：
  - 线上源的更新 / 卸载 / 版本管理（后续 spec，依赖本 spec 的落盘与回执约定）
  - 「可运行 / 需安装」的前端形态与安装进度（后续 spec）

## Existing Spec Touchpoints

- **Extends**：无（P1 已 `implemented` 并明确把本工作划为 Out of Boundary，故新建 spec 而非扩写 P1）
- **Adjacent**：
  - `cli-package-commands` —— 本 spec **消费**其安装实现。若需为复用而调整其签名/位置，须回头更新该 spec。
  - `install-host-command`（`implementation-complete`）—— `/install` 已有同步安装语义与 kind 判别，可作为失败态与授权门控的**参照先例**，避免两套语义打架。
  - `source-settings-and-slots` —— `source-key.ts` 的所有者，目录命名若复用其约定需对齐。

## Constraints

- **依赖方向铁律**：`installFromRegistry` 与 `HttpRegistryAdapter` 位于 `server/cli/**` 且 import `@pi-clouds/registry-client`，而 P1 明令该依赖**不得进入 `packages/server/src`**。所幸 `lib/app/pi-handler.ts` 与 `server/cli/**` 同属根应用层，跨层调用**可能本就不违规** —— 但必须在设计阶段定死接线位置与依赖方向，否则极易把该依赖悄悄渗进包里。这是本 spec 的头号架构风险。
- **凭据卫生**（延续 P1）：consume token 只进 Authorization 头，不落盘、不进日志、不返回前端。
- **失败不留半成品**：复用既有 staging + 原子 rename + 回滚语义，不得自行实现落盘。
- **只支持 `oss` origin**：`installFromRegistry` 的既有限制；其余 origin 须明确拒绝而非静默失败。
- **离线可用**：装完的源不得依赖后续网络可达性。
