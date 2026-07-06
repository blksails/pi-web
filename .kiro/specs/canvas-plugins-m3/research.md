# Research & Design Decisions

## Summary
- **Feature**: `canvas-plugins-m3`
- **Discovery Scope**: Extension(集成型;主上下文逐文件精读——考古代理报告因消息路由延迟未达,关键面已自行核实)
- **Key Findings**:
  - **WebExtension 描述符形状**(web-kit/define-web-extension.ts):manifestId/slots/renderers/contributions/config/artifact/capabilities——车道①=新增可选 `canvasPlugins` 键,与既有键同形共存。
  - **pi-plugin.json 清单在 protocol 且非 strict**(plugin/plugin-manifest.ts:「未知字段被忽略,向前兼容」)——车道②功能面**不需要**清单键:插件包的浏览器产物(web-extension.mjs 默认导出 WebExtension)即可携带 canvasPlugins,经既有 webext-package-install 验签装载链进场。清单级声明键=protocol semver 变更,与非目标冲突 → **推迟并档案化**(requirements 5.1 已同步措辞)。
  - **SES-H1 张力与解法**:宿主聚合插件若在 packages/ui/src 写 `canvasPlugins` 即触词表(canvas)。解法=宿主只做**领域中立**注入:pi-chat 把「已装载扩展描述符数组」以中立 prop(`extensions`)经 SlotHost 注入 panelRight(与 state/syncSignal 既有注入同形),`CanvasPanel`(canvas-ui 包,不受 SES-H1 约束)自行提取各 ext 的 canvasPlugins 并加 `<extId>:` 前缀 → workbench `plugins` prop。宿主零 canvas 词。
  - **WorkLayer 现为纯图像图层**(canvas-kit types.ts:57:attachmentId/displayUrl/x/y/w/h/loaded)——图层契约=**类型化泛化**:WorkLayer 增可选 `kind?: string` 与 `data?: unknown`(additive;缺省=既有图像语义零变),插件按 kind 提供 Render/bake/Inspector。
  - **history 无 revert 钩子**(kernel/history.ts:undo=弹 ops 顶入 redoOps,纯栈移除;设计文档 §3.2 的 revert 属 M1 未实现项)——图层撤销(R1.6)需要 L1 additive 接缝:op kind 可注册可选 `revert`(undo 时调)与 `apply`(redo 时调);未注册 kind 行为零变(内置 stroke/anno 不受影响)。
  - **agent 侧命令表装配期固定**(tool-kit surface/create-surface.ts:commands 为 Record,无 addCommand;canvas 的表=createCanvasCommands(A 档+B 档))——第三方命令接缝=**CanvasCommandDeps 增 `extraCommands`**(装配期合并进表,B 档同权)+ **buildCanvasCapability 的 actions 并入 extra 命令名**(M2 capability 注入接缝已在)。确定性装配,零运行时突变,符合 AAS 哲学。
  - **挂载链**:web.config.tsx(defineWebExtension)→ SlotHost(pi-chat :1408+,已有 ext/state/syncSignal 等 prop 注入形态)→ CanvasPanel(canvas-launcher.tsx:89,props 注入接缝成熟)→ CanvasWorkbench(kernel useMemo 内 registerBuiltinTools/registerBuiltinGenerateActions——插件注册同位追加)。
  - **M2 契约直接复用**:registerTool/registerAction/diagnostics(kind 字段)/resolveToolRailTitle(禁用 tooltip)/capability.actions 门控(风格迁移动作=门控语义首个外部消费者)。

## Research Log

### 车道②的最小载体(protocol 零改动)
- **Sources**: packages/protocol/src/plugin/plugin-manifest.ts(PluginWebSchema:dist/commands;顶层非 strict);webext-package-install spec(已装包 .pi/web/dist 验签装载)。
- **Findings**: 功能上「插件包带 canvas 插件」=其 webext bundle 默认导出含 canvasPlugins;清单只是声明/校验层。
- **Implications**: M3 车道②=装载链零改(验签模型不弱化,R5.2)+ 消费侧聚合覆盖所有已装载扩展;pi-plugin.json 的 `web.canvasPlugins` 声明键推迟(protocol semver),留待后续按需求补(档案化)。

### 图层契约与拍平/撤销链
- **Sources**: canvas-kit types.ts(WorkLayer/CanvasOp 开放 kind)、kernel/layers.ts(createLayersStore:add/update/remove/select/applyLayerGesture)、kernel/history.ts(undo/redo/prune 纯栈)、workbench 拍平消费(composeInpaintBack/annotationsToImage 族)。
- **Findings**: 图层渲染/手势(移动缩放)内核已有;缺的是按 kind 的自定义渲染/拍平/检查器与撤销副作用。
- **Implications**: ①WorkLayer +kind/data(additive);②workbench 图层渲染分支:kind 命中注册表→插件 Render(定位容器内,随视口变换,text 编辑器 natural% 定位先例);否则既有 img 渲染;③拍平:合成路径按 kind 调插件 bake(ctx2d, layer, stage)否则既有 drawImage;④history +revert/apply 可选钩子(L1 additive,未注册 kind 零变);插件放置 op:undo 移除图层、redo 重放。

### web-kit 键的类型归属(零依赖边)
- **Findings**: web-kit 不依赖 canvas-kit;插件对象真身类型在 canvas-kit(CanvasTool/CanvasActionPlugin/新 CanvasLayerPlugin)。
- **Implications**: 沿 M2 CanvasCapability 先例——canvas-kit 定义 canonical `CanvasPluginBundle`(id/requires?/tools?/layers?/actions?);web-kit 声明同名最小结构镜像(组件位 unknown 级宽型);canvas-ui 加双向可赋值静态断言防漂移(零新包依赖边)。消费端(canvas-ui)以 canvas-kit 类型窄化。

### 车道③门控复用(风格迁移)
- **Findings**: M2 resolveAction 已内建 via:"command" ∉ capability.actions 先行排除;capability.actions 经 CanvasCommandDeps 注入接缝可扩。
- **Implications**: 范例 agent 装配 extraCommands={style_transfer}+capability.actions 自动并入 → 前端插件动作 match 时白名单命中才参与(R6.3);agent 不支持则动作不出现(拍板①保守语义的正向面)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks | Notes |
|---|---|---|---|---|
| 宿主中立注入 + canvas-ui 聚合(选定) | pi-chat 注入领域中立 extensions 数组,CanvasPanel 提取 canvasPlugins 加前缀 | SES-H1 零触碰;聚合逻辑在领域包可测 | slot 注入面 +1 prop | 词表红线决定性 |
| 宿主直接聚合 canvasPlugins | pi-chat 读各 ext.canvasPlugins 传给面板 | 少一层 | packages/ui/src 触 canvas 词,SES-H1 断言红/需豁免锚扩散 | 否决 |
| 清单键进 protocol | pi-plugin.json +web.canvasPlugins | 与设计文档 §5 字面一致 | protocol semver,违非目标;功能上冗余 | 推迟档案化 |
| SurfaceHandle.addCommand 运行时扩展 | agent 侧命令运行时可变 | 灵活 | 破坏装配期确定性(AAS);测试面大 | 否决,extraCommands 装配期合并 |
| WorkLayer 平行新类型(PluginLayer) | 不动 WorkLayer | 隔离 | 双图层体系,选中/手势/拍平全分叉 | 否决,additive kind/data |

## Design Decisions

### Decision: CanvasLayerPlugin 契约 + WorkLayer 类型化(additive)
canvas-kit 新 `layers-plugin.ts`(或并入 actions.ts 同层):`CanvasLayerPlugin<D>` = { type; Render: ComponentType<{layer; stage}>; bake(layer, ctx2d, stage): void|Promise<void>; Inspector?: ComponentType<{layer; update(d)}> };`defineCanvasLayer` 恒等助手;registry +registerLayer/layers(同 id 拒绝+diagnostics kind:"layer")。WorkLayer +`kind?`/`data?`(缺省=图像图层零变,1.5)。

### Decision: 插件捆声明 + 依赖拓扑校验
`CanvasPluginBundle` = { id; requires?: readonly string[](layer type/op kind 名); tools?; layers?; actions? }。注册编排(canvas-kit 出口 `registerPluginBundles(registry, bundles, opts)`):先注册全部 layers→构建可用依赖集→逐 bundle 校验 requires,缺失→该 bundle 整体不注册+diagnostics(kind:"plugin",含缺失项)→工具轨置灰复用 disabledTools?(缺依赖插件的工具根本不注册,不出现在工具轨——拍板语义「整插件禁用」呈现为:诊断可查,工具不出现。R3.3 的置灰+tooltip 适用于「已注册但 runtime 禁用」;缺依赖=不出现+diagnostics 可查。设计裁定:R3.3 以「诊断入口可见原因」满足——工具轨不显示未注册插件,原因经 diagnostics;若要置灰形态需注册后禁用,复杂度高。**设计修正 R3.3 呈现**:缺依赖插件的工具以置灰+tooltip 出现(注册为禁用态)更符合需求字面——采用:bundle 校验失败时其 tools 仍进工具轨但恒禁用(disabledTools 语义扩展:registry 级 disabledPluginTools 集合并入 toolsSnap),tooltip 经 resolveToolRailTitle 显示缺失项。)

### Decision: history revert/apply 可选钩子(L1 additive)
opKind 注册面(经 CanvasTool.opKinds 同族或 registry 新 opBehaviors)增 { revert?(op, layersApi); apply?(op, layersApi) };undo 弹栈后调 revert,redo 入栈后调 apply;未注册=现状纯栈移除(内置零变)。贴纸放置 op:revert=layers.remove,apply=layers.add(还原快照)。

### Decision: 车道①/② 统一消费链
web-kit WebExtension +`canvasPlugins?: readonly CanvasPluginBundle[]`(最小结构镜像+canvas-ui 双向可赋值断言);pi-chat SlotHost 注入中立 `extensions`(全部已装载描述符);CanvasPanel 聚合 `<extId>:` 前缀化 → CanvasWorkbench +`plugins?` prop → kernel useMemo 内 registerPluginBundles(builtin 之后)。车道②=已装包 webext 走同一聚合(装载链零改)。

### Decision: agent 侧 extraCommands + capability.actions 并入
tool-kit `CanvasCommandDeps` +`extraCommands?: Record<string, SurfaceCommandHandler<GalleryState>>`(createCanvasCommands 合并,重名以内置优先+警告);`makeCanvasSurfaceExtension` deps 透传;`buildCanvasCapability` deps +`extraActions?: readonly string[]`(actions=A 档 6+extra 去重)。范例 agent 装配 style_transfer(runImageTool 风格提示词包装)。

### Decision: 范例形态 = 车道①自包含 source + 车道②以集成测试覆盖
examples/canvas-plugin-stickers/:index.ts(canvas surface + extraCommands.style_transfer + aigcExtension)+ .pi/web(defineWebExtension({ canvasPlugins:[stickersBundle] }):贴纸工具/图层/风格迁移动作)。e2e 用该 source(R6/R7.5);车道②验签装载以 node/集成测试用 webext-package-install 既有 fixture 手法覆盖(R5,避免 e2e 装包流程重资产)。

## Risks & Mitigations
- 图层渲染/拍平接线撞 workbench 热区 → 分支点最小化(kind 命中才走插件路径),既有 ui 全量+canvas e2e 6 条零改动硬线兜底。
- history 钩子破坏内置 undo → 未注册 kind 零变 + canvas-kit 全量 247 基线;新增钩子专测。
- SlotHost 新注入 prop 波及其他 slot → 中立 prop 全 slot 可选注入,未消费者零影响;既有 webext e2e 兜底。
- e2e 新 source 装配真实 runner 成本 → 沿 aigc-canvas e2e stub 手法(PI_WEB_STUB_AGENT 下 stub 对 canvas-plugin-stickers source 声明 surface 命令,需核对 stub 的 source 白名单先例——aigc-canvas-degrade fixture 已证可多 source)。
- 消息路由延迟致子代理"假失联" → 先查足迹再判定;等不起时主上下文亲审(M2 教训)。

## References
- docs/canvas-extension-mechanism-design.md §3.4/§5/§6/§8/§9(§5 同 id 句将修正;§9-3 已拍板)
- .kiro/specs/canvas-actions-m2/(M2 契约与 Implementation Notes 留账)、canvas-kit-m1(L1/L2 纪律)、webext-package-install/agent-web-extension(装载链)、canvas-ui-m15(SES-H1 判据)
- 拍板记录:requirements.md Boundary Context(2026-07-06 三项)
