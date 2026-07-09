# aigc-agent

`@blksails/pi-web-tool-kit` AIGC 生成工具的端到端示例 agent（spec `aigc-generation-tools`）。

## 它演示什么

经 `extensions: [aigcExtension, visionExtension]` 装载（`image_generation` / `image_edit` / `image_vision`），
演示「生成 / 编辑图像 → 产物落库 → 回引用 → 富渲染」整链路，以及**回看**已落库的图：

| 场景 | 链路 |
|---|---|
| 文生图 | 用户发文本 prompt → 模型调 `image_generation({ prompt })` → provider 生成 → 产物经 attachment store 落库 → 工具回 `att_<id>` 引用 |
| 图编辑 | 用户上传图（主进程注入 `[attachment id=att_… …]` 引用）→ 模型把 att_id 抄进 `image_edit({ instruction, image })` → 编辑器解析输入附件为 data URI → provider 编辑 → 产物落库回引用 |
| **回看** | 落库后的图在上下文里只剩 `att_` 文本标记（读得到 id、**读不到像素**）→ 模型把 att_id 抄进 `image_vision({ image, question })` → 取回字节 → 委派给一个支持图像输入的模型 → 返回文字结论 |

于是「生成一张图 → 让 agent 描述它到底画了什么」这个闭环得以成立——在 `image_vision` 之前它做不到。
用户也可以直接敲 `/img_vision <问题>` 看会话内最近一张图（结论经 `ctx.ui` 呈现，不进消息历史）。

> 视觉模型来自 `~/.pi/agent/models.json` 中 `input` 含 `"image"` 且凭据可用的模型（无静态清单，
> 新增即可选）；有交互界面时弹层让你选。**主模型无须支持图像输入** —— 识别被委派出去了。
> 详见 [vision-agent](../vision-agent/)。

要点：

- **降级而非崩溃**：工具在 runner 子进程内经注入的 `AttachmentToolContext`（globalThis seam）落库；装配缺失 / provider 密钥缺失时，工具仍加载并返回「能力不可用 / 缺少配置」降级（Req 5.3）。
- **provider 密钥走环境变量**：如 `DASHSCOPE_API_KEY` / `OPENROUTER_API_KEY` / `NEWAPI_API_KEY`；缺失则对应变体调用降级。
- **不进 Next bundle**：工具执行层经 `@blksails/pi-web-tool-kit/runtime` 子入口引入（含 pi SDK 值导入，仅 jiti 子进程加载）。
- **自包含**：`noTools: "builtin"` 关内置工具，空 `skills` override 丢弃磁盘 skills，保持示例 hermetic。

### `.pi/web` UI 扩展

`.pi/web/web.config.tsx` 提供一个 Tier2 自定义 tool 渲染器：复用宿主 `PiToolPart` 壳（保留工具名 / 状态 / 可折叠明细的默认外观），仅把 `output` 替换为含 `![](displayUrl)` 的 markdown 字符串，使产物在工具卡片内直接显示为 `<img>` 图片。

## 运行

```bash
pi-web ./examples/aigc-agent
```

前端 source 指向本目录即可。`model` 省略 → 继承 `~/.pi/agent/settings.json` 的默认 `provider` / `model`，与 `hello-agent` 同姿态。

至少配置一个 provider 密钥（如 `DASHSCOPE_API_KEY=…`）后启动；否则生成 / 编辑会走「缺少配置」降级而非真正出图。然后试：

- *“画一只在月球上的猫”* → 模型调 `image_generation`，产物以图片卡片内联展示。
- 上传一张图并说 *“把背景换成海边”* → 模型调 `image_edit`，回引用并展示编辑结果。

## 相关示例

- [`attachment-tool-agent`](../attachment-tool-agent/README.md) — attachment-tool-bridge 的底层接入范式（`resolve` → `putOutput` → 回引用）。
- [`hello-agent`](../hello-agent/README.md) — 自定义工具的最小起点。
