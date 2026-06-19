# Requirements Document

## Introduction

对 `agent-web-extension` 特性做**全量补齐 + 视觉验收**:为**每一项可定制能力**(Tier 1~5 的全部插槽/渲染器/贡献点/环境 UI/交互对话框/artifact/声明式配置 + 内核不变)建立一条可在**真实浏览器**中以截图/快照证明的验收项,用 Chrome DevTools 工具驱动。验收以「选定携带 `.pi/web` 的示例 agent source → 该能力在浏览器内可见且正确」为标准,产出截图证据。

**范围决策(2026-06-19 拍板:全量补齐接线,含 R6/R20)**:本 spec **允许并要求**补齐所有未接线/无驱动的能力,直至 **29/29 全部达成真实视觉 PASS**。补齐范围包括:(a) 9 个明确接线/驱动缺口(R3/R4/R8/R19/R21/R23/R24/R26/R27);(b) R6 的 12 个协议保留插槽在 `pi-chat.tsx` 新建 `SlotHost` 消费;(c) R20 的 4 个未消费贡献点(autocomplete/inlineComplete/custom/keybindings)新建宿主消费逻辑。涉及 `pi-chat.tsx`/`chat-app.tsx`/`stub-agent-process.mjs`/各示例 `web.config.tsx` 的实现改动,完成后需回 `agent-web-extension` 主 spec 复验。

### 验收项分级标签
每条 Acceptance Criteria 标注其性质:
- **【已接线·硬验收】** — 宿主已挂载、且有示例或 stub 能驱动,浏览器内必须可见,断言失败即缺陷。
- **【部分·stub 驱动】** — 需特定 stub sentinel(如 `ext-ui` / `ext-select`)或特定输入触发,触发后必须可见。
- **【需补实现·硬验收】** — 原为缺口;按范围决策**必须先补接线/驱动/实现,再达成视觉 PASS**,完成后等同硬验收(断言失败即缺陷)。原文中标注【缺口·记录补法】的条目一律按本级别执行;「记录缺口」降级为「实现受阻时的回退证据」,非默认收口形态。

## Boundary Context
- **In scope**:R1..R29 覆盖 Tier1~5 全部可定制表面 + 内核不变的浏览器视觉验收 + 截图证据;**补齐所有未接线/无驱动能力的最小实现**(宿主 `pi-chat.tsx` 新建 12 插槽 SlotHost + 4 贡献点消费;`chat-app.tsx` 透传 `extensionBaseUrl`/`theme`/`layout`;`stub-agent-process.mjs` 增产出/sentinel;各示例 `web.config.tsx` 增节点);起隔离 build(`.next-e2e`)的本地服务;Chrome DevTools 驱动;stub sentinel 驱动环境 UI 与交互对话框。
- **Out of scope**:重新设计 agent-web-extension 协议契约;非浏览器(node/jsdom)断言(已在 agent-web-extension spec 覆盖);需真实 LLM/API key 的在线路径(一律用 stub 确定性等价物替代)。
- **Adjacent expectations**:依赖 `agent-web-extension` 协议已定义且 `lib/app/webext-registry.ts` 已注册各示例(构建期集成);**12 协议保留插槽与 4 贡献点的 UI 语义需在 design 阶段先定义(含与现有环境 UI 的去重)**;完成补齐后回 `agent-web-extension` 主 spec 复验;已有 playwright 资产 `e2e/browser/{webext,extension-ui-surfaces,slash-command-palette}.e2e.ts` 提供断言层对照。

## Requirements

### 共享前置(Shared Preconditions)
> 以下步骤为每条 Acceptance Criteria 的公共前置,验收项内以「**完成共享前置**」引用,不再重复。

- **P1 隔离 build**:以 `NEXT_DIST_DIR=.next-e2e` 产出独立构建产物,不污染正在运行的 `next dev` 的 `.next`。
- **P2 stub agent**:服务进程设 `PI_WEB_STUB_AGENT=1`,提供确定性、离线、无 API key 的会话(参考 `playwright.config.ts` 的 fs 项目:`next start -p 3100`,`SESSION_STORE=fs`)。
- **P3 起本地服务**:在隔离端口(默认 `3100`)以 `next start` 启动并就绪。
- **P4 浏览器驱动**:用 Chrome DevTools 工具 `navigate_page` 打开 `http://localhost:3100/`,`wait_for` 至 `[data-agent-source-picker]` 出现。
- **P5 选定 source 的统一操作**(每条验收替换其中的 `<SOURCE_PATH>`,可在 prompt 处替换 `<PROMPT>` 以触发 sentinel):
  1. 在 `[data-agent-source-input]` 内 `fill` 写入 `<SOURCE_PATH>`。
  2. `click` `[data-agent-source-submit]`(按钮文案「Start session」)提交。
  3. `wait_for` 至加载态 `[data-session-connecting]` 消失、会话根容器 `[data-session-active]` 出现(`transport` 就绪)。
  4. 如验收需驱动环境 UI / 交互,在输入框 `[data-pi-input-textarea]` 输入 `<PROMPT>` 并发送(sentinel 见各条)。
- **选择器约定**:可填/可聚焦的输入元素为 `[data-pi-input-textarea]`(`prompt-input.tsx`);`[data-pi-input-wrapper]` 仅作定位容器(层级/包裹断言用)。
- **缺口处置准则**:任一断言因「单元已验证但浏览器内未接线」失败时,**不改实现逻辑**,如实记录为「缺口」,并指出最小补法(补 stub 产出 / 传装配参数 / 服务静态资源 / 接线宿主插槽),同时仍产出当前态截图作为证据。

---

## Tier 1 — 区域插槽(Slots)

> 协议共定义 18 个 `SlotKey`(`packages/protocol/.../web-ext/descriptor.ts`:`SlotKeySchema`;常量见 `packages/web-kit/src/slots.ts`)。其中宿主 `pi-chat.tsx` 当前经 `<SlotHost ext slot=…>` **实际挂载** 6 个:`background`、`headerLeft`、`headerCenter`、`headerRight`、`footer`、`panelRight`;其余 12 个(`sidebarLeft`/`empty`/`promptInput`/`accessoryAboveEditor`/`accessoryBelowEditor`/`accessoryInlineLeft`/`accessoryInlineRight`/`toolbar`/`notifications`/`statusBar`/`artifactSurface`/`dialogLayer`)为协议保留、未接线。

### Requirement 1: Tier1 `panelRight` 区域面板视觉验收
**Objective:** 作为验收者,我想看到 `panelRight` 插槽内容出现在右侧并列面板,以便确认 Tier1 区域面板生效。
#### Acceptance Criteria
1. 【已接线·硬验收】When 完成共享前置且 `<SOURCE_PATH>` = `./examples/webext-layout-agent`,the 验收 shall 进入会话(`[data-session-active]` 存在)。
2. 【已接线·硬验收】The 浏览器 shall 在右侧面板容器 `[data-pi-chat-aside][data-pi-ext-panel-right]` 内,经 `panelRight` 插槽渲染出 `[data-testid="layout-panel"]`(扩展提供的「领域检视面板」)。
3. 【已接线·硬验收】While 视口为 lg+ 宽度,the 面板 shall 实际可见(`w-96` 并列布局未折叠)。
4. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va1-tier1-panel-right.png`。
5. If `[data-pi-ext-panel-right]` 不存在或内部插槽未渲染,then the 验收 shall 记录为「panelRight 未接线」缺口,指出最小补法(`webext-registry.ts` 匹配 + `pi-chat.tsx` 的 `extension.slots.panelRight` 接线),并产出失败态截图。

### Requirement 2: Tier1 `headerCenter` 顶栏中央插槽视觉验收
**Objective:** 作为验收者,我想看到 `headerCenter` 插槽内容出现在顶栏中央,以便确认 Tier1 三区 header 生效。
#### Acceptance Criteria
1. 【已接线·硬验收】When 完成共享前置且 `<SOURCE_PATH>` = `./examples/webext-layout-agent`,the 验收 shall 进入会话。
2. 【已接线·硬验收】The 浏览器 shall 在 header 容器 `[data-pi-chat-header][data-pi-ext-header]` 内,经 `headerCenter` 插槽渲染出 `[data-testid="layout-header"]`,且其文本等于 `Layout Agent`。
3. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va2-tier1-header-center.png`。
4. If 未命中,then the 验收 shall 记录为「headerCenter 未接线」缺口(`pi-chat.tsx` 的三区 header 接线),并产出失败态截图。

### Requirement 3: Tier1 `headerLeft` / `headerRight` 顶栏侧区视觉验收
**Objective:** 作为验收者,我想确认顶栏左/右插槽已接线,以便覆盖三区 header 的其余两区。
#### Acceptance Criteria
1. 【已接线·硬验收】The 宿主 shall 在 `[data-pi-ext-header]` 内为 `headerLeft` 与 `headerRight` 各挂载 `<SlotHost>`。
2. 【缺口·记录补法】现有示例仅填充 `headerCenter`;If 无示例向 `headerLeft`/`headerRight` 提供内容,then the 验收 shall 记录为「插槽已接线但无示例驱动」,并指出最小补法(在 `webext-layout-agent` 的 `web.config.tsx` 增补 `headerLeft`/`headerRight` 节点),产出当前态截图 `va3-tier1-header-sides.png`。

### Requirement 4: Tier1 `footer` 页脚插槽视觉验收
**Objective:** 作为验收者,我想确认扩展 `footer` 插槽接线,以便覆盖页脚区。
#### Acceptance Criteria
1. 【已接线·硬验收】The 宿主 shall 在 `[data-pi-chat-footer][data-pi-ext-footer]` 挂载 `footer` 插槽。
2. 【缺口·记录补法】If 无示例填充 `footer`,then the 验收 shall 记录缺口与最小补法(示例 `web.config.tsx` 增补 `footer`),产出当前态截图 `va4-tier1-footer.png`。

### Requirement 5: Tier1 自定义背景插槽视觉验收
**Objective:** 作为验收者,我想看到 `webext-background` 的极光背景铺满会话区,以便确认 background 插槽生效。
#### Acceptance Criteria
1. 【已接线·硬验收】When 完成共享前置且 `<SOURCE_PATH>` = `./examples/webext-background-agent`,the 验收 shall 进入会话。
2. 【已接线·硬验收】The 浏览器 shall 存在背景容器 `[data-pi-chat-background]`,且其内由 `background` 插槽渲染出极光背景节点 `.pw-webext-background-aurora`(非空)。
3. 【已接线·硬验收】The 背景容器 shall 为绝对定位铺满(class 含 `absolute inset-0 -z-10`),`evaluate_script` 校验其层级低于输入框包裹层 `[data-pi-input-wrapper]`,即背景不遮挡输入框。
4. While 输入框 `[data-pi-input-textarea]` 可交互,the 验收 shall 以 `take_screenshot` 产出全页截图,命名 `va5-tier1-background.png`。
5. If `[data-pi-chat-background]` 内无扩展背景节点,then the 验收 shall 记录为「background 未接线」缺口,并产出失败态截图。

### Requirement 6: Tier1 协议保留插槽补齐 + 视觉验收(12 插槽)
**Objective:** 作为验收者,我想把协议已定义但宿主未挂载的 12 个插槽补齐为可消费的 `SlotHost`,并在浏览器内逐一验证渲染。
#### Acceptance Criteria
1. 【需补实现·硬验收】For each 协议插槽 in {`sidebarLeft`、`empty`、`promptInput`、`accessoryAboveEditor`、`accessoryBelowEditor`、`accessoryInlineLeft`、`accessoryInlineRight`、`toolbar`、`notifications`、`statusBar`、`artifactSurface`、`dialogLayer`},the 宿主 `pi-chat.tsx` shall 在 design 定义的渲染位置新建 `<SlotHost ext slot="…">` 消费,并赋唯一 data 属性(如 `[data-pi-ext-<slot>]`)。
2. 【需补实现·硬验收】For the 6 个与现有环境 UI 重叠的插槽(`promptInput`/`notifications`/`statusBar`/`artifactSurface`/`dialogLayer`/`empty`),the 实现 shall 按 design 的**去重策略**与现有表面共存(扩展内容追加而非替换内核),不破坏 R12–R17/R21/R28 既有断言。
3. 【需补实现·硬验收】The 验收 shall 为每个插槽提供示例驱动(扩展示例填充该 slot)并 `take_screenshot` 命中对应 `[data-pi-ext-<slot>]`,逐项产出 `va6-slot-<name>.png`。
4. 备注:`sidebarLeft` 需与现有 basic `slots.sidebar`(`[data-pi-chat-sidebar]`)区分,扩展挂载用独立 data 属性。
5. If 某插槽的 UI 语义在 design 阶段判定无意义或与内核冲突无法去重,then 该项 shall 显式记为「设计排除」并说明理由(唯一允许的非 PASS 出口)。

---

## Tier 2 — 渲染器(Renderer Registry)

> 可注册两类渲染器(`packages/ui/src/registry/renderer-registry.ts`):`DataPartRenderer`(`part.type` 以 `data-` 起头)与 `ToolRenderer`(`tool-<name>` / `dynamic-tool`)。扩展后注册者按命名空间优先于宿主。

### Requirement 7: Tier2 自定义 data-part 渲染器视觉验收
**Objective:** 作为验收者,我想看到 `webext-renderer` 的自定义 `data-metric` 渲染器命中,以便确认 Tier2 registry 生效。
#### Acceptance Criteria
1. 【已接线·硬验收】When 完成共享前置且 `<SOURCE_PATH>` = `./examples/webext-renderer-agent`,the 验收 shall 进入会话。
2. 【已接线·硬验收】While 会话内出现 `data-metric` 类型 data-part(渲染容器 `[data-pi-data-part="data-metric"]`),the 浏览器 shall 由扩展注册的 `MetricRenderer` 渲染之,即容器内存在 `[data-testid="metric-card"]` 且含 `label` 与 `value` 文本。
3. While 命中,the 验收 shall 以 `take_screenshot` 产出截图,命名 `va7-tier2-data-renderer.png`。
4. 【部分·stub 驱动】If 当前 stub(`lib/app/stub-agent-process.mjs`)不产出 `data-metric` part(现状:仅产 text/tool/thinking),then the 验收 shall 记录为「需 agent 输出 / 缺口」,并给出最小补法二选一:(a) 在 stub `handlePrompt` 增补确定性 `data-metric` 输出;(b) `evaluate_script` 断言渲染器 registry 含 `data-metric` 键(注册命中),产出当前态截图。

### Requirement 8: Tier2 自定义 tool 渲染器视觉验收
**Objective:** 作为验收者,我想确认 `registerToolRenderer` 可覆盖工具结果渲染,以便覆盖 Tier2 的第二类渲染器。
#### Acceptance Criteria
1. 【已接线·硬验收】The 宿主 shall 支持 `ToolRenderer`(匹配 `tool-<name>` / `dynamic-tool`,`part-renderer.tsx`)。
2. 【缺口·记录补法】If 无 webext 示例注册 tool 渲染器,then the 验收 shall 记录缺口与最小补法(新增示例经 `.pi/web` 注册 `registerToolRenderer("<tool>", Comp)`,并由 stub 产出对应 `tool-<name>` part),产出当前态截图 `va8-tier2-tool-renderer.png`。

### Requirement 9: Tier2 message / part 渲染边界验收
**Objective:** 作为验收者,我想确认 `PartRenderer` 各 part 类型的渲染来源与定制边界,以便明确「哪些可经扩展定制、哪些只能宿主装配、哪些无定制点」。
#### Acceptance Criteria
1. 【边界·说明】The `.pi/web` 扩展 shall 仅能注册 `renderers.tools`(`tool-*`/`dynamic-tool`)与 `renderers.dataParts`(`data-*`)两类 part 渲染器(`define-web-extension.ts`、`renderer-registry.ts`);宿主无 message 级(整条消息)渲染器注册点。
2. 【已接线·硬验收】For each part 类型 in {`text`、`reasoning`、`tool-*`、`data-*`、`step-start`/`file`/`source`}(`part-renderer.tsx`),the 验收 shall 确认其渲染来源:`text`→`Response`(可由宿主 `components.Markdown` 覆盖)、`reasoning`→`PiReasoning`(可由宿主 `components.Reasoning` 覆盖)、`tool-*`→`resolveToolRenderer`、`data-*`→`resolveDataPartRenderer`、`step-start`/`file`/`source`→渲染 `null`(无定制点)。
3. 【边界·说明】The 验收 shall 明确 `text`/`reasoning` 的覆盖属**宿主装配层**(`<PiChat components>`),**不在** agent source 经 `.pi/web` 可注册的范围,故不计入扩展能力硬验收。
4. The 验收 shall 以快照/清单形式产出渲染边界证据 `va9-tier2-part-boundary.md`(随附 stub 默认会话中 `text`/`reasoning`/`tool` part 的截图 `va9-tier2-parts.png`)。
5. 【缺口·记录补法】If 后续需要 message 级渲染器或 `text`/`reasoning` 的扩展级注册,then the 验收 shall 记录为「能力缺口」并指出最小补法(在 `RendererRegistry` 增 message 级注册点 / 将 `components.Markdown`、`components.Reasoning` 纳入扩展 `renderers`)。

---

## Tier 3 — 贡献点 + 环境 UI + 交互对话框

> 贡献点经双向 ui-rpc(`packages/protocol/.../web-ext/ui-rpc.ts`,point ∈ {slash, mention, autocomplete, inlineComplete, custom} + keybindings);环境 UI 经 `extension_ui_request`(`packages/protocol/.../rpc/extension-ui.ts`,method ∈ {notify, select, confirm, input, editor, setStatus, setWidget, setTitle, set_editor_text})。stub 在 sentinel 下确定性驱动。

### Requirement 10: Tier3 slash 命令贡献点视觉验收
**Objective:** 作为验收者,我想在输入 `/` 时看到经 ui-rpc 返回的 slash 候选,以便确认 slash 贡献点端到端。
#### Acceptance Criteria
1. 【已接线·硬验收】When 完成共享前置且 `<SOURCE_PATH>` = `./examples/webext-contrib-agent`,the 验收 shall 进入会话。
2. 【已接线·硬验收】When 在 `[data-pi-input-textarea]` 输入 `/`,the 浏览器 shall 显示命令面板 `[data-pi-command-palette]`,且含至少一项候选 `[data-pi-command-item]`。
3. 【部分·stub 驱动】The 命令面板 shall 含来自 agent(stub,`point:"slash" action:"list"`)的扩展候选(区别于内核 `help`/`clear`);若上浮,断言对应 `[data-pi-command-item]` 命中。
4. 【已接线·硬验收】When 选中一项候选,the 输入框 shall 应用该命令(execute / 填充)。
5. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va10-tier3-slash.png`。
6. If 扩展候选未上浮(仅内核项),then the 验收 shall 记录 ui-rpc 接线缺口(`packages/react/src/sse/control-store.ts` → `pi-command-palette.tsx`),产出当前态截图。

### Requirement 11: Tier3 @mention 贡献点视觉验收
**Objective:** 作为验收者,我想在输入 `@` 时看到经 ui-rpc 返回的 mention 候选,以便确认 mention 贡献点。
#### Acceptance Criteria
1. 【部分·stub 驱动】When 在 `webext-contrib-agent` 会话的 `[data-pi-input-textarea]` 输入 `@`,the 浏览器 shall 显示补全浮层,且含来自 agent(stub,`point:"mention"`)的候选。
2. 【已接线·硬验收】The mention 浮层 shall 与 slash 浮层逻辑隔离(各自触发字符 `@` / `/`)。
3. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va11-tier3-mention.png`。
4. If 未接线,then the 验收 shall 记录缺口与最小补法,产出当前态截图。

### Requirement 12: Tier3 环境 UI — 会话标题(setTitle)视觉验收
**Objective:** 作为验收者,我想确认扩展可设置会话标题,以便覆盖 `setTitle` 环境动作。
#### Acceptance Criteria
1. 【部分·stub 驱动】When 完成共享前置且 `<PROMPT>` 含 sentinel `ext-ui`,the stub shall 发 `extension_ui_request` `setTitle`。
2. 【已接线·硬验收】The 浏览器 shall 在 `[data-pi-extension-header]` 内的 `[data-pi-extension-title]` 显示标题文本 `Stub Extension Title`。
3. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va12-tier3-set-title.png`。
4. If 标题区不渲染,then the 验收 shall 记录缺口(`pi-chat.tsx` 的 `ambientTitle` 接线),产出失败态截图。
> 对照资产:`e2e/browser/extension-ui-surfaces.e2e.ts` 已绿覆盖本断言。

### Requirement 13: Tier3 环境 UI — 状态栏(setStatus)视觉验收
**Objective:** 作为验收者,我想确认扩展可设置状态栏项,以便覆盖 `setStatus` 环境动作。
#### Acceptance Criteria
1. 【部分·stub 驱动】When `<PROMPT>` 含 `ext-ui`,the stub shall 发 `setStatus`(`statusKey:"branch"`, `statusText:"main-branch"`)。
2. 【已接线·硬验收】The 浏览器 shall 在状态栏 `[data-pi-status-bar]` 内显示 `[data-pi-status][data-status-key="branch"]`,其展示文本等于 `main-branch`。
3. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va13-tier3-set-status.png`。
4. If 不渲染,then the 验收 shall 记录缺口(`status-bar.tsx` + `pi-chat.tsx` 接线),产出失败态截图。
> 对照资产:`e2e/browser/extension-ui-surfaces.e2e.ts` 已绿覆盖本断言。

### Requirement 14: Tier3 环境 UI — 浮窗部件(setWidget)视觉验收
**Objective:** 作为验收者,我想确认扩展可在编辑器上/下方挂浮窗部件,以便覆盖 `setWidget` 环境动作。
#### Acceptance Criteria
1. 【部分·stub 驱动】When `<PROMPT>` 含 `ext-ui`,the stub shall 发 `setWidget`(`widgetKey:"ctx"`, `widgetLines:["Widget line alpha","Widget line beta"]`, `widgetPlacement:"aboveEditor"`)。
2. 【已接线·硬验收】The 浏览器 shall 在 `[data-pi-widgets][data-pi-widget-placement="aboveEditor"]` 内显示 `[data-pi-widget][data-widget-key="ctx"]`,且其内含两行 `[data-pi-widget-line]`(`alpha`/`beta`)。
3. 【已接线·硬验收】The 部件 shall 位于输入编辑器之上(`aboveEditor` 放置)。
4. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va14-tier3-set-widget.png`。
5. If 不渲染,then the 验收 shall 记录缺口,产出失败态截图。
> 对照资产:`e2e/browser/extension-ui-surfaces.e2e.ts` 已绿覆盖本断言。

### Requirement 15: Tier3 环境 UI — 通知(notify)视觉验收
**Objective:** 作为验收者,我想确认扩展可弹出通知,以便覆盖 `notify` 环境动作。
#### Acceptance Criteria
1. 【部分·stub 驱动】When `<PROMPT>` 含 `ext-ui`,the stub shall 发 `notify`(`message:"Build complete"`, `notifyType:"info"`)。
2. 【已接线·硬验收】The 浏览器 shall 在 `[data-pi-notifications]` 内显示 `[data-pi-notification][data-pi-notify-type="info"]`,文本含 `Build complete`,且含可点的 `[data-pi-notification-dismiss]`。
3. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va15-tier3-notify.png`。
4. If 不渲染,then the 验收 shall 记录缺口,产出失败态截图。
> 对照资产:`e2e/browser/extension-ui-surfaces.e2e.ts` 已绿覆盖本断言。

### Requirement 16: Tier3 环境 UI — 预填输入框(set_editor_text)视觉验收
**Objective:** 作为验收者,我想确认扩展可预填输入框内容,以便覆盖 `set_editor_text` 环境动作。
#### Acceptance Criteria
1. 【部分·stub 驱动】When `<PROMPT>` 含 `ext-ui`,the stub shall 发 `set_editor_text`(`text:"prefilled-by-extension"`)。
2. 【已接线·硬验收】The 浏览器 shall 使 `[data-pi-input-textarea]` 的值变为 `prefilled-by-extension`。
3. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va16-tier3-editor-text.png`。
4. If 不生效,then the 验收 shall 记录缺口(`pi-chat.tsx` 的 `editorText` 接线),产出失败态截图。

### Requirement 17: Tier3 交互对话框 — 确认(confirm)视觉验收
**Objective:** 作为验收者,我想确认扩展可发起确认对话框并回收结果,以便覆盖 `confirm` 交互闭环。
#### Acceptance Criteria
1. 【已接线·硬验收】When 完成共享前置并发任意 prompt,the stub shall 在该轮发 `extension_ui_request` `confirm`(默认行为,无需 sentinel)。
2. 【已接线·硬验收】The 浏览器 shall 显示 `[data-pi-interaction-active][data-pi-interaction-method="confirm"]`,含 `[data-pi-confirm-ok]` 与 `[data-pi-confirm-cancel]`。
3. 【已接线·硬验收】When 点击 `[data-pi-confirm-ok]`,the 浏览器 shall 出现 `[data-pi-interaction-resolved][data-pi-interaction-outcome="confirmed"]`(或等价 outcome)且会话继续。
4. The 验收 shall 在「待应答」与「已解决」两态各产出截图 `va17-tier3-confirm-pending.png` / `va17-tier3-confirm-resolved.png`。
> 对照资产:`e2e/browser/extension-ui-surfaces.e2e.ts` 已绿覆盖 confirm 不被推送遮挡。

### Requirement 18: Tier3 交互对话框 — 选择(select)视觉验收
**Objective:** 作为验收者,我想确认扩展可发起选项对话框,以便覆盖 `select` 交互。
#### Acceptance Criteria
1. 【部分·stub 驱动】When `<PROMPT>` 含 sentinel `ext-select`,the stub shall 先发 `select`、应答后再发 `confirm`(两步闭环)。
2. 【已接线·硬验收】The 浏览器 shall 显示 `[data-pi-interaction-active][data-pi-interaction-method="select"]`,含多个 `[data-pi-select-option]`。
3. 【已接线·硬验收】When 选定一项,the 验收 shall 见 `[data-pi-interaction-resolved]` 并续进到 confirm 步。
4. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va18-tier3-select.png`。

### Requirement 19: Tier3 交互对话框 — 输入 / 编辑器(input / editor)缺口验收
**Objective:** 作为验收者,我想确认 `input` / `editor` 两类交互表面已接线,以便覆盖剩余对话框类型。
#### Acceptance Criteria
1. 【已接线·硬验收】The 宿主 `pi-interaction.tsx` shall 已实现 `input`(`[data-pi-input]`)与 `editor`(`[data-pi-editor]`)渲染分支。
2. 【缺口·记录补法】现有 stub 仅驱动 `confirm`/`select`;If 无 sentinel 驱动 `input`/`editor`,then the 验收 shall 记录缺口与最小补法(在 stub 增 `ext-input`/`ext-editor` sentinel 发对应 `method`),产出当前态截图 `va19-tier3-input-editor.png`。

### Requirement 20: Tier3 其余贡献点补齐 + 视觉验收(autocomplete / inlineComplete / custom / keybindings)
**Objective:** 作为验收者,我想把协议已定义但宿主未消费的 4 个贡献点补齐为可用,并在浏览器内验证其效果。
#### Acceptance Criteria
1. 【需补实现·硬验收】For each point in {`autocomplete`、`inlineComplete`、`custom`、`keybindings`},the 宿主 shall 在 design 定义的接入点新建消费逻辑(经 ui-rpc 或本地声明),使扩展贡献生效。
2. 【需补实现·硬验收】The 验收 shall 为每个贡献点提供 stub/示例驱动并 `take_screenshot` 证明效果:`autocomplete`/`inlineComplete` 在输入框出补全、`keybindings` 触发 commandId、`custom` 走扩展自定义 payload;逐项产出 `va20-point-<name>.png`。
3. If 某贡献点的宿主 UI 语义在 design 阶段判定不适用,then 该项 shall 显式记为「设计排除」并说明理由。

---

## Tier 4 — Artifact 与 Server-Driven UI

### Requirement 21: Tier4 artifact sandbox iframe 视觉验收
**Objective:** 作为验收者,我想看到 `webext-artifact` 的 sandbox iframe 渲染,以便确认 Tier4 隔离表面。
#### Acceptance Criteria
1. 【已接线·硬验收】When 完成共享前置且 `<SOURCE_PATH>` = `./examples/webext-artifact-agent`,the 验收 shall 进入会话。
2. 【已接线·硬验收】The 浏览器 shall 渲染 artifact iframe `[data-pi-artifact]`,其 `sandbox` 含 `allow-scripts` 且**不含** `allow-same-origin`(不透明 origin),`src` 指向声明入口 `artifact.html`。
3. 【已接线·硬验收】The iframe 内文档 shall 加载到 artifact 内容(`#root` 文本含 `webext-artifact-agent · sandboxed artifact`)。
4. While 渲染成功,the 验收 shall 以 `take_screenshot` 产出截图,命名 `va21-tier4-artifact.png`。
5. 【缺口·记录补法】If app 装配未提供 artifact 基址(iframe 缺失或 `src` 404),then the 验收 shall 记录缺口与最小补法(向 `<PiChat>` 传 `extensionBaseUrl` 并在隔离 build 下服务 `.pi/web/artifact.html`),产出失败态截图。

### Requirement 22: Tier4 artifact↔宿主 postMessage 契约视觉验收
**Objective:** 作为验收者,我想确认 artifact 的 `ready`/`resize`/`rpc` 消息被宿主正确处理,以便覆盖隔离通信契约。
#### Acceptance Criteria
1. 【部分·stub 驱动】When artifact 发出 `resize`(`artifact.ts` 契约),the 宿主 shall 调整 iframe 高度;`evaluate_script` 校验 `[data-pi-artifact]` 高度随之变化。
2. 【缺口·记录补法】If 当前 artifact 示例不主动发 `resize`/`rpc`,then the 验收 shall 记录缺口与最小补法(在 `artifact.html` 内发 postMessage),并记录 `event` 消息当前被宿主接收后丢弃,产出当前态截图 `va22-tier4-postmessage.png`。

### Requirement 23: Tier4 Server-Driven 内置组件(builtin)视觉验收
**Objective:** 作为验收者,我想看到 `data-pi-ui` 的 7 个内置白名单组件渲染,以便确认 server-driven UI 零配置渲染。
#### Acceptance Criteria
1. 【已接线·硬验收】The 宿主 shall 默认注册 `data-pi-ui` 渲染器(`pi-chat.tsx` → `PiUiPart`)。
2. 【已接线·硬验收】For each component in {`metric`、`keyValue`、`table`、`alert`、`progress`、`card`、`codeBlock`}(`builtin-components.tsx`),当 agent emit 对应 `kind:"builtin"` 规格时,the 浏览器 shall 在 `[data-pi-ui-part="builtin"]` 内渲染 `[data-pi-ui-builtin="<component>"]`。
3. 验收驱动源:`<SOURCE_PATH>` = `./examples/server-driven-ui-agent`,prompt 请求「show the dashboard」。
4. The 验收 shall 以 `take_screenshot` 逐组件或整屏产出截图,命名 `va23-tier4-builtin-<component>.png`。
5. 【缺口·记录补法】If `server-driven-ui-agent` 需真实 LLM/API key 而 stub 不 emit `data-pi-ui`,then the 验收 shall 记录缺口与最小补法(stub 增补确定性 `data-pi-ui` builtin 输出),产出当前态截图。

### Requirement 24: Tier4 Server-Driven 沙箱节点树(sandbox)视觉验收
**Objective:** 作为验收者,我想看到 `kind:"sandbox"` 声明式节点树由受限解释器渲染,以便确认沙箱渲染路径。
#### Acceptance Criteria
1. 【已接线·硬验收】When agent emit `kind:"sandbox"` 节点树,the 浏览器 shall 在 `[data-pi-ui-part="sandbox"]` 内渲染受限元素集合(`box`/`text`/`heading`/`badge`/`divider`/`code`/`link`/`list`/`keyValue`/`table`/`image`)。
2. 【已接线·硬验收】The 沙箱 shall 仅接受协议白名单样式 token 与安全协议 `href`/`src`(无任意 CSS / 无脚本执行),非法规格落到 `[data-pi-ui-fallback]`。
3. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va24-tier4-sandbox.png`。
4. 【缺口·记录补法】If stub 不 emit sandbox 规格,then the 验收 shall 记录缺口与最小补法(stub 增补确定性 sandbox 输出),产出当前态截图。

---

## Tier 5 — 声明式配置(Declarative)

### Requirement 25: Tier5 零代码声明式 source 视觉验收
**Objective:** 作为验收者,我想确认纯声明 source 不加载 bundle、默认聊天可用,以便确认零代码路径。
#### Acceptance Criteria
1. 【已接线·硬验收】When 完成共享前置且 `<SOURCE_PATH>` = `./examples/webext-declarative-agent`,the 验收 shall 进入会话。
2. 【已接线·硬验收】The 浏览器 shall 不渲染扩展面板(`[data-pi-ext-panel-right]` 不存在)且 header 无 `[data-pi-ext-header]`。
3. 【已接线·硬验收】The 验收 shall 经 `list_network_requests` 校验未加载扩展 bundle(无 `web-extension.mjs` 请求)。
4. 【已接线·硬验收】The 默认聊天 shall 可用(`[data-pi-input-textarea]` 可聚焦可输入)。
5. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va25-tier5-declarative.png`。
6. If 出现扩展面板或加载了 `web-extension.mjs`,then the 验收 shall 记录「声明式 source 误加载代码层」缺口(`webext-registry.ts` 的 `DECLARATIVE` 分支),产出失败态截图。
> 对照资产:`e2e/browser/webext.e2e.ts` 已绿覆盖零 bundle 回退。

### Requirement 26: Tier5 声明式 theme token 视觉验收
**Objective:** 作为验收者,我想确认 manifest 声明的 theme token 被应用,以便覆盖声明式主题。
#### Acceptance Criteria
1. 【缺口·记录补法/待确认】When 加载 `webext-declarative-agent`(manifest `config.theme`,如 `--pw-webext-declarative-accent`),the 浏览器 shall 在会话根作用域上设置该 CSS 自定义属性。
2. 【已接线·硬验收】The 验收 shall 经 `evaluate_script` 读取计算样式校验该 `--pw-<id>-*` token 生效,且未污染宿主全局 token(命名空间隔离)。
3. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va26-tier5-theme-token.png`。
4. If 未应用(`chat-app.tsx` 未把 `config.theme` 透传 `<PiChat>`),then the 验收 shall 记录缺口与最小补法(透传 `theme` prop 并在会话根注入 CSS 变量),产出当前态截图。

### Requirement 27: Tier5 声明式 layout preset 视觉验收
**Objective:** 作为验收者,我想确认 manifest 声明的 layout 预设切换会话布局,以便覆盖声明式布局。
#### Acceptance Criteria
1. 【已接线·硬验收】The 声明式 `config.layout` ∈ {`centered`、`wide`、`full`、`split`} shall 经 `layoutClassNames(layout)`(`pi-chat.tsx`)映射到对应容器宽度类(如 `centered`→`max-w-3xl`、`wide`→`max-w-5xl`、`full`→`w-full`、`split`→让位右侧)。
2. 【缺口·记录补法/待确认】When 加载声明 `layout` 的 source,the 验收 shall 经 `evaluate_script` 校验会话容器命中对应宽度类;若 `chat-app.tsx` 未透传 `layout` prop,记录缺口与最小补法。
3. 【缺口·记录补法】If 现有 `webext-declarative-agent` 仅声明部分 preset,then the 验收 shall 记录其余 preset 缺示例并给出最小补法(manifest 增声明),产出截图 `va27-tier5-layout-preset.png`。

---

## 内核不变(Model A)

### Requirement 28: 内核不变 — 会话/输入/消息区视觉验收
**Objective:** 作为验收者,我想确认加载任一扩展后内核(会话/输入/消息区)仍在,以便确认扩展未接管内核。
#### Acceptance Criteria
1. 【已接线·硬验收】While 已加载任一扩展(至少覆盖 `webext-layout-agent`、`webext-background-agent`、`webext-contrib-agent` 三类加载代码层的 source),the 浏览器 shall 存在会话根 `[data-session-active]`。
2. 【已接线·硬验收】The 浏览器 shall 仍显示内核输入元素 `[data-pi-input-textarea]`(可聚焦可提交)与消息区 `[data-pi-chat-messages]`。
3. While 每个被测 source 下内核元素均存在,the 验收 shall 各产出截图 `va28-kernel-<source-slug>.png`。
4. If 任一 source 下内核缺失,then the 验收 shall 记录「扩展接管内核」回归缺口并指出涉及插槽接线,产出失败态截图。

### Requirement 29: 内核不变 — 核心控件(模型选择 / thinking-level / 命令面板)视觉验收
**Objective:** 作为验收者,我想确认核心控件在扩展加载后仍可用,以便覆盖内核控件层。
#### Acceptance Criteria
1. 【已接线·硬验收】While 任一扩展已加载,the 浏览器 shall 仍渲染模型选择器 `[data-pi-model-selector]`(`[data-pi-model-trigger]` 可展开 `[data-pi-model-panel]`、含 `[data-pi-model-option]`)与 thinking-level 控件 `[data-pi-thinking-level]`。
2. 【已接线·硬验收】When 在 `[data-pi-input-textarea]` 输入 `/`,the 命令面板 `[data-pi-command-palette]` shall 仍可用(内核基础命令不被扩展接管)。
3. 【部分·stub 驱动】When 选定一个模型选项,the stub shall 以 `set_model` ack 该 `Model`,the 选择器 shall 反映选中态。
4. The 验收 shall 以 `take_screenshot` 产出截图,命名 `va29-kernel-controls.png`。
