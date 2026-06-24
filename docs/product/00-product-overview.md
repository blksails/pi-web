# 00 · 产品概述

## 一句话定位

**pi-web 是 pi 自定义 Agent 的即时 Web UI。** 给定一个目录或 git 仓库（含用 pi SDK 写的 `index.[js|ts]` 入口），它自动把 agent 载入并起一个流式 Web 聊天 UI——让任何用 [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) SDK 写的 agent 秒变带 UI 的产品。

## 它解决什么问题

写好一个 pi agent 的逻辑（系统提示、工具、模型、扩展）只是一半；要让它**对人可用**还得有一套前端：流式渲染、工具调用展示、思考块、权限弹窗、附件上传、模型切换、会话管理……这些是重复且昂贵的工程。

pi-web 把「写好一个 pi agent」到「它有了 Web 产品」之间的距离压到接近零。

## 核心能力

- **双模式载入** — 源里探测到入口（`index.ts` > `index.js` > `index.mjs`，或 `package.json#pi-web.entry` 覆盖）→ 用 SDK `runRpcMode` 跑你的自定义 agent；没有入口 → 回退通用 `pi --mode rpc`。两者对外是**同一套 RPC 协议**，前后端桥接完全复用，只是 spawn 目标不同。入口探测与信任策略详见 [02 核心概念](./02-core-concepts.md)。
- **流式对话 UI** — Next.js 15 + shadcn/ui + Vercel AI Elements，经 SSE + AI SDK v5 自定义 `ChatTransport` 渲染文本 / 思考 / 工具调用。
- **pi 资源体系直通** — extensions / skills / prompt templates 自动发现 + 声明式注入；权限弹窗经 extension UI 子协议流转到前端对话框。
- **附件系统** — 图片/文件上传经可插拔对象存储（先本地）落库 + 签名分发 URL。两条消费路径：**base64 喂 LLM 识别**（vision），以及**文件交 server 端 tool**（图像编辑/生成）经 `attachmentId` 解析执行、产出回流并可被下一轮再次引用。
- **自定义 Provider** — 任何 OpenAI-compatible 网关（NewAPI、DashScope…）经 `~/.pi/agent/models.json` 接入；设置 UI 提供按 provider 分组、可搜索的模型下拉。
- **Web UI 扩展** — 每个 agent source 可带 `.pi/web` 控制层，通过五层模型贡献按钮/面板/声明式布局/自定义渲染器/artifact iframe。
- **开放可集成** — 分层 npm 包（`@pi-web/{protocol,server,react,ui,agent-kit,tool-kit,web-kit}`）+ 语言无关 HTTP/SSE 协议（携带 `protocolVersion`）+ 渲染器注册表。可整站部署（Next.js 应用），亦可经协议/Headless hooks 集成进自有 React 栈；面向「任意 Web 栈」的免 React 嵌入包 `@pi-web/embed`（Web Component `<pi-web-chat>` + iframe widget）**规划中**。

## 目标使用场景

1. **给一个 pi SDK 自定义 agent 快速套上生产可用的 Web 前端。** 这是首要场景。
2. **把通用 pi coding agent 作为 Web 服务对外提供。**
3. **作为未来 pi cloud（多 agent 管理 / e2b 沙箱 / edge / 设备纳管）的内核与开放层。**

## 价值主张

> 把"写好一个 pi agent"到"它有了 Web 产品"之间的距离压到接近零；同时通过分层开放，既能整站部署，也能被任意栈按需集成。

## 与 pi / pi cloud 的关系

```
            ┌───────────────────────────────────────┐
            │   pi cloud（未来：多 agent / 沙箱 / 纳管）  │
            └───────────────────────────────────────┘
                              ▲ 内核 + 开放层
            ┌───────────────────────────────────────┐
            │                pi-web                  │  ← 本项目
            │   (UI + HTTP/SSE 协议 + 分层包)          │
            └───────────────────────────────────────┘
                              ▲ 运行时
            ┌───────────────────────────────────────┐
            │   @earendil-works/pi-coding-agent SDK   │
            │        (agent 逻辑 / RPC / 工具)         │
            └───────────────────────────────────────┘
```

- **pi SDK** 提供 agent 的运行时与工具协议。
- **pi-web** 在其上提供 UI、HTTP/SSE 协议、附件/扩展/配置等产品能力，并保持分层可嵌入。
- **pi cloud**（规划中）在 pi-web 之上做多 agent 编排、远程沙箱、计费纳管。

## 不是什么

- **不是** Serverless / Edge 应用。pi-web 持有有状态长连接（每会话一个常驻子进程 + SSE），横向扩容需按 `sessionId` 粘性路由。详见 [03 系统架构](./03-architecture.md)。
- **不是** 把文件能力塞进 pi 协议。pi 工具协议的 content 只有 `text | image(base64)`，没有文件引用原语；pi-web 的附件能力全在自身层实现，不污染协议。

## 下一步

- 想立刻跑起来 → [01 快速开始](./01-quickstart.md)
- 想理解它怎么工作 → [02 核心概念](./02-core-concepts.md) 与 [03 系统架构](./03-architecture.md)
- 想给自己的 agent 套 UI → [07 自定义 Agent 开发](./07-agent-development.md)
