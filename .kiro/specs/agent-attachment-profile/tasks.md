# Implementation Plan

> **执行环境(前置)**:实现基线 = worktree `.claude/worktrees/attachment-backend-pluggable`(分支 `feat/attachment-backend-pluggable`,含上游 `attachment-backend-pluggable` 全部实现);所有任务在该 worktree 内叠加实现,**勿在主工作树开工**。

- [x] 0. 环境基线确认
  - 进入上述 worktree,新鲜运行上游 attachment 相关测试(server 包)与 typecheck(排除 desktop)确认基线绿
  - 完成态 = 新鲜运行输出(此输出兼作 6.4「既有测试零改动全绿」的基线锚点)
  - _Requirements: 1.2_

- [x] 1. Foundation:契约底座
- [x] 1.1 协议层装配期 profile 帧
  - 新增帧 schema(type 字面量 + 非空 profile 字符串),barrel 导出;单测断言合法/畸形两态解析
  - _Requirements: 2.3_
- [x] 1.2 agent 声明面字段与形状校验
  - agent 定义契约加可选 attachmentProfile 字段(JSDoc 说明白名单与凭据边界);loader 归一化:非空、与后端名同规的字符格式,非法抛既有定义错误
  - 完成态 = loader 单测覆盖合法/空串/非法字符三态
  - _Requirements: 1.1, 1.3_

- [x] 2. Core:写路径覆盖口子
- [x] 2.1 (P) 端口 per-call 写目标覆盖
  - 端口 put 加可选 opts(writeBackend);union 消费:优先于写策略、未注册名字抛既有语义错误;local-fs/s3 实现签名兼容忽略
  - 完成态 = union 单测覆盖优先级/未注册/不传三态,不传 = 现状(既有测试零改动)
  - _Requirements: 3.1, 3.3, 1.2_
  - _Boundary: BlobStore 端口与 UnionBlobStore、local-fs/s3 签名兼容_
- [x] 2.2 门面写目标透传
  - PutInput 加可选 writeBackend,原样透传 blob.put 第 4 参;描述符固化仍走回执链不变
  - 完成态 = 门面单测断言透传与固化不变
  - _Requirements: 3.1_
- [x] 2.3 (P) 子进程 store 静态绑定
  - config 工厂 options 加 writeProfile:拓扑分支写策略改「writeProfile ?? 拓扑默认」,失配抛既有配置错误;child-store 透传 opts
  - 完成态 = config/child-store 单测覆盖覆盖生效/失配/不传三态
  - _Requirements: 3.2, 1.2_
  - _Boundary: backends 装配(config/child-store)_

- [x] 3. Core:runner 子进程侧
- [x] 3.1 装配期白名单校验与关断门控
  - runner 在定义加载后:关断 env 生效 → 视同未声明;否则对照拓扑 env 名字集校验,未命中(含无拓扑)抛既有定义错误(含名字),复用 ready 前退出失败链
  - 完成态 = runner 单测覆盖命中/未命中/无拓扑/关断四态
  - _Requirements: 2.1, 2.2, 5.1_
  - _Depends: 1.2_
- [x] 3.2 profile 帧发射与附件桥接线
  - 新增装配期单帧 wiring(关断 → 零帧);attachment-wiring 入参加 writeProfile 透传 child store;runner 按序调用
  - 完成态 = wiring 单测断言帧形状与关断零帧;attachment-wiring 单测断言透传
  - _Requirements: 2.3, 3.2_
  - _Depends: 1.1, 2.3_

- [x] 4. Core:主进程侧
- [x] 4.1 (P) 会话级 profile 投影
  - pi-session 消费 profile 帧(zod 校验;畸形/关断/名字失配 → warn+丢弃不失败),缓存会话级字段并暴露只读 getter
  - 完成态 = pi-session 单测覆盖缓存/三类丢弃
  - _Requirements: 2.1, 2.3_
  - _Depends: 1.1_
  - _Boundary: PiSession_
- [x] 4.2 (P) 上传路由写目标解析
  - createAttachmentRoutes 加可选 resolveWriteBackend 注入;upload handler 解析 sessionId → 写进 PutInput;解析不到回落 undefined(宿主默认)
  - 完成态 = 路由单测覆盖注入生效/回落两态
  - _Requirements: 3.1_
  - _Depends: 2.2_
  - _Boundary: attachment-routes_

- [x] 5. Integration:装配接线
- [x] 5.1 pi-handler 接线
  - resolver 经会话管理器查 PiSession getter 注入上传路由;关断 env 纳入 spawn 下发清单
  - 完成态 = 单测断言 resolver 链路与下发变量集合
  - _Requirements: 3.1, 5.1_
  - _Depends: 4.1, 4.2_

- [x] 6. Validation:集成与回归
- [x] 6.1 真实子进程双态集成
  - 声明有效 profile 的 definition → 子进程工具产物落 profile 后端且描述符固化该名;未注册 profile → 子进程 ready 前退出(exit ≠ 0)
  - _Requirements: 2.2, 3.2_
- [x] 6.2 会话隔离与生命周期集成
  - profile 会话与未声明会话并存各落其目标;profile 落库对象经新建门面实例(模拟重启)按描述符读回与签发
  - _Requirements: 3.3, 4.1, 4.2_
- [x] 6.3 关断双态集成
  - 仅主进程设关断 / 关断经 spawn 下发两态:会话正常创建、写入落宿主默认、未声明 agent 行为不变
  - _Requirements: 5.1, 5.2_
- [x] 6.4 全仓回归
  - 全仓 typecheck + 测试全绿(既有 attachment 测试零改动 = 全参数可选的结构性证明);完成态 = 新鲜运行输出
  - _Requirements: 1.2_

## Rules & Tips

- **barrel 边界**:`packages/server/src/index.ts` 不导出 `./runner/index.js`(避免把 pi SDK 拖进路由/webpack 产物)。任何要被 `lib/app` 消费的常量/函数,若逻辑归属在 `runner/` 下,必须下沉到已被 barrel 导出的模块(如 `attachment/`),`runner/` 内部再 re-export 一份保持既有导入路径。判定新增导出前先确认消费方是否跨越这条边界。
- **spawn-time env 必须捕获一次,不能在闭包里惰性读 `process.env`**:凡是要进子进程 spawn env 的值,须在 `buildSingleton`(或等价的单例装配点)时机就地捕获成局部变量,像 `dir`/`secret` 那样;若在实际调用 `attachmentSpawnEnv` 等函数体内现读 `process.env`,测试(以及生产环境下的多会话时序)都可能踩到读取时机漂移的坑。
- **主/子进程各自读自身 env,不共享**:`pi-session.ts` 里任何对 `process.env` 的防御性核对,读的是**主进程自身**的 env,与子进程 spawn env 是两份独立拷贝。写覆盖真实部署形态的集成测试时,凡是主进程侧要做的校验,必须把同名 env 变量也设在测试(主)进程自己的 `process.env` 上,不能只塞进子进程的 `spawn.env`。
- **`SessionSnapshot` 没有 `code` 字段**:lifecycle 的 `code`/`detail`(如 `exit-before-ready`)只存在于 `session-status` 控制帧的 `payload` 里,不在 `session.snapshot` 上。断言退出态要订阅帧(`session.subscribe`)取最后一条 `session-status`,不要猜测门面上有等价字段。
- **共享落盘目录 = 共享 registry,不等于「按 store 实例隔离」**:多个 `AttachmentStore`/`attachmentStoreConfigFromEnv` 实例只要指向同一个 `PI_WEB_ATTACHMENT_DIR`,`listBySession` 等读操作看到的是同一份磁盘索引,与创建了几个 store 实例无关。要验证"会话隔离"应断言按 `sessionId`/`id` 过滤的正确性,而不是假设不同 store 实例互相看不见对方的写入。
- **真实子进程集成测试的超时余量在全仓并发下要更宽**:单独跑通过的 real-subprocess 测试,在 `pnpm -r` 全仓并发(多个 workspace 同时抢 CPU)下可能因为子进程启动变慢而撞上原本够用的 `waitFor`/`it(..., ms)` 超时——这不代表逻辑有问题,加大余量(而不是加逻辑重试)即可,加大后应重跑全仓套件验证不是在掩盖真实 bug。
