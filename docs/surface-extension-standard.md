# Pi-Web 富交互表面扩展标准(SES · Surface Extension Standard)v0.1 草案

> ⚠️ **上位契约**:[Surface App Runtime 契约 v1](./surface-app-runtime-contract-v1.md)
> 扩展/修订本标准,冲突以契约为准。**条款映射**(架构范围审查后逐条化):
> SES-P2 → SAR R-0b;SES-U3(快照为准)→ SAR C1 不变量 4;SES-U5(settleWindow)→ SAR C5-1;
> SES-U6(syncSignal)→ SAR C3-3;SES-U2(退化契约)保持本标准权威;
> SES-N4(清单键 `aigc.models`)与 CanvasKit §4 能力下发方案在 v0.2 收敛(以快照切片方案为方向)。
>
> 状态:标准草案(2026-07-04)· 参考实现:**aigc-canvas**(已全量在 main)。
> 系列:[扩展模块统一设计](./agent-source-extensibility-module-design.md) ·
> [Artifact 扩展面](./artifact-extensibility-design.md) ·
> [CanvasKit 插件化](./canvas-extension-mechanism-design.md) ·
> 范式:[AAS 权威表面](./agent-authoritative-surface-design.md)。
>
> 本标准把 **canvas 已经跑通的整条路**(protocol `surface.ts` → tool-kit `createSurface` →
> server `wireSurfaceBridge` → web-kit `WebExtSurfaceAccess` → react `useSurface` →
> 宿主 `SlotHost` 透传)固化为**任何新富交互扩展面**(看板/文档/表格/3D/音频…)都必须遵循的
> 规范。条款用 **必须(MUST)/ 应当(SHOULD)/ 可以(MAY)** 分级;每条给出参考实现坐标。

---

## 0. 学习结论:参考实现已提供的地基(事实,非设计)

| 层 | 已落地 | 坐标 |
|---|---|---|
| 协议 | `surfaceStateKey(domain)`、`SurfaceCommandPayload{domain,action,args}`(**无顶层 name**)、`SurfaceCommandResult{ok,data,error{code,message}}` | `packages/protocol/src/web-ext/surface.ts` |
| agent 门面 | `createSurface(pi,{domain,initialState,commands,hydrate},deps)` → `SurfaceHandle{update/dispatch/replay}`;探针命令注册;结果归一化;`SurfaceCommandError` | `packages/tool-kit/src/surface/create-surface.ts` |
| 进程内注册表 | `__piWebSurfaces__` globalThis seam(server 侧 duck-typed 读取) | `surface-registry.ts` / `surface-wiring.ts:41` |
| server 桥 | `wireSurfaceBridge`:第二 stdin reader 截 `ui_rpc` 行 → 按 domain 派发 → **`writeSync(1)` 直写 fd1** 回流;非 surface 行放行 | `packages/server/src/runner/surface-wiring.ts` |
| UI 门面 | `WebExtSurfaceAccess{run,getState,subscribe,hasCommand}`;`useSurface{state,run,available,rev}` | `packages/web-kit/src/host-context.ts:33` / `packages/react/src/hooks/use-surface.ts` |
| 宿主透传 | `SlotHost` 注入 `surface/state/upload/baseUrl/sessionId/syncSignal/livePreviewImage/onSubmitPrompt`(全部可选) | `pi-chat.tsx:1680`、`apply-extension.tsx:64` |
| 轮末收敛 | `panelSyncSignal`:`isBusy true→false` 边沿 bump → 面板 `run("sync")` | `pi-chat.tsx:655` |
| 领域 schema | 纯 zod、零 pi 值导入、双端共享子入口 `@blksails/pi-web-tool-kit/aigc-canvas-schema` | `aigc/canvas/schema.ts` |
| 物化视图 | `hydrate` = attachment store 枚举重建(有界轮询等 seam 就绪) | `aigc/canvas/{hydrate,extension}.ts` |
| 流式指示 | live-preview seam:快照只带 `stage`,**大图 data URI 禁入帧**(fd1 并发大帧交织损坏实证) | `extension.ts:83`、`schema.ts:41` |

---

## 1. 术语与结构模型

- **Surface(表面)**:agent 进程里某 `domain` 的权威状态 + 命令表;UI 是它的瘦投影与命令发起端(CQRS)。
- **A 档命令**:改变权威数据的领域操作(生成/删除),经 ui-rpc agent 转发路径执行。
- **B 档操作**:纯客户端本地计算(裁剪/旋转/拍平),产物经上传接缝落 `att_` 后 `register` 回权威。
- **Prompt 通道**:组装用户消息进对话流,LLM 在环调工具(操作回流对话历史)。
- **扩展面(Extension Surface)**:一个 domain 的完整交付物 = agent extension + 领域 schema + UI 面板(slot 组件)+(可选)面内插件点。

一个符合本标准的扩展面由**五个工件**构成:

```
<domain>/
① schema        纯 zod,双端共享(浏览器安全子入口)
② extension     agent 侧:createSurface(commands + hydrate)
③ panel         UI 侧:slot 组件(消费 SlotHost 注入的标准 props)
④ commands 文档  action 表 + args schema + 错误码表
⑤ 测试           命令纯函数单测 + 真实子进程集成 + 浏览器 e2e
```

---

## 2. 命名标准(SES-N)

- **SES-N1(MUST)** domain 为短横线小写单词(`canvas`、`kanban`、`sheet`);全局唯一,即命名空间根。
- **SES-N2(MUST)** 快照 key 与探针命令**同名**:`surface:<domain>`(经 `surfaceStateKey()` 构造,禁手拼)。参考:`canvas-workbench.tsx:80-82`。
- **SES-N3(MUST)** UI 偏好类 KV 用 `<ns>.<pref>` 点分键,与 surface 快照分离(偏好是 UI 本地/会话偏好,不是权威领域数据)。参考:`aigc.model` / `aigc.size`(quick-settings 与工具执行读同键)。
- **SES-N4(SHOULD)** 能力/清单类下发键:`<ns>.<list>`(如 `aigc.models` / `aigc.sizes` / `aigc.modelLabels`)——agent 装配期确定性写入,UI 只读。
- **SES-N5(MUST)** DOM 测试锚点:`data-<domain>-<part>`(如 `data-canvas-tool-rail`、`data-canvas-generate`);e2e 只认锚点不认文案。
- **SES-N6(MUST)** 错误码:稳定领域码小写下划线(`edit_failed`、`unknown_action`、`surface_not_registered` 为保留码)。

## 3. 协议与数据契约(SES-P)

- **SES-P1(MUST)** 领域 schema 是**纯模块**:仅 zod,零 pi/runtime 值导入,经浏览器安全子入口发布(package.json exports 子路径),UI 与 agent 双端 import 同一份。参考:`aigc-canvas-schema`。
- **SES-P2(MUST)** **二进制永不进帧**:快照与命令 args 只承载 `att_` 引用 + 签名 `displayUrl` + 文本参数。大负载一律走附件系统(Bulk)。
- **SES-P3(MUST)** 流式/高频指示进快照时只带**轻量标识**(如 `stage`),禁大 data URI——fd1 与 pi RPC 并发大帧会交织成半行被丢(参考实现实证,`schema.ts:41` 注释)。完整流式内容由对话流工具卡承载。
- **SES-P4(MUST)** 命令 payload 走 `SurfaceCommandPayload{domain,action,args}`,**不得**添加顶层 `name`(逃逸 host 命令拦截、落 agent 转发路径的机制依据,`surface.ts:11` 注释);扩展面**不得**新增 control 帧类型或修改 ui-rpc 结构。
- **SES-P5(MUST)** 快照默认值经**工厂函数**构造(`emptyGalleryState()` 模式),禁模块级共享引用。
- **SES-P6(SHOULD)** 血缘/派生关系作为领域字段(`derivedFrom`/`genParams`)持久到附件不透明 meta,附件层不解释。
- **SES-P7(MAY)** args 校验放命令 handler 入口(safeParse → 失败回稳定码);快照结构演进须向后兼容(新字段 optional)。

## 4. agent 侧标准(SES-A)

- **SES-A1(MUST)** 经上游 `createSurface` 装配,**不得**自造 `control:"state"` 帧 / ui-rpc 回流 / 探针 / 注册表。以 `ExtensionFactory` 形态装载(`extensions: [..., <domain>SurfaceExtension]`)。参考:`canvas/extension.ts:10`。
- **SES-A2(MUST)** 命令 handler 是**确定性代码**(LLM 从不直接写 state);三种返回:成功值 / 显式 `{ok:false,error:{code,message}}` / 抛 `SurfaceCommandError(code,msg)`——由 dispatch 归一化,handler **不得**让异常裸逸出会话。
- **SES-A3(MUST)** 权威数据有持久源时提供 `hydrate()`(子进程重启的物化视图重建);依赖装配序晚就绪的 seam 时用**有界轮询**等待(canvas:40×25ms),始终不可用 → 退初值不崩。参考:`extension.ts:35`。
- **SES-A4(MUST)** 触发源①(工具/事件驱动)一律走 `handle.update(reducer)`;命令内改状态走 `ctx.setState(reducer)`。命令返回值只说"发生了什么"(如新 `att_id` 列表),**快照才是"现在是什么"**——UI 不得依赖 run 结果渲染权威数据。
- **SES-A5(SHOULD)** 提供 `sync` 命令(无参,从持久源重新收敛快照)——轮末 syncSignal 收敛协议的 agent 端(§6-U6)。
- **SES-A6(SHOULD)** 能力/清单(模型、动作白名单等)由 agent 装配期确定性写入 `<ns>.<list>` 键;权威在 agent(它才拿得到 provider/配置),UI 硬编码仅作退化 fallback。
- **SES-A7(MUST)** runtime 层代码(含 pi SDK 值导入)只经 runtime 子入口发布,不得进前端 bundle。

## 5. 宿主中立性(SES-H)

- **SES-H1(MUST)** 新增扩展面**零宿主改动**:server/app 层 grep 不得出现 domain 词汇(canvas 判据同款,AAS §6)。State/Command/挂载/Bulk 全走既有领域无关机制。
- **SES-H2(MUST)** 宿主对快照 value、命令 args/data 不 peek、不校验语义(zod 只在两端)。
- **SES-H3(MUST)** 若确需宿主新接缝(如当年 SlotHost 补 `syncSignal`/`surface` 透传),接缝必须**领域无关**并惠及所有 slot 组件——以通用 prop 名与语义设计,进 `SlotHost` 标准注入集(§6-U1)。

## 6. UI 面板标准(SES-U)

- **SES-U1(MUST)** 面板是 webext slot 组件,只消费 `SlotHost` 标准注入集(全部 optional,自行判空降级):
  `extId, state, surface, upload, baseUrl, sessionId, syncSignal, livePreviewImage, onSubmitPrompt`。
  组件**不得**绕过注入自行 fetch 宿主端点。参考:`apply-extension.tsx:64`。
- **SES-U2(MUST)** 可用性以探针判定:`surface.hasCommand("surface:<domain>")`(或 `useSurface().available`)。**退化契约**:false 时不报错不空转,降到只读/纯本地能力,且本地产物**不 register**(canvas Req 9.3)。换任意无关 agent source,面板照常渲染退化态。
- **SES-U3(MUST)** 快照订阅:`getState` + `subscribe`(或 `useSurface().state`),按 rev 收敛;**渲染永远以快照为准**(SES-A4 对偶)。
- **SES-U4(MUST)** 执行双通道规约:
  - 需要 LLM 在环/操作应回流对话历史 → **Prompt 通道优先**(`onSubmitPrompt` 存在时组装结构化指令消息;参数只用 `att_` 引用 + 文本,fence 格式如 `canvas-op`);
  - `onSubmitPrompt` 缺失 → 回退 `surface.run`(兼容旧宿主/测试);
  - 纯数据操作(register/delete/sync)恒走 `surface.run`,不进对话。
  参考:`canvas-workbench.tsx:747-815`。
- **SES-U5(MUST)** `run()` 的 Promise **不得**吊死交互:busy 解锁用短窗 race(canvas `settleWindow` 4s——dev StrictMode 空闲流竞争可致回包帧丢,效果本就经快照回流)。
- **SES-U6(MUST)** 接受 `syncSignal`(轮末 idle 边沿):作两用——① bump 时 `run("sync")` 收敛物化视图;② 作为流式/临时叠层的**卡死自愈锚点**(轮末无条件清理,清除帧可能丢失)。参考:`canvas-workbench.tsx:453`、gallery sync。
- **SES-U7(MUST)** 发送时机的**快照式消费**:异步命令飞行期间用户可能追加输入,完成后只清"发送时存在的"条目(Set 快照过滤),禁全量清空。参考:`consumeSent`(`canvas-workbench.tsx:702`)。
- **SES-U8(MUST)** B 档本地操作:产物必经注入的 `upload` 接缝落 `att_`,再 `run("register",{attachmentId,derivedFrom,genParams})` 回权威;`upload` 缺失时对应工具禁用(不静默丢)。
- **SES-U9(SHOULD)** React 惯例(参考实现踩坑的固化):setState updater 内禁副作用(StrictMode 双调,用 ref 镜像收笔,`canvas-workbench.tsx:520`);同点击序列的 mousedown/pointerdown 是两套事件,阻断冒泡须两个都处理(`:1571`);浮层 z 序内容交互优先(`:1748`);文本编辑器 pointerup 才挂载(`:525`)。
- **SES-U10(SHOULD)** 多 slot 联动(入口按钮 ↔ 面板)用模块级 store(同 bundle 内共享,`canvasOpenStore` 模式),不经宿主。

## 7. 面内插件点(SES-X,可选层)

扩展面自身可再让出插件点(递归扩展,详设计见 [CanvasKit](./canvas-extension-mechanism-design.md)):

- **SES-X1(SHOULD)** 面内插件 id 带命名空间 `<extId>:<pluginId>`;内置实现以 `builtin:` 前缀并**走同一插件点**(自举即验收)。
- **SES-X2(SHOULD)** 决策类扩展点用**评分制纯函数**(`match(input): number | false`),禁 if 链;恒有兜底项。
- **SES-X3(MUST)** 插件的执行声明沿 SES-U4 双通道;`via:"command"` 的动作必须先经能力白名单(`<ns>.actions` 或探针)确认 agent 支持,否则不渲染。
- **SES-X4(MUST)** 第三方插件包走 webext 全套验签车道;`pi-web.json` 以 `bindings.surfaceCommands.<domain>` 锚定两端。

## 8. 测试与验收标准(SES-T)

- **SES-T1(MUST)** 命令 handler、决策函数、prompt builder 均为可注入依赖的纯函数/工厂,直接单测(canvas:`decideGenerate`/`buildToolPrompt` export 供单测;`CanvasCommandDeps` 注入 fake runImageTool)。
- **SES-T2(MUST)** 桥路径(stdin 派发、fd1 回流、探针)必须有**真实子进程**集成测试——stub 抓不到 `takeOverStdout` 劫持类回归(state 桥实证教训)。
- **SES-T3(MUST)** 浏览器 e2e 覆盖:探针可用态主链路 + 退化态(换无关 source 面板仍渲染)+ 刷新重连(粘性快照)。
- **SES-T4(MUST)** UI 组件的接缝全部 prop 可注入(upload/canvasFactory/imageLoader/schedule 模式),jsdom 缺失的 API(ResizeObserver 等)判空降级。
- **SES-T5(SHOULD)** 一致性自检清单(新扩展面 PR 必附):

```
□ N1-N6 命名(domain/key/偏好键/锚点/错误码)
□ P1 纯 schema 子入口,双端同源        □ P2/P3 无二进制帧
□ A1 复用 createSurface 零自造        □ A3 hydrate 有界等待
□ A4 快照为准(run 结果不渲染权威数据)  □ A5 sync 命令
□ H1 宿主 grep 零命中 domain 词汇
□ U2 退化契约(换无关 source 不崩)     □ U4 双通道规约
□ U5 settleWindow                    □ U6 syncSignal 双用途
□ U7 快照式消费                       □ U8 B 档 register 规约
□ T2 真实子进程集成测试                □ T3 e2e 三态(可用/退化/重连)
```

## 9. 已知缺口与标准演进

1. ~~**粘性帧**:`piweb_state` 分支尚未 `sticky.set`~~ **已修复**(commit 136d2bd,
   `pi-session.ts:594` 按 key 登记粘性帧,delete 帧同样登记复用 last-value 覆盖;
   专项测试 `pi-session.state-sticky.test.ts` 9 绿,2026-07-04 复验)。
   SES-T3 的"刷新重连"因此为 MUST(AAS §8-8 的实证记录已过时)。
2. **settleWindow 是止血**:dev StrictMode 空闲流竞争的根治(回包帧防丢)完成后,SES-U5 降为 SHOULD。
3. **能力清单键(SES-N4/A6)**:canvas 现走 `aigc.*` 散键;标准化为 `surface:<domain>:capability`
   独立 key 的收敛在 v0.2 评估(需与 CanvasKit M2 一致)。
4. **canvas-op fence**:Prompt 通道的结构化指令格式(SES-U4)目前是领域私约;是否提为通用
   `surface-op` 协议级约定,v0.2 议题。
5. **面板组件的宿主包归属**:canvas 组件现居 `packages/ui`(SES-H1 对参考实现自身尚不满足);
   迁出方案见 CanvasKit M1。**新扩展面自始即置于扩展侧 bundle,不得再进宿主 ui 包。**

## 10. 参考实现对照(逐工件)

| 工件 | canvas 参考 |
|---|---|
| ① schema | `packages/tool-kit/src/aigc/canvas/schema.ts`(exports 子路径 `./aigc-canvas-schema`) |
| ② extension | `canvas/extension.ts`(createSurface + hydrate + live-preview sink)、`canvas/commands.ts`(A 档 6 + register/sync/delete) |
| ③ panel | `packages/ui/src/canvas/{canvas-launcher,canvas-gallery,canvas-workbench}.tsx`(launcherRail 入口 + panelRight 画廊/工作台) |
| ④ 命令表 | schema.ts 的 6 组 ArgsSchema + Register/Sync/Delete |
| ⑤ 测试 | `packages/ui/test/canvas/*`、tool-kit canvas 单测、e2e(canvas 闭环) |
| 装配 | `examples/aigc-canvas-agent/index.ts`(`extensions:[aigcExtension, canvasSurfaceExtension]`)+ `.pi/web/web.config.tsx`(三槽) |
