# 09 · 扩展、Skills 与 Prompt 模板

pi-web 把 pi 的扩展/skills/prompt 模板能力以**受控 REST API + 声明式注入 + 权限内联交互**的方式暴露给 Web 侧，本章覆盖资源自动发现、扩展生命周期管理、UI 子协议、斜杠命令面板，以及系统资源开关的正确用法。

---

## 资源自动发现与注入

pi-web 每次新建会话时，由 runner 子进程侧自动发现并加载资源。SDK（`@earendil-works/pi-coding-agent`）的 resource-loader 按以下目录约定查找各类资源（优先级 **项目 > 用户 > 内置**，同名覆盖；`settings.json` 仅做 enable/disable 配置，不是注册表）：

| 资源类型 | 用户级（始终加载） | 项目级（仅 trusted） |
|---------|------------------|---------------------|
| extensions | `~/.pi/agent/extensions/` | `<cwd>/.pi/extensions/` |
| skills | `~/.pi/agent/skills/`（三级渐进式 L1/L2/L3） | `<cwd>/.pi/skills/<name>/SKILL.md` |
| subagents | `~/.pi/agent/agents/` | `<cwd>/.pi/agents/<name>.md` |
| prompts / commands | — | `<cwd>/.pi/commands/` |
| settings | `~/.pi/agent/settings.json` | `<cwd>/.pi/settings.json` |

> 用户/全局目录默认值是 SDK 的 `agentDir`（缺省 `~/.pi/agent/`）；pi-web 可经环境变量 `PI_CODING_AGENT_DIR` 覆盖该目录。

`<cwd>/.pi/` 下的**项目级**资源仅在该项目目录被信任（trusted）时才并入加载；用户/全局资源、内置资源以及 `AGENTS.md`/`CLAUDE.md` context 文件**不受** trust 门控（见「信任策略落地」一节）。

---

## 扩展管理 REST API

扩展管理路由由 `packages/server/src/extensions/routes.ts` 的 `createExtensionRoutes()` 导出，经 `createPiWebHandler` 的 `routes?` 注入接缝并入路由表，**不** 修改 `http-api` 内部实现。

> **当前状态（截至 HEAD）：** `createExtensionRoutes` 已实现并经 `packages/server/test/extensions/` 下的集成/e2e 测试覆盖，但**尚未在 `apps/web` 中接线挂载**——目前没有生产入口调用它。要在自托管部署中启用，需自行在装配 `createPiWebHandler` 处注入下文示例的 `routes`（见 [15 · 部署](./15-deployment.md)）。下文端点为该路由集的契约，非默认开启的内置 API。

### 端点一览

| 方法 | 路径 | 说明 | 鉴权要求 |
|------|------|------|---------|
| `GET` | `/extensions` | 列出已安装扩展（来源类型/版本/作用域） | 无强制管理员要求 |
| `POST` | `/extensions` | 安装扩展（来源 → 白名单 → `pi install`） | **仅管理员** |
| `DELETE` | `/extensions/:extId` | 卸载扩展（`pi remove`） | **仅管理员** |
| `POST` | `/sessions/:id/reload` | 重载已有会话运行时以载入新扩展 | **仅管理员** |

> `GET /sessions/:id/commands`（斜杠命令面板数据源）归 `http-api` 拥有，扩展管理层仅在集成/e2e 中消费其输出，不实现该路由。

### 路由注册示例

`createExtensionRoutes` 与 `createPiWebHandler` 均从 `@blksails/server` 主入口导出（`packages/server/src/index.ts` 经 barrel `export *` 重导出 `extensions/index.js`；该包**未**暴露 `@blksails/server/extensions` 子路径）：

```typescript
import { createExtensionRoutes, createPiWebHandler } from "@blksails/server";

const handler = createPiWebHandler({
  // …manager / store / resolver / createChannel 等核心选项…
  routes: createExtensionRoutes({
    piCli,         // PiCli（默认 ChildProcessPiCli，唯一子进程 IO）— 必填
    store,         // SessionStore（reload 时检索会话）— 必填
    manager,       // SessionManager（reload 时重建运行时）— 必填
    adminPolicy,   // 可选；缺省 defaultAdminPolicy（默认拒绝，需显式 adminUserIds 名单）
    onAudit,       // 可选；缺省 defaultOnAudit（结构化输出到 stderr）
    trustPolicy,   // 可选；缺省 defaultTrustPolicy（恒返回 "ask"）
    allowlist,     // 可选；缺省 DEFAULT_ALLOWLIST
    // reloadSession, piInstallTimeoutMs 亦可选
  }),
});
```

> `ExtManagementOptions`（`packages/server/src/extensions/ext.types.ts:124`）中 `piCli` / `store` / `manager` 为必填，其余均有显式默认。

---

## 安装治理管线

安装一个扩展等同于**授予远程代码以完整系统权限执行**。pi-web 用以下管线在执行 `pi install` 之前完成所有拒绝决策：

```
POST /extensions
  │
  ├─ adminPolicy(AuthContext) → 非管理员 → 403/401 + 审计（被拒绝）
  │
  ├─ DTO safeParse(source) → 字段非法 → 400
  │
  ├─ checkAllowlist(source, cfg) → 非白名单/未固定版本 → 422 + 审计（被拒绝）
  │
  ├─ assembleInstallArgs(source) → args + 非交互 env
  │     ├─ 始终含 --ignore-scripts
  │     └─ git 源：GIT_TERMINAL_PROMPT=0 + GIT_SSH_COMMAND BatchMode
  │
  └─ pi-cli.runPiCommand(args, env, { timeoutMs }) → 成功/失败 + 审计
```

### 来源白名单（`source-allowlist.ts`）

默认白名单定义于 `packages/server/src/extensions/install/source-allowlist.ts:24`：

```typescript
export const DEFAULT_ALLOWLIST: AllowlistConfig = {
  npmScopes: ["@pi-web", "@earendil-works"],
  gitHosts: ["github.com"],
  allowLocal: false,          // 生产下 local: 默认关闭
};
```

**来源格式规范：**

| 类型 | 格式示例 | 版本固定要求 |
|------|---------|------------|
| npm | `npm:@blksails/my-ext@1.2.3` | 精确 semver `@x.y.z`（不允许 range/dist-tag） |
| git | `git:github.com/user/repo@v1.2.3` | pinned ref（40-hex commit 或 `v*.*.*` tag，拒绝分支名） |
| local | `local:/abs/path` | 无（需 `allowLocal: true`） |

任意裸 `http(s)://` URL、未列入白名单的 npm scope 或 git host，均在执行 `pi install` **之前**被拒绝。

---

## 安装后生效：新会话 vs reload

安装完成后，扩展写入 `settings.json`：

1. **新建会话**（`POST /api/sessions`）— 会话 spawn 时自动加载，无需额外操作。
2. **已有会话** — 需调用 `POST /sessions/:id/reload`，重启 runner 子进程 / `new_session` 重建运行时后方可生效。

> 重启编排归 `session-engine`，本路由层仅消费 `SessionReloader` 接缝触发。**缺省的 `defaultSessionReloader` 会以 `501 RELOAD_NOT_CONFIGURED` 拒绝**——宿主必须注入真实的 `reloadSession` 实现才能启用该端点（成功返回 `{ ok: true, reloaded: <sessionId> }`）。

```bash
# 约定本地自托管入口为 http://localhost:3000(按实际部署替换);
# 安装/卸载/reload 均要求管理员鉴权,请按 adminPolicy 附带相应凭据头。

# 1. 安装扩展(管理员)
curl -X POST http://localhost:3000/extensions \
  -H "Content-Type: application/json" \
  -d '{"source": "npm:@blksails/code-review@2.0.0"}'
# 预期成功:200 + { "ok": true, ... };被拒来源:422;非管理员:403/401

# 2. 让已有会话 <sessionId> 重载以生效(管理员)
curl -X POST http://localhost:3000/sessions/<sessionId>/reload
# 预期成功:{ "ok": true, "reloaded": "<sessionId>" }
# 若未注入 reloadSession:501 RELOAD_NOT_CONFIGURED(见上方说明)
```

> 状态码语义:`422`=来源不在白名单/未固定版本(见「来源白名单」),`501`=宿主未注入 `reloadSession`(见上方说明),`403/401`=未通过 `adminPolicy`。系统资源开关 `--no-skills` 不生效、`.pi/` 项目资源未加载等问题的排查见 [18 · 故障排查 FAQ](./18-troubleshooting-faq.md)。

---

## 信任策略落地

项目 `.pi/` 目录下的 skills/extensions/prompts 是否被加载取决于 `trustPolicy` 的返回值（消费 `agent-source-resolver` 决策，不重定义）：

`landTrust(source, mode, trustPolicy)`（`packages/server/src/extensions/install/trust-landing.ts`）调用 `trustPolicy(source)` 得到 `TrustDecision`，再经 `applyTrust(mode, decision)`（`packages/server/src/agent-source/trust-apply.ts`）映射为 spawn 片段：

| `trustPolicy` 返回 | CLI 模式 | custom 模式 |
|------------------|---------|------------|
| `"always"` | `extraArgs += ["--approve"]` | `extraEnv.PI_WEB_TRUST_PROJECT="1"`（runner `startRunner` 读取后设 `makeResolveProjectTrust(true)`） |
| `"never"` | `extraArgs += ["--no-approve"]` | 不传放行信号 |
| `"ask"`（默认） | 无信任标志 | 不传放行信号 |

`"ask"`/`"never"` 下 headless 安全忽略 `.pi/` 项目资源（无 TTY 无法交互批准）。

任何取值都**不抑制** `AGENTS.md`/`CLAUDE.md` context 文件及全局/用户扩展的加载。

---

## 扩展 UI 子协议（权限弹窗 → 内联交互）

agent 在执行过程中可经 RPC 发起交互请求（confirm / select / input / editor），格式为 `extension_ui_request`，经 `ControlStore.extensionUiQueue`（FIFO 队列）流向前端，由 `PiInteraction` 组件（`packages/ui/src/elements/pi-interaction.tsx`）在对话流末尾以**内联卡片**呈现。

协议流程：

```
agent 子进程
  │  extension_ui_request（RPC frame）
  ▼
PiSession → ControlStore.extensionUiQueue（FIFO，仅交互类请求入队）
  │  SSE control frame
  ▼
前端 useExtensionUI（@blksails/react）
  │  queue / current / respond / pending / error
  ▼
PiInteraction（packages/ui/src/elements/pi-interaction.tsx）
  │  active 卡（队首可应答） + resolved 留痕（只读终态）
  ▼
extensionUI.respond(requestId, response)  →  UiResponseRequest → 后端出队
```

**关键不变量：**
- 仅 `queue[0]`（FIFO 队首）为可应答（active），后续排队项不可并发应答。
- `respond` 成功后，该请求以只读终态留痕保留在 mount 生命周期内（不持久化）。
- `respond` 失败保留 active 状态，允许重试；`pending` 为真时禁用所有动作控件。

**交互类型与回传负载**（应答经 `respond(requestId, response)`，`response` 为 `UiResponseRequest`=`RpcExtensionUIResponse`，统一带 `type: "extension_ui_response"` 与 `id`，下表只列判别负载，schema 见 `packages/protocol/src/rpc/extension-ui.ts:85`）：

| 请求 method | 回传判别负载 |
|--------|---------|
| `confirm` | `{ confirmed: true/false }` |
| `select` | `{ value: "<选项>" }` |
| `input` | `{ value: "<输入文本>" }` |
| `editor` | `{ value: "<编辑器文本>" }` |
| 取消（select/input/editor） | `{ cancelled: true }` |

> 推送类请求（`notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text`）**不入** `extensionUiQueue`（无需回包），而是写入 `ControlStore` 的 ambient 切片（通知 / 状态 / widget / 一次性写输入框），避免阻塞交互对话框（见 `packages/react/src/sse/control-store.ts:178`）。

---

## 斜杠命令面板（slash-command-palette）

`/` 命令补全由 `PiCommandPalette`（`packages/ui/src/controls/pi-command-palette.tsx`）实现，经 `PiChat` 装配层接线：

1. 输入框值以 `"/"` 开头 → 进入命令模式，渲染命令补全浮层（`absolute bottom-full z-40`）。
2. 候选来源：`controls.getCommands()` 拉取（底层 `PiSession.getCommands()`），产出 `RpcSlashCommand[]`（schema 见 `packages/protocol/src/rpc/session-state.ts:45`：`{ name, description?, source: "extension"|"prompt"|"skill", sourceInfo }`）。
3. 选中命令 → 填充 `"/<name> "`（尾随空格待补参），不立即发送。
4. 命令模式下 Enter 让位给浮层选中（`suppressEnterSubmit`），Shift+Enter 仍换行。

**命令数据源（`GET /sessions/:id/commands`，归 `http-api`）：**

```bash
curl http://localhost:3000/sessions/<sessionId>/commands
# 返回 { commands: [{ name: "my-skill", description: "...", source: "skill", sourceInfo: { … } }, …] }
```

命令面板仅消费该端点输出，不在前端解析或展开命令——斜杠文本经 `sendMessage` 原样发出，由 pi 后端识别并展开。

---

## 系统资源开关（`--no-skills` / `--no-extensions`）

Settings UI「设置 → 扩展 → 系统资源」提供两个独立开关：

| 开关 key | 关闭时注入参数 | 效果 |
|---------|-------------|------|
| `loadSystemSkills` | `--no-skills` | 新建会话不载入系统/包/内置 skills（斜杠面板无 `/skill:*`） |
| `loadSystemExtensions` | `--no-extensions` | 新建会话不载入系统/包 extensions（沙箱强制注入路径不受影响） |

注入链路（`lib/app/system-resource-args.ts:50`）：

```
settings.json (project <cwd>/.pi/settings.json 逐键覆盖 global <agentDir>/settings.json)
  → systemResourceArgs(agentDir, cwd)            # lib/app/system-resource-args.ts:50
  → ["--no-skills"] / ["--no-extensions"]（各自独立，仅显式 false 触发）
  → assemble-spawn → runner argv
  → parseRunnerArgs                              # packages/server/src/runner/runner.ts:74（--no-skills 分支:115）
  → RunnerArgs.noSkills / noExtensions
  → mapResourceLoaderOptions                     # packages/server/src/runner/option-mapper.ts:96
  → resourceLoaderOptions.skillsOverride = ({ diagnostics }) => ({ skills: [], diagnostics })   # :186
  → resourceLoaderOptions.noExtensions = true    # :191
```

> **历史 Bug（已修）：** `parseRunnerArgs` 曾静默丢弃 `--no-skills`/`--no-extensions`，custom 模式开关完全无效。spec `system-resource-toggle-fix` 已在 runner 侧补齐识别逻辑，证据落 `.kiro/specs/system-resource-toggle-fix/evidence/`。

**重要：** 仅影响**新建会话**，不支持运行中会话的运行时热切换。

---

## 审计记录

安装/卸载的每次操作（包括被拒绝的安装请求）均产生一条审计记录，字段：

```typescript
interface AuditRecord {
  actor: string;               // 操作者（userId 或 "anonymous"）
  at: string;                  // ISO 时间戳
  action: "install" | "remove";
  source: string;              // 来源标识（已脱敏）
  outcome: "success" | "failure" | "rejected";
  reason?: string;             // 失败/拒绝原因摘要（已剥离 env/凭据）
}
```

默认实现（`packages/server/src/extensions/security/audit.ts:64`）结构化输出到 `stderr`：

```
[ext-audit] {"actor":"alice","at":"2026-06-24T10:00:00.000Z","action":"install","source":"npm:@blksails/code-review@2.0.0","outcome":"success"}
```

生产环境可经 `onAudit` 接缝替换为持久化落库。

---

## 安全边界

- **扩展安装 = RCE**：生产部署须在沙箱/容器环境内启用安装 API（沙箱实现归生产硬化，本层仅留接缝）。
- **管理员门控**：安装/卸载/reload 在任何子进程执行前经 `adminPolicy` 判定；匿名一律拒绝。
- **版本固定**：杜绝装到可变 tag/branch 被供应链投毒。
- **`--ignore-scripts`**：禁 npm 生命周期脚本 RCE。
- **子进程超时 + 非交互 env**：防止 `pi install` 挂起等待终端输入。

---

## 相关章节

- [02 · 核心概念](./02-core-concepts.md) — 双模式、会话、RPC 通道
- [03 · 系统架构](./03-architecture.md) — 分层与依赖方向
- [05 · 配置](./05-configuration.md) — settings.json 结构与覆盖逻辑
- [07 · Agent 开发](./07-agent-development.md) — `.pi/` 目录结构与 skill/extension 编写
- [10 · Web UI 扩展](./10-web-ui-extension.md) — agent source 的 `.pi/web` UI 控制层
- [13 · HTTP API 参考](./13-http-api-reference.md) — 完整端点与 SSE 帧格式
- [15 · 部署](./15-deployment.md) — 在自托管装配处注入扩展管理路由、沙箱隔离
- [18 · 故障排查 FAQ](./18-troubleshooting-faq.md) — `--no-skills` 不生效、`.pi/` 项目资源未加载等常见报错
