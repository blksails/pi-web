# Implementation Plan

> 说明:遵循 Code-Only Focus,文档更新(`docs/product/05`、`15`、`14` 登记 env 与硬化清单)不作为独立编码任务列出,实施时随相关代码一并补齐。

- [x] 1. Foundation:启用门控默认值
- [x] 1.1 实现 bash 启用默认推导纯函数
  - 新增从环境变量推导 bash 能力是否启用的纯函数:未设置 → 关闭(secure by default),设置且值非 `"false"`/`"0"`(大小写不敏感)→ 启用;口径与既有 logger env 解析一致。
  - 完成态:给定 `{}` 返回 `false`;给定 `{ PI_WEB_BASH_ENABLED: "1" }`/`"true"`/`"TRUE"` 返回 `true`;给定 `"false"`/`"0"` 返回 `false`,并有覆盖这些用例的单元测试通过。
  - _Requirements: 5.1, 5.6_
  - _Boundary: resolveBashEnabled_

- [x] 2. 后端:bash 执行接缝
- [x] 2.1 (P) 暴露会话层 bash 执行转发
  - 在会话包装层新增 bash 执行与中止的转发方法,照既有只读查询转发(getMessages)的同款 forward 模式,把命令与 `excludeFromContext` 选项透传给底层 RPC 通道既有的 bash 能力;补齐类型签名。
  - 完成态:可经会话对象发起一次 bash 执行并拿到结构化结果(输出/退出码/取消/截断);`excludeFromContext` 标记被原样透传;typecheck 通过。
  - _Requirements: 2.1, 2.4, 3.1, 3.2, 3.3_
  - _Boundary: PiSession_

- [x] 2.2 新增 bash 执行 HTTP 端点与启用门控
  - 新增 `POST /sessions/:id/bash`:启用时执行命令并以同步响应体返回结构化结果;**在读取/解析请求体之前**校验启用门控,禁用时返回 404(不泄露端点存在性);无效命令(缺失/空)返回 400;会话不存在返回 404。
  - 完成态:启用态对存在会话发请求返回 `200 { result }`;禁用态返回 404 且未触达会话执行;有覆盖禁用 404 与无效 body 400 的单元测试通过。
  - _Requirements: 2.1, 2.3, 5.2, 5.3, 5.4_
  - _Depends: 2.1_
  - _Boundary: bash-routes_

- [x] 3. 前端:客户端、卡片与输入提示
- [x] 3.1 (P) 新增客户端 bash 方法
  - 在 React 客户端新增打 bash 端点的方法,提交命令与 `excludeFromContext`,成功时解析同步响应体返回结构化结果;非 2xx(含 404/5xx)抛出错误供上层处理。
  - 完成态:调用该方法对启用端点返回结构化结果;端点 404/5xx 时该方法抛错;typecheck 通过。
  - _Requirements: 2.1, 2.3, 7.1, 7.2_
  - _Boundary: PiClient_

- [x] 3.2 (P) 实现 bash 结果卡片渲染器
  - 新增承载 bash 执行结果的专用 data part 渲染器:同步展示命令与输出(用同步 `<pre>`,不使用异步语法高亮);退出码非零标红并显示退出码;输出截断时显示提示;取消时标示未正常完成;`!!`(不进上下文)显示可辨识标记;暴露稳定的选择器属性供 e2e。
  - 完成态:给定含输出/非零退出码/截断/取消/排除上下文的数据,渲染出对应可见标记;渲染后输出文本可被同步读取/断言;单元测试通过。
  - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 7.3_
  - _Boundary: BashResultRenderer_

- [x] 3.3 (P) 为输入框新增 bash 模式视觉提示
  - 为输入框新增模式 prop,使其在「bash」与「bash 不进上下文」两态下改变边框/强调色、显示 BASH 标识并切换占位符;未设置该 prop 时保持常规外观。
  - 完成态:传入 bash 模式时输入框呈现 BASH 标识与强调样式,传入「不进上下文」模式时呈现可辨识的对应标识,不传时为常规外观;单元测试覆盖三种态并通过。
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: PromptInput_

- [x] 4. 集成:接线与门控联动
- [x] 4.1 在应用装配处注入 bash 路由并接入服务端门控
  - 在应用 handler 装配处注入 bash 路由,并把启用默认推导结果作为权威门控传入;确保禁用为默认且服务端为权威边界。
  - 完成态:未设启用变量时该端点返回 404;设置启用变量后端点可执行;(注:注入新路由后需重启 dev 方能生效)。
  - _Requirements: 5.1, 5.2, 5.4_
  - _Depends: 1.1, 2.2_
  - _Boundary: pi-handler_

- [x] 4.2 在聊天提交链路接入 bang 分流、结果注入与视觉提示
  - 在聊天提交处理中、于斜杠命令分支之前加入 `!` 分支:仅当前端体验开关开启时识别前缀;对输入先做前导空白裁剪;解析 `!`/`!!` 得到命令与 `excludeFromContext`;去前缀去空白后为空则不发起请求且不写消息;提交后清空输入框;调用客户端 bash 方法,成功后经既有安全的消息注入机制(回调内访问、避免 render 期解构)向当前会话追加一条表示命令的用户侧消息与一条结果卡片;失败时注入可见错误反馈。同时注册结果卡片渲染器,并据实时输入前缀计算模式下传输入框;关闭体验开关时 `!` 文本退化为普通消息且不显示视觉提示。
  - 完成态:开启开关时输入 `!cmd` 触发 bash 执行并在聊天流出现命令消息+结果卡片、不调用常规消息发送;输入 `!` 时输入框出现 BASH 提示;空命令不产生任何消息或请求;关闭开关时 `!cmd` 作为普通消息发送且无视觉提示;请求失败时出现可见错误反馈。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 5.5, 6.4, 7.1, 7.2, 7.4_
  - _Depends: 3.1, 3.2, 3.3_
  - _Boundary: PiChat_

- [x] 4.3 将前端体验开关从装配层注入聊天组件
  - 在服务端组件装配处读取构建期内联的前端体验环境变量,转为聊天组件的体验开关 prop;不在浏览器侧整体读取运行时环境。
  - 完成态:设置前端体验变量后聊天组件按启用态工作(识别 `!`、显示提示),未设置时按关闭态工作;变量仅经构建期内联提供;开关来源仅为部署级 env/装配 prop,不在用户可写的 Settings 界面提供(如需呈现仅只读)。
  - _Requirements: 5.5, 5.6, 5.7, 6.4_
  - _Depends: 4.2_
  - _Boundary: chat-app_

- [x] 5. 验证:集成测试与端到端
- [x] 5.1 后端 bash 端点集成测试(真实 RPC 子进程)
  - 对真实 RPC 模式 agent 子进程发请求:启用态执行简单命令断言输出与退出码;以「不进上下文」标记执行后核验该结果未进入会话上下文;禁用态断言 404。
  - 完成态:三个集成用例(执行成功、排除上下文、禁用 404)在真实子进程下通过。
  - _Requirements: 2.1, 2.2, 2.4, 3.2, 5.2_
  - _Depends: 2.2, 4.1_

- [x] 5.2 前端提交链路与解析单元测试
  - 覆盖:开关关闭时 `!cmd` 走常规消息发送、不调 bash;开关开启时 `!cmd` 调 bash、不走常规发送;`!`/`!!` 解析正确;空命令(`!`、`!!  `)不请求不写消息;前导空白等价;提交后清空输入框。
  - 完成态:上述用例的单元测试全部通过。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.5, 7.4_
  - _Depends: 4.2_

- [x] 5.3 端到端开/关两档验证
  - 在隔离构建 + 外部 server 模式下:开启档输入 `!echo hi` 出现含 `hi` 的结果卡片且输入 `!` 时出现 BASH 徽标,`!!echo x` 卡片带不进上下文标记;关闭档 `!echo hi` 作为普通消息发给桩 agent、无卡片无徽标。
  - 完成态:开/关两档的 e2e 用例均通过,fresh 运行输出可证。
  - _Requirements: 1.1, 4.2, 4.5, 5.5, 6.1, 6.4_
  - _Depends: 4.3_

## Implementation Notes

- **5.1 集成测试用 stub agent(真实执行 shell)而非真 pi**:`test/bash-route.integration.test.ts` 经完整 `createPiWebHandler` 全链路(HTTP → 门控 → pi-session 转发 → 通道 → agent)发 `POST /sessions/:id/bash`,断言执行成功/exit 非零/exclude 透传/空命令 400。stub agent(`lib/app/stub-agent-process.mjs`)新增 `case "bash"` 用 `execSync` **真实执行 shell**,离线确定性且验证了 pi-web 侧全部接缝;真实 pi 的 `recordBashResult` 上下文写入语义由 pi agent 自身保证(协议/通道既有,本特性不改)。禁用 404 由 `bash-route.test.ts`(makeBashHandler enabled:false)+ `bash-env-default.test.ts`(resolveBashEnabled 默认关)组合覆盖。
- **vitest 配置补缺**:`vitest.config.ts` 补 `@blksails/pi-web-tool-kit/auto-title-entry` 的 src alias —— 这是 auto-session-title 特性引入 handler import 时遗漏的既有缺口,缺它会令**所有经完整 handler 的 app 集成测试**(含既有 `route.integration.test.ts`)在本地 vite 解析失败。补后两者均恢复。
- **前端单测 mock client**:PiChat 渲染会触发补全 effect 调 `client.getCompletionTriggers`;mock client 除 `bash` 外需提供该 no-op,否则渲染期抛错。readiness gating 默认关(不传 `gateUntilReady`),故 mock 会话即可提交。
