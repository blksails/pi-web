# Surface App Runtime 契约 v1

> 状态:**契约定稿候选**(2026-07-04)。产生方式:批判性架构对话 + 四场景压力测试
> (Canvas · Video Studio · 交互式数据报表 · Artifact Builder)。
> 条款分级:**必须(MUST)/ 应当(SHOULD)/ 可以(MAY)**;每条尽量给出现有代码锚点或场景依据。
>
> **文档关系**:本契约是框架层的**单一权威**。它修订以下文档中被压力测试击穿的部分
> (各文档已加指回说明,冲突以本契约为准):
> - [SES 标准](./surface-extension-standard.md) — 其 §3-§6 的通信/状态条款被本契约 C1/C4/C5/C6 扩展;
> - [扩展模块统一设计](./agent-source-extensibility-module-design.md) — Agent Routes(M1)升格为框架数据面**前置依赖**(→C6,现存于未来扩展栏 §13.4);
> - [Artifact 扩展面](./artifact-extensibility-design.md) — 隔离载体成为 C7 的渲染基底,ToolArtifactPart 归入 C2;
> - [CanvasKit 设计](./canvas-extension-mechanism-design.md) 与 spec `canvas-kit-m1` — 其 "kernel" 降级为
>   **Canvas 应用面的私有交互件**,排在本契约之后实施;
> - [AAS 草案](./agent-authoritative-surface-design.md) — 历史文档;其五通道被 C1 收编,§8 未决问题对账见 §12
>   (实裁 7/8,#1 按准入判据显式排除;此前"逐一裁决"的说法不实,经架构范围审查更正)。

---

## 0. 一句话与不变前提

**Surface App Runtime = 把 agent 子进程当作"领域微后端"来运行富交互应用面的最小契约集。**

不变前提(pi 的物理约束,一切推导的根):

- agent→server 仅三类下行(`event`/`response`/`extension_ui_request`);工具不能 pull;pi 无 `ctx.state`;
- 唯一管道是 stdin/stdout JSONL(`writeSync` 原子性 ≤ PIPE_BUF ≈ 64KB);
- LLM 上下文昂贵,大状态不可入。

推论(不是品味,是唯一稳定解):状态权威在 agent 进程单写者;UI 收快照、发命令;宿主是中立代理与消息总线。

**两客户端定理**:对话流(LLM 经工具)与应用面 UI(经 ui-rpc/routes)是**同一个微后端的两个客户端,彼此从不直接通信**;一致性来自单写者,跨客户端传递只有共享存储上的引用。

**SAR 准入判据(元规则,MUST)**:一项能力进入本契约,当且仅当满足其一:
① **需要宿主协作**(跨进程帧转发 / 跨信任边界 / 宿主持有的资源),应用进程内无法自足实现;
② 是对**框架自身通道语义的法则约束**(时限、帧大小、单写者),应用偏离即坏。
应用进程内可自足实现的能力(领域私有持久文件、工作流引擎本身、树/统计等纯函数),
**不进契约**——留在应用层,至多沉为 SDK 便利库(库不是法律)。

**条款状态标记(2026-07-04 裁定)**:条款分两态——**[生效]**(有现行实现/行为背书,
立即约束)与**[预定形]**(只为保证"现在的内核不堵死未来"而立的最小法则/留位;
形制细节由首个真实需求方的 spec 定形,届时转[生效])。原则:**不为未来应用做设计,
只确定现在的内核未来能支持**——预定形条款只立"不堵死"所需的最小约束,不预立结构。

---

## 1. 架构总览:三平面 + 七契约

```
应用面(Application Face):Canvas │ 交互报表 │ Video Studio │ Artifact Builder │ …
══════════════════════════════════════════════════════════════════
Surface App Runtime(本契约,[生效]主体)
  C1 Surface 核(S,C,R + 单写者 + domain 唯一 + 通道细则)
  C2 存储契约(制品 meta 信封 + 重建时序法 + fork 语义)
  C3 对话桥(OpMessage / ContextInjection / TurnSync + 降级次序)
  C4 状态归置法(四类状态 + 三条合法跨类路径)
  C5 长操作法(同步窗)
  C7 信任分界(生成代码只跑隔离载体 + 签名钥匙隔离 + 自举不动点)
  ── 未来扩展栏(§13,[预定形]):C6 数据面全章 / C1 投影权威与 query 读模型 /
     C5-2 作业形制 / C7-3 PreviewTelemetry / C2-4 制品生命周期
══════════════════════════════════════════════════════════════════
宿主基础设施(领域无关):slot / state桥(粘性已修 136d2bd)/ ui-rpc /
  attachment store / Tier4 iframe / Agent Routes(未来数据面载体,§13)
```

**三平面法则(R-0,MUST)**:

| 平面 | 通道 | 特性 | 承载 |
|---|---|---|---|
| **状态面** | `control:"state"` 快照推送(粘性) | 小而热,全量,rev 收敛 | 领域快照、视图描述符、版本号、作业状态 |
| **控制面** | ui-rpc 命令(经 dispatch 单写者串行化) | 变更意图,归一化结果 | 命令与作业提交 |
| **数据面**(未来,§13) | Agent Routes(HTTP 请求-响应) | 大而冷,只读,并发,可缓存 | 数据页、文件内容、日志 |
| (制品面) | attachment store 签名 URL | 持久大载荷旁路 | 图/视频/报表/构建产物 |

- **R-0a(MUST)** 数据面只读:route handler 不得写 surface 快照或权威领域态;一切变更经控制面。
- **R-0b(MUST)** 大载荷溢出法:任何平面的载荷超阈值(建议 ≤64KB,PIPE_BUF 原子写边界)必须溢出为
  制品(`att_` 引用),响应/快照只携带引用。二进制永不进帧是其特例。
- **R-0c(MUST)** 状态面永远小而热:快照装不下的,要么进数据面(拉),要么进制品面(引用)。

---

## 2. C1 · Surface 核契约

### 2.1 三元组(已实现基础:`tool-kit/src/surface/create-surface.ts`,main)

```
Surface<S> = (S, C, R)
  S:状态空间,agent 进程单写者
  C:命令表 (action, args) → 确定性变换 + 归一化结果 {ok, data, error{code}}
  R:读模型 —— 带 rev 的快照广播(粘性,重连回放)
```

### 2.2 权威与单写者

- **C1-2(MUST)** 快照的写者只有 agent 进程——v1 一切 surface 均为内生权威(S 即真相)。
  投影权威(外部系统为真相,场景:交互报表)的分级声明与新鲜度语义 → **未来扩展栏 §13.1**
  (C1-1;内核无堵点论证亦在彼处)。

### 2.3 读模型

- **C1-3** v1 读模型 = `snapshot`(小热状态全量推送)一种。两条边界法:
  - `delta` **不提供(MUST,框架事实)**:应用不得自造增量帧协议绕行;协作编辑类需求留 v2;
  - `query`(数据面拉取)与其缓存协议(C1-4)→ **未来扩展栏 §13.2**,随 C6 生效。
- **C1-5 domain 唯一性(MUST;范围审查 G3)**:domain 在会话内唯一;重复注册是装配错误
  (后注册者拒绝 + diagnostics)。多实例需求 v1.1 以 `surface:<domain>:<instanceId>` 转义留位。
- **C1-6 通道细则(入法既有实现)**:
  - 探针命令 `surface:<domain>` 由 `createSurface` **自动注册**(AAS §8-2 结案:自动,不要求显式声明);
  - delete 帧**同登记**粘性(last-value 覆盖,重放按 `deleted:true` 删键;136d2bd 实现入法,AAS §8-8 结案);
  - 高频更新(SHOULD):作业进度等高频写方自行合帧,建议 ≤10Hz——fd1 是共享带宽(范围审查 G4)。

### 2.4 不变量(全部 MUST,压力测试幸存)

1. 单写者:并发控制由此免除,任何绕过(UI 直写快照、route 写状态)是违章建筑;
2. LLM 从不直接写 S:三触发源(①LLM 调工具→确定性代码 ②UI 命令 ③agent 自主)的执行体都是确定性代码;
3. 引用不背二进制:快照与 args 只有 `att_` 引用 + 文本(R-0b 的实例);
4. 命令返回"发生了什么",快照才是"现在是什么":UI 不得以命令返回值渲染权威数据
   (回包丢帧免疫的根据,dev StrictMode 实证)。推论(AAS §8-6 结案):**v1 无乐观更新协议**
   ——需要即时反馈的用本地瞬时态(C4 第一类)呈现,不预写快照镜像。

---

## 3. C2 · 存储契约(制品 meta 信封;经准入判据瘦身)

现状批判:Canvas 的血缘(`derivedFrom`)与参数走私在 `genParams: unknown` 里,每个读者都在
`typeof` 试探(`summarizeGenParams`);**对话流路径的工具产物不写血缘,inpaint 掩码回贴因此被禁用**
(`canvas-workbench.tsx:778` 注释实证)——信封不是为未来铺路,是解锁现有功能。

- **C2-1 meta 信封(MUST)**:`.att.json` 扩展字段统一为标准信封,附件层不解释(现状不变):

```ts
/** 制品 meta 信封 —— 共享 attachment store 上的跨应用约定(准入判据①:跨边界共享资源)。 */
export interface ArtifactEnvelope<M = unknown> {
  readonly domain: string;            // 归属应用面
  readonly schemaVersion: number;     // 信封内 meta 的 schema 版本(向后兼容演进)
  readonly derivedFrom?: string;      // 血缘:父 att_id(标准字段,不再走私)
  readonly meta: M;                   // 领域数据,经该 domain 的 zod schema 校验
}
```

  **框架侧工具(tool-kit)产出制品时必须写信封**——含对话流路径(LLM 调工具),
  这是回贴解锁的前提,也是"信封属于契约而非应用自觉"的理由:写者(框架工具)与
  读者(应用面)分属两侧,约定必须立在中间。

- **C2-2 重建时序法(MUST,收窄至判据②)**:`hydrate()` 不得阻塞会话启动;装配序竞态
  (createSurface 早于 attachment seam)下必须有界等待、始终不可用退初值、失败不崩——
  装配时序是框架属性,故为法。重建**助手本身是库不是法**(canvas
  `rebuildGalleryFromAttachments` 为参考实现,沉 SDK,MAY)。
- **C2-3 血缘树 = 纯函数(MUST)**:版本链/派生树在快照 assets 上由客户端/agent 侧纯函数计算
  (`derivedFrom` 足够);**不提供服务端 lineage 查询 API**——资产多到进不了快照时,
  该改的是读模型(C1-3),不是加索引。
- C2-4 制品生命周期 → **未来扩展栏 §13.5**(Builder spec 定形)。
- **C2-5 fork 语义(MUST;AAS §8-7 结案,产品裁决 2026-07-04)**:fork 出的新会话**不继承**
  surface 持久态——`hydrate` 的枚举范围恒为本会话;跨分支要素材经 C3-2 显式带入。
  祖先链枚举(继承式 fork)v1.1 留位,由真实需求立项。

**裁决:DomainStore 不进 SAR**(准入判据①不满足)。工作流运行态、作业簿等领域私有持久态
是 agent 进程内一次文件写,不需要宿主协作——归**应用层**自持(自选文件/格式);
tool-kit 将来 MAY 提供便利库,库不是法律。Video Studio 的断点续跑在其自身 spec 内解决。

---

## 4. C3 · 对话桥契约

双时间线张力的正解(两客户端定理推论):**不同步两条时间线,让它们共享同一权威**。桥只有三个子契约:

- **C3-1 OpMessage(通道法 MUST,格式为约定)**:surface 操作需要 LLM 在环时,**必须**经宿主
  Prompt 通道(`onSubmitPrompt` seam,判据①)组装为结构化用户消息进对话流——操作因此回流
  对话历史,不得旁路自造进 LLM 的通道。消息的 fence **格式**(`surface-op`,泛化自
  `canvas-op`/`buildToolPrompt`)是 runtime 层约定(SHOULD),不进 protocol 包,
  撞过第二个应用面再议升格。
- **C3-2 ContextInjection(MUST)**:surface 状态进入 LLM 上下文的**唯一正门**——用户显式"带入对话",
  注入物 = 制品引用 + **摘要**。摘要策略随应用面声明(场景依据:报表的 10k 行必须以
  schema+统计摘要代入;Canvas 的"一图一引用"只是退化特例)。默认隐形是 feature:token 经济学决策。
- **C3-3 TurnSync(MUST)**:轮末 idle 边沿信号(宿主 `panelSyncSignal` 既有机制)双用途——
  ① 触发 `sync` 命令收敛物化视图;② 临时叠层的卡死自愈锚点(清除帧可能丢,轮末无条件清)。
- **裁决**:LiveProgress **移出对话桥**,归 C5 作业协议(它是作业进度的投影,canvas livePreview
  是其两态退化雏形)。

### 4.1 桥的不对称原理(先讲清它不是什么)

对话桥**不是双向消息通道**。出站(surface→对话)是消息;**回程永远不是消息,而是状态面**:
OpMessage 发出后,效果经「LLM 调工具 → 框架工具写制品(C2 信封)/推快照」回到 UI——
应用面**从不监听对话流**,只订阅快照。"对话驱动 surface"在架构上不存在,
存在的是"对话驱动权威,权威投影到 surface"(两客户端定理的推论)。

**身份语义**:OpMessage 以**用户消息**身份进入历史——用户经 UI 做的操作即用户的话,
LLM 应作此理解;来源可读性由 fence 标题行承载(`🎨 局部重绘 · …`)。宿主不加系统级
provenance 标记(协议无位,且按准入判据不为此扩协议)。

### 4.2 责任分层(MUST;谁在哪层做什么,层次错位即违章)

| 子契约 | 宿主(领域无关,判据①) | Runtime SDK(门面,库) | 应用面(策略与内容) |
|---|---|---|---|
| OpMessage | 会话能力 `conversation.submitUserMessage`(SlotHost 注入,与用户敲字同道;现以回调形态名为 `onSubmitPrompt`,`pi-chat.tsx:1693`——**能力冒充事件回调属命名事故**,M-A 更名为能力对象,别名过渡) | fence 组装器 `renderSurfaceOp`(泛化 `buildToolPrompt`) | 何时发、发什么参数(决策与 args) |
| ContextInjection | 引用注入机制(attachment-bridge `injectAttachmentRefs`,既有) | 注入门面 `bringToConversation(refs, summary)` | 触发时机 + 摘要策略(摘要内容是领域知识) |
| TurnSync | 信号生成:`isBusy true→false` 边沿 bump `panelSyncSignal`(`pi-chat.tsx:655`),SlotHost 透传 | 订阅门面 `onTurnEnd(cb)` | 回调内容:`run("sync")` 收敛 + 清临时叠层 |

法则:**宿主永远不知道**消息内容/摘要内容/收敛动作是什么(领域无关);**应用面永远不自造通道**
(不直发 HTTP、不自开流);SDK 居中把宿主注入装配成门面——门面是库不是法(准入判据),
但**本表的层次分工是法**。

### 4.3 通道选择:正向判据与降级次序

**正向判据(SHOULD)**——满足其一才走 Prompt 通道(OpMessage),否则用控制面 `run()`:
① 需要 **LLM 判断**(由它选工具/补参数);② 操作应**可见、可回放**地进入对话历史;
③ 后续对话要能**指代**该操作("刚才那张再调亮")。
纯数据操作(register/delete/sync/saveView)恒走控制面,不进对话。
(canvas 现状即此:「生成」三条全中走 Prompt;「旋转 90°」零条命中走 register。)

**C3-4 降级次序(MUST)**:OpMessage 的通道按次序降级,应用面不得跳级:
① Prompt 通道在(`onSubmitPrompt` 已注入)→ 走对话流(LLM 在环,操作回流历史);
② 通道缺失(旧宿主/测试)→ 降级控制面命令 `run(action)`(LLM **不在环**,效果仍经快照);
③ 控制面亦不可用(探针 false)→ 动作禁用/只读退化(衔接 SES-U2)。
②与①语义不同(操作对 LLM 隐形),UI **必须可感知地呈现降级态**
(canvas"surface 不可用,仅本地工具可用"提示为参考,`canvas-workbench.tsx:1765`)。

### 4.4 端到端走查(informative;canvas 参考,标注层与平面)

```
[应用] 点「生成」→ decideGenerate(策略)
[应用] 组装 surface-op fence(buildToolPrompt → 将由 SDK renderSurfaceOp 接管)
[宿主] onSubmitPrompt → doSend             ── Prompt 通道,进对话流
[LLM ] 读 fence → 调 image_edit 工具
[框架] 工具 execute:落制品(写 C2 信封)+ 推快照   ── 状态面
[应用] 订阅快照 → 画廊出新图                ── 回程 = 状态面,非消息
[宿主] 轮末 isBusy↓ → syncSignal bump
[应用] onTurnEnd:run("sync") 收敛 + 清 livePreview 叠层
```

### 4.5 ConversationBridge 门面(informative,M-A 交付物草图)

应用面对桥的**唯一入口**,由 SDK 从 SlotHost 注入装配(应用不再裸接三个 props):

```ts
export interface ConversationBridge {
  /** C3-4 降级次序的探测结果(UI 据此呈现降级态)。 */
  readonly opChannel: "prompt" | "command" | "unavailable";
  submitOp(op: { title: string; tool: string; params: Record<string, string> }): void;
  bringToConversation(refs: readonly string[], summary?: string): void;
  onTurnEnd(cb: () => void): () => void;
}
export function useConversationBridge(): ConversationBridge;
```

---

## 5. C4 · 状态归置法

- **C4-1(MUST)** 四类状态,各有唯一归宿:

| 类 | 归宿 | 生死 | 例 |
|---|---|---|---|
| 瞬时交互 | UI/engine 本地 | 组件卸载即死 | 手势草稿、缩放、hover |
| 会话偏好 | state 桥 KV(`<ns>.<pref>`,粘性) | 会话内 | `aigc.model`/`size` |
| 权威领域快照 | `surface:<domain>`(agent 进程) | 子进程死→hydrate 重建 | 画廊、DAG、视图描述符 |
| 持久态 | ArtifactRepository / DomainStore | 跨重启(制品跨会话) | 图+血缘、工作流 run state |

- **C4-2(MUST)** 跨类流动仅三条合法路径:
  ① 本地产物入权威 = 上传 + `register` 命令(B 档模式);
  ② 权威入持久 = 经 C2 repository/store;
  ③ 持久入对话 = 经 C3 ContextInjection。
  违章清单(枚举即禁止):UI 直写快照;快照藏二进制;偏好混入权威快照;血缘走私 meta 之外。
- **C4-3 写回端点作用域(MUST;AAS §8-5 结案)**:`POST /sessions/:id/state` 写回仅限
  偏好类键(`<ns>.<pref>`);**禁写 `surface:*`**——权威快照只能由 agent 进程写(单写者)。
- *非规范注记*:把"用户当前视图描述符"放进权威快照,可使 agent 工具与用户共享探索上下文
  ("这页为什么突增?"可答,两客户端定理的兑现)——这是应用面设计模式,不是契约义务
  (范围审查裁定移出,归应用面设计指南)。

---

## 6. C5 · 长操作法(原"作业协议";按"不为未来设计"原则瘦身,2026-07-04)

**意义辨析**:C5 真正的意义只有一条**今天就在生效**的通道法——它不是为 Video Studio 预备的,
是 canvas 旁路命令(`run("edit")` 生图数十秒)撞上 ui-rpc 15s 超时的现行事实,
`settleWindow` 4s race(`canvas-workbench.tsx:88`)即其止血证据。其余"作业状态机"结构
是被未来场景撑大的设计,应用可自足实现(livePreview 手搓两态作业即自证),按准入判据撤出。

- **C5-1 同步窗法(MUST,[生效],判据②)**:dispatch 必须在 settle 窗口内 resolve
  (返回结果或受理);超窗的长操作必须**立即返回受理**,其进度与完成**只经状态面**呈现;
  UI busy 跟状态面走,不跟 dispatch Promise 走。ui-rpc 15s 只约束提交。
- C5-2 作业形制(状态机/SurfaceJob)→ **未来扩展栏 §13.3**(Video Studio / Builder spec 定形)。

---

## 7. C6 · 数据面(全章移至未来扩展栏 §13.4)

C6 整章 [预定形],随 M-B(Agent Routes)实施转生效并迁回主体。预定形的价值已被实证:
不预立只读法,routes 就会被建错(P0 矛盾——模块设计原稿的 `state.set` 即例)——
**约束未来实现的设计,不预实现**。全部法条(C6-1..C6-7)见 §13.4。

---

## 8. C7 · 隔离载体与 PreviewTelemetry(场景依据:Artifact Builder)

- **C7-1(MUST)** 信任分界:**LLM/用户生成的产物代码只能运行在不透明 origin 的隔离载体**
  (Tier4 iframe,见 [Artifact 篇](./artifact-extensibility-design.md))或纯声明车道(Tier5,zod 校验的数据)。
  受信车道(Tier1-3 slot/渲染器/canvas 插件)对**自建产物无捷径**:promotion 必须过与第三方扩展
  完全相同的门(人审 + Ed25519 签名 + 白名单 + 既有安装治理管线)。
- **C7-2(MUST)** 签名私钥永不进 runner:签名是发布仪式(人/CI),env 隔离,agent 进程物理不可达。
- C7-3 PreviewTelemetry(沙箱产物 → agent 健康回传)→ **未来扩展栏 §13.6**(Builder spec 定形)。
- **C7-4(自举不动点,MUST)** stage0 不可自改:宿主本体、本契约核、信任门不在运行时自举范围内。
  自举的正确表述是"stage0 之上的一切皆可自造"。

---

## 9. 安全法条汇总(审计清单)

| # | 法条 | 出处 |
|---|---|---|
| S1 | 数据面只读,变更必经控制面 | R-0a/C6-1 |
| S2 | 大载荷必溢出为制品引用(≤64KB 帧原子边界) | R-0b/C6-3 |
| S3 | UI 发结构化描述符,原始查询仅限工具通道 | C6-2 |
| S4 | 生成代码只跑隔离载体;受信车道 promotion 无捷径 | C7-1 |
| S5 | 签名私钥不进 runner | C7-2 |
| S6 | LLM 不直写状态;单写者不可绕过 | C1 不变量 |
| S7 | 上下文注入唯一正门(ContextInjection),默认隐形 | C3-2 |
| S8 | 数据面继承宿主鉴权不得放宽;写回端点禁写 `surface:*` | C6-6(§13.4)/C4-3 |

> 注:S1/S2 涉及的 C6 条款与 S8 的 C6-6 属未来扩展栏(§13.4),随 M-B 生效;其余现行。

---

## 10. 场景验收矩阵(哪个场景锻炼哪条契约)

| 契约 | Canvas | Video Studio | 交互报表 | Artifact Builder |
|---|---|---|---|---|
| C1 权威分级 | native ✔(参考实现) | native | **projection ✔** | native |
| C1 读模型 query | — | 日志/历史 | **✔(准入条件)** | 草稿内容 |
| C2 meta 信封/血缘 | **✔(去走私+回贴解锁)** | 阶段产物链 | 报表参数审计 | ✔ 版本树(GC 由其 spec 定) |
| C3 对话桥 | ✔(canvas-op) | LLM 起草工作流 | 摘要注入 ✔ | **✔ 最紧迭代回路** |
| C4 归置法 | ✔ | ✔ | 视图描述符 ✔ | ✔ |
| C5 长操作法 | livePreview(雏形)| ✔(形制需求方) | 出表作业 | ✔ build 作业 |
| C6 数据面 | — | 日志页 | **✔(发起者)** | 文件/diff |
| C7 隔离/回传 | — | 预览 | — | **✔(发起者)** |

**Builder 桌面推演结论**(定稿前审):三级自举——L1 内容制品(全自动,现轨道);L2 扩展自建
(隔离/声明车道自动,受信车道过 C7-1 门);L3 完全自宿主(受 C7-4 不动点约束)。唯一净新增契约
是 C7-3 回传;其余全为复用——推演通过,契约核收口。

---

## 11. 实施排序(修订后的路线)

```
M-A 契约立法 + 门面收口(轻;**只落[生效]条款,预定形一律不实现**;spec: `surface-runtime-facade`):
    createSurface/useSurface 门面按"应用"重组导出;ConversationBridge 门面
    (useConversationBridge,§4.5)落地并让 canvas 弃裸 props 改走门面;
    宿主 seam 能力对象化:`conversation.submitUserMessage`(`onSubmitPrompt` 留过渡别名)。
    (SurfaceAppConfig 声明字段 / SurfaceJob 类型 / livePreview 迁移——随各自预定形
    条款的需求方 spec 再落,M-A 不做。)
M-B Agent Routes M1(前置依赖兑现):
    按扩展模块设计 §6 落地(stdin 帧转发 + 只读法 + 溢出法 + ETag 协议)。
M-C 存储信封:
    ArtifactEnvelope schema + 框架工具产物写血缘(解锁对话流路径 inpaint 回贴)+ hydrate 助手抽取。
M-D 第二应用面 = 交互报表(契约试金石,击穿假设最多);Video Studio 随业务;
    Builder 作纸面验收 → 排最后实施。
canvas-kit-m1(交互件整理)与 M-A 并行不冲突,但其 requirements 须引用本契约。
```

> 落地方式:每个 M-* 走 kiro 流程独立 spec;本契约作为各 spec 的 steering 级引用文档。

---

## 12. AAS §8 未决问题对账(结案表;2026-07-04 架构范围审查后修订)

| # | 问题 | 裁决 |
|---|---|---|
| 1 | SDK 包边界(`pi-web-surface-kit` 独立与否) | **显式排除**:包组织是实现事项,不满足准入判据;归 M-A 实施决策 |
| 2 | 探针注册方式 | 结案:自动注册,入法 C1-6 |
| 3 | 命令 payload 承载 | 结案(2026-07-02):无顶层 `name` 走 agent 转发路径(§0/C1) |
| 4 | 血缘持久时机 | 结案:框架工具产出制品**即写**信封,不延后(C2-1) |
| 5 | 写回通道用途 | 结案:写回仅限偏好键,禁写 `surface:*`(C4-3) |
| 6 | rev 与乐观更新 | 结案:v1 无乐观更新,即时反馈用本地瞬时态(C1 不变量 4 推论) |
| 7 | fork 语义 | 结案(产品裁决,选项 b):**不继承**,hydrate 恒本会话;祖先链 v1.1 留位(C2-5) |
| 8 | 粘性帧归属与 delete 清理 | 结案:宿主登记已修(136d2bd);delete 帧同登记入法(C1-6) |

---

## 13. 未来扩展栏([预定形]条款集中存放)

> 元规则(§0):**不为未来应用做设计,只确定现在的内核未来能支持**。本栏条款只立
> "不堵死"所需的最小法则,形制由首个真实需求方的 spec 定形,届时转[生效]迁回主体。
> 编号沿用主体序列(跨文档引用不因迁移失效)。

### 13.1 投影权威(C1-1;需求方:交互报表)

- **C1-1(MUST 当生效时)** `projection` 权威(真相在外部系统)的快照必须携带新鲜度标记
  (`dataRev: number` 单调递增);refresh 是控制面命令;外部订阅/轮询属触发源③。
- 声明字段草图(不预实现;缺省 `native`,现状零改):

```ts
export interface SurfaceAppConfig<S> extends SurfaceConfig<S> {
  readonly authority: "native" | "projection";
}
```

- 内核支持性论证:快照是 `unknown` value,`dataRev` 只是领域字段——无堵点。

### 13.2 query 读模型与缓存协议(C1-3 之 query / C1-4;需求方:交互报表,随 C6 生效)

- `query`:大冷数据经数据面(§13.4)按需拉取,快照只放元数据 + `dataRev`。
- **C1-4(MUST 当生效时)** 缓存失效协议:数据页以 `dataRev` 为 ETag;快照中 `dataRev`
  变更是唯一失效信号;UI 不轮询数据面。
- 内核支持性:拉取通道即 Agent Routes;快照带版本号无需任何内核改动。

### 13.3 作业形制(C5-2;需求方:Video Studio / Builder)

- 作业状态机(id/stage/progress/cancel)是应用可自足实现的模式——快照 value 为
  `unknown`,可承载任意应用定义的作业态,**内核无堵点**(canvas `livePreview` 为两态雏形)。
- 统一形制(SurfaceJob schema / 通用作业 UI)由需求方 spec 定形;主体已生效的约束是
  C5-1 同步窗法(长操作必须立即受理、进度经状态面)。

### 13.4 C6 · 数据面契约(Agent Routes;需求方:交互报表,随 M-B 生效)

**依赖裁决**:[扩展模块设计](./agent-source-extensibility-module-design.md)的 Agent Routes M1
(会话作用域、stdin 帧转发、runner 进程执行)升格为框架数据面前置依赖。

- **C6-1(MUST)** 只读:route handler 不写快照/权威态/持久态(R-0a);写路径 405,指回控制面。
- **C6-2(MUST)** UI 发送**结构化视图描述符**(表/过滤/排序/页码),查询语句由 runner 内
  确定性代码拼装;LLM 写原始查询走工具通道(特权客户端,受工具门控)。两级信任,同一查询内核。
- **C6-3(MUST)** 分页 + 溢出:单页目标 ≤64KB;超限落临时制品,响应携带 `att_` 引用(R-0b)。
- **C6-4(MUST)** 缓存协议:响应携带 `dataRev`(=ETag);与 §13.2 咬合,快照是唯一失效信号。
- **C6-5(SHOULD)** busy 可用:LLM 分析中用户可继续翻页钻取(route 不经 LLM 回合)。
- **C6-6(MUST;范围审查 G6)** 鉴权继承:数据面继承宿主会话鉴权(既有 auth middleware,
  `command-routes.ts` 的 `ctx.auth` 同源),handler 不得自行放宽;响应按会话隔离,越权 403。
- **C6-7(v2 留位)** runner 第二根管(独立 socket):仅当"小页+溢出"被真实场景证伪时立项。

### 13.5 制品生命周期(C2-4;需求方:Builder)

- draft 类制品的回收策略由 Builder spec 定义(对话式迭代 = 版本爆炸);契约仅预留
  `pinned` 字段位(已发布制品豁免回收),不定义语义。

### 13.6 PreviewTelemetry(C7-3;需求方:Builder)

- 沙箱产物向 agent 回传健康状况(运行时错误/console 摘要/关键用户事件),经既有 iframe
  `rpc` → ui-rpc 通道;进入 LLM 上下文仍须经 C3-2。
- 载体映射:走既有 `ArtifactMessage` 的 `event` kind、`app:telemetry` 命名空间
  (四 kinds `ready/resize/rpc/event` 不扩);采集范例见
  [Artifact 篇](./artifact-extensibility-design.md)衔接注记。
- payload 草图(不预实现):

```ts
export interface PreviewTelemetry {
  readonly kind: "error" | "console" | "event";
  readonly artifactId: string;
  readonly summary: string;          // 截断/脱敏后的轻量文本(R-0b)
  readonly at: number;               // 单调计数
}
```
