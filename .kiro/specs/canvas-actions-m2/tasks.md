# Implementation Plan

> 基线 0377b12(canvas-ui-m15 已合 main,canvas e2e 6/6 绿)。行号引用开工时以 grep 重校准;黄金基准恒取 `git show HEAD:`。前置事实:piweb_state 粘性登记已在 main(136d2bd,含专测)——Req 5 验证型,零实现任务。

- [ ] 1. Foundation:canvas-kit 动作契约与注册面
- [x] 1.1 动作契约与纯函数决策器
  - actions.ts:CanvasCapability/ActionInput/CanvasActionPlugin\<TOp\>(execution 二选一:via:"prompt" 的 buildOp 泛型载荷 / via:"command")/ResolvedAction/defineCanvasAction/resolveAction(via:"command" 且 command ∉ input.capability.actions 先行排除;match 抛错经 opts.onError 隔离为不适用;同分取注册序先者;空候选 null;不修改入参,同输入同输出)
  - 单测 actions.test.ts:最高分/false 排除/抛错隔离/同分稳定/空表 null/command 白名单过滤/defineCanvasAction 恒等,全带变异证据(注入违规即红,Edit 精确还原,严禁 git checkout/restore)
  - 完成态:pnpm --filter @blksails/pi-web-canvas-kit test 新增用例全绿;resolveAction 全分支覆盖
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.7, 4.5_
  - _Boundary: packages/canvas-kit(actions)_
- [x] 1.2 注册表动作面扩展与出口
  - registry.ts:CanvasRegistry 增 registerAction(action): () => void 与 readonly actions(同 id 拒绝+diagnostics kind:"action",复用共享收集器,退订幂等,per-instance);ToolDiagnostic 增可选 kind?: "tool" | "action"(additive);头注补 natural 保证矩阵注释(Req 6.1→6.2 档案化关账,design「裁定书」为准,注释级零行为变化)
  - index.ts 显式出口 +actions 值(defineCanvasAction/resolveAction)/类型(CanvasCapability/ActionInput/CanvasActionPlugin/ResolvedAction/ResolveActionOptions);index-exports 快照联动更新(唯一允许改动的既有测试);encapsulation(kernel 不出口)保持
  - 单测 action-registry.test.ts:冲突拒绝+diagnostics/退订幂等/注册序稳定/实例隔离
  - 完成态:canvas-kit 全量测试绿(既有 222 零改动,出口快照联动除外)
  - _Requirements: 1.4, 1.6, 6.1, 6.2, 3.3_
  - _Boundary: packages/canvas-kit(registry+出口)_

- [ ] 2. Core:agent 侧能力清单下发
- [ ] 2.1 (P) 模型清单同源推导与 capability 生成
  - active-models.ts:自 extension.ts publishAigcCatalog 提取「activeRoutes→有序模型清单(model/label/provider)」纯函数 deriveActiveModels;extension.ts 改调之(aigc.models/modelLabels/modelProviders/sizes KV 键值顺序零变,纯提取重构)
  - capability.ts:buildCanvasCapability(models 带 provider→尺寸族规则:dashscope→["1024x1024","1280x720","720x1280"],其余→["1024x1024","1536x1024","1024x1536"];全局 sizes=现 RATIO_OPTIONS 三档守恒(1:1/16:9/9:16);actions=A 档 6 命令名字面量);读设置异常兜底 catalog 全量确定性输出,不抛不阻塞装配
  - 单测 canvas-capability.test.ts:禁用模型过滤/尺寸族/actions 恰 6 项/确定性
  - 完成态:tool-kit 新增用例绿 + 既有 aigc 测试零改动绿(KV 守恒证据)
  - _Requirements: 4.1, 4.7_
  - _Boundary: packages/tool-kit(aigc active-models+canvas/capability)_
- [ ] 2.2 快照并入与写点保留
  - schema.ts:+CanvasCapabilitySchema(models[{id,label?,sizes?}]/sizes[{label,size}]/actions[string]);GalleryStateSchema +capabilities 可选字段(旧快照解析兼容);emptyGalleryState 不变
  - extension.ts/commands.ts:装配期 buildCanvasCapability() 算一次;六写点(initialState/hydrate 结果/agent_end 全量重建/sync 全量重建/命令成功 reducer/register-delete reducer)显式保留 capabilities(livePreview 刻意丢弃语义不变);CanvasCommandDeps 增 capability 注入接缝(或 withCapabilities 帮助函数统一表达)
  - persistence 专测 canvas-capability-persistence.test.ts:逐写点断言 capabilities 存活
  - 完成态:tool-kit canvas 既有测试零改动绿 + persistence 全绿
  - _Requirements: 4.1, 4.7_
  - _Depends: 2.1_
  - _Boundary: packages/tool-kit(canvas schema/extension/commands)_

- [ ] 3. Core:内置动作自举与前端接线
- [ ] 3.1 (P) 六内置动作插件
  - generate-actions.ts:BUILTIN_GENERATE_ACTIONS 六插件(评分 outpaint=100/inpaint=90/reference=80/variants=70/reframe=60/edit=10 恒兜底;match/buildArgs 逐分支复刻 decideGenerate if 链——公共 base={image,prompt}+model?/size? 非空才带、outpaint 删 size、reference 附 reference_images 与条件 n(variants≥2)、variants 附 n;黄金基准=git show HEAD: 的 decideGenerate 本体)+ toGenerateDecision 映射(union 字面量保持)+ registerBuiltinGenerateActions(reg);execution 全 via:"prompt",buildOp 走既有 buildSurfaceOp 路径(TOp=SurfaceOp)
  - 依赖说明:defineCanvasAction 公开出口与 registerAction 注册面均落 1.2,故依赖 1.2(传递含 1.1);(P) 与 tool-kit 2.x 并行不冲突
  - 奇偶校验表单测 generate-actions.test.ts:输入矩阵穷举六分支边界(hasExpand 删 size/reference 条件 n/reframe 空 prompt+size/优先级压制)+ 与 decideGenerate(HEAD 语义)输出逐项相等的守恒断言
  - 完成态:canvas-ui 新增用例全绿
  - _Requirements: 2.1, 2.2, 2.3, 2.6_
  - _Depends: 1.2_
  - _Boundary: packages/canvas-ui(generate-actions)_
- [ ] 3.2 workbench 决策接线与兼容退役
  - decideGenerate 重实现为 resolveAction(BUILTIN_GENERATE_ACTIONS)+toGenerateDecision 包装(签名/导出/语义零变;null 防御回退 edit);workbench 装配注册六动作(registerBuiltinTools 同位);decisionPreview/generate 改经 resolveAction(标签取 plugin.label,文案与 ACTION_LABEL 一致);via:"command" 动作按 capability.actions 门控过滤(capability 缺失→command 动作不参与决策;内置全 prompt 不受影响);通道选择(bridge.opChannel 优先/surface.run 兜底)/资产编排/consumeSent 结构零变
  - decideGenerate/buildToolPrompt 保留导出并标注 @deprecated 退役说明(兼容一个大版本,新代码直连 resolveAction/BUILTIN_GENERATE_ACTIONS)——golden 与既有消费者零改动仍绿
  - canvas-ui index +generate-actions 显式出口;index-exports 快照联动更新(唯一允许改动的既有测试)
  - 完成态:golden(build-surface-op-golden)与 ui canvas 组件测试零改动全绿(守恒证据);canvas-ui 全量绿
  - _Requirements: 2.1, 2.4, 2.5, 3.1, 3.2, 3.3, 4.4, 4.5_
  - _Depends: 3.1, 1.2_
  - _Boundary: packages/canvas-ui(workbench 决策路径+出口)_
- [ ] 3.3 capability 消费与退化 + 类型同步线
  - workbench:模型选项优先级=capability > modelOptions prop > DEFAULT_MODEL_OPTIONS(design 裁定,视觉口径维持 id 文本);尺寸=capability.sizes ?? RATIO_OPTIONS,选中模型在 capability.models 且带 sizes → 交集收窄,切模型致已选 size 不支持→复位 ""(跟随原图);capability 缺失/available=false→全回退硬编码(退化即正常路径);生成请求使用所选 model/size 不被硬编码覆盖
  - capability-type-sync.test.ts:tool-kit CanvasCapabilitySchema 推断类型 ↔ canvas-kit CanvasCapability 接口双向可赋值静态断言(防漂移,零新包依赖边)
  - 组件测试 packages/ui/test/canvas/workbench-capability.test.tsx(新文件,复用既有 harness):下发生效/按模型收窄+复位/缺失回退三态
  - 完成态:新组件测试全绿;ui 既有全量测试零改动绿
  - _Requirements: 4.2, 4.3, 4.4, 4.6, 4.7_
  - _Depends: 3.2, 2.2_
  - _Boundary: packages/canvas-ui(workbench 清单消费)+ ui 测试新文件_
- [ ] 3.4 禁用工具 tooltip 诊断
  - 工具轨禁用项 title 在 diagnostics 有该工具条目时拼接首条原因(kind 兼容,工具/动作条目区分);无诊断时呈现零变;DOM 锚点 data-canvas-tool 与置灰行为不动(additive)
  - 组件测试 packages/ui/test/canvas/workbench-tool-diagnostics-tooltip.test.tsx(新文件):有诊断显示原因/无诊断零变
  - 完成态:新测试绿;既有工具轨相关测试零改动绿
  - _Requirements: 6.3, 6.4_
  - _Depends: 3.2_
  - _Boundary: packages/canvas-ui(workbench 工具轨)+ ui 测试新文件_

- [ ] 4. Validation:回归、e2e 与关账证据
- [ ] 4.1 全量回归与端到端
  - workspace typecheck 全绿;canvas-kit/canvas-ui/tool-kit/ui 全量测试绿(既有文件零改动,出口快照联动除外);golden 零改动(Req 2.5 守恒证据);server state-sticky 专测(pi-session.state-sticky.test.ts)新鲜跑全绿(Req 5 验证型关账证据)
  - canvas e2e 6 条零改动全绿:aigc-canvas.e2e.ts 5 条 + aigc-canvas-degrade.e2e.ts 1 条(外部 server + NEXT_DIST_DIR=.next-e2e 隔离构建,先 kill 3100 遗留;基线 0377b12 全绿——任何红不许赖 pre-existing;e2e② 刷新回放同时是 Req 5.4 证据)
  - 静态线:canvas-kit encapsulation(kernel 不出口)/canvas-ui encapsulation+SES-H1 四线保持通过
  - 完成态:全部命令新鲜输出为证
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 7.1, 7.2, 7.3, 7.4, 7.5_
  - _Depends: 2.2, 3.3, 3.4_

## Implementation Notes

- 环境纪律:一切操作限定 worktree `/Users/hysios/Projects/BlackSail/agents/pi-web/.claude/worktrees/canvas-actions-m2`,禁止 cd 主仓;黄金基准恒取 `git show HEAD:`(HEAD=0377b12)。变异复原只用 Edit 精确还原,严禁 git checkout/restore(canvas-ui-m15 2.2 事故先例)。并发负载假阳性判别链沿先例(失败集中无关文件+duration 膨胀→定向重跑)。
- 1.2:注册面+出口落地(247 全绿;index 快照 +2 值键)。两处计划外连带审查 ACCEPT:ToolDiagnostic.kind 的类型家在 kernel/tool-runtime.ts(design 表格归属粒度误差,最小落点)/kernel-facade.ts:149 门面补 registerAction/actions 纯委托(接口扩展必然编译传播,动作面无 opKinds 接线故直通即完备)。裁定:工具冲突路径不写 kind(缺省=工具语义)保既有断言零改。natural 保证矩阵头注落 registry.ts:24-36,留账①关闭。
- 1.1:actions.ts+16 用例落地(canvas-kit 238 全绿;审查独立变异 2 组确证)。resolveAction 形状=白名单先行过滤→match 评分/抛错隔离→稳定降序(独立数组非原地 sort,purity 用例锚定)→buildArgs 抛错剔除重选次优→空候选 null。1.2 出口清单照此:值 defineCanvasAction/resolveAction,类型 CanvasCapability/ActionInput/CanvasActionPlugin/ResolvedAction/ResolveActionOptions。测试相对路径 import 待 1.2 出口后保持不变(测试锚定实现非出口)。
