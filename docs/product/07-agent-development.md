# 07 · 自定义 Agent 开发指南

本章说明如何从零编写一个可被 pi-web runner 载入的自定义 agent，覆盖入口契约、工具定义、模型继承、examples 目录索引和开发期热重载。

---

## 核心概念

pi-web 的 agent 以**一个 TypeScript/JavaScript 文件**（`index.ts`）为载体，其 `default export` 必须是以下三种形态之一：

| 形态 | 说明 |
|------|------|
| (a) `AgentDefinition` 对象 | 最常见；`defineAgent({...})` 直接返回 |
| (b) `(ctx: AgentContext) => AgentDefinition \| Promise<AgentDefinition>` 工厂 | 需要读取运行时环境时使用 |
| (c) 带 `RUNTIME_FACTORY_BRAND` 标记的 `CreateAgentSessionRuntimeFactory` | 高级用法，绕过归一化层，自建运行时 |

Runner bootstrap（`packages/server/runner-bootstrap.mjs`）通过 jiti 载入 `index.ts`，经 `loadAgentDefinition`（`packages/server/src/runner/agent-loader.ts`）归一化为统一的运行时工厂，再调用 `createAgentSessionRuntime` 构建会话，最后进入 `runRpcMode` 持续处理 RPC 调用。

---

## `@pi-web/agent-kit`

包路径：`packages/agent-kit/src/index.ts`

`@pi-web/agent-kit` 是**零运行时强依赖**的轻量辅助包：

- **`defineAgent(def)`** — 恒等函数，仅用于编译期类型推断，运行时原样返回入参。不用此包写出的等价 `AgentDefinition` 对象同样能被 runner 载入。
- **`defineMinimalAgent(overrides?)`** — 在 `minimalAgentPreset`（`noTools: "all"` + 空 skills + `allowExtensions: []`）之上浅合并作者覆盖，一行得到零能力基线。
- **`emitUi(onUpdate, spec)`** — 在工具 `execute` 内发出 `UiSpec`，触发 server-driven UI 渲染。
- 类型导出：`AgentDefinition`、`AgentContext`、`AgentModel`、`ToolDefinition`、`AttachmentToolContext` 等（均为纯类型，无值依赖）。

```ts
import { defineAgent } from "@pi-web/agent-kit";
```

---

## `AgentDefinition` 字段速查

来源：`packages/agent-kit/src/types.ts`

| 字段 | 类型 | 说明 |
|------|------|------|
| `model` | `AgentModel \| undefined` | 省略 → 继承 `~/.pi/agent/settings.json` 的 `defaultProvider/defaultModel` |
| `thinkingLevel` | `ThinkingLevel \| undefined` | 推理力度 |
| `systemPrompt` | `string \| (() => string) \| undefined` | 系统提示；可为惰性 thunk |
| `customTools` | `ToolDefinition[]` | 自定义工具列表 |
| `tools` | `string[]` | 内置/扩展工具名许可名单 |
| `excludeTools` | `string[]` | 工具排除名单（在 `tools` 之后应用） |
| `noTools` | `"all" \| "builtin"` | `"builtin"` 关闭内置工具集（保留 custom/extension）；`"all"` 全关 |
| `extensions` | `Array<string \| ExtensionFactory>` | 追加加载的扩展（路径或工厂） |
| `allowExtensions` | `string[] \| undefined` | 系统扩展许可名单；`[]` = 关闭所有磁盘发现的系统扩展 |
| `skills` | `SkillsOverride \| undefined` | 覆盖 hook，接收已发现的 skill 集并返回过滤后的集合 |
| `promptTemplates` | `PromptsOverride \| undefined` | 覆盖 hook |
| `contextFiles` | `AgentsFilesOverride \| undefined` | 覆盖 AGENTS.md/CLAUDE.md 发现结果 |
| `scopedModels` | `Array<{model, thinkingLevel?}>` | 运行时可切换的模型列表 |

---

## 完整可运行范例

### hello-agent（推荐入门参考）

来源：`examples/hello-agent/index.ts`

```ts
import { defineAgent } from "@pi-web/agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

// 自定义工具：echo
const echo = defineTool({
  name: "echo",
  label: "Echo",
  description: "Echo the provided text back to the caller.",
  parameters: Type.Object({
    text: Type.String({ description: "Text to echo back." }),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: params.text }],
      details: undefined,
    };
  },
});

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的 defaultProvider/defaultModel
  systemPrompt: "You are hello-agent, a minimal pi-web example agent.",
  customTools: [echo],
  noTools: "builtin",          // 关闭内置工具集，仅保留 echo
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }), // 清空系统 skills
});
```

**关键要点：**

1. `defineTool` 来自 `@earendil-works/pi-coding-agent`，`Type` 来自 `@earendil-works/pi-ai`，runner 会通过 jiti alias 自动解析这两个包，无需在 agent 目录安装依赖。
2. `model` 字段省略时 runner 从 `~/.pi/agent/settings.json` 读取 `defaultProvider` 与 `defaultModel`，凭据从 `~/.pi/agent/auth.json` 解析，开箱即用于任意 pi 账号。
3. 如需固定模型，添加 `model: { provider: "anthropic", modelId: "claude-opus-4-5" }`，但对应 provider 必须有有效凭据。

### 最小基线（defineMinimalAgent）

来源：`examples/minimal-agent/index.ts`

```ts
import { defineMinimalAgent } from "@pi-web/agent-kit";

export default defineMinimalAgent({
  // model 省略 → 继承配置
  systemPrompt: "You are minimal-agent, a zero-capability pi-web baseline example.",
  // noTools: "all" + 空 skills + allowExtensions: [] 由 preset 提供，无需重复声明
});
```

### 工厂形态（shape b）

当 agent 需要读取运行时环境（如 `cwd`、`env`）时，使用工厂函数：

```ts
import { defineAgent } from "@pi-web/agent-kit";
import type { AgentContext } from "@pi-web/agent-kit";

export default async function (ctx: AgentContext) {
  const apiKey = ctx.env["MY_API_KEY"];
  return defineAgent({
    systemPrompt: `Working directory: ${ctx.cwd}`,
    customTools: apiKey ? [buildMyTool(apiKey)] : [],
  });
}
```

`AgentContext` 提供：
- `ctx.cwd` — runner 的有效工作目录
- `ctx.agentDir` — 全局 agent 配置目录（通常 `~/.pi/agent`）
- `ctx.env` — 进程环境快照

---

## examples/ 目录索引

仓库路径：`examples/`

| 子目录 | 一句话说明 |
|--------|-----------|
| `hello-agent` | 最小完整范例：自定义 `echo` 工具 + 系统提示，关闭内置工具集 |
| `minimal-agent` | 零能力基线：`defineMinimalAgent` preset，noTools/skills/extensions 全关 |
| `aigc-agent` | 装配 `buildAigcTools()`（`image_generation` / `image_edit`），演示 AIGC 工具 + 附件接缝 |
| `attachment-tool-agent` | 演示 attachment-tool-bridge：自定义图像工具经 `AttachmentToolContext` 将产物落 attachment store |
| `builtin-tools-agent` | 启用 pi 内置工具集（与 hello-agent 的 `noTools: "builtin"` 相反的姿态） |
| `file-session-agent` | 配合文件存储会话演示的最小 agent（session 存储是运行时配置，不在 AgentDefinition 中） |
| `pi-probe-agent` | 探针 agent，用于验证 `.pi/` 项目级资源（extensions/skills）被正确发现和加载 |
| `server-driven-ui-agent` | 在工具 `execute` 内调用 `emitUi(onUpdate, spec)` 发出 `UiSpec`，前端零配置渲染 |
| `system-status-agent` | 组合 server-driven UI + ambient 状态/通知，一个工具同时演示两条链路 |
| `ui-demo-agent` | 演示 extension UI 全部交互 surface（`ctx.ui.*`：状态推送、ambient 通知等） |
| `webext-artifact-agent` | Tier 4 artifact 隔离表面示例，`.pi/web` 声明 artifact 入口，宿主在沙箱 iframe 渲染 |
| `webext-background-agent` | Tier 1 背景插槽示例：`.pi/web` WebExtension 渲染动画背景层（`background` 区域） |
| `webext-contrib-agent` | Tier 3 贡献点示例：slash / @mention，经 ui-rpc 回 agent 取候选 |
| `webext-declarative-agent` | Tier 5 纯声明示例：`.pi/web/manifest.json` 内联 theme token + layout，零代码 UI 扩展 |
| `webext-layout-agent` | Tier 1 区域插槽示例：填充 `panelRight` 与 `headerCenter` 区域 |
| `webext-renderer-agent` | Tier 2 渲染器示例：注册自定义 `data-metric` data-part 渲染器 + `echo` 工具 |
| `webext-slots-agent` | 验收 fixture：声明全部 18 个协议保留插槽（`SlotKeySchema`），验证宿主已为各插槽接线 `SlotHost` |

---

## 开发期热重载

**背景**：runner 是 per-session 常驻子进程，经 jiti 在进程内只 import 一次 agent 入口。修改 `packages/tool-kit/src` 后，已存在会话的 runner 仍跑旧代码，需开新会话才生效。

**启用方式**：

```bash
# 开发模式下开启热重载
PI_RUNNER_HOT_RELOAD=1 pnpm dev
```

或通过 CLI 的 `--watch` 标志（任何环境均可，不受 `NODE_ENV` 门控）。注意二者监视目标不同：`PI_RUNNER_HOT_RELOAD=1` 默认监视 `packages/tool-kit/src`（适合改工具源码），而 `--watch <source>` 注入 `PI_WEB_WATCH=1` + `PI_RUNNER_HOT_RELOAD_PATHS=<source>`，监视的是你传入的 agent source 目录（适合改 agent 自身的 `index.ts`；git 来源无本地目录会跳过监视）：

```bash
pi-web --watch /path/to/my-agent
```

**机制**（来源：`packages/server/src/rpc-channel/hot-reload.ts:24`、`bin/pi-web.mjs:138`）：

1. `isHotReloadEnabled()` 检查 `PI_WEB_WATCH=1`（`--watch` 注入）或 `NODE_ENV !== production && PI_RUNNER_HOT_RELOAD=1`。
2. 启用后，`registerForHotReload(target)` 监视目录：默认 `packages/tool-kit/src`，可经 `PI_RUNNER_HOT_RELOAD_PATHS` 覆盖（`--watch` 即以此把目标改为 agent source 目录）；防抖 200 ms，仅响应 `.ts/.tsx/.js/.mjs/.cjs/.json` 变更。
3. 源码变更时对所有已注册的 `PiRpcProcess` 调用 `requestRestart()`，runner 在**空闲时**（无待决命令）重启子进程。
4. 新进程全新 jiti 实例重读源码；会话 id 经 `spawnSpec` 复用，新 runner 从持久化 jsonl **续上对话**，无需用户重新开始会话。

**自定义监视目录**：

```bash
PI_RUNNER_HOT_RELOAD=1 \
PI_RUNNER_HOT_RELOAD_PATHS=/abs/path/to/my-tools,/abs/path/to/another-dir \
pnpm dev
```

`PI_RUNNER_HOT_RELOAD_PATHS` 接受逗号分隔的绝对路径列表，覆盖默认的 `packages/tool-kit/src`。

---

## Bootstrap 流程

```
pi-web 后端进程
  └─ spawn node runner-bootstrap.mjs
       --agent <entry>  --cwd <work>  [--agent-dir <dir>]  [--session-id <id>]
         │
         ├─ createJiti(here)              # jiti 根锚定在 @pi-web/server 包目录
         ├─ jiti.import("src/runner/runner.ts")
         └─ runner.ts: main(argv)
              ├─ parseRunnerArgs(argv)    # 解析 --agent / --cwd / --agent-dir 等
              ├─ loadAgentDefinition(agent, ctx, trust)
              │    ├─ jiti.import(agentPath)  # 载入 index.ts（形态 a/b/c）
              │    └─ buildRuntimeFactory(def) # 归一化为统一运行时工厂
              ├─ createAgentSessionRuntime(factory, {cwd, agentDir, sessionManager})
              ├─ wireAttachmentBridge(runtime)  # attachment-tool-bridge 装配
              └─ runRpcMode(runtime)       # 进入 RPC 循环，永不返回
```

关键源文件：

- `packages/server/runner-bootstrap.mjs` — 启动器，纯 ESM，无需 jiti 启动自身
- `packages/server/src/runner/runner.ts` — `main()` / `startRunner()` / `parseRunnerArgs()`
- `packages/server/src/runner/agent-loader.ts` — `loadAgentDefinition()`，三种形态归一化
- `packages/server/src/runner/option-mapper.ts` — `buildRuntimeFactory()`，`AgentDefinition` → SDK 调用

---

## 开发步骤

从空目录到跑通一个自定义 agent，端到端如下。每步都给出预期结果，便于独立验证。

1. **创建 agent 目录**，在其中新建 `index.ts`：

   ```bash
   mkdir -p /path/to/my-agent
   ```

2. **声明 `AgentDefinition`**，至少提供 `systemPrompt`：

   ```ts
   // /path/to/my-agent/index.ts
   import { defineAgent } from "@pi-web/agent-kit";
   export default defineAgent({
     systemPrompt: "You are my custom agent.",
   });
   ```

   省略 `model` 时继承 `~/.pi/agent/settings.json` 的默认 provider/model，凭据由 `~/.pi/agent/auth.json` 解析——只要本机已登录 pi，无需额外配置。

3. **启动 pi-web 指向该目录**，最简方式是 CLI（`PI_WEB_AUTOSTART=1` 会直接进会话、跳过选源页）：

   ```bash
   pi-web /path/to/my-agent
   ```

   **预期结果**：终端打印就绪日志后自动打开浏览器，进入对话页；输入一句话能收到模型回复。也可在 pi-web 界面的选源页手动指向该目录。

4. **添加自定义工具**：使用 `defineTool`（`@earendil-works/pi-coding-agent`）+ `Type`（`@earendil-works/pi-ai`），加入 `customTools` 数组（写法见上文 hello-agent 范例）。
   **验证**：重开会话后向 agent 提需要该工具的问题，工具气泡出现即生效。
5. **调整工具开关**：
   - `noTools: "builtin"` — 关闭内置工具，只保留 `customTools` 和 `.pi/extensions` 工具。
   - `noTools: "all"` — 全关，等价于 `minimalAgentPreset` 的工具姿态。
   - 省略 `noTools` — 保持默认内置工具集。
6. **开启热重载**（修改 tool-kit 源码时）：设置 `PI_RUNNER_HOT_RELOAD=1`；改 agent 自身 `index.ts` 则用 `pi-web --watch /path/to/my-agent`。改动会在 runner 空闲时自动重启并续上会话，无需手动开新会话。

**常见报错对策**：

| 现象 | 多半原因 | 对策 |
|------|---------|------|
| `module has no default export` | `index.ts` 没有 `export default` 或导出了仅命名导出 | 确认默认导出是 `AgentDefinition` 对象 / 工厂 / 带 brand 的工厂 |
| 模型调用 401 / 鉴权失败 | 显式 `model` 指定的 provider 无有效凭据 | 删掉 `model` 改用默认，或补好该 provider 的 auth，详见 [18 · 故障排查 §2.1](./18-troubleshooting-faq.md) |
| 改了代码不生效 | runner 是常驻子进程、只 import 一次 | 开热重载（见步骤 6）或手动开新会话 |

更多排查见 [18 · 故障排查 FAQ](./18-troubleshooting-faq.md)。

---

## 相关链接

- [02 · 核心概念](02-core-concepts.md) — AgentDefinition、runner、会话模型
- [03 · 架构](03-architecture.md) — runner 子进程隔离与 RPC 通道
- [09 · 扩展与 Skills](09-extensions-and-skills.md) — `extensions` / `allowExtensions` / `skills` 字段详解
- [10 · Web UI 扩展（WebExtension）](10-web-ui-extension.md) — `.pi/web` Tier 1–5 UI 扩展体系
- [11 · AIGC 工具](11-aigc-tools.md) — `buildAigcTools()` 与 aigc-agent 接入范式
- [08 · 附件系统](08-attachment-system.md) — `AttachmentToolContext` 与 attachment-tool-bridge
- [14 · CLI](14-cli.md) — `pi-web --watch` 与命令行参数
- [18 · 故障排查 FAQ](18-troubleshooting-faq.md) — agent 载入失败、provider 鉴权、热重载不生效等对策
