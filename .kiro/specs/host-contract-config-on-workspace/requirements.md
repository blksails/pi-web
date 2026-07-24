# Requirements Document

## Introduction

本 spec 是 pi-web 宿主契约 v1 的**中间标准验证(M2 垂直切片)**。M1(`host-contract-ports`)已交付四个宿主端口的类型契约、`LocalWorkspace` 与一致性套件。M2 把 config 域的读写从独立的 `ConfigCodec` 改建到 `LocalWorkspace` 的 `user` 命名空间之上,证明「config 域这一刀切到 Workspace 端口上,pi-web 本地全绿、云端白拿一个后端即得 config 持久化」——即整个契约模型的可行性验证。

改建的成功判据是 **config 五域(`auth`/`settings`/`sandbox`/`logging`/`aigc`)经 `/config/:domain` 路由的可观测行为逐字节零变化**。真正的工程张力在于:`LocalWorkspace` 相对 `ConfigCodec` 有三处刻意「收紧」的语义(损坏 JSON 抛错、写入大小上限、原子写),改建层必须在 `ConfigStore` 内处置这些差异,才能既建在 Workspace 之上、又保持 config 域的既有可观测行为。

**权威依据**:`docs/pi-web-host-contract-v1.md` §3.2.1 / §3.6 / §3.7 / §6 / §8.3。所有现状事实(文件:行号)见 Project Description。

## Boundary Context

- **In scope**:
  - `ConfigCodec`(`packages/server/src/config/config-codec.ts`)的内部实现改建到 `LocalWorkspace` `user` 命名空间之上,键 `<domain>.json`。
  - config 五域(`auth`/`settings`/`sandbox`/`logging`/`aigc`)经 `/config/:domain` 路由与 `loggingConfigProvider` 的读写等价性。
  - 三处收紧行为(损坏 JSON、大小上限、原子写)在改建层的等价处置决策。
  - 既有 config 测试作为行为零变化的回归基线。
- **Out of scope**:
  - `mcp-config-routes.ts`、`extensions-config-routes.ts`、`source-settings-codec.ts` 三个独立 codec —— 它们**不经** `ConfigCodec`,各有独立落盘规则,本期一律不迁移、不触碰。
  - 其余五个 store 迁 Workspace(属 M4)、`composeCapabilities` 装配改建(属 M3)。
  - `LocalWorkspace` 本体的类型或语义变更(M1 已冻结;若发现必须改 `packages/*` 契约才能改建,说明契约有缺口,回到契约修订而非在本 spec 打补丁)。
- **Adjacent expectations**:
  - pi-clouds(云端)据本切片验证的模型实现 `TenantWorkspace`(C1),白拿 `ConfigStore`(C3);desktop 沿用 `LocalWorkspace`(D1)。M2 是这两端并行开工的前置。
  - 本 spec 不改 `packages/*` 对外签名,两端差异只出现在装配层(契约 §7.5)。

## Requirements

### Requirement 1: ConfigStore 改建到 LocalWorkspace user 命名空间之上

**Objective:** As a pi-web 宿主契约的维护者, I want config 域的落盘经由 `LocalWorkspace` `user` 命名空间而非独立的 `node:fs` 实现, so that 云端只实现一个 `Workspace` 后端即可白拿 config 持久化,验证契约模型成立。

#### Acceptance Criteria
1. The ConfigStore shall 通过 `LocalWorkspace` 的 `user` 命名空间(`WorkspaceNamespace`)完成所有 config 域的读写,不再直接调用 `node:fs` 的 `readFile`/`writeFile`/`mkdir`。
2. When 读写 config 域 `<domain>`, the ConfigStore shall 使用 workspace 键 `<domain>.json`。
3. The ConfigStore shall 使 config 五域的落盘绝对路径与既有 `ConfigCodec` 完全一致(`<PI_WEB_AGENT_DIR ?? ~/.pi/agent>/<domain>.json`),即改建前后同一磁盘文件。
4. The ConfigStore shall 保持既有磁盘权限位(目录 `0700`、文件 `0600`)。
5. Where 装配层需注入根目录, the ConfigStore shall 接受与既有 `ConfigCodec(rootDir?)` 等价的根目录注入,使 `createConfigRoutes({ rootDir })` 与 `loggingConfigProvider` 无需改变其注入方式。

### Requirement 2: 五域 GET/PUT 可观测行为逐字节零变化

**Objective:** As a pi-web config 域的调用方(前端 Settings、路由、logging provider), I want 改建后 `/config/:domain` 的 GET/PUT 行为与改建前逐字节一致, so that 这次改建是纯粹的模型验证而非功能变更。

#### Acceptance Criteria
1. When 对 `<domain>` 执行 GET(load), the ConfigStore shall 返回与既有 `ConfigCodec.load(<domain>)` 相同的对象(缺文件返回 `{}`、成功读取返回同一 JSON 对象)。
2. When 对 `<domain>` 执行 PUT(save,恒 `{ merge: false }`,见 `config-routes.ts:183`), the ConfigStore shall 将整值覆盖写入,写出的磁盘字节与既有 `ConfigCodec.save` 一致(`JSON.stringify(values, null, 2)`,无尾换行)。
3. When 调用带 `{ merge: true }` 的 save, the ConfigStore shall 产生与既有 `ConfigCodec` 私有 `deepMerge` 逐项一致的合并结果(对象递归合并、数组整体替换、`undefined` 值同样写入不跳过)。
4. While 改建后运行既有 config 回归套件(`config-codec.test.ts`、`config-routes.test.ts`、`logging-config.test.ts`、`sandbox-config.test.ts`、`config-domains.e2e.test.ts`), the ConfigStore shall 使其全部通过(允许因公开面从 `ConfigCodec` 更名/迁移而对测试 import 做等价改写,但**不得**放宽或删除任何断言)。
5. Where 原子写替换了直接覆盖写(`LocalWorkspace` 的 temp+rename), the ConfigStore shall 保证最终落盘的文件内容与既有实现逐字节相同(原子性是增强,不得成为可观测的字节差异)。

### Requirement 3: 损坏 / 非对象 JSON 的等价降级(收紧①)

**Objective:** As a config 域的读取方, I want 遇到磁盘上已损坏或非对象的 `<domain>.json` 时仍得到既有的「当空配置」行为, so that 改建不会把既有的静默降级变成用户可见的报错。

#### Acceptance Criteria
1. If 磁盘上的 `<domain>.json` 是非法 JSON, then the ConfigStore shall 返回 `{}`(捕获底层 `WorkspaceCorruptError`,保持既有 `ConfigCodec.load` 的静默降级语义),而非向调用方抛错。
2. If 磁盘上的 `<domain>.json` 是合法 JSON 但非对象(数组 / 标量 / `null`), then the ConfigStore shall 返回 `{}`。
3. When 发生上述降级, the ConfigStore shall 按契约 §3.6 记录日志(不得静默无痕),且不得把 5xx 透给前端。
4. The ConfigStore shall 按 `err.code`(`"corrupt"`)判别底层错误,不得用 `instanceof`(契约 §3.6:跨包 `instanceof` 假阴性)。

### Requirement 4: 写入大小上限的等价处置(收紧②)

**Objective:** As a config 域的写入方, I want 正常大小的 config 写入不因 Workspace 新增的默认上限而产生新的失败模式, so that 改建对既有写入路径行为零变化。

#### Acceptance Criteria
1. The ConfigStore shall 保证既有正常大小的 config 写入(五域实际值均远小于 1 MiB)不产生任何因大小上限导致的新失败。
2. Where 保留 `LocalWorkspace` 的写入大小上限作为安全网(依 `PI_WEB_WORKSPACE_MAX_VALUE_BYTES ?? 1 MiB`), the ConfigStore shall 在设计中显式记录该决策及其与「`ConfigCodec` 原本无上限」的差异边界,使超限行为可预期。
3. If 一次 config 写入超过所配上限并触发 `WorkspaceLimitError`, then the ConfigStore shall 以调用方可辨识的方式处置(不得把裸 5xx 透给前端),具体处置(拒绝并回错 / 放宽上限)由设计拍板并落文档。

### Requirement 5: deepMerge 收敛为单一权威实现

**Objective:** As a 契约维护者, I want config 的合并语义不再是与 Workspace 各自维护的独立复制, so that 「与现 `ConfigCodec` 一致的 deepMerge」(契约 §3.2 表)有单一权威来源,消除漂移风险。

#### Acceptance Criteria
1. The ConfigStore shall 复用 `LocalWorkspace` 的 `deepMergeJson`(`packages/server/src/workspace/merge.ts`)作为其合并语义,不再保留 `config-codec.ts` 内的私有 `deepMerge` 副本。
2. The ConfigStore shall 使合并语义与改建前逐项等价(已证实 `deepMergeJson` 与 `ConfigCodec.deepMerge` 语义字面一致,见 Project Description D14)。
3. Where `source-settings-codec.ts` 存在第三份 deepMerge 副本, the 本 spec shall 不触碰它(属 Out of scope),但在设计中记录其仍待后续收敛的事实,不制造「已全部收敛」的假象。

### Requirement 6: 消费方与公开接口稳定

**Objective:** As a `ConfigCodec` 的现有消费方(`createConfigRoutes`、`pi-handler.ts` 的 `loggingConfigProvider`), I want 改建不要求我改变调用方式, so that 这次改建局限在存储层,消费面零改动或仅等价改名。

#### Acceptance Criteria
1. The ConfigStore shall 对外暴露与既有 `ConfigCodec` 语义等价的读写能力(构造时注入根目录 + `load(domain)` + `save(domain, values, { merge? })`)。
2. When `createConfigRoutes` 与 `loggingConfigProvider` 消费 ConfigStore, the 两处消费点 shall 保持既有调用契约(GET→load、PUT→`save(..., { merge: false })`、logging provider→`load("logging")`),仅允许因类型更名产生的等价 import/构造改写。
3. The ConfigStore shall 不改变 `packages/server` 对外 barrel(`config/index.ts`)的既有导出语义;若更名,须同时提供可解析的等价导出,不留悬空引用(`tsc` 零错误)。

### Requirement 7: 范围隔离——三个独立 codec 不迁移

**Objective:** As a M2 切片的执行者, I want 明确只切 `ConfigCodec` 一刀, so that 垂直切片保持最小、可验证,不误伤三个语义/落盘各异的独立 codec。

#### Acceptance Criteria
1. The 本 spec shall 不修改 `mcp-config-routes.ts`(直接 `node:fs` 读写 `mcp.json`、写时追加 `"\n"`,与 ConfigCodec 落盘规则不同)。
2. The 本 spec shall 不修改 `extensions-config-routes.ts`(读写 `settings.json` 顶层互映,不经 ConfigCodec)。
3. The 本 spec shall 不修改 `source-settings-codec.ts`(per-source settings,落盘路径不同)。
4. If 改建过程中发现某独立 codec 与 ConfigStore 存在耦合而必须触碰, then the 执行者 shall 停止并回报边界冲突,而非扩大改动范围。

### Requirement 8: 垂直切片回归验证

**Objective:** As a 契约模型的验证者, I want 一份可复现的证据证明「本地全绿」, so that M2 的结论(模型成立、两端可开工)有新鲜凭据支撑而非口头声称。

#### Acceptance Criteria
1. While 改建完成, the 验证 shall 运行 `packages/server` 全量单测并全绿(以真实测试计数为准,防 vitest 假绿:`no tests` 或 `Errors N error` 均不算通过)。
2. While 改建完成, the 验证 shall 运行 config 相关 e2e(`e2e/node/config-domains.e2e.test.ts`)并全绿。
3. The 验证 shall 运行 `packages/server` 的 `typecheck` 并零错误。
4. The 验证 shall 以 fresh-evidence 形式(命令 + 真实计数 + 时间戳)记录于 spec 的验证目录,不得以「应当通过」替代实际运行。
