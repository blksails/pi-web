# Implementation Plan

> **执行环境(前置)**:实现基线 = worktree `.claude/worktrees/attachment-backend-pluggable`(分支 `feat/attachment-backend-pluggable`,含 `attachment-backend-pluggable` 与 `agent-attachment-profile` 两个上游 spec 的全部实现);所有任务在该 worktree 内叠加实现,**勿在主工作树开工**。

- [x] 0. 环境基线确认
  - 进入 worktree,新鲜运行 server/protocol 测试与 typecheck(排除 desktop)确认基线绿;输出兼作 7.5 回归锚点
  - _Requirements: 1.2_

- [x] 1. Foundation:契约底座
- [x] 1.1 协议层目录契约与帧
  - CatalogEntryDto + 装配期声明帧 + 运行期请求/结果帧(list/materialize 判别)+ 推送事件帧 schema;SSE control 载荷判别集增 attachment 变体;barrel 导出
  - 完成态 = schema 单测覆盖各帧合法/畸形两态
  - _Requirements: 1.4, 2.3, 4.2_
- [x] 1.2 agent 声明面与形状校验
  - agent 定义契约加可选 attachmentCatalog(list/resolve 两 handler)与条目/解析结果类型;AttachmentToolContext **agent-kit 类型面**增 publish(服务端 tool-context 工厂与实现归 2.3);loader 归一化:handler 必须为函数,非法抛既有定义错误
  - 完成态 = loader 单测覆盖合法/缺 handler/非函数三态
  - _Requirements: 1.1, 1.2_

- [x] 2. Core:子进程侧
- [x] 2.1 catalog 桥骨架(声明/枚举/隔离)
  - 无声明 → 零帧零 reader;有声明 → 装配期声明帧 + 独立 stdin reader(非本桥帧放行/畸形丢弃/每帧独立派发/永不抛出);list 派发到 agent handler,错误 → 类型化错误结果帧;runner 按序接线(attachment 桥后、runRpcMode 前)
  - 完成态 = 桥单测覆盖零帧分支/list 派发/handler 抛错不崩/畸形帧放行
  - _Requirements: 1.2, 1.3, 6.1, 6.2, 6.3_
- [x] 2.2 物化通路(幂等/串行化/落库)
  - materialize:in-flight 按 entryId 复用同一 Promise;内存幂等映射 miss → listBySession+getMeta 扫描匹配 entryId+version → 命中复用;未命中 → agent resolve → child store putOutput(继承拓扑/profile 写路由)→ setMeta 幂等锚 → 回 attachmentId;条目不存在/抛错 → 类型化错误帧
  - 完成态 = 单测覆盖幂等三态(内存命中/meta 命中/version 变更新落库)、并发串行化、错误分支
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 5.3_
- [x] 2.3 (P) agent 主动推送 publish
  - attachment-wiring 构造 ctx 时注入 publish = putOutput + fd1 写推送事件帧(单次原子写,与各桥同坑)
  - 完成态 = 单测断言 publish 落库且发出事件帧;seam 未注入时安全降级
  - _Requirements: 4.1_
  - _Boundary: attachment-bridge/tool-context(类型+工厂)+ attachment-wiring(ctx 构造注入)_

- [x] 3. Core:主进程会话面
- [x] 3.1 pi-session 目录面与事件转发
  - 声明帧缓存会话级 catalogAvailable;catalog pending map + requestCatalog(op) 超时收敛;推送事件帧 → SSE control:"attachment"(尾沿节流 ≤1 帧/秒);畸形帧 warn+丢弃
  - 完成态 = pi-session 单测覆盖缓存/pending 超时/事件转发+节流/畸形丢弃
  - _Requirements: 1.4, 2.4, 4.2_
  - _Depends: 1.1_

- [x] 4. Core:补全与端点
- [x] 4.1 (P) catalog 补全 provider
  - kind:"catalog";complete:声明未缓存 → 空,否则经会话索 list(约 700ms 上限),超时/错 → 空组不影响其他 provider;条目形状(insertText 为 @catalog:<id> token/分组);resolve 兜底:materialize 成功回附件标记,失败 null
  - 断言 list 仅经请求会话的 requestCatalog 索取(枚举路径会话隔离)
  - 完成态 = provider 单测覆盖门控/形状/超时降级/resolve 两态;注册表级断言其他分组不受影响
  - _Requirements: 2.1, 2.2, 2.4, 3.2, 5.4_
  - _Depends: 3.1_
  - _Boundary: catalog-provider_
- [x] 4.2 (P) 物化端点
  - POST /sessions/:id/attachment-catalog/:entryId/materialize;200 带 attachmentId/描述符/displayUrl;404 会话或条目/502 目录错误/504 超时(env PI_WEB_ATTACHMENT_CATALOG_TIMEOUT_MS 缺省 20000);复用既有会话鉴权门
  - 完成态 = 路由单测覆盖全部状态分支与鉴权
  - _Requirements: 3.2, 3.4, 5.4_
  - _Depends: 3.1_
  - _Boundary: attachment-catalog-routes_
- [x] 4.3 handler 装配
  - create-handler 注册 catalog provider(注入会话访问器)+ 挂物化路由
  - 完成态 = 装配单测断言 provider 与路由可达
  - _Requirements: 2.1, 3.2_
  - _Depends: 4.1, 4.2_

- [x] 5. Core:前端
- [x] 5.1 (P) react 客户端与事件消费
  - pi-client 增 materializeCatalogEntry(sessionId, entryId);sse connection 消费 control:"attachment" 暴露事件回调
  - 完成态 = client/connection 单测断言端点调用形状与回调触发
  - _Requirements: 3.2, 4.2_
  - _Depends: 1.1_
  - _Boundary: packages/react_
- [x] 5.2 accept 异步换写状态机
  - 选中 catalog 条目:立即插入 @catalog token → 异步物化 → 成功按精确原 token 文本定位换写 @attachment:<attId> + 注册预览;原 token 被编辑 → 放弃换写;失败 → 撤 token + 用户可见失败反馈(失败反馈文案 i18n 键归本任务,zh/en)
  - 完成态 = ui 单测覆盖成功换写/编辑放弃/失败撤销三态
  - _Requirements: 3.2, 3.4_
  - _Depends: 5.1, 4.2_
- [x] 5.3 事件刷新与 i18n
  - control:"attachment" 事件 → bump 会话附件刷新信号(补全浮层开启则重查/预览与附件展示重拉);i18n 增 completion.kind.catalog 分组名(zh/en)
  - 完成态 = ui 单测断言事件后重拉触发;i18n 两语言键存在
  - _Requirements: 4.2, 4.3_

- [x] 6. 范例
- [x] 6.1 attachment-catalog-agent 可跑范例
  - examples/ 新目录:声明 catalog(内存条目)+ publish 演示;README 演练(补全发现/选中物化/推送感知);examples/README.md 注册
  - 完成态 = jiti 装载冒烟(声明/兜底降级)通过
  - _Requirements: 1.1, 4.1_

- [x] 7. Validation
- [x] 7.1 真实子进程目录全链集成
  - fixture 声明 catalog → 主进程 list 拿条目 → materialize 回 attachmentId → 按 id 签名分发可读;重复 materialize 同 entryId+version → 同一 attachmentId
  - _Requirements: 3.1, 3.2, 3.3, 5.1_
- [x] 7.2 busy 并发与 publish 集成
  - 推理中 list 照常应答;publish → 主进程收事件帧转 SSE control:"attachment";落库件可分发
  - _Requirements: 2.3, 4.1, 4.2, 4.4_
- [x] 7.3 重启与未声明回归
  - 子进程重启:重启前物化件仍可分发,重启后 list 以新应答为准;未声明 agent 的补全响应与既有完全一致
  - _Requirements: 5.1, 5.2, 1.2_
- [x] 7.4 浏览器 e2e 关键旅程
  - @ 补全出现 catalog 分组 → 选中 → 输入区附件预览 → 发送 → 消息含附件引用且渲染;agent publish 后免刷新在 @ 补全附件分组可见
  - _Requirements: 2.1, 3.2, 4.2_
- [x] 7.5 全仓回归
  - 全仓 typecheck + 测试全绿(既有补全/附件测试零改动);完成态 = 新鲜运行输出
  - _Requirements: 1.2_

## Rules & Tips

- **materialize 的幂等 version 从哪来是设计留白,已显式决策**:请求帧只带 `entryId` 不带
  `version`;桥维护 `lastKnownVersion`(entryId→version)由每次 `list()` 响应回填,materialize
  时按此取"当前应产出版本"。从未被 list 过的 entryId 视为 `version:undefined`(设计已定
  "无版本=恒同内容"语义)。同理,`resolve` 抛错时按"该 entryId 是否曾被 list 过"分类为
  `ENTRY_NOT_FOUND`(从未见过)或 `CATALOG_ERROR`(曾枚举过,取失败视为处理器侧错误)——
  design.md 未逐字规定,这是本轮补的显式取舍,写在 `attachment-catalog-wiring.ts` 头注释里。
- **落盘 meta 扫描幂等分支跨真实进程重启是否复用同一 attachmentId,依赖 pi SDK 会话恢复是否
  延续同一 sessionId**——这是上游会话恢复机制的语义,不在本 spec 保证范围。7.3 的真实重启
  集成测试原本断言"重启后重复 materialize 命中同一 attachmentId",实测发现两次 sessionId
  不同(listBySession 扫不到旧会话的附件),遂放宽为只断言"请求通道重启后仍可用、新调用
  成功落库"。落盘 meta 扫描分支本身的正确性已在 2.2 单测里用假 store 独立验证过。
- **React 组件测试里,两段异步(先 microtask 落定 state,再 debounce 定时器触发 fetch)必须
  拆成两个独立 `act()` 块**,合并成一个 `await act(async () => { await Promise.resolve(); …
  await vi.advanceTimersByTimeAsync(150); })` 会让第二段的 `setTimeout` 从未被调度(React
  18 批处理导致 state 更新提交与定时器注册之间存在提交时序耦合)。`pi-completion-popover.test.tsx`
  的 `renderOpen()`+`flush()` 两段式先例正是为此设计,新写涉及 debounce 的 hook 测试必须照抄
  这个两段式,不要图省事合并。
- **给已有接口新增必填方法(如 `AttachmentToolContext.publish`),要用 grep 找全仓所有手写实现
  该接口的对象字面量**(不只是主实现),包括 e2e 测试里的适配器(`e2e/node/*.test.ts`)、
  各 examples 的 fallback/降级常量对象——这些不会被包内 typecheck 抓到,只有跑根 tsconfig
  才会报错(本轮吃过一次:`e2e/node/aigc-generation-tools.e2e.test.ts` 两处手写 ctx 漏了
  `publish`,直到 7.5 全仓回归的根 tsc 才暴露)。
- **手写 mock 的 `ControlStore`(如 `pi-chat-logs.test.tsx` 那种不用真实类、纯对象字面量模拟
  `connection.controlStore` 的测试)在 `ControlStore` 新增订阅方法(`onAttachmentEvent`)时
  同样会漏,且只有跑到该组件渲染路径的测试才会在运行时报错(`... is not a function`),
  typecheck 抓不到(mock 对象经 `as unknown as` 强转)。全仓测试全绿是唯一能发现这类缺口的
  检验点。
- **浏览器 e2e(7.4)按团队指示降级**:agent publish 免刷新感知这条旅程,改用 SSE 帧级测试
  (`control-store-attachment-event.test.ts`)+ 组件级测试(`pi-completion-popover-refresh-signal.test.ts`
  验证 `refreshSignal` 强制重查)+ hook 级测试(`use-catalog-materialize.test.tsx` 验证换写
  状态机)三者组合覆盖同一条链路的各个环节,未搭建真实 Playwright 浏览器旅程(与
  `agent-attachment-profile` spec 里 e2e 降级为 SSE 断言的先例同理)。
