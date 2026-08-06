# pi-web UI 重构设计规范

状态：提案稿  
范围：现有 Vite + React SPA、`@blksails/pi-web-ui`、应用壳 `components/chat-app.tsx`  主要原则：保留能力与交互契约，只重构视觉层、信息层级与响应式编排。

## 1. 设计判断

**Design Read：** 面向 Agent 作者与平台集成方的开发者工作台，采用安静、可读、黑白灰阶、带工具感的技术编辑器语言，基于现有 shadcn/ui + Radix + Tailwind 3 token 体系演进。

Taste Skill 属反模板化前端规约，原生更偏营销页；本项目为高密度产品 UI，故只吸收其有效约束：单一视觉系统、少卡片、少装饰、明确状态、动效服务反馈、响应式与无障碍优先。不得把营销页的 Hero、Bento、滚动叙事强塞进聊天工作台。

三档设计旋钮：

| 旋钮 | 目标值 | 说明 |
| --- | ---: | --- |
| `DESIGN_VARIANCE` | 5 | 以结构清晰为主，局部非对称用于区分侧栏、对话、工具面板 |
| `MOTION_INTENSITY` | 4 | 只做状态过渡、流式反馈、面板开合与 hover，尊重 reduced motion |
| `VISUAL_DENSITY` | 6 | 日常开发工具密度，减少空白与重复装饰，但保留阅读呼吸 |

## 2. 当前能力基线

### 2.1 现有信息架构

| 路由 | 当前职责 | 重构决策 |
| --- | --- | --- |
| `/` | Agent source 选择、目录输入、默认源、源列表、收藏、桌面目录浏览 | 保留；改为更快的启动工作台 |
| `/session/:id` | 冷恢复会话、回放历史、继续对话 | 保留；保持 URL 与恢复链路 |
| `/settings` | Schema 驱动配置域、全局/项目设置、资源管理 | 保留；改为设置工作台布局 |

### 2.2 现有 shell

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 左侧栏 256px                       │ PiChat 主列             │ Pane │
│ LauncherRail                       │ header / empty / log    │ 可选 │
│ SessionListPanel                   │ Conversation            │      │
│ account / theme / locale           │ prompt dock / stats     │      │
└──────────────────────────────────────────────────────────────────────┘
```

当前交互已覆盖：

- Agent source：本地路径、git URL、源列表、收藏、默认源、桌面目录选择、会话内 dialog。
- 会话列表：全局列表、分页、搜索、恢复、收藏置顶、重命名、删除二次确认、工作中/等待输入/异常状态。
- 对话：流式文本、Markdown、思考、工具调用、工具结果、分支切换、复制与反馈、通知、状态条。
- 输入：多行输入、Enter 发送、Shift+Enter 换行、Alt+Enter follow-up、附件、模型、语音、联网、停止、Bash 模式。
- Agent 交互：`/` 命令补全、`@` mention、keybinding 填充、队列面板、Esc 或 Alt+↑ 取回队列。
- 扩展：21 个 slot、渲染器 registry、UI RPC、Artifact iframe、声明式 theme/layout/empty。
- 工具面板：右侧 Pane、日志面板四种位置、Canvas 画廊与工作台、图片回流对话。
- 配置：Provider、模型、思考等级、外观、路径显示、扩展参数、独立 JSON 配置文件、日志、MCP、AIGC 等配置域。

### 2.3 当前视觉问题

1. shadcn 默认中性主题覆盖面广，但主次层级弱，侧栏、对话区、输入区缺少清晰的 surface 分层。
2. `rounded-md`、`rounded-lg`、`rounded-2xl`、pill 与边框阴影并存，组件形状不成系统。
3. 侧栏底部同时承载设置、登录、语言、主题，入口可发现性低；主区无会话上下文带。
4. 消息区已具备丰富状态，但流式、工具、思考、附件之间的视觉权重未充分拉开。
5. PromptInput 承载控件较多，队列、附件、Bash、补全浮层容易互相抢空间。
6. 空态起始卡片目前是对称网格，首屏没有体现 source、工作目录、可用能力。
7. settings 仍是窄容器加左侧菜单，适合少量表单，不适合配置域、扩展参数与资源管理增长。
8. 当前应用主题控制在 `src/theme-controls.tsx` 内以 `light` 起步，设置中的 `system` 语义未形成统一入口。
9. UI 包使用 Lucide fallback，应用壳另有内联 SVG；图标尺寸与按钮命中区需统一。

## 3. 目标体验

### 3.1 一句话

让用户一眼知道当前 Agent、当前会话、当前状态、下一步能做什么；让工具信息出现时可读，消失时不留噪音。

### 3.2 不变项

- 不改 `/`、`/session/:id`、`/settings` 路由。
- 不改 `CreateSessionRequest`、配置字段名与顺序、队列与附件协议。
- 不改 `data-*` 测试锚点；新增锚点须语义化命名。
- 不改 PiChat 的 slot、renderer、Pane、Surface 与 Artifact 安全边界。
- 不迁移 Vite、React Router、Tailwind、shadcn/ui、Radix、AI SDK。
- 不用新状态推断服务端 busy；继续消费 `activity` 与 lifecycle 权威快照。

### 3.3 目标布局

```text
桌面宽屏 >= 1280
┌──────────┬──────────────────────────────────────────┬──────────────┐
│ 侧栏     │ 消息流，宽度 760-1040，正文 68ch           │ Pane 标题带   │
│ 232-248  ├──────────────────────────────────────────┼──────────────┤
│ 当前Agent│ 生成图、工具链、素材引用均可完整展开       │ 工具/日志/画布 │
│ 新建     │ 生成图、工具链、素材引用均可完整展开       │ 可拖拽         │
│ 会话     ├──────────────────────────────────────────┤              │
│ 账户     │ 输入 dock + 队列 + stats                   │              │
└──────────┴──────────────────────────────────────────┴──────────────┘

中宽 768-1279：侧栏 216px；Pane 转为右侧 overlay / drawer，不挤压消息列。
窄屏 < 768：侧栏与 Pane 均为 sheet；消息列满宽；输入 dock 固定在底部安全区内。
容器宽度 < 680px：侧栏自动收为 72px 图标栏；用户可用箭头暂时展开。

原型借鉴花影 AIGC 工作台的三段式关系、素材结果网格与工具抽屉；移除其全局顶栏，保留 pi-web 原有会话、队列、附件、模型与设置入口。
```

## 4. 视觉系统

全局不设独立 header。应用直接从侧栏、当前会话上下文与消息流开始；上下文条只服务当前会话，不承载全局导航。

### 4.1 主题与颜色

保留 CSS variables 与 `dark` class。新增语义 token，不在组件内写颜色字面量。

本版定为黑白灰阶。黑用于主操作、当前会话、工具结果与关键文字；白用于主要阅读面；灰用于层级、边界与次要信息。界面不以色相区分状态。

| Token | Light 建议 | Dark 建议 | 用途 |
| --- | --- | --- | --- |
| `--background` | `#ffffff` | `#0b0b0b` | 页面底色 |
| `--canvas` | `#ffffff` | `#141414` | 对话画布 |
| `--sidebar` | `#ffffff` | `#101010` | 左侧栏 |
| `--surface` | `#ffffff` | `#1d1d1d` | 输入、浮层、可交互区域 |
| `--surface-subtle` | `#f6f6f6` | `#242424` | 次级区域 |
| `--primary` | `#171717` | `#f5f5f5` | 主操作 |
| `--primary-foreground` | `#ffffff` | `#111111` | 主操作文字 |
| `--muted-foreground` | `#727272` | `#a2a2a2` | 次要文字 |
| `--border` | `#e1e1e1` | `#383838` | 分隔线与边界 |
| `--ring` | `#171717` | `#ffffff` | focus |
| `--destructive` | `#171717` | `#ffffff` | 删除与错误，须伴随文字或图标 |

约束：

- 不引入青、紫、红、黄等色相；品牌识别由黑色块、细线、字重与留白承担。
- 禁用渐变、霓虹 glow、彩色状态点与彩色大面积面板。
- 页面维持单一主题；只允许同一灰阶的 surface 深浅变化。
- 正文与控件文字达 WCAG AA；主要正文目标 AAA。
- `working` 用实心方点与 `Working`；`awaiting-input` 用空心方点与文字；`error` 用斜线标记与错误文案。

### 4.2 字体

- UI 正文：优先 `Geist` 或已部署的系统 UI sans；无字体资源时使用现有系统栈，不强加运行时依赖。
- 路径、session id、JSON、token、快捷键、统计数字：`ui-monospace`，启用 tabular figures。
- 标题不靠超大字号制造层级，使用 20-28px、500 权重、紧凑行高。
- 正文 14px；辅助 12px；最小不低于 11px。
- 中文与英文混排保持 sentence case，不使用全屏大写装饰标签。

### 4.3 形状、边框、阴影

采用三档半径，统一全站：

| 层级 | 半径 | 示例 |
| --- | ---: | --- |
| 外层面板 | 10px | Pane、dialog、设置主区域 |
| 控件 | 7px | input、button、菜单项、session item |
| 内部内容 | 4px | code、tool result、状态标记 |

- 结构容器默认透明，不给每一行加卡片 chrome。
- 最外层工作区不设设计边框或圆角；网页根容器铺满可用宽度，边界仅由左栏、聊天列、Pane 与输入区域内部 1px 分隔线表达。
- 只有需要与消息流分离的输入、dialog、Pane 使用 surface + border。
- 阴影只给浮层、dialog、拖拽中的 Pane；使用同色系低透明阴影。
- 用 1px 分隔线组织列表，避免每行上下双边框。

### 4.4 图标

- 先复用现有 `IconTheme` 注入点，统一 16px、命中区至少 32px。
- UI 包当前 Lucide fallback 保持兼容；新图标不再新增内联 SVG。
- icon-only control 必须有 `aria-label`、tooltip 与 focus ring。
- 状态不得只靠颜色：同时用图标、文字或形状表达。

## 5. 页面与组件规范

### 5.1 新会话页

目标：从「填路径」升级为「选择工作入口」，不改变提交语义。

```text
┌──────────────────────────────────────────────┐
│ pi-web                                       │
│                                              │
│ 从推荐 Agent 开始                              │
│ 高频入口先行，全部来源另页管理。               │
│                                              │
│ [推荐 Agents]                                 │
│ [方标] AIGC Studio     生图/画布/素材          │
│ [方标] Coding Agent    文件/命令/日志          │
│ [方标] Research Agent  搜索/资料/引用          │
│                                              │
│ 加载本地 Agent                                │
│ [ C:\\workcode\\aigc-agent              ]    │
│ [浏览文件夹]                                  │
│                                              │
│ [开始会话]    查看全部 Agents                 │
└──────────────────────────────────────────────┘
```

- 推荐列表保留 loading、error、empty、不可运行状态；全部来源移至独立管理页。
- 独立管理页承载几十个来源、收藏、默认源、远程 URL 与本地目录加载。
- 源卡片改为低 chrome 行式列表，方形标识、agent 名、能力摘要、路径分层；不使用九张同构大卡片。
- 默认展示能力较完整的 `aigc-agent`，强化列出 `Image generation`、`Image edit`、`Canvas`、`Search`、`Materials`、`Media tools`；`hello-agent` 仅作最小兼容源，不作为主示例。
- Agent 名为第一信息层；能力以细线分组和文本列表呈现，不靠彩色徽章堆叠。
- `loading` 时只禁用提交与被创建的源项，保留输入可编辑与浏览按钮语义。
- 创建错误内联显示；不使用 alert。
- dialog 版本使用同一内容，不重做另一套视觉。

### 5.2 会话 shell

#### 左侧栏

顺序固定：

1. 当前 Agent：左上展示名称、能力摘要、工作状态。
2. `New chat`：主按钮，回到推荐源选择器。
3. `Search`：展开本地/服务端会话搜索输入。
4. 历史会话：单一列表，保留状态、时间、source 摘要。
5. 账户区：设置、登录态、语言、主题。

表现规则：

- 左栏不展示 Agent source 分组；几十个 source 进入独立管理页。
- 新会话页只展示 3 个推荐 Agent，并提供「查看全部 Agents」与「加载本地 Agent」。
- 左栏可手动收起为 72px 图标栏；容器宽度低于 680px 自动收起，点击箭头可临时展开。
- 收起态保留当前 Agent 首字母、状态点、会话行 tooltip 与账户入口，不丢交互。
- 当前会话用黑色侧线 + 微弱 surface，不用大面积高亮。
- 空闲行不显示状态点；只在 `working`、`awaiting-input`、`error` 时显示真实状态。
- 时间与 cwd 作为 hover、辅助文本或详情菜单，不挤占标题主位。
- `⋯` 菜单保留 stopPropagation，避免误触恢复。
- 搜索结果与会话列表共用 row，不另造搜索卡片。

#### 当前 Agent 与工具入口

不设独立 context strip，不恢复全局 header：

```text
左栏顶部：Agent  ⌄  /  ‹
当前 Agent：AIGC Studio
右上角：`PanelRightIcon` 符号按钮（展开 / 隐藏 Pane）
输入 dock：附件  模型  思考  联网  队列
```

- 左栏顶部先放「Agent」切换与收起按钮，再显示当前 Agent；收起态仅保留 Agent、展开、新建、搜索、会话状态点、设置与主题图标。
- Pane 入口仅在关闭态显示于聊天区右上角，仅显示 `PanelRightIcon` 符号；打开后入口消失，只留 Pane 顶栏收起符号。以 `aria-label` 与 tooltip 区分「打开工具面板 / 收起 Pane 侧栏」，不在输入 dock 增加工具面板文字按钮。
- Pane 按仓库真实 `PanesHost` 结构呈现：紧凑多 Tab 顶栏、当前 Tab、Tab 关闭、更多 Pane、新开 Pane、刷新与切换器入口；内容区只显示当前 Pane，切换不丢状态。
- 设置、主题、语言仍在左侧账户区，避免重复导航。

### 5.3 消息流

- 消息列默认 `max-width: 860px`，正文阅读宽度 `68ch`。
- 用户消息：右对齐、黑底白字、7px 半径，保留附件与发送时间语义。
- Assistant 消息：左对齐、无大卡片；正文、思考、工具结果按层级递进。
- Tool part：使用左侧状态线与可折叠标题；运行中显示真实 spinner，完成后变为静态状态。
- 黑底仅用于用户消息；Assistant 工具结果、代码与状态块使用白 / 浅灰 surface + 左侧状态线，禁止与用户气泡同色。
- Reasoning：默认折叠或弱化；流式时可展开，结束后收敛为一行摘要。
- Markdown code：内部 4px 半径，横向滚动独立存在，复制按钮常驻可发现。
- 图片：缩略图有固定占位比例；点击仍进入 Canvas / gallery，保留 `data-att-id`。
- AIGC source：复用 `promptToolbar` 快捷动作，默认展示「生成海报」「局部重绘」「扩图」「搜图」；不取代原附件、模型、思考、联网与队列控件。
- AIGC 输出：工具结果可直接承载多图结果、生成参数与 `status`；选中资产后通过现有 Canvas / Materials pane 继续编辑或带回对话。
- Branch：在消息操作行内，以 `current / total` 表达，不抢正文权重。
- 通知：info 轻量自动消失；warning/error 持续可关闭，颜色之外带文字级别。

### 5.4 空态

空态不再使用四张等高卡片作为主视觉，改为：

```text
当前 Agent source
source title                         Ready
cwd / path

今天可以从这里开始
[运行一个检查] [解释这个项目] [创建一个文件]

输入框
```

- starters 仍来自 `suggestionsPresets` / `extension.config.empty.starters`。
- 只展示 2-4 个高价值 starter；扩展可替换内容，不改变输入与发送回调。
- 没有 starter 时不保留空白网格。

### 5.5 Prompt dock

输入区是主操作面，不做漂浮胶囊。

```text
┌────────────────────────────────────────────┐
│ attachments / queue summary                 │
│ [消息输入区，自动增高，最大 10 行]      [↑] │
│ [附件] [model] [思考] [联网] [语音] [停止]   │
└────────────────────────────────────────────┘
```

- 保留 Enter、Shift+Enter、Alt+Enter、Esc、Alt+↑ 语义。
- queue panel 紧贴输入 dock 上缘；仅有队列时出现，显示 steering/follow-up 分组与合计。
- `clearQueue` 失败不改输入内容，改以 dock 内错误提示。
- Bash 模式只改变边框、标签与 placeholder，不更改输入结构。
- 命令补全、mention 补全锚定真实 caret；浮层与 dock 同一 surface、同一 z-index 层级。
- 发送按钮 desktop 可带文字，窄屏可 icon-only；停止按钮保持 destructive 语义。

### 5.6 Pane、日志、Canvas

- Pane 默认右侧 360-480px；顶栏采用多 Tab 侧栏，不再额外堆叠一层大标题。当前 Tab 显示来源名，右侧保留关闭、更多、新开、刷新与切换器等符号入口。
- 右侧面板仅在有真实内容时占位；关闭后消息列立即扩展。
- 拖拽时只预览宽度，松手后提交，保持既有 rAF 逻辑。
- 窄屏 Pane 变为 sheet，打开/关闭不破坏对话滚动位置。
- 日志位置仍支持 `bottom`、`top`、`right`、`drawer`；视觉上统一为日志 surface，过滤器保留。
- Canvas 维持画廊、版本条、工具轨、舞台、提示词栏、带入对话、vision 回流；重构只改 chrome 与层级。
- Artifact 继续 iframe 隔离，扩展 slot 继续 additive，不允许扩展改写宿主全局。

### 5.7 设置页

```text
┌────────────────────────────────────────────────────────┐
│ 设置                                     [返回会话]    │
├────────────┬───────────────────────────────────────────┤
│ 模型       │ 通用                                       │
│ 外观       │ 字段组标题                                  │
│ 日志       │ 表单字段                                    │
│ 扩展       │ 表单字段                                    │
│ MCP        │ [保存]  已保存 / 错误                         │
│ 资源       │                                           │
└────────────┴───────────────────────────────────────────┘
```

- 继续使用 `SettingsRegistry`、`SchemaForm`、`FieldRegistry`，不为配置域手写第二套表单。
- 左侧导航在窄屏折为 select 或横向 tab；表单顺序、字段名、保存契约不变。
- loading 为骨架块；load/save error 在面板内显式；saved 状态不依赖 toast。
- `system` 主题应成为默认偏好，并与 app 级 ThemeProvider 单一接线。

## 6. 状态矩阵

| 区域 | 必须可见状态 | 视觉表达 |
| --- | --- | --- |
| Source picker | loading / empty / error / creating / unavailable | 骨架行、说明行、内联错误、按钮 pending、禁用行理由 |
| Session list | loading / empty / error / pending / active / working / awaiting / error | 骨架行、引导语、重试、占位行、黑色侧线、真实状态图标 |
| Session item | rename / delete confirm / action busy / action error | 内联输入、dialog、局部禁用、列表顶部错误提示 |
| Chat | connecting / ready / working / stopped / closed / history | 上下文带状态、输入禁用、停止、错误恢复入口 |
| Message | streaming / reasoning / tool running / tool done / tool error | skeleton 或真实 spinner、折叠区、状态线、错误正文 |
| Prompt | blank / focused / disabled / bash / command mode / mention mode | focus ring、placeholder、Bash 标记、补全浮层 |
| Queue | empty / queued / retrieving / retrieve failed | 无占位、分组摘要、按钮 pending、dock 内错误 |
| Pane | closed / open / resizing / unavailable | 展开按钮、resizer、sheet、优雅退化 |
| Logs | disabled / loading / empty / filtered / unread | 说明行、骨架、空态、过滤结果、未读跳转 |
| Canvas | unavailable / read-only gallery / editable / generating | 能力提示、只读态、工具轨、生成状态 |
| Settings | loading / invalid / saving / saved / save error | 骨架、字段错误、按钮 pending、内联结果 |
| Extension | absent / loading / loaded / blocked / runtime error | 不占位、加载 skeleton、安全错误、隔离 fallback |

## 7. 动效规则

- 页面首次进入不做大面积 fade；只对局部状态变化做 160-240ms opacity/transform。
- 面板开合用 `transform` + `opacity`；不动画 `top`、`left`、`width`、`height`。
- 流式消息只在内容进入时轻微 reveal；不循环、不闪烁、不用粒子。
- `working` spinner 仅表示真实活动；`awaiting-input` 可用低频 pulse；空闲不显示动画。
- `prefers-reduced-motion: reduce` 下禁用自动 reveal、pulse、拖拽过渡，保留状态与键盘可用性。
- 不使用 `window.addEventListener('scroll')` 做视觉动画；对话自动跟随仍由 `useAutoScroll` 管理。

## 8. 无障碍与响应式验收

- 所有 icon-only button 有名称；所有输入有 label 或 aria-label；dialog 有标题、Esc、焦点回收。
- 键盘路径：新建、搜索、恢复、菜单、重命名、删除确认、输入、命令补全、Pane、设置保存均可完成。
- focus ring 使用 `--ring`，不以 hover 代替 focus。
- 320px 宽度不横向溢出；代码块、表格、工具结果只在自身容器横滚。
- 触控命中区至少 32px，主要操作至少 40px。
- 颜色不是唯一信息通道；状态图标、文字与 aria label 同步。
- light、dark、system 三模式均测；扩展 theme token 只能作用于 scoped 会话根。

## 9. 实施边界与文件落点

| 优先级 | 文件/区域 | 变更 |
| --- | --- | --- |
| P0 | `packages/ui/src/styles.css`、`src/globals.css`、`tailwind-preset.ts` | token、surface、半径、字体、滚动条与 reduced-motion 基线 |
| P0 | `components/chat-app.tsx` | shell、上下文带、账户区、侧栏/Pane 响应式编排 |
| P1 | `packages/ui/src/elements/session-list-panel.tsx`、`launcher-rail.tsx` | row 层级、状态、搜索、收藏、空/错态 |
| P1 | `packages/ui/src/elements/message.tsx`、`conversation.tsx`、`empty-state.tsx` | 消息阅读宽度、空态、滚动与分支控件 |
| P1 | `packages/ui/src/elements/prompt-input.tsx`、`chat/pi-queue-panel.tsx` | 输入 dock、队列摘要、Bash/补全层级 |
| P2 | `packages/ui/src/chat/pi-chat.tsx` | header、消息列、input dock、logs/pane 位置与统一 surface |
| P2 | `packages/ui/src/config/settings-shell.tsx`、`schema-form.tsx` | 设置导航、分组、保存反馈、窄屏布局 |
| P2 | `packages/ui/src/canvas/*`、`logs/*`、`web-ext/*` | 只改视觉 chrome，不改协议与安全边界 |
| P3 | `src/theme-controls.tsx`、settings theme 接线 | 单一 theme preference，默认 system，保留 e2e 锚点 |

依赖纪律：新库先查 `package.json`；优先复用现有 Radix、Lucide fallback、AI Elements 与 token；不为视觉重构引入第二套 design system。

## 10. 迁移顺序与验收

### 阶段 A：基础 token

统一颜色、字体、半径、surface、focus、滚动条、reduced motion。完成后不应改变能力或 DOM 关键锚点。

### 阶段 B：shell 与导航

改侧栏、上下文带、Pane 开关、账户区、移动端 sheet。验证新建、恢复、切源、设置回跳、主题、语言。

### 阶段 C：聊天主列

改消息、空态、工具/思考、输入 dock、队列、通知、stats。验证流式、停止、附件、Bash、命令补全、取回队列。

### 阶段 D：扩展与领域面板

改 logs、Canvas、Artifact、slots 的 chrome。验证 extension error boundary、右侧面板开合/拖拽、Canvas 图片回流与日志过滤。

### 阶段 E：设置与质量门

改设置导航与表单状态。执行：

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:app`
- `pnpm e2e`
- light/dark/system 与 320/768/1280/1440 视觉回归
- 重点 e2e：source picker、sessions list、rich chat、theme toggle、queue、Canvas、logs、Pane、settings

完成判据：功能测试无回归；关键 `data-*` 锚点不破；无水平溢出；主要交互有 hover、active、focus、loading、empty、error；减动效模式下仍可完成主流程。
