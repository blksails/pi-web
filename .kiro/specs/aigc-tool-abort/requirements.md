# Requirements Document

## Introduction

让用户在图像生成/编辑进行中能**随时终止**，并且终止是**即时可感**的。

本特性**不是从零构建取消能力** —— pi-web 已有大部分链路：前端有停止按钮（`controls.abort()`，`isBusy` 时显示）、`runImageTool` 接收 `AbortSignal`、执行引擎已把 signal 透传进 provider 请求的 `fetch`、异步轮询有 `abortableSleep`、SSE 读取也接 signal。本特性要补的是**链路上停不掉的那几段**，以及终止后的用户可见反馈与产物一致性。

## Project Description (Input)

### 谁有问题

使用 pi-web AIGC 图像工具的用户 —— 一次出图常耗时 20~60s（实测 gpt-image-2 文生图 27s、编辑 57s、Gemini relay 约 170s）。用户发现 prompt 写错、选错模型，或只是不想等了，希望立刻停下。

### 现状

点停止后**并非总能停下来**。经真机探针实测（2026-07-29）确认了分段差异：

| 阶段 | 现状 | 证据 |
|------|------|------|
| provider 请求（发出→响应） | ✅ 可中断 | 探针：请求进行中 abort → `runEndpoint` 立即抛出；signal 确实透传进 `fetch` 的 init |
| 异步轮询等待（DashScope） | ✅ 可中断 | `abortableSleep` + 每轮 `signal?.aborted` 检查 |
| SSE 流式读取（OpenRouter） | ✅ 可中断 | `readOpenAiSse(r, onData, signal)` |
| prompt 优化（可选前置 LLM 调用） | ✅ 可中断 | `optimizePrompt(prompt, { signal })` |
| **产出图落盘下载** | ❌ **停不掉** | 探针：`downloadGotSignal: false`，abort 后 5s 仍未结束 |

**落盘段是核心缺口**：`persistPicked` 调 `fetchImpl(url)` 时**不传 `init`**，signal 进不去。用户点停止后只能干等 `PERSIST_TIMEOUT_MS = 30_000` 超时；下载与 `arrayBuffer()` 各有一个 30s 窗口，最坏需等 **60 秒**。而这一段恰恰是「图已生成、正在取回」的阶段，多图时还要逐张下载，是用户最容易想按停止的时刻之一。

### 要变成什么

- 图像生成/编辑的**每一段**都响应终止，包括落盘下载；
- 终止后用户立刻看到明确反馈，而不是继续转圈或看似成功；
- 终止不留半态产物（不入库半张图、不写错血缘）。

---

## 已验证事实（探针，2026-07-29）

- **可中断段**：`runEndpoint` 在 abort 时立即 reject；`signal` 确认出现在 `fetch` 的 `init` 中。
- **不可中断段**：`runImageTool` 在落盘下载阶段 abort 后，5 秒内未结束；下载用的 `fetchImpl(url)` 调用处**没有 init 参数**，故 signal 无从传入。
- **超时兜底**：`PERSIST_TIMEOUT_MS = 30_000`，`withTimeout` 分别包住 `fetchImpl(url)` 与 `resp.arrayBuffer()`。
- **前端入口已存在**：`pi-chat.tsx` 的 `onStop` → `controls.abort()`；`pi-chat-basic.tsx` 有 `data-pi-abort` 按钮。
- **abort 在同类工具上已生效**：会话记录中 bash 工具有 `toolResult: "Command aborted", isError: true` 与 `stopReason: "aborted"`，说明 abort 信号确实能到达工具执行层。

## Boundary Context

- **In scope**：图像生成/编辑工具（`image_generation` / `image_edit`）在其执行全程（含落盘下载）对终止的响应；终止后的用户可见反馈；终止时的产物与血缘一致性；canvas A 档命令旁路（`executeImageEdit`）的同等行为。
- **Out of scope**：
  - 前端停止按钮的**新增**（已存在，本特性只保证它对图像工具有效）
  - pi SDK 的 abort 传播机制本身
  - 非图像工具（bash / vision 等）的终止行为
  - 已上传到 provider 的请求在**服务端**的计费取消（第三方不提供该能力，终止只保证本地不再等待）
- **Adjacent expectations**：依赖 pi SDK 在用户点停止时把 `AbortSignal` 传给工具的 `execute`；依赖既有 attachment 链路在未完成时不落半态。

## 范围假设（未逐条确认，按最合理默认推进；如需调整请指出）

1. 终止后**不保留**部分产物——已 abort 的这次调用不入库任何图片。
2. 流式渐进预览（`onUpdate` 早弹的模糊图）在终止后停止更新，已显示的预览不视为最终产物。
3. 终止是**尽力即时**：目标是用户点击后 1 秒内结束等待，而非等超时兜底。
4. 终止后的结果按既有 fail-soft 约定返回 `{ ok: false }`，并带可识别为「用户主动取消」的描述，以便与真实失败区分。

---

## Requirements

### Requirement 1: 全程可终止

**Objective:** As an 图像工具使用者, I want 在生成过程的任意阶段都能终止, so that 我不必为一次不想要的生成继续等待

#### Acceptance Criteria

1. When 用户在 provider 请求进行中触发终止, the 图像工具 shall 立即结束本次调用，不再等待响应。
2. When 用户在**产出图落盘下载**进行中触发终止, the 图像工具 shall 立即结束本次调用，而非等待下载超时。
3. When 用户在异步轮询等待中触发终止, the 图像工具 shall 立即结束本次调用，不再发起后续轮询。
4. When 用户在 prompt 优化阶段触发终止, the 图像工具 shall 立即结束本次调用。
5. The 图像工具 shall 在终止后 1 秒内结束等待，不依赖任何超时兜底。
6. Where 一次调用产出多张图, the 图像工具 shall 在终止后停止处理尚未完成的图片。

### Requirement 2: 终止后的用户反馈

**Objective:** As an 图像工具使用者, I want 终止后立刻看到明确结果, so that 我知道它确实停了，而不是还在后台跑

#### Acceptance Criteria

1. When 终止发生, the 图像工具 shall 呈现一个可识别为「用户主动取消」的结果，而非静默结束。
2. The 图像工具 shall 使终止结果与真实失败（如凭据错误、模型不存在）在描述上可区分。
3. When 终止发生, the 图像工具 shall 停止推送流式渐进预览的后续更新。
4. If 终止发生在已产出可显示图片之后但落盘之前, the 图像工具 shall 不把该次调用报告为成功。

### Requirement 3: 终止后的产物一致性

**Objective:** As a pi-web 维护者, I want 终止不留半态, so that 画廊与附件库不出现孤儿或错误血缘

#### Acceptance Criteria

1. When 终止发生, the 图像工具 shall 不向附件库写入本次调用的任何图片。
2. When 终止发生在多图下载途中, the 图像工具 shall 不入库已下载完成的那部分图片。
3. When 经 canvas A 档命令触发的编辑被终止, the canvas 画廊 shall 不新增资产、不写入血缘记录。

### Requirement 4: 不回归既有行为

**Objective:** As a pi-web 维护者, I want 终止能力的补齐不影响正常路径, so that 这次改动可以安全合入

#### Acceptance Criteria

1. When 未发生终止, the 图像工具 shall 保持既有的成功与失败行为完全不变。
2. The 图像工具 shall 保留既有的落盘超时兜底，使无 signal 的调用方仍受超时保护。
3. The 图像工具 shall 不改变附件落盘的产物形态与命名。
