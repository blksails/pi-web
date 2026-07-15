# Research & Design Decisions — e2b-sandbox-transport

## Summary
- **Feature**: `e2b-sandbox-transport`
- **Discovery Scope**: Extension(在既有会话执行桥上新增一个非 local 传输后端)
- **Key Findings**:
  - 通道注入点 `createPiWebHandler(opts.createChannel)` 已存在,e2b 接入**只发生在装配层 `lib/app/pi-handler.ts` 的 `createChannel` 闭包 + `rpc-channel` 层**,组合根/前端/协议零改动。
  - `SessionChannel`(`session.types.ts:47`)是 `PiRpcChannel` 的结构超集(4 传输方法 + `onEvent`/`onExtensionUIRequest`/`onExit`/`onStderr`/`respondExtensionUI` + 可选 `onRestart`/`newSession`/`requestRestart` + 16 命令方法)。抽出的会话核心 `PiRpcSession` 必须结构满足它,装配层以 `satisfies SessionChannel` 校验(与既有 `PiRpcProcess` 同风格,不 `implements` 以避免 rpc-channel ↔ session 循环依赖)。
  - e2b JS SDK v1.x 的后台命令 API 已核实,草稿 `E2bTransport` 的 e2b 交互方法名与真实签名一致;唯一确凿代码缺陷是 `close()` 中 `ChildCrashError` 构造实参与其签名 `(code, signal, message?)` 不符(strict 编译不过)。

## Research Log

### e2b JS SDK v1.x 后台命令 / stdin / kill API
- **Context**: Req 2 要求把「发送/接收/关闭/健康」映射到沙盒内长驻 runner 进程;草稿注释标注「SDK 方法名以本地验证为准」,须在设计前核实真实契约。
- **Sources Consulted**:
  - E2B JS SDK Reference — Sandbox(v1.2.0)
  - E2B JS SDK Reference — Commands(v1.4.0)
  - E2B Docs — Run commands in background
- **Findings**:
  - `Sandbox.create(template, opts?)` → `Promise<Sandbox>`;`opts` 含 `apiKey`/`timeoutMs`/`envs`/`metadata`。
  - `sandbox.commands.run(cmd, opts?)` 重载:`background: true` 时返回 `Promise<CommandHandle>`(立即返回,不等结束);`opts` 含 `background`/`cwd`/`envs`/`onStdout(data:string)`/`onStderr(data:string)`/`user`/`timeoutMs`。
  - `CommandHandle` 暴露 `pid: number`(用于 stdin/kill 定位),另有 `wait()`。
  - `sandbox.commands.sendStdin(pid, data, opts?)` → `Promise<void>`。
  - `sandbox.commands.kill(pid, opts?)` → `Promise<boolean>`。
  - `sandbox.kill(opts?)` → `Promise<void>`(销毁整个沙盒)。
- **Implications**: 草稿 `E2bTransport` 的 `RunningCommand { pid }`、`commands.run({ background:true, onStdout, onStderr })`、`sendStdin(pid, line)`、`commands.kill(pid)`、`sandbox.kill()` 全部对齐真实 API,无需推翻。`onStdout` 回调是**数据块**(非行),须经 `JsonlLineReader` 分帧——草稿已如此。`e2b` 需加为 `@blksails/pi-web-server` 生产依赖(当前未安装)。

### 既有本地传输 `PiRpcProcess` 的分帧/分发/命令封装
- **Context**: Req 1 要抽出「传输无关会话核心」,须与 `PiRpcProcess.#dispatchLine` 行为等价以保证回归不破。
- **Sources Consulted**: `pi-rpc-process.ts`、`pi-rpc-channel.ts`、`jsonl-reader.ts`、`session.types.ts`、既有 `test/rpc-channel/*`。
- **Findings**:
  - 分帧走 `JsonlLineReader`(按 `\n` 切、剥 `\r`、不使用 Node `readline` 以免误切 `U+2028/2029`)。
  - 三类消息分发:`response`(带 `id`)兑现待决 Promise、`event` 广播 `onEvent`、其余登记为 `extension_ui_request` 通知 `onExtensionUIRequest`。
  - 命令封装:`randomUUID()` 生成 id → `send(JSON.stringify({id,type,...}))` → 登记 pending → 收到匹配 `response` 兑现。
  - 退出/关闭统一 `ChannelClosedError` 拒绝全部待决命令。
- **Implications**: 草稿 `PiRpcSession` 已忠实复刻该逻辑。一期 local 仍走既有 `PiRpcProcess`(不改),`PiRpcSession` 仅承载 e2b;既有 `test/rpc-channel/*` 保持全绿即为 Req 1.4 回归证据。二期可把 local 收敛为 `PiRpcSession(new LocalTransport)` 消除重复(本 spec 不做)。

### 装配层传输切换点
- **Context**: Req 3 要按 `PI_WEB_TRANSPORT` 在 local/e2b 间切换,且缺配置时清晰失败不静默回退。
- **Sources Consulted**: `lib/app/pi-handler.ts`(`buildSingleton`/`createChannel`)、`create-handler.ts`(`defaultCreateChannel`)、`handler.types.ts`(`CreateChannelOpts`)。
- **Findings**:
  - `createChannel(resolved, opts)` 闭包在 `buildSingleton()` 内构造;现有分支:`config.stubAgent` → stub 进程;real → `new PiRpcProcess(spec)`。两者都返回 `SessionChannel`。
  - env 读取集中在 `lib/app`(config.ts / 直接 `process.env`),server 包提供 `*ConfigFromEnv` 纯函数(如 `attachmentStoreConfigFromEnv`)。
- **Implications**: 新增 `e2bTransportConfigFromEnv(env)`(server 包纯函数,缺 `E2B_API_KEY`/template 时抛清晰错误);装配层在 `PI_WEB_TRANSPORT==="e2b"` 时用它 + `new PiRpcSession(new E2bTransport(spec, cfg))`。缺配置的清晰失败按 Req 3.3 定位在**会话创建路径**(createChannel 被调用时抛),app 仍能启动。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Ports & Adapters(选定) | 抽 `RpcTransport` 端口 + `PiRpcSession` 核心,e2b/local 各为 adapter | 边界清晰、核心可 mock 单测、二期可增量 | 需新增一层间接 | 与既有 `PiRpcChannel` 端口设计一脉相承 |
| 在 `PiRpcProcess` 里加 e2b 分支 | 直接在本地进程类内 if/else 起沙盒 | 少一个类 | 传输与会话逻辑耦合、无法复用 20 命令、违背 Req 1 | 否决 |
| 一期即把 local 也迁到 `PiRpcSession` | 彻底消重 | 无重复 | 触碰全部既有 local 测试面,回归风险高、超出 PoC | 二期做,Req 1.4 只要求"复用同一核心时"回归绿 |

## Design Decisions

### Decision: 会话核心与传输解耦为 `PiRpcSession(RpcTransport)`
- **Context**: Req 1 —— 避免在 e2b 通道里复制 ~20 命令方法与三类分发。
- **Alternatives Considered**: 1) e2b 通道自带完整命令封装(复制);2) 抽公共基类继承。
- **Selected Approach**: 组合优先——`PiRpcSession` 消费 `RpcTransport` 端口,对上产出完整 `SessionChannel`;`E2bTransport` 只实现 7 个传输方法。
- **Rationale**: 组合优于继承;端口最小面(`send`/`onLine`/`onStderr`/`onExit`/`onSpawn`/`close`/`health`)即可让核心无感传输差异。
- **Trade-offs**: 多一层;但换来核心可用 mock 传输完整单测(Req 7.1)。
- **Follow-up**: 一期 local 不迁移(降回归风险),二期收敛。

### Decision: 就绪前发送进 outbox 缓冲(异步 boot)
- **Context**: `Sandbox.create` 异步,而本地 `spawn` 同步返回;`PiRpcSession` 构造后可能立刻 `send`。
- **Selected Approach**: `E2bTransport` 构造即触发 `#boot()`;`send()` 在 `#command` 就绪前入 `#outbox`,就绪后 flush;`onSpawn` 在就绪时触发一次(供就绪握手重跑探针)。
- **Rationale**: 让上层对「冷启延迟」无感,复用既有就绪握手(Req 5.4)。
- **Trade-offs**: boot 失败须把错误经 `onExit` 传播以让核心拒绝全部待决命令(Req 2.6)。

### Decision: 缺 e2b 配置在「会话创建路径」清晰失败,不静默回退 local
- **Context**: Req 3.3 —— 避免「以为在沙盒里其实在本地」。
- **Selected Approach**: `e2bTransportConfigFromEnv` 缺 `E2B_API_KEY`/template 时抛 `Error`;装配层在 e2b 模式下延迟到 `createChannel` 调用时读取,使会话创建以清晰错误失败(app 启动不受影响)。
- **Trade-offs**: 相较 fail-fast at boot 略晚暴露,但符合 Req 3.3 的"会话创建路径"措辞且不阻塞其它非 e2b 功能。

## Risks & Mitigations
- **真实 e2b template 未就绪** — 集成测试(Req 7.2)在缺 `E2B_API_KEY` 时 `skip` 并明确报告;单测用 mock e2b SDK 覆盖全部逻辑分支,不依赖真实沙盒。
- **`onStdout` 数据块跨行边界** — 复用 `JsonlLineReader`(有状态缓冲),不自行按块 `JSON.parse`。
- **草稿 `close()` 的 `ChildCrashError` 误用** — 实现任务修正为 `(code, signal, message)` 正确签名或改用 `SpawnError`/普通 `Error`;strict 编译 + 单测把关。
- **沙盒泄漏(持续计费)** — `close()` 先 `commands.kill(pid)` 再 `sandbox.kill()`;会话删除/空闲回收链路调用 `channel.close()`(既有 `PiSession` 生命周期已保证),集成测试断言 `health().alive===false`。

## References
- [E2B JS SDK — Sandbox](https://e2b.dev/docs/sdk-reference/js-sdk/v1.2.0/sandbox) — `Sandbox.create`/`kill` 签名
- [E2B JS SDK — Commands](https://e2b.dev/docs/sdk-reference/js-sdk/v1.4.0/commands) — `run`/`sendStdin`/`kill`、`CommandHandle`
- [E2B Docs — Run commands in background](https://e2b.dev/docs/commands/background) — `background:true` 语义
