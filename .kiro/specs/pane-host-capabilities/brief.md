# Brief: pane-host-capabilities

## Problem

内置 pane(file_explorer / code_editor / logging / browser)要做实事,需要宿主提供
**今天不存在**的能力:枚举文件树、读文件内容、把编辑写回磁盘、订阅日志流。

而 pane 是 iframe guest,四条既有通道(route / surface / attachment / conversation)里
只有 **agent route** 能取数据 —— 但 agent route 是**会话锚定、由 agent 声明**的,内置 pane
不能指望每个 agent 都去声明一套文件系统 route。宿主必须自己提供这条能力面。

这条能力面是**安全边界**:一旦做错,pane(可能来自第三方 agent 的 iframe)就获得了宿主
文件系统的读写权。它必须能独立于任何 pane UI 被 review 和测试,不能被 UI 实现进度裹挟。

## Current State

- `packages/panes-kit/src/agent-routes.ts`:标准地址
  `GET/POST {baseUrl}/sessions/{sessionId}/agent-routes/{route}`,结构化错误
  (`SESSION_NOT_FOUND`→`HOST_UNAVAILABLE`、装配窗口退避、409→`REVISION_CONFLICT`)。
- `packages/panes-kit/src/authorization.ts`:grant 只源于已装载定义;guest 自报任何标识
  都不产生权限。
- 已有安全先例可参照:completion provider 的 **file provider realpath 安全门**
  (`completion-provider-framework`)——同一类「限根目录 + 拒逃逸」问题在本仓已解过一次。
- 日志:`packages/logger` 同构包 + 服务端权威门控 + 现有 logs 面板(`logs-panel-right-layout`)。
- 缺口:不存在宿主自有的、非 agent 声明的 pane 能力 route;不存在会话 cwd 的对 pane 暴露面;
  不存在文件写回路径与其鉴权。

## Desired Outcome

- 内置 pane 可经**明确授权**的宿主能力,枚举会话工作目录子树、读文件、写回文件、订阅日志。
- 访问**严格限于会话 cwd 子树**:realpath 校验,越界拒绝,符号链接逃逸拒绝,路径遍历拒绝。
- 会话 cwd 的**权威来源是会话装配态**,绝不采信 pane 自报。
- 能力面可被独立安全测试:越权用例、逃逸用例、超大文件、二进制文件、并发写冲突。
- 内置身份**不自动**获得这些能力 —— 仍走 grant,能力逐项授予。

## Approach

在宿主侧建立一条**与 agent route 平行的 pane 能力通道**,复用 panes-kit 已有的授权与错误语义:

1. **能力定义**:文件树枚举 / 读文件 / 写文件 / 日志订阅,各自是可授予的 capability。
2. **根解析**:会话 cwd 由会话装配态权威提供;所有路径先 resolve 再 realpath,再断言仍在根内。
3. **限额**:文件大小上限、树枚举深度/条目上限、写入大小上限 —— 复用或对齐 panes-kit
   既有的 256 KiB / 2 MiB / 8 MiB 分级。
4. **错误语义**:沿用 panes-kit 结构化错误,不向 guest 泄露宿主绝对路径与裸 HTTP 状态。
5. **日志能力**:把现有 logs 面板的数据来源抽成可被 pane 订阅的能力(UI 转换归下游 spec)。

## Scope

- **In**:pane 能力通道的契约与实现;会话 cwd 根解析与权威来源;realpath / 逃逸 / 遍历
  防护;读写大小与枚举限额;二进制与超大文件处理;写回的冲突语义;日志订阅能力;
  能力的 grant 接线与默认拒绝测试;安全用例矩阵。
- **Out**:任何 pane 的 UI(→ `builtin-pane-suite`);browser pane 的 webview/预览器
  (→ `builtin-pane-browser`);内置 pane 的装载与合并(→ `host-builtin-panes`);
  给 agent 自己用的文件工具(pi SDK 已有,不在此重造)。

## Boundary Candidates

- **根解析与逃逸防护**(纯函数面,可穷举测试)
- **能力契约**(guest 侧看到的操作与错误码)
- **传输/挂载**(能力如何经宿主暴露、如何与 pane grant 接线)
- **日志能力的数据源抽取**

## Out of Boundary

- pane UI、编辑器组件、语法高亮
- agent 侧的文件工具与权限(pi SDK 领域)
- 沙箱/远程形态下的文件系统语义(远程会话 cwd 不在宿主机 —— 须显式定义降级,但不在本 spec
  实现远程文件桥)

## Upstream / Downstream

- **Upstream**:`host-builtin-panes`(装载与 grant 接线)、`isolated-panes`(授权与错误语义)、
  `session-engine`(会话装配态 = cwd 权威)
- **Downstream**:`builtin-pane-suite`(file_explorer / code_editor / logging)

## Existing Spec Touchpoints

- **Extends**:`isolated-panes`(能力面接在其授权模型上)
- **Adjacent**:`completion-provider-framework`(file provider 的 realpath 安全门是同类问题的
  既有解,应对齐而非另发明);`logging-system`(日志数据源);`agent-declared-routes`
  (agent 声明的 route 与宿主能力 route 是**两条**通道,勿混淆)

## Constraints

- **默认拒绝**:未授予即不可用;内置身份不提权。
- 不得向 guest 泄露宿主绝对路径、用户名或裸 HTTP 状态码。
- 远程/沙箱会话(e2b 传输)下会话 cwd 不在宿主文件系统 —— 必须有明确的**能力不可用**降级,
  而不是静默读到宿主机文件(此类「静默不可用」正是
  `runner-self-resolved-builtins` 记录过的历史坑)。
- ★ 安全用例必须包含符号链接逃逸、`..` 遍历、大小写文件系统差异、并发写。
