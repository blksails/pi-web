# webext-layout-agent

**Tier 1 · 区域插槽**示例 —— 一个 source 自带 `.pi/web` 扩展,把宿主预留的区域插槽(`panelRight` / `headerCenter` 等)填上自定义 UI,无需改宿主一行代码。

## 它演示什么

| 能力 | API / 声明 | 前端表现(pi-web) |
|------|-----------|------------------|
| 右侧领域检视面板 | `slots.panelRight` | lg 断点显示在对话右侧的 `InfoPanel` |
| 头部三区 | `slots.headerLeft / headerCenter / headerRight` | 顶栏左/中/右合并渲染于 `[data-pi-ext-header]` |
| 底栏 | `slots.footer` | 对话底部固定条 |
| 右栏初始让位比例 | `config.panelRatio: "3:7"`(Tier5 声明) | 对话 30% / 面板 70%;右下角段控可在 居中 / 2:1 / 3:7 间动态切换 |

> 插槽内容是普通 React 节点,由 `defineWebExtension({ capabilities: ["slots", "config"], slots })` 声明。宿主 `pi-chat.tsx` 已为每个协议保留插槽接好 `SlotHost`,扩展只负责"填坑"。

## 运行

前端把 source 指向本目录即可:

```ts
usePiSession({ create: { source: "./examples/webext-layout-agent" } })
```

`model` 省略 → 继承 `~/.pi/agent/settings.json` 的默认 provider/model;凭据取自 `~/.pi/agent/auth.json`。

## 相关示例

- `webext-slots-agent` —— Tier1 协议保留插槽**全集** fixture(逐槽验收宿主让位点)
- `webext-background-agent` —— Tier1 `background` 背景层插槽(自定义动画背景)
- `webext-declarative-agent` —— Tier5 纯声明式 layout / theme(零代码)
