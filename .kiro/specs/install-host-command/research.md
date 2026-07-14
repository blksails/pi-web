# Research & Design Decisions — install-host-command

## Summary
- **Feature**: `install-host-command`
- **Discovery Scope**: Extension(既有系统集成型;分析报告 `docs/plugin-command-kind-install-analysis.md` 方案② 的落地设计)
- **Key Findings**:
  - host 命令通道契约已就绪:`HostCommandHandler.execute(ctx: {session, argv: string})` → `CommandResult`,注册表捕获一切异常(永不 throw),命令结果走同步 HTTP 响应体(决策A)。
  - **`CommandResult.message/data` 目前没有进聊天流的通路**——`/clear` 只消费 effect;安装结果要可见,必须照 bang 命令的 `data-bash-result` 卡片模式(`setMessages` 追加 UIMessage + data part renderer)新建通路。
  - **`createInstaller` 的 allowlist 是硬编码 `CLI_ALLOWLIST`,无注入接缝**——web 面要传自己的 `extAllowlist`,必须给 `CreateInstallerOptions` 新增 `allowlistConfig?` 并穿透到 `resolveSource`;这同时是 Req 3.4(CLI 裁决不得进 web)的实现落点。
  - 整合线上 `installer.install()` 遇 `kind:"component"` 会落到 plugin 默认通道**误装**(无显式分支)——Req 2.6 的邻接缺陷坐标确认。
  - `agent-source-picker` 无刷新信号;同文件 `chat-app.tsx` 有成熟先例 `sessionListRefreshKey`(onTurnEnd 边沿 bump → `SessionListPanel refreshSignal`),照抄该模式。
  - `pluginInstaller.listInstalled({outdated:true})` 恒返回 `OUTDATED_NOT_SUPPORTED`——`/install list --outdated` 只能如实转达,不得谎报(需求 1.3 已按此措辞校准)。

## Research Log

### host 命令通道与结果呈现通路
- **Context**: /install 注册进哪里、结果如何到达用户眼前。
- **Sources Consulted**: `packages/server/src/commands/host-command-registry.ts:12-54`、`packages/server/src/http/routes/command-routes.ts:281-323`、`lib/app/clear-host-command.ts:14`、`packages/ui/src/chat/pi-chat.tsx:852-929`、`packages/react/src/web-ext/command-client.ts:33-67`、`packages/protocol/src/web-ext/command.ts:12-36`。
- **Findings**:
  - `HostCommandContext = { session: PiSession; argv: string }`(argv 为命令名后的原始串);registry.execute 捕获 handler 异常转 `{effect:"notify", message}`。
  - 前端识别:`PiChat.onSubmit` 按 `builtinCommands` 名匹配 → `dispatchBuiltin` → `executeHostCommand`(同步 HTTP);effect 只有 `clear-transcript` 有内置处理,其余走可选 `onCommandResult` 回调(chat-app 当前未传)。
  - message/data 无入流机制;bang 命令是唯一的卡片注入范式(`parts:[{type:"data-bash-result", data}]` + `registry.registerDataPartRenderer`,pi-chat.tsx:477/:879-929)。
- **Implications**: /install 的 handler 放 host 注册表零通道改造;前端需两笔新增——(a) `dispatchBuiltin` 支持按词条声明把 `result.data` 追加为卡片消息,(b) `data-install-result` 渲染器。

### CLI install 子域的注入面
- **Context**: 复用纪律「直调零改造」是否成立。
- **Sources Consulted**: `server/cli/install/installer.ts:88,187-205,288-297,320-427`、`server/cli/install/agent-installer.ts:95-136,426-451`、`server/cli/install/plugin-installer.ts:90-208,306`、`server/cli/reporter.ts:20-87`、`server/cli/install/source-resolver.ts:96-104,208`。
- **Findings**:
  - `agent-installer`/`plugin-installer`/`reporter` 端口全部可注入,直调成立。
  - 例外:`installer.install()` 内部 `buildAllowlistConfig(env)` 硬拼 `CLI_ALLOWLIST`(allowLocal:true)传给 `resolveSource`——**没有 allowlist 注入接缝**;`determineKind` 是纯函数,本地信任清单 kind,npm/git 缺省 plugin。
  - `install()`/`uninstall()` 只有 `if (kind === "agent")` 分支,component 落 plugin 默认通道(误装缺陷,test/cli 无该用例)。
  - `pluginInstaller.uninstall(sourceId)` 不收 scope;`update({packageId})` 返回逐项 `outcomes`;`listInstalled({outdated:true})` 恒 `OUTDATED_NOT_SUPPORTED`。
- **Implications**: 给 `CreateInstallerOptions` 加 `allowlistConfig?: AllowlistConfig`(缺省仍 CLI_ALLOWLIST,CLI 行为不变);component 拒绝做进 `installer.install()`/`uninstall()` 的 kind 分派层,CLI 与 web 一处修复共享(Req 2.5/2.6)。

### 门控与装配料坐标
- **Context**: Req 3「与 REST 同一份三门」。
- **Sources Consulted**: `lib/app/pi-handler.ts:406-430,499-541`、`packages/server/src/extensions/routes/install-extension.ts:38-84`、`packages/server/src/extensions/install/source-allowlist.ts`。
- **Findings**: `extPiCli`(:408)、`extAllowMutate = PI_WEB_EXT_ADMIN_ALLOW_ANY==="1"`(:409)、`extAllowlist`(:413-417,DEFAULT_ALLOWLIST + env 叠加)、`reloadRunner`(:418-422)全在 pi-handler 装配段,REST 路由消费同一份(:529-541);REST 的 adminPolicy 实为 `extAllowMutate ? ()=>true : 默认拒绝`。agent-sources 的 `sourcesRoot`/`registryPath`(缺省 `<agentDir>/sources.json`)也在同文件(:499-504)。审计:install-extension 路由在拒绝/成功时记审计事件(端口随 routes 注入)。
- **Implications**: /install handler 的全部治理注入从 pi-handler 既有变量取用,零新配置面;审计端口与 REST 共用同一实例(实现时核对 extensions/routes 的 audit 端口形状)。

### 补全与 e2e 基线
- **Context**: Req 6.3-6.5 / Req 7。
- **Sources Consulted**: `packages/ui/src/controls/plugin-arg-provider.ts:17-123`、`packages/ui/src/controls/command-arg.ts:36-81`、`packages/ui/src/controls/pi-command-palette.tsx:233-370,550`、`packages/server/src/extensions/routes/install-sources.ts:16-120`、`packages/tool-kit/src/commands/builtin.ts:15-22`、`e2e/browser/plugin-subcommand-completion.e2e.ts`、`playwright.config.ts:69,114-135`。
- **Findings**: 三态 stage 模型(`parseCommandStage`)与 `CommandArgProvider{specFor,listArgs}` 契约完全可复用,换词条表即可;`GET /sessions/:id/install-sources`(本地源扫描)与 `GET /extensions`(已装插件)是现成数据源;`GET /agent-sources` 可作 agent 卸载候选源。e2e 全局两套 webServer(FS/sqlite)+ `PI_WEB_STUB_AGENT=1`,env 是全局的——安装类 e2e 需要放行 env 与隔离落盘目录,不能污染既有两套。
- **Implications**: provider 词条表换成 INSTALL_SPEC(4 子动作);uninstall 候选合并两端点并给 agent 项 insertText 追加 ` --kind agent`(规避「缺省 kind 走错通道」历史缺陷);playwright 增第三套 webServer(专用端口+放行 env+临时 sourcesRoot/agentDir)。

### 旧 /plugin 摘除面
- **Context**: Req 6.1/6.2。
- **Sources Consulted**: `packages/tool-kit/src/extension-tools/extension-manager.ts:151-235`、`components/chat-app.tsx:227-246`、`packages/tool-kit/test/extension-tools/extension-manager.test.ts:40-70`。
- **Findings**: 摘除对象=`pi.registerCommand("plugin")`(:160-182)与 chat-app allowlist 的 `"plugin"` 项;`reload-runtime` 命令与三个 agent 工具(`install_extension` 等)是另一张脸,保留;tool-kit 测试需同步改(:40 命令清单断言、/plugin describe 块)。
- **Implications**: 摘除是小面积、低风险;老会话残留旧 /plugin 与新 /install 名字不同,共存无仲裁(Req 6.6 免费成立)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| handler 放 `packages/server/src/commands/` | 与 registry 同包 | 就近 | **违反依赖方向**:packages/server 不得 import 应用层 `server/cli/install/*` | 否决 |
| handler 放 `lib/app/`(选定) | 与 `clear-host-command.ts` 同级,装配期闭包注入 | 依赖方向干净(app 层可同时引 packages/server 契约与 server/cli 实现);先例一致 | app 层多一个文件 | ✅ |
| 结果卡片走 SSE 帧 | 服务端推卡片 | — | 违反决策A(host 命令=同步响应体) | 否决 |
| 结果卡片走 `resultDataPart` 词条声明(选定) | BuiltinCommandSpec 声明卡片 part 类型,PiChat 通用追加 | PiChat 零 install 特判,未来 host 命令免费复用 | 词条类型加一个可选字段 | ✅ |

## Design Decisions

### Decision: allowlist 注入接缝(而非 env 旁路)
- **Context**: web 面必须用 `extAllowlist`,`createInstaller` 现无接缝;唯一旋钮 `options.env` 只能翻 `allowAnyNpm`,翻不动 `allowLocal` 的方向。
- **Alternatives Considered**: 1) web 面自己先调 `resolveSource` 再绕过 installer 的内部 resolve——产生第二份编排,否决;2) 给 `CreateInstallerOptions` 加 `allowlistConfig?`,内部 `buildAllowlistConfig` 仅在未注入时兜底。
- **Selected Approach**: 方案 2。CLI 不传→行为不变;web 传 `extAllowlist`→三门语义进 install 编排。
- **Trade-offs**: CLI 子域为 web 面开一个注入口,但端口化正是该子域的既定风格。
- **Follow-up**: 单测覆盖「注入 allowLocal:false 时本地源被拒」。

### Decision: component 拒绝做在 installer kind 分派层(CLI/web 共享)
- **Context**: Req 2.5(web 拒绝)与 2.6(CLI 误装缺陷)是同一个缺口的两面。
- **Selected Approach**: `installer.install()`/`uninstall()` 的 kind 分派加显式 `component` 分支,返回 `{code:"KIND_COMPONENT_UNSUPPORTED", message:含 pi-web add 指引}`;web handler 原样转达。
- **Rationale**: 一处修复两个通道同时闭合;kind 判别已免费拿到。
- **Follow-up**: test/cli 增用例(本地 component 清单→install/uninstall 均拒)。

### Decision: 生效分道的实现位置
- **Context**: plugin→当前会话 reload;agent→选择器刷新不重启。
- **Selected Approach**: reload 在 **handler 服务端**做(注入 `reloadRunner`,成功装 plugin 后调用,effect:"notify");agent 刷新在 **前端**做(effect:"panel-refresh" → chat-app `onCommandResult` bump `agentSourcesRefreshKey` → `AgentSourcePicker` 新增 `refreshSignal` prop,照 `sessionListRefreshKey` 先例)。
- **Trade-offs**: panel-refresh 语义首次被真正消费——为 CommandResult 的 effect 枚举补上了缺失的前端落地。

### Decision: /install list 范围与 --outdated 诚实转达
- **Context**: 底层 `listInstalled({outdated})` 恒不支持;list 只覆盖 plugin。
- **Selected Approach**: list 输出 plugin 清单(agent 可见面=source 选择器,不重复);`--outdated` 时把端口的 `OUTDATED_NOT_SUPPORTED` 如实呈现为失败卡片。
- **Rationale**: 「自报成功不可信/不得谎报」是本仓反复验证过的纪律(cli-package-commands 复核抓过 updated 谎报)。

## Risks & Mitigations
- 风险:e2e 放行 env(ALLOW_LOCAL/ADMIN_ALLOW_ANY)泄进既有两套 webServer,弱化其它用例的门控现实性 — 缓解:第三套专用 webServer + 专用端口,env 只挂它。
- 风险:agent 安装落真实 `~/.pi-web` — 缓解:e2e webServer 注入临时 `PI_WEB_SOURCES_ROOT`/`PI_CODING_AGENT_DIR`(sources.json 随 agentDir 隔离)。
- 风险:`dispatchBuiltin` 追加卡片与 `clear-transcript` 冲突(先清空再追加?)— 缓解:卡片追加只在 `resultDataPart` 词条声明时发生,/clear 无该声明,互不相交。
- 风险:摘除 agent 侧 /plugin 后,`NEXT_PUBLIC_PI_EXTENSION_COMMANDS=all` 的部署会失去入口 — 缓解:/install 是 builtin 词条,恒在命令面板,不受该开关影响;README/文档同步。

## References
- `docs/plugin-command-kind-install-analysis.md` — 方案②与命名裁定(用户拍板)
- `.kiro/specs/unified-command-result-layer/` — 决策A:host 命令同步响应体通道
- `.kiro/specs/cli-package-commands/design.md` — CLI install 子域端口设计
