# @blksails/pi-web-wecom

pi-web **Extension** 工具包：让 agent 通过 **pi-gateway** 与企业微信交互。

默认对话回写仍由 gateway 的 turn 路径完成（LLM 无感）。本包提供**主动**能力：

| 工具 | 作用 |
|------|------|
| `wecom_send` | 向绑定会话 / 指定 thread 推送文本 |
| `wecom_send_file` | 发文件（单聊优先；path 或 base64） |
| `wecom_send_menu` | 按钮菜单卡片（单聊 `button_interaction`） |
| `wecom_get_binding` | 查询当前 session 的 channel 绑定 |
| `wecom_gateway_health` | 查看 gateway / WeCom 通道健康（公开探针级） |
| `wecom_admin_whoami` | 当前绑定用户的 admin/user 角色 |
| `wecom_admin_list` | 列出有效管理员（需 admin） |
| `wecom_admin_grant` / `wecom_admin_revoke` | 运行时 state 名单（需 admin；不可撤 baseline） |
| `wecom_gateway_status` | 运维摘要（需 admin） |

**安全模型**：操作者身份只来自 gateway 的 `sessionId → channel binding.userId`，模型参数里的 userId 不能冒充 actor。  
运维 agent 才建议把 `wecom_admin_grant` / `wecom_admin_revoke` 放进 tools allowlist。

斜杠命令：`/wecom-status`

## 依赖

- 运行中的 **pi-gateway**（默认 `http://127.0.0.1:7930`）
- Session 若从企微创建，gateway 会登记 `sessionId → endpoint` 绑定

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PI_GATEWAY_BASE_URL` | `http://127.0.0.1:7930` | gateway 地址 |
| `PI_GATEWAY_CHANNEL_ID` | `wecom` | 默认 channel id |
| `PI_GATEWAY_TOKEN` | — | 可选鉴权 |
| `PI_WEB_SESSION_ID` | 从 `--session-id` 解析 | 会话 id |

## 在 agent 中挂载

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { wecomExtensionEntryPath } from "@blksails/pi-web-wecom/entry-path";

const wecomExt = wecomExtensionEntryPath();

export default defineAgent({
  ...(wecomExt ? { extensions: [wecomExt] } : {}),
  tools: [
    "bash",
    "wecom_send",
    "wecom_get_binding",
    "wecom_gateway_health",
  ],
});
```

或绝对路径：

```ts
extensions: [
  "/path/to/pi-web/packages/wecom-extension/src/index.ts",
],
```

## 开发

```bash
cd packages/wecom-extension
pnpm install
pnpm test
pnpm typecheck
```
