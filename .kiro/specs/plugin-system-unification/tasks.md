# Implementation Plan

> 范围：收口统一（不重建底层）。复用 `extension-management` / `webext-package-install` /
> `builtin-plugin-command` / `completion-provider-framework` / `agent-web-extension`。
>
> **实现期现实校正（勘探后）**：原 design 标为缺口的 R5（路由挂载）、R2.3（busy 修复）、
> R6（补全合流）经勘探确认**已满足**——仅需验证，非重新实现。真正的新工作为：统一清单标准
> （R1）、装完即时双路生效之路②前端接线（R7）、示例 + stub + e2e（R3/R8）。

- [x] 1. 统一清单契约（protocol 层）
- [x] 1.1 定义 `pi-plugin.json` 的 zod schema 与推断类型
  - `packages/protocol/src/plugin/plugin-manifest.ts`：`PluginManifestSchema`（id/version/pi/web/bindings）+ `PLUGIN_MANIFEST_FILENAME`；barrel `plugin/index.ts`；root `index.ts` 重导出
  - 完成证据：protocol typecheck 绿；server plugin 单测经包名 import 解析成功
  - _Requirements: 1.1, 1.5_
  - _Boundary: packages/protocol/src/plugin_

- [x] 2. 插件解析器（清单优先，目录回退）
- [x] 2.1 实现 `resolvePiPlugin(packageDir) → PluginDescriptor`
  - `packages/server/src/plugin/resolve-plugin.ts` + `plugin.types.ts`：清单优先；无清单回退 DefaultPackageManager 目录约定 + package.json 取 id/version；非法/缺失移入 diagnostics 不失败
  - 完成证据：`packages/server/test/plugin/resolve-plugin.test.ts` 5 例全绿（有清单/回退/dist 缺失/非法 JSON/路径缺失）
  - _Requirements: 1.2, 1.3, 1.4, 2.1, 4.1_
  - _Boundary: packages/server/src/plugin_

- [x] 3. 双路生效编排（缺口 B → 真缺口为路②前端接线）
- [x] 3.1 实现 `runInstallEffects`（编排器，纯逻辑 + 注入依赖）
  - `packages/server/src/plugin/effect-orchestrator.ts`：按 descriptor 分派路①(reloadRuntime)/路②(signalWebextReload)，Promise.all 并行、各自捕获（含同步 throw），任一失败不阻断
  - 完成证据：`effect-orchestrator.test.ts` 5 例全绿（仅pi/仅webext/双层/reload抛错/webext抛错）
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Boundary: packages/server/src/plugin_
- [x] 3.2 接通路②前端接线（真缺口：`setWebextReloadNonce` 此前从未被调用）
  - `PiChat` 新增 `onRuntimeReloadRequested` 接缝：onSubmit 扩展命令分支检测 `/plugin`、`/reload-runtime` → 触发；`components/chat-app.tsx` 装配为 `setWebextReloadNonce(n=>n+1)`
  - 完成证据：ui typecheck 绿；chat-app 接线
  - _Requirements: 7.1, 7.5, 7.6_
  - _Depends: 2.1, 3.1_

- [x] 4. 生产安装入口（R5 — 勘探确认**已满足**，验证非实现）
  - `lib/app/pi-handler.ts:435-446` 已挂载 `createExtensionRoutes({ piCli, store, manager, reloadSession: reloadRunner, ... })`，管理员门控经 `PI_WEB_EXT_ADMIN_ALLOW_ANY`；`reloadSession` 已注入真实实现（非 501）
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 5. pi extension 命令零改动复用 + busy 修复（R2.3 — 勘探确认**已合并 main**）
  - busy 修复 sha `36c82fc`（`PiChat onSubmit` 识别 source=extension → `client.prompt` fire-and-forget）已在 main / feat/plugin-system-unification；无需 cherry-pick
  - _Requirements: 2.2, 2.3, 2.4_

- [x] 6. 统一 slash 补全暴露面（R6 — 勘探确认**已合流**）
  - `pi-command-palette.tsx:545-563`：webext Tier3 `contributions.slash`(extItems) 与 pi/builtin 命令(filtered) 已在同一浮层合并渲染；`RpcSlashCommand.source` 4-way 枚举
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 7. 参考示例：双角色插件包 `examples/plugin-code-review-agent/`
- [x] 7.1 包骨架 + pi 原生 extension + 统一清单
  - `pi-plugin.json` + `package.json`(files) + `extensions/code-review.ts`(`code_review` 工具 + `/review` 命令) + `.pi/extensions/code-review.ts`(薄转发) + `skills/code-review/SKILL.md` + `index.ts`(defineAgent) + README
  - _Requirements: 8.1, 2.1, 3.1, 4.1_
- [x] 7.2 webext 源 + 构建产物
  - `.pi/web/web.config.tsx`（`CodeReviewCard` 命中 `code_review` + Tier3 slash）；纳入 `scripts/build-webext-examples.ts`；构建产出 `.pi/web/dist`（sha384-UjjP4v…）；加入 `lib/app/webext-registry.ts` 构建期集成
  - _Requirements: 8.1, 3.2, 3.4_

- [x] 8. consumer agent `examples/plugin-consumer-agent/`
  - `index.ts`(不内置 code_review) + `.pi/settings.json`(`local:../plugin-code-review-agent`) + README
  - _Requirements: 8.2, 7.1_

- [x] 9. 双角色样板 + 示例索引
  - `examples/README.md` 注册两条目；双角色模式文档化于产品章节
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 8.4, 8.5_

- [x] 10. 产品文档
  - `docs/product/09` 追加「统一插件包标准」小节（pi-plugin.json / 两层锚点 / 双角色 / 双路生效）；交叉引用 10
  - _Requirements: 1.5, 4.x, 7.x_

- [x] 12. 增量：统一插件声明 web 可见 slash 命令（R9）
- [x] 12.1 协议 + server 回填 + 前端放行
  - 协议：`PluginWebSchema` 加 `commands?`（dist 改 optional）；`RpcSlashCommand` 加 `webVisible?`
  - server：`PluginDescriptor.webCommands` + `resolve-plugin` 填充；`enrich-web-visible.ts` 据 `sourceInfo` 解析插件清单回填 `webVisible`；接入 `makeCommandsHandler`
  - 前端：`isCommandVisible` 对 `webVisible===true` 放行（保留默认隐藏安全网）
  - 示例：`plugin-code-review-agent/pi-plugin.json` 声明 `web.commands:["review"]`
  - 完成证据：server 单测 14/14（含 `enrich-web-visible` 4 例）；ui 18/18（含 webVisible 放行例）；typecheck 三包绿；**实机验证**——dev 无 allowlist env，`GET /commands` 中 `review` 带 `webVisible:true`
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - _Boundary: packages/protocol/src/plugin, packages/server/src/plugin, packages/ui/src/controls_

- [x] 13. 增量：fire-and-forget 扩展命令的 ctx.ui 反馈可见（R10）
- [x] 13.1 空闲控制流恒应用 ambient + 级别感知通知 + 示例命令改本地反馈
  - `pi-chat.tsx`：`openControlOnlyStream` 恒 `applyAmbient:true`（此前 gate 到 extCtrlActive，令"有 contributions、流已以 applyAmbient:false 打开"的扩展收不到命令 notify）；effect 依赖由 `extCtrlActive` 换为 `needsIdleControl`（消除重连竞态）
  - `notifications.tsx`：级别感知自动消失——`info` 5s 自动消失，`error`/`warning` 持久需手动关闭
  - 示例 `extensions/code-review.ts`：`/review` 改为本地启发式检视 + `ctx.ui.notify(findings)`（不触发 turn）
  - 完成证据：notifications 单测 7/7（含「warning/error 不自动消失」例）；ui typecheck 绿；**浏览器实测**——`/review` 提交后通知持久显示 findings（8s 后仍在），sandbox error 通知同样持久
  - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - _Boundary: packages/ui/src/chat, packages/ui/src/elements, examples/plugin-code-review-agent_

- [x] 11. 端到端验证（离线 stub + 隔离 build）
- [x] 11.1 e2e：统一插件两层咬合
  - stub 加 `code-review` sentinel 发 `code_review` 工具；`e2e/browser/plugin-system-unification.e2e.ts`：选 source → 发 code-review prompt → 断言 CodeReviewCard（`data-testid="code-review-card"` + 2 findings）
  - 完成证据：`PI_WEB_DISABLE_STANDALONE=1 NEXT_DIST_DIR=.next-e2e` 构建 + 外部 server 模式 → **1 passed (4.2s)**；相邻 webext/tool-call-ui 6 例无回归（见 evidence.md）
  - _Requirements: 8.1, 3.2_
