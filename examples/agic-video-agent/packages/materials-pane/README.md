# @aigc-agent/materials-pane

可移植的 Pi-web 素材 Pane 模块。其公共聚合 `materialsPanePackage` 同时提供：

- `pane`：Guest 入口、权限与事件声明；
- `routes`：会话附件、webapp 素材库、分发状态三条 Agent Route；
- `extensions`：`surface:materials` 热态与按需启用的 Pi CustomTools；
- `application`：Pane、MCP、CustomTools 共用的类型化 `MaterialsApplicationService`；
- `ai`：同源 schema 的 MCP 清单与 CustomTools 薄适配。

复制本目录到任意 Agent 后，将上述三项分别并入该 Agent 的 panes、routes、extensions
清单即可；无画布时“编辑”自动降级为带附件的对话消息。平台回调和 webapp 未配置时，
仍会展示当前会话附件。Guest 自带并注入完整样式，不依赖 AIGC Agent 的 CSS。

```ts
import { materialsPaneModule } from "./packages/materials-pane/src/module.js";
import { materialsRoutes } from "./packages/materials-pane/src/routes/index.js";
import { materialsSurfaceExtension } from "./packages/materials-pane/src/surface.js";
```

三项均为标准 Pi-web 接口；只需并入既有清单，无需改组件、路由 handler 或宿主。

## 数据与安全边界

`surface:materials` 仅保存选中、过滤、会话目录映射及远端失效序号；企业素材实体、目录
及二进制以 webapp BFF 为唯一真相源。ID 边界：

- 会话附件：`att_*`，随会话生命周期，由 Surface 轮末清理失效引用；
- 企业素材：BFF 原始 ID，对 Pane 投影为 `material:<id>`，目录与改名皆写 BFF；
- AI 工具入参使用原始企业 ID，不接受 `tenantId`，租户恒由桌面 Bearer 与 BFF/RLS 判定。

应用服务将旧 Pane 操作收敛为判别联合：
`create-folder`、`rename-folder`、`delete-folder`、`move-materials`、
`rename-materials`、`delete-materials`、`distribute`；查询为
`search`、`get`、`status`、`locate`。BFF `401/403/404/409` 分别映射为
`unauthorized/forbidden/not_found/conflict`；冲突不盲重试。
单项改名采用末写胜；删除、移动、批量改名及投放按租户作用域幂等；同键异命令返回
`idempotency_conflict`（409），仅 5xx 可持原键重试。

删除、批量改名/移动及投放必须携显式确认与幂等键。成功写返回 `requestId` 与
`refresh.revision`，经失效信号令 Pane 重查 BFF；AI 适配器不直接写 Surface。
默认仅暴露现有 pi-labs MCP；仅当
`PI_LABS_MATERIALS_AI_ADAPTER=custom-tools` 时改为注册六个 Pi CustomTools。
