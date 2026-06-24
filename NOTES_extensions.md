# pi 扩展 / 子代理 / 技能 加载机制 与 pi-web 现状

> 重建日期:2026-06-18 · 基线:**仓库 HEAD = `bc713ad`** · SDK = `@earendil-works/pi-coding-agent@0.79.6`
> 本文分两部分:**A. SDK 客户端的加载机制**(随 SDK 包,稳定;本会话已直接核实)、**B. pi-web 侧当前接线现状**(对照 `bc713ad` 重新核实)。
> 关联落地方案:`docs/pi-trust-loading-design.md`。

---

## 0. 结论速览(TL;DR)

1. SDK 把项目级 `.pi/` 资源(extensions / agents / skills / commands / settings / 项目 MCP)统一门控在「项目目录是否 trusted」之下;trusted 才加载,否则只保留 user 级与内置。接入点是 `resolveProjectTrust` 回调。
2. **pi-web 现状(`bc713ad` + 本次实现)**:trust 链已打通,经 server 路径可加载 `.pi/`(见 `docs/pi-trust-loading-design.md` §9)。原三个阻断点均已修复:
   - ~~**P1**~~ ✅ `lib/app/pi-handler.ts` 注入 `makeProjectTrustPolicy` 作为 `trustPolicy`(复用 SDK `ProjectTrustStore`)+ 透传 `requestTrust`。
   - ~~**P2**~~ ✅ `runner/runner.ts` 的 `startRunner` 读取 `PI_WEB_TRUST_PROJECT` env(env 方案,避开共享的 `applyTrust`)。
   - ~~**P3**~~ ✅ DTO `rest-dto.ts` 增 `trust?: boolean`,`create-session` 透传。
   - 信任策略:DTO `trust` > 持久化 `~/.pi/agent`(ProjectTrustStore)> `trustedRoots`(env `PI_WEB_TRUSTED_ROOTS`)> 安全默认。`trust:true` 顺带落库 → 跨会话记住。
   - **e2e 已验证**:`test/runner/trust-pi-loading.e2e.test.ts` 真启 runner 子进程,带 `PI_WEB_TRUST_PROJECT=1` 时 `.pi/extensions` 的命令出现在 `get_commands`、不带时不出现(server 438 passed)。

---

# A. SDK 客户端加载机制(SDK 0.79.6,机制稳定)

## A1. 扩展(Extension)定义形态
- TS/JS 模块,`export default function (pi: ExtensionAPI) { ... }`;工具参数 schema 用 `typebox` 的 `Type.*`。
- 注册 API(来自 `docs/EXTENSIONS.md` 与 `examples/extensions/*.ts`,已双读核实):
  - `pi.registerTool({ name, description, parameters: Type.Object({...}), handler: async (input, ctx) => ({ content }) })`
  - `pi.registerCommand({ name, description, arguments?: [{name,description,required}], handler: (args, ctx) })`
  - `pi.registerStatusProvider({ id, render: (ctx) => string })`
  - `pi.on(event, handler)`:`session_start` / `trust_changed`(`event.trusted`)/ `tool_call`(`return { block:true, reason }` 可拦截)等
- 常用 `ctx`:`ctx.sessionId`、`ctx.ui.notify(msg,"info"|"warn")` / `ctx.ui.confirm`、`ctx.project.isTrusted()`、`ctx.conversation.addUserMessage(text)`。

## A2. 子代理(Subagent)定义形态
- `.pi/agents/<name>.md` 的 **Markdown + YAML frontmatter**:`name` / `description` / `tools`(省略=全部) / `model`;正文即系统提示。隔离上下文运行。

## A3. 技能(Skill)定义形态
- 一个**目录** `.pi/skills/<name>/`,含 `SKILL.md`(+可选支持文件)。frontmatter:`name`(必)、`description`(必)、`allowed-tools`(可选)、`model`(可选)。
- 三级渐进式加载:L1 name+description 始终进系统提示 → L2 `SKILL.md` 正文触发时加载 → L3 支持文件按需。

## A4. 目录约定与优先级
| 资源 | 项目级(仅 trusted) | 用户级(始终) |
|---|---|---|
| extensions | `.pi/extensions/` | `~/.pi/agent/extensions/` |
| subagents | `.pi/agents/`(目录名 `agents`,非 `subagents`) | `~/.pi/agent/agents/` |
| skills | `.pi/skills/` | `~/.pi/agent/skills/` |
| commands | `.pi/commands/` | — |
| settings | `.pi/settings.json` | `~/.pi/agent/settings.json` |

- 扩展优先级:**project > user > built-in**(同名覆盖);默认 enabled,`settings` 可 `{enabled:false}` 禁用。

## A5. Trust 门控(核心机制,已核实)
- 门控点:`dist/core/resource-loader.js` `resolveResourcePathsForScope()`:`if (isProjectTrusted() && existsSync(projectPath))` 才并入项目级路径,否则只返回 user 级。extensions/subagents/skills/prompts 四类同此门控。
- trust 值来源:`reload()` 中若传 `resolveProjectTrust`,先 `setProjectTrusted(false)` 跑 bootstrap(只 user/CLI),再 `projectTrusted = await callback()`,`setProjectTrusted(projectTrusted)`。初始加载即走该回调(`agent-session-services.js`)。
- SDK 自身默认 `projectTrusted ?? true`(若不传回调则默认信任;一旦传入恒 false 回调即被压成 false)。
- 持久化:信任库位于 `agentDir`(默认 `~/.pi/agent/`)。**SDK 0.79.6 公共导出面(已核实)**:包根导出 **`ProjectTrustStore` 类**(`new ProjectTrustStore(agentDir)`;`get(cwd): boolean | null`、`getEntry`、`set(cwd, decision)`、`setMany`)+ `hasTrustRequiringProjectResources(cwd)` + `getProjectTrustOptions/getProjectTrustParentPath`。决策形状为 `ProjectTrustDecision = boolean | null`、条目 `{ path, decision: boolean }`。
  - ⚠️ 早先从 `core/project-trust.d.ts` 读到的 `loadTrustStore`/`lookupProjectTrust` 自由函数与 `level:"trusted"|"untrusted"` 字符串,**不是 0.79.6 的包根公共面**;以 `ProjectTrustStore` 类 + `boolean|null` 为准。C-P4 用该类复用信任库。
- headless 无 TTY 无法交互批准 → trust 须事先授予(此前交互会话或预置 `trust.json`),否则项目级资源被跳过。
- 不受 trust 门控:user 级与内置扩展、上下文文件(`AGENTS.md`/`CLAUDE.md`)、读文件(独立 permission 系统)。

## A6. SDK 编程式入口
- `examples/sdk/trust.ts`(已核实):`createAgentSession({ cwd, resolveProjectTrust })`,回调返回 `true` 才加载项目级 `.pi/`,`false` 跳过。

---

# B. pi-web 侧当前接线现状(对照 `bc713ad` 重新核实)

## B1. 已正确 / 已修复(无需动)
- ✅ **`agent-source/mode-decide.ts`**:`decideMode = entry.kind === "entry" ? "custom" : "cli"`(**此前恒 cli 的 bug 已修复**,custom runner 路径现可达)。
- ✅ **`agent-source/entry-probe.ts`**:已重写为 `async probeEntry(dir): Promise<EntryProbe>`。优先 `package.json#pi-web.entry`(覆盖文件缺失抛 `EntryOverrideError`,不静默回退),否则按 `index.ts > index.js > index.mjs` 取首个**确为文件**者;循环写法正确(命中才 return)。**旧的"只检查第一个约定名"循环 bug 已不存在**。注意:约定名收窄,不再支持 `agent.ts`/`*.mts`。
- ✅ **`runner/runner.ts`**:`parseRunnerArgs` 解析 `--agent/--cwd/--agent-dir/--trusted/--session-id/--model` 等;`--trusted` 默认 `false`;`startRunner` → `makeResolveProjectTrust(args.trusted)` → `loadAgentDefinition` → `createAgentSessionRuntime`。解析与接线正确。
- ✅ **`runner/option-mapper.ts` `buildRuntimeFactory`**:把 trust 接到 `createAgentSessionServices({ ..., resourceLoaderReloadOptions:{ resolveProjectTrust: trust } })`(SDK 契约不变,接线正确)。
- ✅ **`runner/agent-loader.ts`**:`buildResolutionAliases()` 给 jiti 配 alias,把 `@blksails/agent-kit`(→`packages/agent-kit/src/index.ts`)与 SDK 按 **runner 自身位置**解析 → agent 文件**位置无关**即可被加载(无需是 workspace 包、无需本地 node_modules)。
- ✅ **`lib/app/pi-handler.ts` `makeRealResolver`**:已注入 `runnerEntry`(`runnerBootstrapPath()`)、`piCliEntry`(`resolvePiCliEntry()`)、`agentDir`、`baseEnv`(透传 `process.env`,否则子进程连 `node` 都找不到 → spawn 失败 → 404)。**custom 模式不会再抛 `MISSING_RUNNER_ENTRY`**。

## B2. 阻断点(原分析,均已修复 → 见 §0 与 `docs/pi-trust-loading-design.md` §9)
| 编号 | 位置 | 原现状 | 影响 |
|---|---|---|---|
| **P1** | `lib/app/pi-handler.ts` `makeRealResolver` | 调 `AgentSourceResolver.resolve(source, {cwd,runnerEntry,piCliEntry,agentDir,baseEnv})` —— **未传 `trustPolicy`**;且 wrapper 类型仅 `{ cwd? }` | → `resolver` 恒用 `defaultTrustPolicy` → `trust-policy.ts` 恒返回 `"ask"` → 永不放行 `.pi/`。**主因。** |
| **P2** | `agent-source/trust-apply.ts` | custom 分支:`always` → `extraEnv.PI_WEB_TRUST_PROJECT="1"`(不写 `extraArgs`);`assemble-spawn.ts` custom args 只拼 `...fragment.extraArgs`(恒空) | `--trusted` 从不进入 runner 启动参数;而 runner 只读 `--trusted`、**不读 `PI_WEB_TRUST_PROJECT`** → 全仓库该 env 无消费方,信号丢失。即便 P1 修了让 policy 返回 `"always"`,custom 路径仍传不过去。 |
| **P3** | `packages/protocol/src/transport/rest-dto.ts` | `CreateSessionRequestSchema = { source, cwd?, model?, env?, resumeId? }` —— **无 `trust` 字段** | 无法按请求表达信任意图。 |
| — | `http/routes/create-session.ts` | 两处 `resolver.resolve(source, { cwd })` 只传 cwd | trust/policy 无从透传(与 P1/P3 同源)。 |

## B3. trust 决策主键
- `resolver.ts` 用 `policySource` 调 `trustPolicy`:`dir` 源时 `policySource = identified.path`(= 本地目录),default 源时 = cwd,git/plugin 时 = url/source 串。
- 设计含义:对**本地 dir 源**,policySource ≈ 解析后的本地目录(与 SDK 的 `projectDir`、`trust.json` 的 key 对齐);git/plugin 则是来源标识。`TrustResolver` 应以**解析后的本地 dir**为信任主键(见方案文档)。

## B4. 修复后链路(目标)
```
POST /sessions { source, cwd, trust? }            # P3: DTO 增 trust
  └─ pi-handler.makeRealResolver: resolve(source,{cwd,runnerEntry,piCliEntry,trustPolicy})  # P1: 注入 trustPolicy
       └─ resolver: dir=toLocalDir; mode=decideMode(entry)=="custom"(已修)
            trusted = trustPolicy(dir, trust?)     # DTO > trust.json > trustedRoots > false
            fragment = applyTrust("custom", trusted)  # P2: trusted → extraArgs += "--trusted"
            spawn: node runner-bootstrap.mjs --agent <entry> --cwd <dir> [--trusted]
  └─ runner: --trusted=true → makeResolveProjectTrust(true) → resolveProjectTrust:()=>true
       └─ SDK reload(): setProjectTrusted(true) → 并入 <dir>/.pi/{extensions,agents,skills,...}
  ✅ .pi/ 被加载
```

---

## C. 验证夹具状态(已按 `bc713ad` 新 API 重建)
- 已重建(均为未提交新文件):
  - `examples/pi-probe-agent/index.ts` —— **单文件**(当前 examples 约定;examples 非 workspace 包、被根 tsconfig `exclude`,经 runner jiti alias 在运行时解析)。用新 API:`defineTool`(SDK)+ `Type`(`@earendil-works/pi-ai`)+ `async execute(...)`;`noTools:"builtin"`、**不覆盖 skills** 以保留 `.pi/` 全量发现。
  - 仓库根探针:`.pi/extensions/pi-probe.ts`(`pi.registerTool({...async execute(...)})` + `pi.registerCommand("pi-probe",{handler})` + `pi.on("session_start")`,`Type` from `typebox`)、`.pi/agents/pi-probe-subagent.md`、`.pi/skills/pi-probe/SKILL.md`。
- IDE 对 agent/扩展文件报 "Cannot find module"/implicit-any 属**预期编辑器噪音**:examples 被根 tsconfig `exclude`、且非 workspace 包;`.pi/` 为 dot 目录不在 include;hello-agent(同为单 `index.ts`)情况一致。不影响 CI/构建/运行时。
- 端到端"加载成功"仍需先实施 P1/P2(/P3)——当前经 server 路径预期 `.pi/` 加载不到(回归复现)。
- 旧版夹具(含 `packages/server/examples/echo-agent` 中文化)随工作树前移已丢失;`packages/server/examples/` 在 `bc713ad` 不存在。

## D. 出处与可信度
- **A 部分(SDK 机制)**:本会话对 SDK 0.79.6 的 `docs/*.md`、`examples/sdk/trust.ts`、`dist/core/resource-loader.js`、`project-trust.d.ts` 等已逐字双读核实;SDK 包未变,结论复用。
- **B 部分(pi-web 现状)**:对照 `bc713ad` 重新读取核实;P1(`pi-handler.ts` 未注入 trustPolicy)、P2(`trust-apply.ts` 仍用 env)、entry-probe/mode-decide 现状均为本轮直接读源码确认。
- **环境提醒**:本会话 Shell/读取工具输出层间歇被注入幻觉文本,关键逐字内容均经小窗口多读交叉验证。

## E. 关键文件索引
- SDK:`node_modules/@earendil-works/pi-coding-agent/{docs,examples,dist/core}`
- pi-web agent-source:`packages/server/src/agent-source/{resolver,mode-decide,entry-probe,trust-policy,trust-apply,assemble-spawn,types}.ts`
- pi-web runner:`packages/server/src/runner/{runner,option-mapper,project-trust,agent-loader}.ts`
- pi-web http / app:`packages/server/src/http/{create-handler,routes/create-session}.ts`、`lib/app/pi-handler.ts`
- 协议:`packages/protocol/src/transport/rest-dto.ts`
