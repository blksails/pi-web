# 16 · 日志系统

> **注意：该特性位于 `feat/logging-system` 分支，尚未合并到 main。**
> 本章描述的所有路径、API 和配置均基于该分支的实现（spec `.kiro/specs/logging-system`，phase=implemented，全部任务勾选完成，含隔离构建 E2E），在合并前不可在主干直接使用。

日志系统为 pi-web 的 agent source、pi extension 和 webext 三类组件提供统一的结构化日志能力，从子进程 stderr 汇聚到主进程，经会话流实时推送到浏览器日志面板，并支持按需拉取历史记录。

---

## 架构概览

```
agent source / pi extension（Node 子进程）
  └─ createLogger() → nodeSink → stderr（带 LOG_SENTINEL 前缀）
                                        │
                               主进程 parseLogLine 解析
                                        │
                               PiSession 会话环形缓冲（LogRingBuffer）
                                        │
                               control:logs SSE 帧 ──► 浏览器
                                        │
                              LogsStore（合并/去重三源条目）
                                        │
                                   LogsPanel（面板）

webext（浏览器）
  └─ createLogger() → browserSink → 内存环形缓冲（2000 条）→ LogsStore
```

三条核心路径：

1. **Node 子进程** — `nodeSink` 将每条 `LogEntry` 序列化为 JSON 并以 `LOG_SENTINEL`（`\x02PILOG\x03 `）为前缀写入 stderr，主进程 `parseLogLine` 识别前缀后反序列化并路由到对应 `PiSession`。
2. **浏览器 webext** — `browserSink` 将条目写入内存环形缓冲（`BROWSER_LOG_CAPACITY = 2000`），订阅方（`LogsStore`）收到通知后更新状态。
3. **同构 `@blksails/logger` 包** — 零运行时依赖，无静态 Node 模块引用，可在 Node 与浏览器两端安全导入。

---

## `@blksails/logger` 包

**包名**：`@blksails/logger`  
**位置**：`packages/logger/`（`feat/logging-system` 分支）

### 核心 API

```typescript
import { createLogger, configureLogger, initConfigFromEnv } from "@blksails/logger";

// 创建 logger（Node 子进程侧）
const logger = createLogger({ namespace: "agent:hello", level: "debug" });
logger.info("started", { version: "1.0" });
logger.debug("tool called", { toolName: "search" });

// 派生子 logger（命名空间为 "agent:hello:tool"）
const toolLogger = logger.child("tool");
toolLogger.warn("rate limit approaching");

// 在 Node 服务启动时从环境变量初始化配置（一次性）
initConfigFromEnv();
```

### 类型定义

| 类型 | 说明 |
|------|------|
| `LogLevel` | `"debug" \| "info" \| "warn" \| "error"` |
| `LogEntry` | `{ id?, level, ns, msg, data?, ts }` |
| `Logger` | `{ debug, info, warn, error, child }` |
| `LoggerRuntimeConfig` | `{ enabled, level, namespaces? }` |
| `Sink` | `(entry: LogEntry) => void` |

### 三级门控（createLogger 内部）

`createLogger` 对每次日志调用依次执行：

1. **enabled 门** — `LoggerRuntimeConfig.enabled` 为 `false` 时全局丢弃
2. **level 门** — 取 per-logger 静态级别与运行时全局级别中较严格者
3. **namespace 门** — 命名空间被显式禁用时丢弃

门控即时生效——无需重建 logger 实例：`configureLogger(partial)` 修改模块级单例，下次调用自动读取新配置。

### Node Sink：stderr sentinel

```typescript
// packages/logger/src/node-sink.ts
export const LOG_SENTINEL = "\x02PILOG\x03 ";
// 每行格式：LOG_SENTINEL + JSON.stringify(entry) + "\n"
```

主进程用 `parseLogLine`（`packages/protocol/src/logging/log-entry.ts`）解析：以 `LOG_SENTINEL` 为识别标记，不匹配的 stderr 输出（如原生 Node 诊断信息）被当作原始日志包装处理，不干扰 RPC 协议消息分流。

### 浏览器 Sink：内存环形缓冲

```typescript
// packages/logger/src/browser-sink.ts
export const BROWSER_LOG_CAPACITY = 2000; // 环形缓冲最大条目数
```

超容量时淘汰最旧条目；订阅方通过 `subscribeBrowserLogs(cb)` 注册回调，返回取消订阅函数。

### 文件输出（P1）

通过 env 变量或 `configureFileOutput()` 启用：

```bash
PI_WEB_LOG_FILE=/var/log/pi-web/app.log
PI_WEB_LOG_FILE_MAXSIZE=10    # MB，默认 10
PI_WEB_LOG_FILE_MAXFILES=5    # 轮转备份数，默认 5
```

轮转策略：`app.log` → `app.log.1` → `app.log.2` … → `app.log.N`，超出 `maxFiles` 的备份自动删除。Node 侧 `fs` 访问通过 `globalThis.__PI_WEB_FS__` 注入（服务端 runner bootstrap 预先设置），浏览器环境该 seam 不存在，文件 sink 成为无操作，保证同构安全。

---

## 环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PI_WEB_LOG_ENABLED` | `true` | 设为 `false` 全局禁用日志 |
| `PI_WEB_LOG_LEVEL` | `debug` | 全局最低级别：`debug / info / warn / error` |
| `PI_WEB_LOG_NAMESPACES` | —— | 逗号分隔，启用指定命名空间，如 `agent:hello,ext:probe` |
| `PI_WEB_LOG_FILE` | —— | 日志文件绝对路径（设置即启用文件输出） |
| `PI_WEB_LOG_FILE_MAXSIZE` | `10` | 单文件最大 MB |
| `PI_WEB_LOG_FILE_MAXFILES` | `5` | 轮转保留备份数 |

---

## 在 Agent Source 中使用

runner 通过 `AgentContext.logger` 向 agent source 注入已绑定命名空间的 Logger：

```typescript
// examples/logging-demo-agent/index.ts（节选）
import type { AgentContext, AgentDefinition } from "@blksails/agent-kit";
import { defineAgent } from "@blksails/agent-kit";

export default function (ctx: AgentContext): AgentDefinition {
  const logger = ctx.logger;                        // runner 注入，命名空间取 agent 源目录名

  if (logger !== undefined) {
    logger.debug("factory invoked", { cwd: ctx.cwd });
    logger.info("started", { env: Object.keys(ctx.env).length });
    logger.warn("this is a sample warn");
    logger.error("this is a sample error (not a real error)");

    const childLogger = logger.child("tool");       // 命名空间：<agent>:tool
    childLogger.info("child logger created with namespace :tool");
  }

  return defineAgent({ systemPrompt: "..." });
}
```

pi extension 可直接引用本包，无需依赖 pi SDK：

```typescript
// .pi/extensions/my-ext.ts
import { createLogger } from "@blksails/logger";
const log = createLogger({ namespace: "ext:my-ext" });
log.info("extension loaded");
```

---

## 服务端：权威门控

> 设计称之为「服务端权威门控」（design.md / task 4.4）：Settings 中改 enabled/level/namespaces 不仅作用于浏览器，Node 子进程日志在「入 ring buffer / 产帧」之前也由服务端再过滤一遍，确保 agent / 扩展的 Node 日志同样受控。

```
runner bootstrap        — initConfigFromEnv() 读 PI_WEB_LOG_* env（packages/server/src/runner/runner.ts）
        │
PiSession.handleStderr  — 会话启动时经 loggingConfigProvider 加载 logging 配置（ConfigCodec.load("logging")）
        │                  配置就绪前缓冲 chunk，就绪后回放
        ▼
PiSession.processStderrChunk — 按门控逐条过滤后入 LogRingBuffer，再合并成 control:logs 帧广播
```

1. **runner bootstrap** — runner 启动时调用 `initConfigFromEnv()`，从 `PI_WEB_LOG_*` env 初始化 Node 侧 logger 配置（`packages/server/src/runner/runner.ts:199`）。
2. **PiSession 门控** — `handleStderr` 在会话激活时经注入的 `loggingConfigProvider` 加载 logging 配置；配置就绪前先缓冲 stderr chunk，就绪后回放并过滤。
3. **逐条过滤 + 入库** — `processStderrChunk` 对每条 `LogEntry` 依次套用 `gate.enabled` / `isLevelEnabled` / `isNamespaceEnabled`（来自 `@blksails/logger`），通过者经 `LogRingBuffer.ingest` 分配 id 入会话环形缓冲，再合并为 `control:logs` 帧广播（`packages/server/src/session/pi-session.ts`）。
4. **SSE 回填** — 浏览器订阅建立时，`PiSession` 先把 ring buffer 已有条目以一帧 `control:logs` 回填（避免早期日志竞争），后续新条目实时推送。

REST 端点（历史拉取）：`GET /api/sessions/[sessionId]/logs?level=info&limit=200&since=<ts>`（内部 handler 路由 `/sessions/:id/logs`，见 `packages/server/src/http/routes/query-routes.ts`，返回 `{ entries }`）。

---

## 浏览器侧：LoggingConfigLoader

`LoggingConfigLoader`（`components/logging-config-loader.tsx`）在客户端 mount 时从配置 API 拉取日志配置，调用 `configureLogger()` 同步浏览器侧门控，渲染透明（返回 `null`），失败静默处理。本分支中它挂在 `components/chat-app.tsx`（PiChat 外壳）内，与会话界面同生命周期。

```tsx
// 在 app 外壳（如 chat-app.tsx）中挂载一次即可
import { LoggingConfigLoader } from "@/components/logging-config-loader";

export default function ChatShell({ children }) {
  return (
    <>
      <LoggingConfigLoader />
      {children}
    </>
  );
}
```

配置来源端点：`GET /api/config/logging`，返回 `{ values: { enabled, level, namespaces } }`。

---

## 日志面板（LogsPanel）

面板作为独立 slot 挂载在会话界面，支持三种位置：

| `panelPosition` | 效果 |
|-----------------|------|
| `bottom`（默认）| 聊天区下方水平面板 |
| `right` | 右侧分栏 |
| `drawer` | 可折叠抽屉 |

面板功能（过滤逻辑在 `LogsStore`，`packages/react/src/logging/logs-store.ts`，面板仅消费其结果）：

- 按级别过滤（下拉选 `debug / info / warn / error`，最低级别含义）
- 按命名空间过滤（冒号分段前缀匹配，自动含子命名空间，如 `agent:hello` 命中 `agent:hello:tool`，但不命中 `agentx:other`）
- 文本搜索（对 `msg` 做**大小写敏感**子串匹配，即 `e.msg.includes(filterText)`）
- 自动滚动（用户向上翻阅时暂停，回到底部时恢复）
- 历史日志自动拉取（面板 mount 时触发 `fetchHistory`，命中上文 REST 端点）

---

## Settings UI 配置域

日志系统在 Settings 页注册了 `logging` 配置域（`packages/protocol/src/config/domains/logging.ts`，schema 为 `loggingConfigSchema`），分三组：

| 组 ID | 字段 |
|-------|------|
| `general` | `enabled`（启用日志，总开关）、`level`（全局级别，默认 `info`）|
| `components` | `namespaces`（按命名空间开关，自定义 widget `logNamespaceToggles`）|
| `output` | `outputs`（嵌套对象：`console` 控制台、`file` 文件路径/轮转、`panelVisible` 面板显隐、`panelPosition` 面板位置）、`panelDefaultLevel`（面板默认级别）|

> 注意：配置域 `level` 默认值是 `info`（见 schema），而 Node 侧库 `initConfigFromEnv` 在未读到 `PI_WEB_LOG_LEVEL` 时的内部默认是 `debug`，二者是不同层的默认值。

---

## 快速验证步骤

> 以下步骤基于 `feat/logging-system` 分支。

1. 切换到该分支：

   ```bash
   git checkout feat/logging-system
   ```

2. 启动开发服务器：

   ```bash
   pnpm dev
   ```

3. 在浏览器打开 pi-web，选择 `logging-demo-agent`（位于 `examples/logging-demo-agent/`）发起会话。

4. 会话建立后，日志面板应立即显示 demo agent 在 factory 阶段输出的启动日志：四条主命名空间条目（`debug / info / warn / error`）加一条子命名空间 `<agent>:tool` 的 `info` 条目。

5. 验证 env 门控：

   ```bash
   PI_WEB_LOG_LEVEL=warn pnpm dev
   ```

   面板中 `debug` 和 `info` 条目不应出现。

6. 验证文件输出：

   ```bash
   PI_WEB_LOG_FILE=/tmp/pi-web.log pnpm dev
   tail -f /tmp/pi-web.log   # 应看到 JSONL 格式日志行（每行一条 JSON.stringify(entry)，无 sentinel 前缀）
   ```

**若面板始终为空**，按以下顺序排查：

- 确认当前在 `feat/logging-system` 分支（`git branch --show-current`）——main 上无此特性。
- 确认未通过 env 或 Settings 把日志关掉：`PI_WEB_LOG_ENABLED` 不为 `false`，且 `PI_WEB_LOG_LEVEL` 未高于 demo agent 输出的最低级别（demo 会发 `debug`，若设为 `warn` 则 `debug/info` 两条被门控）。
- 服务端门控独立于浏览器（见上文「服务端：权威门控」）：env 提级会在「入 ring buffer」前就把低级别条目滤掉，面板也就收不到。
- 仍无输出时参见 [18 · 故障排查 FAQ](./18-troubleshooting-faq.md)。

---

## 协议：SSE 日志控制帧

日志通过既有 SSE 控制帧通道推送。SSE 顶层帧以 `kind` 判别，日志走 `kind: "control"` 帧，内层 `payload.control` 为 `"logs"`（复数），与其他控制事件（`extension-ui` / `queue` / `stats` / `error`）经同一 `discriminatedUnion("control", …)` 区分（`packages/protocol/src/transport/sse-frame.ts`）。一帧可携带多条 `entries`：

```jsonc
// SSE 帧示例（makeControlFrame({ control: "logs", entries: [...] }) 的产物）
data: {"kind":"control","protocolVersion":"0.1.0","payload":{"control":"logs","entries":[{"id":"seq-42","level":"info","ns":"agent:hello","msg":"started","ts":1719000000000}]}}
```

`packages/protocol/src/logging/log-entry.ts` 中的 `parseLogLine` 负责子进程 stderr 行的 sentinel 识别与 `LogEntrySchema`（zod）校验，校验失败返回 `null`，主进程静默忽略。

---

## 相关章节

- [03 · 系统架构](./03-architecture.md) — 子进程 / 主进程 / 浏览器三段结构
- [05 · 配置](./05-configuration.md) — `PI_WEB_*` env 变量与 Settings UI 框架
- [07 · Agent 开发](./07-agent-development.md) — `AgentContext.logger` 注入
- [09 · 扩展与 Skills](./09-extensions-and-skills.md) — pi extension 中直接引用日志库
- [17 · 开发与测试](./17-development-and-testing.md) — 单元测试与 E2E 隔离构建
- [18 · 故障排查 FAQ](./18-troubleshooting-faq.md) — 常见日志相关问题
