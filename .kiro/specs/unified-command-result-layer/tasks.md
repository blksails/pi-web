# Implementation Plan — unified-command-result-layer

- [x] 1. 协议:命令 payload schema
  - [x] 1.1 新增 `packages/protocol/src/web-ext/command.ts`:CommandExecutePayload / CommandResult(zod)
    - 完成态:三 schema + 类型导出;`safeParse` 对合法/非法样本符合预期
    - _Boundary: protocol_  _Requirements: 1.1, 1.3, 6.1, 7.1_
  - [x] 1.2 `packages/protocol/src/index.ts` 导出新 schema/类型;单测 `packages/protocol/test/web-ext/command.test.ts`
    - 完成态:从包根可 import;测试绿
    - _Boundary: protocol_  _Requirements: 7.1_

- [x] 2. 服务端:回流帧 + host 命令注册表 + 拦截分派
  - [x] 2.1 `PiSession.emitUiRpcResponse(response)`(packages/server/src/session/pi-session.ts)
    - 完成态:调用后订阅者收到一帧 `control:"ui-rpc"`(与 handleRawLine 同形);单测验证广播
    - _Boundary: server/session_  _Requirements: 1.3, 6.4_
  - [x] 2.2 新增 `packages/server/src/commands/host-command-registry.ts`:createHostCommandRegistry + 类型
    - 完成态:has/execute 正确;未注册抛/返回明确;执行器抛错被捕获为结构化结果
    - _Boundary: server/commands_  _Requirements: 1.2, 1.5, 4.3_
  - [x] 2.3 command-routes 拦截分派(makeUiRpcHandler 增强/新增 command-aware 版)
    - 完成态:point:command+action:execute+已注册→registry.execute+emitUiRpcResponse;非 host/其它 point→session.uiRpc 转发;单测覆盖两路
    - _Depends: 2.1, 2.2_  _Boundary: server/http_  _Requirements: 1.1, 1.2, 1.4, 7.2, 7.3_
  - [x] 2.4 `packages/server/src/index.ts` 导出 registry/类型 + host command 接口
    - 完成态:宿主可 import 装配
    - _Boundary: server_  _Requirements: 4.3_

- [x] 3. `/plugin` host 命令执行器(复用 extension-management)
  - [x] 3.1 新增 `lib/app/plugin-command/plugin-host-command.ts`:createPluginHostCommand
    - 完成态:argv 解析 install/uninstall/list/空 → 调 extension-management(mock 单测)+ reload;返回 CommandResult(effect/data);错误抛出
    - _Depends: 2.2_  _Boundary: lib/app/plugin-command_  _Requirements: 5.1, 5.2, 5.3, 5.4, 4.2_
  - [x] 3.2 `lib/app/pi-handler.ts` 注入 HostCommandRegistry 给 ui-rpc handler
    - 完成态:dev/e2e 下 point:command "plugin" 走 host 执行;改后需重启 dev
    - _Depends: 2.3, 3.1_  _Boundary: lib/app_  _Requirements: 1.2, 8.1_

- [x] 4. 前端统一命令客户端 + custom 接收(packages/react)
  - [x] 4.1 新增 `packages/react/src/web-ext/command-client.ts`:executeCommand(经 ui-rpc bus) + custom 订阅
    - 完成态:executeCommand 经 bus.request(point:command,execute) 配对结果(pending/success/error);custom payload 解析;单测(注入 bus)
    - _Depends: 1.1_  _Boundary: react/web-ext_  _Requirements: 1.1, 3.2, 6.1, 6.4_
  - [x] 4.2 `packages/react/src/index.ts` 导出
    - 完成态:可 import
    - _Boundary: react_  _Requirements: 7.1_

- [x] 5. UI:数据驱动分派 + 结果渲染 + custom 渲染器(packages/ui)
  - [x] 5.1 `pi-command-palette.tsx` + `pi-chat.tsx`:builtin/host 命令经 `onCommandExecute(cmd, argv)`(替代 bespoke onBuiltinSelect 语义),onSubmit 键入拦截同走
    - 完成态:选中/键入 host 命令 → onCommandExecute;不发 prompt;既有 agent 命令路径不变;palette 单测更新
    - _Boundary: ui_  _Requirements: 2.1, 2.2, 2.3, 4.1, 7.2_
  - [x] 5.2 新增 `packages/ui/src/web-ext/custom-ui-renderer.tsx`:注册式 custom 渲染(注册名→组件,未注册降级)
    - 完成态:已注册名渲染组件;未注册占位不崩;单测
    - _Boundary: ui/web-ext_  _Requirements: 6.1, 6.2, 6.3_

- [x] 6. 迁移接线 + 移除补丁(components + lib/app)
  - [x] 6.1 `components/chat-app.tsx`:接线 executeCommand;onCommandExecute("plugin",argv) 替代 onBuiltinSelect 直调/if-else/nonce;custom renderer 挂载
    - 完成态:/plugin 全程经统一通道;移除前端 split 语义解析与直调 REST
    - _Depends: 3.2, 4.1, 5.1, 5.2_  _Boundary: components_  _Requirements: 5.1, 5.6, 3.1, 6.1_
  - [x] 6.2 `components/plugin-panel.tsx`:结果事件驱动刷新;面板安装/卸载走 executeCommand;**移除 refreshKey 补丁**
    - 完成态:安装/卸载/列表经命令通道;面板按结果事件刷新;无 refreshKey
    - _Depends: 6.1_  _Boundary: components_  _Requirements: 3.1, 5.2, 5.3, 5.6_

- [x] 7. 测试与验证
  - [x] 7.1 单元测试补齐(protocol/server/react/ui 各模块,见各任务)
    - 完成态:vitest 全绿(app + 各 package 相关)
    - _Depends: 1,2,3,4,5_  _Boundary: tests_  _Requirements: 8.3_
  - [x] 7.2 浏览器 e2e:新增 `e2e/browser/unified-command-layer.e2e.ts`
    - 完成态:键入/选中 /plugin install → 无 /messages(网络断言)→ control:ui-rpc 回流 → 面板列表事件驱动显示;错误态可见;custom stub 渲染
    - _Depends: 6_  _Boundary: e2e_  _Requirements: 2.1, 3.1, 3.3, 5.2, 6.1_
  - [x] 7.3 迁移不回归:既有 plugin-command + slash-command-palette e2e 全绿
    - 完成态:两套既有 e2e 通过
    - _Depends: 6_  _Boundary: e2e_  _Requirements: 5.5, 7.2_
  - [x] 7.4 全量回归 + typecheck
    - 完成态:全包 typecheck 0;单元 + 受影响 e2e 全绿
    - _Depends: 7.1, 7.2, 7.3_  _Boundary: 全局_  _Requirements: 7.1, 8.3_
