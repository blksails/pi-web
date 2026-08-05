# Tasks · cli-run-task

## Implementation Notes

- 2026-08-05：补录 spec；实现已在 `bin/pi-web.mjs` + `test/cli/cli-run-task.test.ts` 落地，下列任务以验收/收口为主。
- 2026-08-05 验收证据（scratch）：
  - unit：`cli-run-task-tests.log` — 73 passed，exit 0
  - parse smoke：`parse-smoke.log` — intent run-task，attachments 剥 `@`，open true
  - live stub：`run-launch.log` — 会话已创建 + 首条消息已发送 + `/session/<id>`（`LAUNCH_BOOTSTRAP_OK`）
  - 状态：`kiro-status.txt`

## Tasks

- [x] 1. 命令面与解析
  - [x] 1.1 在 `SUBCOMMAND_NAMES` / `SUBCOMMAND_SPECS` 注册 `run`，实现 `pi-web run --help` 与顶层帮助列表
    - _Requirements: 1.1, 1.2_
    - _Boundary: bin/pi-web.mjs_
  - [x] 1.2 实现 `expandRunAttachmentArgv`、`stripAttachmentAtPrefix`、`buildRunTaskIntent` / `parseCliArgs` 的 run-task 意图（prompt、source、model、provider、attachments/`@`、open、port 校验）
    - _Requirements: 1.3, 1.4, 2.1–2.5, 3.2, 3.3_
    - _Boundary: bin/pi-web.mjs_
    - _Depends: 1.1_

- [x] 2. 启动与编排
  - [x] 2.1 `buildEnv` 映射 `PI_WEB_DEFAULT_MODEL` / `PI_WEB_DEFAULT_PROVIDER`；`main` 对 run-task 走 `launch`
    - _Requirements: 2.2, 2.5, 4.1_
    - _Boundary: bin/pi-web.mjs_
    - _Depends: 1.2_
  - [x] 2.2 `launch` 支持 `onReady`；成功后 `--open` 使用会话 URL
    - _Requirements: 4.3, 4.4_
    - _Boundary: bin/pi-web.mjs_
    - _Depends: 2.1_
  - [x] 2.3 实现 `bootstrapRunTask`：create → setModel? → upload → stream → messages；阶段日志
    - _Requirements: 3.1, 3.4, 3.5, 4.1, 4.2, 4.5_
    - _Boundary: bin/pi-web.mjs_
    - _Depends: 2.2_

- [x] 3. 测试与收口
  - [x] 3.1 单测：产品 argv 解析 + bootstrap mock 顺序 + 子命令列表含 run
    - _Requirements: 5.1–5.4_
    - _Boundary: test/cli/cli-run-task.test.ts, test/cli/subcommand-router.test.ts_
    - _Depends: 1.2, 2.3_
  - [x] 3.2 运行测试并保留新鲜证据；可选 `--stub` 实机或记录缺产物
    - _Requirements: 5.2, 5.3_
    - _Depends: 3.1_

## Non-goals deferred

- Tauri 桌面深链
- Headless 等回合结束
- Playwright 全量 e2e
