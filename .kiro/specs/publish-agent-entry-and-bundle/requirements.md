# Requirements Document

## Project Description (Input)

修复 **#28**(阻断级:`kind=agent` 的 CLI 发布通道 100% 不通)与 **#29**(manifest 缺正规声明字段)。二者同源:**约定信息本可推导,却要求显式声明;不声明就静默失败或永久烧号。**

### (a) 谁遇到问题

- **agent 作者/发布者**:用 `pi-web publish` 发布任何 `kind:"agent"` 的包,**100% 失败**,且每失败一次**永久烧掉一个版本号**(failed 版本占号,`VersionConflictError` 使同号不可重发)。
- **pi-cloud 终端用户**:因 webext dist 从未进入 bundle,registry 侧 `hasWebext:false`,一路 fail-closed 到默认 UI —— 表现为 **aigc canvas 面板失效**,且链路上**没有任何一环会提示「这个包本该有面板」**。

### (b) 当前状况(生产真机实证)

证据来源:pi-clouds `.kiro/specs/closed-loop-e2e/execution-report-2026-07-20.md`(#6 闭环 E2E 首次真机执行)。基线缺陷记录:本仓 `docs/defect-agent-publish-declaration-gaps.md`。

1. **#28**:`server/cli/publish/manifest-compiler.ts:204-217` 的 `sign()` 产出字段集不含 `entry`;而 pi-clouds `packages/registry-client/src/manifest/validate.ts:74-76` 对 `kind==="agent"` 无条件要求 `entry` ⇒ 版本落 `status=failed`、`failureReason="VALIDATION: manifest.entry must be an object"`,`setChannel` 报 `VERSION_REJECTED`。registry 上现存 canvas 1.0.x 之所以有 `entry`,是因为它们**全部由人手工构造 manifest 发布**,agent 通道从未被 CLI 正经走通过。
2. **entry 文件本身无入 bundle 的通道**:`bundlePaths` 仅由 `pi.*` glob 与 `web.dist` 两处填充(`manifest-compiler.ts:96-146`)。pi-clouds `registry-service.ts:850-852` 的 `collectIntegrityRefs` **无条件收 `manifest.entry`** 并逐项回源核验 ⇒ 只补 `manifest.entry` 而不把文件打进 bundle,版本**照样烧掉**,只是 `failureReason` 从 VALIDATION 变成 INTEGRITY。**补一半比不补更隐蔽。**
3. **#29**:`routes/**`、`package.json`、`settings/schema.json` 等附属文件没有任何合法入口进 bundle,只能走私进 `pi.extensions`(#6 实际就是这么发的)。
4. **webext 发布期与运行期语义不一致**:运行时 `packages/server/src/plugin/resolve-plugin.ts:23,197-210` **早已**是「显式 `web.dist` 优先 + 探测 `.pi/web/dist/manifest.json` 兜底」;而发布期 `manifest-compiler.ts:126` 是 `if (m.web?.dist)` —— **未声明即整段静默跳过**。
5. **`kind` 缺省两侧不一致**:registry 侧 `deriveEffectiveKind` 缺省 **`agent`**;pi-web 侧 `PiWebManifestSchema` 的 `kind` 默认 **`plugin`**(`packages/protocol/src/plugin/plugin-manifest.ts:117`)。不写 `kind` 的 agent 包会被发成 plugin —— **发布成功但类型错**,运行时却按 agent 加载,比 #28 更隐蔽。

### (c) 应当改变什么

**核心原则:发布期追平运行时既有约定,不发明新约定;所有失败前移到编译期(任何外部写之前),绝不烧版本号。**

1. **entry 复用 `probeEntry` 本体**(`packages/server/src/agent-source/entry-probe.ts:51-68`:`package.json#pi-web.entry` 覆盖优先且不静默回退 → 否则 `index.ts` > `index.js` > `index.mjs`),发布期与运行期同一函数、同一优先级,消除「发布认 A、运行认 B」的错位。**不在 `pi-web.json` 新增 `entry` 字段**(会造出第二权威)。
2. **entry 与 `package.json` 自动进 bundle**。后者是硬要求:否则安装后 `probeEntry` 读不到 `pi-web.entry` 覆盖,发布期与运行期入口判定不一致。
3. **新增 `pi-web.json#files: string[]`**(glob;进 `bundlePaths`、不进 `refs`,即不受 integrity 保护),让 `routes/**` 等附属文件有正规入口,关闭走私。
4. **webext dist 改为「显式优先 + 约定探测兜底」**,追平 `resolve-plugin.ts` 的运行时语义;**有 `web.config.tsx` 却无 dist ⇒ 明确失败并提示先构建**,不再静默跳过;**不做隐式自动构建**;**产物旧于源 ⇒ 警告**(mtime 比对,只警告不阻断)。
5. **`kind` 改为必填**,消除两侧缺省不一致(现存 3 个清单全部显式声明,零 breaking)。
6. **opt-out**:`web.autoDetectDist?: boolean`(缺省 `true`),用 schema 字段而非 CLI flag(flag 每次发布都要记得加,易漏)。

---

## Introduction

本特性修复 pi-web 发布链路(`pi-web publish`)的两个同源缺陷:agent 包因发布清单缺少入口声明而**必然发布失败并烧掉版本号**(#28),以及入口、附属文件、webext 产物**缺少正规的打包声明通道**(#29)。

修复的统一原则是:**发布期采用运行时已经在用的约定**(入口探测与 webext 产物探测),把「本可推导的信息」从「必须显式声明、不声明就静默失败」改为「自动推导 + 显式覆盖」;同时把所有校验失败**前移到任何外部写操作之前**,使失败不再消耗不可回收的版本号。

## Boundary Context

- **In scope**:`pi-web publish` 编译期的入口判定、发布产物文件集的确定、webext 产物的纳入与缺失处理、发布清单字段的必填与可选语义、以及上述各项的失败时机与提示质量。
- **Out of scope**:
  - **registry 侧校验规则**不变更(存量版本本就带入口声明、校验放行;放宽校验会使「没有入口的包」发得出去,把编译期硬失败降级成运行期故障)。
  - **不实现隐式自动构建**(发布环境未必具备构建依赖,且会造成发布物与作者本地所见不一致)。
  - **不新增第二个入口声明位**(入口的既有权威在包的 `package.json`;在发布清单再加一个会重现本缺陷的同类面)。
  - **示例包的清单补全**仅限生产在用的那一个;其余示例包标记为仓内私有、不对外分发,不在本次范围。
  - **能力快照中路由信息缺失**(发布清单从不产出路由声明,导致 registry 侧路由能力标记恒为假)属同类缺陷但**另立课题**,本特性不处理。
- **Adjacent expectations**:
  - 本特性期望 registry 侧维持现有校验语义:对 agent 类型包要求入口声明、并对清单声明的每个文件做回源完整性核验。
  - 本特性期望运行时的入口探测与 webext 产物探测语义保持不变;若运行时约定变更,发布期须同步跟随(二者共用同一判定来源)。
  - 修复经由发布 CLI 的新版本分发给作者后才生效;云端运行时不经过发布路径,**部署面不受影响**。

---

## Requirements

### Requirement 1: agent 入口的判定与声明

**Objective:** As an agent 作者, I want 发布工具自动识别我的 agent 入口文件, so that 我不必为已有约定重复声明,也不会因为漏声明而发布失败并烧掉版本号

#### Acceptance Criteria

1. When 编译一个类型为 agent 的包, the 发布 CLI shall 依照运行时既有的入口探测约定确定入口文件,并在发布清单中声明该入口及其完整性摘要。
2. While 包的 `package.json` 声明了入口覆盖, the 发布 CLI shall 以该覆盖为准,而非按文件名约定推断。
3. If 入口覆盖所指向的文件不存在, then the 发布 CLI shall 终止发布并指明该缺失路径,不得回退到按约定推断的入口。
4. If 包类型为 agent 且既无入口覆盖、也不存在任何符合约定的入口文件, then the 发布 CLI shall 终止发布,并提示作者创建约定入口文件或声明入口覆盖。
5. If 解析出的入口位于包目录之外, then the 发布 CLI shall 终止发布并拒绝该入口。
6. While 包类型不是 agent, the 发布 CLI shall 不在发布清单中声明入口,即使包内存在符合约定的入口文件。
7. The 发布 CLI 所声明的入口 shall 与该包安装到本地后、运行时探测所得的入口指向同一文件。

### Requirement 2: 发布产物的文件完整性

**Objective:** As an agent 作者, I want 发布产物自动包含运行该 agent 所必需的文件, so that 装到目标环境后能直接运行,而不必把入口和附属文件伪装成扩展资源来夹带

#### Acceptance Criteria

1. When 发布清单声明了入口, the 发布 CLI shall 将该入口文件纳入发布产物。
2. When 包根存在 `package.json`, the 发布 CLI shall 将其纳入发布产物。
3. Where 发布清单声明了通用文件清单, the 发布 CLI shall 将其展开后的全部文件纳入发布产物,且不将它们计入需要完整性核验的引用集合。
4. If 通用文件清单中的任一声明模式未命中任何文件, then the 发布 CLI shall 终止发布并指出该未命中的模式。
5. The 发布 CLI shall 使作者无需把入口文件或其附属文件声明为扩展资源即可完成发布。
6. When 一个包含入口与附属子目录的 agent 包完成发布并被安装, the 已安装包 shall 具备运行所需的全部已声明文件。

### Requirement 3: webext 产物的纳入与缺失处理

**Objective:** As an agent 作者, I want 发布工具按与运行时相同的规则识别我的 web 扩展产物, so that 我不会在毫无提示的情况下发布出一个缺少界面的包

#### Acceptance Criteria

1. While 发布清单显式声明了 web 扩展产物目录, the 发布 CLI shall 使用该声明目录,保持既有行为不变。
2. When 发布清单未声明 web 扩展产物目录且约定目录下存在产物清单文件, the 发布 CLI shall 自动将该产物树纳入发布产物并在发布清单中声明其 web 扩展信息。
3. If 包内存在 web 扩展源文件但其对应产物不存在, then the 发布 CLI shall 终止发布,并在错误信息中给出应先执行的构建命令,不得静默跳过 web 扩展。
4. The 发布 CLI shall 不自动执行任何构建动作。
5. If web 扩展产物的修改时间早于其源文件, then the 发布 CLI shall 输出陈旧产物警告,但不阻断发布。
6. Where 发布清单显式关闭了自动探测, the 发布 CLI shall 跳过约定目录探测,且不因产物缺失而失败。

### Requirement 4: 发布清单的类型声明

**Objective:** As an agent 作者, I want 包类型必须显式声明, so that 不会因为两侧默认值不一致而发布出一个类型错误却"发布成功"的包

#### Acceptance Criteria

1. The 发布清单 shall 要求显式声明包类型。
2. If 发布清单未声明包类型, then the 发布 CLI shall 终止发布,并明确告知包类型为必填项及其可选取值。
3. The 发布 CLI shall 不为缺失的包类型推断任何默认值。

### Requirement 5: 失败前移与版本号保护

**Objective:** As an agent 作者, I want 所有可预见的错误在任何外部写操作之前暴露, so that 一次失败不会永久消耗一个不可回收的版本号

#### Acceptance Criteria

1. When 任一编译期校验失败, the 发布 CLI shall 在执行上传、版本登记、通道移动中的任何一项之前终止。
2. If 发布因编译期校验失败而终止, then the 发布过程 shall 不产生任何版本登记记录,该版本号 shall 仍可再次使用。
3. When 以演练模式执行发布, the 发布 CLI shall 施加与正式发布完全相同的编译期校验。
4. When 编译期产生非阻断的警告, the 发布 CLI shall 在演练模式与正式发布中均输出该警告。

### Requirement 6: 向后兼容与缺陷回归

**Objective:** As a 平台维护者, I want 修复既能让 agent 发布真正打通、又不破坏任何存量制品, so that 无需改动服务端、也无需重发历史版本

#### Acceptance Criteria

1. When 以类型为 agent 且含附属子目录的包执行完整发布, the 发布流程 shall 依次完成上传、版本登记与通道移动,且登记后的版本状态 shall 为可用状态。
2. The 本次变更 shall 不使任何已发布的存量版本失效。
3. The 本次变更 shall 不依赖 registry 侧的任何规则改动。
4. While 发布清单沿用显式的 web 扩展产物目录声明, the 发布 CLI shall 产生与变更前一致的发布产物。
5. When 对既有的、以显式路径声明资源的包执行发布, the 发布 CLI shall 保持其原有的声明缺失判定语义不变。
