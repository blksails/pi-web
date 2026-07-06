# Research & Design Decisions

## Summary
- **Feature**: `canvas-actions-m2`
- **Discovery Scope**: Extension(集成型考古:动作决策链/能力清单/快照通路/粘性机制/M1 留账,考古代理 10 节底账 + 主上下文关键文件复核)
- **Key Findings**:
  - **前置小修④已落地**:`piweb_state` 粘性登记已在 main(136d2bd,pi-session.ts:594 `sticky.set(\`state:${key}\`, frame)`,含 delete 帧「登记 deleted 帧」语义)且有专测 `packages/server/test/session/pi-session.state-sticky.test.ts`(按 key 登记+新订阅回放+delete 回放)。**Req 5 转为验证型需求,零实现工作**。
  - **decideGenerate 有 golden 测试**(考古代理误报无):`packages/ui/test/canvas/build-surface-op-golden.test.tsx` + `build-surface-op-fixtures.ts` + `canvas-workbench.test.tsx` 经 ui 转发层深路径锚定 `decideGenerate`/`buildSurfaceOp` 行为——行为守恒回归线现成,必须零改动绿。
  - **`buildToolPrompt` 已是薄包装**:`renderSurfaceOp(buildSurfaceOp(d, opts))`(surface-runtime-facade 落地时已泛化),M2 退役=保持 export 与语义,无需再造 renderCanvasOp。
  - **`SurfaceOp`/`renderSurfaceOp` 在 web-kit**(`@blksails/pi-web-kit`)→ canvas-kit(零 @blksails 依赖硬线)不可引用 → **动作契约的 prompt 载荷须泛型化**(`CanvasActionPlugin<TOp>`,设计文档 §3.3 的 `buildPrompt(): string` 与实际通道(`bridge.submitOp(SurfaceOp)`)不符,以泛型收编)。
  - **能力清单同源落点找到**:`aigcExtension.publishAigcCatalog`(tool-kit extension.ts:40-77,短退避重试=1875dec)已下发 `aigc.models/modelLabels/modelProviders/sizes` KV,models 源=`filterRoutes([...GENERATION, ...EDIT], disabled)` 的 activeRoutes 推导。capability.models 与它**共享同一推导函数**即为「同源」;散 KV 键保留(prompt-toolbar 快捷设置消费者零改动),收敛留给 SES v0.2 计划。
  - **通道选择是 host 级而非动作级**:generate() 以 `bridge.opChannel === "prompt"` 优先对话流、`surface.run` 兜底(canvas-workbench.tsx:772-840)。内置动作声明 `via:"prompt"`,命令兜底保持为通道级退化(现状零变);`via:"command"` 声明留给第三方动作(M3),M2 只落契约与 capability.actions 门控语义。
  - **资产编排不在 M2**:设计文档 §8 M2 行只含「6 动作迁 defineCanvasAction + 退役 re-export + capability 下发 + resolveAction 纯函数单测」;`requires` 前置资产编排下沉内核属 §3.3 目标形态,留 M3+(generate() 的扩图合成/掩码光栅化编排原样保持)。
  - **快照 reducer 刻意丢字段**:commands.ts reducer `({ assets: [...] })` 有意丢 `livePreview`(注释明示)——capability 并入快照后,**所有全量/部分重建点(命令 reducer、sync、agent_end 收敛、hydrate)必须显式保留 capabilities**,这是 M2 最易漏的正确性点。
  - **e2e 无清单锚定**:aigc-canvas e2e 6 条不锚定模型/比例选项文案(仅 data-pi-panel-ratio=面板布局),capability 下发不威胁 e2e 零改动线。

## Research Log

### 动作决策链现状(canvas-ui/src/canvas-workbench.tsx)
- **Sources**: :185-204 `decideGenerate`(6 分支 if 链),:206-213 `ACTION_LABEL`,:263-266 `buildToolPrompt`,:229-255 `buildSurfaceOp`(参数有序组装 tool→image→mask→reference_images→prompt→size→n→model、mask/reference 值内注解、reframe 默认提示词、标题 48 截断、fence=canvas-op),:698-844 `generate()`。
- **Findings**: 优先级=hasExpand > hasMask > referenceIds > variants≥2 > (空 prompt+有 size)reframe > edit 兜底;outpaint 从 base 删 size;reference 条件带 n。消费点:decisionPreview(:696 生成按钮标签)、generate(:717)、ui 转发层、golden 测试、canvas-ui index。
- **Implications**: 六插件 match 评分 100/90/80/70/60/10 精确复现优先级;buildArgs 逐分支复刻(含 model/size 省略规则与 outpaint 删 size)。`decideGenerate` 重实现为「resolveAction over 内置六插件」的包装,golden 测试零改动即行为守恒证据。

### 通道与执行(generate() :772-840)
- **Findings**: prompt 通道=`bridge.submitOp(buildSurfaceOp(decision, opts))`(SurfaceOp 对象,非字符串);command 兜底=`settleWindow(surface.run(DOMAIN, action, args))`。outpaint/inpaint 有动作特有的资产编排前置(大画布合成/掩码光栅化+上传)与后置(prefs 复位/consumeSent/composeInpaintBack)。
- **Implications**: M2 决策改插件驱动,但 generate() 的动作特有编排分支按 decision.action 保持(行为守恒;requires 下沉留账 M3)。内置动作 execution 声明 `via:"prompt"` + `buildOp(args, input): SurfaceOp`(泛型 TOp 实例化),workbench 提交口径不变。

### 能力清单事实源与消费
- **Sources**: tool-kit aigc/extension.ts:21(SIZE_OPTIONS=gpt 系)/:40-77(publishAigcCatalog);canvas-ui workbench :130-151(DEFAULT_MODEL_OPTIONS 6 项、RATIO_OPTIONS 3 档=wan 系,:144 注释即 16:9×gpt-image 网关拒历史账);aigc-quick-settings.tsx:200-222(读 `aigc.models`/`aigc.sizes` KV,FALLBACK 兜底);model-catalog.ts(AIGC_MODEL_CATALOG 12 项,供 /settings 面板纯端点)。
- **Findings**: 三处清单三个口径(workbench 硬编码/KV 下发/静态 catalog)。模型尺寸知识现无任何权威表达(仅 :144 注释)。
- **Implications**: capability.models 复用 activeRoutes 推导(与 KV 同源);尺寸知识以 provider→尺寸族规则落 agent 侧(dashscope 系=1:1/16:9/9:16 族,gpt/gemini 系=1:1/3:2/2:3 族);全局 sizes=现 RATIO_OPTIONS 三档保守守恒(模型未选时 UI 零变),选中模型后按 models[].sizes 收窄(Req 4.3,根治网关拒)。

### surface:canvas 快照通路与容量点
- **Sources**: tool-kit aigc/canvas/{schema,extension,commands,hydrate}.ts;workbench :88(STATE_KEY)/:310/:322(getState/subscribe)。
- **Findings**: GalleryStateSchema={assets, livePreview?};extension 装配 createSurface(initialState/commands/hydrate)+agent_end 全量重建 `handle.update(() => rebuilt)`+livePreview sink;commands reducer 刻意只写 assets。
- **Implications**: `capabilities` 作为 GalleryState 可选字段并入(路线 A 零新帧,旧快照兼容);装配期算一次 capability,经闭包在 initialState/hydrate 结果/agent_end 重建/sync/各命令 reducer 全部写点显式保留(设计以「快照写点清单」形式固化,防漏)。
- capability.actions = A 档命令名恰 6 项(edit/inpaint/reference/variants/outpaint/reframe;register/sync/delete 为 B 档基础设施非生成动作,不进白名单)。

### 粘性登记(Req 5)
- **Sources**: packages/server/src/session/pi-session.ts:580-596;test/session/pi-session.state-sticky.test.ts;AAS 设计文档 §8-8(修复方案原文)。
- **Findings**: 已按 AAS 方案完整落地(按 key 登记、delete 帧登记 deleted 语义、领域无关),e2e②「刷新回放」在跑。
- **Implications**: Req 5 验证型:实现任务=零;验收任务以新鲜运行证据关账(server 专测 + e2e②)。

### M1 留账两笔
- **Sources**: .kiro/specs/canvas-kit-m1/tasks.md Implementation Notes 2.4/2.6/4.2;canvas-kit registry.ts:22-26/:67-70;workbench :1114-1118(工具轨 title/disabled)。
- **Findings**: ①natural 可空是 2.6 五项裁定之一:「null 仅现于 stage 命中与 up/cancel,绘制工具 onDown/onMove 路由已挡 null」——hit 与 phase 都是**运行时值**,TS 无法按值静态收窄同一回调签名;②工具轨已有禁用置灰(toolsSnap.disabledTools)与 title=TOOL_RAIL_TITLES,但禁用原因(registry.diagnostics)不可见。
- **Implications**: ①按 Req 6.2 档案化关账(收窄在现契约形状下不可静态表达;替代=registry.ts 类型注释补「保证矩阵」文档 + design 裁定书);②tooltip=禁用时 title 拼接 diagnostics 首条 error(additive,DOM 锚点零变)。

### 测试与守恒线底账
- **Findings**: golden(build-surface-op-golden + fixtures)、canvas-workbench.test.tsx(ui 深路径 83)、canvas-kit 222+出口快照、canvas-ui index-exports/encapsulation(SES-H1 四线)、server state-sticky 专测、e2e 6 条(闭环/刷新回放/auto-sync/B 档旋转/退化/禁用)。SES-H1 词表不含 action/plugin 词,M2 不触碰 ui 包源(新 API 不经 ui 转发)→ SES 线零影响;canvas-kit/canvas-ui 出口快照随新导出显式更新。
- 新增测试落点:纯函数(action 契约/resolveAction/六内置 match-buildArgs 奇偶校验)→ canvas-kit/canvas-ui 包内 node 测试;组件级(capability 消费/尺寸收窄/回退/tooltip)→ packages/ui/test/canvas 新文件(复用既有 jsdom harness,不改既有文件);agent 侧(capability 生成/快照写点保留)→ tool-kit 测试新文件。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 契约进 canvas-kit + 内置动作在 canvas-ui(选定) | 契约/注册/resolveAction 零依赖落 canvas-kit L2;六内置插件(需 SurfaceOp/renderSurfaceOp/ACTION_LABEL)落 canvas-ui | 守住 canvas-kit 零 @blksails 硬线;内置自举与 golden 守恒线同居一包 | 内置动作不在 kit 包(与设计文档 §6.3 示意位置不同) | 设计文档未规定内置动作归包;零依赖线优先 |
| 内置动作进 canvas-kit | 全部动作机制单包 | 概念集中 | SurfaceOp 依赖迫使 canvas-kit 引 web-kit,破零依赖线与 M1 出口纪律 | 否决 |
| capability 独立 state key | `surface:canvas:capabilities` 单独下发 | 写点保留问题消失 | 违背拍板「并入快照零新键」;多一次粘性/订阅;快照消费两处拼装 | 否决(写点清单可控) |
| buildPrompt 返回 string(设计文档原型) | 契约照 §3.3 字面 | 与文档一致 | 实际通道提交 SurfaceOp 对象,string 契约要么二次解析要么改通道 | 否决,以 `TOp` 泛型收编(文档形状的推广) |

## Design Decisions

### Decision: 动作契约泛型化(`CanvasActionPlugin<TOp>`)
- **Selected Approach**: canvas-kit 定义 `ActionInput`(含 `capability: CanvasCapability`)、`CanvasActionPlugin<TOp = unknown>`(id/label/match→number|false/buildArgs/execution: `{via:"prompt"; buildOp(args,input):TOp}` | `{via:"command"; command:string}`)、`defineCanvasAction`、`resolveAction(actions, input, opts?)`(纯函数,match 抛错经 opts.onError 隔离为不适用)。canvas-ui 以 `TOp=SurfaceOp` 实例化。
- **Rationale**: 保住 canvas-kit 零 @blksails 依赖;workbench 提交口径(`bridge.submitOp(SurfaceOp)`)零变。

### Decision: capability 同源生成 + 快照并入 + 写点保留清单
- **Selected Approach**: tool-kit 把「activeRoutes→模型清单」推导提为共享纯函数(aigc/active-models.ts),`publishAigcCatalog`(KV,消费者零改动)与新 `buildCanvasCapability`(models[带 provider 尺寸族 sizes]/sizes[全局三档守恒]/actions[A 档 6 命令名])同源消费;capability 在 canvasSurfaceExtension 装配期算一次,经闭包注入所有快照写点(initialState/hydrate/agent_end/sync/命令 reducer)显式保留。schema 加 `CanvasCapabilitySchema` 可选字段;canvas-ui 以类型双向可赋值断言(tool-kit zod 推断 ↔ canvas-kit 接口)防漂移,不新增包依赖边。
- **Trade-offs**: 散 KV 键与 capability 短期双轨(收敛留 SES v0.2);写点保留靠清单纪律+专测,非类型强制。

### Decision: 内置六动作=canvas-ui `generate-actions.ts`,decideGenerate 重实现为包装
- **Selected Approach**: `BUILTIN_GENERATE_ACTIONS`(评分 100/90/80/70/60/10,match/buildArgs 逐分支复刻,execution via:"prompt" buildOp=既有 buildSurfaceOp 路径);`registerBuiltinGenerateActions(registry)`;`decideGenerate` 保签名重实现为 resolveAction 包装(golden 测试零改动=守恒证据);`buildSurfaceOp`/`buildToolPrompt` 本体不动。
- **Rationale**: 内置自举=回归线;golden 直接锚定新机制。

### Decision: 通道级兜底保持,capability.actions 门控只约束声明 command 的动作
- **Selected Approach**: generate() 的 `bridge.opChannel` 优先/`surface.run` 兜底结构零变(内置动作全 via:"prompt");`via:"command"` 动作在 capability 缺失或命令不在 actions 白名单时不参与决策(resolveAction 前过滤)——M2 落契约与门控语义 + 单测,无内置消费者(第三方动作 M3 启用)。
- **Rationale**: 拍板①(保守不长按钮)+ 现状零变;门控逻辑先行可测。

### Decision: Req 5 验证型关账;Req 6.1 档案化关账
- **Selected Approach**: 粘性登记已实现有专测(136d2bd)→ 验收任务新鲜跑证据关账;natural 收窄因 hit/phase 是运行时值不可静态收窄 → 依 Req 6.2 出口档案化关账(design 裁定书 + registry.ts 保证矩阵注释),tooltip 诊断照常实现。

## Risks & Mitigations
- 六插件复刻与 if 链有细微出入(省略规则/删 size/条件 n)→ golden+canvas-workbench 测试零改动硬线 + 新增 match/buildArgs 奇偶校验表测试(输入矩阵穷举 6 分支边界)。
- capability 写点漏保留 → 设计固化「快照写点清单」,tool-kit 新增专测逐写点断言 capabilities 存活;e2e①③(sync/agent_end 重建路径)兜底。
- 尺寸收窄改变既有默认 UI → 全局 sizes 保守=现三档;仅显式选中模型才按 models[].sizes 收窄;e2e 无清单锚定已核实。
- canvas-kit/canvas-ui 出口快照忘更新 → 快照测试自身会红,任务显式列入。
- 并发负载 vitest 假阳性 → 既有判别链(定向重跑+duration 信号)。

## References
- docs/canvas-extension-mechanism-design.md §2.2/§3.3/§4/§6.2-6.3/§8/§9(目标形态与拍板项)
- docs/agent-authoritative-surface-design.md §8-8(粘性修复方案,已落地实证)
- .kiro/specs/canvas-kit-m1/(L1/L2 纪律、registry 先例、留账原文)、.kiro/specs/canvas-ui-m15/(迁包与守恒线先例)、.kiro/specs/surface-runtime-facade/(conversation 桥与 renderSurfaceOp)
- 拍板记录:requirements.md Boundary Context(2026-07-06 用户确认三项)
