# 右侧栏(panelRight)隔离槽原理 — 简单直白版

> 面向:想给自己的 agent 加一块右栏面板、或想弄懂「扩展 UI 为什么崩不坏宿主」的人。
> 实况参照:`examples/aigc-agent`(AIGC 图像工作台),本文所有行号以当前仓库为准。

## 一句话

右侧栏是宿主(PiChat)预留的一个**具名插槽**(`panelRight`):agent 的 Web 扩展声明它,宿主负责挂载;
扩展组件被**错误边界**包着、只能通过宿主**递进来的 props** 干活——它崩了右栏消失,宿主与对话不受影响。

## 从声明到上屏(4 步)

```
examples/aigc-agent/.pi/web/web.config.tsx        ① agent 声明
  slots: { panelRight: AigcCanvasPanel }
        ↓
lib/app/webext-registry.ts                        ② 宿主找到扩展
  resolveExtensionForSource("./examples/aigc-agent")
  (构建期静态 import 车道;路径段尾匹配。仓库外的源走运行时 /api/webext/resolve 车道)
        ↓
packages/ui/src/chat/pi-chat.tsx:1898             ③ 宿主挂载
  <aside> 里 <SlotHost ext={extension} slot="panelRight" …注入能力对象 />
        ↓
packages/ui/src/web-ext/apply-extension.tsx:165   ④ 隔离渲染
  SlotHost:取贡献 → ExtErrorBoundary 包裹 → 实例化组件并递 props
```

## 「隔离」到底隔了什么(4 层)

| 层 | 机制 | 出处 |
|---|---|---|
| **崩溃隔离** | 扩展组件抛错被 `ExtErrorBoundary`(React 错误边界)接住,渲染 fallback(默认空),宿主内核与其它区域照常;可选 `onError` 上报 | `packages/ui/src/web-ext/ext-error-boundary.tsx` |
| **依赖隔离** | 能力全部经 **props 显式注入**,不用 React context——webext 可能是独立打包的 bundle,context 身份不跨 bundle;props 是唯一稳定通道。扩展拿不到没递给它的东西 | `apply-extension.tsx:81-83` 注释 |
| **命名空间隔离** | 扩展的工具/数据渲染器按 `extId`(manifestId)注册进 per-session registry,卸载时 `clearExtension(extId)` 一把清干净,不同扩展互不覆盖 | `apply-extension.tsx:27-45` |
| **缺席即回退** | 扩展没声明 `panelRight` → SlotHost 返回 fallback(整个 `<aside>` 都不渲染);扩展加载失败 → 宿主默认 UI。任何一环缺席都不是错误 | `apply-extension.tsx:181-182` |

一句话:**扩展在宿主的 React 树里,但活在"只进不出"的护栏内**——能力靠递,崩溃有兜底,卸载可清场。
(注意:这是**组件级**隔离,不是进程/origin 级。真正不受信的代码走 Tier4 artifact 的独立 origin
sandbox iframe,那是另一条车道。)

## 宿主递给 panelRight 的能力对象(props)

`SlotHost` 实例化你的组件时递这些(都可能是 undefined,须判空降级):

| prop | 是什么 | 典型用法 |
|---|---|---|
| `extId` | 你自己的 manifestId | 日志/存储命名空间 |
| `conversation` | 会话能力对象:`submitUserMessage(text, attachmentIds)` 把操作组装成用户消息发进对话流 | 画布上点「重绘」→ 发一条消息 → LLM 调 `image_edit` 执行,操作天然回流对话历史 |
| `surface` | agent 权威 surface 快照/命令通道。**panelRight 是唯一被注入 surface 的槽**(`pi-chat.tsx:840`) | 画廊 hydrate、`run("sync")` |
| `state` | 会话级共享 KV(状态注入桥),AI 与人共读写 | 面板与工具共享偏好 |
| `upload` + `baseUrl` + `sessionId` | 客户端文件直接落附件库,返回 `att_` id | 拖图上传 |
| `syncSignal` | 每轮对话结束时变化一次的信号 | 生图完成后画廊自动刷新 |
| `livePreviewImage` | 当前轮流式图像预览(由糊变清) | 生成中的渐进预览 |
| `extensions` | 已装载扩展描述符数组(宿主不解析,原样搬运) | 面板按需自取 |

## 布局行为(用户可见的部分)

- `config.panelRatio: "centered"` → 右栏**默认收起**、对话居中;右下角常驻切换器(居中 / 2:1 / 4:6 / 3:7)。
- 宿主也可传连续宽度(`panelWidth`)启用**拖拽分隔条**(aside 左缘),全受控。
- 视口窄于 lg(1024px)时整个 `<aside>` 隐藏——手机上没有右栏。

## 给自己的 agent 加一块右栏面板(最小示例)

```tsx
// your-agent/.pi/web/web.config.tsx
import { defineWebExtension } from "@blksails/pi-web-kit";

function MyPanel({ conversation }: { conversation?: { submitUserMessage(t: string): void } }) {
  return (
    <div style={{ padding: 12 }}>
      <button onClick={() => conversation?.submitUserMessage("你好,从右栏发的")}>
        发进对话
      </button>
    </div>
  );
}

export default defineWebExtension({
  manifestId: "my-panel",
  capabilities: ["slots"],
  slots: { panelRight: MyPanel as never },
});
```

要点:组件是**函数**就会被实例化并递能力 props;写成 ReactNode 则原样渲染(拿不到能力)。
仓库内的源还需在 `lib/app/webext-registry.ts` 登记(构建期车道);仓库外的源走运行时 resolve 车道。

## 实况验证(2026-07-21)

`server:3000`(dev 直跑需 `PI_WEB_KIT_VERSION=0.5.0`,jiti 无构建期 define)+ `vite:5173`,
源填 `./examples/aigc-agent`:空态「图像工作台」+ 起手式(config.empty)、输入框上方快捷 pill
(promptToolbar 槽)、右下角比例切换器,点 2:1 展开右栏画布(panelRight 槽)——三个槽位与
配置全部来自 agent 自带的 `.pi/web/web.config.tsx`,宿主零改动。
