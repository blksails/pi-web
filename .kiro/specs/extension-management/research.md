# Research & Design Decisions — extension-management

## Summary
- **Feature**: `extension-management`
- **Discovery Scope**: Extension(在既有 `http-api`/`session-engine`/`agent-source-resolver` 之上的最外围特性,集成为主)
- **Key Findings**:
  - 安装 = RCE,治理硬约束来自 `PLAN.md` §10.1.3:仅管理员 + 来源白名单 + 版本固定 + `--ignore-scripts` + 非交互 git env + 审计;沙箱是生产硬化(§11.2),本 spec 引用不实现。
  - 五端点已在 `PLAN.md` §10.1.2 给出 route 表;`reload` 因 RPC 无原生 reload 命令,经重启子进程 / `new_session` 实现(归 `session-engine` 的 `SessionManager`)。
  - 信任落地不重定义:`agent-source-resolver` 已定义 `trustPolicy(source)`(默认 `"ask"`)与 `applyTrust` 的 cli/custom 映射(`--approve` / runner 信号);本 spec 仅消费决策并触发其落地。

## Research Log

### 扩展管理端点与实现手段(PLAN §10.1.2 / §10.0.A③)
- **Context**:确定五端点各自落地方式与上游归属。
- **Sources Consulted**:`PLAN.md` §10.1.2 route 表、§10.0.A③(`get_commands` 暴露)、§10.0.B(`get_commands` 限制:无 `argument-hint`)。
- **Findings**:
  - `GET /extensions` = `pi list` 或读 `settings.json`;`POST /extensions` = shell out `pi install <source>` + 白名单;`DELETE /extensions/:id` = `pi remove`。
  - `POST /sessions/:id/reload`:RPC 暂无 reload → `new_session`/重启子进程重载(由 `session-engine` `SessionManager` 拥有重建编排)。
  - `GET /sessions/:id/commands`:透传 RPC `get_commands`(由 `session-engine` `PiSession.getCommands()` 暴露)。
  - `get_commands` 当前返回 name/description/source/path,**未含 `argument-hint`**;命令面板先做 name+description 级补全(渲染归 `ui-components`)。
- **Implications**:本 spec 是薄路由 + 治理层;`reload` 与 `commands` 委托 `session-engine`,本 spec 不实现 RPC 转发本体。

### RCE 治理硬约束(PLAN §10.1.3 / §11.2 / §11.4)
- **Context**:把"装扩展"做成功能即把 RCE 做成功能,需可单测的治理。
- **Sources Consulted**:`PLAN.md` §10.1.3(五条必须项)、§11.2(沙箱选型)、§11.4(密钥/多租户)、§11.7(审计落库)。
- **Findings**:仅管理员;来源白名单 + 版本固定(禁任意 URL);`--ignore-scripts` + `GIT_TERMINAL_PROMPT=0` + ssh BatchMode;沙箱/容器隔离;安装审计(谁/何时/源)。
- **Implications**:白名单 + 版本固定 + 参数装配做成纯函数核心(执行前拒绝);CLI IO 单点 + 超时;管理员/审计做成可替换接缝(structure.md "安全是可替换策略");沙箱仅引用。

### 信任门控落地(PLAN §10.0.C + agent-source-resolver design)
- **Context**:`.pi/` 项目资源 headless 下默认 `ask` 被静默忽略("扩展明明在却没加载")。
- **Sources Consulted**:`PLAN.md` §10.0.C(Q1/Q2、处理策略)、`agent-source-resolver/design.md`(`trustPolicy`/`applyTrust` 决策矩阵)。
- **Findings**:`agent-source-resolver` 已给出 cli(`--approve`/`--no-approve`)与 custom(runner 信号 `PI_WEB_TRUST_PROJECT`/`--trust-project`)的 `applyTrust` 映射;默认 `"ask"`;`always` 仅在策略显式返回时落地;context/全局扩展不受 trust 影响。
- **Implications**:`trust-landing.ts` 消费 `trustPolicy(source)` + `applyTrust(mode, decision)`,不重定义默认值或算法(Req 6.6);会话重建时应用信任片段。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 薄路由 + 治理纯函数核心 + 单点 CLI 适配器(选中) | 端点薄转发;白名单/参数/信任做纯函数;唯一子进程 IO 在 pi-cli | 治理逻辑可脱离子进程单测(Req 10.1/10.5);IO 可 mock | 需明确 CLI 适配接缝 | 对齐 session-engine 的 Functional Core/Imperative Shell |
| 路由内联子进程调用 | 每个 route 直接 spawn pi | 文件少 | 治理逻辑与 IO 耦合,难单测,易遗漏脱敏/超时 | 否决:违背"测试硬性" |
| 独立微服务管理扩展 | 把扩展管理拆为独立服务 | 强隔离 | 过度工程;扩展状态仍在 pi settings | 否决:MVP 外 |

## Design Decisions

### Decision: 白名单 + 版本固定 + 参数装配为纯函数,执行前拒绝
- **Context**:Req 2.3/2.4/9.1 要求在执行 `pi install` 前拒绝非白名单/未固定版本源。
- **Alternatives Considered**:1) 执行后校验输出;2) 执行前纯函数校验。
- **Selected Approach**:`source-allowlist.checkAllowlist` 纯函数解析 + 校验,route 在调 `pi-cli` 前判定,拒绝即早退并审计。
- **Rationale**:可单测、fail fast、绝不"先执行再校验"。
- **Trade-offs**:需维护来源解析与白名单配置;换取安全与可测性。
- **Follow-up**:`source-allowlist.test.ts` 覆盖任意 URL/非白名单/未固定版本拒绝。

### Decision: 管理员门控与审计做成可替换接缝,复用 http-api AuthContext
- **Context**:Req 7.x/8.x 要求仅管理员 + 审计,且不自建认证。
- **Selected Approach**:`adminPolicy(auth)` 消费 `http-api` 的 `AuthContext`,默认显式拒绝;`onAudit(record)` 默认结构化输出,生产替换为落库。
- **Rationale**:structure.md "安全是可替换策略而非硬编码";`http-api` 已提供鉴权接缝,避免重复造认证。
- **Trade-offs**:默认拒绝在未配置鉴权的开发环境需显式开启;换取生产安全默认。
- **Follow-up**:`admin-policy.test.ts` 断言默认不静默放行。

### Decision: reload 委托 session-engine 重建,不实现 RPC reload
- **Context**:RPC 无原生 reload 命令(§10.1.2)。
- **Selected Approach**:`reload-session` route 校验存在/活动后调 `SessionManager` 以重启子进程 / `new_session` 重建,重建时应用 `trust-landing`。
- **Rationale**:重建编排归 `session-engine`;本 spec 只做门控 + 触发 + 信任落地。
- **Trade-offs**:依赖 `session-engine` 暴露重建能力;若上游签名变更触发 revalidation。
- **Follow-up**:`reload-session.test.ts` 以 mock `SessionManager` 断言不存在 404 / 已停止 409 / 活动 ack。

## Risks & Mitigations
- `pi list` 输出格式漂移 → 解析集中在 `pi-cli.ts`,以集成测试对真实/受控 `pi` 暴露漂移。
- `pi` CLI 标志变更(`--ignore-scripts` 等)→ 收敛到 `install-args.ts` 单点,revalidation trigger 已登记。
- 默认管理员门控误放行 → 默认显式拒绝 + `admin-policy.test.ts` 守护。
- 信任 `always` 在非沙箱环境放行 `.pi/` → 文档明确建议仅可信来源 + 沙箱内;`trust-landing` 仅消费策略不擅自放行。

## References
- `PLAN.md` §10(资源体系)、§10.0.A/B/C(三层模型 / 能力细节 / 信任门控)、§10.1/§10.1.1/§10.1.2/§10.1.3(pi packages 安装与 RCE 治理)、§11.2/§11.4/§11.7(沙箱/多租户/审计)。
- `.kiro/specs/http-api/design.md` — `createPiWebHandler`/`RouteHandler`/`AuthContext`/`validate`/`error-map`/`responses`。
- `.kiro/specs/session-engine/design.md` — `PiSession.getCommands`/`status`/`stop`、`SessionManager` 重建语义。
- `.kiro/specs/agent-source-resolver/design.md` — `trustPolicy(source)`、`applyTrust` cli/custom 映射、非交互 git env。
