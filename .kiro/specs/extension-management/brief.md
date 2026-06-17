# Brief — extension-management

> 语言:zh。权威设计:`PLAN.md` §10(资源体系)、§10.0.C(信任)、§10.1(pi packages 安装)、§10.1.3(RCE 治理)。

## 问题
- **谁**:运维/管理员与终端用户——希望管理 agent 可用的扩展/skills/prompt 命令。
- **现状**:pi 支持 `pi install/list/remove` 与 `.pi/` 资源、`get_commands`,但 Web 侧无入口,且安装=RCE 需治理。
- **改变**:提供受控的扩展管理 API + 命令面板数据源,信任策略落地。

## 方法 / 范围
- **API**:`GET /extensions`(列出,读 settings/`pi list`)、`POST /extensions`(安装:shell out `pi install <source>`,**来源白名单 + 版本固定 + `--ignore-scripts`**)、`DELETE /extensions/:id`(`pi remove`)、`POST /sessions/:id/reload`(重启子进程/`new_session` 重载)。
- **命令面板数据**:`GET /sessions/:id/commands` 透传 RPC `get_commands`(extension/prompt/skill,名称/描述/来源)。
- **信任落地**:对 `.pi/` 项目资源按 `trustPolicy` 决定 `--approve`/`defaultProjectTrust`(承接 agent-source)。
- **安全**:仅管理员可安装;安装审计日志;非交互 git env(`GIT_TERMINAL_PROMPT=0`)。
- **范围外**:命令面板 UI 渲染在 ui-components;沙箱执行在生产硬化(未来)。

## 依赖
- http-api、session-engine。

## 测试 + e2e(硬性)
- **单元**:来源白名单校验(拒绝任意 URL)、安装参数拼装(`--ignore-scripts`)、信任决策、审计记录。
- **集成**:对本地 fixture 扩展执行 install→list→`get_commands` 出现该命令→remove。
- **e2e**:装一个本地 `.pi/extensions` 或 pi package → 新会话/reload 后 `get_commands` 含该 `/command` → 通过 prompt 调用它生效。

## 约束
- 扩展安装 = RCE:必须管理员 + 白名单 + 沙箱(生产)+ 审计(§10.1.3、§11.2)。
