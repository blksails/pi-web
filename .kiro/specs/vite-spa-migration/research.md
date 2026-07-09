# Research & Design Decisions — vite-spa-migration

## Summary

- **Feature**: `vite-spa-migration`
- **Discovery Scope**: Complex Integration（既有系统的宿主层替换；P0/P1 已完成可执行实证）
- **Key Findings**:
  1. Next 耦合极浅（4 处 import、11 个薄转发器），但**分发链**深度绑定 `output: "standalone"` + nft。
  2. `scripts/pack-standalone.mjs` 的主体是在**修 nft 拍平 pnpm 符号链接造成的伤**；不用 nft 则该问题从根不存在——是净删而非重做。
  3. `runnerBootstrapPath()` / `resolvePiCliEntry()` 已内置「import.meta.url 被内联 → 回退 `process.cwd()`」的双路径解析，且**约定产物以 cwd = 产物根启动**。这条既有契约反过来**锁死了新产物的目录布局**。

## Research Log

### 1. Next 的真实耦合面

- **Context**: 迁移可行性的第一问：Next 到底被用了多少。
- **Sources**: `grep -rn "from \"next" app components lib packages middleware.ts`；`app/api/**/route.ts`；`app/page.tsx`；`app/session/[id]/page.tsx`。
- **Findings**:
  - 直接 import `next` 仅 4 处：`middleware.ts`（`NextResponse`/`NextRequest`）、`app/login/page.tsx`（`useRouter`，**不在 main 上**）、`app/layout.tsx`（`Metadata` 类型）、`packages/ui` 三处 eslint 注释。
  - `app/api/**` 下 11 个 route 文件全为 3–5 行转发器，统一形态 `getHandler()(req)`。
  - 两个 server component 都是 `force-dynamic`，只做「`loadConfig()` → 传 props」。
  - `lib/app/pi-handler.ts` 完全框架无关（纯 Node），可被任意宿主挂载。
- **Implications**: 宿主替换是**接缝级**改动，不触及 `packages/*`。R1 全部可满足。

### 2. `pack-standalone.mjs` 存在的原因

- **Context**: 563 行脚本是迁移成本的主要疑点。
- **Sources**: `scripts/pack-standalone.mjs` 注释（"Bug A 修复"、"跨机重定位修复"）；`next.config.ts` 的 `outputFileTracingIncludes`。
- **Findings**:
  - 主体动作：把被 nft **解引用拍平**的 pnpm 符号链接 relink 回 `.pnpm` 规范副本（否则 runner 子进程 `Cannot find module 'chalk'` 即崩）；处理 Windows realpath `EPERM`；恢复被内联绝对路径破坏的可重定位性；复制 `.next/static` 与 `public/`（standalone 不自带）。
  - 根因：pi SDK 是 `jiti` 在**运行时**动态 import 的子进程依赖，nft 静态追踪它属逆流；追踪后又重排依赖树，破坏 pnpm 的 realpath 解析布局。
- **Implications**: esbuild 只需把 pi SDK / jiti 标 `external` 并**按原始目录结构拷贝**，不拍平、不 relink。R5.2 由此可满足，且脚本净删。

### 3. 产物路径解析的既有契约（**最强约束**）

- **Context**: 决定 esbuild 产物布局与 CLI/desktop 入口。
- **Sources**: `packages/server/src/runner-bootstrap-path.ts`；`packages/server/src/extensions/cli/pi-cli.ts:43-60`；`bin/pi-web.mjs:219,250-252`；`lib/app/pi-handler.ts` 的 `stubAgentPath()`。
- **Findings**:
  - 两个解析器都是「① 从 `import.meta.url` 推算 → ② 失败或不存在则回退 `process.cwd()`」。注释明写：**standalone 产物以 cwd = 产物根启动**，`runner-bootstrap.mjs` 落在产物根下的 `packages/server/`，pi SDK 落在产物根的 `node_modules/@earendil-works/`。
  - esbuild 与 webpack 一样会把 `import.meta.url` 内联为构建机绝对路径 → 路径 ① 在异机/异 OS 必然失效，**必须依赖路径 ②**。
  - `stubAgentPath()` 默认 `path.join(process.cwd(), "lib", "app", "stub-agent-process.mjs")` —— `--stub` 模式（`cli-smoke.mjs`、浏览器 e2e）依赖它存在于产物根。
  - `bin/pi-web.mjs` 以 `dirname(serverJs)` 作 cwd 启动 server。
- **Implications（决定性）**:
  - 新产物**必须与 standalone 同构**：入口位于**产物根**（`dist/server.mjs`），而非 `dist/server/index.mjs`；否则 `dirname(serverJs)` 不等于产物根，路径 ② 回退全部失效。
  - 产物根下必须存在：`packages/server/runner-bootstrap.mjs`、`packages/server/src/**`（jiti 运行时读源码）、`node_modules/@earendil-works/**`（原结构）、`lib/app/stub-agent-process.mjs`、`client/**`。
  - `bin/pi-web.mjs` 与 `desktop/src/resolve-artifact.ts` 因此只需改**一个路径常量**，cwd 逻辑不动。

### 4. external 面比预期小

- **Context**: 确定 esbuild `external` 清单。
- **Sources**: `packages/server/package.json`；`next.config.ts:119-123`；`packages/server/src/session-store/sqlite-store.ts`。
- **Findings**:
  - `next.config.ts` 的 `serverExternalPackages` 只有三项：`jiti`、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`。
  - SQLite 后端用 **Node 内置 `node:sqlite`**（非 `better-sqlite3`），无原生模块。
  - `pg` 是纯 JS（可选原生加速 `pg-native` 缺失时自动降级）。
  - `zod` 纯 JS。
- **Implications**: `external` = pi SDK 两包 + `jiti`（运行时动态加载，且 `packages/server/src/**` 由 jiti 读源码）+ `pg`（含可选 `require('pg-native')`，避免 esbuild 静态解析失败）。其余可 bundle。

### 5. Webext 加载与 CSP（P0 实证）

- **Context**: 迁移的原最高风险项。
- **Sources**: commit `8ff1e23`（`spike/` 目录，含反证）；`packages/react/src/web-ext/extension-loader.ts`；`app/api/webext/singletons/[name]/route.ts`；`next.config.ts:129-141`。
- **Findings**:
  - 单例端点只是从 `window.__PI_WEBEXT_SINGLETONS__` re-export，**完全框架无关**，删掉 `export const runtime/dynamic` 即可搬走。
  - `import(/* webpackIgnore: true */ u)` 中 `u` 是**变量**，Vite 原样保留为原生运行时 import；`extension-loader.ts` 无需改动。
  - 实证：真实 `webext-renderer` dist 在禁 `unsafe-eval` 的生产 CSP 下 `loadStatus: "loaded"`，单例 `useState` 引用相等，renderer 渲染进 DOM；产物 0 个 `new Function` / `eval(` / `__vitePreload`。
  - 反证：注入 `new Function` → `EvalError: ... 'unsafe-eval' is not an allowed source` → 判定翻红。
- **Implications**: R4 全部可满足。两条硬约束进设计：动态 import 的 URL 必须走变量（`/* @vite-ignore */` 对字面量无效，Rollup 仍静态解析并构建期报错）；`build.target: "esnext"` + `modulePreload.polyfill: false`。
  - 附带：生产 CSP 的 `'unsafe-inline'` 只为 Next 内联 hydration bootstrap 存在（`next.config.ts:132-133` 注释自陈），SPA 下可收紧（R7.5）。

### 6. 宿主对等性（P1 实证）

- **Context**: 证明新宿主行为零回归。
- **Sources**: commit `5e81fc8`（`server/`、`e2e/parity/compare.mjs`）。
- **Findings**:
  - 一条 `app.all("/api/*")` 取代 11 个转发器；`c.req.raw` 是标准 `Request`，SSE `ReadableStream` 原样透传。
  - 完整回合（含应答 stub 的 `extension-ui` confirm）后规范化逐字节对比：**29 帧一致，11/11 项绿**。
  - **harness 的第一次「全绿」是假绿**：`POST /messages` body 字段应为 `message` 非 `text` → 两侧都 400 → SSE 只剩 4 个握手 control 帧 → 「一致地什么都没发生」使全项通过。补 liveness 前置断言后暴露。
  - stub 的真实帧只有 `control` / `uiMessageChunk` 两类（不存在 `agent_end` 事件名）；回合中途 stub 发 confirm 请求并**阻塞等应答**。
  - 反证探针（`P1_BREAK=1` 篡改 status / content-type）确认 harness 会报 `MISMATCH`。
- **Implications**: R1、R2、R6 的验证方法已定型。R6.3/R6.4 直接来自这次踩坑。

### 7. 迁移面清单（e2e 与静态资源）

- **Context**: 界定 P2/P3 的实际工作量。
- **Sources**: `playwright.config.ts`；`e2e/browser/*.e2e.ts`（43 个）；`e2e/cli/*.mjs`；`e2e/desktop/*.mjs`；`vitest.node-e2e.config.ts`；`public/`；`tailwind.config.ts`。
- **Findings**:
  - 浏览器 e2e **43 个 spec**，`testMatch: /.*\.e2e\.ts/`，串行；project `fs`（默认全跑）与 `sqlite`（仅 `session-persistence.e2e.ts`）。webServer 用 `next start` + `PI_WEB_DISABLE_STANDALONE=1`。
  - `aigc-image-edit.e2e.ts` 打**真实网关**（需 API key），非离线可跑。
  - CLI e2e 四个均硬编码 `NEXT_DIST_DIR ?? ".next-cli"` + `standalone/server.js`。
  - `public/` 仅含 `webext-artifact/artifact.html`（Tier4 iframe，门控 `NEXT_PUBLIC_PI_EXTENSION_BASE_URL`）。
  - `vitest.node-e2e.config.ts` 有 5 条 tool-kit 子路径 alias（vite 不解析 workspace 子路径 exports）——**新 vite.config 必须复刻**，否则 handler 集成路径崩。
  - `tailwind.config.ts` 的 `content` 含 `./app/**/*.{ts,tsx}`，需改为新前端源目录。
  - `app/login/page.tsx` 在 `main` 上**不存在**（属未提交的多租户 WIP）。
- **Implications**: R3 只有三条路由；R6.1 的"不削弱断言"意味着 43 个 spec 原样通过，仅改 webServer 启动方式；`aigc-image-edit.e2e.ts` 需在验收中显式标注为需真实 key 的可选项。

## Architecture Pattern Evaluation

| 选项 | 结论 |
| --- | --- |
| Astro | **否决**。其 Node adapter 的 "standalone" 名字撞车但产物仍依赖 `node_modules`（upstream issue #7247）；岛屿/SSG 卖点对一个全 `force-dynamic`、SSE 长连接的聊天 SPA 一条都用不上。 |
| 保留 Next | 维持现状成本：RSC 边界、Edge 约束、563 行 pack-standalone。 |
| **Vite + React Router + Hono 适配器 + esbuild** | **采纳**。前端本就是 SPA；`createPiWebHandler` 本就是 fetch handler；external + 原结构拷贝根除 relink 问题。 |

### 关键设计决策

1. **Hono 降级为适配器，而非框架**：只用 `@hono/node-server` 的 `serve()` 与 `app.all`。理由：`createPiWebHandler` 是 fetch-native，`IncomingMessage ↔ Request/Response` 的桥接（尤其 SSE 背压与断连语义）不该在宿主层重写。避免用一个框架依赖替换另一个。
2. **路由库选 React Router**：仅三条路由，`wouter` 体积更小；但 pi-web 是本地/自托管应用，前端体积非瓶颈，而 43 个 e2e 依赖导航与深链行为的稳定性。React Router 的成熟度与 data API（对 bootstrap 加载有直接帮助）价值更高。
3. **产物入口置于产物根**（见 §3）：`dist/server.mjs`，与 standalone 同构。这是被既有 cwd 回退契约**强制**的，非风格选择。
4. **bootstrap 端点收编 15 个 `NEXT_PUBLIC_*`**：它们在 Next 下是构建期内联（CLI 运行时设置无效）。收进 `/api/bootstrap` 后成为真正的运行时配置，顺带修掉现存缺陷（R2.2）。

## Risks

| 风险 | 缓解 |
| --- | --- |
| 产物入口位置错放导致 `runnerBootstrapPath()` / `resolvePiCliEntry()` 的 cwd 回退失效，真实会话在重定位后崩溃 | 入口固定在产物根；`e2e:cli:reloc`（藏原构建目录 + 异路径执行）是唯一可信验收 |
| esbuild 内联 `import.meta.url`，Windows 上 `fileURLToPath` 抛 `ERR_INVALID_FILE_URL_PATH` | 既有代码已 try/catch 回退 cwd；CI 三平台矩阵（Ubuntu 构建 → 三平台运行）保持不变 |
| Vite 低 target 注入需 `unsafe-eval` 的动态 import polyfill | `build.target: "esnext"` + `modulePreload.polyfill: false`；产物静态审计 `new Function` / `eval(` 计数为 0 |
| 动态 import 的 URL 写成字面量 → Rollup 构建期 `failed to resolve import` | 约定 URL 必经变量；`extension-loader.ts` 已满足，禁止改动 |
| e2e harness 假绿（「一致地什么都没发生」） | 每个 harness 必须有 liveness 前置断言 + 反证探针（R6.3/R6.4） |
| `vitest.node-e2e.config.ts` 的 5 条 tool-kit 子路径 alias 遗漏 | 新 `vite.config.ts` 复刻同一 alias 表，否则 handler 集成路径静默崩 |
| Tier4 artifact iframe 门控时序从「构建期已知」变为「bootstrap 到达后」 | `<BootstrapGate>` 在配置到达前不渲染依赖门控的子树（R3.5） |
