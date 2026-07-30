# 交付证据矩阵与已知未验清单 — adapters-package-extraction

> 本文件是任务 **6.3** 的交付物，对应需求 **3.6 / 6.5 / 2.2**。
>
> 它的目的**不是**宣布「全绿」。R6.5 明确要求「提供实测运行输出，而非仅『全绿』的结论」。
> 因此下面每一条验收标准都对应到**命令 + 实测输出**，并标出证据强度；没有直接机械证据的
> 条目如实标注，不粉饰。本轮尤其要避免一种表述陷阱：R2 的达成是**分层**的
> （声明层达成、闭包层未兑现），笼统写成「兼容层依赖面已缩小」是不诚实的 —— 见 §3。

## 0. 证据取样环境

| 项 | 值 |
|---|---|
| 工作树 | `/Users/hysios/Projects/BlackSail/agents/pi-web/.claude/worktrees/core-extraction` |
| 分支 | `refactor/core-extraction` |
| HEAD | `321307c2` docs(adapters-package-extraction): 四包通过面与类型检查实测(任务 6.1) |
| 工作树状态 | `git status --porcelain` 输出 **0 行**（证据与 HEAD 严格对应） |
| spec 起点 | `99982d5c`（2026-07-30 10:44:49，`2299cc29^`） |
| 本 spec 改动文件 | 186 |
| 取证时间 | 2026-07-30 |

★ **本节所有测试/类型检查证据均在本轮重新取得**，不沿用 6.1 的留档。
按 `verify-completion` 闸门要求：**报告过的成功不是证据，只有新鲜输出才是**。

★ **取证方法本身也做了自检**。首轮取证时发现两处会产出**假绿**的写法，已纠正后重测：

| 假绿写法 | 症状 | 纠正 |
|---|---|---|
| `npx tsc ... \| tail -20` 后取 `$?` | `$?` 是管道末端 `tail` 的退出码，**恒为 0** | 改为先重定向到文件、直接取 `tsc` 的 `$?` |
| `${PIPESTATUS[0]}` | zsh 下该变量为空（zsh 用 `$pipestatus[1]`），打印出 `EXIT=`（既非 0 也非非 0） | 同上 |

纠正后另加一条**判别自检**：故意用非法参数跑 `tsc`，确认捕获到 `EXIT=1` —— 证明这套取值方式
真的分得出成功与失败，而不是恒返回 0。

证据强度图例：

- **直接** —— 有针对该条标准的机械判据（命令 + 输出），且判据两端是独立事实源。
- **注入式自证** —— 红路径由测试套内「判别力自证」用例覆盖（注入数据而非破坏真实清单），
  另有父层在实施期做过的真实破坏实验作补强。
- **元判据** —— 该条标准约束的是**验收方法本身**，由本文件的组织方式满足。
- **部分间接** —— 本仓可验证的面已直接验证，但该标准还覆盖本仓测不到的面。
- **未达成（已如实标注）** —— 字面不成立，理由与实际达成范围写在条目里。

---

## 1. 证据矩阵（30 条验收标准逐条）

### Requirement 1 · adapters 包成立且承载全部外部绑定

| # | 验收标准 | 命令 | 实测输出摘要 | 强度 |
|---|---|---|---|---|
| **1.1** | 包含层归属判定为 adapters 的全部模块 | `ls packages/adapters/src`；`find packages/adapters/src -type f \| wc -l`；`module-roster.test.ts:234` | **12 个顶层模块** = 名册中判 adapters 层的 12 项逐字对应（`ai-gateway` / `auth` / `extensions` / `identity` / `llm-gateway` / `model-sources` / `sandbox-image` / `sandbox-transport` / `session-store-postgres` / `tokens` / `mcp-probe.ts` / `attachment-example-tool.ts`）；**57 个 src 文件 / 7626 行**。与 brief 实测画像（57 文件 / 7612 行）的 **+14 行差额已逐提交追实**：把这 57 个文件的旧路径在 spec 起点逐个取出统计得 **7612 行（逐字相符，0 个路径对不上）**；搬迁提交 `ad1b77df` 对本目录是 `+7612/-0`（整体搬入，零改写），**全部 +14 来自 6.2 的注释修正** `91a1fa78`（`+19/-5`）。由「★ 层归属 ⟹ 物理归位」映射表断言把关 | 直接 |
| **1.2** | 依赖声明含三个重依赖，且本仓中**只应**出现在此处 | Node 遍历根 + 全部 `packages/*/package.json` 的四类依赖字段 | `e2b@^2.33.0` / `pg@^8.13.1` / `ws@^8.18.0` **仅** `packages/adapters` 声明 ✓；**`@modelcontextprotocol/sdk` 另有一处：`packages/tool-kit`（`^1.29.0`）** —— 见下方 ⚠ | **部分间接** ⚠ |
| **1.3** | agent 运行时 SDK 列为 peer，由宿主决定版本 | 读 `packages/adapters/package.json`；`package-deps.test.ts:350` | `peerDependencies = {"@earendil-works/pi-ai":"^0.80.3","@earendil-works/pi-coding-agent":"^0.80.3"}`，`dependencies` 中无 SDK。用例「agent 运行时 SDK 以 peer 形式声明,而非硬依赖(R1.3)」绿 | 直接 |
| **1.4** | adapters 层模块仍留兼容层时，断言失败并指出该模块 | `module-roster.test.ts:234`（正向 `misplaced` + 反向 `strays` 双向） | 两端独立事实源：左 = `MODULE_ROSTER`（人写的层声明），右 = 磁盘扫描。改任一端不改另一端即报红，报文含模块名与应归包。同文件 `:294`「过渡期暂存不是永久豁免」盯住唯一松动来源 | 注入式自证 |
| **1.5** | 可在不预先构建任何产物的前提下被本仓其它包直接消费 | 读 `package.json`；四包 typecheck；四包全量测试 | adapters 包**无 `build` 脚本**；`exports = {"./*.js":"./src/*.ts"}` 直指源码；`files=["src"]`。在**未执行任何构建**的前提下四包 typecheck 全 exit 0、四包全档测试两轮全绿（§2） | 直接 |

> ⚠ **1.2 的字面反例（如实记录，不粉饰）**：`@modelcontextprotocol/sdk` 在 `packages/tool-kit`
> 也有一份 `dependencies` 声明。三点澄清：
> ① 它**自本 spec 起点即存在**（`git show 99982d5c:packages/tool-kit/package.json` 同样含该行），
>    不是本轮引入；
> ② `tool-kit` **不在守卫的 `PACKAGE_ROOTS` 名册里**（名册只含 core / server / runner / adapters），
>    故守卫对它没有约束力 —— 「守卫是绿的」在这里**不构成**「只出现在一处」的证据；
> ③ 5.2 已实测记录 MCP SDK 的闭包来源链是 `server → adapters → core → tool-kit`。
>
> ⇒ R1.2 的准确达成范围是：**在守卫覆盖的四个包根内**，三个重依赖只出现在 adapters。
> 「本仓中只应出现在此处」按字面读**不成立**。该缺口属既有、超出本 spec 边界，登记于 §5。

### Requirement 2 · 兼容层的依赖面真正缩小

| # | 验收标准 | 命令 | 实测输出摘要 | 强度 |
|---|---|---|---|---|
| **2.1** | 兼容层依赖声明不再含云沙箱 SDK / 数据库驱动 / MCP SDK | 读 `packages/server/package.json`；`package-deps.test.ts:317` | `dependencies` 共 10 项，**四者（含 `ws`）全部不在**：`@blksails/pi-web-{adapters,core,logger,protocol,runner,tool-kit}` / `@earendil-works/pi-{ai,coding-agent}` / `jiti` / `zod`。`devDependencies` 仅 3 项，亦无 | 直接 |
| **2.2** | 以**依赖闭包**的机械断言为判据，而非「搜不到导入语句」 | 5.2 父层闭包遍历（逐项记录见 §3） | 判据确为闭包遍历而非文本搜索，且**遍历结果是否定的**：四个重依赖在闭包层**全部仍在**。详见 §3 —— 这是本轮最重要的一条如实记录 | 直接（结论为部分未兑现） |
| **2.3** | 宿主同时安装 adapters 包时装配能力保持不变 | `grep -rn` 包名后**剔除注释行**；四包 + 根 app 档测试 | 装配层经**深路径**消费 adapters：**32 处真实 import / 14 个文件**（逐项与口径说明见 §4）。装配面测试 `host-assembly/default-capabilities.it.test.ts` 7 用例绿；4.1 做过判别实验（打断其中 `mcp-probe` 一处 → `Test Files 1 failed`，还原后全绿），证明该测试**真的在守**这些引用 | 直接 |
| **2.4** | 重新引入三者中任何一个时，守卫失败并指出**依赖名与所在字段** | `package-deps.test.ts:362`；5.2 父层真实破坏实验 | 套内「判别力自证:人为加入被禁依赖时报红并指出依赖名与所在字段」绿。父层另做真实破坏：把 `pg` 写回兼容层 `dependencies` → 报 `pg @ dependencies(数据库驱动)`（**名与字段同现**）。5.2 同时把策略 `kind` 从 `exempt` 翻成 `audited`，`pendingRemoval` 如期到期退场 | 注入式自证 + 真实破坏实验 |

### Requirement 3 · 主入口收窄是一次有意声明的契约变更

| # | 验收标准 | 命令 | 实测输出摘要 | 强度 |
|---|---|---|---|---|
| **3.1** | 主入口不再导出 adapters 模块的符号 | 读 `packages/server/src/index.ts`；`main-entry-symbols.it.test.ts` | 原 8 条 `export * from "@blksails/pi-web-adapters/<模块>/index.js"` 转发**整体移除**；基准值符号 **313 → 224**（−89） | 直接 |
| **3.2** | 导出面变化时，符号基准被**有意**重新生成且理由留档 | `git show 092ce934`；读 `index.ts` 文件头 | 三件工件同一提交落地：新基准 `main-entry-symbols.txt`（224）、旧基准另存 `main-entry-symbols.before-adapters-extraction.txt`（313）、移除清单 `main-entry-symbols.removed-5.1.txt`（161）。`index.ts` 内留「★ 这是**有意的破坏性契约变更**（R3.1/R3.2），不是『不小心弄丢』。两者在 diff 上长得一样，唯一的区别是留了痕」 | 直接 |
| **3.3** | 基准重生成使被移除符号可**逐一枚举**，而非只给数量差 | `awk -F'\t'` 按模块与 kind 分组计数 | 清单 **161 行**，格式 `<原转发模块> TAB <符号名> TAB <value\|type-only>`。按模块：extensions 52 / auth 32 / ai-gateway 28 / sandbox-transport 16 / identity 13 / llm-gateway 9 / tokens 9 / session-store-postgres 2（合计 161 ✓）。按 kind：**value 89 + type-only 72 = 161** ✓ | 直接 |
| **3.4** | 新基准生效后，继续以「与新基准逐字相同」把关 | `main-entry-symbols.it.test.ts`（server it 档） | server it 档 `5 passed / 15 passed \| 1 skipped (16)`，两轮逐字相同。守卫判据仍是逐字比对（多一个少一个都算破坏），只是基准换成 224 那份 | 直接 |
| **3.5** | 兼容层以版本号体现本次变更为破坏性 | 读 `packages/server/package.json` | `0.6.1 → 0.7.0`。0.x 语义下这是破坏性跃迁：`^0.6.1` 的范围是 `>=0.6.1 <0.7.0`，**不会自动升上去** —— 消费方必须显式改版本才会拿到收窄后的包 | 直接 |
| **3.6** | 登记受影响的跨仓消费方，并说明本仓不承担跨仓改动 | 见 §6 Revalidation Trigger | 唯一跨仓消费方 `pi-clouds`；从主入口导入 72 个符号，与移除清单交集 **恰好 1 个**（`resolvePiCliEntry`，value，`apps/cloud/lib/handler.ts:16`）。8 条子路径 key 逐字未变 | 直接 |

### Requirement 4 · 只搬不改

| # | 验收标准 | 命令 | 实测输出摘要 | 强度 |
|---|---|---|---|---|
| **4.1** | 搬迁不改变任何 adapter 的功能行为 | `git show -M --numstat ad1b77df`（3.1 src）与 `30fb63a5`（3.2 test） | **3.1：57 个改名文件，全部 `0/0`（纯改名，零内容变更）**；**3.2：57 个改名文件，同样全部 `0/0`**。改名+内容变更的文件数 **两次都是 0**。非改名的改动集中在清单、守卫名册与装配层引用（3.1 有 15 个、3.2 有 12 个，逐项可查） | 直接 |
| **4.2** | 没有对应端口的 adapter，**不为它新造端口** | 4.1 实施期核对 | `IdentityProvider` 实测确认是 **adapters 包内的本地类型**（`identity/types.js`），不是内核端口。搬迁按普通模块处理，**未新建端口** —— 与 spec.json `design_decisions.identity_port` 的定稿一致 | 直接 |
| **4.3** | 确有必须做的逻辑变更时，单独标注并使其可独立复核 | `git log --oneline`；tasks.md Implementation Notes | 本轮唯一超出「纯搬」的代码改动是 3.3 的**静态声明断言**（agent SDK peer 声明），单列为独立子任务、独立提交 `0c3c4c46`。6.2 的注释修正同样单列为 `91a1fa78` | 直接 |
| **4.4** | 名字暗示属 adapters 但实现不属的符号，**不移动** | `module-roster.ts` 层归属注释；反向 `strays` 断言 | 名册对三个「一分为二」的目录逐条留了判据：`rpc-channel` 判 core（「传输**抽象**；e2b 具体实现属 adapters」）、`session-store` 判 core（「接口与内存实现；postgres 实现属 adapters」）、`config` 部分留守。物理归位断言的**反向**分支（`strays`）专盯「落在某包里但层归属不该在这」 | 直接 |

### Requirement 5 · 边界守卫在四包后仍然有效

| # | 验收标准 | 命令 | 实测输出摘要 | 强度 |
|---|---|---|---|---|
| **5.1** | 依赖方向守卫与分档守卫覆盖四个包中每个模块与每个测试文件 | `package-roots.ts`；`dependency-guard.test.ts:435`；`package-deps.test.ts:244` | `PACKAGE_ROOTS` 四项：core / server / runner / **adapters**，且**名册里一个 pending 豁免都不剩**（本轮五个翻转判据豁免 `srcModules`/`srcFiles`/`stagedIn`/`testFiles`/`pendingRemoval` 已全部如期退场）。四包全部落在「每个维度都必须非空」的严格判据下 | 直接 |
| **5.2** | 守卫扫不到任何文件时必须失败，而非静默通过 | `dependency-guard.test.ts:435`「每个包根都被真的扫到了(R4.3:空扫必须失败,不得静默通过)」；`package-deps.test.ts:244`/`:311`；`module-roster.test.ts:211` | 三个守卫各自装了「空扫即失败」用例，覆盖 `srcModules` / `srcFiles` / `testFiles` 三个维度。★ 这条是本仓的历史痛点：「没装上的哨兵报的零违规」与「真没违规」长得一样 | 注入式自证 |
| **5.3** | 层归属与物理归位的一致性断言覆盖新包 | `module-roster.test.ts:234` | `LAYER_PLACEMENT` 把「adapters 层」映射到「adapters 包根」，正反双向断言。旧实现只查内核包 —— runner 包成立后 runner 层就没有任何断言看着，本轮沿用修好后的映射表版本，adapters 自动纳入 | 直接 |
| **5.4** | 新增跨包反向依赖时，依赖方向守卫失败并指出源与目标 | `dependency-guard.test.ts:361`「新包(adapters)的深路径解析得到,且它对装配层的导入被判为反向(R5.4)」；`:285`/`:307` | 该用例**在 src 搬入之前**就装好（覆盖先于搬迁）。`:307`「指向本仓包的 specifier 必须全部解析得到 —— 解析不到会被当外部依赖放行」堵住「解析失败即静默放行」这条旁路 | 注入式自证 |
| **5.5** | 新包未填充时非空校验要求它**恰好为空**，填充后自动恢复严格 | `package-roots.ts` 的 pending 机制；`module-roster.test.ts:294` | 2.1 建立 adapters 包根时三个维度全声明 pending（语义 = **必须恰好为空**）；3.1 搬入 `src/` 后 `srcModules`/`srcFiles` 被 `assertRootsContributed` 判「豁免过期」而**强制删除**；3.2 搬入 57 个测试后 `testFiles` 同样被逼退场。★ 这是「翻转判据」：任何时刻**恰有一条**约束生效，不存在无人看管的窗口 | 直接 |

### Requirement 6 · 通过面与运行形态不回退

| # | 验收标准 | 命令 | 实测输出摘要 | 强度 |
|---|---|---|---|---|
| **6.1** | 通过的文件数与用例数不低于开工快照，且连续两次运行一致 | `pnpm --filter @blksails/pi-web-{core,server,runner,adapters} test`，连跑两轮 | **两轮逐档逐字相同**（10 个档位 × Test Files/Tests 共 20 行全部 `✓`）。合计 **执行文件 284 / 用例 2623**；开工快照 284 / 2601 ⇒ 文件数**逐字相同**、用例 **+22**（本轮新增断言）。★ 20 行汇总**算术全自洽**（分项和 == 括号内总数），无 worker 静默崩溃 | 直接 |
| **6.2** | 类型检查通过，无新增错误 | 四包 `typecheck` + 根 `pnpm -r --filter '!desktop'` + 根 `tsc -p tsconfig.json --noEmit` | **六项全部 exit 0**。★ 退出码取值方式经判别自检确认有效（见 §0 的假绿纠正） | 直接 |
| **6.3** | 真实启动子进程的测试保持在允许启动子进程的档位 | `packages/adapters/scripts/run-tests.mjs`；`tier-rules.ts` 的 `E2E_ROSTER` / `RUNTIME_DETECTED_IT` | 三份名册路径随搬迁改指 `adapters/test/...`（`e2b-transport.e2e` / `sandbox-ws-transport{,.pi}.e2e` / `stub-egress.it` / `ext.e2e.it` / `ext.integration.it`）。adapters it 档 **11 文件 / 89 用例**跑真实子进程且串行（`--no-file-parallelism`，因 vitest 2.1.9 忽略 project 级 `fileParallelism`） | 直接 |
| **6.4** | 全仓解析配置使新包可源码解析，根测试与类型检查不因新包失败 | `vitest.config.ts:72`；根 typecheck；根 app 档 | alias **只一条**正则 `^@blksails/pi-web-adapters/(.*)\.js$ → packages/adapters/src/$1.ts`（新包无 `.` 主入口，裸名导入**应当**失败，那是与 `exports` 一致的正确行为，1.3 已双向判别验过）。根 tsc exit 0；根 app 档无新增 failed（§7 既有红 #2） | 直接 |
| **6.5** | 宣称完成时提供**实测运行输出**，而非仅「全绿」的结论 | 本文件 | 每条标准给命令 + 输出摘要；三处既有红单独成节并逐条复核形态；未兑现项（R2.2 闭包）与超范围项（R1.2 tool-kit）如实标注而非略去 | 元判据 |
| **6.6** | 专门搜索运行时路径字符串与重复写死的契约断言 | 6.2 专项搜索（`91a1fa78`） | 第一类：指向旧模块路径的字符串 **0** 处；指向旧测试目录的引用 1 处（`e2e/sandbox-baked-image.local.mjs:44` 注释）→ 已修。第二类：镜像内引导脚本路径散在 **3 个文件**（1 常量 + 2 断言），实测**三者全部同步**。另修掉被实测证伪注释的**第三处**（`pi-cli.ts:47`），并溯源为「复制传播」 | 直接 |

---

## 2. 通过面实测输出（R6.1 / R6.2 原始数据）

**连跑两轮，逐档逐字对照：**

| 包 | 档 | Test Files（两轮相同） | Tests（两轮相同） |
|---|---|---|---|
| core | fast | `121 passed \| 2 skipped (123)` | `1189 passed \| 3 skipped (1192)` |
| core | fast-mock | `3 passed (3)` | `9 passed (9)` |
| core | it | `48 passed (48)` | `474 passed (474)` |
| server | fast | `8 passed (8)` | `64 passed (64)` |
| server | it | `5 passed (5)` | `15 passed \| 1 skipped (16)` |
| runner | fast | `27 passed (27)` | `200 passed \| 1 skipped (201)` |
| runner | it | `19 passed \| 1 skipped (20)` | `76 passed \| 5 skipped (81)` |
| adapters | fast | `36 passed \| 1 skipped (37)` | `470 passed \| 5 skipped (475)` |
| adapters | fast-mock | `2 passed (2)` | `22 passed (22)` |
| adapters | it | `11 passed (11)` | `89 passed (89)` |
| **合计执行** | | **284** | **2623** |

四包 `EXIT=0`，两轮均是。与开工快照对比：**执行文件 284 = 284（逐字相同）**；用例 **2601 → 2623（+22）**。

★ **汇总行算术核对**：20 行逐行验 `分项之和 == 括号内总数`，**0 行不自洽**。
这一步不能省 —— 本仓有过 vitest worker 静默崩溃被计成「0 failed」的前科（10 个用例没跑却显示全绿）。

**类型检查六项：**

| 项 | 命令 | 退出码 |
|---|---|---|
| core | `pnpm --filter @blksails/pi-web-core typecheck` | 0 |
| server | `pnpm --filter @blksails/pi-web-server typecheck` | 0 |
| runner | `pnpm --filter @blksails/pi-web-runner typecheck` | 0 |
| adapters | `pnpm --filter @blksails/pi-web-adapters typecheck` | 0 |
| 全仓递归（排除 desktop） | `pnpm -r --filter '!@blksails/pi-web-desktop' run typecheck` | 0 |
| 仓库根 | `npx tsc -p tsconfig.json --noEmit` | 0 |

---

## 3. 依赖闭包逐项去留（R2.2 单列 · ★ 本轮最重要的如实记录）

R2.2 要求判据是**依赖闭包**而非「搜不到导入语句」。**本轮独立重做**了闭包遍历
（从 `@blksails/pi-web-server` 出发沿 `dependencies` 传递展开 workspace 包，
再看四个重依赖被闭包内哪些包声明），结论与 5.2 一致，**是否定的**：

兼容层闭包内的 workspace 包（9 个）：`server, tool-kit, protocol, logger, panes-kit, agent-kit, runner, core, adapters`

| 重依赖 | 兼容层**声明**层 | 兼容层**闭包**层 | 闭包内的声明方 |
|---|---|---|---|
| `e2b`（云沙箱 SDK） | 已移除 ✓ | **仍在** ✗ | `adapters` |
| `pg`（数据库驱动） | 已移除 ✓ | **仍在** ✗ | `adapters` |
| `ws`（WebSocket） | 已移除 ✓ | **仍在** ✗ | `adapters` |
| `@modelcontextprotocol/sdk` | 已移除 ✓ | **仍在** ✗ | `adapters` **和** `tool-kit`（双来源，见 U5） |

★★ **准确表述**（6.3 交付的强制口径，5.2 已明令）：

> R2.1 在**声明层**达成；但其背后的目的 —— 部署方不再连带装上这些 —— 对兼容层消费方
> **完全没有兑现**。装 `@blksails/pi-web-server` 的人照样拿到全部四个，因为兼容层
> **非可选地**依赖 adapters（`host-assembly` 有真实工厂引用，无法改成 optional）。

⇒ **不得**笼统写成「兼容层依赖面已缩小」。它缩小的是**声明**，不是**闭包**。

这机械证实了开工前对用户的判断：**切出 adapters 包不会给现有消费方省下任何依赖**。
收益只对一类宿主成立：**绕开兼容层、直接用 core + 选定 adapter 组装**（Requirement 1 的
Objective 正是为这类宿主写的）。R2 的 Objective 说「这是本特性唯一当场可测的收益」——
实测表明，可测的是**声明层的事实**，不是**部署层的收益**。

---

## 4. 装配能力逐项（R2.3 单列）

兼容层不再从主 barrel 转发 adapters，装配层改经**深路径** specifier 消费。
实测 **32 处真实 import / 14 个文件**：

> ⚠ **口径说明（复核时纠正过一次）**：直接 `grep` 包名得到的是 **35 处 / 15 文件**，
> 其中 **3 处在 `packages/server/src/index.ts` 的注释里**（5.1 留痕写下的「原本这里有 8 条
> `export * from ...`」等说明），**不是真实引用**。剔除注释行后才是 32 / 14 ——
> 而 `index.ts` **一处真实 adapters import 都没有**，这正是 5.1 收窄的结果，
> 把它列成消费方会把结论说反。

| 消费文件 | 引用的 adapters 深路径 |
|---|---|
| `packages/server/src/host-assembly/default-capabilities.ts` | `ai-gateway/routes` · `auth/auth-routes` · `auth/shell-credential-route` · `extensions/routes` · `identity/identity-routes` · `identity/types` · `llm-gateway/gateway-routes` · `mcp-probe` · `session-store-postgres/factory`（9） |
| `lib/app/pi-handler.ts` | `ai-gateway` · `auth` · `extensions` · `identity` · `llm-gateway` · `sandbox-transport` · `tokens`（7） |
| `lib/app/ai-gateway-session-assembly.ts` | `ai-gateway`（2） |
| `lib/app/ai-gateway-assembly.ts` | `ai-gateway` · `tokens`（2） |
| `lib/app/llm-gateway-assembly.ts` | `llm-gateway` · `tokens`（2） |
| `packages/server/src/host-assembly/model-sources.ts` | `auth/egress-model-source` · `ai-gateway/session-model-source`（2） |
| `packages/server/src/host-assembly/session-store.ts` | `session-store-postgres/factory`（1） |
| `packages/server/src/compat/model-options.ts` | `model-sources/model-options`（1） |
| `packages/server/src/compat/vision-model-options.ts` | `model-sources/vision-model-options`（1） |
| `lib/app/auth-egress-assembly.ts` · `cloud-defaults.ts` · `publish-execute.ts` | `auth`（各 1） |
| `lib/app/llm-gateway-config.ts` | `llm-gateway`（1） |
| `lib/app/resume-meta.ts` | `session-store-postgres`（1） |

**子路径契约保持**：兼容层 `exports` 的 **8 条 key 与 spec 起点逐字相同**，一条不减。
其中 `./model-options` / `./vision-model-options` 两条的**实现指向**改为 `src/compat/` 下的薄转发垫片
（`export * from "@blksails/pi-web-adapters/model-sources/*.js"`）—— 因为 Node 的 `exports` 目标
只能指向本包内的相对路径，无法直接指向别的包，而这两条子路径**已发布上游**，删掉是跨仓破坏。

**装配面判据的有效性**：4.1 做过判别实验 —— 打断 12 处引用中的一处（`mcp-probe`）→
`Test Files 1 failed`；还原后 7 用例全绿。⇒ 该测试**真的在守**这些引用，不是恰好为绿。

---

## 5. 主入口移除清单（R3.3 单列）

工件：`packages/server/test/compat/main-entry-symbols.removed-5.1.txt`（161 行）
格式：`<原转发模块> TAB <符号名> TAB <value|type-only>`

| 原转发模块 | 移除符号数 |
|---|---|
| `extensions` | 52 |
| `auth` | 32 |
| `ai-gateway` | 28 |
| `sandbox-transport` | 16 |
| `identity` | 13 |
| `llm-gateway` | 9 |
| `tokens` | 9 |
| `session-store-postgres` | 2 |
| **合计** | **161** |

按 kind：**value 89 + type-only 72 = 161**。

算式自洽：8 个模块的导出并集 166 − 仍由内核导出因而经 `export * from core` 留在主入口的 5 个 = **161**。

★★ **一处必须写进交付的盲区**：常驻符号基准是 `Object.keys(await jiti.import(...))` 的产物，
**只看得见运行期值**。故基准记录的收窄是 **313 → 224（89 个）**，而真实契约损失是 **161 个**
—— 另外 **72 个纯类型在基准里从来没出现过，它们消失时基准一声不响**。

⇒ **只读符号基准会低估本次变更的影响面**，评估必须读移除清单。
本仓实测已印证：`AiGatewayConfig` / `EgressModel` / `LlmGatewayProviderTable` 三个纯类型
是靠消费方 `tsc` 报红才暴露的，基准全程沉默。

★ 回看前两轮：那两轮把 313 基准当作「契约的机械判据」是**有盲区**的 —— 它们没删东西所以
没造成损失，基准足以证明「没变」，但**对纯类型的增删是瞎的**。

本仓消费方改动 **30 个文件**（`lib/app/*` / `server/cli/install/*` / 根 `test/*` / `e2e/*`），
超过派单时设的 20 个阈值 —— 这是本次契约变更的真实代价，如实记录而非淡化。

---

## 6. Revalidation Trigger — 跨仓消费方登记（R3.6）

**本仓不承担跨仓改动**（Boundary Context 明确列为 Out of scope：「跨仓改动 —— 受影响的跨仓
消费方只登记，不修改」）。以下为登记，不是待办。

### 6.1 唯一跨仓消费方：`pi-clouds`

固定版本：`@blksails/pi-web-server: ^0.6.1`（`packages/cloud-app` 与 `apps/cloud` 各一处）。

★ **`^0.6.1` 的范围是 `>=0.6.1 <0.7.0`，不覆盖 0.7.0** —— 故**在它显式升版本之前，
不会受本次收窄影响**。这是 3.5 选择主版本跃迁的直接作用。

### 6.2 升到 0.7.0 时会打断的面（机械求交，非估计）

从主入口裸包名导入的符号 **72 个**，与 161 条移除清单求交（`grep -Fxf`）：

| 破坏点 | 符号 | kind | 位置 | 迁移路径 |
|---|---|---|---|---|
| 1 | `resolvePiCliEntry` | value | `apps/cloud/lib/handler.ts:16`（另有 `:104`/`:106`/`:116` 的封装与注释） | 改从 `@blksails/pi-web-adapters/extensions/index.js` 导入 |

**交集恰好 1 个**。其余 71 个符号中，40 个仍在 224 新基准内（值符号），其余为内核经
`export * from core` 继续提供的类型。

> ⚠ 求交时的一处方法学教训：首次用 `comm -12` 得出「交集 0」，实为**假阴性** ——
> 两侧排序规则不一致（JS `.sort()` 走 ASCII，`sort` 走本地化规则），`comm` 依赖同序才正确。
> 改用 `grep -Fxf` 后得到真实结果 1。**「交集为 0」这种结论尤其要换一种方法复算。**

### 6.3 深路径子入口（不受主 barrel 收窄影响）

`pi-clouds` 引用的 6 条深路径中，**4 条是真实消费**，2 条只在注释里：

| 深路径 | 性质 | 现状 |
|---|---|---|
| `@blksails/pi-web-server/testing` | 真实 import | ✓ 仍在 `exports` |
| `@blksails/pi-web-server/host-assembly` | 真实 import | ✓ 仍在 `exports` |
| `@blksails/pi-web-server/model-options` | 真实 import | ✓ 仍在 `exports`（改指 compat 垫片，导出面不变） |
| `@blksails/pi-web-server/runner-bootstrap.mjs` | 运行时**路径字符串**（容器内绝对路径） | ⚠ 见 6.4 |
| `@blksails/pi-web-server/sandbox-image/bake-plan` | **仅注释**（`pi-web-kernel.ts:4` 的取舍记录） | 非消费点 |
| `@blksails/pi-web-server/src/attachment/http/` | **仅注释**（`internal-attachment-routes.ts:5`） | 非消费点 |

### 6.4 登记：一条**上一轮**遗留的跨仓路径欠债（非本轮引入）

`pi-clouds` 在三处写死容器内绝对路径
`/usr/local/lib/node_modules/@blksails/pi-web-server/runner-bootstrap.mjs`
（`packages/registry-server/src/bake/pi-web-kernel.ts:182` 及两处测试断言）。

该文件现位于 **runner 包**：`packages/runner/runner-bootstrap.mjs`。

★ **归属澄清**：`git ls-tree` 实测，本 spec 起点（`99982d5c`）时它**已经**在 runner 包 ——
搬迁发生在上一轮 `runner-package-extraction` 任务 3.2（`f686f937`，2026-07-29）。
**不是本轮引入**，但由于本轮做的是同一条链上的跨仓登记，一并记在此处，避免它继续无人认领。

---

## 7. 三处既有红（各自成节，逐条复核形态未变）

混在一起等于让读的人自己分辨新账旧账。三处**全部在本轮重新复现**，非沿用留档。

### 既有红 #1 · desktop 的 Rust 构建

**命令**：`pnpm test`（根，递归）
**实测输出**：

```
> @blksails/pi-web-desktop@0.3.0 test
> cargo test --manifest-path src-tauri/Cargo.toml
error: failed to run custom build command for `pi-web-desktop v0.3.0`
  resource path `binaries/node-aarch64-apple-darwin` doesn't exist
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  Exit status 101
```

**形态**：与记录在案的既有形态一致 —— desktop 的 `test`/`typecheck` 都是 Rust 构建，
缺 Node sidecar 二进制（需 `pnpm desktop:sidecar` 下载）。与本轮改动无关（本轮未碰 `desktop/`）。

★ **由此得出一条操作性结论**：`pnpm test`（根递归）**在 desktop 处即短路**，后面的包一个都跑不到。
故通过面取证**必须**走逐包命令，不能用根 `pnpm test` —— 用它会把「只跑了 desktop 就挂了」
误当成「全仓测过了」。四包证据（§2）正是这样取的。

### 既有红 #2 · 根 app 档的 worker heap OOM

**命令**：`pnpm test:app`
**实测输出**：

```
Test Files  104 passed | 1 skipped (106)
     Tests  1019 passed | 2 skipped (1031)
  Duration  71.70s
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
Error: Worker exited unexpectedly
```

**形态复核**：
- `104 + 1 = 105 ≠ 106`、`1019 + 2 = 1021 ≠ 1031` —— **10 个用例没跑**，被 worker 崩溃吞掉。
- 与记录在案的基线形态 **逐字相同**（`104 passed | 1 skipped (106)` / `1019 passed | 2 skipped (1031)`）。
- **`N failed` 出现次数：0**。

★ **判据取逐字比对而非「全绿」**：上一轮正是这样认出新增的 `1 failed` —— 当时的表现是
`1 failed | 103 passed | 1 skipped (106)`，**总数缺口同样是 1**，极易连新账一起当老账放过。
崩溃文件 `chat-app-logs-wiring.test.tsx` 自基线 `99d122a3` 起本分支从未碰过，属上游存量。

### 既有红 #3 · 产物冒烟的登录门

**命令**：`pnpm build:dist`（`EXIT=0`）→ `pnpm e2e:cli`（`EXIT=1`）
**实测输出**：

```
✓ 产物存在: server.mjs
✓ 产物存在: packages/runner/runner-bootstrap.mjs
✓ 产物存在: node_modules/@earendil-works/pi-coding-agent/dist/cli.js
✓ 产物存在: node_modules/jiti
✓ 载荷存在: payload/dist.tar.zst        ✓ 载荷存在: payload/payload.json
✓ 载荷存在: payload/unpack.mjs
✓ --help 退出0且含用法                   ✓ --version 退出0且含版本号
✓ 未知参数 退出非0
✓ CLI 启动 standalone 并就绪(Req 3.1, 1.4)      pi-web on http://127.0.0.1:3457
✗ 浏览器冒烟: page.waitForSelector: Timeout 20000ms exceeded.
  - waiting for locator('[data-pi-input-textarea]') to be visible
[diag] url=http://127.0.0.1:3457/
[diag] body="登录 pi-web\n\n使用你的云端账号登录,以启用线上 agent 源与云端模型。\n\n登录"
FAIL: 1 项
```

**形态复核**：
- **11 项全过，唯一失败仍是浏览器冒烟**，且失败原因逐字相同 —— 页面停在登录页，
  等不到 `[data-pi-input-textarea]`。`[diag] body` 明确给出登录门的文案。
- 与上一轮记录在案的形态一致：「`pnpm e2e:cli` 的浏览器冒烟超时，页面停在登录页」。
- 产物完整性清单**全过**，含 `packages/runner/runner-bootstrap.mjs`
  —— 顺带印证本轮搬迁没有打断产物寻址。

**非本轮引入的机械证据**（与运行结果独立）：
- 根因提交 `62ea71fe`「Revert "feat(identity): 登录页加「暂不登录」出口(Req 13)"」（2026-07-28）。
- `git merge-base --is-ancestor 62ea71fe 99982d5c` → **真**，即根因是本 spec 起点的**祖先**。
- 本 spec 对前端源码（`app/` / `components/` / `src/`）的改动文件数：**0**。
- 名字含 login/auth 的 4 个改动文件中，3 个是 **纯改名（`git diff -M --numstat` 为 `0/0`）**，
  第 4 个是 runner 的一个 it 测试（`+4/-1`，3.3 的注释交叉引用修正）。

---

## 8. 已知未验清单

如实登记本仓无法验证或本轮未验证的面。**登记不等于已解决。**

| # | 未验项 | 为什么本仓验不了 / 本轮没验 | 风险与建议 |
|---|---|---|---|
| U1 | 跨仓消费方 `pi-clouds` 在 **0.7.0** 下的实际编译与运行 | 跨仓改动明确 Out of scope；且 `pi-clouds` 固定 `^0.6.1`，不会自动升上来 | 风险已由 §6.2 的机械求交界定为**恰好 1 个符号**。升版本时按迁移路径改一行即可 |
| U2 | 已发布 npm 包 `@blksails/pi-web-server@0.7.0` 的真实安装树 | 本轮未发布；本仓是 workspace 源码直连，`node_modules` 布局与真实安装树不同 | 发布后需实测：装 server 是否仍连带装下 e2b/pg/ws/MCP SDK（§3 预测是**会**） |
| U3 | 「只装 core + 选定 adapter」的宿主是否真的能跑起来 | 本仓没有这样的宿主 —— 兼容层是唯一装配方 | 这是本特性收益的**唯一兑现路径**（§3），但本轮无任何证据。**建议下一轮专门立一个最小宿主验证它**，否则「未来宿主可绕开兼容层」始终是断言而非事实 |
| U4 | 真实云沙箱 / Postgres / MCP server 下 adapters 的行为 | 需外部服务凭据；e2e 档（3 个文件）本轮**未执行**（`pnpm test` 不含 e2e 档） | 搬迁为纯改名（§R4.1，`0/0`），行为变化风险低；但「低」不是「零」，仍属未验 |
| U5 | `@modelcontextprotocol/sdk` 在 `tool-kit` 的第二处声明 | `tool-kit` 不在守卫的 `PACKAGE_ROOTS` 内，守卫对它无约束力 | 既有、非本轮引入。使 R1.2 按字面读不成立（§1 的 ⚠）。若要让 R1.2 名副其实，需把 `tool-kit` 纳入包根名册 —— 属另一轮 |
| U6 | 文档同步 | Boundary Context 明确 Out of scope（「与上一轮同一笔挂账，另开一轮」） | 挂账已累计两轮，建议尽快清 |

---

## 9. 覆盖度自检

| 项 | 数 |
|---|---|
| requirements.md 的验收标准总数 | **30**（R1:5 + R2:4 + R3:6 + R4:4 + R5:5 + R6:6） |
| 本文件 §1 逐条覆盖 | **30** |
| 其中「直接」 | 23 |
| 其中「注入式自证」 | 4（1.4 / 5.2 / 5.4，另 2.4 为「注入式自证 + 真实破坏实验」） |
| 其中「元判据」 | 1（6.5） |
| 其中「部分间接」 | 1（**1.2** —— `tool-kit` 的第二处 MCP SDK 声明，见 U5） |
| 其中「直接（结论为部分未兑现）」 | 1（**2.2** —— 闭包层四个重依赖仍在，见 §3） |

> 本节数字由 `grep -oE '^\| \*\*[0-9]+\.[0-9]+\*\*'` 机械统计后逐行核对得出。
> 首稿曾写成 21 / 5 / 3，与表格实际不符 —— 已按逐行清单更正。
> **交付文档自身的汇总数字也要机械核对**，这与 §2 核对测试汇总行算术是同一条纪律。
| 任务 6.3 要求单列的三项 | §3 依赖闭包逐项去留 · §4 装配能力 · §5 主入口移除清单 ✓ |
| 三处既有红各自成节并复核形态 | §7.1 / §7.2 / §7.3 ✓ |
| 已知未验清单 | §8，6 项 ✓ |
