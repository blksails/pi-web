# Requirements Document

## Introduction

AIGC agent 生成 / 编辑的图片此前散落在对话流的各个工具卡里,无法聚合浏览、筛选、二次创作。用户拿到一张满意的图后想继续基于它迭代(换背景、局部重绘、出变体、扩图),只能靠自然语言反复描述,既慢又不精确。

本特性建立 **Canvas**:AIGC 素材画廊 + 二次创作工作台。Canvas 是 `agent-authoritative-surface`(AAS)SDK 的**首个 domain 落地**(`domain = "canvas"`),通信机制**一律复用上游**——`createSurface<S>(pi, config)` / `useSurface<S>(domain) → {state, run, available, rev}` / `SurfaceCommandPayload{domain, action, args}`(走 `wireSurfaceBridge` → agent 子进程转发)/ 探针 `surface:<domain>` / 快照走 `useExtensionState("surface:<domain>")` + `control:"state"` 粘性帧。本特性**不自造**任何 surface 通信原语。

核心范式:**画廊 = attachment store 的物化视图**(非独立持久 state)。图本就落 `att_`(用户上传 = 工具产出,同一 id 空间);画廊快照由 agent 侧 canvas extension 经 attachment 上下文**枚举重建**(`hydrate`);`control:"state"` 实时推送 + 粘性回放,刷新 / 重开会话零 REST 恢复。二次创作命令(A 档)走 **AAS 命令通道** → `wireSurfaceBridge` → 在 agent 子进程内调 `runImageTool`(`packages/tool-kit/src/aigc/run-image-tool.ts`,拿得到 `models.json` / provider / key,保 provider 独立性),不经宿主服务端、不经 LLM 意图猜测。图字节一律走 Bulk(`att_` 签名 URL,永不进帧);血缘存 `.att.json` 扩展字段(`derivedFrom` / `genParams`)。

门控 `NEXT_PUBLIC_PI_WEB_CANVAS` 默认关;非 AIGC source 优雅退化(只读图库 + 客户端编辑,不报错)。宿主中立:grep `app/` + `packages/server` 找不到 `canvas` / `gallery` / `image_edit` 语义。

## Boundary Context

- **In scope**:画廊 UI(9 宫格全景 + 密度可切换「概览 / 瀑布流 / 聚焦」+ 分页 + 血缘或时间分组;格子点击展开工作台、可关闭回画廊);工作台(展开态 / 关闭 / 工具栏 / mask 画布);二次创作 —— **A 档**(映射 `image_edit`:指令编辑 / inpaint 涂 mask / 参考图融合 / 扩图 outpaint / 多模型变体 / 比例重构,经 surface 命令 → `wireSurfaceBridge` → `runImageTool`)、**B 档**(纯客户端:裁剪 / 旋转 / 拼贴 / 标注,产出新 `att_` 回流画廊)、**C 档**(灵感放大:血缘树 / 参数复用 / A-B 对比 / 当前工作图链,UI 侧从血缘快照派生);`canvas` domain 的 `createSurface` 装配(命令表 + `hydrate` + 探针)与 `useSurface("canvas")` 消费;血缘 schema(`derivedFrom` / `genParams`)定义与派生视图重建;**消费上游 `attachment-tool-bridge` 的领域无关 seam**(`listBySession` 会话枚举供 `hydrate` 重建、`getMeta` / `setMeta` 不透明扩展 meta 供血缘持久),Canvas 仅调用不实现;非 AIGC source 优雅退化;门控 `NEXT_PUBLIC_PI_WEB_CANVAS`;`launcherRail` 具名槽入口挂载;单元 / 真实子进程集成 / 浏览器 e2e。
- **Out of scope**:AAS SDK 本身(`createSurface` / `useSurface` / `wireSurfaceBridge` / `SurfaceCommandPayload` / 探针 / 退化契约 —— 归上游 `agent-authoritative-surface`,本特性只消费);`control:"state"` 通用粘性帧机制(归 `state-injection-bridge`);图像 model / provider 路由与 `runImageTool` / `image_edit` / `image_generation` 工具本身(归 `aigc-*` specs,本特性只调用);attachment 存储与签名 URL 生成机制(归 `attachment-store`);**attachment 会话枚举(`listBySession`)+ 不透明扩展 meta(`getMeta` / `setMeta`)seam 的实现**(领域无关,归上游 `attachment-tool-bridge` 的 seam 扩展 —— 把 facade 既有 `listBySession` 透出到子进程工具上下文、新增 `.att.json` 承载的不透明 meta 存取;本特性只消费 resolve / putOutput / `listBySession` / `getMeta` / `setMeta`,不改 `agent-kit` / `server` / `attachment-store` 任何文件);任何新增宿主 REST 端点;`pi.appendEntry` 持久层;视频 / 拼版海报导出(future downstream surface)。
- **Adjacent expectations**:上游 `agent-authoritative-surface` 已就位(`createSurface(pi, config)` 以 `ExtensionFactory` 形态装载、`wireSurfaceBridge` 在 runner 装配期挂第二 stdin reader、`useSurface` 在 `@blksails/pi-web-react`、`SurfaceCommandPayloadSchema` 在 protocol);上游 `state-injection-bridge` 的通用粘性帧修复(`PiSession.handleRawLine` 的 `piweb_state` 分支 `sticky.set`)已合并,使 `control:"state"` 重连可回放;`aigc-generation-tools` / `detoolspec-unify-builtin-tools` 的 `runImageTool` 编排器 + `image_edit`(routes: `gpt-image-2` / `qwen-image-edit-max` / `wan2.7-image-edit-bailian`;params: `image` / `prompt` / `mask` / `n` / `size` / `reference_images` / `model`;`mediaFields: ["image","mask","reference_images"]`)已就位;`attachment-store` / `attachment-tool-bridge` 的 `att_` 空间、`getAttachmentToolContext()`(`resolve` / `putOutput`)、HMAC 签名 URL(`GET /attachments/:id/raw?exp&sig`)已就位;上游 `attachment-tool-bridge` 的**领域无关 seam 扩展**(把 facade 既有 `listBySession` 透出到子进程 `AttachmentToolContext` 供 `hydrate` 会话枚举、新增按 `att_id` 存取的不透明扩展 meta `getMeta` / `setMeta`(落 `.att.json`,承载 `{derivedFrom, genParams}` 等,附件层不解释领域语义))已就位;`sidebar-launcher-rail` 的 `launcherRail` 具名槽已就位;`web-ui-custom-rendering` 的 `SlotContribution` 挂载已就位。

## Requirements

### Requirement 1: Canvas surface 装配(canvas domain 的 createSurface)

**Objective:** As an AIGC agent 作者, I want 以 `createSurface(pi, {domain:"canvas", ...})` 装配一个持权威画廊快照并派发二次创作命令的 surface, so that 画廊聚合与二创能力随 AIGC extension 一起装载,而不必手接 state 桥 / ui-rpc / attachment 三条边。

#### Acceptance Criteria
1. When AIGC extension 装配, the canvas extension shall 经上游 `createSurface(pi, config)` 创建 `domain = "canvas"` 的 surface,`config.commands` 含 A 档二创命令(见 Requirement 4)、B 档回流命令(见 Requirement 5)与 `sync` 命令(见 Requirement 2),`config.hydrate` 提供画廊重建实现(见 Requirement 2)。
2. The canvas extension shall 复用上游 SDK 的 `SurfaceHandle`,**不自行构造** `control:"state"` 帧、ui-rpc 回流行或探针命令(一律由上游 `createSurface` / `wireSurfaceBridge` 承担)。
3. The canvas extension shall 以 `ExtensionFactory` 形态装载(对齐 `aigcExtension`),`initialState` 为空画廊且默认值下沉函数体(避免跨会话共享引用)。
4. When 命令处理器需要读写附件, the canvas extension shall 经 `SurfaceCtx.attachments`(即既有 `AttachmentToolContext`)resolve `att_` / 落库产物,不新增附件层领域语义。
5. Where AIGC extension 未装载 canvas surface(如非 AIGC source), the pi-web shall 正常运行会话全部既有能力,不受 canvas 缺失影响(退化见 Requirement 9)。

### Requirement 2: 画廊 = attachment store 物化视图(hydrate + sync)

**Objective:** As Canvas, I want 画廊快照从 attachment store 枚举派生而非独立持久 state, so that 图本就落 `att_`、无需自建持久层,刷新 / 重开会话能零 REST 还原,且百图不撑爆 LLM 上下文。

#### Acceptance Criteria
1. When 子进程(重)启动装配期, the canvas `hydrate()` shall 经**上游 `attachment-tool-bridge` 的 `listBySession` 枚举 seam**(`SurfaceCtx.attachments.listBySession()`)列出当前会话的图片类附件(image mime),映射为画廊资产(`attachmentId` / `displayUrl` / `mimeType` / `name` / `createdAt` / `origin`),并附加从 `.att.json` 扩展字段读出的血缘(`derivedFrom` / `genParams`),重建初始快照后推粘性快照。
2. When 一轮对话结束(LLM 可能经 `image_generation` / `image_edit` 工具产出了新图,即触发源 ①), the useSurface 消费方 shall 经 `run("sync")` 触发 agent 侧重新枚举 attachment store 并 reconcile 画廊快照,使 LLM 生成的新图自动进画廊。
3. When A / B 档命令产出新 `att_`(触发源 ②), the 命令处理器 shall 在命令内经 `ctx.setState` 直接推入新资产(乐观即时),该资产在后续 `sync` / `hydrate` 枚举中与 store 收敛为同一 `att_id`(天然去重)。
4. The canvas 画廊快照 shall **不含任何二进制**——仅 `att_id` + 签名 `displayUrl` + 轻量元数据 + 血缘引用(见 Requirement 8);快照**不进** pi 消息历史、不喂 LLM、不占 context。
5. When 快照资产被删除(`delete` 命令), the 命令处理器 shall 经 `ctx.setState` 从快照移除该资产,并与上游 `control:"state"` 的 `delete` 粘性清理语义对齐(移除后重连不再回放该资产)。
6. The canvas 画廊快照 shall 不新增任何宿主 REST 端点;还原全靠 SSE(刷新 = 粘性帧回放;子进程重启 = `hydrate` 枚举重建后推粘性帧),前端永远只订阅 SSE。

### Requirement 3: 画廊视图(9 宫格 / 密度切换 / 分页 / 分组)

**Objective:** As 用户, I want 一个 9 宫格全景、密度可切换、可分页、可分组的画廊, so that 我能高效浏览与筛选大量生成图,并把格子作为主交互单元。

#### Acceptance Criteria
1. When Canvas 挂载且 `available === true`, the 画廊渲染器 shall 经 `useSurface<GalleryState>("canvas")` 镜像快照,以 **9 宫格**为默认密度渲染资产网格,每格显示签名 `displayUrl` 缩略。
2. The 画廊渲染器 shall 提供密度切换「概览 / 瀑布流 / 聚焦」三档,切换只改变 UI 本地视图状态(不发命令、不改权威快照)。
3. When 资产数超过单页容量, the 画廊渲染器 shall 客户端分页(over 轻量快照列表),提供翻页且不重复请求二进制。
4. The 画廊渲染器 shall 支持按血缘或时间分组视图,分组为 UI 本地派生(读快照 `createdAt` / `derivedFrom`,不发命令)。
5. The 画廊视图偏好(密度 / 页码 / 选中项 / 分组模式) shall 存为客户端本地状态(不进权威快照,对齐 AAS「UI 本地偏好走客户端」约定),刷新后可从本地恢复。

### Requirement 4: A 档二次创作(image_edit 映射,走 AAS 命令通道)

**Objective:** As 用户, I want 在工作台对一张图执行指令编辑 / 局部重绘 / 参考图融合 / 扩图 / 变体 / 比例重构, so that 我能精确迭代创作而不必反复用自然语言描述,且执行绕过 LLM 推理。

#### Acceptance Criteria
1. When 用户在工作台触发 A 档动作, the 工作台 shall 经 `useSurface().run(action, args)` 发结构化命令(`SurfaceCommandPayload{domain:"canvas", action, args}`),`args` 仅含 `att_id` 引用 + 文本参数,**不含二进制**。
2. When A 档命令到达 agent 子进程, the canvas 命令处理器 shall 经 `runImageTool(params, ext, signal, onUpdate, opts)` 执行(`opts.toolName = "image_edit"`,`opts.routes` 复用 `image_edit` routes,`opts.mediaFields = ["image","mask","reference_images"]`),**在 agent 子进程内**拿 `models.json` / provider / key,不经宿主服务端、不经 LLM。
3. The A 档命令集 shall 覆盖:`edit`(image + prompt [+ model])、`inpaint`(image + mask + prompt)、`reference`(image + reference_images + prompt)、`variants`(image + prompt + n [+ 多模型])、`outpaint`(扩图:image + 扩展画布 mask + prompt / size)、`reframe`(比例重构:image + size/aspect)。
4. When `runImageTool` 返回 `details.ok === true`, the canvas 命令处理器 shall 把 `details.assets`(`{attachmentId, displayUrl, mimeType, name}`)映射为画廊资产、写入血缘(`derivedFrom` = 源 `att_`,`genParams` = 本次命令参数,见 Requirement 7)、经 `ctx.setState` 推入画廊,并作为 `SurfaceCommandResult.data`(新 `att_id` 列表)回流。
5. If `runImageTool` 返回 `details.ok === false` 或抛出, then the canvas 命令处理器 shall 回流 `ok:false` + 稳定 `error.code`(不崩会话、不留半态快照)。
6. When 命令产物需要"带入对话"让 LLM 介入, the 工作台 shall 提供显式动作经 Prompt 通道(带 `att_id`)注入,默认不注入(A 档执行对 LLM 隐形,两条线各自干净)。

### Requirement 5: B 档客户端编辑(裁剪 / 旋转 / 拼贴 / 标注)

**Objective:** As 用户, I want 在浏览器本地对图做裁剪 / 旋转 / 拼贴 / 标注, so that 无需 provider 调用即可快速加工,产物回流画廊参与后续创作。

#### Acceptance Criteria
1. When 用户执行 B 档编辑(裁剪 / 旋转 / 拼贴 / 标注), the 工作台 shall 在客户端 canvas 上处理并产出新图字节,坐标系与源图对齐(裁剪框 / mask / 拼贴位置按源图像素坐标),不经 provider。
2. When B 档产物生成, the 工作台 shall 经既有附件上传接缝把产物落成新 `att_`(base64 / 二进制不进命令 payload),再经 `useSurface().run("register", {attachmentId, derivedFrom, genParams})` 把新 `att_` 登记进画廊。
3. When `register` 命令到达 agent 子进程, the canvas 命令处理器 shall 校验 `att_` 属主(经 attachment ctx resolve)、写入血缘、经 `ctx.setState` 推入画廊,不调用任何 provider。
4. The mask 画布(inpaint / outpaint 用) shall 产出与源图同坐标系的 B/W mask `att_`,作为 A 档 `inpaint` / `outpaint` 命令的 `mask` 参数(B 档产物喂 A 档)。

### Requirement 6: C 档灵感放大(血缘树 / 参数复用 / A-B 对比 / 工作图链)

**Objective:** As 用户, I want 从血缘关系发散创作路径, so that 我能沿派生树回溯、复用历史参数、对比版本、跟踪当前工作图链。

#### Acceptance Criteria
1. When 画廊快照含 `derivedFrom` 血缘, the 画廊渲染器 shall 提供血缘树视图(UI 侧从快照 `derivedFrom` 派生父子关系,不发命令)。
2. When 用户选择"复用参数", the 工作台 shall 从选中资产的 `genParams` 预填 A 档命令表单(参数复用),用户可修改后 `run`。
3. When 用户选择两张图, the 工作台 shall 提供 A-B 并排对比视图(UI 本地,读两资产 `displayUrl`)。
4. The 工作台 shall 维护"当前工作图链"(UI 本地,沿 `derivedFrom` 的一条路径),支持在链上前进 / 回退切换当前工作图。

### Requirement 7: 血缘持久(.att.json 扩展字段)

**Objective:** As Canvas, I want 把派生血缘与生成参数持久到附件 `.att.json` 扩展字段, so that 子进程重启后 `hydrate` 枚举能重建血缘树,而不依赖内存态。

#### Acceptance Criteria
1. When A / B 档命令产出新 `att_`, the canvas 命令处理器 shall 把 `{derivedFrom, genParams}` 写入该附件的**不透明扩展 meta**(经**上游 `attachment-tool-bridge` 的 `setMeta` seam** `SurfaceCtx.attachments.setMeta(id, meta)`,附件层存不透明 JSON、不解释 canvas 语义)。
2. When `hydrate()` 枚举附件, the canvas extension shall 经**上游 `getMeta` seam**(`SurfaceCtx.attachments.getMeta(id)`)读回扩展 meta 的 `derivedFrom` / `genParams` 附加到画廊资产,重建血缘。
3. The 血缘 schema(`CanvasLineage{derivedFrom?, genParams?}`) shall 定义在 canvas 侧(领域拥有),附件层(上游 `attachment-tool-bridge`)仅提供领域无关的 meta 存 / 取 seam,不定义任何 canvas 字段名。
4. If 附件无扩展 meta(如用户直接上传、LLM 直接生成未标血缘), then the 画廊资产 shall 以无 `derivedFrom`(根节点)呈现,不报错。

### Requirement 8: Bulk 大负载走 att_ 签名 URL

**Objective:** As Canvas, I want 图像 / mask / 拼贴产物一律走 `att_` 引用, so that 二进制永不进入 SSE 帧或命令 payload,快照与命令保持轻量。

#### Acceptance Criteria
1. When 画廊快照或命令 `args` 承载图像资源, the canvas shall 仅传 `att_<id>` + 签名 `displayUrl`(HMAC 签名,`GET /attachments/:id/raw?exp&sig`),base64 / 二进制永不进帧。
2. When UI 需要渲染缩略或工作图, the 渲染器 shall 直接用快照中的签名 `displayUrl`(浏览器经旁路 GET 取字节,不经 SSE)。
3. The canvas shall 复用既有 attachment store + 签名 URL 基础设施,不新增图像分发端点、不把签名逻辑搬到 canvas。

### Requirement 9: 非 AIGC source 优雅退化

**Objective:** As pi-web, I want 换到未注册 `canvas` domain 的 agent source 时 Canvas 优雅退化, so that pi-web 照跑、Canvas 不报错不空转——这是宿主与 agent source 独立性的验证。

#### Acceptance Criteria
1. When Canvas 挂载, the Canvas 渲染器 shall 经上游 `useSurface("canvas").available` 判定当前 source 是否注册了 `surface:canvas` 探针。
2. If `available === false`, then the Canvas 渲染器 shall 退化为**只读图库 + B 档客户端编辑**:图库来源为**当前消息历史中的图片附件**(UI 已有,无需 surface),A 档命令一律禁用,不发无效命令、不报错、不空转。
3. While `available === false`, the B 档客户端编辑 shall 仍可产出新 `att_`(经既有上传接缝),但**不**经 `register` 命令回流(无 surface),仅本地呈现。
4. When 从非 AIGC source 切回 AIGC source, the Canvas 渲染器 shall 重新探测 `available` 并恢复完整能力。

### Requirement 10: 门控与入口挂载

**Objective:** As pi-web 维护者, I want Canvas 由 `NEXT_PUBLIC_PI_WEB_CANVAS` 门控且经 `launcherRail` 具名槽挂载, so that 特性默认关闭、可灰度开启,入口方式与既有 webext 挂载一致。

#### Acceptance Criteria
1. The Canvas 入口 shall 由 `NEXT_PUBLIC_PI_WEB_CANVAS` 门控,读取模式对齐既有(`=== "true" || === "1"`),**默认关闭**;关闭时入口渲染 `null`、不挂载画廊、无行为。
2. When 门控开启, the Canvas 入口 shall 经 `launcherRail` 具名槽(`SlotContribution`)挂载一个启动按钮(复用 `resolveSlot(ext, "launcherRail")` 机制,不新造 renderer)。
3. When 用户激活 Canvas 入口, the Canvas shall 展开画廊视图(main / 面板区),再次激活或关闭动作回收视图。
4. The 门控读取 shall 落在 canvas UI 组件 / 渲染器侧(client bundle),不落在宿主 `app/` / `packages/server`(保宿主中立)。

### Requirement 11: 宿主中立性

**Objective:** As pi-web 宿主, I want 搬运 Canvas 通信时不认识任何领域语义, so that Canvas 领域知识只活在 agent extension 与 UI 渲染器两端,宿主不被腐蚀。

#### Acceptance Criteria
1. When 对 `app/` 与 `packages/server` 执行 grep 领域语义字符串(`canvas` / `gallery` / `image_edit`), the 检查 shall 找不到任何匹配(领域知识只活在 canvas extension、canvas 命令处理器、canvas UI 渲染器)。
2. The pi-web 宿主 shall 转发 `control:"state"`(`key = "surface:canvas"`)时把 `value` 当作 `unknown` 不 peek,转发 ui-rpc 命令时把 `payload` / `result` 当作 `unknown` 不解析(复用上游 AAS 中立搬运)。
3. When Canvas 渲染器经 `launcherRail` 槽挂载, the pi-web 宿主 shall 把槽名当作不透明字符串,不常驻、不知情。
4. The canvas 命令 shall 走 AAS 的 agent 转发路径(`SurfaceCommandPayload` 无顶层 `name` → 逃逸 host 拦截 → `session.uiRpc`),严禁走宿主主进程 host 命令路径(保 provider / models.json 独立性)。

### Requirement 12: 消费上游附件枚举与不透明 meta seam

**Objective:** As Canvas, I want 经 `SurfaceCtx.attachments` 消费上游 `attachment-tool-bridge` 提供的会话枚举与不透明 meta seam, so that `hydrate` 能重建物化视图、血缘能持久,而 seam 实现与领域无关性由上游承担、Canvas 不改附件层任何文件。

#### Acceptance Criteria
1. When canvas `hydrate` / `sync` 需要重建物化视图, the canvas extension shall 经**上游提供的** `SurfaceCtx.attachments.listBySession()`(子进程侧、会话作用域、只读枚举当前会话 `att_` 描述符)消费,**不自建枚举实现、不改 `agent-kit` / `server` / `attachment-store`**。
2. When canvas 需要持久 / 读回血缘, the canvas extension shall 经**上游提供的**不透明扩展 meta seam `SurfaceCtx.attachments.getMeta(id)` / `setMeta(id, Record<string, unknown>)` 存取,canvas 用它存 `{derivedFrom, genParams}`;附件层视 meta 为 opaque JSON、不解释内容。
3. The 上游枚举 / meta seam shall 领域无关:附件层代码不出现 `canvas` / `gallery` / `derivedFrom` / `genParams` 等领域字段名(它们只活在 canvas 侧);此约束由上游 `attachment-tool-bridge` 保证,Canvas 消费方以此为前置。
4. When 会话有大量图片附件, the `hydrate` 枚举 shall 只取上游返回的轻量描述符(不物化字节),性能与图数成线性、不阻塞会话启动(必要时装配期异步重建后推粘性快照)。

### Requirement 13: 质量门(测试 / e2e / 类型安全 / 零回归)

**Objective:** As pi-web 项目, I want Canvas 以新鲜运行证据证明正确, so that 满足项目硬规则(单元 / 集成测试 + 浏览器 e2e + TypeScript strict、无 `any`)。

#### Acceptance Criteria
1. The Canvas 实现 shall 以 TypeScript strict 编写,不使用 `any`,全工作区 `typecheck` 通过。
2. The Canvas 实现 shall 为每个可测单元(血缘 / 快照 schema、canvas 命令处理器映射、`hydrate` 枚举重建、画廊 UI 密度 / 分页 / 分组、B 档客户端处理坐标、退化分支)提供单元测试。
3. The Canvas 实现 shall 提供**真实子进程集成测试**覆盖"A 档命令 → `wireSurfaceBridge` 转发 → canvas 处理器调 `runImageTool`(可 stub provider)→ 新 `att_` + 血缘 meta 落库 → `ctx.setState` → `control:"state"` 下行帧携带新资产"与"`hydrate` 枚举重建画廊"。
4. The Canvas 实现 shall 提供浏览器 e2e:AIGC source 下走"画廊挂载 → 点格子展开工作台 → `run` A 档命令 → 快照回流 → 新图进画廊"闭环(断言命令不过 LLM,无 `/messages`);并验刷新后经粘性帧回放画廊仍在;并验切非 AIGC source → `available === false` → 退化只读不报错。
5. When Canvas 门控关闭或未被使用, the pi-web shall 表现与未引入 Canvas 时一致(零回归)。
