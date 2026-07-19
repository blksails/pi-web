# Requirements Document

## Project Description (Input)

pi-web「agent-source 扩展性七面」收尾两项 backlog:

1. **面⑦ per-source settings**:每个 agent-source 拥有独立的设置面板与持久化(声明式 schema → 服务端下发 → 动态面板 → 落盘 → 装配期注入 `AgentContext.settings`)。当前 C 态(未落地,`AgentContext.settings`/`registerSourceSettingsPanel`/`/api/config/source/*` pi-web + pi-clouds 两仓皆零命中)。
2. **面⑤ 第三方 slots 的 webext 云上支持**:让第三方 agent-source 声明的 slots 型 webext 组件可加载。当前 B 态缺口(运行时车道 declarative-only,组件不可序列化,第一方 canvas 走构建期烘焙才支持 slots)。

含:两项在本地 pi-web(Electron/桌面或本地 server)与云上 apps/cloud(浏览器前端 + ACS 沙箱内 agent-runner)两种宿主下如何各自工作或降级;两项共享的地基(稳定 sourceKey、raw-line 侧路通道、agent-declared-routes 数据端点)。

架构约束:pi JSONL 协议封闭 union(`response`/`event`/`extension_ui_request`)零改动,新通道走 state-injection-bridge 同款 raw-line 侧路;主进程不执行 source 代码;新接缝沿用既有安全模型(trust 门控、SRI + Ed25519 签名、管理员门控、进程隔离)。

## Introduction

本 spec 把两项收尾功能一次性固化。**面⑦** 给 agent-source 作者一个声明式设置能力:在清单声明 FormSchema,宿主设置外壳零改动动态长出该 source 的面板,值持久化到 per-source 命名空间,runner 装配期消费为 `AgentContext.settings`。**面⑤** 补齐第三方 slots 型 webext 的加载:本地经「代码扩展」车道(manifest 带 `entry` + SRI/签名 + 浏览器动态 import)让第三方 slots 组件挂进宿主壳,云上则如实标注降级(第三方组件槽跨沙箱到浏览器须等 pi-clouds 阶段3 iframe 隔离车道另立 spec)。

两项共享三条地基:稳定 `sourceKey`(对齐 registry sourceId)、raw-line 侧路通道(实时下发先例)、agent-declared-routes(动态控件数据端点)。面⑦ 的动态控件 widget 本质是第三方 webext 组件,依赖面⑤ 路线 A;但面⑦ 的静态字段部分完全不依赖面⑤,可独立先行并在本地 + 云上两端工作。

## Boundary Context

- **In scope**:
  - 共享地基:稳定 sourceKey 工具(sha256 散列 + 路径安全,输入对齐 registry sourceId)。
  - 面⑦:清单 `settings` 段声明面与装配期校验;per-source 持久化(source/project 双作用域)与稳定命名空间;`/api/config/source/:sourceKey` 读写端点(schema 下发 + 值校验 + secret 掩码);runner 装配期注入 `AgentContext.settings`;设置面板动态登记 + per-source scoped field registry;云上 Supabase config-store + claim→configure 送达沙箱。
  - 面⑤(路线 A,本地):slots 组件编进 dist entry(manifest 带 entry + SRI + 签名);代码扩展 slots 运行时加载挂 SlotHost;安全门贯通与降级;第三方源(非构建期静态 import 车道)本地全链 e2e。
  - 面⑤(云上):如实标注第三方 slots 云上降级;为 pi-clouds 阶段3 iframe 隔离车道预留接口约束(panel 级优先)。
- **Out of scope**:
  - 面⑦ 运行期实时下发(通道 b / `piweb_settings_changed`)属 M3,本 spec 列为可选任务(tasks.md 任务 7.2),不阻塞主体;per-session 作用域 override(留 v2)。
  - 面⑤ 云上 iframe 隔离车道的实现(5B.*):独立 origin + postMessage RPC + scoped token,属 pi-clouds 阶段3,另立 spec;本 spec 只记录接口预留与约束,不含实现任务。
  - pi SDK(上游 npm 包)的任何改动;pi JSONL 协议封闭 union 的破坏性变更。
  - 主进程执行 source 代码。
- **Adjacent expectations**:
  - 面⑦ 面板注册复用既有 `registerSettingsPanel` + 分组 Tab + 「异步探测→登记→bump」先例(`registerMcpPanelIfInstalled`);FormSchema/校验器/字段 renderer 注册表复用;读写端点复用 `/config/:domain` 的 maskSecrets/mergeSecrets/codec 范式,门控/body-limit/error-map 抄 agent-declared-routes。
  - 面⑦ 动态控件数据端点复用既有 agent-declared-routes(面⑥,已落地);面⑥⑦ 互为供给。
  - 面⑤ slots 渲染复用既有 SlotHost 与 pi-chat/chat-app 各槽区挂载点;安全门复用 SRI + Ed25519 + import map 单例;字节托管(云上 registryDistDeps + `/api/webext/dist`)已就位可复用。
  - 云上 per-source settings 存储复用 provider_keys 的 (scope, company_id, user_id nullable) 分层范式 + 信封加密 + configure 帧送达链路。

## 主控拍板记录(2026-07-19,已并入本 spec)

- **Q1**:面⑤ 先做路线 A(本地第三方 slots);路线 B(云上 iframe 隔离车道)留待 pi-clouds 阶段3 另立 spec,本 spec 只记录接口预留,不含 5B.* 任务。
- **Q2**:`sourceKey` 对齐 registry sourceId(不含版本/channel),升版不丢配置。
- **Q3**:云上 iframe 车道 panel 级优先(作为阶段3 spec 的输入约束记录)。
- **Q4**:面⑦ 运行期实时下发(通道 b / 任务 7.2)M3 延后。
- **Q5**:`scope:"project"` 用独立 `.pi/source-settings/<sourceKey>.json` 目录,不并入既有 `.pi/settings.json`。

---

## Requirements

### Requirement 0:共享地基 —— 稳定 sourceKey(两项共用)

**Objective:** As a pi-web 平台维护者, I want 一个稳定、防路径注入的 source 标识散列, so that 面⑦ 的 per-source 配置命名空间与面⑤ 的 dist 内容寻址/源匹配有统一、升版不丢的键。

#### Acceptance Criteria
0.1 The 系统 SHALL 提供 `sourceKey(source)` 工具,以 registry sourceId 作为稳定输入(不含版本/channel),产出确定性散列(sha256 短散列,同 `template-name.ts` 现成模式)。
0.2 When 同一 source 升版(version/channel 变化)但 sourceId 不变 THEN `sourceKey` SHALL 保持不变(已存 per-source 配置不丢失)。
0.3 The `sourceKey` SHALL 仅含文件系统安全字符,使其可直接用作目录段/DB 主键而无路径注入风险(以碰撞/注入用例单测证明)。
0.4 The 面⑦ 的 per-source 配置目录/DB 主键与面⑤ 的 dist 寻址/源匹配 SHALL 复用同一 `sourceKey` 工具(单一事实来源)。

---

## 面⑦ · per-source settings

### Requirement 1:settings 声明面(agent 作者)

**Objective:** As an agent source 作者, I want 在清单声明设置 schema(字段、标题、图标、作用域、依赖控件), so that 不改 pi-web 宿主代码就能让我的 source 长出独立设置面板。

#### Acceptance Criteria
1.1 The `pi-web.json` 清单 SHALL 支持可选的 `settings` 段,至少含:`schema`(指向 FormSchema 兼容的静态 JSON)、`title`、`icon`、`scope`(`source` | `project`)、`widgets`(依赖的动态控件键列表);未声明 `settings` 的清单完全不受本特性影响(类型与运行时行为均零变化)。
1.2 When 无 `pi-web.json` 但 `settings/schema.json` 文件存在 THEN 系统 SHALL 按「文件存在即门控」哲学启用设置面(与 `resolvePiPlugin` 无清单回退目录探测一致)。
1.3 If `settings.schema` 指向的 schema 非法或文件缺失 THEN 系统 SHALL 降级为 diagnostics + 不出面板(不使整模块失败)。
1.4 When 清单含合法 `settings` 段 THEN `resolvePiPlugin` SHALL 在 `PluginDescriptor` 产出对应的 settings 切片(供服务端端点与装配期消费)。
1.5 The settings 声明面 SHALL 复用既有 FormSchema IR(`packages/protocol/src/config/form-schema.ts`)的字段种类(string/secret/number/boolean/enum/multiEnum/stringList/object/record/objectList)与 secret 三态契约,不新建表单 IR。

### Requirement 2:per-source 持久化与作用域

**Objective:** As an agent source 用户, I want 我为某 source 设置的值稳定持久化在 per-source 命名空间, so that 跨会话/跨项目按预期恢复,且不同 source 互不干扰。

#### Acceptance Criteria
2.1 When `scope:"source"` 且用户保存设置值 THEN 系统 SHALL 落盘到 `<agentDir>/sources/<sourceKey>/settings.json`(per-source × per-user,跨项目稳定),目录 0700 / 文件 0600(与既有 config-codec 一致)。
2.2 When `scope:"project"` 且用户保存设置值 THEN 系统 SHALL 落盘到 `<cwd>/.pi/source-settings/<sourceKey>.json`(per-source × per-cwd,受 trust 门控),独立于既有 `<cwd>/.pi/settings.json`(不并入,拍板 Q5)。
2.3 The secret 字段落盘 SHALL 存密文或掩码引用,明文永不回读浏览器(复用 `SecretMask`/`SecretWrite` 三态)。
2.4 If per-source 配置文件不存在 THEN 读取 SHALL 返回空对象(`{}`),不报错。
2.5 The per-source 命名空间键 SHALL 由 Requirement 0 的 `sourceKey` 派生,不得用 source 字符串直接拼路径。

### Requirement 3:settings 读写 HTTP 端点

**Objective:** As a 宿主前端, I want 一个通用端点读到已解析 schema 与当前值、并写回校验后的值, so that 设置面板无需感知每个 source 的具体 schema 即可渲染与保存。

#### Acceptance Criteria
3.1 When 前端 GET `/api/config/source/:sourceKey` THEN 系统 SHALL 返回 `{ schema, values, version }`:`schema` 为服务端已 zod 校验的 FormSchema,`values` 为当前值(secret 经 maskSecrets)。
3.2 When 前端 PUT `/api/config/source/:sourceKey`(可带 `?scope=source|project`) THEN 系统 SHALL 按 schema 校验请求体 → mergeSecrets → 按作用域落盘(Requirement 2)。
3.3 If PUT 请求体不通过 schema 校验 THEN 系统 SHALL 返回 400 与结构化错误体,不落盘。
3.4 The secret 字段 SHALL 永不经 GET 回读明文(掩码 + SecretWrite);secret 的写入语义(keep/clear/set)与既有 `/config/:domain` 一致。
3.5 The 端点 SHALL 挂在既有 config 段(不新开顶层 API 段),避免「可声明但静默 404」的挂载缺口(以整站部署形态测试证明)。
3.6 The 端点的门控、请求体上限、错误码映射 SHALL 复用 agent-declared-routes 的范式(结构化错误体 + 确定默认值 + 可运维配置)。

### Requirement 4:runner 装配期注入 AgentContext.settings

**Objective:** As an agent source 作者, I want 装配期把用户设置的值注入 `ctx.settings`, so that 我的 agent 定义(工厂形态)可据此定制 systemPrompt/工具而无需自行读盘。

#### Acceptance Criteria
4.1 The `AgentContext` 类型面(`packages/agent-kit` 与 `packages/server/src/runner` 两处镜像) SHALL 新增只读 `settings` 字段(已解析值,secret 已解掩码)。
4.2 When runner 装配期启动 THEN 系统 SHALL 从对应作用域的 per-source `settings.json` 读出值并注入 `ctx.settings`;无文件时 `ctx.settings` 为空对象。
4.3 The secret 字段 SHALL 在服务端解掩码后仅经 spawn env / stdin 传给子进程,不落浏览器。
4.4 The 装配期注入 SHALL 有真实子进程集成测试覆盖(stub 抓不到装配期注入类回归,与 state 桥同教训)。
4.5 The 未声明 settings 的存量 source SHALL `ctx.settings` 为空对象且既有装配行为零变化。

### Requirement 5:设置面板动态登记与动态控件

**Objective:** As an agent source 用户, I want 选中某 source 时设置外壳自动长出它的面板,且动态控件(如实体下拉)能取到数据, so that 我无需宿主端配置即可配置该 source。

#### Acceptance Criteria
5.1 When source 激活 THEN 前端 SHALL 幂等登记 per-source 设置面板(`registerSourceSettingsPanel(sourceKey)`,按 id 覆盖),`<SettingsShell>` 零改动长出该面板(复刻 `registerMcpPanelIfInstalled` 的「异步 GET 探测→登记→bump 重渲染」)。
5.2 The 面板菜单项标题 SHALL 取自清单 `settings.title`;面板表单 SHALL 复用既有 FormSchema 渲染器与字段 renderer 三级解析(key→widget→kind)。
5.3 The 系统 SHALL 在全局 `registerFieldRendererByKey` 之上提供 per-source scoped field registry(`registerSourceFieldRenderer(sourceKey, key, comp)`),查找顺序 per-source → 全局,切源/卸载即回收(不污染全局注册表)。
5.4 When schema 字段声明 `widget:"<key>"` 且该 source 的 webext 提供对应 renderer THEN 面板 SHALL 用该动态控件渲染;控件的动态选项数据端点 MAY 就是本模块自己的 agent-declared-routes(面⑥⑦ 互为供给)。
5.5 If 动态控件依赖的 webext 未加载/验签失败 THEN 该字段 SHALL 降级为只读 JSON 编辑(不使整面板失败)。
5.6 When source 切换 THEN 前一 source 的 scoped renderer 与面板 SHALL 被回收(以切源用例证明无残留)。

### Requirement 6:面⑦ 云上兼容(apps/cloud)

**Objective:** As a 云版用户, I want 我在浏览器为某 source 设置的值送达沙箱内的 agent, so that 云版与本地行为等价(静态字段),且 secret 走信封加密不明文外泄。

#### Acceptance Criteria
6.1 The 云上 per-source settings 存储 SHALL 复用 provider_keys 的分层范式:新建 `pi_clouds_source_settings(company_id, user_id nullable, source_key, payload jsonb, unique(company_id,user_id,source_key))`。
6.2 The 云上 secret 字段 SHALL 走既有信封加密(`EnvelopeCipher`,AES + per-record DEK)与三层解析(user → org → platform),不经通用 config API 明文回吐浏览器(auth 类 secret 不模拟)。
6.3 When 云版建立会话且沙箱 claim 完成 THEN 系统 SHALL 经 bridge configure 把 per-source settings 写进沙箱 workspace,再由沙箱内同一 runner-bootstrap 装配期注入 `ctx.settings`(池化约束下必须 claim 后 configure,不能靠 create env)。
6.4 The 云上 GET|PUT `/api/config/source/*` SHALL 由 catch-all 透传但落盘重写到 Supabase(而非本地盘),对浏览器行为与本地等价(静态字段)。
6.5 The 面⑦ 的动态控件 widget 部分在云上 SHALL 受面⑤ 第三方 slots 缺口约束而降级(纯静态字段 string/secret/boolean/enum/record 不受影响,完整工作)。

### Requirement 7:面⑦ 运行期实时下发(M3,可选)

**Objective:** As an agent source 用户, I want 标记为 liveReload 的设置键在保存后实时生效, so that 无需新建会话即可看到效果。

#### Acceptance Criteria
7.1 Where schema 声明 `liveReload` 键集合 AND PUT 成功 THEN 系统 MAY 经 stdin 推 `piweb_settings_changed` 帧(复用 `piweb_state` 广播 + sticky 回放模式),使该键实时生效。
7.2 When 会话重连 THEN 已下发的 settings 快照 SHALL 经粘性帧回放不丢失。
7.3 The 本 Requirement 属 M3 延后(拍板 Q4),v1 可只做装配期通道(Requirement 4);未实现时不阻塞面⑦ 主体上线。

---

## 面⑤ · 第三方 slots 的 webext 云上支持

### Requirement 8:slots 组件编进 dist entry(路线 A · 构建)

**Objective:** As an agent source 作者, I want 我声明的 slots 组件被编进带 entry 的 dist 产物, so that 第三方源不经构建期静态 import 也能被宿主运行时加载。

#### Acceptance Criteria
8.1 When 一个声明 slots 的 webext 执行 build THEN 系统 SHALL 产出带 `entry`(指向 `.mjs`)的 `manifest.json` + 逐文件 sha384 SRI + Ed25519 签名(复用 `manifest-emit.ts`)。
8.2 The 构建产物 SHALL 让 slots 组件经 import map 单例复用宿主 React/web-kit 实例(不打包第二份 React)。
8.3 The 签名规范化字节 SHALL 排除 signature 字段(`canonicalManifestBytes`),与既有签名管线一致。
8.4 The `examples/webext-slots-agent`(既有 18 槽 fixture) SHALL 能 build 出带 entry 的 manifest 作为路线 A 验收 fixture。

### Requirement 9:代码扩展 slots 运行时加载挂 SlotHost(路线 A · 本地)

**Objective:** As a 本地 pi-web 用户, I want 第三方声明的 slots 组件经运行时车道加载并挂进宿主壳各槽区, so that 第三方 source 的 UI 与第一方等价渲染。

#### Acceptance Criteria
9.1 When 第三方 source 的 manifest 带 `entry`(代码扩展) THEN `loadExtension` SHALL 走 `status:"loaded"` 分支:fetch 字节 → 安全门 → 浏览器动态 import → 挂进 `SlotHost`。
9.2 The 加载的 slots 组件 SHALL 渲染到 pi-chat/chat-app 既有槽区挂载点(background/header/panelRight/footer/artifactSurface/launcherRail 等),与第一方 slots 走同一挂载路径。
9.3 The 第三方 slots 加载 SHALL 经 `/api/webext/resolve`(返回带 entry manifest)+ `/api/webext/dist` 下发字节,不经构建期静态 import 车道(`webext-registry.ts`)。
9.4 The 声明式-only(无 entry)webext SHALL 保持既有行为(合成 `manifestId+config`,零组件字节),不受本 Requirement 影响。

### Requirement 10:面⑤ 安全门与降级

**Objective:** As a pi-web 运维者, I want 第三方 slots 代码扩展经完整安全门加载并在失败时优雅降级, so that 新加载面不引入篡改/越权/整壳崩溃风险。

#### Acceptance Criteria
10.1 The 第三方 slots 代码扩展加载 SHALL 经 SRI(sha384)完整性校验 + Ed25519 白名单签名校验 + API 版本 caret 兼容校验。
10.2 If 字节被篡改(SRI 不匹配) THEN 系统 SHALL 拒绝加载该扩展。
10.3 If 签名由非白名单公钥产出 THEN 系统 SHALL 拒绝加载该扩展。
10.4 If 某个 slot 组件加载/渲染失败 THEN 系统 SHALL 经 `ExtErrorBoundary` 隔离该槽并降级(不 fail 整宿主壳)。

### Requirement 11:面⑤ 本地端到端验证

**Objective:** As a pi-web 维护者, I want 第三方 slots 源经运行时车道全链跑通的 e2e 证据, so that 路线 A 可信可回归。

#### Acceptance Criteria
11.1 When `examples/webext-slots-agent` 作为第三方源(非构建期静态 import)被加载 THEN e2e SHALL 证明:resolve → dist → 动态 import → 挂 18 槽全链渲染。
11.2 The e2e SHALL 覆盖安全门降级(篡改/坏签名被拒、某槽失败隔离不崩壳)。
11.3 The 既有第一方 webext(构建期烘焙车道)与声明式-only webext SHALL 行为零变化(全量回归绿)。

### Requirement 12:面⑤ 云上兼容与阶段3 接口预留

**Objective:** As a 云版产品负责人, I want 云上第三方 slots 的降级如实标注,并为 pi-clouds 阶段3 iframe 隔离车道预留接口约束, so that MVP 边界清晰、后续接线有据。

#### Acceptance Criteria
12.1 The 云上第三方 slots 型 webext(带 entry 或 capabilities 含 slots) SHALL 保持既有隔离门拒绝下发的行为(`webextNeedsIsolationLane`),对会话降级无感(回退默认 UI)。
12.2 The 云上字节托管链路(registry bake → OSS → `/v1/webext-dist` → 控制面 registryDistDeps → `/api/webext/dist`) SHALL 保持就位可复用,为阶段3 iframe 车道供给字节。
12.3 The 本 spec SHALL 记录阶段3 iframe 隔离车道的接口约束:独立 origin + postMessage RPC + scoped token,panel 级槽优先隔离、rail 级小件继续限声明式(拍板 Q3);实现另立 pi-clouds spec,本 spec 不含 5B.* 任务。
12.4 The 云上第三方 slots 降级 SHALL 在文档/parity 记录如实标注为 MVP 缺口(不谎称支持)。

---

## Requirement 13:兼容与回归(两项共用)

**Objective:** As a pi-web 维护者, I want 两项功能对既有协议与行为零破坏, so that 存量 source、前端与云版集成不受影响。

#### Acceptance Criteria
13.1 The 两项特性 SHALL 不改变 pi JSONL 协议封闭 union(`response`/`event`/`extension_ui_request`)的种类与语义;新通道走 raw-line 侧路(state 桥同款),对旧前端不可见。
13.2 The 未声明 settings / 未含 slots 的存量 agent source SHALL 在会话创建、对话、命令、附件、webext 加载等全部既有行为上零变化(全量回归测试保持全绿)。
13.3 When 两项完成 THEN 单元/集成测试与浏览器 e2e SHALL 以新鲜运行输出证明:面⑦ 声明→端点→面板→落盘→装配注入闭环(含 400/降级语义),面⑤ 声明→dist→安全门→运行时 import→挂槽闭环(含篡改/坏签名/隔离降级)。
13.4 The 云上改动 SHALL 依赖 pi-web 侧端点/类型定稿并发 npm 版后接线(`[cloud]`/`[npm]` 依赖标注保留),真机验证依赖用户环境。
