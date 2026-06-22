# 产品概述

pi-web 是 **pi 自定义 Agent 的即时 Web UI**:给定一个目录或 git 仓库(含用 pi SDK 写的 `index.[js|ts]` 入口),
自动把它载入并起一个流式 Web 聊天 UI——让任何用 `@earendil-works/pi-coding-agent` SDK 写的 agent 秒变带 UI 的产品。

## 核心能力

- **双模式载入**:有 `index.[js|ts]` → 用 SDK `runRpcMode` 跑自定义 agent;无入口 → 回退通用 `pi --mode rpc`。两者对外是同一套 RPC 协议。
- **流式对话 UI**:基于 Next.js + shadcn/ui + Vercel AI Elements,经 SSE + AI SDK v5 自定义 `ChatTransport` 渲染文本/思考/工具调用。
- **pi 资源体系直通**:extensions / skills / prompt templates 自动发现 + 声明式注入,权限弹窗经 extension UI 子协议。
- **附件系统**:图片/文件上传经对象存储(可插拔后端,先本地)落库 + 签名分发 URL 展示。两条消费路径:**base64 喂 LLM 识别**,以及**文件交 server 端 tool**(图像编辑/生成)经 `attachmentId` 解析执行、产出回流并可被下一轮再次引用。
- **开放可集成**:分层 npm 包(protocol/server/react/ui/agent-kit;embed 规划中)+ 语言无关 HTTP/SSE 协议 + 渲染器注册表,可嵌入任意 Web 项目。

## 目标使用场景

- 给一个 pi SDK 自定义 agent 快速套上生产可用的 Web 前端。
- 把通用 pi coding agent 作为 Web 服务对外提供。
- 作为未来 pi cloud(多 agent 管理 / e2b 沙箱 / edge / 设备纳管)的内核与开放层。

## 价值主张

把"写好一个 pi agent"到"它有了 Web 产品"之间的距离压到接近零;同时通过分层开放,既能整站部署,也能被任意栈按需集成。

---
_权威需求与设计见 `PLAN.md`(根目录),本文件只提炼指导决策的模式与目的。_
