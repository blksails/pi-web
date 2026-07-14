# attachment-catalog-agent

agent 附件目录的端到端范例(spec `agent-attachment-catalog`)——演示 **agent 为会话提供一个动态附件目录**,用户经 `@` 补全发现、选中惰性物化;agent 也能运行期主动推送产物,让已连接前端免刷新感知。

核心事实:

- agent 定义只声明 `attachmentCatalog: { list, resolve }`;`list(query)` 按名字过滤枚举条目(纯数据投影,handler 本身不出子进程),`resolve(entryId)` 只在用户真正选中(或提交期兜底)时才被调用一次产出字节。
- 选中目录条目后,前端立即插入 `@catalog:<entryId>` token,后台异步物化;成功后 token 原位换写为标准 `@attachment:<attId>`(与普通上传附件完全同等待遇);失败会撤回 token 并提示。
- 重复选中同一条目(同 `entryId`+`version`)不会重复落库(幂等由子进程侧的目录桥保证)。
- `publish` 是另一条正交路径:agent 可以在运行期(不等用户选中)主动落一个产物附件并广播事件,已连接前端会在 `@` 补全的 catalog 分组立即看到新条目,免刷新页面。

## 目录结构

```
attachment-catalog-agent/
├── index.ts        # defineAgent:attachmentCatalog 声明(内存目录)+ publish-demo route
├── package.json
└── README.md
```

## 试一下

以本目录为 agent source 启动会话(`pi-web ./examples/attachment-catalog-agent`),然后:

### 1. 补全发现

在输入框敲 `@`,补全浮层里应出现「目录」分组,列出三份示例条目(Monthly Report / Quarterly Summary / Changelog)。继续打字过滤(如 `@month`)只留下匹配项。

### 2. 选中物化

选中其中一项——输入框里的 `@catalog:monthly-report` 会在后台物化完成后自动换写为 `@attachment:att_…`,并出现缩略预览(纯文本无缩略图,但预览条会显示文件名)。发送消息,附件按标准分发路径可读。

### 3. 幂等复用

再次选中同一条目(如又打了一次 `@month` 并选中 Monthly Report):不会重复落库,物化端点返回**同一个** `attachmentId`(可用浏览器 Network 面板对比两次 `POST .../materialize` 的响应)。

### 4. 主动推送(publish)

```bash
curl -X POST http://127.0.0.1:3000/api/sessions/<id>/agent-routes/publish-demo
# → {"ok":true,"attachmentId":"att_…"}
```

调用后,不刷新页面、不重新打开会话,前端下次弹出 `@` 补全浮层时(或浮层已开启时)应立即看到新条目——这条不经过 `list`/`resolve`,是 agent 运行期主动落库 + 广播推送事件(`control:"attachment"`)驱动的。

## 相关

- 声明面契约:`AgentDefinition.attachmentCatalog` / `CatalogEntry` / `CatalogResolved`(`@blksails/pi-web-agent-kit`)
- `AttachmentToolContext.publish`(运行期主动推送,`@blksails/pi-web-agent-kit`)
- 惰性物化的落库路径与幂等锚:spec `agent-attachment-catalog`(design.md §materialize)
- 附件工具桥(`putOutput`/`resolve` 完整范式):[attachment-tool-agent](../attachment-tool-agent/)
- 具名写目标 profile(本例的落库继承宿主拓扑/profile 写路由):[attachment-profile-agent](../attachment-profile-agent/)
- 声明式 routes(本例的 publish-demo 观察通道):[agent-routes-demo](../agent-routes-demo/)
