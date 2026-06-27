# Implementation Plan

> 不改 `@` 框架 / pi SDK / runner。前端 ui 包 + server 一个新端点 + 装配层 provider。

- [x] 1. 阶段解析纯函数 + 契约类型
  - 新增 `packages/ui/src/controls/command-arg.ts`：`CommandArgItem`/`SubcommandSpec`/`CommandArgSpec`/`CommandArgProvider`/`CommandStage` + `parseCommandStage(value, spec)`。
  - 单测 `packages/ui/test/controls/command-arg.test.ts`：命令名/子命令/参数边界、尾空格、跳 `-l`、未知子命令、spec 缺省降级、参数段 `[start,end)`。
  - _Requirements: 1.5, 4.1, 4.2, 4.3_

- [x] 2. server install-sources 端点
  - 新增 `packages/server/src/extensions/routes/install-sources.ts`：`GET /sessions/:id/install-sources?q` 扫 `session.cwd` 浅层可装目录（含 index.*/package.json/.pi）→ `local:<rel>`；realpath 越界防护；q 过滤；限量；无会话 404、空 `{sources:[]}`。
  - 挂载进 `packages/server/src/extensions/routes.ts` 的 `createExtensionRoutes`（注入 `store`）。
  - 单测 `packages/server/.../install-sources.test.ts`：扫描/过滤/越界/404/空。
  - _Requirements: 3.1, 3.3, 3.4, 3.5_

- [x] 3. PiCommandPalette 分阶段补全
  - 改 `packages/ui/src/controls/pi-command-palette.tsx`：新增 `commandArgProvider` prop；按 `parseCommandStage` 切换候选来源（命令名/子命令静态/参数异步防抖）；统一线性候选复用 `active`/`handleKey`/caret 锚定;select 分阶段（有 spec/非终态不提交、终态执行、参数替换最后一段 + setSelectionRange 就位）。
  - 单测：mock provider → 子命令展示、install 进参数阶段不提交、uninstall 调 listArgs、参数替换、终态 list 执行、无 spec 不回归。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 4.4, 5.1, 5.3, 5.4_

- [x] 4. 装配层默认 provider + PiChat 接线
  - 新增 `createPluginArgProvider({ apiBase, sessionId })`（ui 或 lib/app）：`specFor("plugin")` 静态 spec；`listArgs` 按 sub fetch `GET /extensions`（installedExt）/ `GET /sessions/:id/install-sources`（localSource），map+过滤。
  - `PiChat` 把 provider 传入 `PiCommandPalette`（用既有 client/sessionId/apiBase 接缝）。
  - 集成测试：mock fetch `GET /extensions` → `/plugin uninstall ` 出 id 候选、选中填充。
  - _Requirements: 2.1, 2.3, 3.2, 5.5_

- [x] 5. 回归与不变量
  - 确认未改 `@` 框架/pi SDK/runner；`extensionCommands` 放行 `plugin` 时补全可见。
  - `pnpm --filter @blksails/pi-web-ui test`、`pnpm --filter @blksails/pi-web-server test`、`pnpm typecheck` 全绿。
  - _Requirements: 5.2, 5.3_

- [x] 6. 浏览器 e2e
  - 扩展 `e2e/browser/slash-command-palette.e2e.ts`（或新增）：`/plugin ` → 子命令候选(fixed 锚定)；↓/Enter 选 install → `/plugin install ` 不发送；`install ` → 本地目录候选 `local:<dir>` 选中填充；`/plugin uninstall ` 空态不崩。
  - 隔离 build（`NEXT_DIST_DIR=.next-e2e` + `PI_WEB_DISABLE_STANDALONE=1` + external server + `PI_WEB_STUB_AGENT=1`）；放行 `plugin`（`extensionCommands`）。留新鲜证据。
  - _Requirements: 1.1, 1.3, 3.2, 2.4_
