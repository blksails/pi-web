---
name: schedule-prompt
description: 使用 schedule_prompt 工具创建/管理定时与一次性提醒（cron、间隔、相对时间）。用户提到定时、提醒、每隔、延迟执行、schedule、remind 时使用。
---

# schedule-prompt · 定时任务

## 后端

- 扩展：`pi-schedule-prompt`（`npm:pi-schedule-prompt`，user-scope 安装）
- 工具名：`schedule_prompt`
- 本 agent 已在 `extensions` 显式加载，并在 `tools` 白名单放行

## 何时触发

- 「每小时检查…」「5 分钟后提醒我…」「明天 9 点…」
- 列出 / 暂停 / 删除已有定时任务

## 步骤

1. 确认：任务文案（prompt）、时间表（schedule）、一次性还是周期。
2. **调用 `schedule_prompt`**，不要口头说「已设好」却不调工具。
3. `action=add` 时 **必须同时** 传 `schedule` + `prompt`。
4. 回报 job 名 / 下次运行时间；用户要管理时用 list / disable / remove。

## 参数要点

| 字段 | 说明 |
|------|------|
| `action` | add / list / remove / enable / disable / update / cleanup |
| `schedule` | `+10m`、`+1h`、`5m`、`1h`、6 段 cron（含秒，如 `0 */5 * * * *`）、ISO |
| `prompt` | 到期时注入会话的提示文本 |
| `type` | 周期默认 cron；相对/ISO 一次性用 `once` |
| `name` | 可选任务名；重名会失败 |
| `jobId` | remove/enable/disable/update 需要 |

## 示例

- 30 分钟后提醒：`schedule_prompt({ action: "add", type: "once", schedule: "+30m", prompt: "提醒用户检查 PR 状态" })`
- 每小时：`schedule_prompt({ action: "add", schedule: "1h", prompt: "汇总当前待办进度" })`
- 列出：`schedule_prompt({ action: "list" })`

## 禁止

- 在定时任务自己的执行上下文里再 `add` 新任务（扩展会拒绝，防死循环）
- 编造「已调度成功」而不调用工具
