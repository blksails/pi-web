---
name: sendaction
description: 使用本机 hnhuaxi/utils/sendaction 对腾讯广告做手动转化回传（click_id / Web GET·POST / API）。用户提到手动回传、sendaction、回传 click_id、补回传、转化回传时使用。
---

# sendaction · 手动回传（真实 CLI）

## 后端位置

- 项目根：`/Users/hysios/Projects/hnhuaxi/utils/sendaction`（可用 env `SENDACTION_ROOT` 覆盖）
- 入口：`go run .`（cwd 固定为项目根）
- 账号密钥：目录内 `.env` / `.env.<accountId>`（`GDT_ACCESS_TOKEN`、`ACCOUNT_ID`、`USER_ACTION_SET_ID`）
- Agent 工具：`sendaction`（包装上述 CLI；**token 永不回显**）

## 何时触发

- 手动回传 / 补回传 / 转化回传
- sendaction / click_id 回传
- 「把这个 click_id 回传一下」「Web 转化补一发」

## 模式对照（mode）

| mode | 场景 | 必需参数 |
|------|------|----------|
| **2**（默认，最常用） | Web 转化 GET `tracking.e.qq.com/conv/web` | `click_id`；`link` 默认 `https://pub.wdshquan.top` |
| **3** | Web 转化 POST `/conv` | `click_id`；`link` 同上，可选 `action_params` |
| 0 | callback URL POST | `callback`，可选 `imei` |
| 1 | Marketing API UserActions.Add | `click_id` + token/account |
| 4 | 微信转化 POST | `click_id` + `wechat` |
| 5 | Marketing API v3 | `click_id` + `link` + token |

等价 shell：

```bash
# mode 2 — send.sh
cd /Users/hysios/Projects/hnhuaxi/utils/sendaction
go run . -mode 2 -click_id=$CLICK -link=$URL -action_type=RESERVATION

# mode 3 — send3.sh
go run . -mode 3 -click_id=$CLICK -link=$URL -action_type=$TYPE -action_params='{"value":1}'
```

## 步骤

1. **收集参数**：`click_id`（或批量 `click_ids`）、可选 `link`（**默认 `https://pub.wdshquan.top`**）、`action_type`（默认 `RESERVATION`）、`mode`（默认 2）。
2. **切账号（如需）**：
   - 先 `sendaction({ list_accounts: true })` 看有哪些 `.env*`；
   - 或直接 `env_file: ".env.74"` / `account_id: 74`。
3. **先预览**：不设 `confirm` 或 `confirm: false`，核对命令与 click_id / link。
4. **用户明确确认后**，再 `confirm: true` 真正回传。
5. **如实汇报**工具返回的 stdout/stderr（已脱敏）；不要编造「已成功」若退出码非 0。

## 工具参数

| 字段 | 说明 |
|------|------|
| mode | 0–5，默认 2 |
| click_id / click_ids | 单个或批量（批量串行） |
| link | 完整落地页 URL（mode 2/3/5）；**默认 `https://pub.wdshquan.top`**，可用 `SENDACTION_LINK` 覆盖 |
| action_type | 默认 RESERVATION；常用 REGISTER / PURCHASE / COMPLETE_ORDER / CONFIRM_EFFECTIVE_LEADS / DELIVER |
| action_params | JSON 字符串（mode 3/4/5） |
| callback / wechat / imei | 对应 mode 0 / 4 / 0 |
| account_id / user_action_set_id | 可覆盖 env 文件 |
| env_file | 如 `.env.74` |
| confirm | **true 才真正回传** |
| list_accounts | 只列 env 文件名 |

## 示例

- 预览单条 Web 回传（用默认 link）：
  `sendaction({ mode: 2, click_id: "wx0vuf3x5fzpc2ey00" })`
- 确认执行：
  `sendaction({ mode: 2, click_id: "wx0vuf3x5fzpc2ey00", confirm: true })`
- 覆盖 link：
  `sendaction({ click_id: "…", link: "https://other.example.com/h/xxx", confirm: true })`
- 批量：
  `sendaction({ click_ids: ["id1", "id2"], action_type: "RESERVATION", confirm: true })`
- mode 3 带参数：
  `sendaction({ mode: 3, click_id: "…", action_params: "{\"value\":100}", confirm: true })`
- 指定账号 env：
  `sendaction({ env_file: ".env.74", mode: 2, click_id: "…", confirm: true })`

## 纪律

- **不可撤销**：回传会影响广告平台转化统计与优化；未确认前只用预览。
- **禁止**在未拿到真实 `click_id` 时瞎编 ID 试跑生产接口。
- **禁止**把 `GDT_ACCESS_TOKEN` 或完整 `.env` 内容贴进对话 / 群聊。
- 与 BlackSail 控制台「手动回传」workflow 不同：本工具是**本机 CLI 直连腾讯 tracking/API**，不走 Temporal / pushes 表。
- 若用户意图是控制台批量深浅过滤回传，应说明差异并引导走 BlackSail 产品能力；本 skill 只覆盖 sendaction CLI。

## 沙盒（bash 侧）

项目 `.pi/sandbox.json` 已放行：

- 读：`…/hnhuaxi/utils/sendaction`、Go 工具链、`GOPATH`、`GOCACHE`
- 写：`GOCACHE`、`/tmp` / `/var/folders`（go 临时文件）、`GOMODCACHE`（可选）
- 网：`tracking.e.qq.com`、`api.e.qq.com` 等
- **硬拒写** `.env*`（不可用 bash 改账号密钥）

若 bash 报 Read/Network blocked，先查该文件；改完后需**新会话**。优先用工具 `sendaction`，不要手写 token 进命令行。
