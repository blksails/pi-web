---
title: Technology Stack
description: "记录 pi-web 的语言、框架、运行时、关键库、测试命令与不可违反的技术决策。"
inclusion: always
---

# 技术栈

## 架构

```
浏览器(Vite React SPA — AI Elements + useChat)
   │  SSE / HTTP
   ▼
Hono host(server/index.ts — 一个 app.all("/api/*") → createPiWebHandler)
   │  stdin/stdout JSONL
   ▼
Agent 子进程 — bootstrap runner runRpcMode  或  pi --mode rpc(一会话一进程)
```

后端核心是一条 **传输无关的 RPC 通道**(`PiRpcChannel`);事件 → AI SDK `UIMessage` 流的翻译层是前后端枢纽。双模式共享同一 RPC 实现,只有 spawn 目标不同。

> 注:本项目已从 Next.js 迁移到 **Vite SPA + Hono host**(根目录 `.next-*` 目录、`next-env.d.ts` 及源码里 “Next/webpack externals” 字样均为历史遗留)。以 `package.json` + `server/`(Hono)+ `src/`(Vite)为准。

## 核心技术

- **语言**:TypeScript(strict,禁 `any`)
- **前端**:Vite 6 + React 19(SPA,`src/main.tsx` 入口);shadcn/ui(Radix + Tailwind 3)+ Vercel AI Elements;流/状态用 AI SDK v5(`ai` / `@ai-sdk/react`)+ 自定义 `ChatTransport`
- **HTTP host**:Hono 4(`@hono/node-server`);React Router 8
- **运行时**:Node `>=22.19.0`(pi `engines` 约束);工具链可用 Bun,但**运行时坚持 Node**
- **Agent runtime**:`@earendil-works/pi-coding-agent` SDK(`createAgentSessionRuntime` + `runRpcMode`);`@earendil-works/pi-ai`
- **Agent 载入**:`jiti`(运行时直接跑用户 `index.ts`)
- **构建**:Vite(client)→ esbuild(server)→ `pack-dist` → payload;桌面壳用 Tauri
- **沙箱/远程**:`e2b`、`ws`(为 e2b/ssh/device transport 预留);`pg`(会话/存储可选后端)
  —— ★ 这些**只在 `@blksails/pi-web-server`**,内核包 `@blksails/pi-web-core` 的依赖声明里不得出现
- **认证**:后端以可插拔 `authResolver` seam 为准(默认放行 `defaultAuthResolver`);可选多租户登录墙经 `PI_WEB_MULTI_TENANT` + Supabase(`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`)接入,非默认路径。

## 两套 LLM 调用面(勿混淆)

1. **llm-gateway**(`lib/app/llm-gateway-{config,assembly}.ts`):sandbox/e2b 分支的凭证开关。配置后**不下发真实 provider key**,改为按 provider 铸造 scoped token(`PI_LLM_GATEWAY_BASE` + `PI_LLM_TOKEN_<ID>`)注入沙箱。
2. **tool-kit/aigc**(`packages/tool-kit/src/aigc/`):AIGC 图像生成/编辑与 vision 工具自己的 OpenAI 兼容 provider 调用面(dashscope / newapi / openrouter / sufy 等)。

## 双入口边界(硬约束)

`@blksails/pi-web-tool-kit` 主入口 `.` 是**声明层(前端安全)**,只导出纯数据/类型;`./runtime` 子入口是 **node-only 执行层**(pi SDK + undici)。

- **模块顶层不得读 `process.env`**——浏览器 bundle eval 时 `process` 可能未定义,会破坏双入口(见 `aigc/providers/openai-compat.ts`、`newapi.ts` 注释)。env 一律由调用方注入或在 runtime 层惰性读取。
- 主入口**禁止**顶层直接/间接 import pi SDK / pi-ai / undici。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm install` | 安装(pnpm 9 workspace monorepo) |
| `pnpm dev` | API host `:3000` + Vite `:5173` |
| `pnpm build` | 生产构建(client→server→pack-dist→payload) |
| `pnpm start` | 跑生产构建(`node dist/server.mjs`) |
| `pnpm test` | 所有 workspace 包测试 |
| `pnpm test:app` | 应用级 vitest(**只覆盖 `test/**`,不含子包**) |
| `node scripts/scoped-test.mjs <测试文件...>` | **只跑指定测试文件**,自动路由到各自的 vitest 面(见下) |
| `pnpm e2e` | Playwright e2e |
| `pnpm e2e:node` | 离线 Node 级流式 e2e(`PI_WEB_STUB_AGENT=1` 桩 agent) |
| `pnpm typecheck` | 全包 + 应用类型检查 |

### 测试命令按作用域分档(★ 谁跑哪一档是有意区分的)

| 档 | 命令 | 实测耗时 | 谁跑 |
| --- | --- | --- | --- |
| 窄(按文件) | `node scripts/scoped-test.mjs <paths>` | 单文件子包 ~1.3s / 混合两面 ~2.8s | 实现者(kiro impl 的 implementer) |
| 类型检查 | `pnpm typecheck` | ~3.8s(根 `tsc -p tsconfig.json --noEmit`) | 实现者 + 复查者 |
| 全量(canonical) | `pnpm test` **+** `pnpm test:app` | `test:app` ~18.3s,`pnpm test` 视包数更久 | 复查者(回归判定) + 父层(合并后复核) |

★ **全量必须两条都跑**。`pnpm test:app` 的 include 只有 `test/**`,16 个子包各有自己的 vitest 配置——只跑根命令会漏掉子包的红,而它看起来和"全绿"一模一样。`pnpm test` 走 `pnpm -r --workspace-concurrency=1`,是子包那一面。

★ **`scoped-test.mjs` 存在的原因**:本仓是多测试面 monorepo,没有单条 vitest 命令能吃任意测试文件。根 config 的 alias / jsdom / `test/setup.ts` 与子包各自的配置互不通用,拿错面去跑会因解析不到 alias 而红——那是工具用错了,不是代码坏了,而两者长得一模一样。脚本按路径前缀路由(`packages/<pkg>/` → `pnpm --filter <包名> exec vitest run`,`test/` → 根 vitest),吃绝对路径与相对路径,任一面失败即非零退出;参数里没有任何可路由的测试文件时退出码 2 并明说"本次改动没有自动验证覆盖"——不把"没测试可跑"报成绿。

## 测试(★ 硬性要求)

每个 spec 必须有 **单元/集成测试 + e2e 验证**,并以新鲜证据(实际运行输出)证明通过。后端 RPC 桥用对真实子进程的集成测试;前端翻译层用纯函数单测;闭环用 e2e(选 agent 源 → prompt → 流式回复)。

## 关键技术决策(不可随意违反)

- **双模式同协议**:`runRpcMode` 与 `pi --mode rpc` 底层同实现,桥接复用,仅 spawn 目标不同。
- **不直接用包内 `RpcClient`**:它写死 spawn `pi` 且未暴露 extension UI 子协议 → 自写进程封装,处理 response/event/extension_ui_request 三类消息。
- **JSONL framing**:严格按 `\n` 切、剥 `\r`,**禁用 Node `readline`**(会误切 `U+2028/2029`)。
- **传输无关通道 `PiRpcChannel`**:`{send/onLine/close}`,local 实现只是其一;为 e2b/ssh/device 预留。
- **附件层**:引用而非 base64(历史/context 只放 `att_<id>`,base64 仅在喂 LLM 出口物化);HMAC 签名分发 URL 不绑会话;env `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET` 由主进程经 spawn 全权下发子进程(主/子同目录、同 secret,否则子进程签名 URL 在主进程 401)。
- **agentDir env 是 `PI_CODING_AGENT_DIR`**(非 `PI_AGENT_DIR`)。
- **内核包走源码直连导出**(`exports` 指向 `.ts`,无构建步骤)。由此推出一条硬约束:
  消费方的 `tsc` 会编译到内核的**每一个文件**,所以「把重依赖声明成 optional peerDependency」
  在本仓**不是可用选项** —— 缺类型即编译失败。值依赖 e2b / pg / MCP SDK / agent SDK 的实现
  一律留在 `pi-web-server`,内核只放端口与契约类型。
- **有状态长连接**:不能 Serverless/Edge(除非控制面/数据面分离);横向扩容需按 `sessionId` sticky routing。

---
_文档化标准与决策,而非罗列每个依赖。权威细节见 `PLAN.md` 与 `docs/`。_
