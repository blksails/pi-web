# Research Log — agent-plugin-commands

## Discovery 范围

类型：**Extension**（既有系统扩展），走 light discovery。调查集中在三处：现有 `/install` 的实现与装配、
命令面板补全链路、三条候选取数链各自的抽象成色。

## 关键调查

### 1. `Installer` 已支持 kind 覆盖 —— 命令锁定 kind 无需改动 CLI 子域

`server/cli/install/installer.ts:149,156` 的 `install`/`uninstall` 选项已含可选 `kindHint`，
`determineKind()`（:298）的裁断顺序是「显式 `kindHint` → 本地路径读 `pi-web.json#kind` → npm/git 直连默认
`plugin`」。

**含义**：`/agent`、`/plugin` 只需在调用处恒传对应 `kindHint`，CLI install 子域一行不改。

**副作用（有意）**：拆分前 `/install <npm 包>` 缺省走 plugin 通道；拆分后 `/agent install <npm 包>` 会以
`kindHint:"agent"` 强制走 agent 通道，绕过那条"直连来源不可信、保守按 plugin"的约定。这是命令名即意图的
必然结果，属预期行为，需在用法文本中体现。

### 2. 命令面板只接受**单个** `commandArgProvider`

`pi-chat.tsx:676-678` 只注入一个 provider，`pi-command-palette.tsx:236` 用
`commandArgProvider?.specFor(cmdName)` 单点查询。因此拆成两条命令后不能是两个并列工厂，只能是一个
provider 的 `specFor` 同时认 `agent` 与 `plugin`（或额外引入组合器——无必要）。

### 3. `--kind agent` 补丁的由来与消亡

`install-arg-provider.ts:114-116` 给 agent 候选的 `insertText` 硬拼 `" --kind agent"`，注释写明是为了规避
`uninstall` 缺省探测走错通道。命令名锁定 kind 后该补丁失去存在理由，删除即是本次拆分最直接的收益。

### 4. 三条候选取数链的抽象成色（决定 Requirement 8 的范围）

| 候选 | 端点 | 现有抽象 | 结论 |
|---|---|---|---|
| 已装 agent 源 | `GET /agent-sources` | `AgentSourceProvider`（`agent-source-list/types.ts:35`），已有 scan / registry-http / composite 实现 | 已可替换，本 spec 只消费 |
| 已装 plugin | `GET /extensions` | `PiCli`（`ext.types.ts:119`，自称"唯一 IO 适配点"） | 已可替换，本 spec 只消费 |
| 可安装本地来源 | `GET /sessions/:id/install-sources` | 无——`routes/install-sources.ts:10` 直接 `node:fs` | 缺口，端口化 |

### 5. `Workspace` 端口不承载枚举

`packages/server/src/workspace/types.ts:9-17` 的边界宣言：只管**状态**，计算归 `RpcTransport`、网络归
`CapabilityProvider`，并明确写"防止本端口演变为万能对象"。其面为 `readJson/writeJson/list/delete/exists`
（JSON 文档存储），`list` 只列**持有值的键**，不是文件系统枚举。

**决策**：不扩展 `Workspace` 契约；新端口 `InstallSourceProvider` 与 `AgentSourceProvider` 同族并列。
这样也避免连累 pi-clouds 侧 `TenantWorkspace` 实现与跨仓一致性套件。

### 6. Tab 裸执行缺陷（已独立热修，非本 spec 实现项）

`pi-command-palette.tsx` 的 `select()` 中 builtin 分支原先排在 argSpec 分支之前，导致既是 builtin 又有参数树
的命令被 Tab/Enter 选中即以空 argv 执行，host 侧只能回用法文本，再被 `pi-chat.tsx:988` 当作 assistant 消息
追进对话。已于 `fix/palette-argspec-no-bare-exec`（`750d69b`）修复并补两条回归。本 spec 继承该保护。

## 综合（Synthesis）

- **泛化**：两条命令的 argv 解析、门控、脱敏、结果组装完全同构，差异只在「子动作集合」与「固定 kind」
  两个参数 → 采用**参数化工厂**产出两个 handler，而非复制两份实现。
- **采用而非新建**：kind 锁定复用既有 `kindHint`；结果卡片复用既有 `data-install-result` part 与渲染器
  （其 data 已含 `action`/`kind` 字段，足以自证归属）。
- **简化**：`command-arg.ts` 的 `argKind` 从 `installedExt | localSource | installedPackage`（含一个遗留值、
  一个"合并候选"值）收敛为域感知的 `localSource | installedAgent | installedPlugin`。

### 7. 实施期发现:`kindHint` 会压过 component 的真实判定(e2e 抓到)

`determineKind()`(`installer.ts:296`)原本以 `kindHint` 为最高优先级。命令拆分后 `/agent install`
恒传 `kindHint:"agent"`,于是一个本地 component 包(`pi-web.json#kind === "component"`)被当作 agent
成功装进源根 —— 绕过了下方那道本该返回 `KIND_COMPONENT_UNSUPPORTED` 的门。拆分前 `/install`
不传 hint,本地 kind 被如实读出,所以这条路径是绿的。

**修正**:本地来源读到的 `component` 压过 `kindHint`。`kindHint` 的语义是"下载前无从得知类型时的
提示",不应覆盖已经读到的 manifest 事实;对 CLI 的 `pi-web install --kind agent <component 包>`
同样是正确行为。已补两条回归(installer 单测 kindHint agent/plugin 双向 + e2e 拒绝卡片)。

**教训**:把一个可选提示改成"恒传",等于把它从"补充信息"升格为"最高优先级判据"——沿途每一处
以它为最高优先级的裁断都要重新审视。

## 风险

| 风险 | 处置 |
|---|---|
| 命令名 `agent` / `plugin` 与 agent 声明的 slash 伪命令重名 | 伪命令只填入不执行、且 arg-flow 阶段不混入（`pi-command-palette.tsx:244`），执行型命令优先；验收时补一条并存用例 |
| `/agent install <npm>` 强制 agent 通道带来的行为变化 | 有意行为，写进用法文本；e2e 不覆盖直连 npm 装 agent 这一罕见路径 |
| 端口化改动波及 `install-sources` 既有越界防护 | 迁移时行为逐条对拍（标志文件、深度/条数上限、SKIP 集合、realpath 越界），单测随实现一起搬 |
