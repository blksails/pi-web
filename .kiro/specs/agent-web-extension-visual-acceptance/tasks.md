# Implementation Plan

> **实施进度(2026-06-19,实时浏览器验证)**:
> - ✅ **更正**:baseline **可构建可运行**(`next dev` 在 3000 返回 200,扩展管线正常)。此前"baseline 不可构建"系误读 LSP 噪声(陈旧 dist/project-reference + `ignoreBuildErrors:true` 下不阻断);`zod` 实为 pnpm 嵌套已装,`@pi-web/agent-kit` 不在 web app 构建路径。
> - ✅ **已实现并实时验证(Chrome DevTools 截图存证)**:
>   - T2 扩展插槽层 `packages/ui/src/web-ext/extension-slots.tsx`
>   - T3/T4 `pi-chat.tsx` 挂载全部 **12 个保留插槽** → `webext-slots-agent` 会话内 12 槽全部渲染、内核完好(去重追加语义验证通过)→ `va6-tier1-reserved-slots.png`
>   - T12(部分)`webext-slots-agent` 示例 + 注册
>   - R1/R2(webext-layout)未回归 → `va1-va2-tier1-layout-slots.png`
>   - R3/R4(webext-layout 增 headerLeft/Right/footer)→ `va3-va4-tier1-header-footer.png`
>   - R5(webext-background,aurora z-index -10 不遮挡输入)→ `va5-tier1-background.png`
>   - T9 + R25/R26/R27(webext-declarative:theme token 命名空间隔离 + split 布局 + 零 bundle)→ `va25-va26-va27-tier5-declarative.png`
>   - R28/R29 内核(输入/模型选择/命令面板/消息区)在 layout/slots/background/declarative 四类会话中均完好(去重追加未接管内核)
> - ✅ **已完整验证**:Tier1 全 6 条(R1–R6)+ Tier5 全 3 条(R25–R27)+ 内核(R28/R29 观察)= 11/29 实时截图存证。
> - 🔜 **剩余 18 条**,分两类:
>   - **(A) stub 已驱动、仅缺 stub server 验证**:R12–R16(`ext-ui` sentinel 5 推送)、R17(confirm)、R18(`ext-select`)、R10/R11(ui_rpc slash/mention 已返回 deploy/rollback + alice/bob)。stub-agent-process.mjs **已具备**这些产出,且有绿色 playwright e2e(`extension-ui-surfaces`)。R10/R11 另需 palette 消费侧确认扩展源候选上浮。
>   - **(B) 需新代码/新 stub fixture**:R7(data-metric)、R8(tool 渲染器)、R20(autocomplete/inlineComplete/custom/keybindings 消费 + stub 应答)、R19(input/editor sentinel)、R21/R22(artifact 基址服务 + postMessage)、R23/R24(server-driven data-pi-ui)。
> - ✅ **stub 验证已打通(`next build` + `next start`,非 `next dev`)**:隔离 production build(`✓ Compiled 30.2s`)+ `next start`(注意先杀上次会话残留在 3100 的旧 server,否则 serving 旧 chunk hash 报 ChunkLoadError)。在 3102 stub 实测:
>   - **R12–R17 全部实时验证 + 截图** `va12-17-tier3-ambient-confirm.png`:setTitle="Stub Extension Title"、setStatus[branch]="main-branch"、setWidget 两行 alpha/beta、notify="Build complete"、set_editor_text="prefilled-by-extension"、confirm "Proceed?"→点批准→`[data-pi-interaction-resolved]`+"已批准"+"Continuing after approval."
>   - R9 渲染边界(text/reasoning/tool echo)随 stub 默认会话渲染
> - 📌 **新发现缺口(design 预测命中)**:R10 扩展源 slash 候选**未上浮**——命令面板仅 `[data-pi-command-item]`=help/clear(内核),无 deploy/rollback(stub ui_rpc 已返回但消费侧未合并)→ 需 T5 在 `pi-command-palette.tsx` 把扩展 ui_rpc slash list 并入候选;R11 mention 同理。
> - 🔜 **剩余需新代码**:R10/R11(T5 palette 消费扩展源)、R7/R8(T10 stub data-metric/tool 产出 + 渲染)、R18(ext-select 已支持,待截图)、R19(T11 ext-input/editor sentinel)、R20(T5–T8 四贡献点消费 + T11 stub 应答)、R21/R22(T13 artifact 基址服务 + postMessage)、R23/R24(T10 stub data-pi-ui builtin/sandbox)。
>
> **新增实现(stub fixture,无需重建——.mjs 运行时读取)**:
>   - T10:`stub-agent-process.mjs` 增 `ext-server-ui` sentinel → `tool_execution_update` 携 `__piWebUi`(builtin metric/table + sandbox 节点树)→ **R23/R24 验证**(`data-pi-ui-builtin`=[metric,table]、`data-pi-ui-part`=[builtin,builtin,sandbox]、无 fallback)→ va23-24
>   - T11:增 `ext-input`/`ext-editor` sentinel → `extension_ui_request` method input/editor → **R19 验证**(input 框 + editor 多行预填,`data-pi-interaction-method`=input/editor,闭环"已提交")→ va19-input/va19-editor
>
> **ui-rpc 客户端 + 贡献点接线(T5,新实现并验证)**:
>   - 加 `PiClient.uiRpc`(POST /sessions/:id/ui-rpc)+ 在 `pi-chat.tsx` 用 **已存在的** `createUiRpcBus` 构造客户端总线(send=client.uiRpc,subscribe=controlStore.onUiRpcResponse)。
>   - **架构修复**:发现 control 帧仅在 per-prompt /stream 流动(空闲无通道),在 `connection.ts` 加 `openControlOnlyStream()`——一条**仅转发 ui-rpc 帧**的持久并发订阅(服务端支持并发订阅;ambient 帧不转发故不重复;ui-rpc 按 correlationId 去重故双发无害),PiChat 连接时开启。
>   - `pi-command-palette.tsx` 消费 `extension.contributions.slash` → **R10 验证**:`[data-pi-command-item="deploy"/"rollback"][data-pi-command-source="extension"]` 上浮 → va10
>   - 新建 `pi-mention-popover.tsx` 消费 `extension.contributions.mention` → **R11 验证**:`@` → `[data-pi-mention-item]`=@alice/@bob,与 slash 隔离 → va11
>
> **R20 余 3 点 + R8 + R21/R22 完成(2026-06-20)**:
>   - R20 inlineComplete(`prompt-input.tsx` ghost 后缀 + Tab,`[data-pi-inline-complete]`=" to production")、keybindings(`pi-chat.tsx` keydown,Mod+k→"/deploy ",`[data-pi-keybindings]`)、autocomplete(已证)→ va20;custom = **设计排除**(协议无声明式贡献形状,仅 ad-hoc ui-rpc 点)。
>   - R8 tool 渲染器(`webext-renderer` 加 `renderers.tools.echo`)→ "🔧 扩展自定义 echo 工具渲染器" → va8
>   - R21/R22 artifact(`public/webext-artifact/artifact.html` 静态服务 + `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` build 期注入)→ iframe sandbox 无 same-origin、postMessage resize 360 → va21-22
> - **回归修复**:持久控制流曾干扰无贡献点 agent 的 prompt 流(session-persistence/slash e2e 失败)→ 改为**仅扩展声明 contributions 时**才开控制流(`hasContributions` gate),回归已消除。
>
> **e2e 验证(playwright 全套)**:**20 passed / 3 failed**。3 个失败均**既有**(我未触碰路径):rich-chat:124(get_commands→suggestion 映射)、settings-config:12/:46(设置面板)。我相关用例全绿(extension-ui-surfaces / webext slots-bg-declarative / slash-palette ×7 / session-persistence fs+sqlite / custom-agent 等)。
>
> **当前已验证:28/29**(Tier1 R1–R6 · Tier2 R8/R9 · Tier3 R10–R20 全 · Tier4 R21–R24 · Tier5 R25–R27 · 内核 R28/R29)。证据:`va*.png` 15 张。
> **剩余 1 条(设计排除)**:
>   - **R7**(data-metric):协议无"agent 发通用 data-part"路径(`tool_execution_update` 只产 data-pi-ui;message data-part 无 agent 触发通道)→ 固有缺口,只能"注册命中"断言(design 选项 b),非真实渲染。R6.5/R20.3 的「设计排除」出口适用。
>   - **custom 贡献点**(R20 内):`ContributionPoints` 无 `custom` 声明形状(仅 `UiRpcPoint` 的 ad-hoc 调用),无宿主消费面 → 设计排除。

> 全量补齐 + 视觉验收。对齐 requirements R1..R29 与 design 的 Verify / Impl+Verify 两态。
> 前置:隔离 build `.next-e2e`;`NEXT_DIST_DIR=.next-e2e next start -p 3100`(`PI_WEB_STUB_AGENT=1` + fs);Chrome DevTools 指向 `http://localhost:3100`。
> 去重总原则:扩展插槽内容一律追加、赋 `[data-pi-ext-<slot>]`,不替换内核;全量替换/接管语义记「设计排除」。
> `(P)` = 可并行(边界独立);`_Depends:_` = 跨边界依赖;`_Boundary:_` = 主要改动归属。

## Phase A — 环境与编排骨架

- [ ] 1. 起验收环境
  - [ ] 1.1 隔离 build:`NEXT_DIST_DIR=.next-e2e npm run build` 产出独立构建,不污染 `.next`
    - 完成态:`.next-e2e` 目录生成、build 成功无错
    - _Requirements: 全部前置_
  - [ ] 1.2 起 stub 服务 + 浏览器可达:`NEXT_DIST_DIR=.next-e2e PI_WEB_STUB_AGENT=1 SESSION_STORE=fs next start -p 3100`;Chrome `navigate http://localhost:3100`
    - 完成态:`[data-agent-source-picker]` 截图 + 选源/输入选择器可达
    - _Requirements: 全部前置_

- [x] 2. 抽取扩展编排骨架
  - `useExtensionSlots()` / `useExtensionContributions()` hook + `ExtensionSlotLayer` 子组件,`pi-chat.tsx` 仅编排;为后续 12 插槽 + 4 贡献点提供统一挂载点
  - 完成态:hook/组件文件创建、`pi-chat.tsx` 引用且现有 R1/R2/R5 插槽渲染不回归
  - _Requirements: 6, 20_
  - _Boundary: packages/ui/src/chat/pi-chat.tsx_

## Phase B — 宿主插槽补齐(R6,串行,同文件)

- [x] 3. 6 个干净插槽 SlotHost
  - 按 design 插槽表挂载 `sidebarLeft`/`toolbar`/`accessoryAboveEditor`/`accessoryBelowEditor`/`accessoryInlineLeft`/`accessoryInlineRight`,各赋独立 `[data-pi-ext-<slot>]`;`sidebarLeft` 区别 basic `[data-pi-chat-sidebar]`
  - 完成态:6 个 `[data-pi-ext-<slot>]` 在有 fixture 时渲染,DOM 快照可见
  - _Requirements: 6_
  - _Boundary: packages/ui/src/chat/pi-chat.tsx_ · _Depends: 2_

- [x] 4. 6 个重叠插槽(共存追加 + 设计排除)
  - `empty`/`notifications`/`statusBar`/`artifactSurface`:按去重规则**追加**渲染(独立 `[data-pi-ext-<slot>]`,不替换 ambient 表面);`promptInput`:外层装饰包裹不移除 textarea;`dialogLayer`:不拦截 PiInteraction
  - 对 `promptInput` 全量替换 / `dialogLayer` 接管语义:在 design 补充段落显式记「设计排除」理由(违 R28/R17)
  - 完成态:4 共存插槽 data 属性可见且 ambient 表面并存;2 排除项理由written;去重回归在 T14 统一验证
  - _Requirements: 6, 17, 28_
  - _Boundary: packages/ui/src/chat/pi-chat.tsx_ · _Depends: 3_

## Phase C — 宿主贡献点补齐(R10,R11,R20)

- [ ] 5. slash 扩展源 + @mention 浮层补齐
  - slash:把扩展经 ui-rpc(`point:"slash" action:"list"`)的候选上浮到 `[data-pi-command-palette]`(区别内核 help/clear);mention:`@` 触发独立浮层查询 `point:"mention"`,与 slash 隔离
  - 完成态:`webext-contrib` 会话输入 `/` 见扩展源 `[data-pi-command-item]`、输入 `@` 见 mention 候选
  - _Requirements: 10, 11_
  - _Boundary: packages/ui/src/controls/pi-command-palette.tsx_ · _Depends: 2_

- [ ] 6. autocomplete 浮层 + custom 派发区
  - 输入变更触发 ui-rpc `autocomplete`,候选渲染 `[data-pi-autocomplete]`(复用 palette);`custom` 点回传渲染到 `[data-pi-ext-custom]`
  - 完成态:stub 驱动下 `[data-pi-autocomplete]` 出候选、`[data-pi-ext-custom]` 出自定义内容
  - _Requirements: 20_
  - _Boundary: packages/ui/src/chat/pi-chat.tsx_ · _Depends: 2_

- [ ] 7. (P) inlineComplete ghost 后缀
  - 输入变更触发 ui-rpc `inlineComplete`,textarea 灰字 ghost 后缀 `[data-pi-inline-complete]`,Tab 接受
  - 完成态:stub 返回后缀时 ghost 可见、Tab 后并入输入值
  - _Requirements: 20_
  - _Boundary: packages/ui/src/elements/prompt-input.tsx_ · _Depends: 2_

- [ ] 8. keybindings keydown 派发
  - 扩展声明 `Keybinding[]` → 会话作用域 keydown 映射 combo→commandId 派发;隐藏标记 `[data-pi-keybindings]` 列活动绑定;不劫持浏览器/内核快捷键
  - 完成态:示例声明 combo,按下后触发可见效果(如 notify)
  - _Requirements: 20_
  - _Boundary: packages/ui/src/chat/pi-chat.tsx_ · _Depends: 6_

## Phase D — 装配 / stub / 示例(多边界,并行)

- [x] 9. (P) chat-app 透传 extensionBaseUrl / theme / layout
      <!-- 验证:webext-declarative 会话 [data-pi-ext-theme] 上 --pw-webext-declarative-accent=#7c3aed(:root 无,命名空间隔离)、split 布局 aside 存在 → va25-va26-va27 截图 -->

  - 向 `<PiChat>` 透传 `extensionBaseUrl`(R21,默认同源 `/` 相对 + 可 env 覆盖)、`theme`(R26)、`layout`(R27);声明式 source 的 `config.theme/config.layout` 接入会话根
  - 完成态:DOM 上会话根含 `--pw-<id>-*` 变量与 layout 宽度类、artifact iframe 有有效 `src` 基址
  - _Requirements: 21, 26, 27_
  - _Boundary: components/chat-app.tsx_ · _Depends: 2_

- [ ] 10. (P) stub 增确定性 part 产出
  - `handlePrompt` 增产出:`data-metric`(R7)、`tool-<name>`(R8)、`data-pi-ui` builtin 7 类(R23)、`data-pi-ui` sandbox 节点树(R24)
  - 完成态:stub 会话确定性出现上述 part,浏览器内对应渲染器命中
  - _Requirements: 7, 8, 23, 24_
  - _Boundary: lib/app/stub-agent-process.mjs_

- [ ] 11. stub 增贡献点应答 + 交互 sentinel
  - 增 ui-rpc 应答:`autocomplete`/`inlineComplete`/`custom`/`slash`/`mention` 确定性返回;增 sentinel `ext-input`/`ext-editor` 发 `input`/`editor` 交互
  - 完成态:输入触发各浮层有候选、`ext-input`/`ext-editor` 弹对应交互卡
  - _Requirements: 10, 11, 19, 20_
  - _Boundary: lib/app/stub-agent-process.mjs_ · _Depends: 10_

- [ ] 12. (P) 专用示例:slots-agent + points-agent
  - 新建 `examples/webext-slots-agent`(12 插槽各一 fixture,与 design 插槽表一一对应)+ `examples/webext-points-agent`(4 贡献点 fixture,含 keybindings 声明);在 `webext-registry.ts` 注册
  - 完成态:两示例选源后各插槽/贡献点有可见内容
  - _Requirements: 6, 20_
  - _Boundary: examples/_

- [ ] 13. (P) 既有示例 fixture 增补
  - `webext-layout` 增 `headerLeft`/`headerRight`/`footer`(R3/R4);`webext-artifact` 的 `artifact.html` 发 `resize`/`rpc` postMessage(R22);`webext-declarative` manifest 补 theme token + 各 layout preset 声明(R26/R27)
  - 完成态:三处示例改动各自在浏览器内产生可断言效果
  - _Requirements: 3, 4, 22, 26, 27_
  - _Boundary: examples/_

- [ ] 14. playwright 断言补齐 + 去重全量回归
  - 新增 `e2e/browser/webext-full.e2e.ts` 覆盖补齐项断言;**统一执行去重回归**:补插槽/贡献点后重跑 R12–R17/R21/R28 既有断言确认内核表面未被替换/遮挡
  - 完成态:新 e2e 绿 + 既有 `webext`/`extension-ui-surfaces`/`slash-command-palette` 三 spec 仍绿
  - _Requirements: 3, 4, 6, 7, 8, 10, 11, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28_
  - _Boundary: e2e/browser/_ · _Depends: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13_

## Phase E — 视觉验收截图收口

- [ ] 15. Verify 批次截图(已接线直接出图)
  - 选对应 source / 发 `ext-ui` sentinel,逐条截图:R1/2(layout)、R5(background)、R9(渲染边界清单 `va9-…md`)、R12–R17(环境 UI/confirm)、R25(declarative)、R28/R29(内核 + 控件,含三 source 对比)
  - 完成态:`va1/va2/va5/va9/va12-va17/va25/va28-*/va29.png` 齐
  - _Requirements: 1, 2, 5, 9, 12, 13, 14, 15, 16, 17, 25, 28, 29_
  - _Boundary: test-results/visual-acceptance/_ · _Depends: 1, 3, 4_

- [ ] 16. Tier1 插槽补齐截图
  - `va3`(headerLeft/Right)、`va4`(footer)、`va6-slot-<name>` ×12(每插槽一张;`promptInput`/`dialogLayer` 截共存态 + 排除理由)
  - 完成态:15 张 `va3/va4/va6-slot-*.png` + 设计排除说明
  - _Requirements: 3, 4, 6_
  - _Boundary: test-results/visual-acceptance/_ · _Depends: 3, 4, 12, 13, 14_

- [ ] 17. Tier2 渲染器截图
  - `va7`(data-metric `[data-testid=metric-card]`)、`va8`(tool 渲染器)
  - 完成态:`va7/va8.png`
  - _Requirements: 7, 8_
  - _Boundary: test-results/visual-acceptance/_ · _Depends: 10_

- [ ] 18. Tier3 贡献点 + 交互截图
  - `va10`(slash 扩展源)、`va11`(mention)、`va18`(select via `ext-select`)、`va19`(input/editor via `ext-input`/`ext-editor`)、`va20-point-<name>` ×4(autocomplete/inlineComplete/keybindings/custom)
  - 完成态:对应截图齐
  - _Requirements: 10, 11, 18, 19, 20_
  - _Boundary: test-results/visual-acceptance/_ · _Depends: 5, 6, 7, 8, 11_

- [ ] 19. Tier4 artifact + server-driven 截图
  - `va21`(artifact iframe `sandbox` 无 same-origin)、`va22`(postMessage resize 改高)、`va23-builtin-<7类>`、`va24`(sandbox + fallback)
  - 完成态:对应截图齐
  - _Requirements: 21, 22, 23, 24_
  - _Boundary: test-results/visual-acceptance/_ · _Depends: 9, 10, 13_

- [ ] 20. Tier5 theme/layout 截图
  - `va26`(`--pw-<id>-*` 计算样式生效且不污染全局)、`va27`(layout preset 容器宽度类)
  - 完成态:`va26/va27.png` + computed-style 证据
  - _Requirements: 26, 27_
  - _Boundary: test-results/visual-acceptance/_ · _Depends: 9, 13_

- [ ] 21. 验收汇总
  - 产出**全量证据统计表**(29 需求 × 截图数 / 设计排除)+ 去重回归结论 + 任一未达 PASS 项的缺口/排除理由清单;勾选本 tasks
  - 完成态:`va-summary.md`(29/29 状态)+ 全部截图/清单齐
  - _Requirements: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29_
  - _Boundary: test-results/visual-acceptance/_ · _Depends: 14, 15, 16, 17, 18, 19, 20_
