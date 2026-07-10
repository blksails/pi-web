# 16 · 日志系统

> 该特性已合并到 main（spec `.kiro/specs/logging-system`，phase=implemented，全部任务勾选完成，含隔离构建 E2E）。

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
                   内核 PiChat 按 panelPosition 渲染 LogsPanel
                   （bottom / right / drawer，旁挂 webext logs slot）

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
**位置**：`packages/logger/`

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
| `PI_WEB_LOG_ENABLED` | （未设 = 关闭）| **日志默认关闭**。设为非 `false` 值（如 `1`/`true`）强制开启服务端日志门控，无需经 Settings；设为 `false` 显式禁用。 |
| `PI_WEB_LOG_LEVEL` | `info` | 全局最低级别：`debug / info / warn / error`（无配置时门控默认值） |
| `PI_WEB_LOG_NAMESPACES` | —— | 逗号分隔，启用指定命名空间，如 `agent:hello,ext:probe` |
| `PI_WEB_LOG_FILE` | —— | 日志文件绝对路径（设置即启用文件输出） |
| `PI_WEB_LOG_FILE_MAXSIZE` | `10` | 单文件最大 MB |
| `PI_WEB_LOG_FILE_MAXFILES` | `5` | 轮转保留备份数 |

---

## 在 Agent Source 中使用

runner 通过 `AgentContext.logger` 向 agent source 注入已绑定命名空间的 Logger：

```typescript
// examples/logging-demo-agent/index.ts（节选）
import type { AgentContext, AgentDefinition } from "@blksails/pi-web-agent-kit";
import { defineAgent } from "@blksails/pi-web-agent-kit";

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

> **默认关闭**：未在 Settings 保存过 logging 配置时（缺 `logging.json`），`loggingConfigProvider` 采用 `resolveLoggingEnvDefault()`（`lib/app/logging-default.ts`）的结果——`enabled` 默认 `false`，仅当 `PI_WEB_LOG_ENABLED` 存在且非 `"false"` 时强制开启（级别/命名空间同取自 `PI_WEB_LOG_*`）。注意：子进程 logger 仍按其库默认照常产出日志写 stderr，可见性由此服务端门控决定——故默认关闭时 agent / 扩展日志被门控丢弃，不进面板。

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

> **默认关闭**：浏览器侧 webext 日志默认关闭——仅当端点返回的 `values.enabled === true`（即用户在 Settings 显式开启）时 loader 才置 `enabled:true`；配置缺失或端点不可达时一律置 `enabled:false`，不沿用库默认。Settings 保存后需刷新页面 loader 才重新拉取生效。

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

面板由内核 `PiChat` 直接渲染（`packages/ui/src/chat/pi-chat.tsx`），不是独立 slot。`PiChat` 据 `showLogs` / `logsPanelVisible`（对应 `outputs.panelVisible`）/ `logsPanelPosition`（对应 `outputs.panelPosition`）三项 props 决定是否及在何处挂载面板，三种位置各自渲染一个带 `data-pi-logs-region` 标记的容器：

| `panelPosition` | 渲染位置 | 行为 |
|-----------------|----------|------|
| `bottom`（默认）| 输入 dock 下方（`pi-chat.tsx:960`）| 与会话用量条同列堆叠的水平面板 |
| `right` | 右侧 `aside` 内的独立区块（`pi-chat.tsx:1112`）| 与 `panelRight` / artifact 共存于同一 aside |
| `drawer` | 固定底部覆盖层（`pi-chat.tsx:974`）| 由 `data-pi-logs-drawer-toggle` 的「日志」按钮开合，`fixed` 抽屉 `max-h-[40vh]` |

每个位置的内核 `LogsPanel` 旁都并存一个 webext `logs` 插槽（`ExtSlotRegion slot="logs"`，`pi-chat.tsx:966 / 989 / 1117`）：扩展对 `logs` slot 的贡献以**追加语义**渲染在内核面板之后，二者并存而非替换。示例见 `examples/*` 中 webext 的 `slots.logs`（task 8.3 接入）。

面板功能（过滤逻辑在 `LogsStore`，`packages/react/src/logging/logs-store.ts`，面板仅消费其结果）：

- 按级别过滤（下拉选 `debug / info / warn / error`，最低级别含义）
- 按命名空间过滤（冒号分段前缀匹配，自动含子命名空间，如 `agent:hello` 命中 `agent:hello:tool`，但不命中 `agentx:other`）
- 文本搜索（对 `msg` 做**大小写敏感**子串匹配，即 `e.msg.includes(filterText)`）
- 历史日志自动拉取（面板 mount 时触发 `fetchHistory`，命中上文 REST 端点）

### Smart-follow（智能跟随 + 未读跳转）

自动滚动由 `LogsPanel` 自身实现（`packages/ui/src/logs/logs-panel.tsx`），其 `handleScroll` 用 `scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD` 判贴底（`logs-panel.tsx:178`）——与对话区通用的 `use-auto-scroll.ts` 钩子各自独立，面板未复用该钩子：

- **贴底跟随** — 处于底部时新条目到达即把 `ul.scrollTop = ul.scrollHeight` 续随，`unreadCount` 清零（`logs-panel.tsx:157`）。
- **向上暂停** — 用户上翻离底即暂停跟随；其间新条目按正向增量累计为未读数，过滤导致的条目减少（负增量）不计入（`logs-panel.tsx:164`）。
- **未读跳转按钮** — 暂停且 `unreadCount > 0` 时，面板右下角浮出 `data-pi-logs-jump-latest` 按钮，文案 `↓ N 新日志`；点击回到底部、恢复跟随并清零未读（`logs-panel.tsx:190 / 305`）。

### 窄列自适应换行

`LogRow` 采用自适应行布局（`logs-panel.tsx:81`）：宽容器下时间/级别/命名空间/消息四列单行排布；在窄容器（如 `right` 右侧栏）中，消息列以 `min-w` 12rem 触发 `flex-wrap` 换到整行全宽并按词换行（`break-words`），避免固定列把消息挤成逐字竖排。

---

## Settings UI 配置域

日志系统在 Settings 页注册了 `logging` 配置域（`packages/protocol/src/config/domains/logging.ts`，schema 为 `loggingConfigSchema`），分三组：

| 组 ID | 字段 |
|-------|------|
| `general` | `enabled`（启用日志，总开关，**默认 `false`**）、`level`（全局级别，默认 `info`）|
| `components` | `namespaces`（按命名空间开关，自定义 widget `logNamespaceToggles`）|
| `output` | `outputs`（嵌套对象：`console` 控制台、`file` 文件路径/轮转、`panelVisible` 面板显隐、`panelPosition` 面板位置）、`panelDefaultLevel`（面板默认级别）|

> 注意：配置域 `enabled` 默认 `false`（日志默认关闭，需在此开启或设 `PI_WEB_LOG_ENABLED`）；`level` 默认 `info`（见 schema），而 Node 侧库 `initConfigFromEnv` 在未读到 `PI_WEB_LOG_LEVEL` 时的内部默认是 `debug`，三者是不同层的默认值。

---

## 快速验证步骤

> 动手实践见 [`examples/logging-demo-agent`](https://github.com/blksails/pi-web/tree/main/examples/logging-demo-agent/)（含独立 README）：它把上文三条路径——agent 注入式 `ctx.logger`、pi extension 直接 `createLogger`、webext 浏览器 log bus——汇成同一个日志面板，是对照三源日志最快的入口。下述步骤即以该示例为操作对象。

1. 启动开发服务器并开启日志（**日志默认关闭**，用 env 强开最省事）：

   ```bash
   PI_WEB_LOG_ENABLED=1 pnpm dev
   ```

   或 `pnpm dev` 后到 Settings → 日志，打开「启用日志」并保存（浏览器侧需刷新、Node 侧需新建会话才生效）。

2. 在浏览器打开 pi-web，选择 `logging-demo-agent`（位于 `examples/logging-demo-agent/`）发起会话。

3. 会话建立后，日志面板应显示 demo agent 在 factory 阶段输出的启动日志：四条主命名空间条目（`debug / info / warn / error`）加一条子命名空间 `<agent>:tool` 的 `info` 条目。

4. 验证 env 门控（强开后再提级别）：

   ```bash
   PI_WEB_LOG_ENABLED=1 PI_WEB_LOG_LEVEL=warn pnpm dev
   ```

   面板中 `debug` 和 `info` 条目不应出现。

6. 验证文件输出：

   ```bash
   PI_WEB_LOG_FILE=/tmp/pi-web.log pnpm dev
   tail -f /tmp/pi-web.log   # 应看到 JSONL 格式日志行（每行一条 JSON.stringify(entry)，无 sentinel 前缀）
   ```

**若面板始终为空**，按以下顺序排查：

- **首先确认已开启日志（默认关闭）**：Settings → 日志的「启用日志」为 `true`（保存后浏览器刷新、Node 侧新建会话生效），或启动时设 `PI_WEB_LOG_ENABLED=1`。未开启时 agent / 扩展 / webext 日志均不进面板。
- 确认面板未被隐藏或挪走：Settings 中 `outputs.panelVisible` 为 `true`（否则即使 `showLogs` 也不渲染），`outputs.panelPosition` 为 `drawer` 时面板默认收起，需点「日志」按钮（`data-pi-logs-drawer-toggle`）展开。
- 确认级别未把条目滤掉：`PI_WEB_LOG_LEVEL` 未高于 demo agent 输出的最低级别（demo 会发 `debug`，若设为 `warn` 则 `debug/info` 两条被门控）。
- 服务端门控独立于浏览器（见上文「服务端：权威门控」）：env 提级会在「入 ring buffer」前就把低级别条目滤掉，面板也就收不到。
- 仍无输出时参见 [23 · 故障排查 FAQ](./23-troubleshooting-faq.md)。

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
- [06 · 配置](./06-configuration.md) — `PI_WEB_*` env 变量与 Settings UI 框架
- [08 · Agent 开发](./08-agent-development.md) — `AgentContext.logger` 注入
- [10 · 扩展与 Skills](./10-extensions-and-skills.md) — pi extension 中直接引用日志库
- [22 · 开发与测试](./22-development-and-testing.md) — 单元测试与 E2E 隔离构建
- [23 · 故障排查 FAQ](./23-troubleshooting-faq.md) — 常见日志相关问题
