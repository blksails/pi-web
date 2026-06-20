# Requirements Document

## Introduction

本特性为 pi-web 增加 **server-driven UI 自定义渲染能力**:让 pi agent 作者**从后端**声明富 UI(指标卡、表格、键值、告示、进度,乃至自定义布局),前端**零配置**渲染。这契合 pi-web "任意 pi agent 即刻变 Web UI" 的核心价值——agent 不编写任何前端代码,只发送结构化数据。

采用 **「1+2 组合」信任模型**:

- **路径 1 · 内置白名单组件**(安全默认):agent 以 `kind:"builtin"` 给出组件名 + JSON props,前端只渲染**预先注册**的组件;未注册即拒绝(占位回退),agent 无法引入任意组件。
- **路径 2 · 沙箱组件**(受限模板):agent 以 `kind:"sandbox"` 给出**可序列化的声明式节点树**(非原始 HTML/JSX),由宿主**白名单元素解释器**仅按固定元素集 + 设计令牌渲染。其安全本质在于"根本没有可执行物":节点树是 JSON,无表达式、无函数、无 `eval`。

复用既有传输与渲染管线:新增一个 pi-web 自有 `data-*` part(`data-pi-ui`),不触碰 pi 原生派生的 `extension-ui.ts`(须协议兼容);经既有 `SSE /stream → PiTransport → useChat → PartRenderer` 流动;经既有 `RendererRegistry` 分派。权威设计见 `.kiro/specs/web-ui-custom-rendering/design.md`。

## Boundary Context

- **In scope**:
  - `@pi-web/protocol` 新增 `data-pi-ui` data-part 与 `UiSpec`/`UiNode`/`UiStyle` schema(`transport/ui-spec.ts`)。
  - `@pi-web/ui` 新增:内置白名单组件库(metric/keyValue/table/alert/progress)、可扩展的 `UiComponentRegistry`、设计令牌映射、沙箱解释器 `SandboxRenderer`、`data-pi-ui` 渲染器 `PiUiPart`。
  - `<PiChat>` 零配置自动注册 `data-pi-ui` 渲染器(沿用 Sources data-part 注册范式)。
  - 单元测试(schema / 注册表 / 沙箱安全 / 分派 / 内置组件)与 e2e 测试(端到端渲染 + 安全降级)。
- **Out of scope**:
  - **交互沙箱**:沙箱组件本期为**纯只读展示**,不绑定事件/回调;需要交互(按钮回调、表单提交)走内置白名单组件或既有 `extension-ui`。
  - 修改 pi 原生 `extension-ui.ts` 协议;新增后端会话引擎能力。
  - iframe/真 VM 级隔离(本期以白名单解释器达成同等安全保证,见 design 取舍)。
  - 图表等需第三方库的复杂可视化(留作宿主经 `registerUiComponent` 自行扩展)。
- **Adjacent expectations**:
  - 主题继承宿主 shadcn CSS 变量;不引入硬编码颜色。
  - 不破坏既有 data-part(queue/compaction/auto-retry)与默认 JSON 回退。(注 2026-06-20:原第 4 类 `tool-partial` data-part 已移除,partial 改走 `tool-output-available` preliminary;见下 R8 验收 3。)

## Requirements

### Requirement 1: server-driven UI part 契约
**Objective:** 作为 pi agent 作者,我想要从后端以一个标准 data-part 声明 UI,以便无需前端改动即可呈现富界面。

#### Acceptance Criteria
1. The protocol shall 定义 `data-pi-ui` data-part,其 `data` 为 `UiSpec`,并纳入 `DataPartSchema` 判别联合。
2. The `UiSpec` shall 以 `kind` 判别为 `builtin` 与 `sandbox` 两个变体,各可携带可选 `title`。
3. When agent 发出合法 `data-pi-ui` part, the system shall 经既有 SSE/transport 管线无改动传递至前端。
4. If `data` 不符合 `UiSpec` schema, then the protocol shall 使 `DataPartSchema.safeParse` 返回失败且不破坏其它 data-part 解析。
5. The 新增契约 shall 仅位于 `transport/*`(pi-web 自定义),不修改 `rpc/extension-ui.ts`。

### Requirement 2: 内置白名单组件渲染(路径 1)
**Objective:** 作为 agent 作者,我想要按名称选用前端预置组件并传 JSON props,以便用最小信任面渲染标准可视化。

#### Acceptance Criteria
1. When `part.data.kind==="builtin"` 且 `component` 已在组件注册表注册, the system shall 用该组件渲染并透传 `props`。
2. If `component` 未注册, then the system shall 渲染可读占位回退(不抛错、不渲染任意未注册内容)。
3. The system shall 预置内置组件:`metric`、`keyValue`、`table`、`alert`、`progress`。
4. The 内置组件 shall 对 `props` 形状容错:字段类型不符时忽略该字段而非崩溃。
5. Where 宿主调用 `registerUiComponent(name, component)`, the system shall 以该组件覆盖或扩展可渲染组件集(最后写入胜出)。

### Requirement 3: 沙箱组件渲染(路径 2)
**Objective:** 作为 agent 作者,我想要用声明式节点树自定义布局,以便表达预置组件未覆盖的展示而无需前端改动。

#### Acceptance Criteria
1. When `part.data.kind==="sandbox"`, the system shall 用受限解释器把 `root` 节点树渲染为 React。
2. The 解释器 shall 仅渲染白名单元素(`box`/`text`/`heading`/`badge`/`divider`/`code`/`link`/`list`/`keyValue`/`table`/`image`);遇未知元素 shall 不渲染该节点。
3. The 节点样式 shall 仅来自令牌枚举(tone/size/align/weight/gap/pad),并映射为固定主题化类名;shall 不接受任意 `className`/`style` 字符串。
4. When 渲染 `link` 节点, the system shall 仅在 `href` 为 `http`/`https`/`mailto` 时渲染可点击链接,否则降级为纯文本。
5. When 渲染 `image` 节点, the system shall 仅在 `src` 为 `http`/`https`/`data:image` 时渲染 `<img>`(`loading="lazy"`),否则不渲染 `<img>`(降级为 `alt` 文本)。

### Requirement 4: 沙箱安全保证
**Objective:** 作为平台维护者,我想要沙箱渲染在面对不可信 agent 输入时无法越权,以便安全地让后端驱动 UI。

#### Acceptance Criteria
1. The 沙箱解释器 shall 不执行任意代码、不 `eval`、不解析表达式或脚本(仅解释 JSON 数据)。
2. The 沙箱解释器 shall 不使用 `dangerouslySetInnerHTML`;所有文本 shall 作为 React 文本节点(自动转义)渲染。
3. The 沙箱解释器 shall 不为任何节点绑定事件处理器(本期沙箱为只读)。
4. The 沙箱解释器 shall 限制递归深度(上限 `MAX_DEPTH`),超出 shall 截断渲染以防深层嵌套 DoS。
5. When 渲染外部链接, the system shall 强制 `rel="noopener noreferrer"` 与 `target="_blank"`。

### Requirement 5: 零配置接入与向后兼容
**Objective:** 作为宿主集成者,我想要挂载 `<PiChat>` 后 agent 的 UI 自动呈现,以便无需为每个 agent 手动接线。

#### Acceptance Criteria
1. When 宿主挂载 `<PiChat>`, the system shall 自动向注册表注册 `data-pi-ui` 渲染器(沿用 Sources data-part 注册范式,幂等)。
2. If `data-pi-ui` 渲染器未注册(如使用 `PartRenderer` 而未经 `<PiChat>`), then the system shall 回退到既有默认 data-part JSON 预览(不抛错)。
3. The 本特性 shall 不改变既有 4 类 data-part 的解析与渲染行为。

### Requirement 6: 公开 API 与可扩展性
**Objective:** 作为宿主开发者,我想要导出的注册表与组件 API,以便扩展自有可视化组件并复用沙箱能力。

#### Acceptance Criteria
1. The `@pi-web/ui` 包 shall 导出:`PiUiPart`、`SandboxRenderer`、`UiComponentRegistry` 类型与工厂、`defaultUiComponentRegistry`、`registerUiComponent`、内置组件与 `registerBuiltinUiComponents`。
2. The `@pi-web/protocol` 包 shall 导出:`UiSpec`/`UiNode`/`UiStyle` 等 schema 与类型、`UiDataPartSchema`。

### Requirement 7: 测试与验证
**Objective:** 作为质量负责人,我想要单元与 e2e 测试,以便确认功能与安全保证以新鲜证据成立。

#### Acceptance Criteria
1. The 测试 shall 覆盖:`UiSpec`/`UiNode` schema(合法/非法/危险 href 拒绝)、注册表(注册/解析/覆盖/未注册)、沙箱安全(无 script/事件处理器、危险 href 降级、深度截断、文本转义)、`PartRenderer` 对 `data-pi-ui` 的分派、内置组件容错。
2. The e2e 测试 shall 在 `<PiChat>` 中模拟 agent 发出 `data-pi-ui`(builtin 与 sandbox)并断言渲染结果,含危险 href 降级用例。
3. The 验证 shall 以 worktree 内 `typecheck` 与全量 `vitest` 的新鲜运行输出为准。

### Requirement 8: agent 侧 server-driven UI 产帧通道
**Objective:** 作为 agent 作者,我想要从工具内一行代码发出 UI,以便后端驱动前端渲染而无需新协议或前端改动。

#### Acceptance Criteria
1. The `@pi-web/agent-kit` shall 提供 `emitUi(onUpdate, spec)`,把 `UiSpec` 经工具 `onUpdate` 的 `partialResult.details[PI_UI_TOOL_DETAILS_KEY]` 发出。
2. When 工具经 `emitUi` 发出合法 `UiSpec`, the server translate 层 shall 在翻译 `tool_execution_update` 时识别约定 key 并产出 `data-pi-ui` 帧。
3. If `partialResult.details` 未携带约定 key 或 `UiSpec` 非法, then the server shall 把累积 `partialResult` 翻译为 `tool-output-available`(`preliminary: true`)喂进同一工具卡(不破坏工具部分结果语义)。〔更新 2026-06-20:原文为「维持既有 `data-pi-tool-partial` 翻译」;该 data-part 已移除,回退路径改为 preliminary 工具产出帧。〕
4. The 通道 shall 复用既有 `tool_execution_update` 事件,不修改 pi SDK、不新增 RPC 旁路。
5. The `emitUi` shall 在 `onUpdate` 缺失或非函数时安全无操作。
