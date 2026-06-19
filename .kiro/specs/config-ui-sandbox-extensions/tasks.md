# Implementation Plan

> 说明:本特性多数已落地;`[x]` 为已完成并通过测试/类型检查的项,`[ ]` 为剩余工作。
> 剩余聚焦「扩展」配置域(Req 6/7)与整体 e2e(Req 8)。

- [x] 1. 沙箱配置域(全局,方案 A)
  - `protocol/config/domains/sandbox.ts`:`sandboxConfigSchema` + `sandboxFormSchema`(嵌套 network/filesystem,全可选)。
  - `config/index.ts` 注册 `sandbox` 域;`config-routes.ts` 的 `DOMAIN_SCHEMAS.sandbox`。
  - 完成观察:`GET/PUT /config/sandbox` 读写 `<agentDir>/sandbox.json`,非法 422。
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. 沙箱项目配置(方案 B + `.pi/sandbox.json`)
  - `config/sandbox-project-routes.ts`:`GET/PUT /config/sandbox/project[?cwd]`,`cwd` 根校验(403)、校验(422)。
  - `pi-handler` 注入该路由。
  - 完成观察:PUT 写 `<cwd>/.pi/sandbox.json`、GET 读回 `exists:true`;越界 403。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. 沙箱扩展强制注入
- [x] 3.1 入口解析与两模式注入
  - `sandbox/entry.ts resolveSandboxEntry`;`pi-handler.createChannel`:cli `-e`、custom env `PI_WEB_SANDBOX_ENTRY`。
  - 完成观察:冒烟 `pi --mode rpc -e <pi-sandbox>` 输出沙箱状态、不崩。
  - _Requirements: 3.1, 3.2, 3.4, 3.5_
- [x] 3.2 runner 追加 + 白名单豁免
  - `option-mapper.ts`:`forcedExtensionPaths` 置前追加 `additionalExtensionPaths`,`extensionsOverride` 豁免 basename。
  - 完成观察:`option-mapper-forced-inject.test.ts`(5 例)通过。
  - _Requirements: 3.2, 3.3_

- [x] 4. 可见性隔离
  - 严格全局 `~/.pi/agent/sandbox.json`(`allowRead:["."]`);研究文档 §12 记录保证与前提。
  - 完成观察:文档说明项目内可读、项目外被拦;allowRead 放宽即失效已警示。
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 5. 设置页 Tab 分组布局
  - `settings-registry`:面板增 `group/groupTitle/groupOrder/tabLabel/tabOrder`。
  - `settings-shell`:`buildGroups` 聚合 + `role="tablist"`;`register-panels` 沙箱全局/项目同组。
  - 三个缺失控件 `boolean/stringList/object` 已补并注册。
  - 完成观察:`settings-shell.test.tsx` 含「同 group 合并 + Tab 切换」用例,通过。
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 6. 扩展配置域 — 协议 schema
  - `protocol/config/domains/extensions.ts`:`commands{allow,deny}`(固定区)+ `extensions` 记录(KV 区,widget `extensionsKv`),全可选 passthrough;`extensionsFormSchema`。
  - 完成观察:`zodToFormSchema` 产出 `commands`(object→stringList 子)与 `extensions`(record,widget `extensionsKv`)。
  - _Requirements: 6.1, 7.1_

- [x] 7. 扩展配置域 — 协议注册
  - 在 `protocol/config/index.ts` 把 `extensions` 加入 `ConfigDomainId` 与 `CONFIG_FORM_SCHEMAS`,并导出 domain。
  - 完成观察:`CONFIG_FORM_SCHEMAS.extensions.domain === "extensions"`;`tsc` 通过。
  - _Requirements: 6.1, 7.1_
  - _Depends: 6_

- [x] 8. 扩展配置路由 + settings.json 互映
- [x] 8.1 互映纯函数 + 单测 (P)
  - `config/extensions-config-routes.ts` 内 `settingsToForm`/`applyFormToSettings`:保留键集区分;`extensions` ↔ 顶层 `<extId>` 键;`commands` 命名键;非破坏保留。
  - 单测:顶层 KV 往返、保留键不丢、组内删键、`commands` 往返。
  - 完成观察:新增 `test/config/extensions-mapping.test.ts` 通过。
  - _Requirements: 6.2, 6.3, 7.2, 7.3, 7.4_
  - _Boundary: extensions-config-routes_
- [x] 8.2 全局 + 项目路由
  - `createExtensionsConfigRoutes({agentDir, defaultCwd, allowedRoots?})`:`GET/PUT /config/extensions` 写 `<agentDir>/settings.json`;`GET/PUT /config/extensions/project[?cwd]` 写 `<cwd>/.pi/settings.json`;校验 422、`cwd` 越界 403。
  - `config/index.ts` 导出;`pi-handler` 注入。
  - 完成观察:`test/config/extensions-config.test.ts`:全局/项目 GET/PUT 往返 + 422 + 403 通过。
  - _Requirements: 6.2, 6.3, 6.4, 7.2, 7.3, 7.4, 7.6_
  - _Depends: 8.1_

- [x] 9. extensionsKv 控件
  - `ui/config/fields/extensions-kv-field.tsx`:两级动态增删(扩展条目 + 键值对),空值视为 `{}`;经 `registerFieldRendererByKey("extensionsKv", ...)` 注册。
  - 完成观察:新增 `test/config/extensions-kv-field.test.tsx`:增/删条目与键值、onChange 结构正确,通过。
  - _Requirements: 7.1, 7.5_

- [x] 10. 注册「扩展」分组面板
  - `lib/settings/register-panels.ts`:注册「扩展」全局 + 项目两面板(同 group,全局/项目 Tab),校验 `zodValidator(extensionsConfigSchema)`,项目用自定义 IO(`/api/config/extensions/project`);并注册 `extensionsKv` 控件。
  - 完成观察:`/settings` 出现「扩展」菜单项 + 全局/项目 Tab,表单含 Slash 命令列表 + KV 编辑器。
  - _Requirements: 6.1, 7.1, 7.6_
  - _Depends: 7, 8.2, 9_

- [x]* 11. node e2e
  - `e2e/node/config-domains.e2e.test.ts`:起 handler,验证 `/config/sandbox`、`/config/sandbox/project`、`/config/extensions[/project]` 端到端读写 + 校验(422/403);强制注入装配。临时 `PI_WEB_AGENT_DIR` + 临时 cwd,不污染用户级。
  - 完成观察:`pnpm e2e:node` 新用例全绿。
  - _Requirements: 8.1, 8.2, 8.3, 8.5_
  - _Depends: 8.2, 10_

- [x]* 12. browser e2e
  - `e2e/browser/settings-config.e2e.ts`(Playwright):打开 `/settings`,验证「沙箱」「扩展」各一个菜单项;切换全局/项目 Tab;改值保存并回读。复用隔离 build(`NEXT_DIST_DIR=.next-e2e` + external server),不污染共享 `.next`。
  - 完成观察:`pnpm e2e`(隔离)新用例全绿。
  - _Requirements: 8.4, 8.5_
  - _Depends: 10_

- [x] 13. 收尾校验
  - 全工作区 `pnpm -r typecheck` + app `tsc`;重启 dev 验证新「扩展」端点与设置页;更新 `docs/pi-sandbox-integration-research.md`(扩展配置域落地记录)。
  - 完成观察:typecheck 全绿;`/api/config/extensions` 返回 formSchema;文档新增小节。
  - _Requirements: 6.1, 7.1, 8.5_
  - _Depends: 10, 11, 12_
