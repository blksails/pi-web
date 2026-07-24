# Requirements Document

## Introduction

为 config 路由工厂开一个**向后兼容的 `Workspace` 注入接缝**，使外部宿主（云端 pi-clouds 的
`TenantWorkspace`，按租户隔离的 Supabase 后端）能承载 config 域的读写，而非绑定到本地 fs 路径。

这是契约 §8.1 **C3（云端挂 config.* 五域）的前置**：契约把宿主状态抽象为 `Workspace` 端口，M2 已把
`ConfigCodec`（config.domains）与 `SourceSettingsCodec`（config.source）迁到 `WorkspaceNamespace` 语义之上，
但两者**仍只在构造时自建 `createLocalWorkspaceNamespace(rootDir)`，对外没有注入口**。本 spec 补上这个注入口。

**首刀范围 = 两个已在 Workspace 语义上的 codec（config.domains + config.source）**——它们的读写体只依赖
`WorkspaceNamespace` 接口，注入是「构造函数加一个吃注入 Workspace 的重载」的最小增量。三个裸 `fs` 工厂
（config.mcp / config.sandboxProject / config.extensions）**不在本 spec**（它们需把 fs 读写重构为 namespace
调用，属后续增量）。

### 契约依据
- `docs/pi-web-host-contract-v1.md` §3.6/§3.7（Workspace 端口 + 建其上的既有端口）、§8.1 C3、§1（增量演进）。
- `docs/desktop-cloud-integration-design.md` §3.8（config 垂直切片验证模型）、§4 R4（adminPolicy 落地是并行前置）。

### 强约束
1. **向后兼容**：加**可选**注入成员，不改既有 `rootDir`/`agentDir` 构造签名与语义（契约 §1「仅允许增量演进：加可选成员」，不升 v2）。
2. **不碰 §5.3 冻结的能力面 id**：只改工厂内部实现与 opts，不改 id 名。
3. **行为零变化**：desktop 单机不传注入时，逐字节等价现状（本地 fs 路径分支）。
4. **注入分支与路径分支语义等价**：同一 codec 的两条构造分支（路径 vs 注入 Workspace）读写/合并/损坏降级语义必须一致。

## Requirements

### Requirement 1: `ConfigCodec` 接受注入的 `WorkspaceNamespace`
**Objective:** 作为承载 config.domains 的 codec，我要能接受外部注入的命名空间，以便云端把 config 域读写导向
租户隔离的 Workspace 而非本地 fs。

#### Acceptance Criteria
1. The `ConfigCodec` shall 接受构造入参为**路径字符串**（现状）或**注入的 `WorkspaceNamespace`**（新增）。
2. When 传入注入的 `WorkspaceNamespace`, the `ConfigCodec` shall 用该命名空间承载全部 `load`/`save`，不自建 `LocalWorkspace`。
3. While 未传注入（传路径或不传）, the `ConfigCodec` shall 逐字节等价现状（自建 `createLocalWorkspaceNamespace(rootDir ?? default)`）。
4. The `ConfigCodec` 的注入分支与路径分支 shall 具备相同的读写/deepMerge/`merge:false` 覆盖/损坏（`corrupt`）降级语义。

### Requirement 2: `SourceSettingsCodec` 接受注入的 `Workspace`（双根）
**Objective:** 作为承载 config.source 的 codec（user + project 双 scope），我要能接受注入的双根 `Workspace`，以便
云端把 source/project 两 scope 导向租户隔离的 `workspace.user` / `workspace.project`。

#### Acceptance Criteria
1. The `SourceSettingsCodec` shall 接受构造入参为 `agentDir` 路径（现状）或注入的 `Workspace`（新增）。
2. When 传入注入的 `Workspace` 且 scope 为 `source`, the codec shall 用 `workspace.user` 承载，键 `sources/<sourceKey>/settings.json`。
3. When 传入注入的 `Workspace` 且 scope 为 `project`, the codec shall 用 `workspace.project` 承载，键 `source-settings/<sourceKey>.json`；此时 `cwd` 参数**不再必需**（注入的 project 根即目标）。
4. The `SourceSettingsCodec` shall 保留 `assertSourceKeyShape` 校验（防路径穿越，契约 §3.3），注入分支同样强制。
5. While 未传注入（传 `agentDir`）, the codec shall 逐字节等价现状（source→`agentDir`、project→`<cwd>/.pi`，project 仍需 cwd）。

### Requirement 3: 路由工厂 `workspace?` 注入 opt
**Objective:** 作为装配方，我要 config.domains / config.source 的路由工厂接受可选 `workspace`，以便经能力面装配把注入 Workspace 递到 codec。

#### Acceptance Criteria
1. The `createConfigRoutes` shall 增可选 `workspace?: Workspace`；提供时用 `workspace.user` 构造 `ConfigCodec`，否则用 `rootDir`（现状）。
2. The `createSourceSettingsRoutes` shall 增可选 `workspace?: Workspace`；提供时用注入 `Workspace` 构造 `SourceSettingsCodec`，否则用 `rootDir`（现状）。
3. The 两个路由工厂 shall 保持其余 opts（`adminPolicy?` / `listModelOptions?` / `resolveSettings` / `onSaved` 等）与端点行为不变。

### Requirement 4: `HostDeps` 与 `defaultCapabilities` 传递注入
**Objective:** 作为能力面装配，我要 `HostDeps` 承载可选 `workspace` 与 `adminPolicy`，以便宿主（云端）经一处注入触达 config 工厂。

#### Acceptance Criteria
1. The `HostDeps` shall 增可选 `workspace?: Workspace` 与 `adminPolicy?: ConfigAdminPolicy`（向后兼容，desktop 不传）。
2. When `defaultCapabilities` 绑定 config.domains / config.source 的 factory, the binding shall 把 `d.workspace` 与 `d.adminPolicy` 透传给对应工厂（缺省不传 = 现状路径 + 默认放行）。
3. The `defaultCapabilities` shall 保持 16 id 集合与顺序不变（`config.mcp` 仍排在 `config.domains` 前），装配级 id 守卫不变。

### Requirement 5: 语义等价测试 + 发版
**Objective:** 作为要求零回归的增量，我要注入分支被内存 Workspace 测试验证与路径分支等价，并发布可消费版本。

#### Acceptance Criteria
1. The 测试套件 shall 用内存 `Workspace`（`createMemoryWorkspace` 样板）验证两个 codec 的注入分支与路径分支读写/合并/损坏降级**逐条等价**。
2. The 测试套件 shall 验证 `createConfigRoutes({ workspace })` / `createSourceSettingsRoutes({ workspace })` 的 GET/PUT 端点走注入分支且行为正确。
3. The 既有 config/装配测试 shall 全部无回归；`@blksails/pi-web-server` shall 发布含本增量的新版本（0.5.3）供 pi-clouds 消费。
