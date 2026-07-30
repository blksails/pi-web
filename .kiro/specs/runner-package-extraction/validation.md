# 交付证据矩阵与已知未验清单 — runner-package-extraction

> 本文件是任务 6.3 的交付物，对应需求 **3.6 / 6.5 / 4.3**，设计组件 **C6**。
>
> 它的目的**不是**宣布「全绿」。R6.5 明确要求「提供实测运行输出（含耗时与部署态证据），
> 而非仅『全绿』的结论」，R3.5 进一步要求「不把开发态运行与单元测试的通过作为引导路径
> 正确性的证据」。因此下面每一条验收标准都对应到**命令 + 实测输出**，并标出证据强度；
> 没有直接机械证据的条目如实标注，不粉饰。

## 0. 证据取样环境

| 项 | 值 |
|---|---|
| 工作树 | `/Users/hysios/Projects/BlackSail/agents/pi-web/.claude/worktrees/core-extraction` |
| 分支 | `refactor/core-extraction` |
| HEAD | `1076e151` docs(spec): 6.2 部署态证据 —— 换机复现全通过 + 产物树包解析实证 |
| 工作树状态 | `git status --short` 输出为空（无未提交改动，证据与 HEAD 严格对应） |
| spec 起点 | `802e2e50` |
| 取证时间 | 2026-07-30 |
| 产物树 | `dist/`（由 6.2 的 `pnpm build:dist` 产出，本轮复用，未重建） |

★ **本节所有证据均在本轮重新取得**（除三处显式标注「沿用留档」者）。
按 `verify-completion` 闸门要求：**报告过的成功不是证据，只有新鲜输出才是**。

---

## 1. 证据矩阵（29 条验收标准逐条）

证据强度图例：

- **直接** —— 有针对该条标准的机械判据（命令 + 输出），且判据两端是独立事实源。
- **注入式自证** —— 红路径由测试套内「判别力自证」用例以注入数据覆盖，
  而非破坏真实清单；另有父层做过的真实破坏实验作补强（见 `tasks.md` Implementation Notes）。
- **元判据** —— 该条标准约束的是**验收方法本身**，不是可执行命令；由本文件的组织方式满足。
- **部分间接** —— 本仓可验证的面已直接验证，但该标准还覆盖本仓测不到的面。

### Requirement 1 · runner 包成立且依赖面窄到可机械断言

| # | 验收标准 | 命令 | 实测输出摘要 | 强度 |
|---|---|---|---|---|
| **1.1** | 包含 runner 实现的全部模块与其引导脚本 | `find packages/runner/src -type f \| wc -l`；`ls packages/runner/runner-bootstrap.mjs` | `28`（与迁移前逐字相等，见 3.1 记录）；`packages/runner/runner-bootstrap.mjs` 存在。另由 `module-roster.test.ts:229`「层归属 ⟹ 物理归位」映射表断言把关（17 tests 绿） | 直接 |
| **1.2** | 依赖声明不含云沙箱 SDK / 数据库驱动 / WebSocket / MCP SDK | Node 机械扫描 `dependencies`+`peerDependencies`+`optionalDependencies` 对 `e2b`/`pg`/`ws`/`@modelcontextprotocol/sdk` | `banned hits: []`；实际 `dependencies` = `@blksails/pi-web-core, @blksails/pi-web-logger, @blksails/pi-web-protocol, @blksails/pi-web-tool-kit, jiti`（共 5 项） | 直接 |
| **1.3** | agent 运行时 SDK 列为 peer，由宿主决定版本 | 读 `packages/runner/package.json`；`package-deps.test.ts:221` | `peerDependencies = {"@earendil-works/pi-coding-agent":"^0.80.3"}`，`peerDependenciesMeta = null`（**未标 optional** —— runner 有 8 处值导入，标 optional 是谎）。用例「agent 运行时 SDK 以 peer 形式声明,而非硬依赖(R1.3)」绿 | 直接 |
| **1.4** | 出现被禁依赖时守卫失败并指出**依赖名与所在字段** | `npx vitest run test/tiering/package-deps.test.ts --project fast`（packages/core） | `17 passed`。其中 `:233`「判别力自证:人为加入被禁依赖时报红并指出依赖名与所在字段」、`:248`「agent SDK 被误列为普通依赖时报红」—— **红路径在套内**。父层另做过真实破坏实验：把 `pg` 写进 runner `dependencies` → 报 `pg @ dependencies(数据库驱动)`（名与字段同现） | 注入式自证 |
| **1.5** | 无需预先构建任何产物即可被本仓其它包直接消费 | 读 `package.json`；三包 + 根类型检查；全量测试 | runner 包**无 `build` 脚本**；`exports` 直指源码（`"." → ./src/runner/index.ts`，`"./*.js" → ./src/*.ts`）；`@blksails/pi-web-server` 以 `workspace:*` 依赖它。在**未执行任何构建**的前提下，三包 typecheck 全 exit 0、三包全档测试全绿（见 §2） | 直接 |

### Requirement 2 · 兼容层对外契约逐字不变

| # | 验收标准 | 命令 | 实测输出摘要 | 强度 |
|---|---|---|---|---|
| **2.1** | 主入口导出符号集合逐字相同 | `npx vitest run test/compat/main-entry-symbols.it.test.ts --project it`；`git diff --stat 802e2e50..HEAD -- packages/server/test/compat/` | `1 passed / 2 tests`，「与入库基准逐字相同(多一个少一个都算破坏)」2682ms。基准文件 `main-entry-symbols.txt` **313 行**。★ 关键：基准文件自 spec 起点 `802e2e50` 以来 **diff 为空** —— 排除了「改基准去迁就实现」这条最常见的作弊路径 | 直接 |
| **2.2** | 保留全部子路径导出，一个都不减少 | 对比 `git show 802e2e50:packages/server/package.json` 与当前 | 基线 6 条：`.` / `./trust` / `./model-options` / `./vision-model-options` / `./testing` / `./host-assembly` —— **6 条全部保留**。当前 8 条，新增 `./host-assembly/session-store.js`、`./host-assembly/model-sources.js`。**新增不是减少，字面合规**；但它永久拓宽了兼容层公开 API，已按 design 登记为 Revalidation Trigger（`tasks.md` Note 3.4） | 直接 |
| **2.3** | 名字含 runner 但实现不属 runner 的不移动 | `grep -rn "RUNNER_" packages/server/src --include="*.ts"` | 三个常量仍在兼容层：`packages/server/src/ai-gateway/session-model-source.ts:26/28/30` — `RUNNER_AI_GATEWAY_BASE_ENV` / `RUNNER_AI_GATEWAY_KEY_ENV` / `RUNNER_AI_GATEWAY_MODELS_ENV`。权威判据仍是 2.1 的 313 符号基准（搬走会当场少 3 个符号） | 直接 |
| **2.4** | 改动前不从主入口导出的 runner 符号，缺口保持不补全 | 读 `packages/server/src/index.ts`；2.1 的符号基准 | `index.ts:3-8` 显式注释「不再从此主入口 re-export `./runner/index.js`」，主入口与 runner 相关的导出仅 `:31 runnerBootstrapPath`（改动前即有）。4.1 新增的三个 `@internal` 符号（`resolveRunnerBootstrapPath` / `defaultResolutionDeps` / `RunnerBootstrapResolutionDeps`）**未泄进主入口** —— 由 313 符号基准逐字比对覆盖 | 直接 |
| **2.5** | 既有消费方的导入路径与启动命令无需改动 | `git diff --name-only 802e2e50..HEAD` 过滤消费方入口；`grep runnerBootstrapPath()` | 消费方入口 `lib/app/pi-handler.ts` / `bin/` / `scripts/dev*` **一个都没进改动清单**；`pi-handler.ts:216,453` 两处调用签名不变（无参、返回 string）。142 个改动文件中，`packages/{core,server,runner}` 与 `.kiro/` 之外仅 7 个（`vitest.config.ts`、`scripts/build-server.mjs`、`package.json`、`pnpm-lock.yaml`、两个测试、一个 README） | 部分间接 ⚠ |

> ⚠ **2.5 的间接部分**：该包已发布上游，跨仓消费方（pi-clouds、桌面壳、已烘焙的沙箱镜像）
> 无法在本仓验证。本仓内的消费方零改动是直接证据；跨仓面属 §3 已知未验。

### Requirement 3 · 引导路径在部署形态下可解析，且验证不依赖开发态

| # | 验收标准 | 命令 | 实测输出摘要 | 强度 |
|---|---|---|---|---|
| **3.1** | 开发态 / 打包产物态 / 独立分发态均返回真实存在的引导脚本 | ① `cd /tmp && node --import jiti-register <probe>` ② `createRequire(<dist/server.mjs>).resolve("@blksails/pi-web-runner/runner-bootstrap.mjs")` ③ `pnpm e2e:cli:reloc` | ① `cwd=/private/tmp` → `.../packages/runner/runner-bootstrap.mjs`，`exists=true`（**cwd 无关性实证**：第②级不可能命中，故返回值只能来自第①级包解析）② → `.../dist/packages/runner/runner-bootstrap.mjs`，`exists=true` ③ 独立分发态见 3.4 | 直接 |
| **3.2** | 引导脚本随 runner 迁移后，兼容层导出的路径解析能力仍返回可用路径 | 同上；解析函数留在 `packages/server/src/runner-bootstrap-path.ts`，由主入口 `index.ts:31` 导出 | 上述三形态的返回值**全部由 `runnerBootstrapPath()` 产出**。该模块只做解析、从不 `import` 新包实现（`createRequire().resolve()` 只返回字符串），故未把 runner 与 agent SDK 拉进服务端产物 | 直接 |
| **3.3** | 解析不到即在解析时失败并指出所查位置，不延后到子进程启动 | `npx vitest run test/runner-bootstrap-path.test.ts --project fast` | `1 passed / 8 tests`。源码 `runner-bootstrap-path.ts:100-103` 抛错消息拼接 `attempted[]`，含**两级所查位置各自的确切原因**（`ERR` 原文 / 具体路径）。★ 这是本 spec **唯一有意的逻辑变更**：旧实现第②级无条件返回、不做 `existsSync`，失败被延后到 spawn 时才以 ENOENT 现形 | 直接 |
| **3.4** | 产物被移动到构建时位置之外仍成立，且由换机复现的端到端验证覆盖 | `pnpm e2e:cli:reloc` | **PASS: 全部通过（14 项）**。最要紧的三条：`✓ 运行时落在与构建目录无关的绝对路径`（解包到 `/var/folders/.../pi-web-runtime-tEqdBt/0.3.2-b2ddf80357f9/dist`）、`✓ 解包出的产物激活真实会话(无模块/CLI 解析错误)`、`✓ mock 被真实 runner 调用` —— runner **真的被拉起并跑通了会话** | 直接（最强） |
| **3.5** | 验收不把开发态运行与单元测试的通过作为引导路径正确性的证据 | —（判据约束） | 3.1 的通过依据是 **dist 产物树包解析** 与 **reloc 换机 e2e**；开发态探针（cwd=/tmp）只用于证明第①级与 cwd 无关这一**单一性质**，不单独充当 3.1 的通过依据。`runner-bootstrap-path.test.ts` 的 8 个单测只计入 3.3（错误消息内容），不计入 3.1/3.4 | 元判据 |
| **3.6** | 桌面形态与沙箱烘焙形态显式列为已知未验并写明风险与触发条件 | — | 见本文件 **§3 已知未验清单**（两项各含风险、触发条件、可验时机） | 元判据（本文件即证据） |

### Requirement 4 · 内置扩展在新的模块解析根下仍然可用

| # | 验收标准 | 命令 | 实测输出摘要 | 强度 |
|---|---|---|---|---|
| **4.1** | runner 在新包中运行时，内置扩展全部可被解析并装载 | `npx vitest run test/runner/builtin-extensions.test.ts test/runner/self-resolved-builtins.test.ts --project fast --reporter=verbose`（packages/runner） | `14 passed \| 1 skipped (15)`。关键两条：`✓ ★ 默认清单在**新包**解析根下装载成功:3 条且每条真实存在`；`✓ tool-kit 必须声明在 runner 包自己的 dependencies 里(monorepo 提升会掩盖遗漏)`。另 `self-resolved-builtins`：`✓ 三个入口分别指向 extension-tools / auto-title / mcp 扩展文件`、`✓ 解析出的入口是**真实存在的文件**` | 直接 |
| **4.2** | 某个内置扩展解析不到时产生可观测的失败信号，而非静默跳过 | 同上（实测 stderr） | 实测捕获到结构化告警：`PILOG {"level":"warn","ns":"runner:builtin-extensions","msg":"builtin extension entry not resolvable in this install tree","data":{"id":"extension-tools"}}` 与 `"msg":"builtin extension entry resolve threw","data":{"id":"extension-tools","error":"boom"}`。用例 `✓ 解析不到的条目被跳过,其余照常返回`、`✓ 单个条目抛错被吞掉,不影响其余、不外溢` | 直接 ⚠ |
| **4.3** | 以内置扩展**实际装载成功**为判据，而非以「没有报错」为判据 | 同上 | 断言取「返回 **3 条**入口且每条 `existsSync` 为真」，不取「没有报错」。★ 并且 `tasks.md` Note 5.1 记录了这条断言的**已知局限**：在 monorepo 里它恒真（摘掉 `tool-kit` 依赖后 Node 仍会向上走到仓库根 `node_modules`），故补了一条**静态声明断言**（`tool-kit` 必须在 runner 自己的 `dependencies` 里）。两条分工：解析断言证明「本仓语境下能装载」，声明断言证明「换到只装本包的安装树也能装载」 | 直接 |

> ⚠ **4.2 的语义须如实说明**：可观测信号是 **`log.warn` 级别的结构化日志 + 跳过该条**，
> **不是抛错**。这是 design C4 明确划定的范围外事项：把它升级为抛错会让某形态缺代码时
> 从「能力不可用」变成「会话失败」，属行为变更。因此 4.2 达成的是「有可观测信号」，
> 而非「会导致失败」—— 若运维侧不采集 `runner:builtin-extensions` 命名空间的 warn，
> 这个信号在生产上仍可能无人读到。

### Requirement 5 · 边界守卫在多包后仍然有效

| # | 验收标准 | 命令 | 实测输出摘要 | 强度 |
|---|---|---|---|---|
| **5.1** | 依赖方向守卫覆盖全部三个包中的每个模块 | `npx vitest run test/tiering --project fast`（packages/core） | `6 passed / 80 tests`。`package-roots.test.ts:27` 断言 `PACKAGE_ROOTS.map(r=>r.name) === ["core","server","runner"]`；`:30`「runner 包根指向 @blksails/pi-web-runner(R5.1)」；`module-roster.test.ts:189`「覆盖各包 src/ 下每个顶层模块,无遗漏」；`dependency-guard.test.ts:356`「每个包根都被真的扫到了」 | 直接 |
| **5.2** | 分档守卫覆盖全部三个包中的每个测试文件 | 同上（`tier-guard.test.ts`，5 tests） | `:104`「每个测试文件恰好归入一档,总数守恒」；`:114`「名册里的文件确实存在(防重命名后名册腐烂)」；`:120`「每个包根都被真的扫到了(空扫必须失败)」；`:72`「没有文件把自己声明得比判定更宽松」；`:89`「没有文件靠 e2e 后缀悄悄退出默认路径」 | 直接 |
| **5.3** | 守卫扫描不到任何文件时守卫失败，而非静默通过 | 同上（`package-roots.test.ts`，15 tests） | `:80`「未声明 pending 的包根扫到 0 个 → 抛错并指出是哪个包根」；`:86`「计数里压根没有该包根(而非 0)同样算空扫」；`:42`「包根路径不存在 → 抛错并指出所查的 package.json」；`:49`「包根指到了隔壁包 → 抛错」；`:57`「★ pending 豁免不是路径笔误的藏身处:路径错了照样报红」 | 注入式自证 |
| **5.4** | 新增跨包反向依赖时守卫失败并指出源与目标 | 同上（`dependency-guard.test.ts`，7 tests） | `:319`「新包(runner)对兼容层的导入被判为反向 —— 覆盖在 src 搬入之前就装好」；`:280`「需要被深路径引用的包都声明了 src 通配子路径(R5.4)」（漏声明会让守卫**失明**而非报错）；`:302`「指向本仓包的 specifier 必须全部解析得到 —— 解析不到会被当外部依赖放行」。父层真实破坏实验：临时删掉 `ALLOWED_EDGES` 豁免 → 立刻报 `runner(runner) → host-assembly(assembly)` | 注入式自证 |
| **5.5** | 层归属与物理归位的一致性断言覆盖新包 | 同上（`module-roster.test.ts`，17 tests） | `:229`「★ 层归属 ⟹ 物理归位:每层模块必须真在该层对应的包里(R5.5,映射表驱动)」—— 由硬编码只查内核包改为 `LAYER_PLACEMENT` 映射表（`Record<Layer,…>`，新增一层漏表即类型错误）；`:289`「★ 过渡期暂存不是永久豁免:目标包根一停 pending,判据当场恢复严格」。父层真实破坏实验：把一个 runner 层模块的名册归属改成内核层 → 报 `runner(core) 不在 core 包` | 直接 |

### Requirement 6 · 通过面与运行形态不回退

| # | 验收标准 | 命令 | 实测输出摘要 | 强度 |
|---|---|---|---|---|
| **6.1** | 全量测试通过的文件数与用例数不低于开工快照，且连续两次运行一致 | 见 §2 全表 | 本轮（**第三次**运行）逐档数字与 6.1 留档的两次**逐字相同**：core fast 121+2=123 / 1169+3=1172；core mock 3/9；core it 48/474；server fast 44+1=45 / 533+5=538；server mock 2/22；server it 16 / 103+1=104；runner fast 27 / 200+1=201；runner it 19+1=20 / 76+5=81。**每档汇总行算术自洽**（passed+skipped == total）。与开工快照比对：执行数 282 → 284（+2），用例 2564 → 2601（+37），无文件丢失 | 直接 |
| **6.2** | 类型检查通过，无新增错误 | 三包 `typecheck`；`pnpm -r --filter '!@blksails/pi-web-desktop' run typecheck`；`npx tsc -p tsconfig.json --noEmit` | `core typecheck: exit 0` / `server typecheck: exit 0` / `runner typecheck: exit 0`；递归（排除 desktop）`EXIT=0`；根 `tsc --noEmit` `exit 0`。desktop 是**既有红**，见 §4-① | 直接 |
| **6.3** | 真实启动子进程的测试保持在允许启动子进程的档位 | `find packages/runner/test -name '*subprocess*.it.test.ts'`；runner it 档实跑 | **8 个** `*-subprocess.it.test.ts` 全部落在 `.it` 档（`attachment-catalog` / `agent-routes` / `egress-login` / `attachment-profile-disabled` / `attachment-catalog-restart` / `settings-assembly` / `attachment-profile` / `attachment-catalog-busy-publish`）。it 档 20 文件实跑 **115.45s**（对比 fast 档 27 文件仅 2.70s）—— 耗时差本身就是子进程真的在起的机械证据。4 个非 `.ts` 固件（4 个 `.json`）一并归位于 `test/runner/fixtures/` | 直接 |
| **6.4** | 全仓解析配置使新包可被源码方式解析，仓库根的测试与类型检查均不因新包失败 | `grep pi-web-runner vitest.config.ts`；`grep pi-web-runner scripts/build-server.mjs`；`pnpm test:app`；根 `tsc` | `vitest.config.ts` 有 5 条 runner 别名，其中 `:46` 的 `.js→.ts` 正则排在具名子路径之前、`:60` 的 **`$` 锚定正则裸名条**排在 `:61` 前缀条之前（vite 字符串 alias 是朴素前缀匹配，顺序错会拼出四不像路径）。`scripts/build-server.mjs` 的别名表 **grep 为空**（与内核同理，走通配子路径由解析器原生展开）。根 `pnpm test:app` 结果与基线形态逐字相同（见 §4-②），根 `tsc` exit 0。根 `test:fast` / `test:e2e` 串联已纳入 runner（排在末尾） | 直接 |
| **6.5** | 宣称完成时提供实测运行输出（含耗时与部署态证据），而非仅「全绿」的结论 | — | 本文件 §1 每行给命令 + 实测输出，§2 给逐档汇总行原文（含耗时），§3 给部署态与未验面，§4 分离既有红，§5 记录本轮真回归 | 元判据（本文件即证据） |

**自查：条目计数** — R1: 1.1–1.5（5）+ R2: 2.1–2.5（5）+ R3: 3.1–3.6（6）+ R4: 4.1–4.3（3）
+ R5: 5.1–5.5（5）+ R6: 6.1–6.5（5）= **29 行，无遗漏、无重号**。

---

## 2. 实测运行输出留档（本轮新鲜取得）

| 包 / 面 | 命令 | 文件 | 用例 | 算术 | 耗时 |
|---|---|---|---|---|---|
| core fast | `pnpm --filter @blksails/pi-web-core test:fast` | 121 passed \| 2 skipped (123) | 1169 passed \| 3 skipped (1172) | ✓ | 1.81s |
| core mock | 同上（第二 project） | 3 passed (3) | 9 passed (9) | ✓ | 1.34s |
| core it | `pnpm --filter @blksails/pi-web-core test` | 48 passed (48) | 474 passed (474) | ✓ | 16.37s |
| server fast | `pnpm --filter @blksails/pi-web-server test:fast` | 44 passed \| 1 skipped (45) | 533 passed \| 5 skipped (538) | ✓ | 1.53s |
| server mock | 同上 | 2 passed (2) | 22 passed (22) | ✓ | 0.60s |
| server it | `pnpm --filter @blksails/pi-web-server test` | 16 passed (16) | 103 passed \| 1 skipped (104) | ✓ | 16.75s |
| runner fast | `pnpm test:fast`（根串联，runner 段） | 27 passed (27) | 200 passed \| 1 skipped (201) | ✓ | 2.70s |
| runner mock | 同上 | 空档（`No test files found, exiting with code 0`） | — | — | — |
| runner it | `pnpm --filter @blksails/pi-web-runner test` | 19 passed \| 1 skipped (20) | 76 passed \| 5 skipped (81) | ✓ | 115.45s |
| 根 app 档 | `pnpm test:app` | 104 passed \| 1 skipped (**106**) | 1019 passed \| 2 skipped (**1031**) | ✗ **既有缺口** | 66.90s |
| 根三包串联 | `pnpm test:fast` | — | — | — | `EXIT=0` |

**类型检查**

| 范围 | 命令 | 结果 |
|---|---|---|
| core | `pnpm --filter @blksails/pi-web-core typecheck` | exit 0 |
| server | `pnpm --filter @blksails/pi-web-server typecheck` | exit 0 |
| runner | `pnpm --filter @blksails/pi-web-runner typecheck` | exit 0 |
| 全仓递归（排除 desktop） | `pnpm -r --filter '!@blksails/pi-web-desktop' run typecheck` | `EXIT=0` |
| 仓库根 | `npx tsc -p tsconfig.json --noEmit` | exit 0 |

**部署态证据**（R3.5：dev 态与单测的绿**不计入**本节）

| 证据 | 命令 | 结果 |
|---|---|---|
| ★ 产物树包解析 | `createRequire(<dist/server.mjs>).resolve("@blksails/pi-web-runner/runner-bootstrap.mjs")` | → `dist/packages/runner/runner-bootstrap.mjs`，`exists=true` |
| ★ 旧包名对照（阴性对照） | 同上，specifier 换成 `@blksails/pi-web-server/runner-bootstrap.mjs` | `FAILED ERR_PACKAGE_PATH_NOT_EXPORTED` —— 旧路径**确实断了**，证明生效的是新路径而非两条都通 |
| ★ cwd 无关性 | `cd /tmp && node --import jiti-register <probe>` | `cwd=/private/tmp` → 返回 worktree 内绝对路径，`exists=true`（第②级不可能命中 ⇒ 第①级包解析在起作用） |
| ★★ 换机复现 | `pnpm e2e:cli:reloc` | **PASS: 全部通过（14 项）** |
| 产物完整性清单 | `pnpm e2e:cli` | `✓ 产物存在: packages/runner/runner-bootstrap.mjs` 等清单全过；末项浏览器冒烟失败 → **既有红**，见 §4-③ |

> ★ 汇总行算术核对是硬要求：`passed + skipped == total`。不相等意味着有 worker
> **静默崩溃** —— vitest 会把它计成「0 failed」，本仓已被这种形态骗过一次。
> 上表中唯一不相等的是根 app 档，形态与基线逐字相同（§4-②）。

---

## 3. 已知未验清单（R3.6）

以下两种运行形态**本轮未验证**。它们不是「大概没问题」，是**没有证据**。

### ① 桌面形态（Tauri）

| 项 | 内容 |
|---|---|
| **未验内容** | 桌面壳启动的后端进程中，`runnerBootstrapPath()` 能否解析到引导脚本；打包后的 `.app` 内包解析根是否仍指向 `@blksails/pi-web-runner` |
| **为何未验** | 桌面包的 `typecheck` 是 `cargo check`，本机挂在 Rust 构建（缺 `binaries/node-aarch64-apple-darwin` sidecar，见 §4-①）；跑通 `pnpm e2e:desktop:*` 需先补 sidecar 并完成 Tauri 打包，超出本 spec 范围 |
| **风险** | **中**。design `:209` 判断第①级包解析与 `process.cwd()` 无关、可覆盖 desktop 形态，但那是**推理，不是实测**。若桌面产物的模块布局与 `dist/` 不同（例如 `node_modules/@blksails/*` 未随包进入 `.app`），第①级会失败并降级到第②级；桌面壳的 cwd 不受控，第②级大概率也不成立 → **本 spec 新加的第③级会抛错**。所幸失败形态是**解析时立刻抛错并列出所查位置**，而不是旧实现那种延后到 spawn 的 ENOENT —— 这降低了排障成本，但不改变「桌面形态可能起不来」这个后果 |
| **触发条件 / 何时可验** | 补齐 Node sidecar → `pnpm desktop:build` → `pnpm e2e:desktop:packaged`（或 `e2e:desktop:real`）。**建议在下一次桌面版发布前作为阻塞项执行** |

### ② e2b 沙箱烘焙形态

| 项 | 内容 |
|---|---|
| **未验内容** | 沙箱镜像内 `AGENT_CMD` 指向的引导脚本路径是否真实存在并可拉起 runner |
| **本仓已做的** | `packages/server/src/sandbox-image/bake-plan.ts:194` 常量已随包名更新为 `/usr/local/lib/node_modules/@blksails/pi-web-runner/runner-bootstrap.mjs`；两处 `AGENT_CMD` 字节契约断言（`bake-plan.test.ts`、`test/sandbox-image-build.integration.test.ts:255`）已同步并全绿 |
| **本仓测不到的** | 该常量指向的是**基础镜像里已发布的 npm 包**，不是本仓源码树。本仓的测试只能校验常量被正确拼进 `AGENT_CMD` 字面量 |
| **风险** | **高**。★ **代码合并 + npm 已发 ≠ 真机可用** —— 本仓已有前科（`sandbox-mcp-base-image-staleness`：代码合 main、npm 已发，真机仍不可用，真因是基座镜像未重烘焙）。在下述三步完成前，任何用当前基础镜像启动的沙箱都会指向**不存在的路径**，runner 起不来 |
| **触发条件 / 何时可验** | 必须依次完成三步，缺一不可：<br>1. 跨仓：pi-clouds 的 `Dockerfile.pi` 把 `npm i -g` 的包名改为 `@blksails/pi-web-runner`；<br>2. 新版 `@blksails/pi-web-runner` **发布到 npm**；<br>3. **基础镜像重烘焙**。<br>三步完成后跑 `pnpm e2e:sandbox-baked` 取真机证据 |

> 两项的共同性质：**本仓的绿对它们零信息量**。这正是 R3.5 立那条判据的原因。

---

## 4. 三处既有红（与本 spec 结果分离，不得混计）

这三处在本轮**复核过形态**，均与基线逐字相同，非本 spec 引入。

### ① `desktop` 的 `typecheck` 挂在 Rust 构建

- **命令**：`pnpm --filter @blksails/pi-web-desktop typecheck`
- **实测**：`resource path 'binaries/node-aarch64-apple-darwin' doesn't exist` → `Exit status 101`
- **性质**：该包的 `typecheck` 脚本是 `cargo check --manifest-path src-tauri/Cargo.toml`，
  不是 TypeScript 检查；失败原因是本机缺 Node sidecar 二进制，与本 spec 无关。
- **影响判据的方式**：任何以「根 `pnpm -r run typecheck` exit 0」为判据的地方**必须排除 desktop**，
  否则会把既有红误记成本次改动的回归。本文件 6.2 采用的就是排除口径。

### ② 根 `pnpm test:app` 的 worker heap OOM 吞掉 10 个用例

- **命令**：`pnpm test:app`
- **实测**：`Test Files 104 passed | 1 skipped (106)`；`Tests 1019 passed | 2 skipped (1031)`
  → `104+1=105 ≠ 106`，`1019+2=1021 ≠ 1031`，**10 个用例根本没跑**。
- **根因**：`chat-app-logs-wiring.test.tsx` 的 worker `heap out of memory`。
- **性质**：该文件自基线 `99d122a3` 起本分支**从未碰过**，属上游存量。
- **★ 陷阱**：vitest 把 worker 崩溃计成「0 failed」，汇总行看起来像全绿。
  必须核对 `passed + skipped == total`。6.1 期间正是靠与这个**记录在案的基线形态逐字比对**，
  才把新引入的 `1 failed` 从既有缺口里分辨出来（两者的总数缺口都是 1，极易一起放过）。

### ③ `pnpm e2e:cli` 浏览器冒烟停在登录页

- **命令**：`pnpm e2e:cli`
- **实测**：产物清单 11 项全过（含 `✓ 产物存在: packages/runner/runner-bootstrap.mjs`、
  `✓ CLI 启动 standalone 并就绪`），末项
  `✗ 浏览器冒烟: page.waitForSelector: Timeout 20000ms exceeded`，
  诊断输出 `body="登录 pi-web / 使用你的云端账号登录…"` → `FAIL: 1 项`。
- **根因**：`62ea71fe` 「Revert "feat(identity): 登录页加「暂不登录」出口(Req 13)"」（2026-07-28）。
- **溯源证据**：`git merge-base --is-ancestor 62ea71fe 802e2e50` → **是本 spec 起点的祖先**。
  且 `git diff --name-only 802e2e50..HEAD` 中唯二匹配 `login` 的是 3.3 搬迁的
  runner 测试固件（`egress-login-subprocess.it.test.ts` 及其 fixture），本 spec 未碰任何前端 / 登录代码。

---

## 5. 本 spec 过程中发现的两个真回归（诚实交付）

两者都已修复，都属**同一个失效族**：类型检查看不见的运行时字符串 / 重复写死的契约。
记在这里是因为它们的**失效模式**比它们本身更值钱。

### ① 任务 3.3 漏搬一处运行时路径字符串

- **漏网点**：`e2e/node/source-settings-endpoint.e2e.test.ts` 里指向 fixture 的运行时路径字符串
  未随 3.3 的 79 个 `git mv` 更新。
- **由谁发现**：任务 3.4。
- **为什么隐蔽**：它是**字符串**，不是 import。TypeScript 对这类路径完全无感 —— 类型检查
  exit 0、相关档位全绿，只有真跑到那个 e2e 才会以 ENOENT 现形。
- **同族前科**：上一个 spec（`core-package-extraction`）因同一原因漏搬 5 个 `.mjs` 固件。
  本 spec 因此在 3.3 里显式把「非 `.ts` 固件」写成检查项，4 个 `.json` 固件确实一并搬到位。
- **可靠的发现手段**：**只能靠专门的字符串搜索**（按旧目录名全仓 grep），
  不会有任何测试或类型检查主动报错。

### ② 任务 4.2 漏了第二处 `AGENT_CMD` 字节契约断言

- **漏网点**：`test/sandbox-image-build.integration.test.ts:255` 是 `AGENT_CMD` 的**第二处**
  逐行断言；4.2 改常量时只更新了 `packages/server/test/sandbox-image/bake-plan.test.ts`。
- **由谁发现**：任务 6.1 跑全量时。
- **为什么隐蔽**：4.2 自己跑的 `server test:fast` / `core test:fast` / `typecheck` **全绿** ——
  漏的那处在**仓库根 app 档**，不在包内任何档位。跨档位的重复契约断言，单包验证看不见。
- **叠加陷阱**：现形时的形态是 `1 failed | 103 passed | 1 skipped (106)`，
  而既有 OOM 红的形态是 `104 passed | 1 skipped (106)` —— **总数缺口都是 1**，
  很容易把新增的 `1 failed` 当成老毛病一起放过。修复后回到基线形态逐字相同。
- **已做的加固**：两处断言各加了注释说明彼此存在，避免下次再只改一处。

> 两条共同的教训：**同一份契约写在两个地方，就一定会有一次只改一处**。
> 而「只改一处」的代价取决于另一处在哪个档位 —— 落在你不跑的那个档位时，它会一路绿到部署。

---

## 6. 结论与残余风险

**本仓面**：29 条验收标准全部有对应证据。强度分布（机械计数，29 = 22+3+3+1）：
**22 条直接机械证据**、**3 条注入式自证**（1.4 / 5.3 / 5.4 —— 红路径在测试套内，
另有父层真实破坏实验补强）、**3 条元判据**（3.5 / 3.6 / 6.5 —— 约束的是验收方法本身，
由本文件的组织方式满足）、**1 条部分间接**（2.5 —— 跨仓消费方本仓测不到）。
无回退：通过面较开工快照 +2 文件 / +37 用例，
类型检查全范围（排除既有红 desktop）exit 0。

**部署态**：dev / dist / standalone 三形态均有直接证据，换机复现 e2e 14 项全通过，
且有旧包名阴性对照证明生效的确实是新解析路径。

**残余风险集中在两处，均已在 §3 显式登记**：桌面形态（中）、e2b 沙箱烘焙形态（高）。
后者需跨仓改动 + 发 npm + 基础镜像重烘焙三步才可验，**在三步完成前不得宣称沙箱可用**。

---

## 7. 终验补充：依赖闭包的精确表述（validate-impl 阶段发现）

R1.2 约束的是「依赖**声明**」，该条已由守卫直接验证（新包 `dependencies` 扫描 `banned hits: []`）。
但终验时额外算了一遍**传递依赖闭包**，结果需要把交付措辞收紧：

| 被禁项 | 在新包**声明**中 | 在**传递闭包**中 |
|---|---|---|
| `e2b`（云沙箱 SDK） | 否 ✓ | **否 ✓** |
| `pg`（数据库驱动） | 否 ✓ | **否 ✓** |
| `ws`（WebSocket） | 否 ✓ | **否 ✓** |
| `@modelcontextprotocol/sdk` | 否 ✓ | **是** —— 经 `@blksails/pi-web-tool-kit` |

★ 结论：brief 里最刺眼的那条抱怨（「e2b 沙箱镜像里的 runner 装着 e2b SDK」）以及 `pg` / `ws`
**三项在声明层与传递层都已消除**，这是本 spec 的核心价值主张，成立。

⚠ 但 **MCP SDK 会经 tool-kit 传递引入**。这不是缺陷：`mcp` 是三个内置扩展之一，实现就住在
tool-kit，而 R4.1 明确要求它可装载 —— 也就是说 runner 的功能集**需要**它。
故正确表述是「**声明层**不含 MCP SDK」，而不是「runner 的安装树里没有 MCP SDK」。
若将来要连传递层一并消除，须先把 `mcp` 内置扩展从 tool-kit 拆出（属另一个 spec 的范围）。

### 依赖方向复核（跨包后）

- `packages/runner/src` 对兼容层**无任何静态 `import`**（grep 到的 3 处均为注释）
- 仅 2 条**动态**上行边，均指向 `@blksails/pi-web-server/host-assembly/*.js`，
  已登记于 `ALLOWED_EDGES`（1 条，本 spec **未扩大**）；`KNOWN_DEBT` 仍为空
- 守卫仍能看见这条跨包边 —— 临时删豁免即报 `runner(runner) → host-assembly(assembly)`
