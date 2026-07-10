# 10 · 扩展、Skills 与 Prompt 模板

pi-web 把 pi 的扩展 / skills / prompt 模板能力，以**自动资源发现 + 两条安装车道（agent 回合内工具 + 受控 REST）+ 权限内联交互**的方式暴露给 Web 侧。本章覆盖资源自动发现与注入、扩展安装的两条车道与治理管线、信任策略、扩展 UI 子协议、斜杠命令面板，以及系统资源开关的正确用法。

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

除用户/项目自带资源外，pi-web 还经 runner 的 `forcedExtensionPaths` **强制注入每个会话**若干框架内置扩展（无需用户 agent 声明），其中就包括本章主角——扩展管理扩展（`extension-manager`，下文详述）。注入接线在 `lib/app/pi-handler.ts:380`（`PI_WEB_EXT_TOOLS_ENTRY` 经 spawn env 下发）。

> **动手验证**：要实测「项目级 `.pi/` 资源（扩展 / 子代理 / 技能）是否被正确加载」及 trust 门控行为，跑探针示例 `examples/pi-probe-agent`——它自带一组项目级 `.pi/` 探针资源（`extensions/agents/skills` 各一），以本目录为 `cwd` 运行后，观察 `pi_probe_ping` 工具、`/pi-probe` 命令与 `pi-probe-subagent` 子代理是否出现即可判定加载结果（不出现多半是 trust 未放行）。跑法与判定表见 `examples/pi-probe-agent/README.md`。

---

## 两条安装车道

安装一个扩展等同于**授予远程代码以完整系统权限执行**。pi-web 提供两条互补的安装车道，二者共用同一套来源白名单与管理员门控，装完都以「重解析资源、重启 runner」的方式对运行中的会话生效：

| 车道 | 触发方 | 入口 | 门控实现 |
|------|--------|------|---------|
| **agent 回合内**（当前主车道） | LLM 工具 / 用户斜杠命令 | `install_extension` 等工具 + `/plugin` / `/reload-runtime` 命令 | `gate.ts`（在 agent 子进程内） |
| **受控 REST** | 宿主 / 运维脚本 | `POST /extensions`、`DELETE /extensions/:extId` | `adminPolicy` + `source-allowlist.ts`（在主进程） |

两条车道的白名单逻辑同源：agent 侧 `packages/tool-kit/src/extension-tools/gate.ts` **移植**自 server 侧 `packages/server/src/extensions/install/source-allowlist.ts`（并以单测对齐防漂移）。两者的放行开关也是同一组 env（`PI_WEB_EXT_ADMIN_ALLOW_ANY` / `PI_WEB_EXT_ALLOW_LOCAL` / `PI_WEB_EXT_ALLOW_NPM`），装配在 `lib/app/pi-handler.ts` 一处读取后分别下发（REST 侧注入 `adminPolicy`、agent 侧经 spawn env 透传）。

> **⚠ 与旧版本文档的差异**：早期文档称 `/plugin` 是 harness 内置命令、选中即打开一个 `plugin-panel.tsx` 模态面板——该实现已从 main 删除。当前 pi-web **没有任何扩展管理前端面板**，安装/卸载/列出全部经 `ctx.ui`（状态栏 / 通知 / widget）呈现进度。`BUILTIN_COMMANDS` 现仅保留 `/clear`（`packages/tool-kit/src/commands/builtin.ts:22`）。

---

## 扩展管理 REST API

扩展管理路由由 `packages/server/src/extensions/routes.ts` 的 `createExtensionRoutes()` 导出，经 `createPiWebHandler` 的 `routes?` 注入接缝并入路由表，**不**修改 `http-api` 内部实现。

> **当前状态（截至 HEAD）：** `createExtensionRoutes` **已在 pi-web 自带宿主中无条件挂载**——装配点在 `lib/app/pi-handler.ts:517`，并注入了真实的 `reloadSession`（`reloadRunner` → `PiSession.restartRunner()`）。安装治理由 env 门控：默认沿用安全默认（管理员门控拒绝匿名/非管理员、白名单仅 `@pi-web`/`@earendil-works` npm scope + `github.com`、禁本地）；设 `PI_WEB_EXT_ADMIN_ALLOW_ANY=1` 后 pi-handler 注入 `adminPolicy: () => true` 放行安装（面向 dev / 单用户自托管，生产应改用真实 `adminPolicy`）。所有 handler 内部路由都挂在 `/api/**` 之下（见下文 curl 前缀）。

### 端点一览

| 方法 | 路径（相对 handler，实际含 `/api` 前缀） | 说明 | 鉴权要求 |
|------|------|------|---------|
| `GET` | `/extensions` | 列出已安装扩展（来源类型/版本/作用域） | 无强制管理员要求 |
| `GET` | `/sessions/:id/install-sources` | 按会话 cwd 浅扫可作 `local:` 源的目录（`/plugin` 子命令补全用） | 只读，无管理员门控 |
| `POST` | `/extensions` | 安装扩展（来源 → 白名单 → `pi install`） | **仅管理员** |
| `DELETE` | `/extensions/:extId` | 卸载扩展（`pi remove`） | **仅管理员** |
| `POST` | `/sessions/:id/reload` | 重载已有会话运行时以载入新扩展 | **仅管理员** |

> `DELETE /extensions/:extId` 的路径参数刻意命名为 `:extId`（非 `:id`），以避免与 http-api Router 的 `:id` 会话门控冲突。`GET /sessions/:id/commands`（斜杠命令面板数据源）归 `http-api` 拥有，扩展管理层仅在集成/e2e 中消费其输出，不实现该路由。

### 路由注册契约

`createExtensionRoutes` 与 `createPiWebHandler` 均从 `@blksails/pi-web-server` 主入口导出（该包**未**暴露 `@blksails/pi-web-server/extensions` 子路径）。pi-web 自带宿主的装配等价于：

```typescript
import { createExtensionRoutes, createPiWebHandler } from "@blksails/pi-web-server";

const handler = createPiWebHandler({
  // …manager / store / resolver / createChannel 等核心选项…
  routes: [
    // …其它注入路由…
    ...createExtensionRoutes({
      piCli,         // PiCli（默认 ChildProcessPiCli，唯一子进程 IO）— 必填
      store,         // SessionStore（reload 时检索会话）— 必填
      manager,       // SessionManager（reload 时重建运行时）— 必填
      adminPolicy,   // 可选；缺省 defaultAdminPolicy（默认拒绝）。pi-web 在 PI_WEB_EXT_ADMIN_ALLOW_ANY=1 时注入 () => true
      allowlist,     // 可选；缺省 DEFAULT_ALLOWLIST，可经 PI_WEB_EXT_ALLOW_LOCAL/NPM 放宽
      reloadSession, // 可选；pi-web 注入 reloadRunner（缺省 defaultSessionReloader 以 501 拒绝）
      // onAudit / trustPolicy / piInstallTimeoutMs 亦可选
    }),
  ],
});
```

> `ExtManagementOptions`（`packages/server/src/extensions/ext.types.ts`）中 `piCli` / `store` / `manager` 为必填，其余均有显式默认。**缺省的 `defaultSessionReloader` 会以 `501 RELOAD_NOT_CONFIGURED` 拒绝**——只有第三方在别处装配 `createExtensionRoutes` 而不注入 `reloadSession` 时才会命中；pi-web 自带宿主已注入真实实现。

---

## 安装治理管线（REST 侧）

`POST /extensions` 在执行 `pi install` **之前**完成所有拒绝决策：

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

### 来源白名单

默认白名单定义于 `packages/server/src/extensions/install/source-allowlist.ts:24`（agent 侧 `gate.ts` 移植同一份）：

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
| local | `local:/abs/path` | 无（需 `allowLocal: true`，即 `PI_WEB_EXT_ALLOW_LOCAL=1`） |

任意裸 `http(s)://` URL、未列入白名单的 npm scope 或 git host，均在执行 `pi install` **之前**被拒绝。设 `PI_WEB_EXT_ALLOW_NPM=1` 可放行任意 npm 包（含无 scope），但仍强制精确版本固定。

---

## agent 回合内的扩展管理（extension-manager）

这是当前的主安装车道。扩展管理扩展 `extension-manager`（`packages/tool-kit/src/extension-tools/extension-manager.ts`）经 `forcedExtensionPaths` 强制注入**每个**会话，在 agent 子进程内向 agent 提供三样能力，全部经 pi 原生 `ctx.ui`（`setStatus` 状态栏 / `notify` 通知 / `setWidget` widget）呈现进度，**无任何前端面板**：

| 能力 | 名称 | 触发方 | 说明 |
|------|------|--------|------|
| LLM 可调工具 | `install_extension` / `uninstall_extension` / `list_extensions` | 模型（自然语言「装个 X」） | 装/卸完后排队 `/reload-runtime` 应用 |
| 用户向命令 | `/plugin <install\|uninstall\|list>` | 用户经斜杠补全面板 | 子命令式；handler 直接 `ctx.reload()` |
| reload 命令 | `/reload-runtime` | 工具装完排队触发，或用户手动 | 重解析扩展/skills/prompts/themes |

### 为什么工具和命令用两种 reload 路径

关键约束来自 pi SDK：**工具**的 `ctx` 是 `ExtensionContext`，**不能**直接 `ctx.reload()`（会死锁），故 `install_extension` 装完调 `pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" })` 把 reload 排成 follow-up 命令；**命令**的 `ctx` 是 `ExtensionCommandContext`，可直接 `ctx.reload()`，一步到位。装包统一用 `pi.exec("pi", ["install", …])`（pi 未暴露 in-process 包管理 API），落到当前会话 agent 的配置目录（由子进程 env 决定，不污染真实 `~/.pi`）。

### 门控（gate.ts）

装包前经 `gateInstall(source)` 做与 REST 侧一致语义的门控，读同一组 env：

- `PI_WEB_EXT_ADMIN_ALLOW_ANY=1` → 放行安装/卸载（`allowMutate`；缺省关闭，全拒并提示「安装被禁用（需配置 PI_WEB_EXT_ADMIN_ALLOW_ANY=1）」）
- `PI_WEB_EXT_ALLOW_LOCAL=1` → 放行 `local:<path>` 源
- `PI_WEB_EXT_ALLOW_NPM=1` → 放行任意 npm 包（仍强制精确版本）

### 可运行范例

以用户身份，在斜杠命令面板输入以下命令。因 `@blksails` **不在**默认白名单 scope（默认仅 `@pi-web`/`@earendil-works`，见上文「来源白名单」），除放行安装的 `PI_WEB_EXT_ADMIN_ALLOW_ANY=1` 外，还需设 `PI_WEB_EXT_ALLOW_NPM=1`（放行任意 npm scope，仍强制精确版本）再启动 pi-web，否则该源会在门控处被拒（`422`/agent 侧提示非白名单）：

```
/plugin install npm:@blksails/code-review@2.0.0
```

预期：状态栏出现「安装中: npm:@blksails/code-review@2.0.0…」，成功后通知「已安装: …（应用中…）」，随即 `ctx.reload()` 使新扩展的工具/命令生效。裸 `/plugin`（无子命令）默认列出已装扩展（非模态 widget）。也可让模型自然语言触发工具，例如对 agent 说「帮我装一下 code-review 扩展」，模型会调用 `install_extension`。可跑样板见 `examples/plugin-code-review-agent/`（双角色）与 `examples/plugin-consumer-agent/`（消费方）。

---

## 安装后生效：新会话 vs reload

安装完成后，扩展写入目标会话 agent 的配置（视 `-l` 与否落项目 `.pi/settings.json` 或全局 `settings.json`）：

1. **新建会话**（`POST /api/sessions`）— 会话 spawn 时自动加载，无需额外操作。
2. **已有会话** — 需触发 reload：agent 车道走 `/reload-runtime`（`ctx.reload()` / follow-up）；REST 车道走 `POST /api/sessions/:id/reload`。两者底层都是 `PiSession.restartRunner()` 重 spawn runner 续会话、重解析资源。

```bash
# 约定本地自托管入口为 http://localhost:3000（按实际部署替换）。
# handler 挂载在 /api/** 之下（server/index.ts:75 app.all('/api/*')），故内部路由都要带 /api 前缀。
# 安装/卸载/reload 均要求管理员鉴权（或已设 PI_WEB_EXT_ADMIN_ALLOW_ANY=1），请按 adminPolicy 附带相应凭据头。
# 下例源 @blksails 非默认白名单 scope，需同时设 PI_WEB_EXT_ALLOW_NPM=1，否则命中 422（非白名单）。

# 1. 安装扩展（管理员）
curl -X POST http://localhost:3000/api/extensions \
  -H "Content-Type: application/json" \
  -d '{"source": "npm:@blksails/code-review@2.0.0"}'
# 预期成功：200 + { "ok": true, ... }；被拒来源：422；非管理员：403/401

# 2. 让已有会话 <sessionId> 重载以生效（管理员）
curl -X POST http://localhost:3000/api/sessions/<sessionId>/reload
# 预期成功：{ "ok": true, "reloaded": "<sessionId>" }
# 若宿主未注入 reloadSession：501 RELOAD_NOT_CONFIGURED（pi-web 自带宿主已注入，不会命中）
```

> 状态码语义：`422`=来源不在白名单/未固定版本，`501`=宿主未注入 `reloadSession`，`403/401`=未通过 `adminPolicy`。系统资源开关 `--no-skills` 不生效、`.pi/` 项目资源未加载等问题的排查见 [23 · 故障排查 FAQ](./23-troubleshooting-faq.md)。

---

## 信任策略落地

项目 `.pi/` 目录下的 skills/extensions/prompts 是否被加载取决于 `trustPolicy` 的返回值（消费 `agent-source-resolver` 决策，不重定义）：

`landTrust(source, mode, trustPolicy)`（`packages/server/src/extensions/install/trust-landing.ts`）调用 `trustPolicy(source)` 得到 `TrustDecision`，再经 `applyTrust(mode, decision)`（`packages/server/src/agent-source/trust-apply.ts`）映射为 spawn 片段：

| `trustPolicy` 返回 | CLI 模式 | custom 模式 |
|------------------|---------|------------|
| `"always"` | `extraArgs += ["--approve"]` | `extraEnv.PI_WEB_TRUST_PROJECT="1"`（runner `startRunner` 读取后设 `makeResolveProjectTrust(true)`） |
| `"never"` | `extraArgs += ["--no-approve"]` | 不传放行信号 |
| `"ask"`（默认） | 无信任标志 | 不传放行信号 |

`"ask"`/`"never"` 下 headless 安全忽略 `.pi/` 项目资源（无 TTY 无法交互批准）。任何取值都**不抑制** `AGENTS.md`/`CLAUDE.md` context 文件及全局/用户扩展的加载。

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
前端 useExtensionUI（@blksails/pi-web-react）
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

**交互类型与回传负载**（应答经 `respond(requestId, response)`，`response` 为 `UiResponseRequest`=`RpcExtensionUIResponse`，统一带 `type: "extension_ui_response"` 与 `id`，schema 见 `packages/protocol/src/rpc/extension-ui.ts:85`）：

| 请求 method | 回传判别负载 |
|--------|---------|
| `confirm` | `{ confirmed: true/false }` |
| `select` | `{ value: "<选项>" }` |
| `input` | `{ value: "<输入文本>" }` |
| `editor` | `{ value: "<编辑器文本>" }` |
| 取消（select/input/editor） | `{ cancelled: true }` |

> 推送类请求（`notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text`）**不入** `extensionUiQueue`（无需回包），而是写入 `ControlStore` 的 ambient 切片（通知 / 状态 / widget / 一次性写输入框），避免阻塞交互对话框（见 `packages/react/src/sse/control-store.ts`）。

### setTitle 的两面：瞬态展示 + 持久化会话名

`setTitle` 除了驱动前端瞬态 `ambient.title`，还额外落到会话名。runner 装配 `wireSessionTitlePersistence`（`packages/server/src/runner/session-title-wiring.ts`）以 **prototype-patch `session.bindExtensions`** 把 `uiContext.setTitle` 包装为「先调原 setTitle（保留 ambient 帧展示）→ 再 best-effort `persistTitle(title)` 写会话名（`appendSessionInfo`）」。两者各自 try/catch、互不影响。效果：扩展（如自动标题扩展）设置的标题会出现在「会话历史」列表，且冷恢复后保留（见 [14 · 会话列表](./14-sessions-list.md)）。

---

## 斜杠命令面板（slash-command-palette）

`/` 命令补全由 `PiCommandPalette`（`packages/ui/src/controls/pi-command-palette.tsx`）实现，经 `PiChat` 装配层接线：

1. 输入框值以 `"/"` 开头 → 进入命令模式，渲染命令补全浮层（`absolute bottom-full z-40`）。
2. 候选来源：`controls.getCommands()` 拉取（底层 `PiSession.getCommands()`），产出 `RpcSlashCommand[]`（schema 见 `packages/protocol/src/rpc/session-state.ts:49`：`{ name, description?, source: "extension"|"prompt"|"skill"|"builtin", sourceInfo }`）。
3. 选中命令 → 填充 `"/<name> "`（尾随空格待补参），不立即发送。
4. 命令模式下 Enter 让位给浮层选中（`suppressEnterSubmit`），Shift+Enter 仍换行。

**命令数据源（`GET /sessions/:id/commands`，归 `http-api`，实际路径含 `/api` 前缀）：**

```bash
curl http://localhost:3000/api/sessions/<sessionId>/commands
# 返回 { commands: [{ name: "my-skill", description: "...", source: "skill", sourceInfo: { … } }, …] }
```

命令面板仅消费该端点输出，不在前端解析或展开——斜杠文本经 `sendMessage` 原样发出，由 pi 后端识别并展开。

### 扩展命令的执行语义：fire-and-forget

`source: "extension"` 的命令（agent 经 `registerCommand` 注册，如 `/plugin`、`/img_vision`、`/reload-runtime`）在 web 端**不走** `useChat` 的常规回合，而是经 `client.prompt` **fire-and-forget** 直接投递（`components/chat-app.tsx:233`、`packages/ui/src/chat/pi-chat.tsx:968`）。原因：这类命令不产生用户气泡、也不会等到 `finish` 帧，若走常规回合会永久卡 `busy`。代价是它们**不进消息历史、不卡 pending**，结论只经 `ctx.ui`（notify / widget）呈现。为承载 fire-and-forget 命令的 `ctx.ui` 反馈，前端会先点亮一个扩展命令控制窗口（`extCtrlActive`），再投递命令。

> 平台默认隐藏 `source: "extension"` 命令（防 busy 卡死的历史安全网，现已由 fire-and-forget 修复）。统一插件可经 `pi-plugin.json` 的 `web.commands` 显式 opt-in 其命令默认可见（见下文「统一插件包标准」）。

---

## 内置命令层（`source: "builtin"`）

除 agent 注册的命令（`source: extension|prompt|skill`，选中即作 prompt 发给 LLM）外，harness 还提供一层**内置命令**（`source: "builtin"`），它**执行 harness 逻辑、不进 LLM**。

- 内置命令以纯声明形式定义在 tool-kit 的前端安全子入口：`@blksails/pi-web-tool-kit/commands`（`BuiltinCommandSpec` / `BUILTIN_COMMANDS`）。当前 `BUILTIN_COMMANDS` **仅含 `/clear`**（`packages/tool-kit/src/commands/builtin.ts:22`）。
- 前端合流：`mergeBuiltinCommands` 把内置命令映射为 `RpcSlashCommand{ source:"builtin" }`，**追加在 agent 命令之后**、同名以内置优先。命令面板对内置命令渲染「内置」徽标（`data-pi-command-source="builtin"`）。
- 执行分派：选中 `builtin` 命令调 `onBuiltinSelect`，按 `target`（`client` / `server-action` / `ui-surface`）执行 harness 逻辑并**清空输入、不发送**。

`/clear` 是唯一范例（`target: server-action`）：既清 agent 上下文（server 经 `new_session`），又清前端聊天视图（UI effect: clear-transcript），使「视觉」与「上下文」一致，覆盖 agent 自带的同名 `/clear`。

> 历史上曾有一个 `/plugin` 内置命令 + 模态面板方案，已从 main 删除；扩展安装现由上文「agent 回合内的扩展管理」承担。

---

## 系统资源开关（`--no-skills` / `--no-extensions`）

Settings UI「设置 → 扩展 → 系统资源」提供两个独立开关：

| 开关 key | 关闭时注入参数 | 效果 |
|---------|-------------|------|
| `loadSystemSkills` | `--no-skills` | 新建会话不载入系统/包/内置 skills（斜杠面板无 `/skill:*`） |
| `loadSystemExtensions` | `--no-extensions` | 新建会话不载入系统/包 extensions（沙箱及 `forcedExtensionPaths` 强制注入路径不受影响） |

注入链路（`lib/app/system-resource-args.ts:50`）：

```
settings.json (project <cwd>/.pi/settings.json 逐键覆盖 global <agentDir>/settings.json)
  → systemResourceArgs(agentDir, cwd)            # lib/app/system-resource-args.ts:50
  → ["--no-skills"] / ["--no-extensions"]（各自独立，仅显式 false 触发）
  → assemble-spawn → runner argv
  → parseRunnerArgs                              # packages/server/src/runner/runner.ts:88（--no-skills 分支:129）
  → RunnerArgs.noSkills / noExtensions
  → mapResourceLoaderOptions                     # packages/server/src/runner/option-mapper.ts:97
  → resourceLoaderOptions.skillsOverride = ({ diagnostics }) => ({ skills: [], diagnostics })   # :191
  → resourceLoaderOptions.noExtensions = true    # :199
```

> **历史 Bug（已修）：** `parseRunnerArgs` 曾静默丢弃 `--no-skills`/`--no-extensions`，custom 模式开关完全无效。spec `system-resource-toggle-fix` 已在 runner 侧补齐识别逻辑，证据落 `.kiro/specs/system-resource-toggle-fix/evidence/`。

**重要：** 仅影响**新建会话**，不支持运行中会话的运行时热切换。

---

## 审计记录（REST 车道）

`POST /extensions` / `DELETE /extensions/:extId` 的每次操作（包括被拒绝的安装请求）均产生一条审计记录，字段：

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

- **扩展安装 = RCE**：生产部署须在沙箱/容器环境内启用安装能力（沙箱实现归生产硬化，本层仅留接缝）。默认 `PI_WEB_EXT_ADMIN_ALLOW_ANY` 未设时，两条车道的 mutate 均被拒。
- **管理员门控**：REST 车道安装/卸载/reload 在任何子进程执行前经 `adminPolicy` 判定；匿名一律拒绝。
- **版本固定**：杜绝装到可变 tag/branch 被供应链投毒（npm 精确 semver、git pinned ref）。
- **`--ignore-scripts`**（REST 车道）：禁 npm 生命周期脚本 RCE。
- **子进程超时 + 非交互 env**：防止 `pi install` 挂起等待终端输入。
- 改注入路由后 dev 必须重启（handler 单例 pin 在 `globalThis`）。

---

## 统一插件包标准（plugin-system-unification）

pi-web 把 **pi 原生 extension（CLI 标准）** 与 **webext（5 层 web UI 扩展）** 收口为一个
**扁平于两层的插件包标准**：一个包用一份 `pi-plugin.json` 同时声明两层入口，零改动复用
pi extension，并让「安装即时双路生效」。

### `pi-plugin.json` 清单（单一事实来源）

放在包根，声明同一逻辑插件的两层入口；**缺失时回退既有目录约定**（向后兼容）：

```jsonc
{
  "id": "code-review",            // 逻辑插件标识（两层共享）
  "version": "1.0.0",
  "pi": {                          // 第一层：pi 原生资源（沿用 DefaultPackageManager 目录约定）
    "extensions": ["extensions/code-review.ts"],
    "skills": ["skills/code-review"]
  },
  "web": { "dist": ".pi/web/dist" },        // 第二层：webext 产物（沿用 .pi/web/dist 约定）
  "bindings": { "tools": ["code_review"] }  // 两层契约锚点（见下）
}
```

解析器 `resolvePiPlugin`（`packages/server/src/plugin/resolve-plugin.ts`）据清单合成
`PluginDescriptor`；清单字段非法/产物缺失降级为 `diagnostics`，**不使整包失败**，无清单则
回退扫包根 `extensions/`/`skills/`/`prompts/`/`themes/` + 探测 `.pi/web/dist`。

### 两层契约锚点：工具名

`bindings.tools` 声明哪些 pi 工具由 webext 接管渲染。**工具名是两层咬合的锚点**：
pi 侧 `registerTool("code_review")` 产出的 `tool-code_review` part，由 webext
`renderers.tools.code_review` 接管渲染成富卡——同一能力，agent 出数据、web 出 UI，零胶水。

### 声明 web 可见 slash 命令（`web.commands`）

平台默认隐藏 `source:"extension"` 命令（防 busy 卡死的历史安全网；busy 已由 fire-and-forget 修复）。
统一插件可在 `pi-plugin.json` 的 `web.commands` 显式 opt-in 其命令默认可见：

```jsonc
{ "web": { "dist": ".pi/web/dist", "commands": ["review"] } }
```

服务端 `GET /sessions/:id/commands` 据命令 `sourceInfo` 解析其插件清单，对 `web.commands` 命中的命令
回填 `webVisible:true`；前端补全对 `webVisible` 命令**默认放行**（无需 `NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST`），
未声明的扩展命令仍默认隐藏（安全网不变）。

> 注：项目级 `.pi/extensions` 仍需 **trust** 才加载（与可见性无关）——dev 经 `PI_WEB_TRUST_PROJECT=1`
> 或建会话传 `trust:true`，见「信任策略落地」。

### 双角色：agent source 兼作插件提供源

同一仓库可同时满足两种发现场景，统一清单指向**单一真身**消除重复：

| 场景 | 发现 origin | 资源路径 | webext 车道 |
|------|------------|---------|------------|
| 自运行（作为 agent source） | `top-level` | `<cwd>/.pi/extensions` | 构建期集成 |
| 被安装（作为插件包） | `package` | 包根 `extensions/` | 运行时 `.pi/web/dist` |

`.pi/extensions/x.ts` 薄转发到包根 `extensions/x.ts`，避免维护两份。可跑样板见
`examples/plugin-code-review-agent/`（双角色）与 `examples/plugin-consumer-agent/`（消费方）。

### 装完即时双路生效

`/plugin install <source>`（或 `/reload-runtime`）完成后**并行触发两路**、互不阻塞：

- **路①（pi 资源）**：runner reload（`SessionReloader` / `restartRunner`）使工具/命令生效；
- **路②（webext）**：前端 `webextReloadNonce` bump → 经 `/api/webext/resolve` 重解析加载，
  富卡渲染器生效。

编排逻辑由 `runInstallEffects`（`packages/server/src/plugin/effect-orchestrator.ts`）按 `PluginDescriptor` 分派：
仅 pi / 仅 webext / 双层三分支，任一路失败不阻断另一路（仅含一层时另一路安全空转）。

> webext 浏览器侧加载、验签、运行时车道见 [12 · Web UI 扩展](./12-web-ui-extension.md#webext-包安装与运行时加载webext-package-install)。

---

## 相关章节

- [02 · 核心概念](./02-core-concepts.md) — 双模式、会话、RPC 通道
- [03 · 系统架构](./03-architecture.md) — 分层与依赖方向
- [06 · 配置](./06-configuration.md) — `settings.json` 结构、覆盖逻辑与 `PI_WEB_EXT_*` 门控 env
- [08 · Agent 开发](./08-agent-development.md) — `.pi/` 目录结构与 skill/extension 编写
- [11 · AIGC 与视觉工具](./11-aigc-and-vision-tools.md) — `/img_vision` 等扩展命令的实例
- [12 · Web UI 扩展](./12-web-ui-extension.md) — agent source 的 `.pi/web` UI 控制层
- [14 · 会话列表](./14-sessions-list.md) — `setTitle` 持久化后的会话名来源
- [24 · HTTP API 参考](./24-http-api-reference.md) — 完整端点与 SSE 帧格式
- [23 · 故障排查 FAQ](./23-troubleshooting-faq.md) — `--no-skills` 不生效、`.pi/` 项目资源未加载等常见报错
