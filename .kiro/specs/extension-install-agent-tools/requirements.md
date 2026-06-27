# Requirements Document

## Introduction

把 pi-web 的扩展安装从「server 侧 host 命令 `/plugin` + 前端模态 `PluginPanel`」彻底重构为「agent 回合内的内置工具」，安装信息与进度改用 pi 原生 `ctx.ui`（状态条 / 通知 / Widget 等 ambient 呈现，非模态弹窗）。用户在聊天里通过 agent 调用工具来安装、卸载、列出扩展；进度与结果实时可见；安装后自动应用；安全门控（来源白名单）完整保留；旧的 `/plugin` 命令与模态面板被移除，扩展管理只剩单一路径。

## Boundary Context

- **In scope**：agent 回合内的扩展安装/卸载/列出工具；经 `ctx.ui` 呈现安装信息与进度（ambient）；安装后应用扩展（重载）；来源白名单门控；安装写入会话自身的 agent 配置目录；移除旧 `/plugin` host 命令、内置斜杠命令与模态面板。
- **Out of scope**：扩展运行时安装的 web-ext UI 层（agent-web-extension/webext-package-install 另有 spec）；`/clear` 等其它 host 命令；pi SDK 本身的包管理实现；非 pi 扩展的安装。
- **Adjacent expectations**：依赖 pi SDK 提供包安装能力与扩展重载入口（命令通道）；依赖既有 `ctx.ui`（setStatus/notify/setWidget）的端到端渲染链路（agent 回合内 SSE 流已开）；沿用既有来源允许策略（与被移除的 host 命令一致的白名单语义）。

## Requirements

### Requirement 1: agent 回合内的扩展管理工具

**Objective:** 作为 pi-web 用户，我希望在聊天里让 agent 安装、卸载、列出扩展，以便不依赖前端模态面板也能管理扩展。

#### Acceptance Criteria
1. The 扩展管理能力 shall 向 agent 提供安装、卸载、列出三个工具。
2. When agent 调用安装工具并给出来源标识，the 扩展管理工具 shall 在当前会话上下文内执行安装。
3. When agent 调用卸载工具并给出扩展标识，the 扩展管理工具 shall 卸载对应扩展。
4. When agent 调用列出工具，the 扩展管理工具 shall 返回当前会话已安装扩展的清单。
5. While agent 正在一次对话回合内执行扩展工具，the 扩展管理工具 shall 使其安装信息/进度随该回合实时呈现（而非延迟到回合外）。

### Requirement 2: ctx.ui 呈现安装信息与进度（ambient，非模态）

**Objective:** 作为用户，我希望安装的进度与结果以 ambient 状态/通知显示，以便看到正在装什么、成功还是失败，而不被模态弹窗打断。

#### Acceptance Criteria
1. While 安装正在进行，the 扩展管理工具 shall 经 `ctx.ui` 显示包含来源标识的「安装中」进度状态。
2. When 安装成功完成，the 扩展管理工具 shall 经 `ctx.ui` 通知安装结果，并清除「安装中」进度状态。
3. If 安装失败，then the 扩展管理工具 shall 经 `ctx.ui` 通知失败原因，并清除「安装中」进度状态。
4. When agent 调用列出工具，the 扩展管理工具 shall 经 `ctx.ui` 以 ambient 形式呈现已安装扩展清单。
5. The pi-web 系统 shall 不弹出前端模态对话框来呈现扩展安装/卸载/列出信息。

### Requirement 3: 安装后应用扩展（重载）

**Objective:** 作为用户，我希望安装的扩展在安装后生效，以便装完即可使用。

#### Acceptance Criteria
1. When 安装成功完成，the 扩展管理工具 shall 触发扩展重载以应用新扩展。
2. While 触发重载，the 扩展管理工具 shall 经命令通道触发（而非在工具内直接重载），以避免回合内重载导致的死锁。
3. If 重载入口不可用或重载失败，then the 扩展管理工具 shall 经 `ctx.ui` 告知用户安装已写入、需手动重载或重启会话方可生效。

### Requirement 4: 安全门控（来源白名单）

**Objective:** 作为 pi-web 维护者，我希望仅放行白名单来源的安装，以便多用户托管环境下不被装入任意来源。

#### Acceptance Criteria
1. If 安装来源不在允许策略内，then the 扩展管理工具 shall 拒绝安装并经 `ctx.ui` 通知来源被拒及原因。
2. While 安装/卸载放行未开启（管理员/环境门控关闭），the 扩展管理工具 shall 拒绝安装与卸载并提示门控未开启。
3. Where 配置放行本地路径、npm 或任意来源，the 扩展管理工具 shall 据对应门控放行相应来源类型。
4. The 扩展管理工具 shall 沿用与被移除的 host 命令一致的来源允许语义（同一组门控开关与白名单判定）。

### Requirement 5: 安装目标隔离（不污染运行环境）

**Objective:** 作为维护者，我希望安装写入会话自身的 agent 配置目录，以便不污染运行 pi-web 的真实用户全局配置。

#### Acceptance Criteria
1. When 扩展管理工具安装或卸载扩展，the 扩展管理工具 shall 作用于当前会话 agent 的配置目录。
2. The 扩展管理工具 shall 不向运行 pi-web 进程的真实用户全局配置写入会话级安装结果（除非该会话本就指向该目录）。

### Requirement 6: 彻底替换 /plugin（清理与回归）

**Objective:** 作为维护者，我希望移除旧的 host `/plugin` 命令与模态面板，以便扩展管理只有 agent 工具 + ctx.ui 单一路径，无重复、无模态。

#### Acceptance Criteria
1. The pi-web 系统 shall 不再提供 `/plugin` 内置斜杠命令。
2. The pi-web 系统 shall 不再渲染 plugin 管理模态面板。
3. When 用户输入 `/plugin`，the pi-web 系统 shall 不再打开模态面板。
4. The pi-web 系统 shall 保持 `/clear` 等其它 host 命令不受影响。
5. Where 重构完成，the 验收 shall 以单元测试（工具安装、门控拒绝、触发重载）与端到端测试（隔离配置目录 + 真实 pi 安装：agent 调用安装工具 → `ctx.ui` 状态/通知可见 → 重载生效；门控拒绝非白名单源；真实用户全局配置零污染）证明端到端行为。
