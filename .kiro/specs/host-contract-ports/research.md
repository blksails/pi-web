# Research & Design Decisions — host-contract-ports

## Summary

- **Feature**: `host-contract-ports`
- **Discovery Scope**: Extension（既有系统内新增独立模块，integration-focused 轻量发现）
- **Key Findings**:
  - **跨仓可复用测试套件在 pi-web 仓内无先例，但兄弟仓 pi-clouds 已有成熟范式**，且 pi-web 的 `vitest.config.ts` 已建立跨仓源码 alias 解析路径 → 照搬风险低，但必须照搬其两条硬约束（框架无关、按 `code` 判别错误）。
  - **主 barrel 有严格的「pi-SDK-free」纪律**：每个 `export * from` 行上方必须有注释论证无 pi SDK 值导入。本 spec 四个模块全部纯逻辑 + zod，可安全经主 barrel 导出——但 `EgressModelSourceInput` 类型恰好定义在**引 pi SDK 值的文件**里，直接复用会破坏纪律（见 Decision 3）。
  - **env fail-fast 有教科书级既有范例**（`resolveAiGatewayConfig` / `parseBackendsEnv`），三段式契约（未设→`undefined`；设了但非法→类型化错误；不静默降级），签名收 `env: NodeJS.ProcessEnv` 便于注入。本 spec 的上限解析直接沿用。

---

## Research Log

### 主 barrel 的 pi-SDK-free 纪律

- **Context**：新模块要不要经 `packages/server/src/index.ts` 导出？导出会否触发既有的打包问题？
- **Sources Consulted**：`packages/server/src/index.ts:3-8,48,60,73`、`packages/server/src/auth/index.ts:4-6`、`packages/server/src/vision-settings/index.ts:4-7`、`packages/server/src/config/index.ts:21-23`
- **Findings**：
  - 主 barrel 以 `export {};` 开头，逐模块 `export * from "./<mod>/index.js"`（NodeNext，`.js` 扩展名）。
  - **每个 export 行上方必须有一条注释**论证「无 pi SDK 值导入 → 可安全经 barrel 重导出」。
  - 反例被明确禁止：`runner/`（静态导入完整 pi SDK + jiti）、`config/model-options.ts`、`vision-settings/vision-model-options.ts`、`auth/egress-model-source.ts` 一律走**专用子路径**，不得进主 barrel。原因：pi SDK 被打进路由 bundle 会导致 `node:fs` 崩溃。
- **Implications**：本 spec 四个模块（`workspace` / `capability` / `host-manifest` / `config-domain`）只依赖 zod 与纯类型，**可**进主 barrel，且必须按约定补注释。但见 Decision 3 的类型复用陷阱。

### 跨仓可复用测试套件的先例

- **Context**：契约要求导出一致性套件供两端引用。pi-web 仓内是否有此模式？
- **Sources Consulted**：pi-web 全仓 grep（`conformance` / `test-kit` / src 下的 `describe(`）零命中；`pi-clouds/packages/registry-client/package.json` 的 `exports`；`pi-clouds/packages/registry-client/src/testing/contract-suite.ts:1-19`；`pi-web/vitest.config.ts:35-37`
- **Findings**：
  - pi-web 仓内**无先例**（唯一 src 下的测试是 `packages/logger/src/__tests__/`，是普通测试而非可复用套件）。
  - pi-clouds `registry-client` 有 `"./testing": "./src/testing/index.ts"` 子路径，内含 `contract-suite.ts` / `store-contract-suite.ts` 等，导出 `runRegistryStoreContractSuite(...)`。
  - 其头注释确立两条硬约束（原文）：「**契约即单一事实源**：fake server 与真 server 跑同一套行为断言。**框架无关**：不 import 任何测试框架，由调用方传入 `describe`/`it`（vitest/jest/node:test 均可），断言用内置 `assert`。跨包 `instanceof` 在同进程内有效……但为稳妥，**错误判定按 `RegistryError.code` 而非构造函数**。」
  - pi-web 的 `vitest.config.ts:35-37` 已为跨仓消费建立 alias，并注明「**子路径 alias 须在裸包名之前匹配**，故 `/testing` 先列」。
- **Implications**：直接采纳该范式。**并据此对已冻结契约提交两处勘误**（见 Decision 1、Decision 2）。alias 顺序陷阱要写进任务的验收要点。

### env fail-fast 既有范例

- **Context**：`PI_WEB_WORKSPACE_MAX_VALUE_BYTES` 的解析应遵循什么形态？
- **Sources Consulted**：`packages/server/src/ai-gateway/config.ts:1-11,15-34,54,98`、`packages/server/src/attachment/backends-config.ts:14,120,135`、`lib/app/auth-egress-assembly.ts:38,51-54,122`
- **Findings**：
  - 三段式统一契约：**未设/空白 → `undefined`（功能整体不注册，零行为变化）；设置但非法 → 抛类型化错误（含字段名/env 名）；不静默降级、不吞错**。
  - 签名收 `env: NodeJS.ProcessEnv`（便于测试注入），不直接读 `process.env`。
  - env 名以 `export const XXX_ENV = "..."` 常量导出；数值用 `parsePositiveIntOverride(raw, fieldName)` helper。
  - 分层规则：**只服务单个 server 模块的 env 解析 → 放该模块的 `config.ts`**；跨模块的 app 级装配 → 放 `lib/app/*-assembly.ts`。
- **Implications**：上限解析属前者，放 `packages/server/src/workspace/limit-config.ts`。本 spec **不碰** `lib/app/`（符合 Requirement 10.4）。

### 模块 / 测试 / 错误类的落位约定

- **Sources Consulted**：`packages/server/src/agent-source-list/index.ts:25-30`、`model-catalog/index.ts:7-12`、`session-store/types.ts:150,158,166,174`、`attachment/blob-store.ts:83`、`attachment/backends-config.ts:120`、`packages/server/package.json:7-12,19`、`packages/server/vitest.config.ts`
- **Findings**：
  - 模块 = 目录 + 自己的 `index.ts` barrel；barrel 用**具名 re-export**（非 `export *`），类型用 `export type {...}`；顶部 JSDoc 写明模块名、对应 spec、pi-SDK-free 状态。
  - 类型集中 `types.ts`；实现按职责一文件一件。
  - 错误类统一形态：`export class XxxError extends Error` + **必写 `this.name = "XxxError"`** + `public readonly` 上下文字段 + 经 barrel 导出。既有集中错误文件的模式（`agent-source/errors.ts`）。
  - 测试**全部在 `packages/server/test/`**，按 src 模块名镜像分子目录；src 下无 `*.test.ts`。`vitest.config.ts` 的 `include: ["test/**/*.test.ts"]`，`environment: node`。
  - 命令：`pnpm --filter @blksails/pi-web-server test`；单目录 `pnpm --filter @blksails/pi-web-server exec vitest run test/<dir>`。
  - `exports` 字段发布的是 **TS 源码**（无 build 步骤），子路径名是 kebab-case 能力名。
  - zod 是 `dependencies`，版本钉 `^3.23.8`（v3，非 v4）。
- **Implications**：直接沿用，无需新立约定。**唯一新增的是 `./testing` 子路径**（pi-web 首次）。

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| **单模块 `host-contract/`** | 四个端口 + 套件全放一个目录 | 契约是一个版本化整体，同进同出 | 违反仓内「模块 = 单一职责」约定；`workspace` 体量远大于其余三者，混放后边界模糊 | 否决 |
| **四模块 + 根级版本常量**（选定） | `workspace/` `capability/` `host-manifest/` `config-domain/` + `host-contract-version.ts` | 契合既有约定；四者可独立演进与复核；`workspace` 独享 `./testing` 子路径 | 版本常量与四模块的关联需靠文档而非结构表达 | 根级单文件模块有先例（`source-key.ts`、`runner-bootstrap-path.ts`） |
| 放进 `config/` 现有模块 | `ConfigDomainRegistry` 并入 `config/` | 域相关性最强 | `config/` 已有硬编码 `DOMAIN_SCHEMAS`，新旧混放；且本期禁止改既有装配（10.4） | 否决 |

---

## Design Decisions

### Decision 1: 一致性套件框架无关，签名增补 `SuiteRunner`

- **Context**：契约 §3.8 原签名 `runWorkspaceConformance(name, factory)` 隐含套件自行 import 测试框架。
- **Alternatives Considered**：
  1. 套件内 `import { describe, it } from "vitest"` —— 简单，但把 pi-web 的框架选择强加给两端，且依赖调用方是否开启 `globals`。
  2. 调用方传入 `SuiteRunner` —— 框架无关，兄弟仓已验证。
- **Selected Approach**：`runWorkspaceConformance(runner, name, factory)`，套件不 import 任何测试框架，断言用 `node:assert`。
- **Rationale**：套件要跨仓运行，两端的测试框架与 `globals` 配置不受 pi-web 控制。pi-clouds 的 `registry-client/testing` 已按此落地。
- **Trade-offs**：调用方多写一行 `{ describe, it }`；换取两端零框架耦合。
- **Follow-up**：**此为已冻结契约的破坏性签名变更**。处置：作为**实现前勘误**写入契约（此刻无任何实现者受影响，故不触发 v2）。已在 `docs/pi-web-host-contract-v1.md` 头部与 §3.8 记录。

### Decision 2: 错误判别用稳定 `code`，不用 `instanceof`

- **Context**：契约 §3.6 原只定义四个错误类。套件要断言「抛出键非法错误」。
- **Alternatives Considered**：
  1. `instanceof WorkspaceKeyError` —— 直观，但跨包/跨仓时同名类可能来自不同模块实例，假阴性。
  2. 基类 + 稳定 `code` 判别式 —— 结构化，跨边界稳定。
- **Selected Approach**：新增 `WorkspaceError` 抽象基类携带 `readonly code: WorkspaceErrorCode`（`"key" | "limit" | "corrupt" | "io"`）；套件与两端实现一律按 `code` 判别。
- **Rationale**：与兄弟仓结论一致（其原文按 `RegistryError.code` 而非构造函数）。
- **Trade-offs**：多一层基类；换取跨仓断言可靠。
- **Follow-up**：additive 变更，契约 §1 允许；已写入契约勘误。

### Decision 3: `capability` 模块不复用 `EgressModelSourceInput`，改用结构化本地类型

- **Context**：契约 §4.1 写 `egress?: EgressModelSourceInput`（「复用既有类型」）。
- **Alternatives Considered**：
  1. 直接 import `EgressModelSourceInput` —— 但该类型定义在 `packages/server/src/auth/egress-model-source.ts`，**该文件静态导入 pi SDK 值**（`AuthStorage` / `ModelRegistry`）。即便只导入类型，也会让 `capability/` 的 barrel 与主 barrel 的 pi-SDK-free 纪律变得脆弱（一次误改 `import type` 为 `import` 即破防）。
  2. 在 `capability/types.ts` 结构化定义 `CapabilityEgressGrant`，其模型条目复用**纯类型文件** `auth/egress-model.ts` 的 `EgressModel`。
- **Selected Approach**：方案 2。
- **Rationale**：主 barrel 纪律是硬约束（违反会导致 pi SDK 进路由 bundle → `node:fs` 崩溃），既有代码已为此付出专门的子路径设计。结构等价而依赖方向干净。
- **Trade-offs**：类型不是同一个符号，未来两者若漂移需人工对齐 —— 以类型层面的结构兼容性测试兜底。
- **Follow-up**：实现时加一条编译期结构兼容断言，确保 `CapabilityEgressGrant` 可赋给 `EgressModelSourceInput` 的对应形状。

### Decision 4: `LocalWorkspace` 落在本期，但不接管任何既有存储

- **Context**：范围边界写「不实现 `LocalWorkspace` 之外的后端」，即 `LocalWorkspace` 在本期内。
- **Selected Approach**：本期交付 `LocalWorkspace` 并令其通过一致性套件（8.5），但**不**让 `ConfigCodec` 等既有存储改建其上（属后续阶段）。
- **Rationale**：套件若无任何真实实现可跑，其正确性无从证明（自证循环）。`LocalWorkspace` 是套件的第一个验收对象，也是两端的参照实现。
- **Trade-offs**：本期产出一个「暂无生产调用方」的实现。这是有意的：它是标准的可执行证明，不是死代码。
- **Follow-up**：实现完成后须确认 `LocalWorkspace` 的落盘语义（0700/0600、write-temp+rename）与现 `ConfigCodec` 逐字节等价，为后续迁移铺路。

### Decision 5: 并发原子可见性的验证方式

- **Context**：2.6 要求「读取方只观察到某一次写入的完整值」，需可自动化验证。
- **Alternatives Considered**：
  1. 真并发压测 —— 不确定性高，易 flaky。
  2. 交错并发写 + 读，断言**每次读到的值都是某次写入的完整快照**（属于合法值集合），而非字段混合体。
- **Selected Approach**：方案 2。并发发起 N 次互不相同的整值写入与若干次读取，断言每次读回的对象**完整等于**某一次写入的输入（或初始空对象），不接受字段来自不同批次的混合体。
- **Rationale**：可确定性断言「无部分写入」，不依赖时序运气；对 fs 实现（write-temp + rename）与远端实现同样适用。
- **Trade-offs**：不验证线性一致性或最终胜出者是谁 —— 契约本就不承诺这两点（无跨键事务、未规定并发胜出规则）。
- **Follow-up**：套件中该用例须避免固定 sleep，用 `Promise.all` 编排。

---

## Risks & Mitigations

> **由任务 1.2–3.2 的独立复核（APPROVED）结转的两条信息性发现** —— 均非本轮缺陷，但须在后续任务中接住：

- **Windows 设备名与 NTFS ADS 语法当前被键校验放行** —— `CON`、`NUL`、`file.json:stream:$DATA` 等形态不构成 EARS 1.1–1.6 所定义的路径穿越（JS 字符串与 `path.join` 不会将其解析为 `..`），故键校验层不拦。但 **`LocalWorkspace`（任务 4.x）在 Windows 上落盘时**，这些名字会命中 OS 层的特殊语义。

  > **主控裁决（2026-07-21，任务 4.1 复核后）**：原缓解措施「4.1 实现键→路径映射时须显式处理」**作废**。两条候选处理路径都是错的：
  > - 在 `local-workspace.ts` 做路径级特判 → 参照实现会拒绝**契约允许**的键，自己变成不合规实现；
  > - 在 `key.ts` 加 Windows 规则 → 把平台规则污染进**平台无关**的契约层，使 Linux 上的云端实现也拒绝合法键，两端反而更不一致。
  >
  > 正确定性：这是**载体的可承载性问题**，不是键空间的合法性问题。已写入契约 §3.2 第 4 条（勘误⑦）：此类名字在键空间层面合法，能否落盘由各实现在自身文档中声明。4.1 在 `local-workspace.ts` 文件头记录该限制即为**已处理**。**跨平台真机验证前，任何文档与报告都不得宣称 Windows 可用。**
- **`deepMergeJson` 对 `__proto__` 键不做防护** —— 与既有 `config-codec.ts` 的 `deepMerge` **逐字节一致**，是设计要求的行为复刻而非新引入缺陷。实际影响有限：`{...base}` 产出的是全新对象，赋值只改该对象自身的 `[[Prototype]]`，**不污染 `Object.prototype`**；副作用是含字面量 `__proto__` 键的配置在序列化时会静默丢失该键。**刻意不修**——修了就与既有落盘器不一致，而后续 `ConfigCodec` 迁移正依赖二者等价。若将来要加防护，须**同时**改既有实现。

- **跨仓 alias 顺序陷阱** —— pi-web `vitest.config.ts` 已注明「子路径 alias 须在裸包名之前匹配」。若 pi-clouds 侧接线时把 `@blksails/pi-web-server` 裸名列在 `/testing` 之前，子路径会被裸名吞掉且**报错信息与顺序无关**，极难定位。缓解：在契约 §8 的云端起步点与本 spec 的任务验收要点中显式标注。
- **套件自证循环** —— 套件由 pi-web 写、也由 pi-web 的实现验收，可能双双跑偏。缓解：套件用例逐条锚定 requirements 的验收编号（1.1–4.4），复核时按需求而非按实现读。
- **`LocalWorkspace` 与 `ConfigCodec` 语义漂移** —— 本期两者并存但不互通，后续迁移时若语义有差会在迁移阶段才暴露。缓解：本期即按 `ConfigCodec` 的既有语义（deepMerge 规则、`merge:false` 覆盖、0700/0600）实现，并在设计中列为不变式。
- **主 barrel 纪律被无意破坏** —— 见 Decision 3。缓解：barrel 注释 + 结构兼容断言。

---

## References

- `docs/pi-web-host-contract-v1.md` — **本 spec 的唯一权威**（v1 已冻结 + 2026-07-21 实现前勘误两处）
- `docs/desktop-cloud-integration-design.md` — 设计动机与取舍（12 项缺口、容器分层、领域泄漏）
- `pi-clouds/packages/registry-client/src/testing/contract-suite.ts:1-19` — 可复用契约套件的范式与两条硬约束
- `packages/server/src/ai-gateway/config.ts:1-11` — env fail-fast 的教科书原文
- `packages/server/src/index.ts:3-8` — 主 barrel pi-SDK-free 纪律的原始论证
- `vitest.config.ts:35-37` — 跨仓子路径 alias 顺序陷阱
