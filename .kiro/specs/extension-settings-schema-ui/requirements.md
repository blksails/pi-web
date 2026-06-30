# Requirements Document

## Introduction

为 pi 扩展提供**通用的、schema 驱动的设置 UI**机制。

现状：pi 原生没有扩展配置 schema 机制，扩展各自读盘自己的 JSON 配置文件；pi-web 的「扩展」配置面板外壳已静态预制，且已能对**含内联 `$schema`(https) 的配置文件**渲染结构化表单。但该能力有两个根本缺口——(1) 它的出现门控是「配置文件是否在磁盘上存在」而非「扩展是否已安装」；(2) 它要求每个扩展作者自建远端 https 托管一份 schema，长尾扩展不会做，因此覆盖面很窄。

本特性提供更通用的方法：对**每个已安装扩展**，按确定优先级从多个来源解析出它的设置 schema（① 包自带、② 配置文件内联 `$schema`、③ 第三方 registry），据此在设置面板渲染类型化表单；同时补齐表单生成器对动态键 map 的支持，使诸如 `mcpServers` 这类「键名动态的服务器映射」也能可视化编辑。

本特性面向三类角色：**扩展作者**（希望低成本地为自己的扩展提供设置界面）、**终端用户/操作者**（在设置面板里配置已安装扩展）、**平台维护者**（为长尾扩展集中补充 schema）。

## Boundary Context

- **In scope**：
  - 对**已安装**扩展按优先级从三源解析 settings schema 并渲染类型化表单。
  - 包自带 schema 约定（扩展在自身 `package.json` 声明配置文件名与包内 schema 路径）。
  - 第三方 schema registry（按包 id 索引、离线快照 + 可选远端刷新）。
  - 配置文件尚不存在时，依据 schema 渲染空表单并支持新建保存。
  - 表单生成器新增对 `additionalProperties`/`patternProperties`（动态键 map）的支持。
  - 服务端拉取远端 schema 的 host 白名单（SSRF 防护）。
- **Out of scope**：
  - 从配置值推断结构的「无 schema 兜底结构化编辑器」（讨论过，不采纳）。
  - 按扩展版本区间细分 schema（v1 仅「每包一份最新」）。
  - 在 pi 本体新增扩展配置声明/读取 API（pi 仍各扩展自行读盘，本特性不改 pi 本体）。
  - 为单个扩展手写专属界面（继续复用通用的 schema→表单渲染层）。
- **Adjacent expectations**：
  - 依赖 pi 将已安装包落于本地磁盘且其 `package.json` 可被服务端读取。
  - 扩展作者须自愿采用包自带 schema 约定，或被收录进第三方 registry；二者皆未做时退回原始 JSON 编辑（现状）。
  - 扩展自身仍按其既有路径读取配置文件；本特性只改变「配置如何被编辑/创建」，不改变「扩展如何读取」。

## Requirements

### Requirement 1: 包自带 Schema 的类型化设置表单（脊柱，install 门控）

**Objective:** 作为扩展作者，我希望只需在包内声明并打包一份配置 schema，用户安装我的扩展后即可在设置面板获得类型化表单，而无需我自建任何远端托管。

#### Acceptance Criteria
1. Where 某已安装扩展的包内清单声明了「目标配置文件名 + 包内 schema 路径」, the pi-web 扩展配置服务 shall 加载该包内 schema 并使其用于渲染对应配置文件的设置表单。
2. When 用户打开扩展设置面板, the 扩展设置面板 shall 对声明了包内 schema 的已安装扩展渲染结构化（类型化）表单。
3. If 某扩展未被安装（不在已启用扩展列表中）, then the pi-web 扩展配置服务 shall NOT 为其提供包内 schema，且其 schema 驱动的设置表单 shall NOT 出现。
4. While pi-web 处于无网络环境, the pi-web 扩展配置服务 shall 仍能从本地已安装包加载包内 schema 并渲染表单。
5. When 包内 schema 与磁盘上已存在的配置值同时可用, the 扩展设置面板 shall 以该 schema 渲染并回填现有配置值。

### Requirement 2: 配置文件尚不存在时的依据 Schema 新建

**Objective:** 作为终端用户，我希望即使扩展尚未写过配置文件，也能在设置面板据 schema 填写一份新配置并保存生效。

#### Acceptance Criteria
1. Where 某已安装扩展可解析到 schema 但其目标配置文件在磁盘上不存在, the 扩展设置面板 shall 依据该 schema 渲染一张空表单。
2. When 用户在该空表单填写并保存, the pi-web 扩展配置服务 shall 在对应配置目录创建该配置文件并写入提交值。
3. The pi-web 扩展配置服务 shall 将新建文件写入与该扩展实际读取路径一致的位置（全局作用域、项目作用域各对应其配置目录）。

### Requirement 3: 多源 Schema 解析与确定优先级

**Objective:** 作为平台，我希望一个已安装扩展的设置 schema 可来自多个来源，并以确定优先级「命中即用」，使三种来源各补不同缺口而不冲突。

#### Acceptance Criteria
1. When 解析某已安装扩展的设置 schema, the Schema 解析器 shall 依次尝试 ① 包自带 schema、② 配置文件内联 `$schema`、③ 第三方 registry，并采用第一个命中的来源。
2. If 较高优先级来源已命中, then the Schema 解析器 shall NOT 再查询较低优先级来源。
3. If 三源均未命中, then the 扩展设置面板 shall 回退到原始 JSON 文本编辑（保持现状行为）。
4. The Schema 解析器 shall 仅对已安装扩展执行包自带 schema 与 registry 解析，与 Requirement 1 的 install 门控保持一致。

### Requirement 4: 内联 `$schema` 兼容（保留现状）

**Objective:** 作为已采用内联 `$schema` 的扩展作者，我希望现有行为不被本特性破坏。

#### Acceptance Criteria
1. Where 某配置文件内联了 `$schema`(https URL) 且无更高优先级来源命中, the 扩展设置面板 shall 拉取该 schema 并渲染结构化表单（与现状一致）。
2. If 内联 `$schema` 的拉取或解析失败, then the 扩展设置面板 shall 回退到该文件的原始 JSON 文本编辑，且 shall NOT 阻断其他配置文件的渲染。

### Requirement 5: 第三方 Schema Registry（覆盖长尾）

**Objective:** 作为平台维护者，我希望为没有自带 schema 的长尾扩展，通过一个按包 id 索引、社区可维护的目录集中补上 schema。

#### Acceptance Criteria
1. Where 某已安装扩展既无包自带 schema、其配置文件又无内联 `$schema`, the pi-web 扩展配置服务 shall 按该扩展的包 id 查询第三方 schema registry。
2. If registry 中存在该包 id 的条目, then the pi-web 扩展配置服务 shall 依该条目取得 schema 并用于渲染其设置表单。
3. The pi-web 扩展配置服务 shall 内置一份 registry 离线快照，使在默认（无网络或未配置远端）情况下 registry 解析仍然可用。
4. Where 配置了远端 registry 来源, the pi-web 扩展配置服务 shall 以远端内容覆盖/刷新离线快照后再行解析。
5. If 远端 registry 来源不可用, then the pi-web 扩展配置服务 shall 回退到离线快照，且 shall NOT 致使设置面板整体失败。

### Requirement 6: 远端 Schema 拉取的安全门控（SSRF 防护）

**Objective:** 作为安全负责人，我希望服务端拉取远端 schema 不会成为任意 URL 的 SSRF 攻击面。

#### Acceptance Criteria
1. When the pi-web 扩展配置服务 在服务端拉取任何远端 schema（远端 registry 来源，或 registry 条目指向的 schema URL）, the pi-web 扩展配置服务 shall 仅放行 host 处于白名单内的 URL。
2. If 待拉取的远端 URL 其 host 不在白名单, then the pi-web 扩展配置服务 shall 拒绝该次拉取并回退（离线快照或原始 JSON 编辑）。
3. The pi-web 扩展配置服务 shall 缓存远端拉取结果，以避免对同一来源的重复请求。

### Requirement 7: 动态键 Map 配置的可视化编辑

**Objective:** 作为终端用户，我希望像 `mcpServers` 这种「键名动态的服务器映射」也能在表单里增删与编辑，而不是呈现为空白。

#### Acceptance Criteria
1. Where 某 schema 的对象节点以 `additionalProperties` 或 `patternProperties` 描述动态键值结构, the 表单生成器 shall 将其呈现为「可增删条目」的键值映射控件，而非空对象。
2. When 用户在该映射控件新增、删除或编辑条目, the 扩展设置面板 shall 将变更反映到即将保存的配置值中。
3. The 表单生成器 shall 在不破坏其对 `properties`、数组、`oneOf`、枚举等既有构造支持的前提下新增上述能力。

### Requirement 8: 兼容性、安全写盘与降级

**Objective:** 作为平台维护者，我希望新机制不破坏既有配置面板行为，并在异常输入下安全降级。

#### Acceptance Criteria
1. The pi-web 扩展配置服务 shall 保持既有 per-扩展 KV、Slash 命令可用性、以及现有「独立配置文件」编辑行为不变。
2. When 保存某扩展配置, the pi-web 扩展配置服务 shall 仅更新表单覆盖到的键并保留文件中既有的未覆盖键（非破坏写盘）。
3. The pi-web 扩展配置服务 shall 保持配置端点的鉴权与作用域（全局 vs 项目）与现状一致。
4. If schema 缺失、损坏或包含不被支持的构造, then the 表单生成器与 Schema 解析器 shall 安全降级（退回原始 JSON 或跳过该构造），且 shall NOT 抛出导致设置面板整体失败的错误。
