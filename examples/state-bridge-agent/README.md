# state-bridge-agent

状态注入桥（**state-injection-bridge**）的端到端示例 agent —— 演示一条**独立于 LLM 对话历史之外**的会话级共享状态路线（「人机共驾」）。

## 它演示什么

一份会话级、可变、可订阅的共享状态 KV，**权威在 agent 子进程**（由 pi-web 的 `wireStateBridge` 自建，pi 框架本身无原生可变 KV）：

- **AI 侧（已就绪）**：`increment` / `read_state` 工具经 runner 注入的 globalThis seam 同步读写状态。工具写入经 stdout `piweb_state` 行 → server `PiSession.handleRawLine` → SSE `control:"state"` 帧实时镜像到前端。
- **人侧（前端 hook）**：宿主应用用 `useExtensionState("count")`（`@blksails/pi-web-react`）订阅并渲染当前值，并经 `POST /sessions/:id/state` 写回 → server `setState` → 子进程权威态更新 → 下行帧收敛。
- **webext 侧（API 已暴露）**：`.pi/web` 扩展可经 `WebExtHostContext.state`（`@blksails/pi-web-kit` 的 `createWebExtStateAccess`）读写同一份状态；该接入由宿主在装配时按 webext 信任门控提供。

双方读写**同一份实时状态**，互相可见。

## 工具

| 工具 | 作用 |
| --- | --- |
| `increment` | 读 `count`、+1 写回、返回新值（写入实时镜像到 UI） |
| `read_state` | 读某 key（或全量快照）当前值 |

## 运行

```bash
pnpm dev
# 新建会话选 ./examples/state-bridge-agent,prompt:
#   "run state-bridge demo"  → 触发示例下行(count=1)
#   "increment the counter"  → 模型调用 increment 工具
```

## 验证

离线双向闭环 e2e（经真实 handler + SSE）：`e2e/node/state-bridge.e2e.test.ts`
（下行：prompt → `control:"state"` 帧；写回：`POST /state` → 帧收敛）。

> 状态默认**不进 LLM 上下文**：除非 agent 作者在组装 prompt 时显式纳入。
