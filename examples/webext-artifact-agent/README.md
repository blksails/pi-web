# webext-artifact-agent

**Tier 4 · artifact 隔离表面**示例 —— `.pi/web` 声明一个 artifact 入口(`artifact.html`),宿主在**独立 origin 的 sandbox iframe** 中渲染它,把富/LLM 输出与宿主隔离。

## 它演示什么

| 能力 | API / 声明 | 前端表现(pi-web) |
|------|-----------|------------------|
| artifact 入口 | `artifact: { entry: "artifact.html", initialHeight: 240 }` | 在隔离 sandbox iframe 中加载该 HTML,初始高度 240 |
| origin 隔离 | `capabilities: ["artifact"]` | 独立 origin sandbox,富/LLM 输出无法触达宿主 DOM |

> **注意:artifact 需要 `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` 才挂载。** 裸 dev 下不设此环境变量时 `ArtifactSurface` 不挂载、看不到 iframe——这是正确的门控,不是 bug。本目录另有 `demo.html`(本地预览用)与 `.pi/web/artifact.html`(实际入口)。

## 运行

前端把 source 指向本目录,并设置 artifact base URL 才能看到 sandbox iframe:

```ts
usePiSession({ create: { source: "./examples/webext-artifact-agent" } })
```

```bash
# 缺此变量则 ArtifactSurface 不挂载(门控)
NEXT_PUBLIC_PI_EXTENSION_BASE_URL=http://localhost:<port> ...
```

`model` 省略 → 继承 `~/.pi/agent/settings.json` 的默认 provider/model;凭据取自 `~/.pi/agent/auth.json`。

## 相关示例

- `webext-renderer-agent` —— Tier2 自定义渲染器(同进程内渲染,非隔离)
- `webext-contrib-agent` —— Tier3 贡献点(slash / @mention 经 ui-rpc)
- `webext-slots-agent` —— Tier1 区域插槽全集(含 `artifactSurface` 槽 fixture)
