# Requirements Document

## Introduction

「设置 → 扩展 → 系统资源」提供两个开关:「载入系统 skills」与「载入系统 extensions」。两者关闭时,本意是让新建会话**不载入**系统/包/内置 skills(经 `--no-skills`)或系统/包 extensions(经 `--no-extensions`)。

当前缺陷:开关对 **custom 模式 agent**(源目录带 `index.ts`,如全部 webext 示例)完全无效——开关状态已正确写盘、并已注入到 agent 子进程的命令行参数,但 custom 模式的 runner 解析器不识别这两个参数,将其静默丢弃,因此系统 skills/extensions 仍照常载入。CLI 模式(纯目录源)因参数直接交由底层 `pi` CLI 处理,反而正常。

本特性修复 custom 模式下两开关的端到端生效,并保持默认(开关开启 / 未配置)行为、沙箱强制注入与 CLI 模式行为不变。

## Boundary Context

- **In scope**:
  - custom 模式 agent 在「载入系统 skills」关闭时,新建会话不载入系统/包/内置 skills。
  - custom 模式 agent 在「载入系统 extensions」关闭时,新建会话不载入系统/包 extensions。
  - 两开关相互独立,可单独或同时关闭。
  - 配套单元/集成测试与浏览器 e2e 验收。
- **Out of scope**:
  - CLI 模式行为(已正常,不在本次改动范围,仅须回归不被破坏)。
  - 开关的写盘与 argv 注入链路(`settings.json` 解析、`--no-skills`/`--no-extensions` 注入)已正确,不重复实现。
  - 既有已运行会话的运行时热切换(本特性仅作用于**新建会话**,与既有「建会话时注入」语义一致)。
- **Adjacent expectations**:
  - 沙箱强制注入(pi-sandbox)经 `additionalExtensionPaths` 加载,**不受** extensions 关闭影响,沙箱安全门在两开关关闭时仍生效。
  - 开关默认开启或配置缺省时,系统 skills/extensions 的载入行为与现状一致。

## Requirements

### Requirement 1: custom 模式关闭系统 skills 生效
**Objective:** 作为 pi-web 使用者, 我希望在 custom 模式 agent 下关闭「载入系统 skills」后新建会话真的不载入系统 skills, 以便获得一个不含系统/包/内置 skills 的干净会话。

#### Acceptance Criteria
1. When 「载入系统 skills」处于关闭状态并以 custom 模式 agent 新建会话, the 会话运行时 shall 不载入任何系统、包或内置 skills。
2. When 「载入系统 skills」处于关闭状态并以 custom 模式 agent 新建会话, the 前端 slash 命令面板 shall 不出现任何 `/skill:*` 命令。
3. While 「载入系统 skills」保持默认开启(或配置缺省), the 会话运行时 shall 按现状载入系统 skills, 且 slash 面板照常出现 `/skill:*` 命令。
4. Where agent 定义自身声明了 skills, the 会话运行时 shall 在关闭系统 skills 时仍不引入系统/包/内置 skills(系统资源关闭优先于系统级发现)。

### Requirement 2: custom 模式关闭系统 extensions 生效
**Objective:** 作为 pi-web 使用者, 我希望在 custom 模式 agent 下关闭「载入系统 extensions」后新建会话真的不载入系统 extensions, 以便获得一个不含系统/包 extensions 的干净会话。

#### Acceptance Criteria
1. When 「载入系统 extensions」处于关闭状态并以 custom 模式 agent 新建会话, the 会话运行时 shall 不载入系统或包 extensions。
2. While 「载入系统 extensions」保持默认开启(或配置缺省), the 会话运行时 shall 按现状载入系统/包 extensions。
3. When 「载入系统 extensions」处于关闭状态并以 custom 模式 agent 新建会话, the 会话运行时 shall 仍加载经强制注入路径提供的扩展(pi-sandbox), 使沙箱安全门保持生效。

### Requirement 3: 两开关独立且默认行为不变
**Objective:** 作为 pi-web 使用者, 我希望两个系统资源开关相互独立、互不牵连, 以便单独控制 skills 与 extensions 的载入。

#### Acceptance Criteria
1. When 仅关闭「载入系统 skills」而保持「载入系统 extensions」开启并新建 custom 模式会话, the 会话运行时 shall 不载入系统 skills 但照常载入系统/包 extensions。
2. When 仅关闭「载入系统 extensions」而保持「载入系统 skills」开启并新建 custom 模式会话, the 会话运行时 shall 不载入系统/包 extensions 但照常载入系统 skills。
3. When 同时关闭两开关并新建 custom 模式会话, the 会话运行时 shall 同时不载入系统 skills 与系统/包 extensions。
4. While 两开关均未在配置中显式出现, the 会话运行时 shall 同时载入系统 skills 与系统/包 extensions(默认全部载入)。

### Requirement 4: CLI 模式回归不被破坏
**Objective:** 作为 pi-web 维护者, 我希望本次修复不影响已正常工作的 CLI 模式, 以便两种模式的系统资源开关行为保持一致且稳定。

#### Acceptance Criteria
1. When 以 CLI 模式(纯目录源)新建会话且开关关闭, the 会话运行时 shall 维持现有的不载入系统 skills/extensions 行为。
2. The 系统资源开关 shall 在 CLI 模式与 custom 模式下产生一致的「关闭即不载入」用户可观察结果。

### Requirement 5: 验证证据
**Objective:** 作为 pi-web 维护者, 我希望本修复具备自动化测试与端到端验收证据, 以满足项目「单元/集成测试 + e2e 验证」的硬性要求。

#### Acceptance Criteria
1. The 修复 shall 附带单元/集成测试, 覆盖关闭 skills、关闭 extensions、两者独立组合、默认全开四种情形下注入参数到运行时资源载入选项的映射。
2. When 在浏览器中以 custom 模式关闭「载入系统 skills」后新建会话, the e2e 验收 shall 以新鲜运行证据证明 slash 面板不再出现 `/skill:*` 命令。
3. The 测试套件 shall 在修复后全部通过, 且不破坏既有 option-mapper / runner 相关测试。
