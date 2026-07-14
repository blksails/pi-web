# 00 · 产品概述

## 一句话定位

**pi-web 是 pi 自定义 Agent 的即时 Web UI。** 给定一个目录或 git 仓库（含用 pi SDK 写的 `index.[js|ts]` 入口），它自动把 agent 载入并起一个流式 Web 聊天 UI——让任何用 [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) SDK 写的 agent 秒变带 UI 的产品。

## 它解决什么问题

写好一个 pi agent 的逻辑（系统提示、工具、模型、扩展）只是一半；要让它**对人可用**还得有一套前端：流式渲染、工具调用展示、思考块、权限弹窗、附件上传、模型切换、会话管理……这些是重复且昂贵的工程。

pi-web 把「写好一个 pi agent」到「它有了 Web 产品」之间的距离压到接近零。

## 30 秒尝鲜

在仓库根目录，一条命令即可看到一会话一进程的流式 UI（脚本定义见 `package.json:17`）：

```bash
pnpm dev
# dev-all.mjs 并发拉起两个进程：
#   · Vite 前端 dev server → http://localhost:5173（HMR + SPA）
#   · Hono API 宿主        → http://127.0.0.1:3000（/api 由 Vite 反向代理过去）
# 浏览器打开 http://localhost:5173，进入选源页
```

> 开发期浏览器入口是 **5173**（Vite），3000 是被代理的 API 宿主，直接打开 3000 只会看到裸 API。完整的第一条流式回复 + 工具调用走通流程见 [01 快速开始](./01-quickstart.md)。

## 核心能力

- **双模式载入** — 源里探测到入口（`index.ts` > `index.js` > `index.mjs`，或 `package.json#pi-web.entry` 覆盖）→ 用 SDK `runRpcMode` 跑你的自定义 agent；没有入口 → 回退通用 `pi --mode rpc`。两者对外是**同一套 RPC 协议**，前后端桥接完全复用，只是 spawn 目标不同。入口探测与信任策略详见 [02 核心概念](./02-core-concepts.md)。
- **流式对话 UI** — 前端是 Vite 驱动的 SPA（React + shadcn/ui + AI Elements，根 `index.html` 静态入口 + `src/main.tsx` 模块入口，产物 `dist/client`）；服务端宿主是 Hono（`server/index.ts` 一条 `app.all('/api/*')` 转发到单例 handler）。经 SSE + AI SDK v5 自定义 `ChatTransport` 渲染文本 / 思考 / 工具调用。
- **pi 资源体系直通** — extensions / skills / prompt templates 自动发现 + 声明式注入；权限弹窗经 extension UI 子协议流转到前端对话框。详见 [10 扩展 / Skills / 模板](./10-extensions-and-skills.md)。
- **会话列表与恢复** — 浏览历史会话并按 `sessionId` 一键恢复，重新订阅其事件流继续对话。详见 [14 会话列表](./14-sessions-list.md)。
- **附件系统** — 图片/文件上传经可插拔对象存储（先本地）落库 + 签名分发 URL。两条消费路径：**base64 喂 LLM 识别**，以及**文件交 server 端 tool**（图像编辑/生成）经 `attachmentId` 解析执行、产出回流并可被下一轮再次引用。详见 [09 附件系统](./09-attachment-system.md)。
- **AIGC 与视觉工具** — 内置 `image_generation` / `image_edit` 图像生成编辑工具（多 provider 路由），以及 `image_vision` 图像理解工具 + `/img_vision` 命令（看会话内已有图/最近一张图回答问题）。均以 `extensions:[aigcExtension, visionExtension]` 装载，详见 [11 AIGC 与视觉工具](./11-aigc-and-vision-tools.md)。
- **Canvas 工作台**（可选） — 面向图像创作的二创画布编辑器：舞台缩放/平移、工具轨、掩码/标注 overlay、六个生成动作、版本条与画廊，以及提示词栏「解读」按钮把当前工作图组装成视觉工具请求回流对话。为独立发布的 `canvas-kit` / `canvas-ui` 两包所承载，默认不挂载。详见 [16 Canvas 工作台](./16-canvas-workbench.md) 与 [17 Canvas 插件开发](./17-canvas-plugins.md)。
- **自定义 Provider** — 任何 OpenAI-compatible 网关（NewAPI、DashScope…）经 `~/.pi/agent/models.json` 接入；设置 UI 提供按 provider 分组、可搜索的模型下拉。详见 [07 Provider 与模型](./07-providers-and-models.md)。
- **Web UI 扩展** — 每个 agent source 可带 `.pi/web` 控制层，通过五层模型贡献按钮/面板/声明式布局/自定义渲染器/artifact iframe。详见 [12 Web UI 扩展](./12-web-ui-extension.md)。
- **两条正交通信平面** — 除聊天流（RPC / SSE）之外，pi-web 还有一条与之正交的 **Surface 权威表面** 平面：agent 子进程按 domain 持有权威状态、下行镜像到前端、命令上行执行（CQRS 单写者约定），端到端驱动 Canvas。详见 [04 Surface 权威表面栈](./04-surface-stack.md)。

## 交付形态

pi-web 有两条并列的交付路径：

- **Web 服务端** — 由 esbuild 打成单文件 `dist/server.mjs`（入口必须在产物根）+ 前端产物 `dist/client`，`pi-web <dir>` 一条命令即可起一个自包含实例。详见 [18 CLI](./18-cli.md) 与 [19 部署与运维](./19-deployment.md)。
- **桌面版（Tauri）** — main 上已有基于 Tauri v2 的桌面壳，产出 dmg / nsis / appimage 三形态安装包，随包 Node sidecar，首启把共享运行时解包到 `~/.pi/web/runtime`。适合只想双击运行的用户。详见 [20 桌面版（Tauri）打包与分发](./20-desktop-tauri.md)。

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

## 开放可集成

pi-web 由 **11 个**可独立发布的 `@blksails/pi-web-*` npm 包组成（含 `protocol` / `server` / `react` / `ui` / `agent-kit` / `tool-kit` / `web-kit`（发布名 `@blksails/pi-web-kit`）/ `logger` / `primitives` / `canvas-kit` / `canvas-ui`），加上语言无关的 HTTP/SSE 协议（携带 `protocolVersion`）与渲染器注册表。完整职责与依赖方向见 [05 分层包](./05-packages.md)。

集成方式有三条：

- **整站部署** — Vite SPA 前端 + Hono 单文件服务端 `dist/server.mjs`，`node dist/server.mjs` 即可运行。
- **协议 / Headless hooks 集成** — 经 `@blksails/pi-web-protocol` 与 `@blksails/pi-web-react` hooks 接进自有 React 栈。
- **免 React 嵌入包** `@blksails/embed`（Web Component `<pi-web-chat>` + iframe widget）**规划中**。

## 不是什么

- **不是** Serverless / Edge 应用。pi-web 持有有状态长连接（每会话一个常驻子进程 + SSE），宿主进程需常驻并 spawn 子进程、持有 SSE 长连接，横向扩容需按 `sessionId` 粘性路由。详见 [03 系统架构](./03-architecture.md)。
- **不是** 把文件能力塞进 pi 协议。pi 工具协议的 content 只有 `text | image(base64)`，没有文件引用原语；pi-web 的附件能力全在自身层实现，不污染协议。

## 下一步

- 想立刻跑起来 → [01 快速开始](./01-quickstart.md)
- 想理解它怎么工作 → [02 核心概念](./02-core-concepts.md) 与 [03 系统架构](./03-architecture.md)
- 想给自己的 agent 套 UI → [08 自定义 Agent 开发](./08-agent-development.md)
