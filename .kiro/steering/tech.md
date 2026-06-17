# 技术栈

## 架构

浏览器(AI Elements + `useChat`)─ SSE/HTTP ─→ Next.js Route Handler(Node runtime,会话进程驻留)
─ stdin/stdout JSONL ─→ agent 子进程(bootstrap runner `runRpcMode` 或 `pi --mode rpc`,一会话一进程)。
后端核心是一条 **传输无关的 RPC 通道**;事件→AI SDK UIMessage 流的翻译层是前后端枢纽。

## 核心技术

- **语言**:TypeScript(strict)
- **框架**:Next.js 15(App Router / RSC);API Route Handler 必须 `runtime = "nodejs"`
- **运行时**:Node `>=22.19.0`(pi `engines` 约束;镜像 `node:24-bookworm-slim`)
- **Agent runtime**:`@earendil-works/pi-coding-agent` SDK(`createAgentSessionRuntime` + `runRpcMode`)
- **Agent 载入**:`jiti`(运行时直接跑用户 `index.ts`)
- **UI**:shadcn/ui(Radix + Tailwind)+ Vercel AI Elements;状态/流用 AI SDK v5 `@ai-sdk/react` + 自定义 `ChatTransport`

## 关键库

只列影响开发模式的:`@earendil-works/pi-coding-agent`(agent + RPC + SDK)、`ai` / `@ai-sdk/react`、`jiti`、shadcn/AI Elements。

## 开发标准

### 类型安全
TypeScript strict,禁 `any`。RPC 协议类型从包 `dist/**/*.d.ts` 复制为本地 `rpc-types.ts`(包未在 `exports` 导出)。

### 测试(★ 本项目硬性要求)
- 每个 spec 必须有 **单元/集成测试 + e2e 验证**,并以新鲜证据(实际运行输出)证明通过(参考 `kiro-verify-completion`)。
- 后端 RPC 桥用对真实子进程的集成测试;前端翻译层用纯函数单测;闭环用 e2e(选 agent 源 → prompt → 流式回复)。

### 代码质量
跟随既有代码的注释密度/命名/惯用法;偏好专用文件/搜索工具而非 shell。

## 关键技术决策

- **双模式同协议**:`runRpcMode`(SDK)与 `pi --mode rpc`(CLI)底层同实现 → 前后端桥接完全复用,仅 spawn 目标不同。
- **不直接用包内 `RpcClient`**:它写死 spawn `pi` 且未暴露 extension UI 子协议 → 自写 `PiRpcProcess`,处理 response/event/extension_ui_request 三类消息。
- **JSONL framing**:严格按 `\n` 切、剥 `\r`,禁用 Node `readline`(会误切 `U+2028/2029`)。
- **传输无关通道 `PiRpcChannel`**:`{send/onLine/close}`,`PiRpcProcess` 只是 `local` 实现;为 e2b/ssh/device 预留。
- **Bun 仅工具链,运行时坚持 Node**;agentDir 环境变量是 `PI_CODING_AGENT_DIR`(非 `PI_AGENT_DIR`)。
- **有状态长连接**:不能 Serverless/Edge(除非控制面/数据面分离);横向扩容需按 sessionId sticky routing。

---
_文档化标准与决策,而非罗列每个依赖。权威细节见 `PLAN.md`。_
