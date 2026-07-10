# 16 · Canvas 工作台

**Canvas 工作台把散落在对话流工具卡里的 AIGC 生成图，聚合成一块「画廊 + 二次创作画布编辑器」的富交互应用面。** 它建立在 [04 Surface 权威表面栈](./04-surface-stack.md) 之上——`domain="canvas"` 的 CQRS 投影：画廊状态权威留在 agent 子进程（画廊 = attachment store 的物化视图），前端只做瘦投影读快照 + 命令上行。本章面向**使用者与集成方**（把 Canvas 挂进自己的 agent source）；插件作者面（自定义图层/工具/动作）见 [17 Canvas 插件开发](./17-canvas-plugins.md)。

Canvas 由独立发布的 `@blksails/pi-web-canvas-ui` 提供（组件层）+ `@blksails/pi-web-canvas-kit`（交互内核，见 17 章），二者已登记进 [05 分层包](./05-packages.md)。

---

## 它解决什么

用 AIGC agent 生成图时，图会以工具卡的形式一张张落在对话流里——想回看第三张、想拿它做二创、想比较两个变体，都得在聊天记录里上下翻。Canvas 工作台把这些图**聚合成一块常驻的创作台**：

- **画廊**（`CanvasGallery`）：把当前会话所有图片附件聚成九宫格，支持密度切换、分页、时间/血缘分组、当前轮流式预览（生成中由糊变清）。
- **工作台**（`CanvasWorkbench`）：点开某张图进入画布编辑器——舞台缩放平移、掩码/标注叠层、版本条、底部提示词栏；一键发起六种生成动作，或在本地做裁剪/旋转/拼贴，或让 LLM「解读」当前图。

关键设计：**用户的二创操作多数不惊动 LLM**。掩码、参考图、比例这些参数经 Surface 命令通道直接转发给子进程内的图像工具执行（A 档），或纯在浏览器 Canvas 2D 完成（B 档）。对话流保持干净。

---

## 默认关闭，如何开启

**Canvas 默认不出现。** 它不是一个全局开关点亮的特性，而是**由 agent source 声明驱动**：只有当一个 source 在它的 `.pi/web/web.config.tsx` 里，把 `CanvasLauncher` / `CanvasPanel` 挂到 `launcherRail` / `panelRight` 具名槽（见 [12 Web UI 扩展](./12-web-ui-extension.md) 的槽模型），Canvas 才出现。普通 agent source 不声明这两个槽，Canvas 自然缺席——独立性由「声明缺席」保证，而非某个 env 兜底关掉（`packages/canvas-ui/src/canvas-launcher.tsx:1-15`）。

因此「如何开启」= **换用一个声明了 Canvas 槽的 source**，最省事的是仓库自带的 `examples/aigc-canvas-agent`（`examples/aigc-canvas-agent/.pi/web/web.config.tsx:22-29`）。

### 关于 `NEXT_PUBLIC_PI_WEB_CANVAS`

历史上 Canvas 由前端环境变量 `NEXT_PUBLIC_PI_WEB_CANVAS` 门控，默认关，取 `1` / `true` 开启。这条门控仍留在引导链路里：服务端在 `GET /api/bootstrap` 读取该 env（`server/bootstrap.ts:93`、`lib/app/runtime-features.ts:55`）下发为 runtime feature `canvas`（默认 `false`），前端经 `setRuntimeFeatures()` 注入（`src/bootstrap.tsx:140`）。

> ⚠ 但组件级的 `isCanvasEnabled()` 读取该 env 的路径**已 `@deprecated`**（`packages/canvas-ui/src/canvas-launcher.tsx:29-37`）：`CanvasLauncher` / `CanvasPanel` 的 `enabled` prop 现在**默认 `true`**（`canvas-launcher.tsx:48,143`），显示与否改由「是否被声明挂载」决定。该 env 保留仅为向后兼容 / 强制覆盖（例如显式传 `enabled={false}` 强制关）。示例 README 里仍写着 `NEXT_PUBLIC_PI_WEB_CANVAS=1`，可作为兼容层设置，但**真正决定 Canvas 是否出现的是 source 声明**。

---

## 快速试跑

以下步骤用仓库自带示例把画廊跑起来，每步可独立验证。

1. **启动开发环境**（见 [01 快速开始](./01-quickstart.md)）：

   ```bash
   pnpm dev   # dev-all：Vite 前端 http://localhost:5173（/api 代理到 3000）
   ```

   预期：终端同时拉起 API(:3000) 与 Vite(:5173) 两个进程。

2. **在浏览器打开 `http://localhost:5173`**，在选源页选择（或新建会话指向）`examples/aigc-canvas-agent` 这个 source。

   预期：左侧启动导航区（launcherRail）出现「🖼️ Canvas 画廊」入口按钮（`canvas-launcher.tsx:52-62`，DOM 锚点 `data-canvas-launcher`）。若换成一个**没有**声明 Canvas 槽的普通 source，该按钮不出现——这就是「默认关」。

3. **点「Canvas 画廊」入口**：右侧面板（panelRight）展开画廊网格（`data-canvas-panel`）。

   预期：会话里已有的图片附件（若为空则空态）以九宫格呈现。让 agent 生成一张图（如输入 `/img-gen 一只猫`），轮末画廊自动 reconcile 新图。

4. **点画廊里任一格子**：进入 `CanvasWorkbench` 画布编辑器；点左上「返回画廊」（`data-canvas-workbench-close`）退回。

### 命令行验证（无需 UI）

Canvas 画廊状态可经该示例声明的 agent route 直接读到，方便脚本/CI 验证。先创建一个指向该 source 的会话拿到 `sessionId`，再调用 `gallery-stats`：

```bash
# 1) 创建会话（端口按实际 dev/CLI 调整）
curl -s -X POST http://localhost:3000/api/sessions \
  -H 'content-type: application/json' \
  -d '{"source":"'"$PWD"'/examples/aigc-canvas-agent"}'
# → {"sessionId":"…","protocolVersion":"0.1.0"}

# 2) 读画廊统计
curl -s http://localhost:3000/api/sessions/<sessionId>/agent-routes/gallery-stats
```

空画廊预期响应（`examples/aigc-canvas-agent/README.md:106-114`）：

```json
{ "domain": "canvas", "assets": 0, "byOrigin": { "upload": 0, "tool-output": 0 }, "generating": false }
```

`generating: true` 表示当前正有生成命令在流式出图。该 route 的 handler 从进程内 `getSessionState()` 按 key `"surface:canvas"` 读同一份快照——正是 Canvas UI 镜像的那份。声明式 route 机制见 [08 自定义 Agent 开发](./08-agent-development.md)、调用契约见 [24 HTTP/SSE API 参考](./24-http-api-reference.md)。

---

## 画廊：attachment store 的物化视图

`CanvasGallery` 经宿主注入的 `surface`（`WebExtSurfaceAccess`，slot 侧等价 `useSurface("canvas")`）镜像 `surface:canvas` 快照（`packages/canvas-ui/src/canvas-gallery.tsx:1-13,25-27`）：

- **`available === true`**（source 注册了 `surface:canvas` 探针）→ 完整画廊：九宫格默认 + 密度切换（概览 / 瀑布流 / 聚焦）+ 客户端分页 + 血缘 / 时间分组；缩略图用签名 `displayUrl`（二进制旁路，不走命令通道）；轮末 idle 边沿（`syncSignal` 变化）触发 `run("sync")` reconcile（`canvas-gallery.tsx:7-8`）。
- **`available === false`**（非 AIGC source，无探针）→ **优雅退化**为只读图库，来源是宿主注入的消息历史图片 `historyImages`，A 档生成禁用、不发命令、不报错（B 档本地编辑在工作台侧仍可用，`canvas-gallery.tsx:9-10`）。

画廊之所以是「物化视图」而非独立状态：它的数据不在前端，而是 agent 子进程侧 `canvasSurfaceExtension` 经 `hydrate()`（枚举当前会话图片附件 + 读血缘 meta 重建）+ `sync` reconcile 维护的权威快照，经 `control:"state"` 帧（`key="surface:canvas"`）镜像下行（`examples/aigc-canvas-agent/index.ts:9-11`）。这正是 Surface CQRS 的单写者模型。

此外，`CanvasPanel` 挂了一个 document 级委托监听：点击对话流工具卡里带 `data-att-id` 的图，会自动开面板并把工作台切到该 att_id（`canvas-launcher.tsx:158-177`），实现「聊天里点图 → 进 Canvas 编辑」。

---

## 工作台编辑器交互

`CanvasWorkbench` 是 M2 画布编辑器（`packages/canvas-ui/src/canvas-workbench.tsx:1-18`），布局为「画板满幅 + 舞台上的浮动控件层」：

| 区域 | 交互 | DOM 锚点 |
| --- | --- | --- |
| **舞台** | 滚轮缩放；「移动」工具拖拽平移 | `data-canvas-stage`（`:1501`） |
| **右侧工具轨** | 移动 / 画线 / 箭头 / 文本 / 掩码刷 / 擦除 / 撤销 / 重做 | `data-canvas-tool-rail`（`:1395`）、`data-canvas-tool="move\|line\|…"`（`:1417`）、`data-canvas-undo` / `data-canvas-redo`（`:1436,1439`） |
| **overlay 画布** | 掩码笔迹（粉红）+ 标注（红） | `data-canvas-mask-overlay`（`:1632`） |
| **底部提示词栏** | `@` 多图引用 + 比例 / 变体参数簇 + 「生成」按钮 | `data-canvas-stage` 内浮层 |
| **左侧版本条** | 垂直排列历史版本，点击切换 / 加为图层 | `data-canvas-version-rail`（`:1335`）、`data-canvas-version-item`（`:1354`） |

工具轨里的工具（画笔/画线/箭头/文本）都标注为「标注即指令」（`canvas-workbench.tsx:123-129`）——你在图上画的标注会被拍平成批注参考图交给生成动作，等于用视觉方式下指令。掩码刷则把笔迹光栅化为标准 alpha mask PNG（透明洞=编辑区）。

指针事件走单一入口 `PointerRouter`，命中判定全靠 DOM 上的 `data-*` 标记分派（`canvas-workbench.tsx:1082`），不散在各处 handler。

---

## 六个内置生成动作（A 档）

底部「生成」按钮不是固定动作，而是**按舞台当前状态自动决策**该发哪种生成。决策是评分制（`decideGenerate` → `resolveAction`，`canvas-workbench.tsx:283-297`），六个内置动作以 `defineCanvasAction<SurfaceOp>` 声明、按分数取胜（`packages/canvas-ui/src/generate-actions.ts:67-135`）：

| 动作 | 触发条件 | 评分 | 语义 |
| --- | --- | --- | --- |
| **扩图** `outpaint` | 拖动边框向外扩（`hasExpand`） | 100 | 向外生成填充新区域 |
| **局部重绘** `inpaint` | 涂了掩码（`hasMask`） | 90 | 掩码区重绘 |
| **融合生成** `reference` | `@` 引用了参考图 | 80 | 参考图融合（变体≥2 附 `n`） |
| **生成变体** `variants` | 变体数 ≥ 2 | 70 | 一次出多张 |
| **重构比例** `reframe` | 提示词空 + 指定了比例 | 60 | 仅按新比例重构 |
| **生成** `edit` | 恒兜底 | 10 | 整图指令编辑 |

命中动作后经 `buildSurfaceOp` 组装成通道无关的 `SurfaceOp`（`execution.via: "prompt"`，`generate-actions.ts:76`），`args` **只含 `att_` 引用 + 文本，无二进制**——图和掩码都以附件 id 传递。生成通过 Surface 命令通道 → `wireSurfaceBridge` → 子进程内直调图像工具执行（拿 `models.json`/provider/key，**不过 LLM**，`examples/aigc-canvas-agent/README.md:22-23`）。

> 这六个是**内置动作**，等于 Canvas 的行为回归基准线。插件作者可以用同一个 `defineCanvasAction` 契约追加自定义动作参与评分——那是 [17 Canvas 插件开发](./17-canvas-plugins.md) 的内容。

### B 档：纯本地编辑

掩码 / 标注 / 旋转 / 回贴合成全在浏览器 Canvas 2D 完成，产物经上传接缝落成新 `att_` 后 `run("register", …)` 回权威画廊（`canvas-workbench.tsx:13-14`，`data-canvas-b-rotate` 等锚点）。`available === false` 时 B 档仍本地可用，只是不 register。

### 带入对话

默认二创**不注入对话**。需要时点显式动作（`data-canvas-bring-to-conversation`，`:1322`）经 Prompt 通道把 `att_id` 注入一条用户消息，把某张图带回聊天上下文。

---

## vision「解读」回流对话

工作台顶部有一个「👁 解读」按钮：对当前工作图提问，让 LLM **真正看见**这张图并回答。这解决了一个具体问题——画廊里的图对 LLM 只是 `[attachment id=att_… …]` 文本标记，它读得到 id、读不到像素。

「解读」经**与生成相同的对话通道**发出（`canvas-workbench.tsx:869-887`）：`buildVisionOp` 把「当前工作图 + 问题 + 可选视觉模型」组装成一个 `tool: image_vision` 的 `SurfaceOp`（`packages/canvas-ui/src/vision-op.ts:63-82`），由 `bridge.submitOp` 经 `renderSurfaceOp` 渲染为**用户消息**发进对话流，LLM 据此调用 `image_vision` 工具（取回字节 → 委派支持图像输入的模型 → 返回文字结论）。因此结论**天然回流对话记录**：可回放、可追问、进 LLM 上下文——而不是弹一个孤立的浮层。

两个陷阱：

- **视觉模型选择器**从 `GET /api/vision/models` 拉取（`canvas-launcher.tsx:66-92`、`vision-op.ts:92-112`）；任何失败（无 baseUrl / 网络 / 非 2xx / 解析异常）都折成空清单，此时**解读仍可用**——载荷不带 `model`，由 `image_vision` 工具弹层兜底。
- 解读的 `model` 取值是 **`provider/modelId`**（与工具 `model` 参数对齐），⚠ 与提示词栏「生成模型」选择器的**裸 id** 格式不同，不可混用（`vision-op.ts:16-18`）。

`image_vision` 工具本身、`/img_vision` 命令、`GET /vision/models` 端点见 [11 AIGC 与视觉工具](./11-aigc-and-vision-tools.md)。

---

## 架构：建立在 Surface 栈之上

Canvas 是 [04 Surface 权威表面栈](./04-surface-stack.md) 的**参考消费者**，`domain="canvas"`：

```
┌─ agent 子进程 ───────────────────────────────┐
│ canvasSurfaceExtension (createSurface)        │  ← 单写者：状态权威
│   hydrate() 枚举附件重建 GalleryState 快照     │
│   A 档命令 → runImageTool（不过 LLM）          │
└───────────────┬───────────────────────────────┘
   control:"state" (key="surface:canvas") │ ▲ ui-rpc 命令上行
   镜像下行快照                            ▼ │
┌─ 浏览器 ───────────────────────────────────────┐
│ CanvasPanel（panelRight，注入 surface）         │
│   ├ CanvasGallery  读快照（瘦投影）             │
│   └ CanvasWorkbench 发命令（run/submitOp）      │
└────────────────────────────────────────────────┘
```

- **状态下行**：子进程 `createSurface` 每次 `set` 都把 `GalleryState` 快照写到 `key="surface:canvas"`，经 `control:"state"` 粘性帧镜像到前端（`examples/aigc-canvas-agent/index.ts:9-11`）。
- **命令上行**：工作台的 `run("register")` / `run("sync")` / A 档生成经 `useSurface` → ui-rpc 转发 → `wireSurfaceBridge` 在子进程内派发。生成用 `submitOp`（Prompt 通道），本地编辑注册用 `run`（命令通道）。
- **降级三态**：`bridge.opChannel` 为 `prompt`（正常）/ `command`（仅命令可用）/ `unavailable`（探针缺失）三态，UI 据此呈现（`canvas-workbench.tsx:1818-1826`）。

真实子进程集成测试覆盖了整条路（fd1 回流 + `setState` 下行 + 画廊物化视图 hydrate + A 档二创），见 04 章。

---

## 集成方：把 Canvas 挂进自己的 source

在你的 agent source 里，Canvas 是两处接线（`examples/aigc-canvas-agent/index.ts` + `.pi/web/web.config.tsx`）：

**1. agent 侧**——装载三个 extension（`examples/aigc-canvas-agent/index.ts:47-48`）：

```ts
import { aigcExtension, canvasSurfaceExtension, visionExtension }
  from "@blksails/pi-web-tool-kit/runtime";

export default defineAgent({
  extensions: [aigcExtension, visionExtension, canvasSurfaceExtension],
  // …
});
```

- `aigcExtension`：`image_generation` / `image_edit`（生成图落 `att_`，触发画廊聚合）；
- `visionExtension`：`image_vision` 工具 + `/img_vision` 命令（支撑「解读」）；
- `canvasSurfaceExtension`：`domain="canvas"` 的权威 surface（画廊物化视图 + A 档二创命令）。

**2. UI 侧**——在 `.pi/web/web.config.tsx` 声明槽（`examples/aigc-canvas-agent/.pi/web/web.config.tsx:22-29`）：

```tsx
import { CanvasLauncher, CanvasPanel, AigcQuickSettings }
  from "@blksails/pi-web-canvas-ui";

export default defineWebExtension({
  manifestId: "aigc-canvas",
  capabilities: ["slots"],
  config: { panelRatio: "4:6", logsPanelPosition: "bottom" },
  slots: {
    launcherRail: CanvasLauncher as never,  // 入口按钮
    panelRight: CanvasPanel as never,        // 画廊/工作台（宿主注入 surface）
    promptToolbar: AigcQuickSettings as never, // 输入区模型/尺寸快捷设置
  },
});
```

`launcherRail` 槽拿不到 surface（只负责开合），交互画廊/工作台落在有 surface 注入的 `panelRight`（`canvas-launcher.tsx:1-15`）。两个槽经 module-level `canvasOpenStore` 联动。若你的 source 没有 `surface:canvas` 探针（未装 `canvasSurfaceExtension`），画廊自动退化为只读图库——见 `examples/aigc-canvas-nosurface-agent` 这个范例。

> **范围提示**：Canvas 的画布编辑器、六内置动作、画廊、解读均在 main 上（`packages/canvas-ui`），代码已合、有集成测试背书。本章不涉及任何未合入 main 的能力。

---

## 下一步 / 相关

- Canvas 依赖的第二条通信平面（`createSurface` / `useSurface` / CQRS 单写者） → [04 Surface 权威表面栈](./04-surface-stack.md)
- Canvas 组件所在的包（`@blksails/pi-web-canvas-ui` / `-canvas-kit`）与依赖图 → [05 分层包](./05-packages.md)
- `NEXT_PUBLIC_PI_WEB_CANVAS` 门控与配置目录 → [06 配置参考](./06-configuration.md)
- `image_vision` 工具、`/img_vision` 命令、AIGC 图像工具与 `GET /vision/models` → [11 AIGC 与视觉工具](./11-aigc-and-vision-tools.md)
- `launcherRail` / `panelRight` / `promptToolbar` 槽模型与 5-tier 挂载机制 → [12 Web UI 扩展](./12-web-ui-extension.md)
- 自定义图层/工具/动作、`defineCanvasAction` 三件套（插件作者面） → [17 Canvas 插件开发](./17-canvas-plugins.md)
- `gallery-stats` 用到的声明式 HTTP route、`getSessionState()` 作者面 → [08 自定义 Agent 开发](./08-agent-development.md)
- `agent-routes` 调用契约、`control:"state"` 帧、`GET /api/vision/models` → [24 HTTP/SSE API 参考](./24-http-api-reference.md)
- 五分钟跑通与 `pnpm dev` 双进程编排 → [01 快速开始](./01-quickstart.md)
