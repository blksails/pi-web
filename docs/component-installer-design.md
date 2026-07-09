# Component 安装器设计（`pi-web add` · shadcn 式源码组件车道）

> 状态：**v1 已实现**（spec `.kiro/specs/cli-component-add/`，2026-07-09，分支 feat/component-installer）。
> 实现期定案（与本稿差异，以 spec 为准）：
> ① §4.5 的独立 `pi-web update` **废止**——`update` 子命令名已被 source 级更新占用，
>    更新三态并入 `add` 幂等语义（shadcn 同型：重复 add 即更新）；
> ② `#<子目录>` 片段语义**仅对 git 直连形态启用**（语法门控 `isGitDirectForm`）——
>    本地路径可能真含 `#`，一律整体解析（复核曾抓到误剥致静默装错包的 Critical，已修）；
> ③ 溯源摘要用 sha256（既有 sha384 是 publish 车道的 SRI，语义不同不共享）；
> ④ semver 极简实现只支持 精确/`>=`/`^`/`~`（仓内无 semver 依赖，零新增运行依赖）。
> 范例组件包：`examples/canvas-component-watermark/`（首个 kind:"component" 实例）。

> 原始设计稿（2026-07-09 定稿时的形态）如下。
> 系列：[SES 扩展标准](./surface-extension-standard.md) ·
> [Surface App Runtime 契约 v1](./surface-app-runtime-contract-v1.md) ·
> [CanvasKit 插件化](./canvas-extension-mechanism-design.md) ·
> [扩展/Skill 安装器讨论](./extension-skill-installer-design.md)。
> 依赖 spec：`.kiro/specs/cli-package-commands/`（子命令分发层、create 骨架机构、本地登记表——本设计复用其机械）。

---

## 1. 想法一句话

给 pi-web CLI 增加 `pi-web add <component>`：把第三方 **UI 组件的源码**拷进目标
agent source 的 `.pi/web/components/` 下，打印/执行接线，`pi-web build` 后生效——
组件代码归使用者所有，可自由修改。机制对标 shadcn/ui：**分发源码，不分发依赖**。

## 2. 已查实的事实（地基，非设计）

| 事实 | 坐标 |
|---|---|
| `pi-web create` 的模板枚举、骨架写入与身份重写、生成物可运行验证已实现 | `cli-package-commands` tasks 3.1–3.3（本仓已提交） |
| 本地来源登记表的写入机构已实现 | 同 spec task 4.1 |
| CLI 子命令分发层已实现，加词条即可挂新子命令 | 同 spec task 2.1；`bin/pi-web.mjs` + `dist/cli-commands.mjs` 双入口 |
| `pi-web.json` 带 `kind` 判别式（`agent` \| `plugin`），schema 已落地 | `examples/plugin-code-review-agent/pi-web.json` |
| canvas 面内插件**本来就是源码形态**：`.tsx` 源文件 + `web.config.tsx` 接线，经 `pi-web build` 编译进 `.pi/web/dist/` | `examples/canvas-plugin-stickers/.pi/web/{stickers.tsx,web.config.tsx}` |
| 插件命名空间由**消费方**施加：`registerPluginBundles` 以宿主扩展的 `manifestId` 为前缀，同 id 拒绝后注册者 | CanvasKit 设计 §5；canvas-plugins-m3 |
| SES 标准保证组件可移植：面板只消费 `SlotHost` 标准注入集且判空降级（U1）、探针失败退化不崩（U2）、零宿主改动（H1）、接缝 prop 可注入（T4） | `surface-extension-standard.md` |
| `via:"command"` 动作有能力避让机制：`capability.actions` 白名单未含该动作即不参与决策 | SES-X3；stickers 的 `styleTransferAction` 实证 |
| pi-clouds 注册表粒度是 agent source，`kind` 加法在注册表侧另有 spec | `cli-package-commands` design「Adjacent expectations」 |

## 3. 定位：第四条车道，填既有三条的空档

CanvasKit 设计 §5 的三条车道全是**运行时装载**模式：

| 车道 | 形态 | 局限 |
|---|---|---|
| ① 同 bundle 自带 | `defineWebExtension({ canvasPlugins })` | 只服务该 source 自己 |
| ② 第三方插件包 | 装整个 webext 包，浏览器动态加载 dist | 不可改、必须全套验签 |
| ③ agent 命令驱动 | capability.actions 零 UI 长按钮 | 只覆盖纯 command 动作 |
| **④ 源码组件（本设计）** | **拷源码进 source，编译进自己的 dist** | 拷完即分叉，更新不自动跟 |

选型判据一句话：**想改代码 / 一次性集成 → `add`（拷源码）；想跟上游升级 / 不碰代码 →
`install`（整包 + 验签）**。两条车道并存，语义互不侵占。

## 4. 设计

### 4.1 组件包形态（发布侧）

一个组件是一个极小的、以源码交付的包（git 仓 / registry 条目 / 本仓内置库均可）：

```
canvas-component-watermark/
├── pi-web.json                      # kind:"component" 清单（§4.2）
├── README.md                        # 用法 + SES §8 自检清单勾选记录（准入要求，§7）
└── components/
    └── watermark/
        ├── watermark.tsx            # 插件捆源码（§4.6）
        └── watermark.test.tsx       # 单测随源同拷（SES-T4）
```

与车道②插件包的区别：那边交付**完整 webext**（自带 `web.config.tsx`、build 出 dist、
验签）；组件包只交付**源文件 + 清单**，没有自己的 `web.config.tsx`——接线发生在目标
source 里。

### 4.2 清单：`pi-web.json` 增加 `component` kind

```json
{
  "$schema": "https://pi-web.dev/schema/pi-web.json",
  "id": "canvas-watermark",
  "version": "0.2.0",
  "kind": "component",
  "displayName": "水印工具",
  "description": "Canvas 水印图层 + 工具 + 批量动作（command 通道）",
  "component": {
    "files": [
      "components/watermark/watermark.tsx",
      "components/watermark/watermark.test.tsx"
    ],
    "target": ".pi/web/components/watermark",
    "wiring": {
      "point": "canvasPlugins",
      "export": "watermarkBundle",
      "from": "./components/watermark/watermark"
    },
    "peer": {
      "@blksails/pi-web-canvas-kit": ">=0.3",
      "@blksails/pi-web-kit": ">=0.5"
    },
    "registryDeps": []
  },
  "bindings": { "surfaceCommands": { "canvas": ["watermark_apply"] } }
}
```

字段语义（与 shadcn `registry.json` 的对应）：

| 字段 | 含义 |
|---|---|
| `files` | 要拷的源文件清单（相对包根；MUST 含测试文件，§7） |
| `target` | 落点，约定死为 `.pi/web/components/<id>/`（禁自定义逃逸，路径须 realpath 后落在目标 source 内） |
| `wiring` | 接线声明：插件点（`canvasPlugins` / 未来 `renderers`、`slots`）、导出名、import 路径。v1 用于打印指引，v2 用于 codemod |
| `peer` | 假设存在的基线（shadcn 假设 tailwind+radix，我们假设 canvas-kit / web-kit 的 semver 范围） |
| `registryDeps` | 组件间依赖，递归拷（shadcn 同名机制） |
| `bindings.surfaceCommands` | 沿 SES-X4：`via:"command"` 动作锚定 agent 端命令名，供能力避让与文档对照 |

### 4.3 安装落点与溯源

```
my-agent/.pi/web/
├── web.config.tsx                   # 接线点（§4.4）
├── components/                      # add 的落点，代码归使用者
│   └── watermark/
│       ├── watermark.tsx
│       ├── watermark.test.tsx
│       └── .component.json          # 溯源清单（本设计新增）
└── dist/                            # pi-web build 产物（不入库）
```

`.component.json`（shadcn 没有、我们该有——为 `update` 的分叉检测服务）：

```json
{
  "id": "canvas-watermark",
  "version": "0.2.0",
  "origin": "git+https://github.com/blksails/canvas-components#canvas-watermark",
  "installedAt": "2026-07-09T00:00:00Z",
  "files": {
    "watermark.tsx": "sha256:9f2a…",
    "watermark.test.tsx": "sha256:1c8b…"
  }
}
```

哈希记录的是**安装时刻**的文件摘要。`pi-web update <id>`：落盘文件哈希与记录一致 →
安全覆盖新版本并刷新记录；不一致 → 使用者改过，打印上游 diff 让其自行合并，不覆盖。

### 4.4 接线（wiring）

v1（MUST）：只打印指引，零改写风险——

```tsx
// CLI 打印：在 .pi/web/web.config.tsx 添加
import { watermarkBundle } from "./components/watermark/watermark";
// defineWebExtension({...}) 内：
canvasPlugins: [watermarkBundle],
```

v2（SHOULD）：保守 codemod——仅当能无歧义识别 `defineWebExtension({ ... })` 字面量
与 `wiring.point` 对应数组（或可安全新增该键）时才改写；任何不确定 → 回退 v1 打印。
codemod 失败不算安装失败（文件已落盘，接线是使用者动作）。

### 4.5 CLI 命令面

```
pi-web add <id>                        # 经 registry 解析（复用 install 的来源解析/直连降级机构）
pi-web add git+https://…#<id>          # git 直连，绕过 registry
pi-web add <id> --dry-run              # 只打印将拷贝的文件与接线 diff，不落盘
pi-web add <id> --target <sourceDir>   # 显式指定目标 source（缺省：cwd 是 source 时用 cwd）
pi-web update <id>                     # §4.3 的分叉检测更新
pi-web list --components               # 列出目标 source 已装组件（读 .component.json）
```

安装步骤（全部复用既有机构）：

```
来源解析（Req 8 同款 registry/直连降级）
  → 清单读取 + kind:"component" 判别
  → peer semver 校验（对目标 source 的 node_modules / workspace 实际版本）
  → registryDeps 递归解析（环检测，同 id 已装则跳过）
  → 文件拷贝（create 骨架写入机构，3.2 同款；target 路径 realpath 门控）
  → .component.json 溯源写入（4.1 登记表同款套路，粒度换成组件）
  → 接线：v1 打印 / v2 codemod
  → 提示 pi-web build
```

### 4.6 组件源码契约（示例）

与 `stickers.tsx` 同构：三件套进一个 `CanvasPluginBundle`，作者只写本地名。

```tsx
/**
 * canvas-watermark 组件：水印图层 + 放置工具 + 批量动作。
 * 经 `pi-web add` 拷入后归宿主 source 所有；命名空间前缀由消费方
 * defineWebExtension 的 manifestId 施加（作者只写本地名）。
 */
import {
  defineCanvasLayer,
  defineCanvasTool,
  defineCanvasAction,
} from "@blksails/pi-web-canvas-kit";
import type { CanvasPluginBundle } from "@blksails/pi-web-canvas-kit";

interface WatermarkData {
  readonly text: string;
  readonly opacity: number; // 0..1
}

const WATERMARK_DEFAULT: WatermarkData = { text: "© pi-web", opacity: 0.35 };

/** 图层：Render 显示 / bake 拍平烤字 / Inspector 调透明度。 */
const watermarkLayer = defineCanvasLayer<WatermarkData>({
  type: "watermark", // 前缀化后 = "<宿主 manifestId>:watermark"
  Render: ({ layer, scale }) => {
    const d = (layer.data as WatermarkData | undefined) ?? WATERMARK_DEFAULT;
    return (
      <span data-watermark-text style={{ opacity: d.opacity, fontSize: `${14 * scale}px` }}>
        {d.text}
      </span>
    );
  },
  bake: (ctx2d, layer, size) => {
    const d = (layer.data as WatermarkData | undefined) ?? WATERMARK_DEFAULT;
    if (typeof ctx2d.fillText !== "function") return; // 原语缺省 → 退化跳过，拍平不阻塞
    ctx2d.globalAlpha = d.opacity;
    ctx2d.fillText(d.text, 8, size.height - 12);
    ctx2d.globalAlpha = 1;
  },
  Inspector: ({ layer, update }) => {
    const d = (layer.data as WatermarkData | undefined) ?? WATERMARK_DEFAULT;
    return (
      <input
        type="range" min={0.1} max={1} step={0.05} value={d.opacity}
        onChange={(e) => update({ ...d, opacity: Number(e.currentTarget.value) })}
      />
    );
  },
});

/** 工具：点击置层（写路径归装配层，不在工具内改层）。 */
const watermarkTool = defineCanvasTool({
  id: "watermark",
  label: "水印",
  createLayer: { kind: "watermark", data: WATERMARK_DEFAULT },
});

/** 动作：批量打水印，via:"command" 走命令通道（SES-X3 能力避让）。 */
const watermarkAction = defineCanvasAction({
  id: "watermark-batch",
  via: "command",
  command: { action: "watermark_apply" },
  match: (input, capability) =>
    capability.actions.includes("watermark_apply") && input.selection.length > 0
      ? 30
      : false, // agent 未声明该命令 → 不参与决策（退化安全）
});

export const watermarkBundle: CanvasPluginBundle = {
  tools: [watermarkTool],
  layers: [watermarkLayer],
  actions: [watermarkAction],
};
```

接线前后对照（目标 source 的 `web.config.tsx`）：

```tsx
// ── 安装前 ──
export default defineWebExtension({
  manifestId: "my-agent",
  capabilities: ["slots"],
  slots: { launcherRail: CanvasLauncher as never, panelRight: CanvasPanel as never },
});

// ── 安装后 ──
import { watermarkBundle } from "./components/watermark/watermark";

export default defineWebExtension({
  manifestId: "my-agent",
  capabilities: ["slots"],
  slots: { launcherRail: CanvasLauncher as never, panelRight: CanvasPanel as never },
  canvasPlugins: [watermarkBundle],
});
```

### 4.7 命名空间归属（与车道②的本质区别）

拷入后插件的命名空间前缀是**宿主 source 的** `manifestId`（`registerPluginBundles`
按消费方施加），不再是原组件包的 id。这正是「代码归你」在命名空间上的体现：同一
组件被两个 source 各自 add，是两个互不相干的插件实例，同名不冲突。`requires` 沿
既有规则用前缀化后的全局名（作者写本地名即可自动一致）。

## 5. 安全模型

源码组件车道**合法地绕开运行时验签**：代码拷入即 first-party，operator 自己 build
自己跑。信任模型从「运行时验证不可见 dist」（车道②）变为「**安装时人审可见源码**」
——与 shadcn 哲学一致。为此：

- **MUST** `--dry-run` 完整列出将落盘的文件与接线 diff，供安装前审阅。
- **MUST** `target` 路径 realpath 门控（拷贝不得逃逸目标 source；沿 scan-provider
  同款判据）。
- **MUST** 拷贝是纯文件写入：`add` 本身不执行组件包的任何代码（无 postinstall 语义）。
- **SHOULD** registry 侧收录时做静态准入（§7），但这是发布侧治理，不是安装侧信任根。
- 组件经 `pi-web build` 进入 `.pi/web/dist/` 后，走 source 自身既有的加载/门控路径，
  不新增任何浏览器侧信任面。

## 6. 更新与分叉（明说的取舍）

shadcn 模式的固有代价：**拷完即分叉，上游更新不自动跟**。本设计不掩盖它，只做两件事：

1. `.component.json` 哈希基线 + `pi-web update` 的三态：未改 → 覆盖；已改 → 打印
   上游 diff 不覆盖；上游无新版 → no-op。
2. 文档明写选型判据（§3）：要自动升级就用车道②，不要抱怨车道④不升级。

## 7. 质量线与准入（registry 收录门槛）

- **MUST** `files` 含测试文件；组件所有接缝 prop 可注入（SES-T4），jsdom 缺失 API
  判空降级。
- **MUST** README 附 SES §8 自检清单勾选记录（组件适用子集：N 命名 / U1 注入集 /
  U2 退化 / X3 能力避让）。
- **MUST** 组件源码只 import `peer` 声明过的包 + 相对路径；出现未声明的裸包名 import
  即拒收（这是「拷进任何 source 都能编译」的硬保证）。
- **SHOULD** 提供 `--dry-run` 可读的一句话能力描述（displayName/description 完整）。

## 8. 分期路线

| 期 | 交付 | 回归线 |
|---|---|---|
| v1 | `add`（registry + git 直连 + dry-run）、`.component.json` 溯源、接线打印、`update` 三态、schema 加 `component` kind | 把 stickers 捆抽成组件包，`add` 进一个干净 source 后 build + e2e 与车道①行为一致（**自举即验收**，沿 SES-X1 精神） |
| v2 | 接线 codemod、`registryDeps` 递归、`list --components`、pi-clouds registry 的 component kind（依赖注册表侧加法） | codemod 对 examples 全部 `web.config.tsx` 幂等（跑两遍无 diff） |
| 后续候选 | 组件模板（`create --kind component`）、非 canvas 插件点（renderers/slots）的 wiring 支持 | — |

## 9. 明确不做（本轮）

- 不做组件 marketplace / 发现推荐 UI（与 webext-package-install 的 Phase 2 排除项一致）。
- 不改车道②的任何行为；不给车道④加运行时签名（违背其信任模型）。
- 不做自动三方合并（update 分叉只给 diff，不做 merge）。
- 不做组件级版本锁文件（`.component.json` 即最小溯源，不引入 lockfile 语义）。

## 10. 未决问题（立 spec 前拍板）

1. **落点目录名**：`.pi/web/components/` vs `.pi/web/plugins/`。倾向 `components/`
   （与 shadcn 心智一致；「plugin」在本仓已被车道②与 pi 扩展占用，避免过载）。
2. **`update` 的 diff 呈现**：终端 unified diff vs 落一个 `<file>.upstream` 旁路文件。
   倾向前者（不污染 source）。
3. **peer 校验失败的强度**：硬失败 vs 警告继续。倾向硬失败 + `--force` 逃生门
   （编译期反正会炸，早炸信息更好）。
4. **组件粒度进 pi-clouds registry 的形态**：registry 加 `kind:"component"`（与
   plugin 同一波加法）vs 独立 components 索引。v1 用 git 直连 + 本仓内置库即可先行，
   此问题可推迟到 v2。
5. **wiring 多插件点的 schema**：v1 只支持 `canvasPlugins` 一个 point，schema 是否
   预留 union（`renderers` / `slots`）。倾向预留枚举但实现只认 `canvasPlugins`。
