# Design Document — web-ui-custom-rendering

## Overview

**Purpose**:为 pi-web 增加 server-driven UI 自定义渲染能力,让 pi agent 作者从后端声明富 UI,前端零配置渲染,且对不可信的 agent 输入保持安全。

**Users**:pi agent 作者(发结构化 UI 数据)、宿主集成者(挂 `<PiChat>` 即得)、宿主开发者(经注册表扩展自有组件)。

**Impact**:在 pi-web 自有传输契约层(`transport/*`)新增一个 `data-pi-ui` part,复用既有 SSE/transport/`useChat`/`PartRenderer`/`RendererRegistry` 管线;在 `@blksails/ui` 新增内置组件库 + 组件注册表 + 沙箱解释器 + part 渲染器。**不新增传输机制,不改 pi 原生 `extension-ui.ts`。**

### Goals
- agent 经单一 `data-pi-ui` part 声明 UI,前端零配置渲染。
- 「1+2 组合」信任模型:内置白名单组件(安全默认)+ 沙箱声明式组件(灵活)。
- 沙箱对不可信输入无代码执行 / 无 DOM 注入 / 无事件逃逸 / 无 CSS 注入 / 协议白名单 / 深度受限。
- 向后兼容:不破坏既有 4 类 data-part 与默认回退;宿主可扩展组件集。

### Non-Goals
- 交互式沙箱(事件回调/表单)——本期沙箱只读;交互走内置组件或 `extension-ui`。
- iframe/VM 隔离——以白名单解释器达成等价安全(见取舍)。
- 内置图表库——留给宿主扩展。

## Boundary Commitments

### This Spec Owns
- `protocol/src/transport/ui-spec.ts`:`UiSpec`/`UiNode`/`UiStyle` schema 与类型。
- `protocol/src/transport/data-part.ts`:新增 `UiDataPartSchema` 并入联合。
- `ui/src/components/*`:`ui-component-registry.ts`、`ui-tokens.ts`、`sandbox-renderer.tsx`、`builtin-components.tsx`。
- `ui/src/parts/pi-ui-part.tsx`:`data-pi-ui` 渲染器。
- `ui/src/chat/pi-chat.tsx`:自动注册 `data-pi-ui` 渲染器(增量,沿用 Sources 范式)。
- `ui/src/index.ts`、`protocol/src/index.ts`:导出新 API。
- **agent 产帧通道**:`protocol` 的 `PI_UI_TOOL_DETAILS_KEY` + `extractToolDetailsUiSpec`、`agent-kit` 的 `emitUi`、`server` `translate-event.ts` 对 `tool_execution_update` 的 data-pi-ui 识别。
- 上述行为的单元/e2e 测试。

### Out of Boundary
- pi 原生 `rpc/extension-ui.ts` 与其它 rpc/* 契约。
- 既有 4 类 data-part 的语义;`translate-event` 中**除 `tool_execution_update` 外**的产帧逻辑。
- 后端会话引擎 / agent runner 的运行机制(仅复用既有 `tool_execution_update` 事件,不改 pi SDK)。

### Allowed Dependencies
- 既有 `RendererRegistry`/`PartRenderer`/`DataPartRenderer` 契约。
- 既有 `Card` 原语、`cn`、shadcn CSS 变量主题。
- zod(协议层既有)、React、streamdown(不在沙箱内使用)。

### Revalidation Triggers
- `RendererRegistry`/`DataPartRenderer` 签名变化。
- `DataPartSchema` 判别字段或既有 data-part 结构变化。
- shadcn CSS 变量令牌集变化(影响 `ui-tokens` 映射)。

## Architecture

### 数据流(产帧通道 + 复用既有渲染管线)
```
agent 工具 execute(_id,_params,_signal, onUpdate)
  └─ emitUi(onUpdate, spec)                              [agent-kit]
        │  onUpdate({ content:[], details:{ [PI_UI_TOOL_DETAILS_KEY]: spec } })
        ▼  pi SDK 产出 tool_execution_update { partialResult }
  server translate-event(tool_execution_update)          [server]
        │  extractToolDetailsUiSpec(partialResult) 命中 → 产 data-pi-ui 帧
        │  (未命中 → 产 tool-output-available preliminary,喂同一工具卡)
        │   〔更新 2026-06-20:原回退为 data-pi-tool-partial,该 data-part 已移除〕
        ▼  既有: SSE /stream → PiTransport → decode-chunk → useChat → messages[]
  PartRenderer  ── data-* 分派 ──► registry.resolveDataPartRenderer("data-pi-ui")
        ▼
  PiUiPart (DataPartRenderer)
        │  渲染前 UiSpecSchema.safeParse 二次校验(纵深防御)
        ├─ kind:"builtin"  ► defaultUiComponentRegistry.resolve(component) ► 组件(props)
        │                     未命中 ► 占位回退
        └─ kind:"sandbox"  ► SandboxRenderer(root)
```
**产帧通道选型**:复用既有 `tool_execution_update`(其 `partialResult` 为开放 JSON)而非新开 RPC 旁路或改 pi SDK —— agent 在工具内经 `onUpdate` 即可发出 UI,零 pi SDK 改动。代价:`emitUi` 仅在工具执行期间有效(语义即「在工具里发 UI」)。

### 分层与既有架构对齐
- **协议层**:`UiSpec` 是 pi-web 自定义契约,置于 `transport/*`(与 pi 原生 `rpc/*` 分层);`data-pi-ui` 并入既有 `DataPartSchema` 判别联合。
- **渲染分派**:不改 `PartRenderer` 的纯分派逻辑;`data-pi-ui` 经 `RendererRegistry` 注册命中,未注册时自然回退到既有 `DefaultDataPart` JSON 预览。
- **注册时机**:`<PiChat>` 的 `useEffect` 注册 `data-pi-ui → PiUiPart`,与既有 `data-source(s) → SourcesDataPartRenderer` 完全同范式(幂等、覆盖语义)。

## Components and Interfaces

### 协议:`UiSpec`(`transport/ui-spec.ts`)
```
UiStyle = { tone?, size?, align?, weight?, gap?, pad? }   // 全部为令牌枚举,.strict()
UiNode  = 判别(el)联合,仅 box 递归承载 children:
  box | text | heading(level 1-3) | badge | divider
  | code(block?) | link(href:安全协议) | list | keyValue | table | image(src:安全协议)
UiSpec  = | { kind:"builtin", component, props?, title? }
          | { kind:"sandbox", root:UiNode, title? }
UiDataPart = { type:"data-pi-ui", data:UiSpec }
```
- `UiNodeSchema` 用 `z.lazy(() => z.discriminatedUnion("el", [...]))` 表达递归。
- `link.href` 经 `refine` 仅允许 `http/https/mailto`。

### UI:`UiComponentRegistry`(`components/ui-component-registry.ts`)
与既有 `RendererRegistry` 同构,键空间独立(组件名 → React 组件):
```
createUiComponentRegistry(): UiComponentRegistry
defaultUiComponentRegistry: UiComponentRegistry   // 模块级单例,预置内置组件
registerUiComponent(name, component)
interface UiComponentRegistry { registerUiComponent; resolveUiComponent; list; reset }
type UiComponent = ComponentType<{ props: Record<string, unknown> }>
```

### UI:内置组件库(`components/builtin-components.tsx`)
`metric`/`keyValue`/`table`/`alert`/`progress`/`card`/`codeBlock`,每个对 JSON props **容错提取**(`str`/`num`/`tone`/`cell` 助手,类型不符忽略)。经 `registerBuiltinUiComponents(registry)` 注入;默认单例在 `PiUiPart` 模块加载时 seed(幂等)。

### UI:沙箱解释器(`components/sandbox-renderer.tsx`)
`SandboxRenderer({ node })` 递归 `renderNode(node, key, depth)`:`switch(node.el)` 仅渲染白名单元素。详见「沙箱安全设计」。

### UI:part 渲染器(`parts/pi-ui-part.tsx`)
```
PiUiPart: DataPartRenderer = ({ part }) => {
  const parsed = UiSpecSchema.safeParse(part.data)   // 纵深防御
  if (!parsed.success) return <可读错误回退/>
  spec.kind==="builtin"
    ? (resolve(component) ? <Comp props/> : <未注册占位/>)
    : <SandboxRenderer node={spec.root}/>
  // 外层包 title 容器
}
```

### UI:接入(`chat/pi-chat.tsx`)
既有注册 Sources 的 `useEffect` 内追加:
```
registry.registerDataPartRenderer("data-pi-ui", PiUiPart)
```

## Security Design(沙箱组件——核心)

**取舍**:不采用 iframe/VM,而用 **白名单元素解释器**。原因:agent 输出经我们自有协议序列化为 **JSON 节点树**,其中**不存在可执行物**(无脚本、无表达式、无函数引用)。因此安全保证不靠运行时隔离,而靠"输入即数据 + 解释器只认白名单"。这比 iframe 更轻(无跨文档 postMessage、无样式/主题穿透成本),且攻击面更小(无 `srcdoc`/脚本上下文)。

逐项保证(对应 Req 4):
1. **无代码执行**(4.1):节点树是 zod 校验过的 JSON;解释器只做 `switch(el)` 映射,从不 `eval`/`new Function`/求值字符串。
2. **无 HTML 注入**(4.2):所有文本作为 `{node.text}` React 子节点渲染(自动转义);**全代码库该路径零 `dangerouslySetInnerHTML`**(streamdown 仅用于普通 text part,不在沙箱内)。
3. **无事件逃逸**(4.3):任何节点都不绑定 `onClick`/`onSubmit` 等;沙箱 UI 只读,无回调注入面。
4. **无 CSS 注入**(Req 3.3):样式仅来自 `UiStyle` 令牌枚举,经 `ui-tokens` 映射为**固定**类名串;agent 无法提供任意 `className`/`style`/`url()`。
5. **协议白名单**(4.5 / Req 3.4):`link.href`(仅 `http/https/mailto`)与 `image.src`(仅 `http/https/data:image`)在 schema(`refine`)与渲染(`isSafeHref`/`isSafeImageSrc`)**双重**校验;不合规降级(链接→纯文本、图片→alt 文本);外链强制 `rel="noopener noreferrer"`,图片 `loading="lazy"`。
6. **深度限制**(4.4):`renderNode` 携 `depth`,超 `MAX_DEPTH=12` 返回 `null`,防深层嵌套渲染 DoS。
7. **元素穷尽**(Req 3.2):schema `discriminatedUnion("el")` 在协议层拒绝未知元素,解释器 `default: return null` 再兜底(纵深防御)。

**信任边界**:内置组件 = 我们编写、可信;沙箱节点树 = agent 提供、不可信数据。两者都经 `PiUiPart` 渲染前再次 `safeParse`(即便传输层已校验),确保前端独立成立安全不变量。

## Data Models

见「协议:`UiSpec`」。要点:
- `UiStyle` 用 `.strict()` 拒绝额外字段。
- `props`(builtin)为 `z.record(z.unknown())`,形状校验下放给组件(容错)。
- `table.rows` 为 `string[][]`,`keyValue.rows` 为 `{key,value}[]`,均纯文本。

## Testing Strategy

- **协议单测**(`protocol/test/transport/ui-spec.test.ts`):builtin/sandbox 合法解析;非法 kind/el 拒绝;危险 href 拒绝;`UiStyle` 额外字段拒绝;`DataPartSchema` 含 `data-pi-ui` 且不破坏既有四类。
- **注册表单测**(`ui/test/components/ui-component-registry.test.ts`):注册/解析/覆盖/未命中/list/reset。
- **沙箱单测**(`ui/test/components/sandbox-renderer.test.tsx`):各元素渲染;无 `<script>`、无 `dangerouslySetInnerHTML` 标记;危险 href 降级为 span;深度截断;文本转义(注入字符串以文本出现)。
- **内置组件单测**(`ui/test/components/builtin-components.test.tsx`):正常渲染 + props 容错(错误类型不崩溃)。
- **分派单测**(扩展 `part-renderer.test.tsx`):`data-pi-ui`(builtin 命中/未命中、sandbox)经注册表分派。
- **e2e**(`ui/test/e2e/pi-ui.e2e.test.tsx`):`<PiChat>` 注入含 `data-pi-ui` 的消息,断言内置 metric 卡与 sandbox 表格渲染,且危险 href 不产出 `<a>`。

完成判据:worktree 内 `pnpm --filter @blksails/protocol test`、`pnpm --filter @blksails/ui test`、两包 `typecheck` 均以新鲜运行输出通过。
