# Requirements Document

## Introduction

修复「点停止后工具卡永远停在 Running」的缺陷。后端终止本身是好的 —— 缺陷在前端过早切断 SSE 流，导致后端随后推送的终态帧收不到。

## 根因（真机实证，2026-07-29）

`PiChat.onStop` 的实现顺序：

```js
if (controls !== undefined) void controls.abort().catch(() => undefined);
stop();   // ← AI SDK useChat 的本地停止：当场切断前端流
```

`stop()` 立刻断流，于是后端在 abort 之后推送的「工具已取消」终态帧**前端根本收不到**，卡片定格在断流前的最后状态。

### 对照实验（决定性）

| 路径 | 工具卡状态 | 计时器 | 停止按钮 | 取消文案 |
|------|-----------|--------|---------|---------|
| 点前端停止按钮（走 `onStop` → `stop()`） | **Running（永久）** | 一直走（观测到 1:31） | 一直在 | 无 |
| 直接 `POST /sessions/:id/abort`（绕过 `stop()`） | **Completed** | 定格 16.5s | 消失 | 「已取消:本次生成被用户终止」 |

两次用同一个 agent、同一个模型、同一段代码。差别只有「是否调用 `stop()`」。

会话文件两次都正确落盘了 `toolResult: 已取消:本次生成被用户终止` 与 `stopReason: aborted` —— **后端一直是对的**。

### 影响面

这是既有缺陷，**不限于图像工具**：输入框原有的停止按钮走同一个 `onStop`，任何工具的停止都受影响。工具卡新增的停止入口只是让它更容易被触发，从而暴露出来。

## Requirements

### Requirement 1: 停止后工具卡落终态

**Objective:** As a 用户, I want 点停止后工具卡立刻变成终态, so that 我确信它真的停了

#### Acceptance Criteria

1. When 用户触发停止且会话可控, the 聊天界面 shall 保持 SSE 流开启直至后端终态帧到达。
2. When 终态帧到达, the 工具卡 shall 显示为非运行态、计时器定格、停止按钮消失。
3. When 终态帧到达, the 聊天界面 shall 呈现工具返回的取消文案。
4. If 后端在合理时限内未送达终态帧, the 聊天界面 shall 回退到本地停止，不让界面无限期停在运行态。

### Requirement 2: 不回归

**Objective:** As a 维护者, I want 修复不破坏既有停止路径, so that 可安全合入

#### Acceptance Criteria

1. Where 会话控制能力不可用, the 聊天界面 shall 仍执行本地停止（与修复前一致）。
2. If 终止请求失败, the 聊天界面 shall 回退到本地停止。
3. The 聊天界面 shall 保持输入框停止按钮与工具卡停止按钮行为一致（同一路径）。
