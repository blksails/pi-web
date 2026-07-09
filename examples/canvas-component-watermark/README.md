# canvas-component-watermark — 水印组件包(kind:"component" 范例)

首个 **源码组件车道**(shadcn 式)范例:以源码交付的 Canvas 水印组件,经 `pi-web add`
拷进你的 agent source,代码归你所有、可自由修改。设计与准入标准见
[docs/component-installer-design.md](../../docs/component-installer-design.md)。

## 提供什么

| 工件 | 说明 |
|---|---|
| `watermarkLayer` | 文本水印图层:Render 随视口缩放 / bake 拍平烤字(原语缺省退化)/ Inspector 透明度滑杆 |
| `watermarkTool` | 水印工具:`createLayer` 声明式点击置层 |
| `watermarkAction` | 批量水印动作:`via:"command"` 走 `watermark_apply` 命令,**能力白名单避让**(装进任意无关 source 不产生死按钮) |
| `watermarkBundle` | 以上三件的 `CanvasPluginBundle`(接线用导出) |

## 安装与接线

```bash
pi-web add ./examples/canvas-component-watermark --target <你的 agent source> --dry-run  # 先预演
pi-web add ./examples/canvas-component-watermark --target <你的 agent source>
```

按打印的接线指引,在你的 `.pi/web/web.config.tsx` 中:

```tsx
import { watermarkBundle } from "./components/watermark/watermark";
// defineWebExtension({ ... }) 内:
canvasPlugins: [watermarkBundle],
```

然后 `pi-web build` 编译生效。重复 `add` 具备幂等更新语义:未改覆盖新版 / 已改打印
diff 拒绝 / 同版不写。

## 组件作者须知(照抄本包发布你自己的组件)

- 清单 `pi-web.json`:`kind:"component"` + `component.{files,wiring,peer}`;`files` 必含
  测试文件;`target` 省略(约定死为 `.pi/web/components/<id>/`)。
- 源码只 import `peer` 声明过的包与包内相对路径(准入 MUST)。
- 捆内 id/type/createLayer.kind 写**本地名**——命名空间前缀由宿主施加,组件不预知宿主
  manifestId,故捆应自含其图层类型、不声明 `requires`。

## SES 自检清单(组件适用子集,准入随附)

- [x] N1 命名:id 短横线小写(`canvas-watermark`);DOM 锚点 `data-watermark-text`(N5)
- [x] U2 退化契约:动作经 capability 白名单避让,装进任意无关 source 不崩、无死按钮(X3)
- [x] T4 接缝可注入:bake 的 ctx2d 原语判空降级;Render/Inspector 无 hooks 纯函数直测
- [x] 测试随源分发(`watermark.test.tsx` 在 `component.files` 内)
- [x] 依赖纪律:仅 import peer 声明的 `@blksails/pi-web-canvas-kit` 与相对路径
