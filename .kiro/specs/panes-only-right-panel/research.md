# Research Log — panes-only-right-panel

Discovery 类型:**light(现有系统扩展)**。全部结论为实地勘察所得,来源逐条标注。
本轮的核心收获是**两项对 brief 判断的修正**(I3 / I4),它们直接改变了工作量分布。

## 调查记录

### I1 · 共享状态与既有 `pane:surface` 结构同构

- **来源**:`packages/web-kit/src/state-access.ts`、`packages/panes-kit/src/react/panes-host.tsx:344`
- **发现**:`WebExtStateAccess` 是四操作 —— `get(key)` / `subscribe(key,cb)` / `set(key,v)` /
  `delete(key)`,底层是前端 ControlStore 的读订阅 + `client.setState` 的写。
  而 pane 既有的 `pane:surface` 已经是「宿主按 `capabilities.surfaceKeys` 逐键读+订阅+推送」
  这一模式的完整实现(`bindSurface`)。
- **影响**:读与订阅**不必另发明**,逐字镜像 `bindSurface` 即可;真正新增的只有**写回**
  (一个新的上行 operation)。授权也同构:`surfaceKeys` → 读授权键表,写授权另立一张表。

### I2 · ★ `bindSurface` 的重绑教训同样适用于共享状态(有前科)

- **来源**:`packages/panes-kit/src/react/panes-host.tsx:330-352` 的整段注释
- **发现**:`surface` **不是恒等对象** —— 宿主的访问器由 `useMemo` 依赖会话连接/命令表构造,
  就绪握手与控制流重开都会换出新实例,而新实例读的是**新的** store。建连那一刻绑定的订阅
  会挂在旧 store 上,此后永不触发。症状是「pane 起来了、能力也对,但快照永远是空的」,
  且极易被误判成 agent 没发数据。既有实现的对策是:`surface` 换身份 → 所有在世连接**整组重绑**,
  且重绑时**立即重推当前值**(覆盖「建连早于首帧数据」的竞态)。
- **影响**:共享状态访问器同样由宿主 `useMemo` 构造,同样会换身份。新通道**必须复制这套重绑
  语义**,否则会原样重蹈。这是设计中不可省略的一条,不是优化项。

### I3 · ★★ pane 文档是构建期自足 IIFE,React 在 iframe 内跑 —— 插件不需要跨 realm 传组件

- **来源**:`examples/aigc-canvas-agent/build.ts`(esbuild 打 `web/panes/canvas.tsx` 成自足
  IIFE + 内联 Tailwind CSS → HTML → `pane-documents.generated.ts`,构建完即删)
- **发现**:pane 文档里**已经跑着完整的 React + canvas-ui + canvas-kit**。它不是一个「瘦壳等
  宿主投喂组件」的容器。
- **★ 这推翻了 brief 的判断**。brief 写「canvas 插件车道定义上是宿主 realm React 组件,
  要它上 pane 必须先建 guest 侧插件车道,体量接近一个独立 spec」——**不成立**。
  插件的正确形态是**在构建期与 pane 文档一起打包**,在 iframe 内用既有的
  `registerPluginBundles` 注册。既不需要新协议,也不需要运行时跨 realm 传递组件。
- **影响**:本波最大单点被大幅降级。真实工作变成「让贡献插件的 source 拥有自己的 pane 文档
  构建」,而不是「发明一条车道」。`lib/app/webext-registry.ts` 里「运行时车道无法承载组件」
  那条注释仍然正确,但它约束的是**运行时 resolve 车道**,与构建期打包无关 —— brief 把两者
  混为一谈了。

### I4 · ★ surface 相关能力 pane 已全部具备,`surface-demo` 迁移无需新协议

- **来源**:`packages/panes-kit/src/guest.ts:121-131`、`examples/surface-demo-agent/.pi/web/web.config.tsx`
- **发现**:该示例用的是 `surface.getState` / `surface.subscribe` / `surface.run` /
  `surface.hasCommand` 四件套,而 guest SDK **四个全有**(`run` 经 `surface.run` 上行 +
  `surfaceCommands` 授权;`getState`/`subscribe` 经 `pane:surface` 下行;`hasCommand` 由
  grants 本地判定)。
- **影响**:brief 把它估为「中高」,实际是「中」——纯 UI 改写,零协议工作。

### I5 · 主题:宿主有权威状态,示例是因为拿不到才自己观察 DOM

- **来源**:`packages/ui/src/theme/theme-provider.tsx:91` 的 `useTheme`;
  `examples/aigc-canvas-agent/web/web.config.tsx` 的 `useHostSignals`
- **发现**:宿主有 `useTheme` 权威状态。示例之所以挂 `MutationObserver` 观察
  `documentElement.classList`,是因为它是**独立打包的 bundle**,拿不到宿主的 React context ——
  注释里明说「主题类由宿主在任意时刻改写,没有事件可订阅,只能观察 class 属性」。
- **影响**:内置化是把一个**因隔离而生的 workaround** 换成正路,不是新增负担。

### I6 · ★ 焦点事件的判定已是领域中立的,但有一个 last-value 去重陷阱

- **来源**:同上 `useHostSignals` 第二个 effect
- **发现**:判定条件是 `img[data-att-id]` 且位于 `[data-pi-tool-images]` 内 ——
  **两个 data 属性都是宿主的**(附件系统 + 工具卡),不含任何领域词汇。故领域中立化是自然的,
  不需要重新定义语义。
- **★ 陷阱**:`pane:signal` 是「最后值即真值」,值不变就不重推。示例为此给值附了递增序号,
  否则**同一张图连点两次,第二次无效**。宿主内置化该信号时必须保留这条语义。
- **另一项发现**:示例还往宿主 `document.body` 上打了一个「悬浮态可点」的样式钩子属性 ——
  说明这条交互的**样式一半在宿主 realm**。该属性名含领域词,内置化时须一并中立化。

### I7 · 保留槽共 19 个,`panelRight` 只是其一

- **来源**:`packages/web-kit/src/slots.ts`(19 个 key);`e2e/browser/webext-full.e2e.ts`
  (断言「12 个协议保留插槽全部渲染」)
- **影响**:证实 requirements 的 Requirement 6 边界正确 —— 本特性只废一个槽。槽车道夹具
  改挂其余任一保留槽即可继续守其保护面。

### I8 · `state-bridge` 是唯一真缺口

- **来源**:`examples/state-bridge-agent/.pi/web/web.config.tsx`
- **发现**:该示例用 `state.get` / `state.subscribe` / `state.set` —— **写回**是关键,
  它演示的正是「人在面板上点 +1 → agent 工具下次读到新值」这条人机共驾闭环。
  单向的 `pane:signal` 结构上无法承载。
- **影响**:Requirement 2 的存在有唯一且明确的驱动者。

## 综合(Synthesis)

### 泛化(Generalization)

- **pane 文档的构建应抽成可复用构建函数**。`aigc-canvas` 与 `canvas-plugin-stickers` 迁移后
  都需要「canvas-ui + 自选插件集 → 自足 IIFE + 内联 CSS → HTML」这同一条流水线,差别只在
  插件集。各抄一份 `build.ts` 是可预见的漂移源(两份 CSP、两份 Tailwind content 配置)。
- **宿主环境信息应作为一族具名信号统一供给**,而非逐个特判。主题与焦点事件是首两项,
  下游内置 pane 会需要更多。

### 采纳而非新建(Build vs. Adopt)

- **共享状态通道采纳 `pane:surface` 的既有形态**(逐键授权 + 宿主侧 bind/重绑 + 下行推送),
  只增写回上行。理由:两者的问题形状完全相同,而既有实现已经踩平了重绑与首帧竞态两个坑(I2)。
- **插件采纳既有的 `registerPluginBundles`**,只是注册地点从宿主 realm 移进 pane 文档内(I3)。

### 简化(Simplification)

- **取消「guest 侧插件车道」这一独立工作项**(I3)。它在 brief 里被估为本波最大单点,
  实测不成立。
- **`surface-demo` 降级为纯 UI 改写**(I4)。
- 由此,九个声明者里真正需要**新能力**的只有一个(`state-bridge`,I8);其余是 UI 改写与
  构建配置。

## 风险

| 风险 | 说明 | 缓解 |
|------|------|------|
| **共享状态重绑漏做** | 症状是「pane 起来了但值永远空」,极易误判为 agent 没发数据(I2 有前科) | 设计强制复制重绑语义;验收须包含「访问器换身份后仍收到更新」的独立断言 |
| **焦点信号连点失效** | last-value 去重导致同一目标第二次点击无效(I6) | 内置信号须自带去重规避语义;验收须有「连点两次」用例 |
| **迁移中删断言换绿** | 本波最大的假绿来源 | Requirement 5.2/5.3 已成硬约束;每个迁移任务须逐条列出「原断言 → 新断言」的对应 |
| **跨边界行为静默降级** | 如轮末自动同步断链,表现只是「没刷新」(既有前科) | Requirement 5.4 要求独立断言直接检查结果,不接受「数元素个数」 |
| **两份 pane 构建漂移** | 见泛化 | 抽公共构建函数 |
| **存量红被误算** | `attachment-tool-bridge`×1 + `desktop-cloud-login`×5 已实测为基线失败 | Requirement 5.6 双向堵死:不得算作回归,也不得作为放宽理由 |
