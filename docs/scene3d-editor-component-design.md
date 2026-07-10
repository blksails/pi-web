# scene3d 编辑器组件设计（three.js · 场景摆放 + 人体骨架操控 + 骨架动画引入）

> 状态：pre-spec 设计稿（2026-07-10）。
> 系列：[组件安装器设计](./component-installer-design.md)（分发车道，v1 已实现）·
> [SES 扩展标准](./surface-extension-standard.md) ·
> [Surface App Runtime 契约 v1](./surface-app-runtime-contract-v1.md) ·
> 参考实现：aigc-canvas（2D 前例）、canvas-component-watermark（组件包首例）。
>
> 一句话：一个以**源码组件**（`kind:"component"`，经 `pi-web add` 分发）交付的
> three.js 3D 场景编辑器面板——挂 `panelRight` 具名槽，支持简单场景摆放、
> 人体骨架操控（FK）、骨架动画导入与播放;两期走 SES:**Phase 1 纯前端 B 档**
> （零 agent 改动，退化契约天然满足），**Phase 2 scene3d surface**（agent 权威 +
> LLM 在环 scene-op）。

---

## 0. 已查实的事实（地基，非设计）

| 事实 | 坐标 / 含义 |
|---|---|
| three.js 不在仓内任何 package.json | 全新依赖。按组件车道 peer 语义处理（见 §6-D1） |
| `EXTERNAL_SINGLETONS` 只豁免 react/react-dom/jsx-runtime/ai/web-kit | `packages/web-kit/build/build.ts:18`。three **会被 esbuild 打进** `web-extension.mjs`——three 无跨包单例约束（不与宿主共享 THREE 实例），bundle 内闭合是正确形态 |
| esbuild 从**使用者 source 目录**解析 import | `bundle:true`;three 声明为组件 peer → 使用者 `npm i three` 后 add，构建自然命中其 node_modules（与 canvas-kit peer 同型） |
| SlotHost 标准注入集含 `surface/state/upload/conversation/syncSignal/baseUrl/sessionId` | `packages/web-kit/src/host-context.ts`;Prompt 通道现走 **`ConversationAccess.submitUserMessage(text, {attachmentIds})`**（M-A 门面收口后，裸 `onSubmitPrompt` 已被能力对象替代） |
| 附件系统是二进制唯一通道 | GLB/FBX 模型与动画一律 `upload` 落 `att_` + 签名 `displayUrl` 取回;快照/状态帧只承载引用（SES-P2 实证依据:fd1 大帧交织损坏） |
| 组件车道 v1 wiring 只实现 `canvasPlugins`;`slots`/`renderers` 是 schema 预留枚举 | `cli-component-add` Req 1.5。3D 面板挂具名槽 ⇒ 需 **installer v1.1 增量**（§7） |
| canvas 参考实现已固化的模式 | 双通道规约（SES-U4）、settleWindow（U5）、syncSignal 双用途（U6）、退化契约（U2）、接缝 prop 注入（T4）——scene3d 逐条继承 |

## 1. 能力范围（用户三点展开）

### 1.1 简单场景摆放
- **资产两来源**：内置 primitives（box/sphere/plane/gltf-占位人偶）+ 用户模型（GLB
  经 `upload` 落 `att_`，`displayUrl` 取回加载）。
- **变换操作**：`TransformControls`（three/examples jsm）移动/旋转/缩放，绑定选中实体；
  地面网格 + 轴线；`OrbitControls` 视角（透视/正交切换）。
- **层级列表**：实体树（选中联动 gizmo 与属性检查器）；重命名/删除/复制。
- **属性检查器**：数值化 transform 编辑（position/rotation/scale 直接输入）。

### 1.2 人体骨架操控（FK，v1）
- 加载含 skeleton 的 SkinnedMesh（GLB）→ 骨骼树视图（`SkeletonHelper` 可视化）。
- 选中 bone → rotate gizmo（FK 逐骨旋转）；属性检查器显示欧拉角。
- **姿势快照（PoseSnapshot）**：全骨骼 quaternion 表——纯数值、轻量，可进场景文档
  （SES-P3 合规：高频拖拽期间只改 three 对象，**松手才提交**进 store）。
- 姿势库：保存/应用命名姿势（存进场景文档）。
- IK（触地约束、目标跟随）明确二期（§10 不做）。

### 1.3 骨架动画引入
- **导入**：GLB（`GLTFLoader`）与 FBX（`FBXLoader`，Mixamo 主流导出）动画剪辑，
  文件经 `upload` 落 `att_`；解析出 `AnimationClip` 列表入动画库。
- **重定向（retarget）**：`SkeletonUtils.retargetClip` 把剪辑映射到目标骨架；v1 依赖
  骨骼命名约定自动映射（Mixamo `mixamorig` 前缀自动剥离对齐），不匹配骨骼输出
  诊断列表（手动映射表 UI 二期）。
- **播放控制**：`AnimationMixer` per 实体；play/pause/loop/速度/时间轴 scrub；
  动画↔实体绑定关系入场景文档（`AnimBinding`）。

## 2. 架构定位：一个新 SES 扩展面，分两期交付

```
Phase 1（本设计的交付物）             Phase 2（另立 spec）
┌─────────────────────────┐         ┌──────────────────────────┐
│ 纯前端 B 档编辑器          │         │ scene3d surface(A 档)     │
│ - 状态权威 = 面板内 store   │   →     │ - createSurface(domain    │
│ - 持久化 = scene.json→att_ │         │   "scene3d") agent 权威    │
│ - 二进制 = upload→att_     │         │ - LLM 在环 scene-op fence  │
│ - conversation 可选把截图/  │         │ - register/sync/delete/    │
│   场景描述带进对话          │         │   apply_pose 命令表        │
│ - 零 agent 改动、零宿主改动  │         │ - hydrate 自 attachment 枚举│
└─────────────────────────┘         └──────────────────────────┘
```

**为什么 Phase 1 不做 surface**：用户三项能力（摆放/骨架/动画）全部是**本地计算**
（SES 语义的 B 档）；A 档只在「LLM 在环改场景」时才必要。先交付纯前端版恰好使
退化契约（SES-U2）成为常态而非降级——装进**任意** agent source 都是全功能编辑器。
Phase 2 增量接 surface 时,面板已按 `useSurface().available` 探针写好分叉点。

**持久化（Phase 1）**：场景文档 `scene.json`（实体/变换/姿势库/动画绑定，全部
`att_` 引用 + 数值）经 `upload` 落 `att_`;「保存/载入场景」即写/读该附件。会话内
自动恢复：store 镜像到 `sessionStorage`（刷新不丢），跨会话靠显式保存。

## 3. 组件包形态（五工件，kind:"component"）

```
examples/scene3d-component/                  # 首发以本仓 example 组件包交付
├── pi-web.json                              # kind:"component"(清单见 §4)
├── README.md                                # 用法 + SES 自检勾选
└── components/scene3d/
    ├── scene3d-panel.tsx                    # ③ 面板:slot 组件(布局/工具栏/视口编排)
    ├── scene-store.ts                       # 领域 store:SceneDoc reducer(纯函数,undo 栈)
    ├── scene-schema.ts                      # ① 纯 schema:SceneDoc/Entity/PoseSnapshot/AnimBinding(zod)
    ├── viewport.tsx                         # three 视口:renderer 循环/controls/gizmo 装配
    ├── asset-loader.ts                      # GLB/FBX 加载(loaderFactory 可注入,att_→displayUrl)
    ├── skeleton-rig.ts                      # 骨骼树提取/bone gizmo 绑定/PoseSnapshot 采集与应用
    ├── animation-import.ts                  # 剪辑解析/mixamo 命名归一/retargetClip 封装+诊断
    ├── timeline.tsx                         # 播放控制条(mixer 桥)
    └── scene3d.test.tsx                     # ⑤ 测试随源(store/schema/归一化/诊断纯函数 + 组件退化)
```

②（agent extension）与④（命令表）归 Phase 2。分发形态：`pi-web add
./examples/scene3d-component --target <你的 source>`（或 git 直连）。

## 4. 清单（含 installer v1.1 依赖）

```json
{
  "id": "scene3d",
  "version": "0.1.0",
  "kind": "component",
  "displayName": "3D 场景编辑器",
  "description": "three.js 场景摆放 / 人体骨架 FK 操控 / 骨架动画导入(GLB/FBX,Mixamo retarget)",
  "component": {
    "files": ["components/scene3d/…(全部源文件)", "components/scene3d/scene3d.test.tsx"],
    "wiring": {
      "point": "slots",
      "slot": "panelRight",
      "export": "Scene3dPanel",
      "from": "./components/scene3d/components/scene3d/scene3d-panel"
    },
    "peer": {
      "three": ">=0.160.0",
      "@blksails/pi-web-kit": ">=0.1.0"
    },
    "registryDeps": []
  }
}
```

- `from` 为**落点相对路径**（组件车道已实证的契约：指引逐字可解析）。
- **three 是 peer**：使用者 source `npm i three` 后 add；peer 校验硬失败即时提示，
  构建期 esbuild 解析自使用者 node_modules 并打进产物（版本由使用者控制）。
- react 相关不声明 peer（宿主单例，构建期 external）。

## 5. 领域模型（scene-schema.ts，纯 zod，零 three 值导入）

```ts
Transform   = { position:[x,y,z], rotation:[x,y,z,w](quat), scale:[x,y,z] }
Entity      = { id, name, kind:"primitive"|"model", primitive?:"box"|"sphere"|"plane",
                modelAttId?: string /* att_ 引用 */, transform: Transform,
                skeleton?: { poseLibrary: Record<name, PoseSnapshot>, activePose?: name } }
PoseSnapshot= Record<boneName, [x,y,z,w]>          // 全数值,轻量,可进文档
AnimBinding = { entityId, clipAttId: string, clipName: string, loop: boolean, speed: number }
SceneDoc    = { version: 1, entities: Entity[], bindings: AnimBinding[],
                camera?: { position, target, mode:"persp"|"ortho" } }
```

不变量：**schema 内没有任何二进制/大数组**（顶点/贴图/剪辑关键帧都留在 `att_`
文件里，运行时按需加载）；`version` 字段为演进锚点（新字段一律 optional）。
schema 与 three 解耦（three 对象 ↔ SceneDoc 的互转在 viewport/skeleton-rig 层），
使 store 与 schema 可在 node 环境直测。

## 6. 关键设计决策

- **D1 · three 走组件 peer + bundle 内闭合**：不进 `EXTERNAL_SINGLETONS`（宿主
  不用 three，无单例共享需求）；不 CDN（生产 CSP 禁外联）。产物体积代价
  ≈ three core + 用到的 examples/jsm（GLTFLoader/FBXLoader/controls/SkeletonUtils），
  预估 gzip 后 ~250–350KB——挂 panelRight 惰性加载可接受；`React.lazy` 分包不做
  （webext 单文件产物约定），首开销在面板首次打开时一次性支付。
- **D2 · 渲染循环与 React 的边界**：three 场景/renderer 生命周期在 `viewport.tsx`
  一个 effect 内闭合（挂 canvas ref、rAF 循环、resize observer、卸载 dispose）；
  React 只做**声明层**（工具栏/树/检查器/时间线），不逐帧 setState——选中/变换的
  高频中间态走 ref，**松手才提交 store**（canvas 前例 SES-U9 的 3D 对应）。
- **D3 · 接缝全部可注入（SES-T4）**：`rendererFactory`（jsdom 无 WebGL → 注入
  fake）、`loaderFactory`（测试不加载真 GLB）、`raf`（测试驱动帧）、`upload`
  （SlotHost 注入缺失 → 导入类工具禁用不静默丢，SES-U8）。组件测试只测纯函数
  （store reducer/mixamo 归一/retarget 诊断/schema）与退化分叉，**不在 jsdom 里跑
  真渲染**;真渲染验收归浏览器 e2e。
- **D4 · Mixamo 兼容策略**：骨骼名归一化纯函数（剥 `mixamorig:`/`mixamorig` 前缀、
  大小写规整）→ 命中率优先;`retargetClip` 失败或缺骨输出**结构化诊断**（缺失骨骼
  列表 + 命中率），面板以可读列表呈现——不猜、不静默半成功。
- **D5 · undo/redo**：store 层命令式 reducer + 反向操作栈（摆放/变换/姿势提交
  均入栈）;gizmo 拖拽一次 = 一笔（起止快照差分），继承 canvas M3 的
  「StrictMode updater 禁副作用」教训。
- **D6 · 对话接入（可选增强,非依赖）**：`conversation.submitUserMessage` 存在时
  提供「发到对话」：视口截图（`renderer.domElement.toBlob` → upload → att_）+
  场景摘要文本（实体清单/姿势名）。缺失时按钮不渲染。这不是 Phase 2 的 LLM 在环
  改场景——只是单向携带,零协议新增。
- **D7 · DOM 锚点**（SES-N5）：`data-scene3d-viewport / -entity-tree / -inspector /
  -timeline / -asset-import / -bone-tree / -pose-library`；e2e 只认锚点。

## 7. 组件车道 v1.1 增量（installer 侧，本设计的唯一上游改动）

`cli-component-add` v1 的 wiring 只实现 `canvasPlugins`;本组件需要 `slots` 点：

1. `ComponentWiringSchema` 增可选 `slot`（具名槽 key：`panelRight | launcherRail |
   promptToolbar | headerCenter …`，沿 SlotKey 既有枚举）；`point:"slots"` 时必填
   （业务校验，schema 结构不 strict）。
2. `manifest-validate`：解除 `wiring_point_unsupported` 对 `slots` 的拒绝（保留
   `renderers` 预留）。
3. `wiring-guidance`：`slots` 点的指引模板——
   ```tsx
   import { Scene3dPanel } from "<from>";
   // defineWebExtension({ ... }) 内:
   slots: { panelRight: <Scene3dPanel /> },
   ```
   （对象键挂载，区别于 canvasPlugins 的数组追加；仍只打印不 codemod。）
4. 回归线：watermark（canvasPlugins 点）全部既有测试零改动；新增 slots 点的
   guidance 快照测试 + add e2e 一条。

增量很小（三个文件 + 测试），随 scene3d spec 一并立项或先行小 spec 均可。

## 8. 面板布局（panelRight）

```
┌──────────────────────────────────────────┐
│ 工具栏: [选择|移动|旋转|缩放] [+资产▾] [保存|载入] [📷发到对话*] │
├────────────┬─────────────────────────────┤
│ 实体树      │                              │
│ ├ 人偶A     │        three 视口            │
│ │ └ 骨骼树▾ │   (OrbitControls +           │
│ ├ 椅子      │    TransformControls +       │
│ └ 地面      │    SkeletonHelper)           │
├────────────┴──────────────┬──────────────┤
│ 时间线: ▶ ⏸ ↻ [clip▾] ──●──── │ 属性检查器    │
└───────────────────────────┴──────────────┘
* conversation 能力存在时才渲染(D6)
```

## 9. 测试与验收（SES-T 映射）

| 层 | 内容 | 环境 |
|---|---|---|
| 纯函数单测 | store reducer 全操作 + undo 栈;schema parse/演进;mixamo 归一化;retarget 诊断(fake 骨架);PoseSnapshot 采集/应用(fake bone 树) | node |
| 组件测试 | 面板退化矩阵:无 upload → 导入禁用;无 conversation → 无发送按钮;fake renderer 下工具栏/树/检查器交互与 store 联动 | jsdom(随源分发,canvas-ui wrapper 挂载,与 watermark 同款) |
| add 自举 e2e | `pi-web add` 装入 → 按 slots 指引接线 → `buildWebExtension` 成功、产物含 `data-scene3d-viewport` 与 three 特征串;peer 缺 three 时硬失败提示 | node e2e(fake peer 夹具 + 真 three 两档) |
| 浏览器 e2e | 真 three:摆一个 box → gizmo 移动 → store 数值变化;载入内置人偶 → 选骨旋转 → 姿势保存;导入夹具 GLB 剪辑 → 播放 → mixer 时间推进(锚点断言) | Playwright(夹具用仓内自带的最小 GLB,不外联) |

## 10. 明确不做（v1）

- IK solver / 物理引擎 / 碰撞;多人协作;USD/FBX **场景**导入（FBX 只收动画剪辑）;
  服务器端渲染/离屏导出视频;贴图材质编辑器;渲染质量档位（阴影/后处理）。
- Phase 2 的全部（scene3d surface 域、LLM 在环 scene-op、agent 侧 hydrate）。
- 组件车道 codemod（沿 v1 决策，slots 同样只打印指引）。

## 11. 分期路线

| 期 | 交付 | 回归线 |
|---|---|---|
| M0 | installer v1.1（slots 接线点） | watermark 零改动;slots guidance 快照 + e2e |
| M1 | 场景摆放（primitives + GLB 资产 + gizmo + 树/检查器 + scene.json 保存/载入 + undo） | 纯函数/组件测试 + add 自举 e2e |
| M2 | 骨架操控（骨骼树 + FK gizmo + 姿势库） | fake 骨架单测 + 浏览器 e2e 选骨改姿 |
| M3 | 动画导入（GLB/FBX 剪辑 + mixamo retarget + 时间线播放 + 绑定入档） | retarget 诊断单测 + 浏览器 e2e 播放推进 |
| Phase 2 | scene3d surface + scene-op（另立 spec） | SES §8 全清单 |

## 12. 未决问题（立 spec 前拍板）

1. **three 版本锚**：peer `>=0.160.0`（r160+ 的 examples/jsm 均 ESM 化、API 稳定）
   还是钉更窄（`^0.170`）？倾向 `>=0.160.0`——组件车道哲学是使用者控版本。
2. **FBX 收不收进 v1**：FBXLoader+fflate 增 ~80KB gzip,但 Mixamo 主流是 FBX。
   倾向收（动画导入是核心诉求,让用户先转 GLB 违背「快速集成」初衷）。
3. **内置人偶资产**：仓内自带一个 CC0 最小骨架 GLB（~200KB）作开箱体验与 e2e
   夹具,还是 v1 只支持用户自带模型？倾向自带（骨架操控没有开箱模型无法演示）。
4. **scene.json 的会话锚定**：`att_` 元数据带 sessionId 便于 Phase 2 hydrate 枚举,
   还是 v1 不锚定（纯手动保存/载入）？倾向带（附件 meta 不透明,加了不解释,
   为 Phase 2 留缝零成本）。
5. **首发位置**：`examples/scene3d-component`（本仓 example,与 watermark 并列）
   还是独立 git 仓（吃 git 直连车道）？倾向本仓先行,验证大依赖组件的车道成色。
