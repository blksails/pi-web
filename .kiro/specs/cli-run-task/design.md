# Design Document · cli-run-task

## Overview

在薄启动器 `bin/pi-web.mjs` 内增加 **`run` 子命令**，与包管理子命令（走 `dist/cli-commands.mjs`）分流：`run` 复用既有 `buildEnv` + `launch`，在 `onReady` 钩子中用 HTTP 编排首条任务。

## Architecture

```
argv
  └─ parseCliArgs
       ├─ run → expandRunAttachmentArgv → buildRunTaskIntent  → intent: "run-task"
       └─ 其它子命令 / 默认 start → 既有路径

main(run-task)
  ├─ buildEnv({ source, model, provider, … })  → PI_WEB_DEFAULT_* + AUTOSTART
  └─ launch({ onReady })
       └─ bootstrapRunTask
            POST /api/sessions
            POST /api/sessions/:id/models   (provider+model 同时给出时)
            POST /api/sessions/:id/attachments × N
            GET  /api/sessions/:id/stream   (先挂，后台 drain)
            POST /api/sessions/:id/messages { message, attachmentIds? }
            return { sessionId, url: `${base}/session/${id}` }
       └─ --open → openBrowser(sessionUrl)
```

## Components

| 组件 | 职责 |
|------|------|
| `SUBCOMMAND_SPECS.run` | 选项形状 + 帮助文案 |
| `expandRunAttachmentArgv` | `--attachments a b` / `a,b` → 重复 `--attachment` |
| `stripAttachmentAtPrefix` | 剥 `@` |
| `buildRunTaskIntent` | 校验 prompt、端口、组装 run-task 对象 |
| `buildEnv` | 映射 model/provider 到 `PI_WEB_DEFAULT_*` |
| `launch.onReady` | 就绪后异步钩子；可覆盖 open URL |
| `bootstrapRunTask` | 可注入 `fetchImpl` 的编排；纯 HTTP，无 UI |
| `guessMimeFromPath` | 上传 MIME |

## Key Decisions

1. **不进 `cli-commands.mjs`**：编排依赖 `launch` 与本机 fetch，放在壳层避免打包与路径问题。
2. **`--open` 进 `/session/:id`**：前端 resume 加载历史，避免 autostart 在 `/` 再建空会话。
3. **stream-before-message**：遵守 HTTP API 竞态约定；CLI 侧仅 drain，展示靠 UI/history。
4. **setModel 失败降级警告**：避免网关瞬时错误导致「整次 run 白做」；默认 model 仍可能经 env 生效。
5. **附件不内联 base64 进 prompt**：走 attachmentIds，与附件系统不变式一致。

## Error Handling

| 场景 | 行为 |
|------|------|
| 缺 prompt / 未知选项 / 非法 port | `CliUsageError`，main 退出 1，不 spawn |
| 附件不存在 | bootstrap 抛错，launch 打印「任务引导失败」 |
| create/upload/messages 非 2xx | 抛错，含 HTTP 状态与 body 摘要 |
| setModel 非 2xx | warn，继续 |
| 无 dist 产物 | launch 既有错误文案 |

## Testing Strategy

- 单元：`test/cli/cli-run-task.test.ts` 驱动导出函数 + mock fetch 顺序
- 回归：`test/cli/subcommand-router.test.ts`、`cli-args.test.ts`
- 可选：`--stub` 实机 `pi-web run`（需 `dist/server.mjs`）

## Non-goals (design)

见 requirements Boundary；不在本设计扩展桌面深链或 headless 等回合。
