# 17 · Canvas 插件开发

> 用一个扩展给 Canvas 工作台**加图层、加工具、加生成动作**——无需改宿主源码。本章面向**插件作者**,以 canonical 范例 [`examples/canvas-plugin-stickers`](../../examples/canvas-plugin-stickers/) 为主线,讲清 `defineCanvasLayer` / `defineCanvasTool` / `defineCanvasAction` 三件套、`registerPluginBundles` 的命名空间前缀与拓扑校验、前端与 agent 双端接线,以及依赖缺失时的禁用态语义。

面向**用户与集成方**的 Canvas 工作台本身(编辑器交互、六生成动作、画廊、`NEXT_PUBLIC_PI_WEB_CANVAS` 门控)见 [16 Canvas 工作台](./16-canvas-workbench.md);本章只讲「怎么给它写插件」。

## 17.1 心智模型:一个扩展,两条插件车道

Canvas 的可扩展面由独立发布的 L2 开发者面包 **`@blksails/pi-web-canvas-kit`** 承载。它的公开出口只暴露声明式 API 与类型,L1 交互内核(`kernel/` 下的 stage/pointer/history/layers/tool-runtime)刻意**不出口**(`packages/canvas-kit/src/index.ts:5-13` 的出口纪律注释)。作为插件作者,你只跟三件套 + 插件捆 + 装配门面打交道。

一个 Canvas 插件通常横跨两端:

| 端 | 贡献什么 | 声明入口 |
| --- | --- | --- |
| **前端插件捆** | 图层(怎么渲染/拍平/编辑)、工具(工具轨按钮 + 点击置层)、动作(生成决策候选) | `defineWebExtension({ canvasPlugins:[bundle] })` |
| **agent 侧命令** | 动作走「命令通道」时对应的处理器 + 能力白名单条目 | `makeCanvasSurfaceExtension({ commandDeps.extraCommands, extraActions })` |

纯前端插件(如一枚 emoji 贴纸图层)可以只贡献前端捆、不碰 agent;而「风格迁移」这类要落库、要调生成模型的动作,则前端声明动作 + agent 侧提供命令实现,经 Canvas 的 **命令通道**执行,**不过 LLM**。命令通道建立在 [04 Surface 权威表面栈](./04-surface-stack.md)之上(`domain = canvas`),本章把它当既有基础设施引用。

## 17.2 三件套契约

三个声明式定义函数都是**恒等函数 + 类型收窄**——只为让 TypeScript 帮你标注意图,运行时零副作用。全部从 `@blksails/pi-web-canvas-kit` 导入:

```ts
import { defineCanvasLayer, defineCanvasTool, defineCanvasAction } from "@blksails/pi-web-canvas-kit";
import type { ActionInput, CanvasPluginBundle } from "@blksails/pi-web-canvas-kit";
```

### 17.2.1 图层 `defineCanvasLayer<D>`

声明一种自定义图层类型:怎么渲染、怎么拍平、怎么在检查器里编辑。签名见 `packages/canvas-kit/src/layers-plugin.ts:36-51`。

```ts
// 摘自 examples/canvas-plugin-stickers/.pi/web/stickers.tsx:39
const stickerLayer = defineCanvasLayer<StickerData>({
  type: "sticker",                                   // 前缀化后 = "canvas-plugin-stickers:sticker"
  Render: ({ layer, scale }) => (                    // 舞台按图层位置呈现,随视口 scale 缩放
    <span style={{ fontSize: `${data.size * scale}px` }}>{data.emoji}</span>
  ),
  bake: (ctx2d, layer, size) => {                    // 拍平时把内容烤进 2D 上下文(可异步,如字体加载)
    ctx2d.font = `${data.size}px serif`;
    ctx2d.fillText(data.emoji, 0, size.h);
  },
  Inspector: ({ layer, update }) => (                // 选中时编辑;update 传【完整新 data 对象】进统一 undo 栈
    <input type="range" onChange={(e) => update({ ...data, size: Number(e.target.value) })} />
  ),
});
```

三个成员的契约(`layers-plugin.ts:39-47`):

- **`Render({ layer, scale })`** —— React 组件类型,舞台呈现,随视口 `scale` 缩放。
- **`bake(ctx2d, layer, size)`** —— 拍平回调,把图层内容烤进 2D 上下文;返回 `void | Promise<void>`,可异步。
- **`Inspector?({ layer, update })`** —— 可选检查器组件;`update` 接收**完整新 data 对象**,一次编辑即一次 undo 栈项。

泛型 `D` 是纯声明期文档参数(phantom):契约面 `update` 载荷在类型边界是 `unknown`,运行时由插件自行收窄(`layers-plugin.ts:16-20`)。既有图像图层(无 `kind` 的 `WorkLayer`)行为零变——未注册类型声明的图层照现状渲染/拍平。

### 17.2.2 工具 `defineCanvasTool`

声明一个工具轨按钮及其手势行为。签名与全部可选字段见 `packages/canvas-kit/src/registry.ts:121-160`。贴纸工具只用了「点击置层」这一声明式 seam:

```ts
// 摘自 stickers.tsx:101
const stickerTool = defineCanvasTool({
  id: "sticker",                                     // 前缀化后 = "canvas-plugin-stickers:sticker"
  label: "贴纸",
  icon: "🌟",
  overlayInteractive: true,                          // 手势面接管 overlay 命中
  createLayer: { kind: "sticker", data: { emoji: "🌟", size: 64 } },
});
```

`createLayer`(`registry.ts:134-141`)是声明式「点击置层」:工具激活期在舞台按下即放置一枚 `kind` 类型的插件图层(`data` 为初始私有数据)。**关键封装线**:工具上下文 `ctx.layers` 是**只读**面(`registry.ts:113`、`CanvasToolContext.layers: LayersReadApi`),放置写路径归装配层——**不要**在工具里 `ctx.layers.add`,`createLayer` 才是工具→装配层的意图传递。

需要自绘手势的工具还可实现 `onDown/onMove/onUp`(收到已换算为底图像素的语义化 `ToolGestureEvent`,`registry.ts:81-95`)、`rasterizeDraft`(overlay 实时预览)、`optionsBar` / `overlayReact`(选项条 / DOM 叠层)。工具零 DOM 监听、零视口数学、零栈管理——这些能力由 L1 内核经上下文转交。

### 17.2.3 动作 `defineCanvasAction`

动作参与 Canvas 生成栏的**评分制决策**:何时适用(`match`)、参数怎么构造(`buildArgs`)、走哪条执行通道(`execution`)。签名见 `packages/canvas-kit/src/actions.ts:59-72`。

```ts
// 摘自 stickers.tsx:114
const styleTransferAction = defineCanvasAction({
  id: "style-transfer",                              // 前缀化后 = "canvas-plugin-stickers:style-transfer"
  label: "风格迁移",
  match: (input: ActionInput) =>
    input.referenceIds.length === 1 &&
    input.prompt.startsWith("style:") &&
    input.capability.actions.includes("style_transfer")   // 白名单避让(退化安全)
      ? 85
      : false,
  buildArgs: (input) => ({
    image: input.imageId,
    style_ref: input.referenceIds[0],
    ...(input.model !== "" ? { model: input.model } : {}),
  }),
  execution: { via: "command", command: "style_transfer" },   // command 名【不】被前缀化
});
```

契约要点:

- **`match(input): number | false`** —— 纯函数,`false` 表不适用,数值越大越优先,同分取注册序先者(`actions.ts:62-63`)。`ActionInput` 字段见 `actions.ts:40-50`(imageId/prompt/model/size/variants/hasMask/hasExpand/referenceIds/capability)。
- **`buildArgs(input)`** —— 纯函数,构造命令/op 参数;不含二进制,资产 `att_` 由调用方编排后补充。
- **`execution`** —— 二选一:
  - `{ via: "prompt", buildOp(args, input) }` —— 组装 op 走对话流(prompt)通道;
  - `{ via: "command", command }` —— 走命令通道,`command` 名**必须落在 `capability.actions` 白名单内**,否则被决策器 `resolveAction` 先行排除(`actions.ts:100-123` 的 `resolveAction`:`via:"command"` 且 `command ∉ input.capability.actions` 的动作在 `match` 之前就被剔除,`actions.ts:110`)。

范例用 `capability.actions.includes("style_transfer")` 在 `match` 里显式避让:非本范例 source(未声明该动作)时,能力白名单里没有 `style_transfer`,动作不参与决策,Canvas 照常退化。这是插件的**退化安全**范式。

## 17.3 插件捆 `CanvasPluginBundle`

三件套声明好后,打进一个插件捆一起注册。捆结构见 `packages/canvas-kit/src/layers-plugin.ts:70-76`:

```ts
// 摘自 stickers.tsx:135
export const stickersBundle: CanvasPluginBundle = {
  id: "stickers",
  requires: ["canvas-plugin-stickers:sticker"],   // 依赖名用【前缀化后】的全局名(作者写完整名)
  tools: [stickerTool],
  layers: [stickerLayer],
  actions: [styleTransferAction],
};
```

- **`id`** —— 捆标识,诊断归属用。
- **`requires?`** —— 该捆依赖的图层类型 / op kind,写**前缀化后的全局名**(不被自动前缀化,`layers-plugin.ts:72`)。范例声明依赖自带的 `canvas-plugin-stickers:sticker` 图层类型。
- **`tools` / `layers` / `actions`** —— 三件套集合。

## 17.4 `registerPluginBundles`:命名空间前缀 + 拓扑校验

装配层用 `registerPluginBundles(registry, bundles, { namespace })` 把捆接入 per-instance 注册表。实现见 `packages/canvas-kit/src/layers-plugin.ts:95-167`。作为插件作者不必自己调它(装配由 Canvas 工作台代劳,见 17.5),但必须理解它的两条规则:

### 命名空间前缀化

`namespace` 存在时,对捆内 `tools` / `layers` / `actions` 的 `id` / `type`,以及 `createLayer.kind`,统一施加 `<namespace>:` 前缀(`layers-plugin.ts:100-128`)。**你写本地名,系统加前缀**:

| 你在捆里写 | 前缀化后(namespace = `canvas-plugin-stickers`) |
| --- | --- |
| layer `type: "sticker"` | `canvas-plugin-stickers:sticker` |
| tool `id: "sticker"` + `createLayer.kind: "sticker"` | 二者都成 `canvas-plugin-stickers:sticker`,一致命中 |
| action `id: "style-transfer"` | `canvas-plugin-stickers:style-transfer` |

两个**例外**,作者必须写全局名/原名:

1. **`requires`** —— 不被前缀化,写前缀化后的全局名(所以范例写 `"canvas-plugin-stickers:sticker"`)。
2. **`execution.command`** —— 命令名不被前缀化(`layers-plugin.ts:105-106` 与范例注释),必须与 agent 侧 `extraCommands` 键、`capability.actions` 白名单条目**逐字一致**(范例三处都是 `"style_transfer"`)。

### requires 拓扑校验与禁用态语义

注册顺序是:先注册全部捆的 `layers`,再构建可用依赖集(= 已注册 layer type ∪ 内置 op kind `stroke`/`anno` ∪ 各捆自带 layers 的 type,`layers-plugin.ts:138-140`),然后逐捆校验 `requires`(`layers-plugin.ts:143-158`):

- **依赖全满足** → 注册该捆 `tools` 与 `actions`(正常接入)。
- **有依赖缺失** → 该捆的 `tools` **仍注册进工具轨但登记为禁用态**(`registerDisabledPluginTool`,`registry.ts:295-299`):UI 上置灰 + tooltip 显示缺失项;`actions` **不注册**(不参与决策);`layers` 已在前一步注册(渲染契约在,只是缺少创建它的工具)。同时追加一条 `kind:"plugin"` 诊断。

换言之,**依赖缺失不会让插件消失或崩溃,而是优雅降级为置灰工具 + 诊断**。同 `id`/`type` 冲突由底层 `registerTool`/`registerLayer`/`registerAction` 拒绝(先注册者保持,后者被拒并记诊断,`registry.ts:235-294`),绝不覆盖内置。

## 17.5 双端接线

### 前端:车道① `canvasPlugins`

前端插件捆经 `defineWebExtension` 的 `canvasPlugins` 字段声明(`packages/web-kit/src/define-web-extension.ts:112`)。范例的 UI 扩展配置:

```tsx
// examples/canvas-plugin-stickers/.pi/web/web.config.tsx:16
import { defineWebExtension } from "@blksails/pi-web-kit";
import { CanvasLauncher, CanvasPanel, AigcQuickSettings } from "@blksails/pi-web-canvas-ui";
import { stickersBundle } from "./stickers";

export default defineWebExtension({
  manifestId: "canvas-plugin-stickers",
  capabilities: ["slots"],
  config: { panelRatio: "4:6", logsPanelPosition: "bottom" },
  slots: {
    launcherRail: CanvasLauncher as never,
    panelRight: CanvasPanel as never,
    promptToolbar: AigcQuickSettings as never,
  },
  canvasPlugins: [stickersBundle],   // 车道①:source 自带 canvas 插件捆
});
```

接线链路(宿主对 Canvas 领域中立,只搬运不解析):

1. 宿主(pi-chat)把已装载扩展描述符整体经 SlotHost 搬进 `CanvasPanel`。
2. `collectCanvasPluginBundles(extensions)`(`packages/canvas-ui/src/plugin-aggregation.ts:38-51`)提取各扩展的 `canvasPlugins`,附来源命名空间 `namespace = manifestId`;无声明或空数组的扩展被剔除。
3. `CanvasWorkbench` 在内置工具/动作注册后,逐来源调 `registerPluginBundles(k.registry, bundles, { namespace })`(`packages/canvas-ui/src/canvas-workbench.tsx:643-644`),施加前缀 + 拓扑校验。

所以你的 `manifestId` 就是命名空间——范例 `manifestId: "canvas-plugin-stickers"` 决定了前缀 `canvas-plugin-stickers:`。

> 除车道①(source 自带)外,已装包的 webext 也同以 `defineWebExtension` 形态被同一路径消费(车道②),对插件作者写法无差异。

### agent 侧:命令通道处理器

动作走 `via:"command"` 时,agent 侧要提供同名命令实现,并把命令名加入能力白名单。用 `makeCanvasSurfaceExtension` 的 `commandDeps.extraCommands` 与 `extraActions`(`packages/tool-kit/src/aigc/canvas/extension.ts:62-84`):

```ts
// examples/canvas-plugin-stickers/index.ts:99
import { aigcExtension, makeCanvasSurfaceExtension } from "@blksails/pi-web-tool-kit/runtime";

extensions: [
  aigcExtension,
  (pi) => {
    makeCanvasSurfaceExtension({
      commandDeps: { extraCommands: { style_transfer: styleTransfer } },  // 命令处理器
      extraActions: ["style_transfer"],                                    // 并入 capability.actions 白名单
    })(pi);
  },
],
```

- `extraCommands`(`commands.ts:54`)注入命令处理器,与 A 档六个内置命令合并(`commands.ts:252`)。
- `extraActions`(`capability.ts:57,74-77`)按首现序并入 capability 的 `actions` 白名单(A 档六命令之后,去重保序)。前端 `resolveAction` 正是靠这份白名单放行/避让 command 动作,形成**双端一致的白名单闭环**。

范例的 `style_transfer` 命令并不重造血缘/落库编排,而是**复用内置 `reference` 命令**(`createCanvasCommands()`)执行 `runImageTool` 并落库(`index.ts:52,72-84`)——插件作者应优先复用内置命令而非重写生成/落库链路。

## 17.6 上手:跑通贴纸插件

范例是一个可直接选用的 agent source。前置:已按 [01 快速开始](./01-quickstart.md)装好依赖。

1. **开启 Canvas 门控**(默认关闭)。Canvas 工作台由 `NEXT_PUBLIC_PI_WEB_CANVAS` 门控,取 `true`/`1` 启用:

   ```bash
   NEXT_PUBLIC_PI_WEB_CANVAS=1 pnpm dev
   ```

   `pnpm dev` 并发拉起 API(`:3000`)与 Vite dev server(`:5173`)。**预期**:终端显示两个进程就绪。门控详情见 [16 Canvas 工作台](./16-canvas-workbench.md) 与 [06 配置参考](./06-configuration.md)。

2. **打开前端并选源**。浏览器打开 `http://localhost:5173`(`/api` 由 Vite 代理到 3000),在选源页选择 **「Canvas 插件 · 贴纸」**(`examples/canvas-plugin-stickers/package.json` 的 `pi-web.title`)。**预期**:进入对话/Canvas 分栏布局(默认对话 40% / Canvas 60%)。

3. **验证前端插件捆生效**。展开 Canvas 工作台的工具轨。**预期**:除内置绘制工具外,多出一枚 🌟「贴纸」工具。点选它,在舞台上按下——放置一枚 emoji 贴纸图层;选中该图层,右侧检查器出现 emoji 调色板 + 尺寸滑杆(DOM 锚点 `data-sticker-emoji-pick` / `data-sticker-size-range`,见 `stickers.tsx:74,86`)。

4. **验证命令通道动作(双端)**。让 agent 先生成或上传一张图落进画廊,再拖入一张参考图;在生成栏输入以 `style:` 起头的提示词。**预期**:因 agent 侧声明了 `extraActions:["style_transfer"]`,能力白名单含该动作,「风格迁移」动作在恰一张参考图时以 85 分命中,经命令通道执行(不过 LLM),结果落库。若换一个未声明 `style_transfer` 的 source,该动作不参与决策,Canvas 照常退化(退化安全)。

5. **验证禁用态语义(可选)**。若把 `stickersBundle.requires` 改成一个不存在的类型(如 `["canvas-plugin-stickers:missing"]`)重跑,贴纸工具仍出现在工具轨但**置灰**,tooltip 显示缺失依赖;贴纸动作不注册。这正是 17.4 描述的降级路径。

## 17.7 L1 交互内核(`createCanvasKernel`)

前面的插件作者面属 **L2**。它之下是 **L1 交互内核**:舞台视口/指针路由/编辑历史/图层树/工具运行时的实例装配,由 `createCanvasKernel(env)` 收口为**单一装配 API**(`packages/canvas-kit/src/kernel-facade.ts:146`)。它返回的 `CanvasKernel` 暴露 `stage` / `history` / `opBehaviors` / `layers` / `registry` / `prefs` / `tools` / `pointer` / `renderOverlay`(`kernel-facade.ts:113-143`)。

Canvas 工作台自身正是这样装配的(`canvas-workbench.tsx:624-645`):`createCanvasKernel({...})` → `registerBuiltinTools(k.registry)` → `registerBuiltinGenerateActions(k.registry)` → 逐来源 `registerPluginBundles`。**多画布实例互不串扰**——注册表与内核都是 per-instance(`registry.ts:223`、`kernel-facade.ts:113`)。

作为插件作者,你通常**不直接调 `createCanvasKernel`**——它是集成方/宿主的装配门面。这里点出它,是为了说明封装纪律:

> `kernel/` 下的 stage/pointer/history/layers/tool-runtime 内部件**不在公开出口**(`packages/canvas-kit/src/index.ts:5-13`)。L1 可自由重构而不构成破坏性变更;插件只依赖 L2 的 `define*` / 类型 / `createCanvasKernel` 门面这一 semver 承诺面。反向依赖被禁(canvas-kit 零 `@blksails/*` 运行时依赖)。

只有当你要**内嵌一个独立于 Canvas 工作台的画布**(自建宿主而非写 source 插件)时,才会直接消费 `createCanvasKernel`。此时你注入 `CanvasKernelEnv`(`getRect` / `getNaturalSize` / `capturePointer` / `initialPrefs`,`kernel-facade.ts:76-93`),DOM 量取与 pointer capture 接缝由你实现,内核本身零 DOM 依赖。

## 相关链接

- [16 Canvas 工作台](./16-canvas-workbench.md) —— 用户/集成方视角:编辑器交互、六生成动作、画廊、`NEXT_PUBLIC_PI_WEB_CANVAS` 门控。
- [04 Surface 权威表面栈](./04-surface-stack.md) —— 命令通道(`domain = canvas`)所建立的 CQRS 通信基础设施。
- [12 Web UI 扩展](./12-web-ui-extension.md) —— `defineWebExtension`、插槽模型与 `canvasPlugins` 车道的宿主机制。
- [05 分层包](./05-packages.md) —— `@blksails/pi-web-canvas-kit` / `-canvas-ui` 在 11 包体系中的位置与依赖方向。
- [06 配置参考](./06-configuration.md) —— `NEXT_PUBLIC_PI_WEB_CANVAS` 门控与相关环境变量。
- [11 AIGC 与视觉工具](./11-aigc-and-vision-tools.md) —— 内置 `reference` 等生成命令与 `runImageTool`(插件命令常复用的落库链路)。
- 遇到问题?见 [23 故障排查 / FAQ](./23-troubleshooting-faq.md)。
