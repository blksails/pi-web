# 01 · 快速开始

从零到跑通第一个 agent，约 5 分钟：起开发服务器、指向一个 examples 源、发一条消息看到流式回复与工具调用。

## 前置依赖

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| **Node** | `>=22.19.0` | 见 `package.json:5-7` 的 `engines`。运行时坚持 Node（Bun 仅用于个别工具链脚本）。 |
| **pnpm** | 9.x（`packageManager: pnpm@9.12.0`） | 本仓是 pnpm workspace monorepo。 |
| **pi 配置目录** | `~/.pi/agent` 存在 | 运行一次 `pi` 并登录，使 `auth.json` / `settings.json` 生成；或经环境变量提供 provider key（见下）。 |

> 没装过 pi？先 `npm i -g @earendil-works/pi-coding-agent`（或参考其文档），运行 `pi` 登录一次。

## 安装与启动（开发模式）

```bash
pnpm install
pnpm dev          # dev-all：Vite 前端 http://localhost:5173（/api 自动代理到 :3000）
```

**打开浏览器访问 http://localhost:5173**（不是 3000）。

### 为什么是两个进程、要开哪个端口

`pnpm dev` 实际执行 `node scripts/dev-all.mjs`（`package.json:17`），它并发拉起**两个**进程，任一退出或 Ctrl-C 时一起收尾（`scripts/dev-all.mjs:32-36`）：

| 进程 | 端口 | 角色 |
| --- | --- | --- |
| Hono API 宿主（`server/index.ts`） | `127.0.0.1:3000` | 后端：`/api/*` 路由、SSE 会话流、spawn agent 子进程 |
| Vite dev server | `http://localhost:5173` | 前端：SPA + HMR，`/api` 请求反向代理到 3000（`vite.config.ts:72-81`） |

开发期你面对的入口是 Vite 的 **5173**（有热更新、提供 SPA）；3000 是被代理的裸 API 宿主，直接打开只会看到 API 而非聊天界面。生产模式则相反——`pnpm build` 后 `pnpm start`（= `node dist/server.mjs`）是**单进程单端口**，同一个 `:3000`（或 `PORT`）既服务 SPA 静态资源又服务 `/api`（`server/index.ts:94-104`）。

打开 5173 后，在 **agent source 选择器**里录入一个源，三种形态：

- **含 `index.ts` 的目录** → 跑你的自定义 agent（custom 模式）；
- **任意目录** → 通用 CLI 模式（`pi --mode rpc`）；
- **git 源** → 解析后同上。

> 只想双击运行、不想开终端？pi-web 还有一个 Tauri 桌面壳（`desktop/`），它内部同样 spawn `dist/server.mjs` 后端。详见 [20 桌面版（Tauri）](./20-desktop-tauri.md)。

## 从 examples/ 选一个上手

仓库 `examples/` 内置了多个**可直接指向**的示例（约 28 个，按能力分类整理在 [examples 总索引](https://github.com/blksails/pi-web/blob/main/examples/README.md)）。第一次跑通，推荐从下面两个入门示例任选其一：

| 示例 | 适合 | 说明 |
| --- | --- | --- |
| `examples/hello-agent` | 第一次跑通 | 自包含的最小自定义 agent，只暴露一个 `echo` 工具，不加载系统工具与磁盘 skills。 |
| `examples/minimal-agent` | 看最精简入口 | 仅 `defineAgent()` 必需字段的骨架，便于对照自己写入口。 |

## 5 分钟跑通示例 agent

下面以最小例子 `examples/hello-agent` 为例（`examples/hello-agent/index.ts`）：

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const echo = defineTool({
  name: "echo",
  label: "Echo",
  description: "Echo the provided text back to the caller.",
  parameters: Type.Object({
    text: Type.String({ description: "Text to echo back." }),
  }),
  async execute(_toolCallId, params) {
    return { content: [{ type: "text", text: params.text }], details: undefined };
  },
});

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的默认 provider/model
  systemPrompt: "You are hello-agent, a minimal pi-web example agent.",
  customTools: [echo],
  // 自包含：不拉系统内置工具，也不加载磁盘发现的 skills
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
```

> `noTools: "builtin"` 与 `skills` 覆盖钩子的含义见 [08 自定义 Agent 开发](./08-agent-development.md)。

步骤（每步可独立验证）：

1. `pnpm dev` 启动后，浏览器打开 **http://localhost:5173** → **预期**看到选源页。
2. 在选择器里填入 `examples/hello-agent` 的**绝对路径**（选择器需要绝对路径；或配 `PI_WEB_DEFAULT_SOURCE`，见下）→ **预期**进入会话界面。
3. 发一句话 → **预期**看到流式回复逐字出现。
4. 让它调工具：发「用 echo 工具回显 hello」（或类似指令）→ **预期**会话里出现 `echo` 的工具卡。

> **没看到回复 / 报鉴权错？** 多半是默认 provider/model 无有效 key。先用下方「离线快速验证」的 stub agent 跑通链路，鉴权问题见 [23 故障排查 / FAQ](./23-troubleshooting-faq.md)。

> `hello-agent` 故意省略 `model`，让它继承你 pi 登录的默认 provider/model，开箱即用。要钉死模型，加 `model: { provider, modelId }`，但该 provider 必须有有效鉴权。

## 配置（可选）

凭据和默认值默认来自 `~/.pi/agent`（已登录 pi 则无需任何环境 key）。要覆盖，复制 `.env.local.example` 为 `.env.local`。最常用：

```bash
# .env.local
PI_WEB_DEFAULT_SOURCE=/abs/path/to/examples/hello-agent  # 选择器默认源
PI_WEB_DEFAULT_CWD=/abs/path/to/workdir                  # 会话默认工作目录
PI_WEB_DEFAULT_PROVIDER=openrouter                       # 强制 provider（否则看 settings.json）
PI_WEB_DEFAULT_MODEL=anthropic/claude-sonnet-4.6         # 强制 model（值与 provider 对应）
```

完整变量见 [06 配置参考](./06-configuration.md)。

## 离线快速验证（不消耗模型额度）

无 LLM key 也能验证全链路（用确定性 stub agent）。同样在 **5173** 打开：

```bash
PI_WEB_STUB_AGENT=1 pnpm dev
# 或跑离线 Node 级流式 e2e（无需浏览器）：
pnpm e2e:node
```

## 常用脚本速查

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | dev-all：前端 Vite `:5173` + API 宿主 `:3000`（浏览器开 5173） |
| `pnpm build` / `pnpm start` | 生产构建（`build:dist` 五步管线）/ 启动单文件 `dist/server.mjs`（单进程 `:3000`） |
| `pnpm test` | 所有 workspace 包测试 |
| `pnpm test:app` | App 级 vitest |
| `pnpm e2e` | Playwright 浏览器 e2e |
| `pnpm e2e:node` | 离线 Node 级流式 e2e（stub agent） |
| `pnpm typecheck` | 全包 + app 类型检查 |
| `pnpm build:cli` / `pnpm start:cli` | 构建 / 启动全局 CLI（`bin/pi-web.mjs` 拉起 `dist/server.mjs`，见 [18 CLI](./18-cli.md)） |

## 常见首次问题

- **打开 3000 看到裸 API / JSON？** 开发期应访问 **5173**（Vite 提供 SPA）；3000 是被 Vite 代理的后端宿主，不直接提供前端页面。
- **改了注入路由 / 配置域后没生效** — handler 单例 pin 在 `globalThis`，热重载不刷新新装配的路由，需重启 `pnpm dev`。
- 更多见 [23 故障排查 / FAQ](./23-troubleshooting-faq.md)。

## 下一步

- 理解载入与会话机制 → [02 核心概念](./02-core-concepts.md)
- 写自己的 agent → [08 自定义 Agent 开发](./08-agent-development.md)
- 接入自定义模型网关 → [07 Provider 与模型](./07-providers-and-models.md)
- 打包成桌面应用 → [20 桌面版（Tauri）](./20-desktop-tauri.md)
