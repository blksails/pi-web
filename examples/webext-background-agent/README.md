# webext-background-agent

**Tier 1 · `background` 区域插槽**示例 —— 用 `background` 插槽给对话铺一层动画极光背景(scoped CSS,渲染于消息层之下、不拦截交互)。

## 它演示什么

| 能力 | API / 声明 | 前端表现(pi-web) |
|------|-----------|------------------|
| 自定义背景层 | `slots.background` | 宿主把它渲染在 `absolute inset-0 -z-10`,在消息层之下、`pointer-events: none` |
| 自命名空间 scoped CSS | 内联 `<style>`,类名 / `@keyframes` 均以 `pw-webext-background-` 前缀 | 三个模糊渐变光斑缓慢漂移,不污染宿主样式 |
| 对会话态反应 | 祖先属性选择器 `[data-pi-chat-empty="true\|false"]` | 空屏=静谧(低饱和、聚拢);交互后=鲜明(提亮、铺开、加一道居中辉光) |
| 减弱动效 | `@media (prefers-reduced-motion: reduce)` | 关闭漂移动画 |

> **注意:背景必须自包含(isolate)**,否则会被不透明的 app-shell 壳底盖住。本例靠内联 `<style>` + 自命名空间类名做到在"构建期集成"与"独立预构建"两条加载车道下都直接生效,无需单独注入扩展 CSS。背景对会话态的反应完全靠祖先属性选择器,无需宿主把消息状态传进组件。

## 运行

前端把 source 指向本目录即可:

```ts
usePiSession({ create: { source: "./examples/webext-background-agent" } })
```

发一条消息看背景从"静谧"切到"鲜明"。`model` 省略 → 继承 `~/.pi/agent/settings.json` 的默认 provider/model;凭据取自 `~/.pi/agent/auth.json`。

## 相关示例

- `webext-slots-agent` —— Tier1 协议保留插槽全集(含 `background` 槽的 fixture)
- `webext-layout-agent` —— Tier1 区域插槽(panelRight / headerCenter)
- `webext-declarative-agent` —— Tier5 纯声明式 theme(零代码改观感)
