# aigc-canvas-agent

Canvas(`aigc-canvas`)端到端示例:把 AIGC 生成/编辑图从「散落在对话流工具卡」聚合成
**画廊 + 二次创作工作台**。Canvas 是 `agent-authoritative-surface`(AAS)SDK 的 `domain="canvas"`
实例——通信一律复用上游(`createSurface` / `useSurface` / `wireSurfaceBridge`)。

## 装载

```ts
extensions: [aigcExtension, canvasSurfaceExtension]
```

- `aigcExtension`:`image_generation` / `image_edit` 工具(LLM 生成的图落 `att_`,触发源 ①)。
- `canvasSurfaceExtension`:`domain="canvas"` 的权威 surface。
  - **画廊 = attachment store 物化视图**:`hydrate()` 经上游 `attachment-tool-bridge` 的
    `listBySession()` 枚举当前会话图片附件 + `getMeta()` 读血缘重建;冷启/`sync` reconcile。
  - **A 档二创**(`edit`/`inpaint`/`reference`/`variants`/`outpaint`/`reframe`):经 AAS 命令通道
    → `wireSurfaceBridge` → 子进程内直调 `runImageTool`(拿 `models.json`/provider/key,不过 LLM)。
  - **血缘**(`derivedFrom`/`genParams`)经上游 `setMeta` 持久到附件不透明扩展 meta。

## UI(`.pi/web`)

- `launcherRail` 槽:`CanvasLauncher`(门控 `NEXT_PUBLIC_PI_WEB_CANVAS`,开合画廊)。
- `panelRight` 槽:`CanvasPanel`(有 `surface` 接入 → 镜像快照 + A/B/C 档二创工作台)。

## 门控

默认关闭。开启:

```bash
NEXT_PUBLIC_PI_WEB_CANVAS=1
```

非 AIGC source(无 `surface:canvas` 探针)→ `available===false` → 优雅退化为只读图库 + B 档客户端编辑,
不报错。

## 二次创作分档

- **A 档**(`image_edit` 映射):指令编辑 / inpaint 涂 mask / 参考图融合 / 扩图 / 多模型变体 / 比例重构。
- **B 档**(纯客户端 Canvas 2D):裁剪 / 旋转 / 拼贴 / 标注 / mask → 新 `att_` 回流画廊。
- **C 档**(灵感放大):血缘树 / 参数复用 / A-B 对比 / 当前工作图链。
