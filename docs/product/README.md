# pi-web 产品文档

> 给任何用 pi SDK 写的 agent **秒级套上生产可用的 Web UI**。
>
> 本目录是 pi-web 的**完整产品文档**，每个主题独立成文。权威需求与底层设计仍以根目录 `PLAN.md`、`.kiro/steering/` 与各 `.kiro/specs/` 为准；本套文档面向使用者、集成方、Agent 作者与贡献者，做体系化的产品级讲解。

## 这是什么

pi-web 把一个目录或 git 仓库（含用 [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) SDK 写的 `index.[js|ts]`）自动载入，并起一个**流式 Web 聊天 UI**。它也能把通用 pi coding agent 作为 Web 服务对外提供，并被设计为未来 "pi cloud" 的内核与开放层。

**最快上手**：仓库根 `pnpm install && pnpm dev`，浏览器开 http://localhost:3000，在 agent source 选择器里填入 `examples/hello-agent` 的绝对路径即可进会话。完整步骤见 [01 快速开始](./01-quickstart.md)。

> 想找一个能直接跑的例子上手？仓库 `examples/` 提供了**按能力分类的可跑示例索引** → [examples 总索引](https://github.com/blksails/pi-web/blob/main/examples/README.md)。

## 文档地图

按角色选择阅读路径：

| 我是… | 推荐顺序 |
| --- | --- |
| **第一次接触（评估/试用）** | [00 产品概述](./00-product-overview.md) → [01 快速开始](./01-quickstart.md) → [02 核心概念](./02-core-concepts.md) |
| **Agent 作者**（要给自己的 agent 套 UI） | [01 快速开始](./01-quickstart.md) → [07 自定义 Agent 开发](./07-agent-development.md) → [08 附件系统](./08-attachment-system.md) → [21 会话列表](./21-sessions-list.md) → [10 Web UI 扩展](./10-web-ui-extension.md) → [11 AIGC 工具](./11-aigc-tools.md) |
| **集成方**（把 pi-web 嵌进自己的栈） | [03 系统架构](./03-architecture.md) → [04 分层包](./04-packages.md) → [13 HTTP/SSE API 参考](./13-http-api-reference.md) → [21 会话列表](./21-sessions-list.md) → [12 配置 UI](./12-config-ui.md) |
| **运维 / 部署** | [05 配置参考](./05-configuration.md) → [14 CLI](./14-cli.md) → [15 部署与运维](./15-deployment.md) → [16 日志系统](./16-logging.md) |
| **贡献者** | [03 系统架构](./03-architecture.md) → [04 分层包](./04-packages.md) → [17 开发规范与测试](./17-development-and-testing.md) → [19 路线图](./19-roadmap.md) |

## 全部章节

| # | 文档 | 一句话 |
| --- | --- | --- |
| 00 | [产品概述](./00-product-overview.md) | 定位、能力、价值、目标场景 |
| 01 | [快速开始](./01-quickstart.md) | 装好环境到跑通第一个 agent |
| 02 | [核心概念](./02-core-concepts.md) | Agent Source / 双模式 / Session / RPC / 翻译层 |
| 03 | [系统架构](./03-architecture.md) | 数据流、传输无关通道、有状态约束、扩展接缝 |
| 04 | [分层包](./04-packages.md) | 7 个 `@blksails/*` 包的职责与依赖方向 |
| 05 | [配置参考](./05-configuration.md) | 环境变量、`~/.pi/agent`、隐藏 provider |
| 06 | [Provider 与模型](./06-providers-and-models.md) | 内置与自定义 OpenAI-compatible 网关接入 |
| 07 | [自定义 Agent 开发](./07-agent-development.md) | `defineAgent()`、`index.ts` 契约、示例索引、热重载 |
| 08 | [附件系统](./08-attachment-system.md) | 分层存储、两条消费路径、`attachmentId` 回流 |
| 09 | [扩展 / Skills / 模板](./09-extensions-and-skills.md) | pi 资源直通、权限弹窗、安装管理 |
| 10 | [Web UI 扩展](./10-web-ui-extension.md) | agent-web-extension 五层模型 |
| 11 | [AIGC 图像工具](./11-aigc-tools.md) | 生成/编辑、默认模型、图像归一化 |
| 12 | [配置 UI](./12-config-ui.md) | JSON Schema → 表单 IR、动态 widget |
| 13 | [HTTP/SSE API 参考](./13-http-api-reference.md) | REST + SSE 端点契约 |
| 14 | [CLI](./14-cli.md) | `pi-web` 全局命令、standalone、`--watch` |
| 15 | [部署与运维](./15-deployment.md) | standalone 产物、粘性路由、生产硬化 |
| 16 | [日志系统](./16-logging.md) | 同构 logger、服务端门控 |
| 17 | [开发规范与测试](./17-development-and-testing.md) | TS strict、测试硬要求、spec 流程 |
| 18 | [故障排查 / FAQ](./18-troubleshooting-faq.md) | 常见报错与对策 |
| 19 | [路线图](./19-roadmap.md) | 能力矩阵与规划 |
| 20 | [术语表](./20-glossary.md) | 关键术语定义 |
| 21 | [会话列表](./21-sessions-list.md) | 浏览历史会话并一键恢复 |

## 约定

- 文档语言为**中文**，技术名词与代码标识符保留原文。
- 代码路径写作 `path:line` 形式，便于在仓库内跳转。
- 本套文档不引用 `./docs` 下早期的零散设计稿，内容以 README、steering 与代码实际为准。

---

_私有仓库 — © blksails。_
