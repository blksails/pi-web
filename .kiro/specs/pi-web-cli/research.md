# Research Log — pi-web-cli

> Discovery 类型：**Light（Extension / 集成导向）**。在既有 Next.js app shell 上叠加一个 CLI 启动层与自包含构建产物，不改业务逻辑。

## 1. Discovery 范围

- 既有运行方式：`next dev` / `next start`，依赖完整 monorepo 源码树（pnpm workspace，`@pi-web/*` 走 `transpilePackages` 原始 TS 编译，pi SDK 走运行时外置）。
- 目标：交付可全局安装、参数驱动的 `pi-web` CLI，运行于脱离开发树的自包含产物。
- 边界：本地可跑 + 参数；不含 npm publish / 依赖内联发布。

## 2. 关键发现

### 2.1 配置入口已是纯 env 驱动（零侵入可行）
`lib/app/config.ts` 的 `loadConfig(env)` 全部从 `process.env` 读取：
- `PI_WEB_DEFAULT_SOURCE` → 默认 agent source
- `PI_WEB_DEFAULT_CWD`（默认 `process.cwd()`）→ 会话工作目录
- `PI_WEB_AGENT_DIR` / `PI_CODING_AGENT_DIR` → pi 配置目录
- `PI_WEB_STUB_AGENT` → stub 模式
- provider keys → 仅透传，不回显

**结论**：CLI 只需把参数翻译成这些 env，再启动 server，无需改任何业务代码。

### 2.2 server 进程 cwd 会变 → 相对路径必须在 CLI 侧 resolve
Next standalone 的 `server.js` 运行时 `process.cwd()` 是 standalone 目录，而非用户调用 CLI 的目录。因此 `loadConfig` 的 `defaultCwd` 默认值（`process.cwd()`）在 CLI 场景下不可靠。
**对策**：CLI 必须把 `[source]`、`--cwd` 的相对路径以「用户调用时的工作目录」为基准 `path.resolve` 成绝对路径后再注入 env（`PI_WEB_DEFAULT_SOURCE`/`PI_WEB_DEFAULT_CWD`）。信任根（`makeProjectTrustPolicy` 用 `config.defaultCwd` 作 trustedRoots）也据此正确锚定。

### 2.3 ★ runner / pi-cli 子进程依赖不在 Next server bundle 内（P0）
会话激活时主进程 spawn 子进程：
- **custom 模式**：`runnerBootstrapPath()` → `packages/server/runner-bootstrap.mjs`（路径由 `import.meta.url` 计算，cwd 无关）。该 `.mjs` 运行时经 **jiti** 动态 import `packages/server/src/runner/runner.ts` 及其全部源码依赖，再加载用户 agent 入口（同样 jiti）。
- **cli 模式**：`resolvePiCliEntry()` → `@earendil-works/pi-coding-agent` 包的 `dist/cli.js`。

这些是**运行时动态 spawn 的独立 Node 进程**，Next 的 webpack 不会把它们打进 server bundle，nft（输出文件追踪）默认也追不到 jiti 的运行时动态 import。
**对策**：`next.config.ts` 用 `outputFileTracingIncludes` 显式把以下纳入 standalone：
- `packages/server/runner-bootstrap.mjs` 与 `packages/server/src/**`（runner 源码）
- `packages/server/node_modules/@earendil-works/**`（pi SDK：pi-coding-agent + pi-ai，含 `dist/cli.js`）
- `jiti`
- runner 经 jiti alias 解析的作者包（`@blksails/pi-web-agent-kit`、`@blksails/pi-web-tool-kit` 等）与 `examples/**`（受信 cwd 内示例 agent）

### 2.4 ★ runner-bootstrap-path 的 import.meta.url 在 standalone 下需实测（P0）
`runner-bootstrap-path.ts` 被编入 Next server bundle（`@blksails/pi-web-server` 在 `transpilePackages`）。其 `runnerBootstrapPath()` 依 `import.meta.url` 推算 `packages/server/runner-bootstrap.mjs` 的绝对路径。standalone 重定位 server 产物后，该计算是否仍指向真实存在的 `.mjs` **必须以实跑验证**。若解析失败，候选对策：保持 standalone 内 `packages/server` 物理布局、或改由 env 显式提供 bootstrap 路径。

> 当前 `next start`（完整 monorepo 在原地）下真实会话可用，证明路径机制本身正确；风险仅出现在 standalone「重定位 + 裁剪文件」后，故列为实现期 e2e 必过关卡。

### 2.5 Next standalone 标准行为
- `output: "standalone"` 产出 `.next/standalone/`，含最小化 `server.js` + nft 追踪的 `node_modules`。
- standalone **不**自带 `.next/static` 与 `public/`，须构建后手动 copy 进 `.next/standalone/`（标准收尾步骤）。
- `server.js` 读 `PORT`、`HOSTNAME` env 决定监听地址。
- monorepo 场景需设 `outputFileTracingRoot` 锚定追踪根，确保 `packages/**` 与 pnpm 嵌套依赖被纳入。

## 3. 技术对齐

| 关注点 | 决策 | 依据 |
|---|---|---|
| 参数解析 | `node:util` 的 `parseArgs`，零第三方依赖 | 与 steering「最小依赖」一致；CLI 是薄层 |
| 启动方式 | spawn `node .next/standalone/server.js`，env 注入，stdio 继承，转发 SIGINT/SIGTERM | 复用 Next 官方 standalone server，不自写 HTTP 装配 |
| 就绪检测 | 轮询 `http://host:port` 直至可连，再触发 `--open` | 避免在 server 未就绪时打开浏览器 |
| 浏览器打开 | 按平台调 `open`(macOS)/`xdg-open`(Linux)/`start`(Win) | 零依赖；失败不致命 |
| Node 版本 | 复用 `engines.node >=22.19.0` | pi SDK 约束（tech.md） |

## 4. 集成风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| runner/pi-cli 子进程依赖未进 standalone → 真实会话起不来 | P0 | `outputFileTracingIncludes` 显式纳入（2.3）；e2e 真实会话验证 |
| `runnerBootstrapPath()` 在 standalone 下解析到不存在路径 | P0 | 实测；保持 `packages/server` 物理布局或 env 兜底（2.4） |
| 相对 source/cwd 在 server 新 cwd 下错位 | P1 | CLI 侧 `path.resolve` 为绝对路径（2.2） |
| 静态资源缺失 → 页面裸奔 | P1 | pack 脚本 copy `.next/static` + `public`（2.5） |
| 端口占用 | P2 | 捕获 server 启动错误，可读报错 + 非零退出 |
| 改 next.config 影响 dev | P1 | `output`/tracing 仅作用于 build，不改 dev 行为；回归 `next dev` |

## 5. Synthesis 结论

- **Build-vs-adopt**：采用 Next 原生 `output:"standalone"` 而非自写打包；CLI 仅做参数→env→spawn 的薄编排。
- **简化**：不引入 commander/yargs 等 CLI 框架，`node:util parseArgs` 足够覆盖本期参数集。
- **非侵入**：所有改动集中在 `next.config.ts`（build-only 字段）、新增 `bin/`、`scripts/`、`package.json` 元数据；业务代码零改动。
