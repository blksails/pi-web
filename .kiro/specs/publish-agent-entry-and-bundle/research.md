# Research Log

## Discovery Scope

**类型**:Extension(改造既有 publish 链路)⇒ light discovery。
**特殊性**:本 spec 的发现工作**先于 spec 存在** —— 全部关键事实来自 pi-clouds `#6 发布→应用闭环 E2E` 的**生产真机执行**(2026-07-20),而非事后代码走查。缺陷是被真实发布行为撞出来的,证据强度高于静态分析。

**证据链**:
- pi-clouds `.kiro/specs/closed-loop-e2e/execution-report-2026-07-20.md` — 真机执行报告
- 本仓 `docs/defect-agent-publish-declaration-gaps.md` — 缺陷记录基线

## Investigations

### I1:#28 根因两侧(已实证)

| 侧 | 位置 | 事实 |
|---|---|---|
| pi-web | `server/cli/publish/manifest-compiler.ts:204-217` | `sign()` 产出字段集不含 `entry` |
| pi-clouds | `packages/registry-client/src/manifest/validate.ts:74-76` | `kind==="agent"` 无条件 `assertIntegrityRef(m["entry"],"entry")` |

**生产实证**:`failureReason: "VALIDATION: manifest.entry must be an object"`,`setChannel` 报 `VERSION_REJECTED`,版本 `e2e/agent-routes-demo@1.0.0` 被永久烧掉。

**Implication**:必须由发布侧补 `entry`;服务端放宽会把编译期硬失败降级成运行期故障,更差。

### I2:补一半更危险(决定性)

pi-clouds `registry-service.ts:850-852` 的 `collectIntegrityRefs` **无条件收 `manifest.entry`**,`:371-381` 逐项回源 `readFile`,取不到即 `persistFailed(INTEGRITY)`。

**Implication**:只补 `manifest.entry` 而不把入口文件打进 bundle,**版本号照样烧**,只是 `failureReason` 从 VALIDATION 变成 INTEGRITY。⇒ Req 1.1 与 Req 2.1 必须成对实现,不可分期。

### I3:走私为何有效(解释了现状)

安装侧 `server/cli/install/registry-install.ts:180-186` 把**整个解包目录 rename** 为 targetDir,**不按 refs 挑文件**。

**Implication**:「进 `bundlePaths` 即可被运行时看到」这一前提成立,因此本设计只需保证文件进入 tarball,无需扩展 refs 语义。也解释了 #6 中把 `index.ts` 塞进 `pi.extensions` 为何能跑通。

### I4:两处运行时约定早已存在(推翻「新增约定」的假设)

| 约定 | 位置 | 语义 |
|---|---|---|
| 入口 | `packages/server/src/agent-source/entry-probe.ts:51-68` | `package.json#pi-web.entry` 覆盖优先(缺失即 `EntryOverrideError`,不静默回退)→ `index.ts` > `index.js` > `index.mjs` → `{kind:"none"}` |
| webext | `packages/server/src/plugin/resolve-plugin.ts:23,197-210` | 显式 `web.dist` 优先(缺 manifest.json 进 diagnostics 忽略)→ 否则探测 `DEFAULT_WEBEXT_DIST = .pi/web/dist` |

**Implication**:本 spec 的性质由「设计新约定」降级为「消除发布期与运行期的不一致」,风险与评审成本同步下降。这是整个方案最重要的一条发现。

### I5:examples 实测(量级证伪)

| 事实 | 数据 |
|---|---|
| example 总数 | 40 |
| 带 `pi-web.json`(可发布) | **3**(`canvas-component-watermark`/`module-settings-agent`/`plugin-code-review-agent`) |
| `package.json` 标 `private:true` | 38 |
| 已建 webext dist | 13 |
| 有 webext 源无产物 | 7 |
| 声明了 `web.dist` | **1**(`plugin-code-review-agent`,值为约定默认路径 `.pi/web/dist`) |

**Implication**:
1. 「补 37 个 example 清单」被证伪为「补 1 个」(`aigc-canvas-agent`,生产在用且目前靠手工发布)。
2. 全仓唯一使用 `web.dist` 的样本填的就是**约定默认值** ⇒ 该字段是样板冗余,「约定优先」有实证支撑。
3. `module-settings-agent` 同时是 `kind:"agent"`、有 webext 源无产物、且清单无 `pi` 字段 ⇒ 天然的多规则回归夹具。

### I6:入口约定覆盖率

40 个 example 中 **39 个有 `index.ts`**,**0 个使用 `package.json#pi-web.entry` 覆盖** ⇒ 约定命中率 ~97.5%,且无任何存量依赖显式声明。

**Implication**:复用 `probeEntry` 的零迁移成本得到量化支撑。

## Architecture Pattern Evaluation

| 候选 | 评估 | 结论 |
|---|---|---|
| 在 `pi-web.json` 新增 `entry` 字段 | 会造出**第二权威**:清单 entry 只影响发布、`package.json#pi-web.entry` 只影响运行 ⇒ 精确重现「发布认 A、运行认 B」的错位,即本缺陷的同类面 | **否决** |
| 固定 `index.ts` | 忽略既有覆盖机制,与运行时不一致 | 否决 |
| `package.json#main` | 与 pi-web 的入口语义无关(`main` 是 npm 消费入口) | 否决 |
| **复用 `probeEntry` 本体** | 发布期与运行期同一函数、同一优先级;显式覆盖通道已存在于 `package.json` | **采纳** |

**与 #29 的不对称性(刻意)**:`web.dist` 走「显式优先 + 探测兜底」,因为它**本就是 `pi-web.json` 的字段且运行时也认**;`entry` 走「纯复用探测、不新增字段」,因为它的既有权威**只在 `package.json`**。二者各自跟随各自的既有权威 —— 不是不一致,而是同一原则(不制造第二权威)的两种表现。

## Design Decisions

| # | 决策 | 理由 |
|---|---|---|
| D1 | 不引入新组件,只扩展 `compile()`/`sign()` | 新增行为都是「多算几个来源」,引入组件只增接缝无收益 |
| D2 | `entry` 独立于 `refs`,不扩 `CompiledFile.field` 联合类型 | 保持 `ResourceField` 语义纯粹;registry 对同文件重复核验幂等 |
| D3 | `files` 进 `bundlePaths` 不进 `refs` | 与 webext dist 中非 manifest 文件同档:打包但不受完整性保护,避免核验面无谓膨胀 |
| D4 | `package.json` 强制入包 | 否则安装后 `probeEntry` 读不到覆盖 ⇒ 发布期与运行期入口判定错位(正是要防的失败模式) |
| D5 | `kind` 在**发布期**必填,共享 schema 保持缺省 | 初稿把必填做在 `PiWebManifestSchema` 上,但该 schema 也被 `resolve-plugin.ts:71` 用于解析**已安装**包,`safeParse` 失败即整份丢弃 ⇒ 存量包运行时静默失效(实测 server 10 red / protocol 2 red,`resolve-plugin.test.ts` 连 id 都变成目录名),违反本 spec 的 R6.2。**改正**:强制点下沉到 `compile()`,判据为「原始 JSON 里作者是否书写 `kind` 键」。发布侧强约束 + 运行时零影响,亦回到 R4.1「**发布清单**须显式声明」的字面边界 |
| D6 | opt-out 用 `web.autoDetectDist` 而非 CLI flag | flag 每次发布都要记得加,易漏;字段可随包持久化 |
| D7 | mtime 只警告不阻断,且不做 hash 比对 | 源→产物无稳定映射,hash 比对误报率高;陈旧是提示性问题不应阻断发布 |
| D8 | 全部新增失败面置于 compile 内 | compile 早于三段外部写 ⇒ 失败不烧号成为**结构性保证**而非调用方自律 |

## Risks

| 风险 | 影响 | 缓解 |
|---|---|---|
| 新增硬失败面(`WEBEXT_SOURCE_WITHOUT_DIST`)对流水线中的包是 breaking | 「有源无产物」的包从可发布变为不可发布 | 故意变更;全在编译期、外部写之前 ⇒ 不烧号,可安全迭代。7 个受影响 example 均为仓内私有 fixture |
| `kind` 必填对未来新建清单是额外要求 | 作者需显式写 kind | 错误文案列出可选取值;现存清单零影响 |
| 签名覆盖范围因新增 `entry` 而变化 | 验签需一致 | `signManifest` 内部做 canonical 规范化,验签方按同一规则计算,无需改动;R1 端到端用例覆盖 |
| CLI 需发版才生效 | 作者不升级则仍撞 #28 | 发 0.3.1;缺陷记录与 runbook 已注明「修复前 agent 只能手工发布」 |

## Open Items(不在本 spec)

- `sign()` 从不产出 `manifest.routes` ⇒ registry `deriveCapabilities` 恒 `hasRoutes:false`,能力快照对 agent-declared-routes 永远为假(生产已实证:routes 真能跑但快照为假)。**另立 issue。**
- registry 侧 `persistFailed` 对 VALIDATION 类失败也占号 —— 可考虑不落 failed 记录以免烧号,属服务端独立行为变更,不并入本次。
