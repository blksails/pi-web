# attachment-tool-agent

attachment-tool-bridge 的端到端示例 agent（spec `attachment-tool-bridge`）。

## 它演示什么

装配示例图像工具 `edit_image`（见 [`./tools/edit-image-tool.ts`](./tools/edit-image-tool.ts)）为 customTool，演示「服务端图像工具用 `attachmentId` resolve 输入 → 处理 → `putOutput` 落库 → 回引用」的完整接入范式：

| 步骤 | 做什么 |
|---|---|
| 1. 上传 | 用户上传图 → 主进程注入文本引用 `[attachment id=att_… type=… name=…]` |
| 2. 调用 | 模型把 `att_id` 抄进 `edit_image({ attachmentId })` |
| 3. resolve | 工具在 runner 子进程内经注入的 `AttachmentToolContext.resolve` 解析输入附件（本地路径 / 网络 URL / 原始字节三形态） |
| 4. putOutput | 处理后经 `ctx.putOutput` 先落库（`tool-output`，与输入同一 id 空间）→ 回引用（回图为已 await 的裸 base64 string） |
| 5. 闸门 + 展示 | `afterToolCall` 闸门把内联 base64 剥成文本引用；前端经 `/raw` 分发 URL 展示 |

要点：

- **上下文注入**：`AttachmentToolContext` 由 runner 在装配 customTools 时以闭包注入（子进程 store + 当前 sessionId 已绑定），工具经约定 key `__piWebAttachmentToolContext__` 取用。
- **降级而非崩溃**：装配缺失 / 能力不可用时，`getAttachmentToolContext()` 返回 `available:false` 的安全降级上下文，工具仍可加载并报「附件能力不可用」（Req 3.4）。
- **守 webpack external 边界**：类型契约经 `@blksails/pi-web-agent-kit` 仅类型引用，无值依赖到 `@blksails/pi-web-server`。
- **自包含**：`noTools: "builtin"` 关内置工具，空 `skills` override 丢弃磁盘 skills。

> 这是 `packages/server/src/attachment-bridge/example-tool.ts` 的端到端 e2e 形态——同一接入范式，但写成 examples/ 下经 jiti 真实加载、装配为 customTool 的可运行形态。

## 运行

```bash
pi-web ./examples/attachment-tool-agent
```

前端 source 指向本目录即可。`model` 省略 → 继承 `~/.pi/agent/settings.json` 的默认 `provider` / `model`，与 `hello-agent` 同姿态。

上传一张图，然后说 *“编辑这张图”*：模型从注入的 `[attachment id=att_… …]` 标记里抄出 id 调 `edit_image`，工具 resolve → 处理 → 落库 → 回引用，前端展示编辑后的产物，并把结果 attachment id 报回给你。

## 相关示例

- [`aigc-agent`](../aigc-agent/README.md) — 在同一附件桥之上的真实 AIGC 生成 / 编辑工具。
- [`hello-agent`](../hello-agent/README.md) — 自定义工具的最小起点。
