# Research & Design Decisions — agent-attachment-profile

## Summary
- **Feature**: `agent-attachment-profile`
- **Discovery Scope**: Extension(挂在已实现的 `attachment-backend-pluggable` 与既有装配期声明帧机制上)
- **Key Findings**(全部来自对 Spec 1 实现代码的实地探查,worktree `feat/attachment-backend-pluggable`):
  - 写路由现状是**构造期静态单值**:`config.ts:139` `writePolicy: () => topology.write`;`WritePolicy` 只吃 `BlobMeta{mimeType,size}`,门面 `put` 把 `sessionId` 挡在 blob 层之外(`attachment-store.ts:116`)——会话级写路由必须新开口子。
  - **子进程一会话一进程**:child store 经 `createChildAttachmentStore(env)` 构造、只服务一个会话 → 子进程侧写策略可以**静态绑定** profile,零 per-call 改造。
  - **主进程门面是跨会话单例**(`pi-handler.ts:382` 装配一次、`createAttachmentRoutes(store)` 单依赖注入)→ 上传路径需要 **per-call** 写目标覆盖 + 一个 session→profile 解析器。
  - **会话创建失败链路现成**:`InvalidAgentDefinitionError`(agent-loader)→ `startRunner` reject → 子进程 ready 前退出 → 主进程 `pi-session.ts:1244` 判 `exit-before-ready` → 会话创建失败。profile 白名单校验放子进程装配期即可复用整条链。
  - **声明帧先例完整**:`agent_routes` 帧产于 `wireAgentRoutesBridge`(runRpcMode 前 stdout),消费于 `pi-session.ts:690-701` `handleRawLine`(会话级缓存字段,二次校验失败仅 warn 丢帧不失败会话)。profile 帧同族照搬。

## Research Log

### 写路由覆盖点的选型(子进程静态 vs 主进程 per-call)
- **Context**:Req 3 要求同一会话的两条写入路径(前端上传/子进程工具产物)都按 profile 落库。
- **Findings**:两条路径的 store 生命周期不同——child store per-session、主进程 store 全局单例。
- **Implications**:双轨落法:子进程经 `createChildAttachmentStore(env, {writeProfile})` 静态覆盖 writePolicy;主进程经 `BlobStore.put` 新增可选 `opts.writeBackend` per-call 覆盖(仅 union 消费,local-fs/s3 实现忽略),上传 handler 经注入的 `resolveWriteBackend(sessionId)` 取 profile。

### 白名单校验的归属(子进程权威)
- **Context**:Req 2.2 未注册名字 → 会话创建失败;主进程与子进程都持有拓扑 env(Spec 1 的 passthroughEnv 已下发)。
- **Findings**:子进程装配序 `loadAgentDefinition`(最早)→ `wireAttachmentBridge` → 帧发射 → `runRpcMode`;definition 只在子进程手里。
- **Implications**:**子进程为校验权威**(装配期对照 `parseBackendsEnv(env)` 的名字集,未命中抛 `InvalidAgentDefinitionError` 复用 exit-before-ready 链);主进程消费帧时做**防御性**比对,失配仅 warn+忽略(意味着主/子 env 漂移,不二次失败)。

### 运维关断的读取位置
- **Findings**:关断 env 需要主子两侧同时生效;child 读 `process.env`(spawn 下发),主进程读自身 env。关断优先于校验——关断时非法名字也不失败(Req 5.1「忽略声明」)。
- **Implications**:`PI_WEB_AGENT_ATTACHMENT_PROFILE_DISABLED` 加入 spawn 下发清单;子进程分支「disabled → 不校验、不覆盖、不发帧」;主进程分支「disabled → 丢弃帧」双保险。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 双轨(选定):child 静态绑定 + 主进程 per-call opts | 各进程按自身 store 生命周期选最小改造 | 子进程零 per-call 开销;端口只加一个可选参数;WritePolicy 类型不动 | port `put` 第二次扩签名(Spec 1 加过回执) | 实现忽略 opts 即向后兼容 |
| WritePolicy 扩签名 `(meta, hint)` | 统一走策略函数 | 单一决策点 | 门面/端口/全部实现连锁改;主进程仍需把 hint 送进 put——改造面更大 | 否决 |
| 主进程 per-session 门面实例 | 每会话建 facade | 无 per-call 参数 | 与单例装配/路由注入形状冲突,改造面最大 | 否决 |
| profile 经 spawn env 下发给子进程(而非 definition 直读) | env 是既有通道 | 无需 definition 参与 | **时序不成立**:profile 在 definition 里,主进程 spawn 时还不知道;子进程本就先拿到 definition | 否决 |

## Design Decisions

### Decision: 子进程为白名单校验权威,复用 exit-before-ready 失败链
- **Selected Approach**:runner 在 `loadAgentDefinition` 后、`wireAttachmentBridge` 前,disabled 未生效且声明存在时对照 `parseBackendsEnv(process.env)` 校验;未命中抛 `InvalidAgentDefinitionError`。
- **Rationale**:definition 与拓扑 env 都在子进程;失败链零新机制;主进程无需在握手协议中新增失败语义。
- **Trade-offs**:主进程仅防御性核对(warn),主/子 env 漂移时以子进程判定为准——可接受,Spec 1 已保证 passthroughEnv 单点产出。

### Decision: 帧 = `agent_attachment_profile` 纯数据单帧,`slash_completions`/`agent_routes` 同族
- 发射点:独立小 wiring(`runRpcMode` 前);消费点:`pi-session.ts handleRawLine` 会话级字段;畸形帧 warn+丢弃不失败(与 agent_routes 帧一致)。

### Decision: 端口 `put` 加可选 `opts: { writeBackend?: string }`
- **Selected Approach**:`BlobStore.put(key, body, meta, opts?)`;union 消费(未注册名字 throw,与 writePolicy 同语义);local-fs/s3 实现签名兼容忽略;门面 `PutInput` 加可选 `writeBackend` 原样透传。
- **Rationale**:改造面最小;类型上「不传 = 现状」,存量调用零改动。

## Risks & Mitigations
- 主/子进程 DISABLED env 不同步(只关了一侧)→ 关断读取都收敛到「装配期一次」,并把该 env 纳入 spawn 下发清单;集成测试覆盖「仅主进程设」与「下发后」两态。
- 上传路径 resolver 与会话就绪时序:帧在 ready 前到达并缓存(agent_routes 同批),上传要求会话已存在,resolver 查不到时回落 undefined(= 宿主默认),不抛。
- port 再次扩签名波及 mock — 可选参数,预期零修改;以全仓 typecheck 验证。

## References
- Spec 1 实现:`packages/server/src/attachment/{union-blob-store,backends-config,config,attachment-store}.ts`、`runner/{agent-routes-wiring,agent-loader,runner}.ts`、`session/pi-session.ts`(消费点行号见探查记录)
- `docs/attachment-union-store-design.md` §4 — pre-spec 稿(声明面/帧/白名单初始设想;写路由覆盖机制以本 research 双轨结论为准)
- `.kiro/specs/attachment-backend-pluggable/` — 上游 spec(端口与拓扑契约的权威)
