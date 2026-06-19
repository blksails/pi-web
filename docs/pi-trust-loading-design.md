# pi-web 项目级 `.pi/` 资源加载与 Trust 策略设计

> 状态:**已实施(2026-06-18)** · 基线:**HEAD = `bc713ad`** · SDK = `0.79.6`
> 实现摘要见文末「§9 实现状态」。server 436 / protocol 116 测试全绿;新增 C-P4 单测与 requestTrust 端到端用例。
> 关联:`NOTES_extensions.md`(机制与现状核实)。
> 目标:让通过 **pi-web server(create-session → custom runner)** 启动的 agent,能加载工作目录下 `.pi/` 的扩展/命令/子代理/技能,并以一套可控 trust 策略管理项目级资源。

---

## 1. 背景

SDK 对项目级 `.pi/` 资源 secure-by-default:仅当"项目目录被信任"时才加载,接入点为 `resolveProjectTrust` 回调(详见 `NOTES_extensions.md` A5)。pi-web 作为 headless server,通过子进程 runner 封装 SDK。当前现象:经 server 路径启动时 `.pi/` 不被加载。

**与上一版方案的差异(基线已前移):**
- ✅ `decideMode` 恒 cli 的 bug **已修复**(entry→custom),custom 路径可达。
- ✅ `runnerEntry`/`piCliEntry` **已在 app 层 `lib/app/pi-handler.ts` 注入**,custom 模式不会抛 `MISSING_RUNNER_ENTRY`。
- ✅ `entry-probe.ts` 已重写、循环 bug 已不存在。
- ⛔ 因此本方案聚焦**仅剩的 trust 链**:P1 / P2 / P3。

## 2. 现状阻断点(对照 `bc713ad`,已核实)

| 编号 | 位置 | 现状 | 影响 |
|---|---|---|---|
| **P1(主因)** | `lib/app/pi-handler.ts` `makeRealResolver` | `resolve(source,{cwd,runnerEntry,piCliEntry,agentDir,baseEnv})` —— **未传 `trustPolicy`**;wrapper 类型仅 `{cwd?}` | 恒用 `defaultTrustPolicy` → 恒 `"ask"` → 永不放行 `.pi/` |
| **P2** | `agent-source/trust-apply.ts` + `assemble-spawn.ts` | custom 模式 `always` → `extraEnv.PI_WEB_TRUST_PROJECT="1"`,不写 `extraArgs`;custom args 只拼 `...extraArgs`(恒空);runner 只读 `--trusted`、不读该 env | `--trusted` 永不进 runner 参数,env 无消费方,trust 信号丢失 |
| **P3** | `packages/protocol/src/transport/rest-dto.ts` | `CreateSessionRequestSchema = {source, cwd?, model?, env?, resumeId?}`,无 `trust` | 无法按请求表达信任意图 |

> 已正确、无需改的接线见 `NOTES_extensions.md` B1(decideMode / entry-probe / runner / option-mapper / agent-loader / pi-handler 的 entry 注入)。

## 3. Trust 策略(已定调)

### 3.1 决策来源(优先级高→低)
```
TrustResolver(dir, requestTrust?) → boolean   // true=加载 .pi/,false=跳过
  1. 显式请求      DTO 的 trust 字段(true/false)                       ← 单次会话,最高
  2. 持久化信任库  ~/.pi/agent/trust.json 中 dir 的 level==="trusted"    ← 跨会话记住(复用 pi CLI 的库)
  3. 配置允许清单  server 配置 trustedRoots: string[](dir 前缀匹配)      ← 部署级
  4. 安全默认      false                                                 ← headless 安全
```
- **A = 复用 `~/.pi/agent/trust.json`**(与 pi CLI 行为一致,CLI `trust` 过的目录在 pi-web 直接生效)。
- **B = 否(本地 dir 不自动信任)**。

### 3.2 "如何信任一个目录"(B=否 前提)
1. **单次放行**:DTO 传 `trust:true` → 本次加载 `.pi/`。
2. **持久记住(推荐主路径)**:`trust:true` 时顺带写入 `trust.json`(`level:"trusted"`)→ 此后该目录跨会话自动信任(命中来源 2),无需每次传。
3. **复用既有**:CLI 已 `trust` 的目录因共享同一 `trust.json` 自动命中来源 2。

### 3.3 决策 → SpawnSpec
- `TrustResolver` 产 `true` → 对应 `applyTrust` 的 `"always"` → runner 收到 `--trusted`;产 `false` → `"never"` → 不收(默认 false)。headless 无交互,不再使用 `"ask"`。

## 4. 改动清单(方案,不实施)

> 以最小且正确为原则;凡 §2 之外、`NOTES` B1 已正确的接线一律不动。

### C-P1 — 在 app 层注入真正的 trustPolicy
- **文件**:`lib/app/pi-handler.ts`(`makeRealResolver`)、`packages/server/src/agent-source/types.ts`、`resolver.ts`
- **改动**:
  - `makeRealResolver` 构造一个 `TrustResolver`(见 C-P4),并在 `AgentSourceResolver.resolve(...)` 的 opts 里传 `trustPolicy`(以**解析后的本地 dir**为主键,见 `NOTES` B3)。
  - 放宽 wrapper 的 `resolve` 类型,使其能携带 `trust`(来自 DTO)透传到 `trustPolicy`。
- **理由**:解 P1(主因)。

### C-P2 — 让 trust 决策抵达 runner(✅ 采用 env 方案)
- **文件**:`runner/runner.ts`(`startRunner`)。
- **实现**:`const trusted = args.trusted || process.env.PI_WEB_TRUST_PROJECT === "1";`。
- **为何选 env 而非改 `applyTrust` 注入 `--trusted`**:`applyTrust` **被两个子系统共享**——agent-source resolver(初始 spawn)与 extensions 安装/重载的 trust-landing(`landTrust`/`reload-session`)。改其 custom 分支会波及后者及多个测试。而 `PI_WEB_TRUST_PROJECT=1` 本就由 `applyTrust(custom,always)` 写入、经 `assemble` 合并进 `spawnSpec.env`、由 `PiRpcProcess` 传入子进程——唯一缺口是 runner 没读它。故**只改 runner 读取**,blast radius 最小,`applyTrust` 与 trust-landing 子系统零改动。
- **理由**:解 P2。

### C-P3 — DTO 增 trust 字段并透传
- **文件**:`packages/protocol/src/transport/rest-dto.ts`、`http/routes/create-session.ts`、`http/create-handler.ts`(及 wrapper 类型)
- **改动**:`CreateSessionRequestSchema` 增 `trust: z.boolean().optional()`;`create-session` 把 `body.trust` 透传进 `resolve()` 的 opts;放宽 resolver wrapper 类型以携带它。
- **理由**:解 P3,承载来源 1。

### C-P4 — TrustResolver 实现(新模块)
- **建议位置**:`packages/server/src/trust/`(或 `agent-source/` 内)。
- **复用 SDK 信任库(已核实,见下方「SDK 导出核实」)**:SDK 0.79.6 **不导出** `loadTrustStore`/`lookupProjectTrust` 这类自由函数,而是从包根导出 **`ProjectTrustStore` 类**。`TrustResolver` 应:
  ```ts
  import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
  const store = new ProjectTrustStore(agentDir);      // agentDir 用 app 已 pin 的同一目录
  const decision = store.get(dir);                    // boolean | null(null=未决)
  // 放行落库:
  store.set(dir, true);                               // 持久化信任(§3.2 第 2 条)
  ```
- **职责**:
  1. 用 `new ProjectTrustStore(agentDir)` 读取既有信任(`store.get(dir)`,返回 `boolean | null`)。
  2. 按 §3.1 优先级对 `dir`(+ 可选 `requestTrust`)求值,返回 `boolean` → 映射为 `"always"|"never"`。
  3. `requestTrust === true` 时 `store.set(dir, true)` 写回,实现 §3.2 第 2 条。
  4. `trustedRoots` 从 server 配置/环境变量读取;`hasTrustRequiringProjectResources(dir)`(包根导出)可用于"无 `.pi` 可门控时直接放行/跳过判断"。
- **副作用约束**:`ProjectTrustStore.set` 负责持久化;写失败 best-effort 不阻断会话;与 pi CLI 共享同一信任库(经 `agentDir`),需在用户文档说明。
- **注意 trust 决策形状变化**:SDK 0.79.6 公共面是 `ProjectTrustDecision = boolean | null`、条目 `{ path, decision: boolean }`,**不是**早先 `core/project-trust.d.ts` 的 `level:"trusted"|"untrusted"` 字符串。设计以 `boolean|null` 为准。

> 注:**C1(decideMode)已在 `bc713ad` 落地,本版方案不含**。

## 5. 验证方案

需先重建验证夹具(随工作树丢失,见 `NOTES` C):
- agent:`examples/pi-probe-agent/`(`defineAgent`,保留 `.pi/` 默认发现)。
- 探针:`<cwd>/.pi/extensions/pi-probe.ts`(注册有辨识度的 `pi_probe_ping` + `session_start` 通知)、`.pi/agents/pi-probe-subagent.md`、`.pi/skills/pi-probe/SKILL.md`。

| 步骤 | 操作 | 预期(实施 C-P1/2/3 后) |
|---|---|---|
| 0 | typecheck agent | 通过 |
| 1 | create-session:`source=examples/pi-probe-agent`,`cwd=<目标>`,`trust:true` | 创建成功;`trust.json` 写入 `cwd=trusted` |
| 2 | 观察工具列表 | 出现 `pi_probe_ping` + 收到加载通知 |
| 3 | 观察子代理 / 技能 | `pi-probe-subagent` 可调;系统提示出现 `pi-probe-skill` |
| 4 | 不传 trust、`trust.json` 已有记录,新建会话 | 仍加载(命中来源 2) |
| 5 | 换未信任目录、不传 trust | 不加载(安全默认) |

回归意义:在 C-P1 实施前,步骤 2–3 应为"未加载"(复现当前 P1)。

## 6. 风险与安全

1. **信任即代码执行**:`.pi/extensions/*.ts` 在 runner 子进程执行用户代码;任何放行=授予代码执行权。
2. **secure-by-default 不削弱**:默认 false;B=否 保证本地路径不自动放行。
3. **`trust.json` 共享面**:与 pi CLI 共用,pi-web 写入会影响 CLI 信任视图(A=复用的预期代价)。
4. **写库副作用**:失败不阻断会话;依赖原子写。
5. **`.pi/` 探针全局性**:某目录被信任后,任何以其为 cwd 的会话都会加载其中资源;验证后清理探针。

## 7. 待确认 / 开放问题

1. **`trustedRoots` 形态**:env(如 `PI_WEB_TRUSTED_ROOTS=/a:/b`)还是 server 配置对象?默认空。
2. **`trust:false` 是否落 `"untrusted"`**:本设计默认不落(最小副作用)。
3. ~~SDK 是否导出 `loadTrustStore/...`~~ **已核实(2026-06-18,SDK 0.79.6)**:包根**不导出**这些自由函数;改为导出 **`ProjectTrustStore` 类**(`constructor(agentDir)`、`get(cwd):boolean|null`、`getEntry`、`set(cwd,decision)`、`setMany`)+ `hasTrustRequiringProjectResources(cwd)` + `getProjectTrustOptions/getProjectTrustParentPath`。C-P4 据此用 `ProjectTrustStore` 类复用信任库(见 C-P4)。
4. **cli 模式对齐**:本方案聚焦 custom(runner)。无入口 source 仍走 cli,其 `.pi/` 由 pi CLI 自身 trust 逻辑(`--approve`/交互/`trust.json`)决定,是否统一干预待定。
5. ~~端到端观察通道~~ **已覆盖(runner 层)**:`test/runner/trust-pi-loading.e2e.test.ts` 经 RPC `get_commands` 直接驱动真启 runner,证明 trust 门控下 `.pi/extensions` 的加载/不加载。HTTP 层(`/sessions/:id/messages`)的端到端仍可后续补充。

## 8. 改动影响面一览

| 改动 | 文件 | 类型 |
|---|---|---|
| C-P1 | `lib/app/pi-handler.ts`、`agent-source/{types,resolver}.ts` | 注入 trustPolicy(主因) |
| C-P2 | `runner/runner.ts`(startRunner) | runner 读取 `PI_WEB_TRUST_PROJECT` env(applyTrust 不改) |
| C-P3 | `protocol/.../rest-dto.ts`、`http/routes/create-session.ts`、`http/create-handler.ts` | DTO + 透传 |
| C-P4 | 新增 `server/src/trust/*` | TrustResolver(复用 `trust.json`) |
| (已完成) | `agent-source/mode-decide.ts` | C1,`bc713ad` 已落地 |

---

## 9. 实现状态(2026-06-18)

**已实施并通过测试(server 436 / protocol 116 全绿;typecheck 0):**

| 项 | 落地文件 | 说明 |
|---|---|---|
| C-P1 | `lib/app/pi-handler.ts`、`agent-source/{types,resolver,trust-policy}.ts` | `TrustPolicy` 改为 `(TrustPolicyInput)=>TrustDecision`(主键 `dir`,带 `requestTrust`);`ResolveOptions` 加 `trustPolicy`/`requestTrust`;resolver 调用点透传;`makeRealResolver` 注入 `makeProjectTrustPolicy` + `requestTrust` |
| C-P2 | `runner/runner.ts` | `startRunner` 读取 `PI_WEB_TRUST_PROJECT` env(env 方案,见 §4 C-P2;`applyTrust` 未改) |
| C-P3 | `protocol/.../rest-dto.ts`、`http/routes/create-session.ts` | DTO 增 `trust?: boolean`;新建分支透传;`CreateSessionDeps.resolver` opts 放宽为 `{cwd?;trust?}` |
| C-P4 | `server/src/trust/{project-trust-policy,index}.ts`、`server/src/index.ts` | `makeProjectTrustPolicy` 用 SDK `ProjectTrustStore` 类(`get`/`set`),四层优先级 + 显式放行落库;经 barrel 导出(SDK 已被 Next `serverExternalPackages` 外置,不打包) |

**测试(server 438 passed / 5 skipped)**:
- 新增 `test/trust/project-trust-policy.test.ts`(5)——四层优先级 + 落库,用临时 agentDir 不污染真实信任库。
- `test/agent-source/resolver.test.ts` 增端到端用例:`requestTrust:true` → policy("always") → `spawnSpec.env.PI_WEB_TRUST_PROJECT="1"`。
- `test/agent-source/mode-trust.test.ts` 适配新 `TrustPolicyInput`。
- **新增真启子进程 e2e** `test/runner/trust-pi-loading.e2e.test.ts`(2):临时 cwd 注入零依赖 `.pi/extensions/*.ts`(注册命令),真启 bootstrap runner →
  - 带 `PI_WEB_TRUST_PROJECT=1` → `get_commands` 含该 `source:"extension"` 命令(`.pi/` 已加载);
  - 不带 → 不含。直接证明 SDK trust 门控 + C-P2(runner 读该 env)端到端打通。

**设计差异说明**:
- **默认信任 app 服务的项目根**:`pi-handler.makeRealResolver` 默认把 `config.defaultCwd`(= `PI_WEB_DEFAULT_CWD ?? process.cwd()`)纳入 `trustedRoots`,使仓库内 `.pi/`(含 `examples/*`)开箱加载;否则 secure-by-default 会让"运行自己仓库里的示例"也加载不到,体验割裂。`PI_WEB_TRUST_DEFAULT_CWD=false` 关闭;外部 git/任意路径源不在该子树内仍默认不信任。
- **运行注意**:pi-handler 单例 pin 在 `globalThis`、热重载不重建 → 改 pi-handler / 信任配置须**整进程重启**才生效。
- C-P2 最终采用 env 方案(runner 读 `PI_WEB_TRUST_PROJECT`)而非向 `extraArgs` 注入 `--trusted`,因 `applyTrust` 与扩展安装/重载 trust-landing 子系统共享(§4 C-P2)。
- `requestTrust` 由**注入的 `ProjectTrustPolicy` 处理**(含落库);未注入策略时,默认 `defaultResolverTrustPolicy` 返回 `"ask"`(安全)。生产路径 `pi-handler` 总是注入该策略。
- resume 分支不传 `requestTrust`:复用持久化信任库(`ProjectTrustStore.get(dir)`)的既有决策。

**仍未动(独立后续)**:
- 扩展安装/重载的 trust-landing 子系统仍按 `source` 字符串决策(`(source)=>TrustDecision` 旧契约),与 `.pi/` 初始加载分离。如需统一为 dir 主键,另案处理。
- §7 开放问题 #4(cli 模式)/#5(messages 观察通道)未变;#3(SDK 导出面)已核实并落地为 `ProjectTrustStore` 类。
