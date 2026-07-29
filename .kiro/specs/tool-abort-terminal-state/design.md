# Design Document — tool-abort-terminal-state

## 决策

**核心：`abort()` 成功时不调 `stop()`，让后端终态帧自然到达并驱动 UI 收尾。**

`stop()` 从「无条件立即执行」改为**兜底**，三种情况才触发：
1. 无 `controls`（会话控制不可用）— 保持修复前行为
2. `abort()` 抛错
3. `abort()` 成功但超时仍未收到终态帧

### 兜底超时取值

取 **5000ms**。依据：对照实验中终态帧在 abort 后**几乎立即**到达（工具卡计时器定格在 16.5s，与 abort 时刻一致）。5s 给足余量，又不至于让异常情况下界面长时间停在运行态。

### 为什么不用「乐观更新」

备选方案是前端在 abort 后立即把运行中的 tool part 标成已取消。弃用原因：那会让 UI 与后端真实状态**脱钩** —— 若 abort 实际失败（如 runner 已死），用户会看到「已取消」但后台仍在跑。让终态由后端帧驱动，UI 与事实一致。

## 文件计划

| 路径 | 改动 |
|------|------|
| `packages/ui/src/chat/pi-chat.tsx` | `onStop` 改为 abort 优先 + 超时/失败兜底 |
| `packages/ui/test/chat/stop-terminal-state.test.tsx` | 新建：四种路径的行为测试 |

## Testing Strategy

1. 有 controls：调用 abort，且**不**立即调 stop — Req 1.1
2. abort 成功 + 终态帧及时到达（模拟 streaming 结束）→ 始终不调 stop — Req 1.2
3. abort 成功但超时未收到终态帧 → 兜底调 stop — Req 1.4
4. abort 抛错 → 立即兜底调 stop — Req 2.2
5. 无 controls → 直接 stop（与修复前一致）— Req 2.1
6. 组件卸载后不再触发兜底（避免定时器泄漏与状态更新警告）
