# Implementation Plan

- [x] 1.1 提取 `runStopTurn` 决策逻辑为独立可测纯函数
  - 新建 `packages/ui/src/chat/stop-turn.ts`
  - 三条路径：无 abort 能力 → 直接本地停止；abort 成功 → **不**本地停止、等终态帧、超时兜底；abort 失败 → 立即本地停止
  - 定时器可注入，便于测试不真等 5 秒
  - _Requirements: 1.1, 1.4, 2.1, 2.2_

- [x] 1.2 PiChat 接线
  - `onStop` 改为调用 `runStopTurn`，仅做接线不含决策
  - 组件卸载时 `cancelFallback()`，避免定时器泄漏与卸载后状态更新
  - _Requirements: 1.1_

- [x] 2.1 行为测试
  - 新建 `packages/ui/test/chat/stop-turn.test.ts`（9 条）
  - 守卫自检：还原「abort 成功也本地停止」的旧行为 → **3 条精确变红**
  - _Requirements: 1.1, 1.4, 2.1, 2.2_

- [x] 2.2 回归
  - ui 包 855 passed；全仓 typecheck 干净
  - _Requirements: 2.3_

- [x] 3.1 真机复验（**已完成**，2026-07-29）
  - 用户登录后，浏览器自动化点击工具卡上的停止按钮，实测：

    | | 修复前 | 修复后 |
    |---|---|---|
    | 工具卡状态 | Running（永久） | **Completed** |
    | 计时器 | 走到 1:31 不停 | **定格 9.8s** |
    | 停止按钮 | 一直在 | **消失** |
    | 取消文案 | 无 | **「已取消:本次生成被用户终止」** |
    | 落终态耗时 | 永不 | **102ms** |

  - 后端一致性：`toolResult: 已取消:本次生成被用户终止`（isError=False）、`stopReason: aborted`、`isStreaming: false`
  - 102ms 远小于 5000ms 兜底时限 → 走的是「终态帧驱动」正常路径，兜底未触发

---

## Implementation Notes

### 根因是我在诊断中三次误判后才锁定的

| 我用过的证据 | 为什么不可靠 |
|---|---|
| fetch 拦截为空 → 「没发请求」 | `usePiControls` 持有模块加载时捕获的 fetch 引用，运行时 patch 挂不上 |
| 服务端日志无 abort → 「没收到」 | 主进程 logger 默认关闭（`resolveLoggingEnvDefault`），本来就不会有 |
| 工具卡 Running → 「停止失败」 | 后端其实已 aborted 并落盘；Running 只是前端收不到终态帧 |

**真正锁定根因的是会话文件 + 对照实验**：

```
[toolResult] tool=image_generation  text=已取消:本次生成被用户终止
[assistant]  stop=aborted           err=Request was aborted.
```

| 路径 | 工具卡 | 计时器 | 停止按钮 | 取消文案 |
|------|-------|--------|---------|---------|
| 走 `onStop` → `stop()` | Running（永久） | 走到 1:31 | 一直在 | 无 |
| 直接 `POST /abort`（绕过 `stop()`） | **Completed** | 定格 16.5s | 消失 | 有 |

同 agent 同模型，差别只有是否调 `stop()`。后端一直是对的。

### 教训

**排查前端「没生效」时，先确认自己的观测手段是否可信。** 我连用三个不可靠证据源得出了三次错误结论，直到改用「落盘文件 + 控制变量对照」才拿到真相。运行时 patch、日志、UI 状态都可能因为架构原因失真。
