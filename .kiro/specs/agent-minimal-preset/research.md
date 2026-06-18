# Research Log — agent-minimal-preset

## Discovery 范围

- 类型:Extension(在既有 `@pi-web/agent-kit` + `@pi-web/server` 上扩展能力),light discovery。
- 目标:确认"关闭工具/skills/系统扩展"在现有公共表面与运行时映射中的真实可行性,定位映射落点与扩展身份识别方式。

## 关键调查与发现

### 1. 现有 `AgentDefinition` 公共表面(agent-kit)
- 文件:`packages/agent-kit/src/types.ts`。字段:`model / thinkingLevel / tools / excludeTools / noTools / customTools / systemPrompt / extensions / skills / promptTemplates / contextFiles / scopedModels`。
- `defineAgent`(`src/index.ts`)是恒等函数,无运行时副作用;包零强制运行时依赖(`sdk-types.ts` 全为 `type` 导入,SDK 为 peer/dev 依赖)。
- 含义:**`extensions` 字段语义仅为"追加"**,无关闭语义;无 `allowExtensions`、无 `noExtensions`/`extensionsOverride` 出口。

### 2. 运行时映射(server)
- 文件:`packages/server/src/runner/option-mapper.ts`。
  - `mapResourceLoaderOptions`:`systemPrompt → systemPromptOverride`;`extensions →` 拆分为 `additionalExtensionPaths`(字符串)+`extensionFactories`(函数);`skills → skillsOverride`;`promptTemplates / contextFiles` 同理。空数组 `extensions: []` 不写入任何键。
  - `mapSessionFields`:`tools / excludeTools / noTools / customTools` 透传。
- 文件:`packages/server/src/runner/agent-definition.ts` 是 agent-kit `AgentDefinition` 的**结构镜像**(server 不依赖 agent-kit)。两处必须并行新增 `allowExtensions`。
- **确认:`extensions: []` 不会关闭 disk 发现的系统扩展**——只是不追加。

### 3. SDK 资源加载能力(`@earendil-works/pi-coding-agent`)
- `DefaultResourceLoaderOptions`(`dist/core/resource-loader.d.ts:61`)提供:`noExtensions?: boolean`、`extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult`、`skillsOverride`、`noSkills` 等。
- 编译实现(`dist/core/resource-loader.js`)关键行为:
  - `noExtensions: true` → `extensionPaths = cliEnabledExtensions`(仅 `additionalExtensionPaths` 解析出的 "cli/temporary" 项),**跳过 disk 发现的扩展**;显式追加项仍加载。→ 满足"全关但保留显式追加"。
  - `extensionsOverride` 在最终集合 `extensionsResult` 上运行(load 之后),可过滤 `extensions`,需保留 `errors` 与 `runtime`。
  - 注意:`applyExtensionSourceInfo` 在 override **之后**执行,故 override 内 `extension.sourceInfo.scope` 尚未定型,识别应基于 `extension.path`。
- 扩展身份:`Extension` 有 `path / resolvedPath / sourceInfo`。工厂扩展 `path` 形如 `"<inline:N>"`(`loadExtensionFactories`,`resource-loader.js:681`)。`LoadExtensionsResult = { extensions: Extension[]; errors; runtime }`。

### 4. 既有约定与测试
- skills 全关既有范式:`skills: ({ diagnostics }) => ({ skills: [], diagnostics })`(见 `examples/hello-agent/index.ts`),保留 diagnostics。
- mapper 单测:`packages/server/test/runner/option-mapper.test.ts`,已覆盖 extensions 拆分、skills override、空定义、session 字段透传——新增能力按相同范式加测。
- agent-kit 单测:`packages/agent-kit/test/define-agent.test.ts`(恒等/无副作用)、`types.type-test.ts`(类型)。

## 架构决策

- **D1:`allowExtensions: string[]` 单字段双语义**(关闭开关 + 白名单)。`[]` = 全关;`["a"]` = 仅保留 a;字段缺省 = SDK 默认发现。独立于"仅追加"的 `extensions`。满足 Req 2.1/3.x,公共表面最小。
- **D2:分模式映射**(在 server `mapResourceLoaderOptions`):
  - `allowExtensions: []` → `noExtensions: true`(跳过发现,**不执行**被关扩展代码,最安全;显式追加项由 SDK 保留)。
  - `allowExtensions` 非空 → `extensionsOverride`,保留 `name(ext) ∈ allow` 或显式追加项(工厂 `path` 以 `<inline:` 开头 / 显式路径 basename 匹配),其余丢弃。
- **D3:扩展名 `name(ext)`** 取自 `ext.path` 的 basename(去扩展名),与白名单逐项比较;实现期对真实样例校准。
- **D4:预设产物** = 导出常量 `minimalAgentPreset`(透明、可读、可测)+ 工厂 `defineMinimalAgent(overrides?)`(一行、可覆盖,内部 `defineAgent({ ...preset, ...overrides })`)。满足 Req 1.1 与 Req 4。

## 风险与权衡

- **R-1(已知限制)**:非空 `allowExtensions` 走 `extensionsOverride`,会先**加载**全部 disk 发现扩展再过滤,即未白名单的扩展代码仍被执行一次;若需"被关扩展代码完全不执行"的强隔离,用 `allowExtensions: []`。在 design Risks 与代码注释中说明。SDK 无按名预过滤发现路径的出口。
- **R-2**:override 内 `sourceInfo` 未定型 → 识别只用 `path`/`resolvedPath`,不用 scope。
- **R-3**:agent-kit 与 server 两处 `AgentDefinition` 镜像必须同步,否则 `defineAgent(...)` 定义无法被运行时消费(结构鸭子类型)。加类型测试守护。

## 综合(Synthesis)

- Build-vs-adopt:复用 SDK 既有 `noExtensions`/`extensionsOverride`,agent-kit/server 仅做声明字段 + 薄映射,不自造扩展加载逻辑。
- 简化:skills 全关沿用既有 override 范式,不引入新机制;扩展全关优先 `noExtensions` 而非 override(更安全更简单)。
- 泛化:`allowExtensions` 单字段覆盖"全关"与"白名单"两种诉求,避免引入并列的 `noExtensions` 公共字段。
