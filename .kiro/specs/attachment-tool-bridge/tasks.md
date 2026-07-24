# Implementation Plan

> 前置依赖:`attachment-store`(L0/L1:`BlobStore`/`LocalFsBlobBackend`/`AttachmentRegistry`/`UrlSigner`/`AttachmentStore` 门面、`attachmentStoreConfigFromEnv`、`Attachment`/`AttachmentOrigin` DTO、`PI_WEB_ATTACHMENT_DIR`、`/raw` 分发)需先落地。本计划复用其契约,不重定义。

- [x] 1. 基础:子进程 store 与测试脚手架
- [x] 1.1 子进程 store 客户端工厂(从 env 实例化、指向同一后端、env 缺失降级)
  - 实现从 `process.env` 读取 `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET`(二者均由 attachment-store 经 spawn env 下发),组合 `attachment-store` 受认可复用面(`attachmentStoreConfigFromEnv` + `LocalFsBlobBackend`/`AttachmentRegistry`/`UrlSigner`)实例化**上游 `AttachmentStore` 门面**作为子进程 store 客户端(`ChildAttachmentStore` 即上游门面别名,不自定义重名访问器/不内联 meta)
  - 经上游门面暴露读元信息(`head`)、读流(`getReadStream`,meta=上游 `BlobMeta`)、本地落盘路径(`localPath(id)`)、按属主列举(`listBySession(sessionId)`)、落库(`put` 来源 `tool-output`)、签发展示 URL(`presignUrl`)的能力,全部经门面调用、不绕过门面抠后端内部
  - secret 与主进程一致,使子进程产出的 `/raw` 签名 URL 能在主进程通过验证
  - 当存储目录约定缺失时返回"不可用",而非崩溃
  - 观察完成:单测证明给定 DIR+SECRET 可构造可用门面客户端;缺失目录约定时返回不可用标记;客户端落盘后用同目录另一实例按 id 可读到一致内容;子进程 `presignUrl` 产出在主进程同 secret 校验通过
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Boundary: createChildAttachmentStore（复用上游 AttachmentStore 门面，不重定义类型）_

- [x] 1.2 校验 runner 子进程已收到 store 下发的存储 env(verification-only,不编辑 spawn env)
  - **不编辑** `lib/app/pi-handler.ts` 的 spawn env:`PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET` 由 attachment-store 全权下发(透传归其拥有)
  - 仅校验/断言 runner 子进程进程内已收到 store 下发的 DIR + SECRET env,且据此构造的子进程 store 与主进程指向同一目录、secret 一致
  - 确认 e2e/隔离场景下该 env 也覆盖到 runner 子进程路径
  - 观察完成:集成测试断言 runner 子进程进程内可见 DIR+SECRET env(由 attachment-store 下发),据此构造的 store 与主进程指向同一目录且 secret 一致;本任务不引入任何 spawn-env 编辑 diff
  - _Requirements: 3.2_
  - _Boundary: pi-handler 子进程 env 校验（assertion-only，无 spawn-env 编辑）_
  - _Depends: 1.1_

- [x] 2. L2 投影与临时文件回收
- [x] 2.1 (P) 临时文件登记与两级回收
  - 实现临时文件登记器:按工具调用维度与会话维度登记懒下载产生的临时文件,提供"调用结束回收"与"会话结束回收"两入口
  - 本地后端路径不登记(无临时文件,no-op);回收失败吞错记日志不阻断主流程
  - 观察完成:单测证明本地路径不登记;模拟登记后按调用与按会话回收均删除对应临时文件
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - _Boundary: TempFileTracker_

- [x] 2.2 (P) AttachmentHandle 与 resolve(四形态投影)
  - 实现按公开 id 解析出携带元数据且提供原始字节、可读流、本地路径、网络 URL 四种访问形态的句柄;句柄不暴露 base64 形态
  - 本地后端本地路径**委托上游门面 `localPath(id)`** 直返落盘路径 `<root>/<id>`(不复制,依赖已冻结盘上布局,不绕过门面抠后端);远程后端本地路径经临时文件登记器懒下载(接口预留可切换,本切片不落地远程实现);URL 形态复用既有分发签名同形;`meta` 复用上游 `Attachment`、`stream()` 的 meta 复用上游 `BlobMeta`,不内联重定义
  - 不存在/不可读时抛可按类型识别的解析错误,不返回空当成功
  - 观察完成:单测证明本地路径经门面直返不复制、字节/流往返一致(meta 为上游 `BlobMeta`)、不存在 id 抛可识别错误、句柄无 base64 形态
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 9.2_
  - _Boundary: AttachmentHandle, resolve_
  - _Depends: 1.1, 2.1_

- [x] 3. 闸门与回流(横切层)
- [x] 3.1 (P) beforeToolCall 属主校验闸门
  - 实现工具执行前闸门:从工具参数提取附件引用(`attachmentId`),校验当前会话是否为该附件属主
  - 越权或引用不存在 → 阻断(block),不进入执行;参数不含附件引用 → 放行
  - 观察完成:单测证明他会话引用被 block、不存在引用被 block、无引用放行、本会话拥有放行
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Boundary: ownership-guard_
  - _Depends: 1.1_

- [x] 3.2 (P) afterToolCall base64 剥离闸门
  - 实现工具结果出口闸门:默认把结果内联图像剥离、替换为指向公开 id 的文本引用,保留原文本部分;结果被显式标记需复看时保留图像;无内联图像时原样透传
  - 在统一出口集中实现,使各工具无需各自编写省 context 逻辑;末尾触发该次调用的临时文件回收
  - 观察完成:单测证明默认剥离并保留文本、标记复看保留图像、无图像原样透传、触发调用级临时文件回收
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 9.1, 9.3_
  - _Boundary: base64-gate_
  - _Depends: 2.1_

- [x] 3.3 (P) tool-output 落库回流
  - 实现产出物先落库(来源标记 `tool-output`、铸造公开 id)再以引用回流;产出 id 与上传 id 同一空间,可被后续消息再次引用
  - 以引用(公开 id 与展示 URL)而非内联字节回流,使展示侧可经既有分发 URL 呈现;落库失败不回半落库引用,以可识别失败表明
  - 观察完成:单测证明落库铸 `tool-output` 来源的公开 id、返回引用而非字节、落库失败不回引用
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Boundary: tool-output_
  - _Depends: 1.1_

- [x] 3.4 (P) prompt 文本引用注入
  - 实现把附带的已落库附件以稳定结构化文本标记(含公开 id、类型、文件名)注入用户消息文本;无附件不注入;仅注入文本不内联附件字节
  - 观察完成:单测证明多附件产稳定标记含 id/类型/文件名、无附件返回空、输出不含 base64/`data:`
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.1_
  - _Boundary: reference-injection_

- [x] 4. tool 接入范式与示例 tool
- [x] 4.1 tool 接入上下文(暴露 store 句柄给 tool 作者)
  - 实现让工具在其执行逻辑内取得子进程 store 句柄的接入上下文(解析输入附件、落库产出附件、可用性标记);经 agent-kit 暴露类型给工具作者按 `@blksails/pi-web-agent-kit` 引用
  - 观察完成:工具作者可经 agent-kit 引用上下文类型;上下文在存储能力不可用时 available 为 false
  - _Requirements: 4.1_
  - _Boundary: AttachmentToolContext, agent-kit_
  - _Depends: 1.1, 2.2, 3.3_

- [x] 4.2 端到端示例 AgentTool(协议兼容 + 三种 resolve 用法 + 回流)
  - 实现至少一个示例图像工具:以显式 `attachmentId` 参数承载输入引用;在执行内演示本地路径、网络 URL、原始字节三种解析用法;产出新文件经落库回流
  - 满足 pi 协议:描述与结构化结果明细必填;若回图,图像数据字段为已等待求值的字符串(裸 base64),不是未求值的 Promise
  - 观察完成:示例工具被装配为 customTool;集成测试在子进程内跑通"解析→处理→落库→回引用",回图数据为字符串
  - _Requirements: 4.2, 4.3, 4.4, 4.5, 7.1, 7.2, 7.3_
  - _Boundary: 示例 AgentTool_
  - _Depends: 4.1_

- [x] 5. runner 集成接线
- [x] 5.1 把闸门与子进程 store 接入 runner 装配
  - 在 runner 装配运行时与循环配置处:实例化子进程 store 客户端,把属主校验接到执行前闸门、把 base64 剥离接到结果出口闸门,把 store 句柄经 tool 接入上下文透给 customTools
  - 会话生命周期结束时触发会话级临时文件回收
  - 观察完成:集成测试证明装配后执行前/结果出口两闸门被调用(越权被 block、含 base64 结果被剥离),示例工具能拿到 store 句柄
  - _Requirements: 2.3, 5.1, 6.3, 3.3_
  - _Boundary: runner, option-mapper_
  - _Depends: 3.1, 3.2, 4.1_

- [x] 5.2 prompt 注入接入服务端消息构造(command-routes.makeMessagesHandler)
  - 在 `packages/server/src/http/routes/command-routes.ts` 的 `makeMessagesHandler` 内、`session.prompt(message, options)` 之前(与既有 `resolveCompletions` token 解析同一 message 文本组装链路)接入 `buildAttachmentRefs` 文本引用注入(与现状 `images`/vision base64 并存,不替代、不内联字节)
  - 观察完成:集成测试证明附带附件的用户消息文本含结构化引用标记,且 vision/images 路径维持现状
  - _Requirements: 8.1, 9.1_
  - _Boundary: command-routes.ts(makeMessagesHandler — 服务端 prompt 构造), reference-injection_
  - _Boundary: 该文件为**服务端** prompt 构造,与 attachment-store 拥有的**客户端**文件(`packages/react/src/transport/agent-message-to-ui.ts`、`packages/react/src/hooks/use-attachments.ts`、`packages/ui/src/elements/attachments.tsx`、`packages/ui/src/chat/pi-chat.tsx`)**不相交**;本任务不触碰任何 client 文件_
  - _Depends: 3.4_

- [x] 6. 验证
- [x] 6.1 单元/集成测试套件(新鲜运行)
  - 汇总并跑通覆盖 L2 四形态、临时文件回收、子进程 store 指向同一后端、属主校验阻断、base64 剥离、tool-output 回流、引用注入、双进程同后端一致性、runner hook 接线、示例 tool 子进程端到端的单元/集成测试
  - 观察完成:`vitest` 新鲜运行全绿,输出作为证据
  - _Requirements: 10.1, 10.4_
  - _Depends: 5.1, 5.2_

- [x] 6.2 浏览器 e2e 全链路(隔离 build)
  - 编写并跑通浏览器 e2e:上传→发消息注入引用→模型调用示例 tool→子进程 resolve+处理+落库→引用回流→前端经分发 URL 展示;断言结果无内联 base64;验证跨轮回环(下一轮再次引用产出 id)
  - 使用隔离构建产物(独立 dist 目录),不污染开发态默认构建
  - 观察完成:Playwright e2e 新鲜运行通过,断言分发 URL 200 且 tool result 不含 base64,产出 id 可在下一轮再次引用
  - _Requirements: 7.2, 10.2, 10.3, 10.4_
  - _Depends: 6.1_

## Implementation Notes

- task 4.2 → 5.1 接线门:示例 agent tool(examples/attachment-tool-agent/tools/edit-image-tool.ts)在 jiti 装载期拿不到闭包,故经 `globalThis.__piWebAttachmentToolContext__` 取 `AttachmentToolContext`,缺失时降级 `available:false`。**task 5.1 runner 装配必须**在 customTools 组装时把闭包绑定的 ctx 设到该 key(或将示例工具改为工厂闭包注入),否则 e2e(6.2)示例工具静默跑在"能力不可用"模式。server 侧 createEditImageTool(ctx) 用的是 design 规定的工厂闭包注入(无此问题)。
- 闸门同形解耦(task 3.1/3.2):pi 内层 `AgentLoopConfig.beforeToolCall/afterToolCall` 类型不可达(仓库只依赖 @earendil-works/pi-coding-agent 公开面),闸门实现为纯函数 + 与公开 `ToolCallEventResult`/`(TextContent|ImageContent)[]` 同形的本地接口。**task 5.1** 接 runner 实际 hook 时需做一次 narrowing 适配(零阻抗,字段同形)。
- task 5.2 → 6.2 接线门:reference 注入要在真实运行/e2e 生效,装配层 `lib/app/pi-handler.ts` 的 `createPiWebHandler({...})` 必须传 `attachmentStore`(主进程 store,config 已在 pi-handler.ts:226 实例化)。5.2 守边界未改装配;**6.2 e2e 前需补**这条 + 5.1 的 `globalThis.__piWebAttachmentToolContext__` 接线,才能跑通"注入引用→模型调示例 tool→回流"。

- [x] 7. 增量:hydrate/血缘领域无关 seam(2026-07-02)
  - `AttachmentRegistry`/`AttachmentStore` 新增 `getMeta`/`setMeta`(旁路文件不透明 `ext` 字段);`AttachmentToolContext`(server + agent-kit 作者面类型)新增 `listBySession()`/`getMeta`/`setMeta`
  - 观察完成:`packages/server` 169 attachment* 测试 + 1063 全量测试绿,`packages/agent-kit` typecheck 绿(含 `attachment.type-test.ts` 新增用例)
  - _Requirements: 增量 1-4_
  - _Boundary: attachment-store(AttachmentRegistry/AttachmentStore), attachment-bridge(tool-context.ts), agent-kit(attachment.ts)_
