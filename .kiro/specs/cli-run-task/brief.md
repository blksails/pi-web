# Brief · cli-run-task

## Problem

用户希望用一条 CLI 命令带着**提示词 + agent source + 模型/provider + 本地图片附件**直接开工，而不是：先 `pi-web ./agent --open` → 浏览器里选源 → 手传附件 → 再打字。

## Approach

在主 CLI 增加 `pi-web run <prompt>` 子命令：

1. 解析参数（含 `@path` 附件写法）
2. 启动与普通 `pi-web` 相同的本地实例
3. 就绪后编排：建会话 → 可选 setModel → 上传附件 → 先挂 SSE → 发首条消息
4. `--open` 时打开 **`/session/:id`**（resume 同一会话），不另建空聊

## Scope

- In: `bin/pi-web.mjs` 解析、env、launch 钩子、bootstrap 编排、单测、帮助文案
- Out: Tauri 深链、headless 等 agent 回合结束、Playwright 全量 e2e、包管理子命令

## Status

实现已在分支 `feat/cli-run-task` 落了一版；本 spec 为**补录 + 收口**，任务清单对照验收并补测试/证据。
