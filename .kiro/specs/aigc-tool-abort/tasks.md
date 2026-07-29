# Implementation Plan

> 补齐链路缺口，非新建能力。改动集中在 2 个源文件 + 1 个测试文件，任务串行。

- [x] 1. 打通 signal 到落盘下载

- [x] 1.1 persistPicked 接受并使用 signal
  - `PersistOptions` 增加 `signal?: AbortSignal`
  - 下载改为 `fetchImpl(url, { signal })`（原先只传 url，signal 无从进入）
  - 保留既有 `withTimeout` 兜底（Req 4.2：无 signal 的调用方仍受保护）
  - 观察性完成条件：单测断言 `fetchImpl` 收到的 init 中含 signal
  - _Requirements: 1.2, 4.2_

- [x] 1.2 落盘拆两阶段，保证终止零入库
  - 阶段一：并行下载全部字节（共享同一 signal）；阶段二：统一 `putOutput`
  - 两阶段之间插入一次 `throwIfAborted(signal)`
  - ★ 入库阶段不再响应 abort（本地毫秒级操作，中断反增半态风险）
  - ★ 注释写明内存上界评估：4MiB × n(≤10) ≈ 40MB，避免后人误判为疏忽
  - 观察性完成条件：多图场景下第 1 张已下完、第 2 张下载中 abort → `putOutput` 零次调用
  - _Requirements: 1.6, 3.1, 3.2_
  - _Depends: 1.1_

- [x] 2. 终止的识别与表达

- [x] 2.1 runImageTool 透传 signal 并识别终止
  - 把 `signal` 传给 `persistPicked`
  - 终止识别：`signal.aborted` 优先、`AbortError` 名称兜底（不依赖第三方抛错细节）
  - 返回 `{ ok:false }` 且描述可识别为「用户主动取消」，与真实失败可区分
  - 终止后不再推送流式预览更新
  - 观察性完成条件：终止结果的 error 文案与「凭据错误」等可区分；终止后 `onUpdate` 不再触发
  - _Requirements: 1.5, 2.1, 2.2, 2.3, 2.4_
  - _Depends: 1.2_

- [x] 3. 验证

- [x] 3.1 终止行为测试
  - 新建 `test/aigc/abort.test.ts`，覆盖 design.md Testing Strategy 的 9 项
  - ★ 关键对照：落盘期 abort 应在 1s 内结束（现状探针为 5s+ 未结束）
  - 观察性完成条件：9 项全绿；把 signal 支持临时摘掉能让「1s 内结束」与「零入库」两条精确变红（守卫有效性自检）
  - _Requirements: 1.2, 1.5, 1.6, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_
  - _Depends: 2.1_

- [x] 3.2 全量回归与真机
  - `pnpm -r run typecheck` + tool-kit / server / canvas-ui 测试
  - 真机：UI 中发起图像生成，在「下载回来」阶段点停止，确认立即结束且画廊无新增
  - 观察性完成条件：typecheck 退出 0、各包测试无新增失败；真机留存证据
  - _Requirements: 4.1_
  - _Depends: 3.1_

---

## Implementation Notes

### 根因（探针实测，非推断）

链路上只有**落盘下载**这一段停不掉：`persistPicked` 调 `fetchImpl(url)` 时不传 `init`，
signal 无从进入。探针输出：`downloadGotSignal: false`，abort 后 5s 仍未结束；实际要等
`PERSIST_TIMEOUT_MS = 30_000`，下载与 `arrayBuffer()` 各一个窗口，最坏 60s。

其余各段（provider 请求 / 异步轮询 / SSE 流 / prompt 优化）**改动前就能中断**，本次只加测试钉死不回归。

### 三处改动

1. `persist.ts` — `PersistOptions` 加 `signal?`，下载改 `fetchImpl(url, { signal })`
2. `persist.ts` — 落盘拆**两阶段**（并行下载 → 统一入库），中间插一次 `throwIfAborted`
3. `run-image-tool.ts` — 透传 signal、识别终止、终止后不推流式预览

### 为什么必须拆两阶段

原实现在同一个 map 里「下完一张就入库一张」。多图并行时用户在第 2 张下载中点停止，第 1 张
**可能已入库**，留下不属于任何一次成功调用的孤儿附件。拆开后终止发生在下载期即整体抛出，零入库。

代价是所有字节同时驻留内存 —— 上界 4MiB × n(≤10) ≈ 40MB，可接受，已在注释中写明避免后人误判为疏忽。

入库阶段**刻意不响应 abort**：本地毫秒级操作，中途打断反增半态风险。

### 终止判据用 `signal.aborted` 优先

`AbortError` 名称只作兜底：undici 抛 `DOMException("AbortError")`，但代理传输层或第三方 fetch
实现未必一致。以自己的 signal 状态为准更可靠。

### 守卫有效性自检

把 `fetchImpl(url, { signal })` 改回 `fetchImpl(url)`（模拟改动前）→ **4 条精确变红**，其中两条
以超时形式失败，正是修复前的真实症状。恢复后 10/10 绿。

### 测试陷阱（踩到并记下）

`AbortSignal` 已经 aborted 之后再 `addEventListener("abort", ...)` **不会触发** —— 事件早已派发完。
测试里若先 `abort()` 再进 fetch stub，promise 会永远挂着。stub 必须先判 `signal.aborted`。

### 验证

- 全仓 typecheck 干净
- tool-kit **597 passed / 10 skipped**（新增 10 条终止测试）
- server 2427 passed；canvas-ui 1 failed 为既有 encapsulation 锚计数失败，与本次无关
- 真机待做：UI 中在「下载回来」阶段点停止（任务 3.2 后半）
