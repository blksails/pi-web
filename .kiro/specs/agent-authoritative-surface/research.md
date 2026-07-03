# Research Log — agent-authoritative-surface

> 语言:zh。发现类型:**扩展(Extension)** —— 在既有 `state-injection-bridge` / `unified-command-result-layer` / `attachment` 三条已跑通的接缝之上,提炼领域无关的 SDK 门面。以 light discovery(集成为主)+ 逐行核对真实代码接缝执行。

## 1. 发现范围

- 复用哪些现成接缝(路线 A,零 protocol 结构改、零 REST route)。
- 命令上行如何"无 `name` 逃逸 host 拦截"落到 agent 转发路径 —— 核对真实分流代码。
- 转发进子进程的 ui-rpc 命令**由谁接收并派发** —— 这是全案最关键的未被现有代码覆盖的缺口。
- 状态下行如何以 `key = "surface:<domain>"` 复用 KV 桥;粘性归属。
- fd1 直写坑的适用范围。

## 2. 关键发现(逐行核对,均为代码级证据)

### 发现 1 · 命令分流:无 `name` 的 payload 自然逃逸 host 拦截(已确认)
`packages/server/src/http/routes/command-routes.ts:294-314` `makeUiRpcHandler`:仅当 `point==="command"` && `action==="execute"` && `CommandExecutePayloadSchema.safeParse(payload).success` && `hostCommands.has(name)` 时才走 host 同步执行路径(HTTP 响应体直接返回)。`CommandExecutePayloadSchema`(`web-ext/command.ts:12`)要求顶层 `name: string.min(1)`。`SurfaceCommandPayload{domain, action, args}` **无 `name`** ⇒ `safeParse` 失败 ⇒ 不进 host 分支 ⇒ 落 `session.uiRpc(req)`(command-routes.ts:317)转发子进程。**结论:路线 A 命令转发无需改宿主。**

### 发现 2 · 转发进子进程的 ui-rpc 命令没有真实接收方(全案最大缺口,已确认)
`PiSession.uiRpc`(`pi-session.ts:723-727`)把请求作为 `{"type":"ui_rpc","request":{...}}` 行写入子进程 stdin。**但除 stub(`lib/app/stub-agent-process.mjs:623`)外,没有任何真实子进程读取器消费该行并回 `ui_rpc_response`**:pi 的 `runRpcMode` 只处理 pi 封闭的 `RpcCommand` 联合(不含 ui_rpc,视为 Unknown-command)。`state-injection-bridge` 设计(design.md:24)显式把"通用 ui_rpc 真实 handler"列为 **Out of Boundary**。
- **含义**:AAS **必须自建** runner 子进程侧的 `ui_rpc` 命令读取器 + 派发器(与 `wireStateBridge` 的第二个 stdin 读取器同构),否则 UI 发的 surface 命令永远无人应答。这是本 spec 的核心新增接缝,不是复用。

### 发现 3 · fd1 直写坑普适于所有 agent→server 自建行(已确认)
`packages/server/src/runner/state-wiring.ts:113-126`:pi `runRpcMode` 的 `takeOverStdout()` 把 `process.stdout.write` 劫持转 stderr,RPC 帧经 pi 内部保存的原始 fd1 写出。故任何 agent→server 自建行(含 AAS 的 `ui_rpc_response` 回流)**必须 `fs.writeSync(1, line)` 直写 fd1**,`process.stdout.write` 会被吞。**只有真实子进程集成测试能抓到,stub 抓不到(stub 无 takeOverStdout)。**

### 发现 4 · 状态下行/写入原语可直接复用(已确认)
- 下行帧:`StateControlPayloadSchema`(`web-ext/state.ts:15`,`value: z.unknown()`,`rev` 单调)。
- agent 写入原语:`getSessionState()`(`tool-kit/src/session-state.ts:61`)读 `__piWebSessionState__` seam;`wireStateBridge`(`state-wiring.ts:83`)已建 `SessionStateStore`(rev 单调分配)+ 订阅→fd1 下行 + 写回 reader。AAS 的 `setState` 直接 `getSessionState().set("surface:<domain>", snapshot)`,rev 与 fd1 直写全由既有桥承担。
- 前端镜像:`ControlStore.states` 切片 + `useExtensionState(key)`(`react/src/hooks/use-extension-state.ts:61` 读 `snapshot.states[key].value`,rev 守卫已在 `applyControlFrame`)。`useSurface` 在其上封装。

### 发现 5 · 粘性帧缺口不属本 spec(已确认,依赖上游)
`pi-session.ts:580-593` 的 `piweb_state` 分支只 `emitter.emit` 广播、**无 `sticky.set`**(对比 queue 的 `pi-session.ts:532-533` 手动登记)。⇒ 裸 `control:"state"` 非粘性、重连丢 KV、刷新后 surface 空白。**修复在宿主 `PiSession`(`StickyFrameRegistry` 在宿主,前端/agent SDK 都做不了),领域无关,惠及所有 state key** —— 已在 roadmap 归上游 `state-injection-bridge` 扩展。本 spec **消费**该修复,不实现它;设计以"上游已就位"为前置。

### 发现 6 · 能力探针机制(已确认)
`pi.registerCommand`(真实 pi ExtensionAPI 方法,repo 内 `extension-manager.ts:151,160`、`trust-pi-loading.e2e.test.ts:31` 均在用)注册的命令 `source:"extension"`,经 `getCommands`(`RpcSlashCommandSchema`,`rpc/session-state.ts:46`)可见。AAS 探针命令 `surface:<domain>` 据此注册;前端只需检 `getCommands()` 结果是否含该名 ⇒ `available`(无需 `webVisible`,不进补全)。

### 发现 7 · 命令派发的附件上下文(已确认)
`getAttachmentToolContext()`(`tool-kit/attachment/seam.js`)在子进程内给出 `AttachmentToolContext`(agent-kit 类型);`runImageTool`(`aigc/run-image-tool.ts:244`)即据此编排。`SurfaceCtx.attachments = getAttachmentToolContext()`,Bulk 走 `att_`。

### 发现 8 · 挂载复用 SlotContribution(已确认)
`packages/web-kit/src/define-web-extension.ts:83` `slots?: Partial<Record<SlotKey, SlotContribution>>`;AAS 不新造 renderer,surface 渲染器经具名槽挂载,槽名对宿主不透明。

## 3. 架构模式评估与决策

| 决策 | 选择 | 理由 |
|---|---|---|
| State 通道 | 路线 A:复用 `control:"state"`(`key=surface:<domain>`) | 零 protocol 改;`value:unknown` 已领域无关;粘性由上游修复 |
| Command 通道 | 复用 Tier3 ui-rpc,payload 细化 `SurfaceCommandPayload`(无 `name`) | 自然逃逸 host 拦截(发现 1)→ agent 转发,拿得到 provider/编排器 |
| ui-rpc 命令接收 | **自建** runner 子进程读取器 + 派发器(发现 2) | 现有代码无真实接收方;state-injection-bridge 显式留缺口 |
| 回流 | `fs.writeSync(1)` 直写 fd1(发现 3) | takeOverStdout 吞 `process.stdout.write` |
| Capability | `pi.registerCommand("surface:<domain>")` + `getCommands` 探针 | 复用真实 pi API(发现 6) |
| Bulk | `att_` 引用 + 签名 URL | 二进制永不进帧(发现 7) |
| 包边界(OQ-1) | **折入既有包**(tool-kit runtime + server runner + react + protocol),不新建 `@blksails/pi-web-surface-kit` | 与 `state-injection-bridge` 先例一致(getSessionState 在 tool-kit / useExtensionState 在 react);避免新包开销;domain 数量增长再评估独立包 |
| 探针注册(OQ-2) | **自动**(createSurface 内经 pi 注册) | 让 Capability 默认可用,退化契约有据可依 |
| 命令承载(OQ-3) | 已确认:无 `name` 逃逸 + agent 转发;**并**在 runner 读取器内以 `SurfaceCommandPayloadSchema` **显式**匹配(不只依赖"无 name 逃逸"隐晦机制) | 隐晦逃逸只保证不被 host 拦截;子进程侧的显式 domain 路由使派发可读可测 |
| 血缘/hydrate(OQ-4) | 本 spec 只定义 `hydrate` 钩子**形态**;具体重建实现归领域(Canvas) | AAS 领域无关 |
| rev/乐观(OQ-6) | 暴露 `rev`;乐观更新策略留给领域渲染器 | SDK 不强加 UI 策略 |

## 4. 风险

- **R-1 · runner ui-rpc 读取器与 pi stdin 竞争**:第二个 stdin 读取器需与 `wireStateBridge` 的读取器、pi 的 reader 共存;非 surface 命令行必须放行(交 pi / webext)。缓解:只在 `SurfaceCommandPayloadSchema` 匹配时消费,否则不干预(对齐 state-wiring 的 `continue`)。
- **R-2 · fd1 交织半行**:回流行必须单次 `writeSync(1, line+"\n")` 原子写(对齐 state-wiring)。
- **R-3 · 粘性依赖上游**:若上游 `state-injection-bridge` 粘性修复未合并,刷新后 surface 空白。缓解:设计标注前置依赖;e2e 在粘性已就位环境验证刷新回放,或以集成测试单独验证子进程 hydrate 推粘性快照路径。
- **R-4 · 命令与快照的时序窗口**:命令 `data`(新 att_id)先于快照帧到达。缓解:SDK 明确"命令返回发生了什么、快照才是现在是什么";乐观更新留领域层按 `rev` 对齐。
