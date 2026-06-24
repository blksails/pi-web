# webext-slots-agent

**Tier 1 · 协议保留插槽全集** fixture —— 一次声明全部协议保留插槽,逐槽验证宿主 `pi-chat.tsx` 是否已为每个让位点接好 `SlotHost`。每槽一个带 `data-testid` 的可见 fixture。

## 它演示什么

| 能力 | API / 声明 | 前端表现(pi-web) |
|------|-----------|------------------|
| 全部保留插槽 | `slots.{background, headerLeft/Center/Right, sidebarLeft, panelRight, toolbar, accessoryAboveEditor/BelowEditor/InlineLeft/InlineRight, empty, footer, notifications, statusBar, artifactSurface, promptInput, dialogLayer}` | 每个让位点渲染一块虚线小卡(`slot-<id>`) |
| 自定义空态 | `config.empty`(标题/副标题/starters) | 空屏 `EmptyState` 文案与建议项均来自声明式配置 |
| 建议项合并策略 | `config.empty.mergeCommands: "prepend"` | 配置建议项排在 agent slash 命令**之前** |
| 浏览器标签页标题 | `config.documentTitle` | 载入本 source 后 `document.title` 同步,切走自动还原 |

> `background` 槽渲染于 `absolute inset-0 -z-10`(消息层之下),容器只挂 `data-pi-chat-background`、不发 `data-pi-ext-*`,故 fixture 在左上角可见即证明该槽已接通。注意 Tier1 的 `empty` 槽(additive 的 "Ext Empty State")与 Tier5 声明式 `config.empty` 并存、不冲突。

## 运行

前端把 source 指向本目录即可:

```ts
usePiSession({ create: { source: "./examples/webext-slots-agent" } })
```

`model` 省略 → 继承 `~/.pi/agent/settings.json` 的默认 provider/model;凭据取自 `~/.pi/agent/auth.json`。

## 相关示例

- `webext-layout-agent` —— Tier1 区域插槽的最小可用子集(panelRight / headerCenter)
- `webext-background-agent` —— 聚焦 `background` 单槽的真实用法(动画背景)
- `webext-declarative-agent` —— Tier5 纯声明式 `config.empty` / theme(零代码)
