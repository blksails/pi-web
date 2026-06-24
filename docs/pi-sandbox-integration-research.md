# pi-sandbox 集成研究:为每个 agent source 提供可独立配置的文件/网络沙箱

> 研究日期:2026-06-19 · 基线 HEAD `bc713ad` · SDK `@earendil-works/pi-coding-agent@0.79.6` · pi-sandbox `0.4.3`
> 关联:`docs/pi-trust-loading-design.md`、`NOTES_extensions.md`
> 目标:把已安装的 `pi-sandbox` 集成到**每一个 agent source**;每个 source 可**独立配置**;默认 agent **只能读写自己的 project dir**;支持**全局 agents 访问规则**。
>
> **当前状态(2026-06-19):即时配置(方案 A)已落地——见 §10。** 已写入全局 `~/.pi/agent/sandbox.json`(严格默认:仅 project dir + 零额外出网),对所有会话生效,无需任何项目级文件。方案 B(中心化 + 独立 agentDir)为后续目标,见 §6/§9。

---

## 0. 结论速览(TL;DR)

1. **天然契合点已存在,改动量小。** pi-web 的每个会话都是**独立子进程**(custom: `node runner-bootstrap --agent … --cwd <dir>`;cli: `node pi-cli --mode rpc`)。`pi-sandbox` 依赖的 `@carderne/sandbox-runtime` 的 `SandboxManager` 是**进程级单例**——独立进程 = **per-session 沙箱隔离开箱即用**,无需自己做隔离。

2. **运行时兼容性已核实通过。** pi-sandbox 源码 import `@mariozechner/pi-coding-agent` / `@mariozechner/pi-tui`(本仓库没装),但 **earendil 的扩展加载器 `dist/core/extensions/loader.js` 内置 jiti 别名** `@mariozechner/* → @earendil-works/*`(已核实第 41–84 行)。pi-sandbox 需要的全部值导出(`createBashToolDefinition`/`getShellConfig`/`isToolCallEventType`/`SettingsManager`/`getAgentDir` + pi-tui 的 `matchesKey`/`truncateToWidth`/`Key`)都由 earendil fork 重导出。`@carderne/sandbox-runtime` 已与 pi-sandbox 同装于 `~/.pi/agent/npm/node_modules`。**通过 pi 自身加载器加载即可运行。**

3. **配置三层模型已经满足三个需求**——pi-sandbox 的 `loadConfig(cwd)` 做 `DEFAULT_CONFIG ⊕ <agentDir>/sandbox.json(全局) ⊕ <cwd>/.pi/sandbox.json(项目)` 深合并、项目优先。映射:
   - **全局 agents 访问规则** → `<agentDir>/sandbox.json`(pi-web 经 `PI_CODING_AGENT_DIR` 控制 `agentDir`)。
   - **每个 source 独立配置** → `<cwd>/.pi/sandbox.json`(cwd = 该 source 解析后的本地目录,天然 per-source)。
   - **默认只读写 project dir** → 设默认 `allowRead/allowWrite = ["."]`(`.` = cwd = project dir)。

4. **headless 行为恰好正确。** rpc 模式无 TTY,pi-sandbox 的交互授权弹窗(`ctx.ui.custom`)会立即返回 `"abort"` → `tool_call` 返回 `{block:true}`,即**白名单之外硬拦截、不可临时放行**。对 pi-web 这正是期望语义(策略完全声明式、由配置驱动,agent/用户无法运行时越权)。代价:无法像 TUI 里那样交互式临时加白——只能改配置。

5. **现状:pi-sandbox 已以 user-scope 安装并注册**(`~/.pi/agent/settings.json` 的 `packages[]` 含 `npm:pi-sandbox`),但**尚无任何 `sandbox.json`**,故现在跑的是 pi-sandbox 内置 `DEFAULT_CONFIG`,且 user-scope 扩展**不受 trust 门控**,对所有会话生效。`rg` 已装(15.1.0),平台 darwin 受支持。

6. **唯一真正需要决策/编码的两点**:① 每个 source 的"独立配置"放在**源码树内 `.pi/sandbox.json`** 还是 **pi-web 中心化管理**(git/临时克隆源不宜写入源码树);② 默认策略**严格度**(纯 project dir,还是放宽 `~/.config` 等)。其余基本是"配置 + 一处注入"。

---

## 1. pi-sandbox 是什么、怎么工作(已逐字核实 `index.ts`)

- **形态**:一个 pi 扩展,`export default function (pi: ExtensionAPI)`。注册 `--no-sandbox` flag、`bash(sandboxed)` 工具、`/sandbox*` 命令,并挂 `session_start` / `tool_call` / `user_bash` / `session_shutdown` 钩子。
- **两层强制**:
  - **bash**:用 `sandbox-exec`(macOS)/`bubblewrap`(Linux)包裹命令,OS 级强制网络与文件系统限制。
  - **read/write/edit 工具**:在 `tool_call` 钩子里按同一文件系统策略拦截(这些工具跑在 Node 进程内,OS 沙箱覆盖不到)。
- **配置加载** `loadConfig(cwd)`:`DEFAULT_CONFIG ⊕ <getAgentDir()>/sandbox.json ⊕ <cwd>/.pi/sandbox.json`,深合并、**项目级优先**。`getAgentDir()` 读 `PI_CODING_AGENT_DIR`(否则 `~/.pi/agent`)。
- **DEFAULT_CONFIG**(节选):
  ```jsonc
  { "enabled": true,
    "network": { "allowedDomains": ["npmjs.org","*.npmjs.org","github.com","*.github.com","pypi.org", …], "deniedDomains": [] },
    "filesystem": {
      "denyRead":  ["/Users","/home"],
      "allowRead": [".", "~/.config", "~/.local", "Library"],
      "allowWrite":[".", "/tmp"],
      "denyWrite": [".env",".env.*","*.pem","*.key"] } }
  ```
- **优先级语义(易错,务必记住)**:
  - **读**:任何不在 `allowRead` 的路径都**提示**;`denyRead` **不是硬拦截**,只是"默认拒"区域,授权会写入 `allowRead` 反超 `denyRead`。
  - **写**:`denyWrite` **硬拦截、永不提示、压过 `allowWrite`**;`allowWrite` 为空 = 全拒。
  - **网络**:不在 `allowedDomains` 的域**提示**;`deniedDomains` OS 级硬拦截。`"*"` 放行所有域(有告警)。
- **授权落盘四选项**(仅 TUI 有效):session(仅内存)/ project(写 `.pi/sandbox.json`)/ global(写 `~/.pi/agent/sandbox.json`)/ abort。
- **headless(pi-web rpc)**:`ctx.hasUI=false` → 弹窗即 `abort` → 非白名单一律 `{block:true}` 硬拦截。`session_start` 里的 `ctx.ui.notify/setStatus` 在 rpc 下有 `ctx.ui` 对象(pi-probe 扩展同款用法已 e2e 通过),不会抛。

---

## 2. pi-web spawn 架构与注入点

解析管道(`agent-source/resolver.ts`):`identify → (git/plugin) → probeEntry → decideMode → trustPolicy → applyTrust → assemble`,产出 `SpawnSpec { cmd:"node", args, cwd, env }`。两种模式:

| 模式 | 触发 | 启动命令 | 扩展加载途径 |
|---|---|---|---|
| **custom** | 源目录有入口文件 | `node runner-bootstrap --agent <entry> --cwd <dir> [--agent-dir]` | pi-web 自己的 runner → `createAgentSessionServices` 的 resourceLoader 发现 `<agentDir>/extensions` 与(trusted 时)`.pi/extensions`;装载走 SDK 内部 `loader.js`(**含 @mariozechner 别名**) |
| **cli** | 源目录无入口 | `node pi-cli.js --mode rpc` | **就是 earendil pi CLI 本体**,原生发现 user-scope 包(含已注册的 `npm:pi-sandbox`)+ trusted `.pi/extensions`,`-e <path>` 可显式加载 |

**关键注入位置(已读源码)**:
- `agent-source/trust-apply.ts → applyTrust()` 产出 `TrustFragment { extraArgs, extraEnv }`,被 `assemble-spawn.ts` 并入 `SpawnSpec`。**这是给 cli 模式追加 `-e <sandbox>` / 给两模式注入 sandbox 相关 env 的天然位置**(但注意:applyTrust 被扩展安装的 trust-landing 子系统复用,改动需谨慎,优先走 env 而非改既有 CLI 参数语义)。
- `runner/option-mapper.ts → buildRuntimeFactory()`:custom 模式的运行时装配。`resourceLoaderOptions.extensionFactories` / `additionalExtensionPaths` 可**强制追加** sandbox 扩展(不依赖用户 agent 代码)。注意 `allowExtensions:[]`(noExtensions)会跳过磁盘发现,但**显式追加项仍保留**——故强制注入用"追加 path/factory"而非依赖发现最稳。
- `lib/app/pi-handler.ts → makeRealResolver`:注入 `agentDir` / `baseEnv` / `runnerEntry` / `piCliEntry` / `trustPolicy` 的总装配点——**计算并下发每个 source 的有效沙箱配置(env/agentDir)的入口**。
- `http/routes/create-session.ts` + `protocol/rest-dto.ts`:若要让"建会话请求"携带 per-session 策略覆盖(可选增强),在此扩展 DTO。

---

## 3. 兼容性核实结论(逐条已验证)

| 项 | 结论 | 证据 |
|---|---|---|
| earendil fork 是否导出 pi-sandbox 需要的符号 | ✅ 全部存在 | `@earendil-works/pi-coding-agent` 重导出 `createBashToolDefinition/getShellConfig/isToolCallEventType/SettingsManager/getAgentDir`;`@earendil-works/pi-tui` 有 `matchesKey/truncateToWidth` |
| `@mariozechner/*` 未安装会否致 pi-sandbox 加载失败 | ✅ 不会 | earendil `dist/core/extensions/loader.js` 第 41–84 行内置 jiti 别名 `@mariozechner/pi-coding-agent|pi-tui|pi-ai|pi-agent-core → 各 earendil 包` |
| `@carderne/sandbox-runtime` 是否就绪 | ✅ 已装 | `~/.pi/agent/npm/node_modules/@carderne/sandbox-runtime` 存在 |
| `rg` 前置 | ✅ 15.1.0 | `/opt/homebrew/bin/rg` |
| 平台 | ✅ darwin 受支持 | sandbox-exec 路径 |
| pi-sandbox 注册状态 | ✅ user-scope 已注册 | `~/.pi/agent/settings.json` `packages[]` 含 `npm:pi-sandbox` |

> ⚠️ 注意:runner 的 `agent-loader.ts buildResolutionAliases()` 只为加载**用户 agent 入口文件**配 `@earendil-works/*` 别名,**不含 `@mariozechner/*`**。但**扩展**由 SDK 内部 `loader.js` 加载(自带别名),二者是不同的 jiti 实例,互不影响——所以 custom 模式加载 pi-sandbox 走的是带别名的那条,OK。

---

## 4. 配置分层 → 三需求映射

```
有效配置 = pi-sandbox DEFAULT_CONFIG
         ⊕ <agentDir>/sandbox.json        ← 全局 agents 访问规则(需求 3)
         ⊕ <cwd>/.pi/sandbox.json          ← 每个 source 独立配置(需求 1),项目优先
```

- **需求 1「集成到每个 source」**:让 sandbox 扩展在**两种 spawn 模式下默认启用**(见 §5/§6)。
- **需求 2「独立配置」**:`<cwd>/.pi/sandbox.json`。cwd 即每个 source 解析后的本地目录(`ResolvedSource.cwd`),天然一源一配。
- **需求 3「默认只读写 project dir」**:把有效默认收紧为
  ```jsonc
  { "enabled": true,
    "filesystem": {
      "denyRead":  ["/"],                 // 或保守:["/Users","/home"]
      "allowRead": ["."],                 // 仅 project dir(按需 + "~/.config" 等只读必需)
      "allowWrite":["."],                 // 仅 project dir(按需 + "/tmp")
      "denyWrite": [".env",".env.*","*.pem","*.key","*.crt"] },
    "network": { "allowedDomains": [/* 收敛 */], "deniedDomains": [] } }
  ```
  `.` 经 `canonicalizePath` 解析为 cwd 绝对路径 + 前缀匹配 → 等价"项目目录子树"。
- **需求 3「可配置全局规则」**:把上面这份作为 `<agentDir>/sandbox.json`,**所有 agent 继承**;某个 source 需要更宽/更严,在其 `<cwd>/.pi/sandbox.json` 覆盖。

---

## 5. 注入方式:让两种模式都默认启用 sandbox

- **cli 模式**:pi-sandbox 已是 user-scope 包,pi CLI 原生加载——**已经生效**(只是当前用默认配置)。要强制/显式,可在 `applyTrust` 的 cli 分支经 `extraArgs` 追加 `-e <pi-sandbox/index.ts 绝对路径>`(确保即便用户改了注册表也启用)。
- **custom 模式**:在 `buildRuntimeFactory()` 把 sandbox 扩展**追加进 `resourceLoaderOptions.additionalExtensionPaths`**(指向 `~/.pi/agent/npm/node_modules/pi-sandbox/index.ts`),从而不依赖磁盘发现、不被 `allowExtensions:[]` 排除。其依赖 `@carderne/sandbox-runtime` 从 pi-sandbox 自身 node_modules 解析,`@mariozechner/*` 由 SDK loader 别名解析。
- **统一开关**:经 `baseEnv` 注入 `PI_WEB_SANDBOX=1|0`(在 pi-handler 总装配),让 pi-web 侧能整体启停,而不污染 pi-sandbox 的 `--no-sandbox` 语义。

---

## 6. 推荐方案(分级,按改动量/收益排序)

### 方案 A — 纯配置(零代码,先落地验证)
1. 写 `<agentDir>/sandbox.json` 全局严格默认(§4)。pi-web 当前 `agentDir` 即 `PI_CODING_AGENT_DIR`(`~/.pi/agent` 或注入值)。
2. 对需要差异化的 source,在其源码树放 `.pi/sandbox.json`。
3. 依赖 pi-sandbox 已注册的 user-scope 自动加载。
- **优点**:今天就能验证端到端;**缺点**:全局只有一份;per-source 配置必须写进源码树(git/临时源不友好);无法从 pi-web 中心化按 source 下发。

### 方案 B(推荐)— 中心化按 source 渲染配置 + 强制注入
在 `agent-source/` 加一个 **`sandbox-policy` 解析器**(与 trust 平行),`pi-handler` 在 resolve 后:
1. 从 **pi-web 自己的策略存储**(键=解析后的本地 dir 或 source 串;复用 `config/` 子系统或新增 JSON 存储)读取该 source 的覆盖,与全局默认深合并 → **有效配置**。
2. 把有效配置**渲染落地**:写到 `<perSourceAgentDir>/sandbox.json`,并为该 spawn 注入 `PI_CODING_AGENT_DIR=<perSourceAgentDir>` —— 这样**每个 source 拿到自己独立的"全局" sandbox.json**,且**不写进源码树**(对 git/临时克隆友好)。
3. 在 `buildRuntimeFactory` / `applyTrust` 强制启用扩展(§5)。
- **优点**:真正 per-source 独立、中心化可管理、不碰源码树、默认严格;**缺点**:需注意 `PI_CODING_AGENT_DIR` 复用会影响 extensions/agents/skills 发现根——若要"独立 sandbox 配置但共享其它资源",应让 per-source agentDir **软链/继承** user 级资源,或改用方案 C 的 env 直投。

### 方案 C(最干净,推荐用于规避 agentDir 副作用)— vendored 薄 fork + env 直投配置
在 `packages/server` 内 vendoring 一份 ~30 行改动的 pi-sandbox(或加一层 wrapper 扩展),**唯一改动**:`loadConfig` 优先读 `process.env.PI_WEB_SANDBOX_CONFIG`(文件路径)或 `PI_WEB_SANDBOX_CONFIG_JSON`(内联 JSON),回退原文件逻辑;import 改为 `@earendil-works/*`(免依赖 loader 别名)。pi-web 按 source 计算有效配置后经 env 直投,**完全不写盘、不动 agentDir**。
- **优点**:per-source 配置零副作用、最可控、headless 干净;**缺点**:维护一份小 fork(随 pi-sandbox 升级需跟)。

> **取舍建议**:先 **A** 打通端到端与默认策略;再上 **B 或 C** 实现"中心化 + 每源独立"。若顾虑 `PI_CODING_AGENT_DIR` 影响资源发现,直接选 **C**。

---

## 7. 实施步骤(以方案 B/C 为目标的落地清单)

1. **默认策略常量**:`agent-source/sandbox-defaults.ts` —— 导出"仅 project dir"基线(§4),含 `denyWrite` 敏感文件。
2. **策略解析器**:`agent-source/sandbox-policy.ts` —— `resolveSandboxPolicy({ dir, source, requestOverride? }) → EffectiveSandboxConfig`,做 `默认 ⊕ 全局存储 ⊕ per-source 覆盖` 深合并(沿用 pi-sandbox 的合并语义)。
3. **注入装配**:
   - `runner/option-mapper.ts buildRuntimeFactory`:追加 `additionalExtensionPaths += [piSandboxEntry]`(custom)。
   - `agent-source/trust-apply.ts` 或 `assemble-spawn.ts`:cli 分支 `extraArgs += ["-e", piSandboxEntry]`;两模式 `extraEnv += { PI_WEB_SANDBOX, PI_WEB_SANDBOX_CONFIG[_JSON] }`(方案 C)。
   - `lib/app/pi-handler.ts makeRealResolver`:调用策略解析器、决定落盘(B)或 env 直投(C)。
4. **(可选)DTO 增强**:`protocol/rest-dto.ts` `CreateSessionRequestSchema` 加 `sandbox?: {...}` 让建会话请求带 per-session 覆盖;`create-session.ts` 透传。
5. **vendored fork(仅方案 C)**:`packages/server/src/sandbox/extension.ts`(基于 pi-sandbox 0.4.3,改 import + `loadConfig` env 优先)。
6. **测试**:
   - 单测:策略合并、默认严格性、注入 args/env 装配。
   - e2e(参照 `test/runner/trust-pi-loading.e2e.test.ts` 真启 runner):验证 ① project dir 内写入放行;② 项目外写入被 `{block}`;③ per-source `.pi/sandbox.json` 覆盖生效;④ 全局规则继承。

---

## 8. 风险与前置

- **前置依赖**:`rg`(已装)、darwin/linux(Linux 还需 `bubblewrap`/`socat`)。部署到非 mac/Linux 时 sandbox 自动禁用(degrade,不报错)。
- **headless 无交互放行**:策略必须**预先声明完整**;白名单外硬拦截。需在产品上提供"改配置/重启会话"而非运行时弹窗。
- **git/临时克隆源**:不要把 per-source 配置写进易被覆盖的克隆树 → 用方案 B 的独立 agentDir 或方案 C 的 env 直投。
- **`PI_CODING_AGENT_DIR` 副作用**:它同时是 extensions/agents/skills/trust 库的根。若为隔离 sandbox 配置而 per-source 改它,会改变这些资源的发现 → 优先方案 C(只投 sandbox 配置,不动 agentDir)。
- **trust 与 sandbox 是两套机制**:trust 决定**是否加载** `.pi/` 资源;sandbox 决定**已加载后能读写哪里**。二者正交,务必不要混淆(本仓库 trust 链见 `pi-trust-loading-design.md`)。user-scope 的 pi-sandbox 不受 trust 门控,对所有会话生效——这正是"全局规则"想要的。
- **fork 维护(方案 C)**:pi-sandbox 升级时同步 ~30 行改动。
- **网络默认**:DEFAULT_CONFIG 放行了 npm/github/pypi 等;若要"默认零出网",需在全局 sandbox.json 显式收敛 `allowedDomains: []`。

---

## 9. 决策记录(2026-06-19 已拍板)

| 决策点 | 选定 | 含义 |
|---|---|---|
| **每源配置存放** | **方案 B —— 中心化 + 独立 agentDir** | pi-web 维护中心策略存储,按 source 计算有效配置 → 写到 per-source 的 `<agentDir>/sandbox.json` 并注入 `PI_CODING_AGENT_DIR`。不写源码树、可中心管理。 |
| **默认策略严格度** | **严格 —— 仅 project dir + 零额外出网** | `allowRead/allowWrite = ["."]`;`allowedDomains = []`(默认不出网);`denyWrite` 保留敏感文件。按源/会话再放宽。 |
| **落地节奏** | **暂停在研究阶段,本轮不编码** | 本文档即交付物;后续按 §7 实施。 |

### 方案 B 的 agentDir 副作用——落地时必须处理(待办,非本轮)
`PI_CODING_AGENT_DIR` 同时是 extensions/agents/skills/trust 库 与 user 级 npm 包(含 pi-sandbox 本体)的发现根。若 per-source 改成全新空目录,会**丢失 user 级资源与 pi-sandbox 自身**。落地时二选一:
- **(B-1)** per-source agentDir 里**软链/复制** user 级 `extensions/`、`agents/`、`skills/`、`npm/`、`trust` 库,仅 `sandbox.json` 各源独立;或
- **(B-2)** 仅把 `sandbox.json` 这一项做成 per-source(例如 per-source agentDir 软链所有条目、只覆盖 `sandbox.json`)。
> 若后续发现软链维护成本高,可回退到**方案 C(env 直投配置)**——它本就是为规避此副作用设计的;两者在"中心化 + 每源独立 + 默认严格"目标上等价,仅配置投递机制不同。

### 默认严格策略基线(锁定值,落地直接用)
```jsonc
// <perSourceAgentDir>/sandbox.json —— 全局严格默认
{
  "enabled": true,
  "network": { "allowedDomains": [], "deniedDomains": [] },   // 零额外出网
  "filesystem": {
    "denyRead":  ["/"],            // 默认拒全盘;allowRead 反超
    "allowRead": ["."],           // 仅 project dir(= cwd)
    "allowWrite":["."],           // 仅 project dir
    "denyWrite": [".env", ".env.*", "*.pem", "*.key", "*.crt"]
  }
}
```
> 注:`allowedDomains: []` 会导致**任何出网域都被拦截**(headless 无放行 → 硬拦截)。若某 source 需要 npm/git 拉取依赖,需在其 per-source 覆盖里显式加白对应域。

---

## 10. 即时配置(方案 A)已落地 —— 当前基线

> 落地日期 2026-06-19。作为方案 B 编码完成前的即时基线;策略**内容**与方案 B 一致,仅投递方式不同(手写全局文件 vs 后续 pi-web 中心化下发)。

**已写入文件**:`~/.pi/agent/sandbox.json`(全局,user 级 pi-sandbox 不受 trust 门控,对**所有会话**生效)。内容:

```json
{
  "enabled": true,
  "network": { "allowedDomains": [], "deniedDomains": [] },
  "filesystem": {
    "denyRead": ["/"],
    "allowRead": ["."],
    "allowWrite": ["."],
    "denyWrite": [".env", ".env.*", "*.pem", "*.key", "*.crt"]
  }
}
```

**为何一个全局文件即可覆盖所有 source**:`"."` 是相对路径,pi-sandbox 匹配时 `resolve(".")` 解析为**当前 agent 子进程的 `process.cwd()`**;pi-web spawn 每个会话时 `cwd = 该 source 目录`,故同一份全局配置对每个 agent 各自解析到它自己的 project dir。**无需任何项目级 `.pi/sandbox.json`**(切勿在全局写绝对路径,否则被钉死成固定目录)。

**生效策略**:读/写仅限各 agent 自己的 project dir;`.env`/`*.pem`/`*.key`/`*.crt` 写入硬拦截;零额外出网(任何域被拦)。

**例外机制**:仅当某 source 需要破例(如拉 npm/git 依赖、访问共享只读目录)时,才在**该源目录**建 `<src>/.pi/sandbox.json` 覆盖,例:
```jsonc
{ "network": { "allowedDomains": ["registry.npmjs.org", "github.com", "*.github.com"] } }
```

**验证**:会话内 `/sandbox` 命令打印生效 allow/deny 与配置文件路径;写项目内放行、写项目外或出网被 `block`。

**与方案 B 的衔接**:方案 B 落地后,pi-web 按 source 渲染同样字段的有效配置并注入独立 `PI_CODING_AGENT_DIR`,届时此手写全局文件可保留作兜底默认,或迁移为中心策略存储的全局层。

---

## 11. Schema UI + 方案 A/B 配置域(2026-06-19 已实现)

> 本节记录已落地的代码改动。`pnpm -r typecheck` + app `tsc` 全绿;新增/既有 config 测试全过
> (server config 49 / protocol config 19 / ui 298 / server http 74)。

### 协议层(`@blksails/pi-web-protocol`)
- **新增** `src/config/domains/sandbox.ts`:`sandboxConfigSchema`(zod,嵌套 network/filesystem,
  全字段可选以支持稀疏覆盖)+ `sandboxFormSchema`(经 `zodToFormSchema`)。生成的字段:
  `enabled→boolean`、`network→object{allowedDomains,deniedDomains:stringList}`、
  `filesystem→object{allowRead,allowWrite,denyRead,denyWrite:stringList}`,分组 general/network/filesystem。
- **改** `src/config/index.ts`:`ConfigDomainId += "sandbox"`,`CONFIG_FORM_SCHEMAS.sandbox`,导出 domain。

### 服务层(`@blksails/pi-web-server`)
- **改** `src/config/config-routes.ts`:`DOMAIN_SCHEMAS.sandbox = sandboxConfigSchema` ——
  **方案 A**:通用 `GET/PUT /config/sandbox` 直接读写 `<agentDir>/sandbox.json`(= pi-sandbox 全局配置)。
- **新增** `src/config/sandbox-project-routes.ts` `createSandboxProjectRoutes({defaultCwd, allowedRoots?, adminPolicy?})`——
  **方案 B + 项目 `.pi/sandbox.json`**:`GET/PUT /config/sandbox/project[?cwd=<dir>]` 读写
  `<cwd>/.pi/sandbox.json`。cwd 缺省取 `defaultCwd`,显式 cwd 必须绝对且落在 `allowedRoots`
  (默认 `[defaultCwd]`)子树内 → 防越权写(越界 403、非法值 422)。路由 3 段,与 `/config/:domain`(2 段)不冲突。
- **改** `src/config/index.ts`:导出 `createSandboxProjectRoutes` 等。

### 应用层接线
- **改** `lib/app/pi-handler.ts`:`routes` 注入 `[...createConfigRoutes({rootDir:agentDir}),
  ...createSandboxProjectRoutes({defaultCwd: config.defaultCwd})]`。
- app 既有 catch-all `app/api/config/[[...path]]/route.ts` 自动转发 `/api/config/sandbox` 与
  `/api/config/sandbox/project` 到 handler,无需改路由。

### 前端表单层(`@blksails/pi-web-ui`)
- **新增字段控件**(此前 `boolean/stringList/object` 无控件 → 会降级为只读 JSON):
  `src/config/fields/{boolean-field,string-list-field,object-field}.tsx`;在 `field-renderer.tsx`
  的 `DEFAULTS` 注册。`object-field` 经 `FieldRenderer` 递归渲染子字段。
- **改** `lib/settings/register-panels.ts`:注册「沙箱(全局)」(`/api/config/sandbox`)与
  「沙箱(项目)」(`/api/config/sandbox/project`,自定义 IO)两个面板;校验用 `zodValidator(sandboxConfigSchema)`。
  设置页(`/settings`)的 `<SettingsShell>` 零改动即纳入两个新分区。

### 测试
- `packages/server/test/config/sandbox-config.test.ts`(7 例):全局域 GET/PUT/422 + 项目路由
  PUT→落盘/GET→读回/未配置 exists:false/cwd 越界 403/非法值 422 不落盘。

### 仍待办(非本轮,enforcement 健壮性)
- **强制注入**:当前依赖 pi-sandbox 以 user-scope 自动加载(cli 模式原生;custom 模式经
  resourceLoader 发现 user 级 npm 扩展)。若要不论 agent 是否 `allowExtensions:[]` 都强制启用,
  按 §5 在 `buildRuntimeFactory` 追加 `additionalExtensionPaths` / cli 分支加 `-e`。
- **方案 B 的独立 agentDir**:本轮用「项目 `.pi/sandbox.json`」承载按源覆盖(pi-sandbox 原生深合并),
  未改 `PI_CODING_AGENT_DIR`,**规避了 §9 的 agentDir 副作用**——比原 B-1/B-2 更简且无副作用。
  若未来需要"按源独立全局层而非写项目树",再引入 per-source agentDir 或方案 C(env 直投)。
- **按源选择器 UI**:「沙箱(项目)」面板当前编辑所服务项目根(`defaultCwd`)。多源场景需加
  源/会话下拉,经 `?cwd=` 切换(后端已支持该参数)。

---

## 12. 强制注入 + 可见性隔离(2026-06-19 已实现/验证)

### 12.1 强制注入(req 1):enforcement 不依赖默认发现
让沙箱扩展在两种 spawn 模式都被**显式加载**,不依赖 pi 的 user-scope 注册表/发现。
- **新增** `packages/server/src/sandbox/entry.ts` `resolveSandboxEntry(agentDir?)`:
  env `PI_WEB_SANDBOX_ENTRY` 覆盖 > `<agentDir>/npm/node_modules/pi-sandbox/index.ts`;未装→undefined→跳过(不报错)。经 server barrel 导出。
- **改** `lib/app/pi-handler.ts`:解析一次 `sandboxEntry`;real 模式 createChannel——
  cli 追加 `-e <entry>`(`--extension, -e <path>`,已核实是 earendil pi 真实 flag);两模式注入 env `PI_WEB_SANDBOX_ENTRY`。stub 模式不注入。
- **改** `packages/server/src/runner/option-mapper.ts`:`buildRuntimeFactory` 读 env →
  `mapResourceLoaderOptions(def, { forcedExtensionPaths })` 把入口**置前**追加到 `additionalExtensionPaths`
  (SDK 在 `noExtensions` 下仍加载——已核实 resource-loader.js:263),并让 `allowExtensions` 白名单
  `extensionsOverride` **豁免**沙箱 basename → 即便 agent 关闭/白名单扩展也强制启用。
- 测试 `test/runner/option-mapper-forced-inject.test.ts`(5 例):置前追加 / 无 def.extensions 也注入 /
  noExtensions 下仍在 / 白名单豁免 basename / 无 forced 行为不变。既有 15 例不回归。

**经验性验证(cli/rpc 真起进程)**:`echo '{...get_commands...}' | pi --mode rpc -e <pi-sandbox>` →
输出 `🔒 Sandbox: 0 domains, 1 write paths`,**进程不崩**。证明:① 扩展在 rpc 模式成功加载并
`SandboxManager.initialize` 成功(rg + sandbox-exec 就绪);② **读到并应用了我们的严格全局
`~/.pi/agent/sandbox.json`**(`allowedDomains:[]`→0 domains、`allowWrite:["."]`→1 write path);
③ `ctx.ui` 在 rpc 下存在,经 `extension_ui_request`(setStatus/notify)桥接,不抛。
> custom 模式经 `additionalExtensionPaths` 注入仅单测覆盖(未起 runner e2e),逻辑与 cli 同一加载器。

### 12.2 可见性隔离(req 2):每个 agent 读不到别人的配置
**选定语义**(已与你确认):策略仍是「全局默认 ⊕ 本项目覆盖」,但**agent 进程(模型/工具)只能读
自己项目内的 `.pi/sandbox.json`,读不到 `~/.pi/agent/sandbox.json` 或其它项目的配置**。

**机制**(由严格默认天然达成,无需额外代码):严格全局 `allowRead:["."]`(`.`=各 agent 自己的 cwd)。
pi-sandbox 的 read 拦截(index.ts:849)对不在 `allowRead` 的路径触发 promptReadBlock:
- 自己的 `<cwd>/.pi/sandbox.json`:在 `.` 子树内 → 放行。
- `~/.pi/agent/sandbox.json`(全局)、`/其它项目/.pi/sandbox.json`:在 cwd 之外 → **不放行**(被拦或弹权限提示)。

> **扩展 vs agent 的区分**:沙箱**扩展自身**用 Node `readFileSync` 读全局+项目配置以**执行策略**
> (这不经 read 工具、不受拦截);但**agent**(LLM 经 read 工具)读全局/他源配置会被拦。故"策略含共享全局"
> 与"agent 看不到全局文件"二者并存——正是所选语义。

**关键前提/告警**:该保证**仅当 `allowRead` 保持项目内作用域时成立**。若某 source 的覆盖把 `allowRead`
放宽到父目录(`~`、`/`、含多个项目的 workspace 根),则同级配置又可被读到。配置 UI 里加白 `allowRead`
路径时需注意这一点(后续可在校验层加"allowRead 含项目外路径"的告警)。

**待你做的一次活体确认(本环境无法起真模型会话)**:
rpc 下 `ctx.ui` 桥接为 `extension_ui_request`。当 agent 真的尝试越权 read 时,pi-sandbox 会调
`ctx.ui.custom(...)` 发"权限提示"。需在一次真实会话里确认 pi-web 前端对该 `custom` 请求的处理:
- 若前端能渲染/响应 → 越权访问表现为**交互权限弹窗**(用户拒则 block),agent 仍无法静默读取;
- 若前端不处理 `custom`(它本是 TUI 渲染请求)→ 可能**挂起或被 SDK 兜底为 abort(=block)**。
  若出现挂起,改用方案 C(pi-web 自有沙箱扩展,用 pi-web 权限协议或直接硬拦截替代 `ctx.ui.custom`)。

---

## 13. 扩展配置域 + Tab 布局(2026-06-19 已实现,kiro spec)

> 经 kiro spec `config-ui-sandbox-extensions`(`.kiro/specs/`)完成。typecheck 全绿;
> server config 60 + ui config 16 + node e2e 6 通过;browser e2e 已写(`pnpm e2e` 运行)。

### 设置页 Tab 分组布局
- `SettingsPanelDescriptor` 增 `group/groupTitle/groupOrder/tabLabel/tabOrder`;`SettingsShell.buildGroups`
  把同 `group` 面板合并为**一个**左侧菜单项,>1 面板渲染 `role="tablist"`(全局/项目)。
- 沙箱、扩展各为一个菜单项 + 全局/项目 Tab。

### 扩展配置域(全局 + 项目)
- 协议 `domains/extensions.ts`:`commands{allow,deny}`(固定区,Slash 命令前端可用性限制)+
  `extensions`(KV 区,`Record<extId,Record<string,string>>`,自定义 widget `extensionsKv`),全可选 passthrough。
  **不**并入通用 `CONFIG_FORM_SCHEMAS`(避免 2 段 `/config/extensions` 被 `:domain` 路由遮蔽)。
- 服务 `extensions-config-routes.ts`:**3 段**路由 `GET·PUT /config/extensions/{global,project}`(避开 `:domain`);
  纯函数 `settingsToForm`/`applyFormToSettings` 做 `settings.json` ↔ 表单互映:
  `commands` 为命名键;per-扩展 KV ↔ **顶层** `<extId>` 键(与 pi 读取一致);写回**非破坏**保留
  `packages`/provider/theme 等保留键与未出现的扩展键。项目 `cwd` 越界 403、非法 422。
- 前端 `extensions-kv-field.tsx`:两级动态增删(扩展条目 + 键值对);经 `registerFieldRendererByKey("extensionsKv",…)` 注册。
- **按已安装扩展分组**:`settingsToForm` 把 `packages[]`(去 `npm:`/`git:`/`local:` 前缀)并入 `extensions`
  (无配置 → 空 KV 占位),控件即每个扩展一张卡片;`applyFormToSettings` 对空 KV **跳过/删除**,
  不给 settings.json 写空块(也支持清空即移除)。
- **独立配置文件支持**(异构配置):pi 无统一扩展配置约定——部分扩展(如 `@aizigao/pi-proxy-fetch`)
  把配置存在**独立文件**(硬编码 `~/.pi/agent/proxy.json` / `.pi/proxy.json`)而非 settings.json 键。
  故扩展配置新增「独立配置文件」区:`extensions-config-routes` 扫描 `<dir>/*.json`(排除保留文件
  `settings/auth/sandbox/trust.json`)→ `files` 字段;`config-files-field.tsx` 控件按文件原始 JSON 编辑
  (解析失败就地报错不回写),并读内容 `$schema` 关联所属扩展(github(usercontent).com/<owner>/<repo>)。
  PUT 仅写安全文件名(防穿越/保留文件)。已有独立配置文件的扩展(经 $schema 关联)不再在「扩展参数」
  显示为空占位,避免重复。**活体验证**:`proxy.json`(my_clash socks5)正确读出并可编辑。
- 控件补齐:`boolean/stringList/object` 三个此前缺失的字段控件(沙箱/扩展表单依赖)。

### 活体验证
- `GET /api/config/extensions/global` 正确从真实 `~/.pi/agent/settings.json` 提取既有 `@alexgorbatchev/pi-env`
  KV(排除 packages/provider/theme);PUT 写 `commands` + ext KV 并保留既有键(已验证后清理测试写入)。
- `/settings` 出现「沙箱」「扩展」各一个菜单项 + 全局/项目 Tab。

---

## 14. $schema 驱动的结构化设置表单(2026-06-19,kiro spec `json-schema-config-form`)

> 独立配置文件(如 `proxy.json`)若带 `$schema`(JSON Schema URL),渲染为**结构化表单**而非原始 JSON。
> typecheck 全绿;protocol config 24 + ui config 24 通过;适配器对**真实** proxy.json schema 验证正确。

- **IR 扩展**(`form-schema.ts`):新增 `objectList` kind + `itemFields` + `variants{discriminator,cases}`(oneOf 多态)。
- **适配器**(`json-schema-to-form-schema.ts`)`jsonSchemaToFormSchema`:JSON Schema 子集 → FormSchema IR——
  object/string(+enum)/number|integer(+const)/boolean/数组(标量→stringList、enum→multiEnum、
  对象/oneOf→objectList)/oneOf-对象-const判别→variants/内部 `$ref`(`#/$defs|definitions`)内联;
  不支持构造降级为 string(不抛)。
- **控件**:`object-list-field.tsx`(对象数组增删 + oneOf 判别选择器 + 经 FieldRenderer 递归嵌套);
  `object-field.tsx` 增 variants 支持;`config-files-field.tsx` 改为——有 `$schema`(https)→ **客户端**拉取
  (按 URL 缓存,失败回退)→ `jsonSchemaToFormSchema` → `<SchemaForm>` 结构化渲染;否则原始 JSON。
- **交付决策**:schema 拉取走**客户端**(适配器在 `@blksails/pi-web-protocol` 前后端共享;githubusercontent CORS `*` 已确认),
  避免服务端 SSRF 面与 `fileSchemas` 透传管线;`server/config/schema-fetch.ts` 作为可选服务端接缝保留(未接入)。
- **活体验证**:真实 `proxy.json` schema → `profileConfig:objectList`,variants `type ⇒ proxy_server|autoSwitch`,
  `version:number / enabled:boolean / profileName:string`;`proxy.json` 在「独立配置文件」渲染为结构化表单
  (profile 列表可增删、按 type 切换变体、autoSwitch 内 switchRules 嵌套对象数组),保存保留 `$schema`。

---

## 附:关键文件索引
- pi-sandbox:`~/.pi/agent/npm/node_modules/pi-sandbox/{index.ts,README.md,sandbox.json}`
- earendil 扩展加载器(@mariozechner 别名):`…/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`
- pi-web 注入点:`packages/server/src/agent-source/{trust-apply,assemble-spawn,resolver,types}.ts`、`packages/server/src/runner/{option-mapper,agent-loader,runner}.ts`、`lib/app/pi-handler.ts`、`packages/protocol/src/transport/rest-dto.ts`、`packages/server/src/http/routes/create-session.ts`
- 注册/设置:`~/.pi/agent/settings.json`(`packages[]` 含 `npm:pi-sandbox`)
