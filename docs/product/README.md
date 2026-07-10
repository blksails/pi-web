# pi-web 产品文档

> 给任何用 pi SDK 写的 agent **秒级套上生产可用的 Web UI**。
>
> 本目录是 pi-web 的**完整产品文档**，每个主题独立成文。权威需求与底层设计仍以根目录 `PLAN.md`、`.kiro/steering/` 与各 `.kiro/specs/` 为准；本套文档面向使用者、集成方、Agent 作者与贡献者，做体系化的产品级讲解。

## 这是什么

pi-web 把一个目录或 git 仓库（含用 [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) SDK 写的 `index.[js|ts]`）自动载入，并起一个**流式 Web 聊天 UI**。前端是 **Vite 驱动的 SPA**，服务端宿主是 **Hono**（一条 `app.all('/api/*')` 转发到单例 handler），服务端由 esbuild 打成单文件 `dist/server.mjs`。除 Web 服务端外，它也提供一个 **Tauri v2 桌面壳**作为第二种交付形态（见 [20 桌面版（Tauri）](./20-desktop-tauri.md)），并被设计为未来 "pi cloud" 的内核与开放层。

**最快上手**：仓库根 `pnpm install && pnpm dev`。`pnpm dev` 是 `scripts/dev-all.mjs` 双进程编排——并发拉起 **API server（:3000）** 与 **vite dev（:5173，`/api` 代理到 3000）**；**浏览器打开 http://localhost:5173**（不是 3000，3000 是纯 API 面），在 agent source 选择器里填入 `examples/hello-agent` 的绝对路径即可进会话。完整步骤见 [01 快速开始](./01-quickstart.md)。

> 想找一个能直接跑的例子上手？仓库 `examples/` 提供了**按能力分类的可跑示例索引** → [examples 总索引](https://github.com/blksails/pi-web/blob/main/examples/README.md)。

## 文档地图

按角色选择阅读路径：

| 我是… | 推荐顺序 |
| --- | --- |
| **第一次接触（评估/试用）** | [00 产品概述](./00-product-overview.md) → [01 快速开始](./01-quickstart.md) → [02 核心概念](./02-core-concepts.md) |
| **Agent 作者**（要给自己的 agent 套 UI） | [01 快速开始](./01-quickstart.md) → [08 自定义 Agent 开发](./08-agent-development.md) → [09 附件系统](./09-attachment-system.md) → [14 会话列表](./14-sessions-list.md) → [12 Web UI 扩展](./12-web-ui-extension.md) → [11 AIGC 与视觉工具](./11-aigc-and-vision-tools.md) → [15 消息队列](./15-message-queue.md) |
| **集成方**（把 pi-web 嵌进自己的栈） | [03 系统架构](./03-architecture.md) → [04 Surface 权威表面栈](./04-surface-stack.md) → [05 分层包](./05-packages.md) → [24 HTTP/SSE API 参考](./24-http-api-reference.md) → [13 配置 UI](./13-config-ui.md) |
| **前端 / 插件扩展作者** | [12 Web UI 扩展](./12-web-ui-extension.md) → [04 Surface 权威表面栈](./04-surface-stack.md) → [16 Canvas 工作台](./16-canvas-workbench.md) → [17 Canvas 插件开发](./17-canvas-plugins.md) |
| **运维 / 部署** | [06 配置参考](./06-configuration.md) → [18 CLI](./18-cli.md) → [19 部署与运维](./19-deployment.md) → [20 桌面版（Tauri）](./20-desktop-tauri.md) → [21 日志系统](./21-logging.md) |
| **贡献者** | [03 系统架构](./03-architecture.md) → [05 分层包](./05-packages.md) → [22 开发规范与测试](./22-development-and-testing.md) → [25 路线图](./25-roadmap.md) |

## 全部章节

| # | 文档 | 一句话 |
| --- | --- | --- |
| 00 | [产品概述](./00-product-overview.md) | pi 自定义 agent 的即时 Web UI：定位、解决的问题、能力与目标场景 |
| 01 | [快速开始](./01-quickstart.md) | 从零到跑通第一个 agent 约 5 分钟（`pnpm dev` 双进程 + examples 源） |
| 02 | [核心概念](./02-core-concepts.md) | 概念地图：Agent Source / 双模式 / Session / RPC 通道 / 两条通信平面 / 生命周期 |
| 03 | [系统架构](./03-architecture.md) | 浏览器(Vite SPA)↔Hono 宿主↔Agent 子进程三段式，两条正交通信平面 |
| 04 | [Surface 权威表面栈](./04-surface-stack.md) | 与聊天流正交的第二通信平面（CQRS 单写者），端到端驱动 Canvas |
| 05 | [分层包](./05-packages.md) | 11 个 `@blksails/*` 包的职责与单向依赖方向 |
| 06 | [配置参考](./06-configuration.md) | 环境变量、`~/.pi/agent`、桌面版 / AIGC / 视觉 provider 配置 |
| 07 | [Provider 与模型](./07-providers-and-models.md) | 文本对话模型发现与内置 / 自定义 OpenAI-compatible 网关接入 |
| 08 | [自定义 Agent 开发](./08-agent-development.md) | `index.ts` 契约、`getSessionState`、slash 补全、声明式 routes、热重载 |
| 09 | [附件系统](./09-attachment-system.md) | 引用而非 base64 的四层文件管理，`att_<id>` 回流 |
| 10 | [扩展 / Skills / 模板](./10-extensions-and-skills.md) | 自动资源发现 + 两条安装车道（回合内工具 / 受控 REST）+ 权限内联 |
| 11 | [AIGC 与视觉工具](./11-aigc-and-vision-tools.md) | `image_generation`/`image_edit` 生成 + `image_vision` 识别，均为进程内 extension |
| 12 | [Web UI 扩展](./12-web-ui-extension.md) | agent-web-extension 五层挂载模型（Tier 1–5） |
| 13 | [配置 UI](./13-config-ui.md) | schema 驱动的表单 IR（`FormSchema`）与可插拔渲染器注册表 |
| 14 | [会话列表](./14-sessions-list.md) | 浏览历史会话并一键恢复的可重定位只读面板 |
| 15 | [消息队列](./15-message-queue.md) | 忙时按插话 / 跟进语义排队、可视化 pending 与取回回填 |
| 16 | [Canvas 工作台](./16-canvas-workbench.md) | 画廊 + 二创画布编辑器（默认关，`NEXT_PUBLIC_PI_WEB_CANVAS` 门控） |
| 17 | [Canvas 插件开发](./17-canvas-plugins.md) | `defineCanvasLayer`/`Tool`/`Action` 三件套与前端 / agent 双端接线 |
| 18 | [CLI](./18-cli.md) | `pi-web` 全局薄启动器：解析参数 → env → 拉起 `dist/server.mjs`（无子命令） |
| 19 | [部署与运维](./19-deployment.md) | esbuild 单文件产物结构、生产 CSP 硬化、有状态长连接拓扑约束 |
| 20 | [桌面版（Tauri）](./20-desktop-tauri.md) | dmg/nsis/appimage 三形态 + 随包 Node sidecar + 共享运行时首启解包 |
| 21 | [日志系统](./21-logging.md) | 三类组件结构化日志、子进程 stderr 汇聚、浏览器日志面板 |
| 22 | [开发规范与测试](./22-development-and-testing.md) | TS strict、`pnpm dev` 双进程循环、`build:dist` 管线、测试分层 |
| 23 | [故障排查 / FAQ](./23-troubleshooting-faq.md) | 症状 → 原因 → 对策速查附录 |
| 24 | [HTTP/SSE API 参考](./24-http-api-reference.md) | REST + SSE 端点收敛契约（聚合各特性章端点） |
| 25 | [路线图](./25-roadmap.md) | 已交付能力矩阵 + 规划中接缝（含未合分支隔离带说明） |
| 26 | [术语表](./26-glossary.md) | 全链路关键术语速查（含 Surface / AAS 设计词汇辨析） |

## 约定

- 文档语言为**中文**，技术名词与代码标识符保留原文。
- 代码路径写作 `path:line` 形式，便于在仓库内跳转。
- 本套文档不引用 `./docs` 下早期的零散设计稿，内容以 README、steering 与代码实际为准。
- **新特性章的追加位置**：为最大化连续阅读性，章节维持连续编号 `00–26`；后续新增的特性章应**追加在参考尾部（24 API 参考 / 25 路线图 / 26 术语表）之前**（即插在功能簇末尾、参考章之前），避免每次新增都触发全量重排。
- **范围纪律**：路线图 / 规划中的能力必须显式标注「规划中 / 未实现」，不与当前可用能力混写；AAS 是 pre-spec 设计词汇（非已交付 SDK），已落地并有代码背书的对应实现是 **Surface 栈**（见 [04](./04-surface-stack.md) 与 [26 术语表](./26-glossary.md)）。

---

_私有仓库 — © blksails。_
