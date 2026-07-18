---
title: Project Structure
description: "记录 pi-web 的目录组织、monorepo 包依赖方向与命名约定,指导新文件应放在哪。"
inclusion: always
---

# 项目结构

## 组织哲学

**分层 + 可单独发布的包**:从内核(协议/后端引擎)到外围(组件/canvas/整站)逐层依赖单向收敛。**依赖方向即 spec 边界**——一层的改动不应逆流污染其内层。

## Monorepo 布局

pnpm workspace(`pnpm-workspace.yaml`:`packages/*` + `desktop`)。应用宿主本身在根目录(`src/` 前端、`server/` host、`lib/` 应用逻辑),消费下列可发布包:

| 包 | 角色 |
| --- | --- |
| `@blksails/pi-web-protocol` | **唯一契约根**:RPC 类型/schema、config form-schema IR。零运行时依赖(除 zod)、同构。改动需语义化版本,SSE 帧带 `protocolVersion`。 |
| `@blksails/pi-web-server` | 后端引擎:agent 源解析、bootstrap runner、RPC 通道、会话注册与翻译、config/attachment/http(含 `authResolver`)路由。依赖 pi SDK、e2b、jiti、pg、ws。 |
| `@blksails/pi-web-react` | Headless hooks & transport(无样式)。 |
| `@blksails/pi-web-ui` | shadcn/ui + AI Elements 组件 + schema 驱动的 config UI(依赖 canvas-ui、primitives、tool-kit)。 |
| `@blksails/pi-web-primitives` | 框架中立 UI 原语(Radix 封装),与聊天壳解耦。 |
| `@blksails/pi-web-agent-kit` | `defineAgent()` 类型帮助,给用户写 `index.ts`(运行时不强制依赖)。 |
| `@blksails/pi-web-tool-kit` | 声明式工具引擎 + AIGC/vision 工具集。**双入口**:主入口声明层(前端安全),`./runtime` node-only 执行层。 |
| `@blksails/pi-web-kit`(web-kit) | Web 集成/打包支撑(依赖 esbuild)。 |
| `@blksails/pi-web-canvas-kit` | Canvas 内核:layer model / ops / history。Headless。 |
| `@blksails/pi-web-canvas-ui` | Canvas workbench UI、actions、插件注册面。 |
| `@blksails/pi-web-logger` | 同构结构化日志,零运行时依赖,浏览器/Node 自动分流。 |
| `@blksails/pi-web-wecom`(wecom-extension) | 企业微信 extension tools(经 pi-gateway outbound API)。 |
| `fetch-bridge` / `desktop` | fetch 桥;Tauri 桌面壳(在 workspace 内)。 |

**依赖方向铁律**:`logger` / `protocol` 在最内层,被几乎所有包依赖;`protocol ← 所有`;`server` 只依赖 `protocol` + `logger`(不依赖 react/ui);`react`/`ui` 与后端解耦。写新包/新依赖前先确认不制造反向或环形依赖。

## 应用宿主目录(根)

- `src/`:Vite React SPA(`main.tsx` 入口、`app.tsx`、`bootstrap.tsx`、`routes/`、`runtime/`、`providers.tsx`、`globals.css`)。
- `server/`:Hono host(`index.ts` 挂 `/api/*` → `createPiWebHandler`、`bootstrap.ts`、`cli/`、`static.ts`、`webext-routes.ts`、`load-env.ts`)。
- `lib/app/`:应用级逻辑——`config.ts`(运行时读 env,永不 log)、`pi-handler.ts`、`llm-gateway-{config,assembly}.ts`、`webext/`(信任/门控)、`stub-agent-process.mjs`(e2e 桩)。
- `components/`:应用侧 React 组件(`chat-app.tsx`、`ai-elements/` 等)。
- `examples/`:各类 `defineAgent` 源(用户 agent 范例)。
- `docs/`:子系统设计文档 + `docs/product/`(00–26 编号手册)。
- `e2e/`、`test/`:Playwright / vitest / CLI / desktop / sandbox e2e。
- `payload/`、`dist/`、`bin/`、`desktop/`:打包产物与 CLI/桌面入口。

## Agent 源的声明式路由约定

一个 agent 源的 `index.ts` 只声明「这个 agent 是什么」:

- 1 个路由内联即可;**≥2 个或 handler 变复杂**时抽到 `routes/` 子目录。
- **一路由一文件** `routes/<route-name>.ts`(文件名 === 路由 `name` kebab-case === URL 段);文件内 co-locate handler(单独导出便于单测)+ `AgentRouteDecl`(导出 `<camelName>Route`)。
- `routes/index.ts` 作 barrel 汇成 `AgentRouteDecl[]`;`index.ts` 只 `import { routes }` 传给 `defineAgent`,不放 handler。NodeNext 相对导入带 `.js`。范例见 `examples/aigc-canvas-agent/`,详见 `docs/product/08`。

## 命名约定

- **文件**:kebab-case(`pi-rpc-process.ts`)。
- **React 组件**:PascalCase(`<PiChat>`、`<PiToolPart>`)。
- **公开包**:`@blksails/pi-web-*` scope。
- **导入**:绝对 `@/`(→ 项目根)用于跨模块,相对用于同模块;NodeNext 包内相对导入带 `.js` 扩展。

## 代码组织原则

- **传输/隔离/存储用接口隔开**:`PiRpcChannel`、`agentHostProvider`、`SessionStore`、`BlobStore` 是为未来(e2b/edge/device、对象存储)预留的接缝,按接口写、后端经配置切换。
- **协议是稳定契约**:`@blksails/pi-web-protocol` 类型/schema 改动需语义化版本。
- **安全是可替换策略而非硬编码**:沙箱、信任(`trustPolicy`)、鉴权(`authResolver`)做成插件点。
- **双入口边界**:前端安全声明层与 node-only runtime 层严格分离(见 tech.md)。

---
_文档化模式,而非文件树。遵循模式的新文件不应需要更新本文件。权威设计见 `PLAN.md` 与 `docs/`。_
