# Requirements Document

## Project Description (Input)

统一的「命令分离层 + 结果回流/渲染层」，替代当前在 UI 层各自直调 REST + 手动管刷新时序的 bespoke 做法。

### 背景与问题
pi-web 当前命令是三条互不相通的路：
- **agent 命令**（source=extension/skill/prompt）：`GET /commands` 查询 → 选中当 prompt 发 `POST /messages` → LLM 处理。
- **builtin 命令**（`/plugin`，builtin-plugin-command）：chat-app `onBuiltinSelect` **硬编码 if-else + 前端 split 解析参数 + 直调 REST(/extensions) + 手动 nonce 刷新面板**——治标、零散、无执行可观测性（pending/success/error）。本 spec 即为根治此 UI 层补丁堆积。
- **extension 贡献**（Tier3）：走 ui-rpc 总线。

另：pi 工具的 `ctx.ui.custom`（向 CLI 推自定义输出）在 web 端**完全没桥接**，应纳入同一结果层让前端也能接收渲染。

### 关键洞察（调研结论）
Tier3 **ui-rpc 总线已是「UI/agent 发起 → 执行 → 结果经 control 帧回流」的分离层**：`POST /sessions/:id/ui-rpc`（快 ack）+ SSE `control:ui-rpc` 回流，correlationId 配对 + 15s 超时 + AbortSignal（`packages/react/src/web-ext/ui-rpc-bus.ts`；`packages/protocol/src/web-ext/ui-rpc.ts`）。协议 `point` 枚举**已含 `command`**、`action` **已含 `execute`**——只是 builtin 命令没走它。control 帧底座（extension-ui/queue/stats/error/ui-rpc/logs）+ 渲染面（ambient notifications/statuses/widgets、Tier2 data-part renderer、Tier4 artifact）均现成。

### 架构决策 A（host 侧命令通道）
统一**回流 + 渲染**层（一个结果帧 + 一套 UI 分流）；**执行按归属分**：
- **host 命令**（builtin，如 `/plugin`）：**server 拦截 `point:command` 自己执行**（不转 agent），结果经 control 帧（复用 `control:ui-rpc` 或新增 `control:command-result`）回流。
- **agent 命令**：仍走 agent。
- **工具 `ctx.ui.custom`**：归入同一回流/渲染层（执行侧由工具主动推）。

### 目标设计
- **命令声明与执行分离**：BuiltinCommandSpec/agent 命令只描述；执行走统一 dispatcher。
- **统一 dispatcher**：所有来源（键入/面板选择/agent/工具推）→ 一条 dispatch→execute 管线；point=command|custom，action=execute。
- **结果事件驱动 UI**：命令面板选中 → 发命令 → 订阅 control 帧结果 → 统一结果分流渲染（通知/面板/data-part）。UI 只渲染，不再 onClick 直调 REST + 手动刷新。
- **消除现有补丁**：onBuiltinSelect if-else → 数据驱动 dispatcher；前端 split 参数 → 服务端解析校验；直调 REST + 手动 nonce → 执行结果事件驱动；无可观测 → ui-rpc Promise 态 + 结构化 result。
- **迁移 builtin `/plugin` 到本层**（install/uninstall/list/panel 经统一命令执行 + 结果回流，替代 onBuiltinSelect 直调与 refreshKey 补丁）。

### ctx.ui.custom 接前端
- ctx.ui.* 9 种（select/confirm/input/editor/notify/setStatus/setWidget/setTitle/set_editor_text）已桥接；**custom 缺失**（工厂函数不可跨进程序列化，rpc mode 下不可用）。
- 接法：以**声明式组件描述（注册名 + props）** 替代工厂；pi SDK 在 rpc mode 把 custom 桥成 ui-rpc 请求（point:custom）。**注意：pi SDK 桥接是 pi-web 不可控的上游依赖**——本 spec 在 web 侧建好接收/渲染（point:custom → 注册式自定义组件渲染），pi SDK 桥接作为外部依赖标注；web 侧可先用声明式 data-part/registry 路径承接。

### 复用（不重写）
ui-rpc 总线（createUiRpcBus/UiRpcClient）、control-store 分流、renderer registry（Tier2 自定义渲染）、ambient 渲染面、extension-ui 队列。新增主要是：host 侧命令执行通道（server 拦 point:command）+ 统一命令 dispatcher + 命令结果渲染分流 + point:custom 接收。

### 必须钉为显式约束
1. builtin/host 命令**绝不进 LLM**（沿用 builtin-plugin-command Req 2.3/7.x）。
2. 执行**按归属**：host 命令 server 执、agent 命令 agent 执、工具 custom 工具推；统一的是**回流帧 + 渲染分流**，非执行位置。
3. **向后兼容**：RpcSlashCommand/ui-rpc 结构变更需向后兼容；agent 命令现有 prompt 注入路径不变。
4. **迁移不回归**：builtin-plugin-command 的 `/plugin` 行为（面板/安装/卸载/装后双路生效）迁移到本层后，既有 e2e（plugin-command + slash-command-palette）仍须全绿。
5. ctx.ui.custom 的 pi SDK rpc-mode 桥接为**外部依赖**；web 侧接收/渲染可独立交付并以声明式路径兜底。
6. 改注入路由/协议域后 dev 需重启（handler 单例 pin globalThis，端口 3010）；e2e 走 `NEXT_DIST_DIR=.next-e2e` external server。

### 涉及包
`packages/protocol`（ui-rpc point=command 执行语义 / 可选 control:command-result / point:custom）、`packages/server`（host 侧命令执行通道 + 拦截 + 结果回流编码）、`packages/react`（统一命令客户端/总线复用 + 结果订阅 hook）、`packages/ui`（palette 经统一层分派 + 命令结果渲染分流 + custom 渲染）、`components/chat-app` + `lib/app`（迁移 `/plugin` onBuiltinSelect 到统一层，移除 refreshKey/手动刷新补丁）。

### 与既有 spec 关系
- 复用并重构 `builtin-plugin-command`（把 `/plugin` 从 UI 直调迁到统一层）与 `agent-web-extension` 的 ui-rpc 总线。
- **不含** marketplace。

## Requirements

### Requirement 1：统一命令执行通道（host 侧）

**User Story:** 作为 pi-web 用户，当我触发一个 host 内置命令（如 `/plugin`）时，希望它经由一条统一的命令执行通道被驱动执行，而不是 UI 各自直调 REST，以便执行路径一致、可观测、可复用。

#### Acceptance Criteria
1.1 WHEN 用户触发一个 host 命令（键入回车或面板选中） THEN 系统 SHALL 经 ui-rpc 通道发出 `point="command"`、`action="execute"` 的请求，携带命令名与参数。
1.2 WHEN 命令请求到达服务端且命令名属于已注册 host 命令 THEN 系统 SHALL 在服务端执行该命令（不转发给 agent）。
1.3 WHEN host 命令执行完成 THEN 系统 SHALL 经 `control:"ui-rpc"` 帧按 `correlationId` 回流结构化结果 `{ ok, result | error }`。
1.4 WHEN 命令名不属于已注册 host 命令 THEN 系统 SHALL 保持既有行为（转发 agent / 作为 prompt），不改变 agent 命令路径。
1.5 IF host 命令执行抛错 THEN 系统 SHALL 以 `ok:false` + 结构化 error（code/message）回流，且不使会话崩溃。

### Requirement 2：内置/host 命令绝不进 LLM

**User Story:** 作为用户，host 命令必须执行 harness 逻辑而非被当作提示词发给模型，以免误把 `/plugin install x` 发给 LLM。

#### Acceptance Criteria
2.1 WHEN 用户键入完整 host 命令（如 `/plugin install <源>`）并回车 THEN 系统 SHALL 经统一命令通道分派执行，且 SHALL NOT 发送任何消息到 `POST /messages`（不进 LLM）。
2.2 WHEN 用户在命令面板选中 host 命令 THEN 系统 SHALL 经统一命令通道分派，且 SHALL NOT 触发 prompt 发送。
2.3 WHEN host 命令分派后 THEN 系统 SHALL 清空输入框且不向会话写入用户消息。

### Requirement 3：结果事件驱动渲染（UI 只渲染）

**User Story:** 作为用户，命令执行的结果应由回流事件驱动 UI 更新，而不是 UI 端手写刷新时序，以免出现「装了但界面没更新」。

#### Acceptance Criteria
3.1 WHEN 命令结果帧回流 THEN 系统 SHALL 由结果订阅驱动相应 UI 更新（如列表刷新/面板打开/通知），UI SHALL NOT 依赖手动 nonce 或固定延时刷新。
3.2 WHEN 命令处于执行中 THEN 系统 SHALL 可向用户呈现 pending 态（执行中），并在完成/失败时转为对应态。
3.3 WHEN 命令结果为失败 THEN 系统 SHALL 向用户呈现可见的错误反馈（非静默吞错）。

### Requirement 4：命令声明与执行分离 + 数据驱动分派

**User Story:** 作为维护者，命令的声明（名称/描述/参数）应与执行解耦，前端分派应数据驱动而非硬编码 if-else 与前端参数解析。

#### Acceptance Criteria
4.1 WHEN 系统装配命令面板 THEN 系统 SHALL 以声明（BuiltinCommandSpec）数据驱动地决定命令的来源与分派方式，SHALL NOT 以命令名硬编码 if-else 决定行为。
4.2 WHEN host 命令带参数 THEN 系统 SHALL 在服务端（命令通道）解析/校验参数，前端 SHALL NOT 承担命令语义参数解析。
4.3 WHEN 新增一个 host 命令 THEN 系统 SHALL 仅需新增声明 + 注册执行器，无需改动命令面板分派代码。

### Requirement 5：迁移 `/plugin` 到统一层（不回归）

**User Story:** 作为用户，现有 `/plugin` 的全部行为（打开面板、安装、卸载、装后会话生效）在迁移到统一层后必须保持不变。

#### Acceptance Criteria
5.1 WHEN 用户触发 `/plugin`（无子命令） THEN 系统 SHALL 打开 Plugin 管理面板。
5.2 WHEN 用户触发 `/plugin install <源>` THEN 系统 SHALL 经统一命令通道在服务端安装，并在结果回流后刷新面板列表显示该插件。
5.3 WHEN 用户触发 `/plugin uninstall <名>` THEN 系统 SHALL 经统一命令通道卸载并刷新列表移除该项。
5.4 WHEN 安装/卸载成功 THEN 系统 SHALL 触发会话重载（runner reload）使资源对运行中会话生效。
5.5 WHEN 迁移完成 THEN 既有 e2e（plugin-command、slash-command-palette）SHALL 全部通过。
5.6 WHEN 迁移完成 THEN 系统 SHALL 移除 `onBuiltinSelect` 内的直调 REST 与 `refreshKey` 手动刷新补丁。

### Requirement 6：`ctx.ui.custom` 接收并渲染到前端

**User Story:** 作为工具作者，工具经 `ctx.ui.custom` 推送的自定义输出应能被 web 前端接收并渲染，复用统一结果层，而不仅限于 CLI。

#### Acceptance Criteria
6.1 WHEN 自定义 UI 请求经 `point="custom"` 到达前端 THEN 系统 SHALL 按声明式组件描述（注册名 + props）查注册表渲染对应组件。
6.2 IF 自定义组件描述的注册名未注册 THEN 系统 SHALL 安全降级（占位/忽略，不崩溃）。
6.3 WHEN `ctx.ui.custom` 的 pi SDK rpc-mode 桥接不可用 THEN 系统 SHALL 仍可经声明式接收路径（注册式渲染）独立工作，桥接作为外部依赖标注。
6.4 WHEN 自定义结果与 host 命令结果回流 THEN 二者 SHALL 复用同一回流帧机制（control:ui-rpc）与同一前端订阅分发。

### Requirement 7：向后兼容

**User Story:** 作为现有用户，引入统一命令层不得破坏 agent 命令、ui-rpc 既有用法与协议消费方。

#### Acceptance Criteria
7.1 WHEN 协议（RpcSlashCommand / ui-rpc payload）变更 THEN 变更 SHALL 向后兼容（新增字段可选、既有字段语义不变）。
7.2 WHEN agent 命令（source=extension/skill/prompt）被选中 THEN 系统 SHALL 保持既有 prompt 注入路径不变。
7.3 WHEN 既有 Tier3 ui-rpc（slash/mention/autocomplete/inlineComplete 等贡献点）被使用 THEN 其行为 SHALL 不受本层影响。

### Requirement 8：运行/测试前置

**User Story:** 作为开发者，本层涉及注入路由/协议域变更，需明确开发与测试运行前置以保证可验证。

#### Acceptance Criteria
8.1 WHEN 改动注入路由/协议域后 THEN 系统 SHALL 要求重启 dev（handler 单例 pin globalThis）方能生效。
8.2 WHEN 运行 e2e THEN 系统 SHALL 经隔离构建（`NEXT_DIST_DIR=.next-e2e`）+ external server 模式执行。
8.3 WHEN 本层交付 THEN 系统 SHALL 提供覆盖「统一命令通道 + 结果回流 + /plugin 迁移 + custom 接收」的自动化测试（单元 + 浏览器 e2e）。
