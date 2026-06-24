# pi-web

[English](./README.md) | **简体中文**

> pi 自定义 Agent 的即时 Web UI —— 给定一个目录或 git 仓库(含用 pi SDK 写的 `index.[js|ts]` 入口),自动载入并起一个流式 Web 聊天 UI。

pi-web 把任何用 [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) SDK 写的 agent 以接近零的额外成本变成带 UI 的产品;也能把通用 pi coding agent 作为 Web 服务对外提供,并被设计为未来 "pi cloud" 的内核与开放层。

📖 **文档站:** [pi-web.blksails.ai](https://pi-web.blksails.ai) —— 完整产品文档(概述、快速开始、架构、API、部署)。

> npm 包统一在 **`@blksails/*`** scope 下发布(`@blksails/pi-web-protocol`、`@blksails/pi-web-server`、`@blksails/pi-web-react`、`@blksails/pi-web-ui`、`@blksails/pi-web-agent-kit`、`@blksails/pi-web-tool-kit`、`@blksails/pi-web-kit`)。

## 核心能力

- **双模式载入** —— 有 `index.[js|ts]` 入口的源用 SDK 的 `runRpcMode` 跑自定义 agent;无入口则回退通用 `pi --mode rpc`。两者对前端是同一套 RPC 协议。
- **流式对话 UI** —— Next.js + shadcn/ui + Vercel AI Elements,经 SSE + AI SDK v5 自定义 `ChatTransport` 渲染文本 / 思考 / 工具调用。
- **pi 资源体系直通** —— extensions / skills / prompt templates 自动发现 + 声明式注入;权限弹窗经 extension UI 子协议。
- **附件系统** —— 图片/文件上传经可插拔对象存储(先本地)落库 + 签名分发 URL。两条消费路径:**base64 喂 LLM 识别**,以及**文件交 server 端 tool**(图像编辑/生成)经 `attachmentId` 解析执行,产出回流并可被下一轮再次引用。
- **自定义 provider** —— 经 `~/.pi/agent/models.json` 接入任意 OpenAI 兼容网关(NewAPI、DashScope 等);设置 UI 提供可搜索的 provider/模型下拉,选项来自你已配置凭证的可用模型。
- **开放可集成** —— 分层 npm 包 + 语言无关 HTTP/SSE 协议 + 渲染器注册表,可嵌入任意 Web 栈。

## 架构

```
浏览器 (AI Elements + useChat)
   │  SSE / HTTP
   ▼
Next.js Route Handler (Node runtime,会话进程驻留)
   │  stdin/stdout JSONL
   ▼
Agent 子进程  — bootstrap runner `runRpcMode`  或  `pi --mode rpc`
               (一会话一进程)
```

后端核心是一条**传输无关的 RPC 通道**(`PiRpcChannel`);事件 → AI SDK `UIMessage` 流的翻译层是前后端枢纽。两种模式底层同实现,故桥接完全复用,仅 spawn 目标不同。

> 有状态长连接 —— **不能** Serverless/Edge(除非控制面/数据面分离);横向扩容需按 `sessionId` sticky routing。

## 包结构

分层、可单独发布的包,依赖方向单向收敛(`protocol ← 所有`;`server` 仅依赖 `protocol`;`react`/`ui` 与后端解耦):

| 包 | 职责 |
| --- | --- |
| `@blksails/pi-web-protocol` | 稳定契约:RPC 类型/schema、配置表单 IR。改动需语义化版本;SSE 帧带 `protocolVersion`。 |
| `@blksails/pi-web-server` | 后端引擎:agent 源解析、bootstrap runner、RPC 通道、会话注册与翻译、配置/附件路由。 |
| `@blksails/pi-web-react` | 无样式的 headless hooks 与 transport。 |
| `@blksails/pi-web-ui` | shadcn/ui + AI Elements 组件,以及 schema 驱动的配置 UI。 |
| `@blksails/pi-web-agent-kit` | 写 `index.ts` 用的 `defineAgent()` 类型帮助。 |
| `@blksails/pi-web-tool-kit`、`@blksails/pi-web-kit` | 工具与 Web 集成的配套套件。 |

## 快速开始

### 前置要求

- Node `>=22.19.0`(pi `engines` 约束)
- [pnpm](https://pnpm.io/)(workspace monorepo)
- 一个 `~/.pi/agent` 配置目录 —— 先跑 `pi` 登录一次,使 `auth.json` / `settings.json` 存在。(或经环境变量提供 provider key,见下。)

### 安装与运行

```bash
pnpm install
pnpm dev          # next dev —— http://localhost:3000
```

打开应用,在选择器里输入 **agent source**:
- 含 `index.ts` 的目录 → 你的自定义 agent,
- 任意目录 → 通用 CLI 模式,
- 或一个 git 源。

### 配置

凭证与默认值默认来自 `~/.pi/agent`(若已用 `pi` 登录则无需 env key)。复制 `.env.local.example` 为 `.env.local` 以覆盖。关键变量(均由 `lib/app/config.ts` 运行时读取,绝不记录):

| 变量 | 用途 |
| --- | --- |
| `PI_WEB_AGENT_DIR` / `PI_CODING_AGENT_DIR` | 覆盖 pi 配置目录(默认 `~/.pi/agent`)。 |
| `PI_WEB_DEFAULT_PROVIDER` / `PI_WEB_DEFAULT_MODEL` | 强制指定 provider/模型(否则由 `settings.json` 决定)。 |
| `PI_WEB_HIDE_PROVIDERS` | 逗号分隔的 provider 名,从 settings 的模型/provider 下拉中隐藏(其模型会被从 `GET /config/models` 过滤掉)。 |
| `PI_WEB_DEFAULT_SOURCE` | 选择器默认提供的 agent 源。 |
| `PI_WEB_DEFAULT_CWD` | 会话默认工作目录。 |
| `ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 等 | 可选,叠加透传以覆盖 `auth.json`。 |
| `PI_WEB_STUB_AGENT=1` | 用确定性离线 stub 跑会话(e2e 用)。 |

#### 自定义 OpenAI 兼容 provider

在 `~/.pi/agent/models.json` 中接入任意 OpenAI 兼容网关:

```json
{
  "providers": {
    "my-gateway": {
      "name": "My Gateway",
      "baseUrl": "https://example.com/v1",
      "apiKey": "sk-...",
      "api": "openai-completions",
      "models": [
        { "id": "some-model", "name": "Some Model", "input": ["text"], "contextWindow": 131072, "maxTokens": 16384, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } }
      ]
    }
  }
}
```

非内置 provider 需 `baseUrl` + `apiKey`;用 `pi --list-models` 验证。随后该模型会出现在设置的 provider/模型下拉里。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动开发服务器(`next dev`)。 |
| `pnpm build` | 生产构建。 |
| `pnpm start` | 运行生产构建。 |
| `pnpm test` | 运行所有 workspace 包测试。 |
| `pnpm test:app` | 应用级 vitest。 |
| `pnpm e2e` | Playwright e2e。 |
| `pnpm e2e:node` | 离线 Node 级流式 e2e(stub agent)。 |
| `pnpm typecheck` | 全部包 + 应用类型检查。 |

## 开发标准

- **TypeScript strict**,禁 `any`。
- **测试是硬性要求**:每个 spec 必须有单元/集成测试 **加** e2e 验证,并以新鲜证据(实际运行输出)证明通过。后端 RPC 桥用对真实子进程的集成测试;前端翻译层用纯函数单测。
- 传输 / 隔离 / 存储用接口隔开(`PiRpcChannel`、`SessionStore`、`BlobStore`),为未来 e2b/edge/device 与对象存储预留接缝。

本仓库遵循 Kiro 风格的 spec 驱动开发 —— 见 `.kiro/steering/`(项目记忆)与 `.kiro/specs/`(各功能 spec)。权威需求见 `PLAN.md`。

---

_私有仓库 —— © blksails。_
