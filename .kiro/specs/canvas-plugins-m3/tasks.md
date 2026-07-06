# Implementation Plan

> 基线 560af8b(canvas-actions-m2 已合 main,canvas e2e 6/6 绿)。行号引用开工时 grep 重校准;黄金基准恒取 `git show HEAD:`。三项拍板(2026-07-06):拓扑校验禁用进 diagnostics / 同 id 维持拒绝(§5 文档句修正)/ 贴纸范例含完整图层契约。裁定书 A/B/C 见 design.md。

- [ ] 1. Foundation:canvas-kit 图层契约与插件捆编排
- [x] 1.1 图层插件契约与注册面
  - layers-plugin.ts:CanvasLayerPlugin\<D\>(type/Render/bake/Inspector?)+ defineCanvasLayer 恒等;types.ts WorkLayer +kind?/data?(additive,缺省=图像图层语义零变);registry +registerLayer/layers(同 id 拒绝+diagnostics kind:"layer",复用收集器,退订幂等,per-instance)+ **disabledPluginTools 登记面(集合+登记 API,本任务创建,1.3 填充)**;kernel-facade 直通;index 显式出口+快照联动(唯一允许改动的既有测试)
  - 单测 layers-plugin.test.ts:契约恒等/冲突拒绝/退订/实例隔离,变异证据(注入违规→红→Edit 还原→绿,严禁 git checkout/restore)
  - 完成态:canvas-kit 全量绿(既有零改动,快照联动除外)
  - _Requirements: 1.1, 1.5, 2.2_
  - _Boundary: packages/canvas-kit(layers-plugin+registry+types)_
- [x] 1.2 history revert/apply 可选钩子
  - kernel/history.ts +op 行为注册(kind→{revert?,apply?});undo 弹栈后调 revert(op, layers),redo 调 apply;未注册 kind 纯栈语义逐字节零变(内置 stroke/anno 守恒证据=既有测试零改动)
  - 专测 history-hooks.test.ts:注册 kind undo/redo 副作用/未注册零变/钩子抛错隔离不崩,变异证据
  - 完成态:canvas-kit 全量绿
  - _Requirements: 1.6_
  - _Boundary: packages/canvas-kit(kernel/history+注册面)_
- [x] 1.3 插件捆注册编排(命名空间+拓扑校验)+ 文档修正
  - registerPluginBundles(registry,bundles,{namespace}):id/type 前缀化 \<extId\>:→layers 先注册→可用依赖集(含内置 kind/type)→requires 校验,缺失=捆内 tools 注册为恒禁用态(填充 1.1 的 disabledPluginTools)+diagnostics(kind:"plugin" 含缺失项)、actions 不注册、layers 不生效;齐备=正常注册;聚合退订;同 id 拒绝语义复用
  - docs/canvas-extension-mechanism-design.md §5「同 id 后装覆盖先装」句修正为拒绝语义(拍板②,实现处归位)
  - 单测:前缀化/拓扑校验禁用/齐备正常/退订/诊断内容,变异证据
  - 完成态:canvas-kit 全量绿;出口快照联动
  - _Requirements: 2.1, 2.3, 2.4, 3.1, 3.2, 3.4_
  - _Depends: 1.1_
  - _Boundary: packages/canvas-kit(layers-plugin 编排)+ docs_

- [ ] 2. Core:装载键与 agent 侧接缝
- [x] 2.1 (P) web-kit canvasPlugins 键 + 宿主中立注入(显式集成任务)
  - web-kit define-web-extension.ts:WebExtension +canvasPlugins?: readonly CanvasPluginBundle[](同文件最小结构镜像类型,组件位宽型;不引 canvas-kit);出口联动(如有快照)
  - 宿主:pi-chat panelRight 的 SlotHost 注入领域中立 `extensions` prop(全部已装载扩展描述符数组;SlotHost 所在文件透传;命名/注释零 canvas 词——SES-H1 四线保持是硬线);其他 slot 未消费者零影响
  - 完成态:web-kit 既有测试零改动绿;ui 全量零改动绿(新 prop 可选);SES-H1/encapsulation 静态断言保持
  - _Requirements: 4.1, 4.4, 5.1_
  - _Boundary: packages/web-kit + packages/ui(chat/web-ext 中立注入)_
- [x] 2.2 (P) tool-kit extraCommands 与 extraActions
  - commands.ts CanvasCommandDeps +extraCommands?(createCanvasCommands 合并,重名内置优先);extension.ts deps 透传;capability.ts buildCanvasCapability +extraActions?(actions=A 档 6+extra 去重)
  - 集成测试 canvas-extra-commands.test.ts:合并/重名内置优先/桥可调 extra 命令/capability.actions 并入,变异证据
  - 完成态:tool-kit 全量绿(既有零改动)
  - _Requirements: 6.3, 6.5_
  - _Boundary: packages/tool-kit(canvas commands/extension/capability)_

- [ ] 3. Core:前端消费、范例与 e2e 资产
- [x] 3.1 canvas-ui 聚合与插件注册接线
  - CanvasPanelProps +extensions?;collectCanvasPluginBundles 纯函数(提取各 ext.canvasPlugins+extId 命名空间;无声明→空=零影响);CanvasWorkbench +plugins? prop,kernel useMemo 内 builtin 后 registerPluginBundles 逐扩展;工具轨 disabled 判定并入 registry.disabledPluginTools,tooltip 经 resolveToolRailTitle 显缺失项;类型双向可赋值断言(web-kit↔canvas-kit CanvasPluginBundle,M2 先例形态);车道② 覆盖=集成测试以已装包 webext 描述符(webext 装载 fixture 手法)进聚合断言生效/验签失败不进列表不崩
  - 测试:plugin-aggregation.test.ts(canvas-ui)+ workbench-plugin-disabled.test.tsx(ui 新文件:置灰+tooltip 缺失项/齐备正常)
  - 完成态:canvas-ui+ui 全量绿(既有零改动);快照联动
  - _Requirements: 3.3, 4.2, 4.3, 5.1, 5.2, 5.3_
  - _Depends: 1.3, 2.1_
  - _Boundary: packages/canvas-ui(聚合+workbench 注册)+ ui 测试新文件_
- [ ] 3.2 workbench 插件图层渲染/Inspector/拍平接线
  - 渲染:图层循环 kind 命中 registry.layers→定位容器内插件 Render(scale 传入,随视口变换);无 kind 走既有 img(1.5 零变);选中且有 Inspector→FLOAT_LAYER 浮层(data-canvas-inspector 锚点),update 更新 layer.data 并进 history(经 1.2 钩子 op);拍平合成路径按 kind 调 bake(抛错跳过+诊断),无 kind 既有 drawImage
  - 测试:workbench-plugin-layers.test.tsx(ui 新文件):渲染分支/Inspector 出现与更新/拍平调 bake/图像图层零变/undo 移除插件图层
  - 完成态:ui 全量绿(既有零改动)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - _Depends: 3.1, 1.2_
  - _Boundary: packages/canvas-ui(workbench 图层路径)+ ui 测试新文件_
- [ ] 3.3 贴纸双端范例
  - examples/canvas-plugin-stickers/:index.ts(canvas surface extraCommands.style_transfer=runImageTool 风格包装+extraActions+aigcExtension)、.pi/web/web.config.tsx(slots 复用 CanvasLauncher/Panel + canvasPlugins:[stickersBundle])、.pi/web/stickers.tsx(stickerLayer:emoji Render/bake 烤字/Inspector 尺寸滑杆;stickerTool:点击置层+op(revert/apply);styleTransferAction:via:"command",match 含 capability.actions.includes("style_transfer") 避让评分 85)、README;examples/README.md 注册行
  - 完成态:范例 typecheck 绿;可运行性以 3.4 e2e 为证
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - _Depends: 3.2, 2.2_
  - _Boundary: examples/canvas-plugin-stickers_
- [ ] 3.4 e2e stub 配套与新用例
  - stub/fixture 配套:为 canvas-plugin-stickers source 声明 surface 命令 stub(照 aigc-canvas e2e 先例,含 style_transfer 结果回流 stub;开工 grep stub 声明处校准;若 stub 无法为新 source 声明 surface 命令→停 task 回 design)
  - 新 e2e/browser/canvas-plugin-stickers.e2e.ts:①装 source→工具轨现贴纸(命名空间锚点)→画贴纸→选中 Inspector 调尺寸→拍平进位图断言;②风格迁移动作出现(capability 含 style_transfer)→执行经 command 通道→画廊新增资产
  - 完成态:新 e2e 本地全绿(外部 server+.next-e2e 先例跑法)
  - _Requirements: 7.5_
  - _Depends: 3.3_
  - _Boundary: e2e + stub 配套_

- [ ] 4. Validation:回归与端到端
- [ ] 4.1 全量回归与端到端
  - workspace typecheck;canvas-kit/canvas-ui/tool-kit/web-kit/ui 全量(既有零改动,快照联动除外);golden 零改动;SES-H1/encapsulation 静态线保持
  - 既有 canvas e2e 6 条零改动全绿 + 新 e2e 全绿(同一外部 server 会话)
  - 完成态:全部命令新鲜输出为证
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - _Depends: 3.4_

## Implementation Notes

- 3.1:聚合+接线落地(kit 291/cui 54/ui 713 全绿)。执行者交付后静默(惯性),主上下文亲审 APPROVED:canvas-kit 微调=+disabledPluginToolReason 只读读面(捆 id 诊断无法按工具 id 匹配的档案化理由;facade 直通+additive 测试;registerDisabledPluginTool 原因表最新为准与集合幂等并存);resolveToolRailTitle +可选 pluginReason 第 5 参(向后兼容,插件禁用与 runtime 禁用不并存档案化);workbench useMemo 依赖 [plugins](CanvasPanel useMemo 稳定引用维持 per-mount 契约);聚合窄化 as 断言理由=运行期 source 作者以 canvas-kit defineXxx 声明、transport 仅擦除组件位。变异 M1 删注册循环 2 红/M2 删禁用门 1 红,md5 复原。3.2 注意:插件图层渲染消费 registry.layers。
- 2.2:接缝落地(tool-kit 280 全绿=274+6)。执行者交付后静默(惯性),主上下文亲审:合并语义 {...extra, ...builtin}=重名内置优先(无 logger 以注释档案化);extraActions A 档六固定序后去重保序;extension deps.capability 显式注入时 extraActions 被忽略(覆盖优先,docblock 档案化)。变异 M1 合并序翻转 1 红/M2 去重删除 1 红,md5 复原,APPROVED。3.3 消费:makeCanvasSurfaceExtension({commandDeps:{extraCommands},extraActions})。
- 2.1:键+中立注入落地(web-kit 41/ui 710/SES-H1 5 全绿)。审查 APPROVED:SES-H1 专项 diff 零新增 canvas 词、CanvasPluginBundle 未进 ui/src;既有 apply-extension.test.tsx 纯 additive +1 用例裁定 ACCEPT 档案化;宿主单扩展→[extension] 单元素数组(多扩展就绪天然扩展);FYI:pi-chat panelRight extensions 注入无直接单测,兜底=3.1 聚合测试。
- 1.3:编排落地(287 全绿=275+12;出口 +registerPluginBundles/2 类型)。执行者交付后静默(惯性),主上下文亲审:diff 逐条合 design(前缀浅拷贝零 mutate/requires 全局名不前缀化/BUILTIN_OP_KINDS 档案化常量与 types.ts 注释同源人工同步/裁定 B 缺依赖工具进轨置灰+diagnostics kind:"plugin"/退订不清禁用集与诊断=append-only 档案化);registry +recordPluginDiagnostic;facade 直通由执行者补齐(registerLayer/disabled/record 全直通)。变异 M1 拓扑短路 2 红/M2 前缀破坏 5 红,md5 复原,APPROVED。3.1 消费:registerPluginBundles(k.registry, bundles, {namespace: extId})。
- 1.2:hooks 落地(canvas-kit 275 全绿=272+门面 3)。执行者交付核心(HistoryStoreOptions.behaviors+OpBehaviorRegistry+抛错隔离,签名取最小 fn(op)——layers 上下文由注册方闭包捕获,避免 history→layers 耦合,与 design revert(op,layers) 的差异档案化)后再度静默(消息延迟惯性),facade 接线缺口由主控 manual-mode 补齐:collector 前移+createHistoryStore({behaviors,onBehaviorError→collector kind:"plugin"})+CanvasKernel.opBehaviors 暴露+index 类型出口(值键零变快照不动)。主上下文审查:diff 逐行+变异 M1 相位互换 8 红/M2 门面断链 2 红,md5 复原,APPROVED。3.2 消费:kernel.opBehaviors.registerOpBehavior(kind,{revert,apply})。
- 1.1:契约+注册面落地(canvas-kit 260 全绿=247+13;快照 +defineCanvasLayer)。ToolDiagnostic.kind 四值联合在 kernel/tool-runtime.ts(类型本家,审查 ACCEPT 同 M2 先例);disabledPluginTools 骨架含内部 disabledReasons Map(1.3 填充+tooltip 消费);phantom 泛型 D 与 design 字面一致记档;getter 按引用返回=M1/M2 既有纪律一致 FYI。1.3 注意:CanvasPluginBundle/registerPluginBundles 未出口未实现。
- 环境纪律:一切操作限定 worktree `/Users/hysios/Projects/BlackSail/agents/pi-web/.claude/worktrees/canvas-plugins-m3`,禁止 cd 主仓;黄金基准恒取 `git show HEAD:`(HEAD=560af8b)。变异复原只用 Edit 精确还原+md5 核对,严禁 git checkout/restore。子代理报告可能因消息路由延迟 30-60 分钟——看门狗先查 mtime/足迹再判定失联,重派前必须确认前任终止(M2 教训);等不起时主上下文亲审(自做变异保独立性)。并发负载假阳性判别链沿先例。
