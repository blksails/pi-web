# Research Log — host-builtin-panes

Discovery 档位:**light**(对现有系统的扩展,无新依赖 → 技术验证环节不适用,全程 inline 勘察)。

## Discovery Scope

聚焦三件事:① panes 今天的装载路径与其启用判据;② 宿主要装载时需要复现哪些注入;
③ 内置 pane 的文档形态在五种部署形态下的可行性。

## Investigations

### I1 · 右侧面板的启用判据(决定了 spec 范围)

| 位置 | 发现 |
|------|------|
| `packages/ui/src/chat/pi-chat.tsx:1290` | `hasPanelRight = extension?.slots?.panelRight !== undefined` |
| `packages/ui/src/chat/pi-chat.tsx:902` | `hasSurfacePanel` 同判据,控制**空闲控制流**是否开启 |
| `packages/ui/src/chat/pi-chat.tsx:1293-1305` | `panelRatioActive` / `showPanelRight` / `showAside` / `resizablePanel` 全部由它派生 |
| `components/chat-app.tsx:654` | 外层容器有一份同名判据,与内层各自计算 |

**Implication**:判据不成立时缺的不只是 pane,而是面板容器、开关、连续宽度、比例切换器、
agent 状态注入与空闲控制流**整套**。→ requirements 的 Introduction 据此把范围写宽,
不是「补一份默认 pane 列表」。

**★ 风险**:`hasSurfacePanel` 漏改会表现为「pane 起来了、能力也对,但 agent 快照永不更新」——
与 Wave 5 记录的 `bindSurface` 缺陷同一症状族,极易误判为 agent 没发快照。

### I2 · slot 的实际注入面远宽于其类型声明

- `packages/web-kit/src/define-web-extension.ts:19-21`:`SlotRenderProps` 只声明 `{ extId }`。
- `packages/ui/src/web-ext/apply-extension.tsx:165-204`:`SlotHost` 实际注入
  `state / surface / upload / baseUrl / sessionId / syncSignal / onSubmitPrompt /
  livePreviewImage / conversation / extensions`。
- `examples/panes-agent/web/web.config.tsx:36`:agent 靠 `{...props}` 整体展开转给 `PanesHost`。

**Implication**:宿主装载点必须复用同一批注入,且「注入等价性」值得一条专门的集成测试 ——
少一项就是一个静默失效面。

### I3 · agent 的 pane 定义对宿主不可见

agent 的 `panesDefinition` 定义在其 webext bundle 内、只被自己的槽渲染器闭包引用。
`WebExtension` 契约(`define-web-extension.ts:126-148`)有 `slots / renderers / contributions /
config / artifact / capabilities / settingsWidgets / canvasPlugins`,**无 panes 键**。

**Decision**:必须新增 `panes` 声明键。先例是 `canvasPlugins`(`:143-147`,原文即
「宿主对其领域中立,只整体搬运,不解析内容」)—— 同一形态照抄,不新发明机制。

### I4 · `definePanes` 已覆盖全部结构校验

`packages/panes-kit/src/contract.ts:188-211`:pane 标识唯一、`allowMultiple`/`maxInstances`
一致性、初始 pane 存在性、单 pane 实例上限、初始数不超 `maxOpenPanes`。

**Decision(build-vs-adopt)**:合并函数**不自建**结构校验,合并结果过一遍 `definePanes` 即
满足需求 2.3 全部约束。自建第二套必然与它漂移。

### I5 · pane 文档形态与部署形态的关系

- 契约仅两形态(`contract.ts:34-38`):内联 `srcDoc` / `html` 的 `src`;
  渲染在 `panes-host.tsx:539-540`,共用同一 `<iframe sandbox="allow-scripts">`。
- `sandbox` 不含 `allow-same-origin` → 两形态都是 opaque origin,隔离性等价。
- **生产 CSP 已放行**:`server/static.ts:190` 含 `frame-src 'self' blob: data:` ——
  故 `html` 形态在生产**可行**,这是核实过的事实而非假设。
- vite 当前**单入口**(`vite.config.ts:67-72` 无 `rollupOptions.input`),走 `html` 形态需加多入口。

**Decision(D1)**:仍选**内联 `srcDoc`**。`html` 形态引入「宿主静态资源路径在 dev /
standalone / desktop / 云端 / e2b 沙箱五形态下都正确」这一前提,而该类前提在本仓有前科
(runner bootstrap 路径五形态解析、内置扩展解析根随包走导致内置扩展静默不可用)。
srcDoc 零网络零路由、形态无关,且与 `examples/*/build.ts` 同构。契约支持两形态,
将来大体积 pane 可单独切换 —— 已列入 Revalidation Triggers。

### I6 · 会话信息没有现成的 guest 取数通道

五种 guest operation(surface.run / attachment.put / conversation.submit / event.publish /
route query)都不含「读会话信息」。

**Decision(D4)**:走 `pane:signal`。该原语的文件内注释原文即「搬运**只存在于宿主 realm**
的东西 —— 主题类、宿主 chrome 上的点击、轮次边沿」,语义为最后值即真值、新连接重推全部当前值。
会话信息正属此类,零新增契约。

**附带发现**:`pane:signal` 与 main 的 `pane:event` 是**两条不同原语**(前者宿主→pane 的具名
状态值、后者 pane↔pane 的代理事件流带 source),本波次合并 main 时曾在此处冲突,已判定共存。

## Design Decisions(synthesis 产出)

### Generalization

需求 1.x / 2.x / 5.x 表面是三件事,本质同一:**面板内容的来源从「单一 agent」变成「多来源合并」**。
→ 泛化接口为 `readonly PaneSource[] → PaneMergeResult`(数组,不是两个具名参数),
将来第三类来源(用户自定义 pane、插件包 pane)自然接入。**实现仍只处理两类来源** ——
泛化接口不泛化实现。

需求 3.x 不是独立机制,而是合并器的一条规则(保留命名空间判定)。

### Build vs. Adopt

| 关注点 | 决定 | 依据 |
|--------|------|------|
| 结构校验 | **Adopt** `definePanes` | I4 —— 已完整,自建必漂移 |
| 隔离 / 通信 / 授权 | **Adopt** panes-kit 全部既有能力 | 内置 pane 与第三方同构是需求 4.x/6.3 的要求 |
| pane 文档打包 | **Adopt** `examples/*/build.ts` 的 esbuild 内联模式 | 已有 `build:webext-examples` 脚本先例 |
| agent 声明键 | **Adopt** `canvasPlugins` 的领域中立搬运形态 | I3 |
| 来源合并规则 | **Build** `mergePaneSources` | 领域特有,无现成方案;纯函数可穷举单测 |

### Simplification

- **不建新包**:内置清单放 app 层目录即可。下游加 pane = 加文件 + 清单一行。
- **只加一个 prop**:`PiChat` 加 `hostPanes`(+ `paneSignals`),不加一串开关 —— 其余判据全部
  由它派生。
- **不建运行时注册表**:合并是纯函数调用,不是插件注册。
- **不迁移全部 example**:`panes-agent` 迁到新声明键(验合并),`aigc-canvas-agent` **刻意保留
  旧槽形态**作为需求 5.3 的回归守卫。若两个都迁,旧槽路径就再没有活的测试守着了。

## Risks & Mitigations

| 风险 | 影响 | 缓解 |
|------|------|------|
| ★ 判据改写触及空闲控制流开启条件 | agent 快照静默不更新 | 真实浏览器 e2e 为判据(7.3);注入等价性专项集成测试 |
| ★ 组件级测试全绿而真实浏览器全红 | 假达标 | Wave 5 已有前科(panes-kit 31/31 绿 / 4 套 e2e 全红);e2e 覆盖四种组合(7.4) |
| 「不应出现」类断言无判别力 | 「判据没装上」与「正确地没出现」观察上同形 | 每条此类断言须先证明其在缺陷存在时会报红(7.4) |
| srcDoc 产物入库 | 「本地绿是因为工作树里躺着没人生成的产物」 | 产物不入库,类型侧用 `.d.ts` 垫片;本仓已有三次前科 |
| 内层/外层判据不同步 | 外层容器与内层内容一个显示一个不显示 | `chat-app.tsx:654` 与 `pi-chat.tsx:1290` 须同批改并有测试 |
| 合并整体校验失败无法归因单一来源 | 诊断指错 | 由 `initialPaneIds` 合成规则(2.5)提前保证不越界,不依赖整体校验兜底 |

## Boundary Impacts

- 本 spec 是 `pane-host-capabilities` / `builtin-pane-suite` / `builtin-pane-browser` 三者的
  共同前置:它们都往 `BUILTIN_PANES` 清单里加项。
- **对 `pane-host-capabilities` 的关键前置**:保留命名空间使「agent 冒用内置 pane 身份」结构上
  不可能。文件读写能力将授予内置 pane 标识 —— 身份可冒用即等于权限可窃取。
- **须与 in-flight 分支对齐**:`isolated-panes` Wave 5(任务 6.1/6.2/6.3)仍未勾,
  本工作树所在分支 `feat/aigc-canvas-panes-migration` 正在改同一批装载相关文件。
  刻意不动 `aigc-canvas-agent` 也同时降低了这一撞车风险。
