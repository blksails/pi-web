# Gap Analysis — agent-web-extension-visual-acceptance

> 生成于 requirements.md 由 7 条扩展到 28+ 条之后。本分析聚焦「每条验收能力在浏览器内是否已接线/可截图」与「下游 design/tasks 失配」两类 gap。
> 本 spec 性质特殊:产物是 Chrome DevTools 截图证据,不是功能实现。故「实现 gap」= 截图前需要的接线/驱动缺口。

## 分析摘要(Summary)
- **最大 gap 是下游失配**:`spec.json` 仍为 `tasks-generated / approved / ready_for_implementation`,但 design.md(VA-1..VA-7 矩阵)与 tasks.md(9 任务、`_Requirements: 1.1..7.2_`)只覆盖旧 7 条,且编号已随新 requirements 重排而**全部错位**(旧 R6→新 R24,旧 R7→新 R27/R28)。实施前必须重对齐。
- **新增能力多数已有绿色 e2e 资产**:`e2e/browser/` 下 `webext.e2e.ts`、`extension-ui-surfaces.e2e.ts`、`slash-command-palette.e2e.ts` 已覆盖 R1/R2/R5/R9/R11–R14/R16/R24 的断言层;本 spec 主要增量是「人可见截图层」与「尚未被 e2e 覆盖的能力」。
- **选择器精度缺陷**:新 requirements 多处用 `[data-pi-input-wrapper]`(外层 div)断言「输入框可输入」,真实可填/可聚焦元素是 `[data-pi-input-textarea]`(`prompt-input.tsx:123`)。需全局修正。
- **真缺口集中在三类**:(a) 宿主已接线但无示例驱动(R3/R4/R8/R17/R18);(b) 宿主未接线/协议保留(R6 的 12 插槽、R19、R20/R21 artifact 基址、R22/R23 server-driven);(c) 需确认是否端到端应用(R25 theme / R26 layout / R9 扩展源 slash)。
- **边界约束**:本 spec 不重写实现,(b) 类只做「记录缺口 + 最小补法」或「最小补接线」,不展开实现。

## 当前状态调查(Current State)

### 复用资产
| 资产 | 路径 | 对应新需求 |
|---|---|---|
| 扩展注册/解析 | `lib/app/webext-registry.ts`(`resolveExtensionForSource`) | 全部(构建期集成) |
| 6 示例 source | `examples/webext-{layout,background,renderer,contrib,artifact,declarative}-agent` | R1–R5/R7/R9/R10/R20/R24 |
| Server-driven 示例 | `examples/server-driven-ui-agent` | R22/R23 |
| 区域插槽渲染 | `packages/ui/src/chat/pi-chat.tsx`(`SlotHost` ×6:background/header{Left,Center,Right}/footer/panelRight) | R1–R6 |
| 渲染器注册表 | `packages/ui/src/registry/renderer-registry.ts`(仅 tool/dataPart) | R7/R8/R8b |
| Part 分派 | `packages/ui/src/chat/part-renderer.tsx` | R8b |
| 环境 UI/交互 | `pi-interaction.tsx`/`status-bar.tsx`/`widgets.tsx`/`notifications.tsx` | R11–R18 |
| stub sentinel | `lib/app/stub-agent-process.mjs`(`ext-ui`→5 推送;`ext-select`→select+confirm;默认 confirm;ui_rpc slash/mention;set_model) | R9–R17/R28 |
| 现有浏览器 e2e | `e2e/browser/{webext,extension-ui-surfaces,slash-command-palette}.e2e.ts`(playwright,stub) | R1/R2/R5/R9/R11–R14/R16/R24 已绿 |

### 关键约定
- 选源:`[data-agent-source-input]` → `[data-agent-source-submit]` → 等 `[data-session-active]`。
- 输入框真实可填元素 = `[data-pi-input-textarea]`(外层 `[data-pi-input-wrapper]` 仅定位容器)。
- stub 隔离 build:`NEXT_DIST_DIR=.next-e2e` + `next start -p 3100` + `PI_WEB_STUB_AGENT=1` + `SESSION_STORE=fs`。

## 需求—资产映射(Requirement → Asset Map,gap 标签)

标签:**Wired**(已接线·可直接截图)/ **Driver-Missing**(已接线但无示例/sentinel 驱动)/ **Impl-Missing**(宿主未接线·协议保留)/ **Unknown**(需确认端到端)。

| 需求 | 能力 | 复用资产 | 标签 | 备注/最小补法 |
|---|---|---|---|---|
| R1 panelRight | Tier1 面板 | webext.e2e ✅ | **Wired** | 直接截图 |
| R2 headerCenter | Tier1 顶栏中 | webext-layout 示例 | **Wired** | 直接截图 |
| R3 headerLeft/Right | Tier1 顶栏侧 | SlotHost 已挂 | **Driver-Missing** | 示例 `web.config.tsx` 增 headerLeft/Right 节点 |
| R4 footer | Tier1 页脚 | SlotHost 已挂 | **Driver-Missing** | 示例增 footer 节点 |
| R5 background | Tier1 背景 | webext.e2e ✅(`.pw-webext-background-aurora`) | **Wired** | 直接截图 |
| R6 未接线 12 插槽 | Tier1 协议保留 | 无 SlotHost | **Impl-Missing** | 清单记录;按需在 pi-chat.tsx 增挂 |
| R7 data-metric 渲染器 | Tier2 dataPart | registry + 示例注册 | **Unknown** | stub 不产 data-metric:补 stub 输出 或 仅断言注册命中 |
| R8 tool 渲染器 | Tier2 tool | registry 支持 | **Driver-Missing** | 新示例注册 `registerToolRenderer` + stub 产 `tool-*` |
| R8b 渲染边界 | Tier2 边界 | part-renderer.tsx | **Wired**(说明类) | text/reasoning=宿主 components;file/source/step-start=null |
| R9 slash(扩展源) | Tier3 贡献 | slash-command-palette.e2e ✅(内核 help/clear) | **Unknown** | 内核面板已绿;**扩展经 ui-rpc 的候选是否上浮未验证**(design VA-4 标预期缺口) |
| R10 @mention | Tier3 贡献 | stub ui_rpc mention | **Driver-Missing** | 无 e2e;需验证 `@` 浮层接线 |
| R11 setTitle | Tier3 环境 | extension-ui-surfaces.e2e ✅ | **Wired** | `ext-ui` sentinel 驱动 |
| R12 setStatus | Tier3 环境 | extension-ui-surfaces.e2e ✅ | **Wired** | 同上 |
| R13 setWidget | Tier3 环境 | extension-ui-surfaces.e2e ✅ | **Wired** | 同上 |
| R14 notify | Tier3 环境 | extension-ui-surfaces.e2e ✅ | **Wired** | 同上 |
| R15 set_editor_text | Tier3 环境 | stub `ext-ui` | **Wired** | e2e 未单测但 stub 必产;截图即可 |
| R16 confirm | Tier3 交互 | extension-ui-surfaces.e2e ✅ | **Wired** | 默认轮即触发 |
| R17 select | Tier3 交互 | stub `ext-select` | **Driver-Missing** | sentinel 存在,无 e2e;补截图 |
| R18 input/editor | Tier3 交互 | 宿主分支已实现 | **Driver-Missing** | stub 无 sentinel:补 `ext-input`/`ext-editor` |
| R19 其余贡献点 | autocomplete/inlineComplete/custom/keybindings | 仅协议 | **Impl-Missing** | 清单记录 |
| R20 artifact iframe | Tier4 | webext-artifact 示例 | **Impl-Missing** | app 未传 `extensionBaseUrl`(design VA-5 标缺口):最小补 chat-app 传参 + 服务 `artifact.html` |
| R21 postMessage 契约 | Tier4 | artifact-surface.tsx | **Impl-Missing** | 依赖 R20;artifact.html 需主动发 resize/rpc |
| R22 server-driven builtin | Tier4 | builtin-components + PiUiPart 默认注册 | **Unknown** | 宿主已注册 `data-pi-ui`;但 stub 不 emit,真实 agent 需 API key:补 stub 确定性 `data-pi-ui` |
| R23 server-driven sandbox | Tier4 | sandbox-renderer | **Unknown** | 同 R22 |
| R24 声明式零 bundle | Tier5 | webext.e2e ✅ | **Wired** | 直接截图 |
| R25 theme token | Tier5 | manifest config.theme | **Unknown** | `layoutClassNames` 在 pi-chat:384,但**未见 chat-app 把 config.theme/layout 透传 PiChat**:需确认端到端,否则缺口 |
| R26 layout preset | Tier5 | `layoutClassNames(layout)` | **Unknown** | 同 R25;preset 来源未确认 |
| R27 内核会话/输入/消息 | 内核 | 全示例 | **Wired** | 注意改用 `[data-pi-input-textarea]` |
| R28 核心控件 | 内核 | model-selector/thinking-level/palette | **Wired** | stub `set_model` 可驱动 |

**汇总**:Wired 13 · Driver-Missing 6 · Impl-Missing 5 · Unknown 5(共 29 项含 R8b)。

## 实现方案选项

### Option A — 扩展现有 playwright e2e + 叠加 DevTools 截图层(推荐)
在 `e2e/browser/` 既有 3 个绿色 spec 上,补齐未覆盖能力的断言,并用 Chrome DevTools 对每条做人可见截图收口。
- ✅ 复用已绿断言与 stub sentinel,最快拿到 Wired 13 项证据
- ✅ 与 memory「pi-web-e2e-isolated-build」一致(`.next-e2e` + external server)
- ❌ Driver/Impl-Missing 项仍需各自补驱动

### Option B — 纯 Chrome DevTools 手动验收(不碰 e2e)
每条 requirement 由 DevTools 脚本逐条走「选源→驱动→截图/快照」。
- ✅ 完全对齐本 spec「人可见截图」定位
- ❌ 重复造已绿断言;无回归护栏

### Option C — 混合(分层推进)
1. **立即层**:Option A 对 Wired 13 项出截图证据;
2. **驱动层**:对 Driver-Missing(R3/R4/R8/R10/R17/R18)做最小驱动(示例增节点 / stub 增 sentinel),再截图;
3. **缺口层**:对 Impl-Missing(R6/R19/R20/R21/R22/R23)与 Unknown(R7/R9/R25/R26)**只记录缺口 + 最小补法**(R20/R25/R26 如确认端到端断裂,做边界内最小补接线),不展开实现。
- ✅ 尊重 spec 边界(不重写实现),分层交付,证据先行
- ❌ 规划稍复杂

## Effort / Risk
- Wired 13 项截图(Option A 层 1):**S / Low** — 已有绿断言与隔离 build。
- Driver-Missing 驱动(示例增节点 + stub 增 `ext-input`/`ext-editor`/data-metric):**M / Medium** — 改动局部、确定性,但触及 stub 行为契约。
- Impl-Missing 接线(artifact `extensionBaseUrl`、声明式 theme/layout 透传、12 插槽):**M–L / Medium-High** — 跨 spec 边界的实现改动,应最小化或仅记录。
- 下游 design/tasks 重对齐:**S / Low** — 文档机械重排,但**阻断实施**,须先做。

## 设计阶段建议(Recommendations)
- **首选 Option C**;先解阻断项:把 design.md「Verification Matrix」与 tasks.md 从 VA-1..VA-7 重写为 R1..R28+R8b,并修正每个 `_Requirements: x.y_` 引用到新编号。
- **修正 requirements 选择器**:全局将「输入框可输入」断言锚点从 `[data-pi-input-wrapper]` 改为 `[data-pi-input-textarea]`(保留 wrapper 仅作定位)。
- **明确截图与断言分层**:断言复用 playwright(可回归),截图证据用 DevTools(人可见),二者锚点统一。

### Research Needed(带入 design 阶段确认)
1. **R25/R26**:`chat-app.tsx` / `resolveExtensionForSource` 是否把声明式 `config.theme` / `config.layout` 透传到 `<PiChat>` 的 `theme`/`layout` prop?未透传则 Tier5 主题/布局为真缺口。
2. **R9**:`webext-contrib` 经 ui-rpc 的 slash 候选是否真上浮到 `[data-pi-command-palette]`(区别于内核 help/clear)?design VA-4 预判为缺口,需浏览器内确认。
3. **R7**:验收以「渲染命中」还是「注册命中」收口?决定是否需 stub 增 `data-metric`。
4. **R22/R23**:server-driven UI 用 stub 确定性产 `data-pi-ui` 还是依赖真实 `server-driven-ui-agent`(需 API key,违背离线前提)?
5. **R20/R21**:artifact 基址最小补法落点(`chat-app.tsx` 传 `extensionBaseUrl` + 隔离 build 服务静态资源)的可行性。
