# Brief: agent-authoritative-surface

> 权威设计:`docs/agent-authoritative-surface-design.md`(pre-spec 接口草案,含实证结论与未决清单)。

## Problem
富交互 UI surface(画廊、队列、实时面板)与 agent 之间没有统一的通信约定。每要做一个,就要重新手接三条边(`state-injection-bridge` 的 KV 桥 / Tier3 `ui-rpc` / attachment),每次都重踩同一批坑:粘性帧(重连丢态)、宿主独立性(误把领域语义焊进宿主)、命令 payload 承载(host 命令路径 vs agent 转发路径)。

## Current State
同一模式已零散实现三次却未收敛:`state-injection-bridge`(KV 下行 + 写回)、`message-queue-ui`(`control:"queue"` 粘性帧 + clearQueue)、`unified-command-result-layer`(ui-rpc 同步/异步命令)。没有一层把它们抽象成"填 config 即得"的 SDK,也没有把"何时该用快照+载入、何时不该"的判据写清楚。

## Desired Outcome
一套按 `domain` 命名的 SDK:
- agent 侧 `createSurface({domain, initialState, commands, hydrate})` —— 持有权威 state、派发结构化命令、(重)启动时重建。
- UI 侧 `useSurface(domain) → {state, run, available, rev}` —— 镜像快照、发命令、能力探针驱动退化。
- 新建一个 surface 从"手接三条边"变成"填一个 config",且**宿主零领域语义**。

## Approach
路线 A(零 protocol 结构改、零 REST route):
- **State(下行)**:复用 `control:"state"` 桥,`key="surface:<domain>"`,`value` 为快照,`rev` 收敛;粘性回放依赖 `state-injection-bridge` 的**通用粘性帧**(见上游)。
- **Command(上行)**:复用 Tier3 `ui-rpc`,`SurfaceCommandPayload{domain,action,args}`(**无顶层 `name`** → `CommandExecutePayloadSchema.safeParse` 失败 → 逃逸 host 命令拦截 → 落 `session.uiRpc` 转发进 agent 子进程),响应经 `control:"ui-rpc"` 按 `correlationId` 异步配对。
- **Capability**:`createSurface` 注册探针命令 `surface:<domain>`,`getCommands` 可见;`available===false` 时 UI 走退化。
- **Bulk**:大负载走 `att_` 引用,永不进帧。

## Scope
- **In**:agent 侧 `createSurface` + UI 侧 `useSurface`;`SurfaceCommandPayload`/`SurfaceCommandResult`(细化 ui-rpc `unknown` payload,不改 `UiRpcRequestSchema` 结构);能力探针注册 + 退化契约;`hydrate` 钩子形态(重建由领域实现填充);SDK 包边界落地(独立包 vs 拆入 tool-kit/react)。
- **Out**:任何具体 domain 的落地(Canvas 归 `aigc-canvas`);粘性帧机制本身(归 `state-injection-bridge`);REST 端点;`pi.appendEntry` 持久。

## Boundary Candidates
- agent 侧门面(state 持有 + 命令派发 + hydrate)
- UI 侧 hook(镜像 + run + 能力探针)
- 命令 schema(payload/result 细化)
- 能力协商与退化契约

## Out of Boundary
- 领域语义(gallery/queue/provider)——只活在领域实现与其渲染器
- 宿主服务端端点

## Upstream / Downstream
- **Upstream**:`state-injection-bridge`(含本波次的通用粘性帧修复)、`unified-command-result-layer`(ui-rpc 命令)、`attachment-store`(Bulk)、`web-ui-custom-rendering`(SlotContribution 挂载)。
- **Downstream**:`aigc-canvas` 及未来所有富交互 surface。

## Existing Spec Touchpoints
- **Extends/依赖**:`state-injection-bridge`(通用粘性帧)。
- **Adjacent**:`message-queue-ui`、`unified-command-result-layer`、`session-snapshot-authority`(StickyFrameRegistry)、`web-ui-custom-rendering`。

## Constraints
- **零 REST route**;还原全靠 SSE(粘性帧回放 + 子进程 hydrate)。
- **宿主中立**:判据 = grep `app/` + `pi-web-server` 找不到任何 domain 语义字符串。
- ⚠️ `fs.writeSync(1)` 直写 fd1(pi `runRpcMode` 的 `takeOverStdout` 会把 `process.stdout.write` 转 stderr);只有真实子进程集成测试能抓到。
- TypeScript strict、无 `any`;项目硬规则:单元/集成测试 + e2e,以新鲜运行证据证明。
