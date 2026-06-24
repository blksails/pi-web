# Implementation Plan

> 语言:zh。权威需求见 `requirements.md`,权威设计见 `design.md`(组件/接口/边界以其为准)。
> 硬性:测试 + e2e。涉及子进程的逻辑(白名单/参数装配/信任/审计)做成可注入/可 mock 边界,核心决策脱离真实子进程单测。

## 1. 基础:模块脚手架与共享类型

- [x] 1.1 建立 extension-management 模块脚手架与本层共享类型
  - 创建模块目录与 `vitest` 测试入口,使本特性测试可由单一命令运行(真实 `pi` 不可用时可回退受控替身)
  - 定义本层类型:扩展来源判别联合(npm/git/local)、白名单配置与决策结果、安装参数结构、审计记录、模块装配选项
  - `TrustDecision`/`TrustFragment` 与 `applyTrust` 从 `agent-source-resolver` 的 PUBLIC 包入口导入(非 `source/types` 等 deep path),不在本层重定义
  - 对外 DTO(扩展列表 / 安装请求)优先从 `@blksails/protocol` 导入;上游未导出时本地按一致命名定义并注明对齐来源;命令清单 DTO 归 `http-api`,本层不定义
  - 观察完成:`vitest run` 可发现并运行本模块(空)测试;类型在 strict 下零 `any` 编译通过
  - _Requirements: 1.5, 10.4_
  - _Boundary: ext.types.ts_

## 2. 核心:安装治理纯函数

- [x] 2.1 (P) 实现来源白名单 + 版本固定校验
  - 把原始 `source` 解析为 npm/git/local 判别联合;按配置的 npm scope 与 git host 白名单校验
  - 拒绝任意 `http(s)://` URL 与未列入白名单的 scope/host;npm 必须精确版本、git 必须 pinned ref,未固定即拒绝
  - 拒绝时返回可读原因(脱敏),供审计与错误响应复用;通过时返回已规范化来源
  - 观察完成:单测覆盖任意 URL 拒绝、非白名单拒绝、npm 缺 `@x.y.z` 拒绝、git 缺 pinned ref 拒绝、合法源通过且来源规范化
  - _Requirements: 2.3, 2.4, 10.1, 10.5_
  - _Boundary: install/source-allowlist.ts_

- [x] 2.2 (P) 实现 pi 命令参数装配 + 非交互 git env
  - 装配 `pi install` 参数始终含 `--ignore-scripts`;装配 `pi remove` 参数;返回参数与运行 env
  - git 源注入非交互 env(`GIT_TERMINAL_PROMPT=0`、`GIT_SSH_COMMAND` BatchMode)
  - 返回的可日志字段不含敏感 env/凭据
  - 观察完成:单测断言安装参数含 `--ignore-scripts`、git 源 env 含非交互项、卸载参数为 `remove`、敏感值不入可日志字段
  - _Requirements: 2.5, 9.2, 9.3, 10.1, 10.5_
  - _Boundary: install/install-args.ts_

- [x] 2.3 (P) 实现信任落地映射(trustPolicy → 信任片段)
  - 调用注入的 `trustPolicy(source)`(消费 agent-source-resolver,默认 `ask`),经其 `applyTrust(mode, decision)` 映射为信任片段(`TrustDecision`/`TrustFragment`/`applyTrust` 均取自 agent-source-resolver 的 PUBLIC 包入口,非 deep path)
  - `always`+cli → `--approve`/`defaultProjectTrust`;`always`+custom → runner 信任信号;`ask`/`never` → 空片段(headless 忽略 `.pi/`)
  - 任何取值不抑制 context 文件与全局/用户扩展;不重定义默认值或决策算法
  - 观察完成:六格(cli/custom × always/never/ask)单测断言信任片段;`ask`/`never` 断言无放行;断言不抑制 context/全局
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 10.1, 10.5_
  - _Boundary: install/trust-landing.ts_

## 3. 核心:CLI 适配器与安全接缝

- [x] 3.1 实现 pi CLI 子进程适配器(唯一 IO 点)
  - 经 `node:child_process` 执行 `pi list/install/remove`,以传入 args/env 运行,强制超时上限,超时杀进程防挂起
  - 子进程非零退出/超时返回失败结果,剥离 env 敏感值与命令行凭据;`pi list` 解析为结构化扩展条目(含来源类型/版本/作用域)
  - 接口可注入受控替身,使治理核心与端点在测试中无需真实 `pi`
  - 观察完成:单测以受控替身断言超时收束、非零失败脱敏、`pi list` 解析为含作用域的条目;真实实现可对真实 `pi` 跑通基本命令
  - _Requirements: 1.1, 2.6, 2.7, 3.3, 3.4, 9.2, 9.3, 9.4, 10.5_
  - _Boundary: cli/pi-cli.ts_

- [x] 3.2 (P) 实现管理员授权门控接缝
  - 定义消费 `http-api` `AuthContext` 的管理员判定接缝;默认实现为显式可见的安全决策(默认拒绝,不静默把任意调用方视为管理员)
  - 提供经配置显式开启的开发放行选项;接缝供安装/卸载/重载端点入口调用,只读端点不调用
  - 观察完成:单测断言匿名/非管理员判非管理员、默认不静默放行、可显式配置;只读端点不经门控
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 10.1_
  - _Boundary: security/admin-policy.ts_

- [x] 3.3 (P) 实现审计接缝 + 脱敏记录构造
  - 定义审计记录(操作者、时间戳、操作类型、来源、结果、原因摘要)与 `onAudit` 接缝;默认实现至少结构化输出,生产可替换为落库
  - 记录构造剥离 env 敏感值与凭据;支持成功/失败/被拒绝三类结果
  - 观察完成:单测断言三类结果各构造一条完整记录、字段齐全、reason 与记录不含敏感值
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.3, 10.1_
  - _Boundary: security/audit.ts_

## 4. 核心:端点处理器

- [x] 4.1 (P) 实现列出已安装扩展端点(GET /extensions)
  - 经 CLI 适配器 `pi list`/读 settings 取已安装清单,映射为扩展列表 DTO(含来源类型、版本/ref、全局/项目作用域)
  - 无扩展返回空列表;`pi list`/settings 失败返回可识别错误且脱敏;只读端点不强制管理员门控
  - 观察完成:单测以 mock 适配器断言含作用域的列表、空列表、失败可识别错误、DTO 形状
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.4, 10.1_
  - _Boundary: routes/list-extensions.ts_
  - _Depends: 3.1_

- [x] 4.2 实现安装端点(POST /extensions,治理编排)
  - 入口先经管理员门控(非管理员 401/403 + 被拒绝审计);经 protocol DTO 校验 `source`(缺/非法 400)
  - 经白名单+版本固定校验(非白名单/任意 URL/未固定版本拒绝 + 被拒绝审计,不执行命令);通过后装配参数经 CLI 适配器执行
  - 子进程非零/超时返回失败(脱敏)+ 失败审计;成功返回安装结果 + 成功审计
  - 观察完成:单测断言成功 200、缺 source 400、非白名单拒绝、未固定版本拒绝、子进程非零失败、非管理员 403,且各路径产对应审计记录
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 7.1, 7.2, 8.1, 8.4, 9.1, 9.3, 10.1_
  - _Boundary: routes/install-extension.ts_
  - _Depends: 2.1, 2.2, 3.1, 3.2, 3.3_

- [x] 4.3 实现卸载端点(DELETE /extensions/:id)
  - 经管理员门控;在已安装清单定位 `:id`(不存在 404,不执行);定位到则经 CLI 适配器执行 `pi remove`(非交互)
  - 子进程非零/超时返回失败(脱敏)+ 审计;成功返回 ack + 审计
  - 观察完成:单测断言卸载成功 ack、不存在 404、子进程失败脱敏、非管理员 403,且产审计记录
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 7.1, 7.2, 8.1, 9.3, 10.1_
  - _Boundary: routes/remove-extension.ts_
  - _Depends: 3.1, 3.2, 3.3_

- [x] 4.4 实现会话重载端点(POST /sessions/:id/reload)
  - 经管理员门控;经会话检索(不存在 404)与状态判定(已停止 409);活动则触发 session-engine 以重启子进程/`new_session` 重建运行时
  - 重建时应用信任落地片段;返回 ack 且重载后会话可检索可命令转发;不静默丢弃请求
  - 观察完成:单测以 mock 会话管理/检索断言活动 ack、不存在 404、已停止 409、非管理员 403,并断言重建调用携带信任片段
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 7.1, 7.2, 6.1, 6.2, 6.3, 10.1_
  - _Boundary: routes/reload-session.ts_
  - _Depends: 2.3, 3.2_

> 注:命令面板数据源 `GET /sessions/:id/commands` 归 `http-api`,本 spec 不实现该路由(无对应实现任务);其输出在集成/e2e(任务 5.2/6.1)中被消费以验证命令出现(Req 5.1/5.2)。

## 5. 集成:路由注册与跨 spec 接线

- [x] 5.1 实现路由注册表并经 http-api routes? 注入接缝接入
  - 把四个端点处理器装配为可经 `http-api` `createPiWebHandler` 的 `routes?` 注入接缝(`PiWebHandlerOptions.routes: ReadonlyArray<{method,path,handler}>`)注册的路由表,经工厂注入本层依赖(CLI 适配器、管理员门控、审计、会话管理/检索、trustPolicy、超时)
  - 不实现 `GET /sessions/:id/commands`(归 `http-api`);复用 `http-api` 的请求校验、错误响应与错误码映射(白名单/版本固定拒绝映射为明确客户端错误码)
  - 观察完成:集成测试起 `createPiWebHandler({ routes })`(经注入接缝并入本路由表)后,四端点均按方法+路径命中并返回预期状态码
  - _Requirements: 7.5, 10.4_
  - _Boundary: routes.ts_
  - _Depends: 4.1, 4.2, 4.3, 4.4_

- [x] 5.2 fixture 扩展集成测试(install→list→消费 http-api commands→remove)
  - 用本地 fixture 扩展经真实/受控 `pi` 执行安装,断言 `GET /extensions` 列表出现该扩展
  - 经 session-engine(rpc-channel stub 或真实 `pi --mode rpc`)起新会话后,经消费 `http-api` 拥有的 `GET /sessions/:id/commands`(本 spec 不实现该路由)出现该扩展注册的命令;再 `DELETE` 后列表移除
  - 观察完成:集成测试一次跑通 install→list 出现→新会话经 http-api commands 出现→remove 移除,新鲜运行输出证明通过
  - _Requirements: 10.2, 1.1, 2.1, 3.1, 5.1_
  - _Depends: 5.1_

## 6. 验证:e2e 闭环

- [x] 6.1 e2e:装扩展→reload/新会话→命令生效→prompt 调用
  - 安装一个本地 `.pi/extensions` 或本地 pi package;经新会话(自动加载)或对已有会话 `POST /sessions/:id/reload`(含信任落地)后,经消费 `http-api` 拥有的 `GET /sessions/:id/commands`(本 spec 不实现该路由)含该扩展注册的 `/command`
  - 通过 `POST /sessions/:id/messages` 以该 `/command` 作为 prompt 调用,断言命令在会话中生效(产生对应事件/响应);真实 `pi` 不可用时回退受控替身验证装配与透传链路
  - 观察完成:e2e 一次跑通装扩展→reload/新会话→经 http-api commands 含 `/command`→prompt 调用生效,新鲜运行输出证明通过
  - _Requirements: 10.3, 4.1, 5.1_
  - _Depends: 5.1, 5.2_

- [x] 6.2 全量测试运行与脱敏/安全断言收尾
  - 以单一命令运行全部单元/集成/e2e,确认真实 `pi` 不可用时回退受控替身后仍全绿
  - 收尾断言:所有错误响应/审计/日志脱敏(无 env 敏感值/凭据);安装/卸载/重载均经管理员门控;沙箱作为生产硬化关注点在文档/约束中明确引用而非实现
  - 观察完成:`vitest run` 全绿的新鲜运行输出;脱敏与门控的跨端点断言通过
  - _Requirements: 9.1, 9.3, 10.4, 7.1_
  - _Depends: 6.1_
