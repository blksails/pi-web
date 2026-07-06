# canvas-plugin-stickers

Canvas **插件双端范例**(canvas-plugins-m3)——面向「插件作者」的 canonical 参照:**一个扩展**
同时贡献前端插件捆(图层/工具/动作)与 agent 侧命令,把两条 Canvas 插件车道走通。

在 [`aigc-canvas-agent`](../aigc-canvas-agent/) 的基础上加两样东西:一枚 **emoji 贴纸插件**(纯前端图层)
和一个 **风格迁移动作**(前端动作声明 + agent 侧命令实现,经 Canvas 命令通道执行,不过 LLM)。

## 双端结构

```
canvas-plugin-stickers/
├── index.ts                    # agent 侧:aigc-canvas surface + style_transfer 命令 / extraActions
└── .pi/web/
    ├── web.config.tsx          # UI 扩展:复用 Canvas 三槽 + canvasPlugins:[stickersBundle](车道①)
    └── stickers.tsx            # 前端插件捆:stickerLayer + stickerTool + styleTransferAction
```

- **前端插件捆**(`.pi/web/stickers.tsx`)经 `defineWebExtension({ canvasPlugins:[stickersBundle] })`
  声明。宿主领域中立地把扩展描述符搬进 CanvasPanel → `collectCanvasPluginBundles`(namespace =
  `manifestId`)→ CanvasWorkbench 的 `registerPluginBundles` 施加 `canvas-plugin-stickers:` 前缀与
  `requires` 拓扑校验后接入工具轨 / 图层渲染 / 动作决策。
- **agent 侧命令**(`index.ts`)经 `makeCanvasSurfaceExtension` 的 `commandDeps.extraCommands`
  注入 `style_transfer` 处理器,`extraActions:["style_transfer"]` 令能力清单可见该动作(前端据此
  在 `capability.actions` 白名单里放行该 command 动作)。

## 三件套契约(插件作者必读)

### 1. 图层插件 `defineCanvasLayer<D>`

```ts
const stickerLayer = defineCanvasLayer<StickerData>({
  type: "sticker",                                   // 前缀化后 = "canvas-plugin-stickers:sticker"
  Render: ({ layer, scale }) => <span style={{ fontSize: data.size * scale }}>{data.emoji}</span>,
  bake: (ctx2d, layer, size) => { ctx2d.font = …; ctx2d.fillText(data.emoji, 0, size.h); },
  Inspector: ({ layer, update }) => <input type="range" onChange={e => update({ ...data, size })} />,
});
```

- `Render({ layer, scale })`:舞台按图层位置呈现,随视口 `scale` 缩放。
- `bake(ctx2d, layer, size)`:拍平时把图层内容烤进 2D 上下文(可异步,如字体加载)。
- `Inspector({ layer, update })`:选中时编辑图层数据;`update` 传**完整新 data 对象**(进统一
  undo 栈)。

### 2. 工具「点击置层」`createLayer`

```ts
const stickerTool = defineCanvasTool({
  id: "sticker", label: "贴纸", icon: "🌟", overlayInteractive: true,
  createLayer: { kind: "sticker", data: { emoji: "🌟", size: 64 } },
});
```

`createLayer` 是声明式「点击置层」seam:工具激活期在舞台按下即放置一枚 `kind` 类型的插件图层。
工具上下文 `layers` **只读**(封装线),放置写路径归装配层——**不要**在工具里 `ctx.layers.add`。

### 3. 命令通道动作 `defineCanvasAction`

```ts
const styleTransferAction = defineCanvasAction({
  id: "style-transfer", label: "风格迁移",
  match: (i) => i.referenceIds.length === 1 && i.prompt.startsWith("style:")
    && i.capability.actions.includes("style_transfer") ? 85 : false,   // 白名单避让(退化安全)
  buildArgs: (i) => ({ image: i.imageId, style_ref: i.referenceIds[0], ...(i.model ? { model: i.model } : {}) }),
  execution: { via: "command", command: "style_transfer" },            // command 名不被前缀化
});
```

`match` 用 `capability.actions.includes(...)` 避让:非本范例 source(未声明 `style_transfer`)时该
动作不参与决策,Canvas 照常退化。`execution.command` **不**被命名空间前缀化——须与 agent 侧
`extraCommands` 键及 `capability.actions` 白名单条目一致(`"style_transfer"`)。

### 插件捆 `CanvasPluginBundle`

```ts
export const stickersBundle: CanvasPluginBundle = {
  id: "stickers",
  requires: ["canvas-plugin-stickers:sticker"],   // 前缀化后的全局名(作者写完整名)
  tools: [stickerTool], layers: [stickerLayer], actions: [styleTransferAction],
};
```

`registerPluginBundles` 对捆内 `tools/layers/actions` 的 `id/type` 与 `createLayer.kind` 施加
`<manifestId>:` 前缀(作者写本地名);`requires` 是**前缀化后**的全局名(不被自动前缀化)。
依赖缺失时该捆的工具注册为**禁用态**(置灰 + tooltip 显缺失项),动作不注册,图层类型不生效。

## 风格迁移命令(agent 侧)

`style_transfer` 是「参考图融合」的语义特化:args `{ image, style_ref, strength?, model? }` → 把
`style_ref` 作参考图、按 `strength` 生成风格化提示词 → **复用内置 `reference` 命令**(经
`createCanvasCommands`)执行 `runImageTool` 并落库 prepend(`derivedFrom = image`)。不重造血缘 /
落库编排(照 `commands.ts` 内置 handler 手法)。

## 门控

默认关闭。开启:

```bash
NEXT_PUBLIC_PI_WEB_CANVAS=1
```

非 AIGC source(无 `surface:canvas` 探针)→ 优雅退化;缺 `style_transfer` 白名单 → 风格迁移动作
不参与决策。贴纸图层为纯前端(不依赖 agent 能力),任意 source 装本插件捆即可用。
