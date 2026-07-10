# logging-demo-agent

端到端演示 **pi-web 日志系统**的 example agent —— 工厂式 `(ctx) => AgentDefinition`，在工厂被调用的瞬间用 `ctx.logger` 在四个级别各打一条日志，会话一建立日志面板就能立刻看到三条核心路径的产出。

## 它演示什么

| 能力 | API | 前端表现(pi-web) |
|------|-----|------------------|
| Agent 注入式 logger | `ctx.logger`（runner 注入，命名空间取源目录名） | 工厂期 `debug / info / warn / error` 四条 + 子命名空间 `<agent>:tool` 一条，启动即入日志面板 |
| 派生子 logger | `logger.child("tool")` | 命名空间 `<agent>:tool`，验证冒号分段前缀过滤 |
| pi extension 直接引用日志库 | `createLogger({ namespace: "ext:log-probe" })`（不依赖 pi SDK logging API） | `.pi/extensions/log-probe.ts`：`session_start` 与 `/log-probe` 命令各打日志 |
| webext 浏览器侧 log bus | `createLogger({ namespace: "webext:logging-demo" })`（浏览器构建，无 Node import） | `.pi/web/web.config.tsx`：组件 mount 时入浏览器环形缓冲 → `LogsStore` → 面板 |

> 三条路径（Node 子进程 stderr sentinel / 浏览器内存环形缓冲 / 同构 `@blksails/pi-web-logger` 包）最终都汇聚到同一个日志面板，是直观对照三源日志的最快入口。

## 运行

前端的 agent **source 指向本目录**（`usePiSession({ create: { source: "./examples/logging-demo-agent" } })`）即进入会话；会话一建立，工厂阶段的启动日志就出现在日志面板。

`model` 省略 → 继承 `~/.pi/agent/settings.json` 的默认 provider/model；凭据取自 `~/.pi/agent/auth.json`。本示例 `noTools: "builtin"` 且不挂自定义 skills，纯为观察日志而生。

配合日志环境变量观察门控行为：

```bash
PI_WEB_LOG_ENABLED=true PI_WEB_LOG_LEVEL=debug pnpm dev     # 五条启动日志全可见
PI_WEB_LOG_LEVEL=warn pnpm dev                              # debug / info 两条被门控滤掉
PI_WEB_LOG_NAMESPACES=agent:logging-demo pnpm dev           # 仅放行 agent 命名空间
PI_WEB_LOG_FILE=/tmp/pi-web.log pnpm dev                    # 同时写 JSONL 日志文件
```

| 变量 | 默认 | 作用 |
|------|------|------|
| `PI_WEB_LOG_ENABLED` | `true` | 设 `false` 全局禁用 |
| `PI_WEB_LOG_LEVEL` | `debug` | 全局最低级别 |
| `PI_WEB_LOG_NAMESPACES` | —— | 逗号分隔，仅启用指定命名空间 |
| `PI_WEB_LOG_FILE` | —— | 设置即写文件输出（JSONL，无 sentinel 前缀） |

> 若面板始终为空：确认 Settings 中 `outputs.panelVisible` 为 `true`；`panelPosition` 为 `drawer` 时默认收起，需点「日志」按钮展开；并确认 `PI_WEB_LOG_LEVEL` 未高于 demo 输出的最低级别（demo 会发 `debug`）。

## 相关

- [16 · 日志系统](../../docs/product/21-logging.md) —— 架构、三级门控、服务端权威门控、日志面板与 Settings 配置域；末尾「快速验证步骤」即以本示例为操作对象。
