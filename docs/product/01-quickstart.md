# 01 · 快速开始

从零到跑通第一个 agent，约 5 分钟。

## 前置依赖

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| **Node** | `>=22.19.0` | pi 的 `engines` 约束；生产镜像用 `node:24-bookworm-slim`。运行时坚持 Node（Bun 仅用于工具链）。 |
| **pnpm** | 9.x（`packageManager: pnpm@9.12.0`） | workspace monorepo。 |
| **pi 配置目录** | `~/.pi/agent` 存在 | 运行一次 `pi` 并登录，使 `auth.json` / `settings.json` 生成。或经环境变量提供 provider key（见下）。 |

> 没装过 pi？先 `npm i -g @earendil-works/pi-coding-agent`（或参考其文档），运行 `pi` 登录一次。

## 安装与启动（开发模式）

```bash
pnpm install
pnpm dev          # next dev — http://localhost:3000
```

打开浏览器，在 **agent source 选择器**里录入一个源，三种形态：

- **含 `index.ts` 的目录** → 跑你的自定义 agent（custom 模式）；
- **任意目录** → 通用 CLI 模式（`pi --mode rpc`）；
- **git 源** → 解析后同上。

## 5 分钟跑通示例 agent

仓库 `examples/` 内置了多个可直接指向的示例。最小例子是 `examples/hello-agent`：

```ts
// examples/hello-agent/index.ts（节选）
import { defineAgent } from "@pi-web/agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const echo = defineTool({
  name: "echo",
  label: "Echo",
  description: "Echo the provided text back to the caller.",
  parameters: Type.Object({ text: Type.String() }),
  async execute(_id, params) {
    return { content: [{ type: "text", text: params.text }], details: undefined };
  },
});

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的默认 provider/model
  systemPrompt: "You are hello-agent, a minimal pi-web example agent.",
  customTools: [echo],
});
```

> 上面是节选。真实 `examples/hello-agent/index.ts:1` 还设了 `noTools: "builtin"` 和 `skills: () => ({ skills: [], ... })`，使示例**自包含**——只暴露自定义 `echo`，不加载系统内置工具与磁盘发现的 skills。这两个开关的含义见 [07 自定义 Agent 开发](./07-agent-development.md)。

步骤：

1. `pnpm dev` 启动后打开 http://localhost:3000
2. 在选择器里填入 `examples/hello-agent` 的**绝对路径**（选择器需要绝对路径；或配 `PI_WEB_DEFAULT_SOURCE`，见下）
3. 进入会话，发一句话 → **预期**看到流式回复
4. 让它调工具：发「用 echo 工具回显 hello」（或类似指令）→ **预期**会话里出现 `echo` 的工具卡

> **没看到回复 / 报鉴权错？** 多半是默认 provider/model 无有效 key。先用下方「离线快速验证」的 stub agent 跑通链路，鉴权问题见 [18 故障排查 / FAQ](./18-troubleshooting-faq.md)。

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

完整变量见 [05 配置参考](./05-configuration.md)。

## 离线快速验证（不消耗模型额度）

无 LLM key 也能验证全链路（用确定性 stub agent）：

```bash
PI_WEB_STUB_AGENT=1 pnpm dev
# 或跑离线 Node 级流式 e2e：
pnpm e2e:node
```

## 常用脚本速查

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 开发服务器（`next dev`，:3000） |
| `pnpm build` / `pnpm start` | 生产构建 / 启动 |
| `pnpm test` | 所有 workspace 包测试 |
| `pnpm test:app` | App 级 vitest |
| `pnpm e2e` | Playwright 浏览器 e2e |
| `pnpm e2e:node` | 离线 Node 级流式 e2e（stub agent） |
| `pnpm typecheck` | 全包 + app 类型检查 |
| `pnpm build:cli` / `pnpm start:cli` | 构建 / 启动全局 CLI（standalone，见 [14 CLI](./14-cli.md)） |

## 常见首次问题

- **dev 期不要跑 `pnpm build`** — 会污染共享 `.next` 致 webpack 500。CLI/e2e 构建用隔离目录（`NEXT_DIST_DIR=.next-cli` / `.next-e2e`）。
- **改了注入路由/配置域后路由没生效** — handler 单例 pin 在 `globalThis`，热重载不刷新新路由，需重启 dev。
- 更多见 [18 故障排查 / FAQ](./18-troubleshooting-faq.md)。

## 下一步

- 理解载入与会话机制 → [02 核心概念](./02-core-concepts.md)
- 写自己的 agent → [07 自定义 Agent 开发](./07-agent-development.md)
- 接入自定义模型网关 → [06 Provider 与模型](./06-providers-and-models.md)
