---
title: Product Vision
description: "定义 pi-web 的核心目的、目标用户与主要能力,指导 AI 理解「为什么」。"
inclusion: always
---

# 产品概述

**pi-web 是 pi 自定义 Agent 的即时 Web UI**:给定一个目录或 git 仓库(含用 pi SDK 写的
`index.[js|ts]` 入口),自动把它载入并起一条流式 Web 聊天 UI——让任何用
`@earendil-works/pi-coding-agent` SDK 写的 agent 近乎零成本变成带 UI 的产品。它同时把通用
pi coding agent 作为 Web 服务对外提供,并被设计为未来「pi cloud」的内核 + 开放层。

发布包统一在 **`@blksails/*`** scope 下(`@blksails/pi-web-*`);产品文档站见
`docs/product/`(24 篇子系统手册)。

## 目标用户

- **Agent 作者**:已用 pi SDK 写好一个 agent,想立刻给它一个生产可用的 Web 前端,而不想自己搭聊天 UI、流式协议、附件与权限。
- **平台/集成方**:想把通用 pi coding agent 作为 Web 服务对外提供,或把 pi-web 的分层包/协议嵌入自有 Web 栈。
- **未来 pi cloud 的运维方**:需要多 agent 管理、e2b 沙箱、edge、设备纳管的开放内核。

## 核心能力

- **双模式载入**:有 `index.[js|ts]` → 用 SDK `runRpcMode` 跑自定义 agent;无入口 → 回退通用 `pi --mode rpc`。两者对外是同一套 RPC 协议,前后端桥完全复用。
- **流式对话 UI**:Vite + React SPA(shadcn/ui + Vercel AI Elements),经 SSE + AI SDK v5 自定义 `ChatTransport` 渲染文本 / 思考 / 工具调用。
- **pi 资源体系直通**:extensions / skills / prompt templates 自动发现 + 声明式注入;权限弹窗经 extension UI 子协议回流前端。
- **附件系统**:图片/文件上传落可插拔对象存储(`BlobStore`,先本地)+ 签名分发 URL。两条消费路径:**base64 喂 LLM 识别**,与**文件交 server 端 tool**(图像编辑/生成)经 `attachmentId` 解析、产出回流下一轮再引用。
- **自定义 Provider**:任意 OpenAI 兼容网关经 `~/.pi/agent/models.json` 接入,设置 UI 从已配置可用模型生成可搜索下拉。
- **Canvas 工作台**:分层的 canvas kernel(headless)+ workbench UI + 插件注册面,支撑 AIGC / 3D 等可视化编辑场景。
- **开放可嵌入**:分层 npm 包 + 语言无关 HTTP/SSE 协议 + 渲染器注册表,可整站部署,也可被任意栈按需集成;另有 CLI(`pi-web`)与 Tauri 桌面壳。

## 价值主张

把「写好一个 pi agent」到「它有了 Web 产品」之间的距离压到接近零;同时通过分层开放,既能整站部署,也能被任意栈按需集成。

---
_权威需求与设计见根目录 `PLAN.md` 与 `docs/`;本文件只提炼指导决策的目的与模式。_
