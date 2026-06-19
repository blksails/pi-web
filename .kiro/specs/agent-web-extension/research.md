# Research & Design Decisions — agent-web-extension

## Summary
- **Feature**: `agent-web-extension`
- **Discovery Scope**: Extension(对既有 pi-web 分层系统的扩展,集成导向)
- **Key Findings**:
  - `PiChat` 已具备四维定制(`slots` / `components`(ComponentOverrides ~13)/ `registry`(`createRendererRegistry` 工厂已存在)/ `layout|icons|theme|toolbarOrder`),但全部经宿主 React props 在装配点喂入。本特性把「喂入源」从宿主代码迁移到 agent source 的 `.pi/web` 声明 + 运行时加载,**不重造定制维度**。
  - `renderer-registry.ts` 已导出 `createRendererRegistry()` 工厂与模块级 `defaultRendererRegistry` 单例;per-session 化只需停用单例默认、改由会话作用域注入工厂实例 + key 命名空间,属采纳改造而非重建。
  - 现有 transport 已有版本化 SSE 帧(`uiMessageChunk` / `control`)与 REST DTO(`@pi-web/protocol`)。Tier 3 的 UI↔agent RPC 应**复用 control 帧(下行)+ REST 命令(上行)**,新增 `ui-rpc` 控制载荷与 `/sessions/:id/ui-rpc` 端点,而非另起传输。
  - server-driven UI 已有 `SandboxRenderer` + 白名单组件(受限节点树),正是 Tier 2 内联渲染「只许声明式」的现成承载。

## Research Log

### 共享单例约束(React / web-kit external)
- **Context**: 独立预构建 bundle 若自带 React 会触发 "invalid hook call"。
- **Findings**: 浏览器原生 ESM + import map 可把裸 specifier(`react`/`react-dom`/`@pi-web/web-kit`/设计系统)映射到宿主已加载的单例 URL;`pi-web build` 须把这些标 external 并在产物校验阶段拒绝内联副本。
- **Implications**: 这与前期 pi SDK 的 `serverExternalPackages` 是同一原理(重型单例不可重复打包),复用同一心智模型。

### git source 加载同源 bundle 的风险面
- **Context**: 用户决定 git source 也加载 UI bundle(同源不透明代码)。
- **Findings**: scoping 只防撞不围栏;同源 JS 可绕过任何 CSS 约定。唯一实质防线是签名+白名单(信任作者)+ CSP(限制外联/eval)+ artifact iframe(隔离 LLM 输出)。
- **Implications**: 安全围栏从技术边界降级为运营边界,三支柱为强制需求(Req 7),且 Tier 4 artifact 不可妥协(Req 5)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 宿主插槽 + registry + 运行时 ESM 加载(选定) | 模型 A,宿主拥有根,扩展填具名插槽/注册渲染器/注册贡献点,bundle 经 import map 加载 | 与现有 PiChat 定制无缝;不接管 document;可懒加载 | 同源代码无技术围栏,依赖签名+CSP | 采纳现有 `createRendererRegistry` |
| Module Federation 运行时 | webpack MF 共享作用域 | 成熟的共享单例机制 | 绑打包器、比 import map 重;用户已排除 | 非目标 |
| Shadow DOM 隔离 | 每表面起 shadow root | 真围栏 | 与 Tailwind/portal 协作需重设计;用户已排除 | 非目标 |

## Design Decisions

### Decision: UI↔agent RPC 复用现有协议通道
- **Alternatives**: (1) 新建独立 WebSocket/通道;(2) 复用 SSE control 帧(下行)+ REST(上行)。
- **Selected**: 复用。下行经 `control` 帧新增 `ui-rpc` 载荷;上行新增 `POST /sessions/:id/ui-rpc`。请求/响应以 `correlationId` 配对。
- **Rationale**: 传输无关通道与版本化已就绪,避免再造一条有状态连接;sticky routing/重连语义统一。
- **Trade-offs**: RPC 走 HTTP 往返(非全双工),对 InlineComplete 高频补全需防抖与取消;可接受。

### Decision: registry per-session + key 命名空间
- **Selected**: 在 `PiChat` 内为每会话创建 `createRendererRegistry()` 实例,注册 key 加 `extId:` 前缀;停用对模块级单例的隐式依赖。
- **Rationale**: 多 agent / 多会话共存时杜绝注册覆盖与全局副作用残留。
- **Trade-offs**: 现有直接调用 `registerToolRenderer`(单例)的宿主路径需保留兼容;以可选注入实现向后兼容。

### Decision: WebExtension 描述符为单一泛化入口
- **Selected**: `defineWebExtension()` 返回统一描述符,内含 `slots` / `renderers` / `contributions` / `config(theme/layout)` 四簇,Tier 1/2/3/5 都是它的字段;Tier 4 artifact 由描述符声明 surface 但运行在 iframe。
- **Rationale**: 泛化接口,Tier 之间是同一描述符的不同字段,避免多套注册 API。

## Risks & Mitigations
- 同源 bundle 无技术围栏 — 强制签名+白名单+CSP;高危内容入 artifact iframe。
- 运行时版本漂移 — manifest `targetApiVersion` 加载前校验 + CI 冒烟(全示例对当前 web-kit 加载)。
- bundle 自带 React 致 hook 崩溃 — build 工具强制 external + 产物校验拒绝内联副本。
- 实施范围庞大 — tasks 阶段按 Tier 分波次,先打通「加载器 + Tier 1/2/5 + 一个 Tier 3 贡献点 + RPC 总线」的 e2e 垂直切片,Tier 4 artifact 与 InlineComplete/签名硬化作为后续波次。

## References
- 项目内:`packages/ui/src/registry/renderer-registry.ts`、`packages/ui/src/chat/pi-chat.tsx`、`packages/protocol/src/transport/{sse-frame,rest-dto,ui-spec}.ts`、`packages/ui/src/components/sandbox-renderer.tsx`、`packages/agent-kit/src/index.ts`。
- 内存:`pi-web-pi-sdk-dev-external`(重型单例不可重复打包,同理用于 web-kit external)。
