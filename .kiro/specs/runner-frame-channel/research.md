# Research Log — runner-frame-channel

## 发现范围与类型

**类型:Extension / 纯管道重构(brownfield)。** 已通读全部基线源:`runner.ts`(448 行装配序 + 收尾)、四个入站桥、`attachment-wiring`、`session-title-wiring`、`slash-completions-wiring`、`project-trust`,以及 `rpc-channel/jsonl-reader.ts`。无外部依赖调研需求(不引新库)。

## 关键发现

### F1 — 四个入站桥是同一机制的逐字拷贝

`state-wiring` / `surface-wiring` / `clear-queue-wiring` / `agent-routes-wiring` 各自独立实现了完全相同的五段骨架:

1. 重声明 `DataListener` / `ListenerOp` / `ReadableLike` / `WritableLike`(4 份雷同,各 ~15 行)。
2. `writeLine = input.stdout ? 注入 : (s) => writeSync(1, s)` 三元(4 份)。
3. `stdin.setEncoding("utf8")` + `new JsonlLineReader()` + `stdin.on("data")` + install `try/catch` + `installed` 标志(4 份)。
4. 每帧 `JSON.parse` → `typeof !== object` 守卫 → `Schema.safeParse` → 不匹配 `continue`(4 份)。
5. `cleanedUp` 幂等 + `stdin.off ?? removeListener`(4 份)。

四个桥各挂**独立**的 `stdin.on("data")` + **独立** `JsonlLineReader` → 同一行 stdin 被解析 4 遍。

### F2 — 上行 fd1 直写是硬约束,云上被放大

所有桥的运行期上行都用 `fs.writeSync(1, line)` 直写 fd1,注释一致强调「不能用 `process.stdout.write`:pi 的 `runRpcMode` `takeOverStdout()` 会把它重定向到 stderr」。

云链路核实(读 pi-clouds `demo/cloud-e2e/cloud-bridge-acs.mjs` 与 `packages/sandbox/src/agent-runner/agent-runner.ts:155-158`):

- `agent-runner` 用 `createInterface(child.stdout).on("line", …)` **全量转发**子进程每一行为 `{type:"line", seq, line}`,**无 type 白名单**;子进程 stderr 转 `{type:"log"}`(汇入控制面日志,脱离 RPC 流)。
- `cloud-bridge-acs` 是**行无关字节泵**:下行 `readline` 泵、上行 `{type:"line"}` → `process.stdout.write`,均不解读 `frame.type`。

**结论:** 传输对自定义帧透明,但 `process.stdout.write` 在云上会经 stderr → `{type:"log"}` **掉进日志黑洞、彻底丢失**。故「上行只走 fd1」在云上从建议升级为生死线。→ 驱动 Requirement 2 的不变式与「handler 无从触碰 process.stdout」的 API 设计。

### F3 — 装配期声明帧走的是另一条路(且必须)

`slash-completions-wiring` 与 `agent-routes-wiring`(声明部分)用 `process.stdout.write` 而非 fd1 —— 因为它们在 `runRpcMode` 的 `takeOverStdout` **之前**发,此刻 `process.stdout` 仍指向原始 fd1。这与 F2 不矛盾:两类帧走两个时间窗口。→ 驱动 `emitAssemblyFrame` 与 Requirement 3 的时序约束。

### F4 — 机制 C 是真正不同的接线,不能并入

`attachment-wiring`(组合 `agent.beforeToolCall`/`afterToolCall`)与 `session-title-wiring`(prototype-patch `session.bindExtensions`)是**进程内 hook 拦截**,不跨 stdin/stdout。强行塞进帧通道是错误抽象。→ Requirement 5 明确排除。

### F5 — 复用件

- `JsonlLineReader`(`packages/server/src/rpc-channel/jsonl-reader.ts`):`push(chunk: string): string[]`、`flush(): string[]`。帧通道复用它,不另造解析器(Requirement 7.4)。
- seam key 三处散落(`__piWebSessionState__` / `__piWebSurfaces__` / `__piWebAttachmentToolContext__`),各带「须与 tool-kit 一致」注释 → 集中到单一常量源(Requirement 7.2)。

## 设计综合(build-vs-adopt / 泛化 / 简化)

- **泛化:** F1 的五段骨架泛化为 `createInboundFrameRouter`(唯一 stdin+唯一 reader+注册表)+ `makeLineWriter`。四桥各降为「一次 `router.register(type, schema, handler)` + 业务 handler」。
- **Adopt 而非 build:** 复用 `JsonlLineReader`;复用各桥既有 zod schema(`@blksails/pi-web-protocol`),帧格式**冻结**。
- **简化:** `runner.ts` 收尾 5 段雷同 try/catch → `disposeAll(wirings)`。
- **API 防误用(F2 驱动):** handler 上下文 `ctx` 只暴露 `respond`/`send`(内部经统一 writer 直写 fd1),**不暴露** raw stdout;handler 签名里根本拿不到 `process.stdout` 出口 → 结构上杜绝云上丢帧。

## 风险

- **R1(中):** surface 桥的「二段匹配」(先 `ui_rpc` 再 `SurfaceCommandPayload`,非 surface 的 `ui_rpc` 行需放行给 webext)。若归一化为「一个 type 一个 handler」,需保留「handler 内部再判定、不匹配则不回包且不吞该行」的语义。设计上以 `ui_rpc` 为注册 type,handler 内做 payload 二次 `safeParse`,非 surface 命令返回「未消费」信号,由 router 放行。见 Component 设计。
- **R2(低):** 单一 stdin reader 需保证「非匹配行放行」对所有非注册 type 生效(pi RPC 行不能被吞)。router 默认对未注册 type 与 schema 失败一律放行(不消费)。
- **R3(低):** 迁移必须逐字保持帧字段/错误码 → 以既有各桥测试 + 新增 router 单测双重门控;zero behavior change。
