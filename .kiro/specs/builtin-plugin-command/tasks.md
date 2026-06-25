# Implementation Plan

- [ ] 1. 基础：声明层与协议

- [x] 1.1 (P) BuiltinCommandSpec 类型与默认集
  - 在 tool-kit 定义内置命令纯声明类型（name/description/argumentHint/aliases/target/subcommands/userOnly）
  - 提供默认集（含 `/plugin` 及其子命令 install/uninstall/list/enable/disable/update），纯数据导出
  - 完成态：从 tool-kit 主入口可导入 BUILTIN_COMMANDS，含 `/plugin` 且标 userOnly
  - _Requirements: 1.2, 3.1, 3.5, 7.1, 7.2_
  - _Boundary: BuiltinCommandSpec_

- [x] 1.2 (P) 命令来源枚举增 builtin
  - 协议 RpcSlashCommand 的 source 枚举增加 `builtin`，结构不变
  - 完成态：source 可取 builtin，旧字段/结构兼容
  - _Requirements: 1.2, 1.5_
  - _Boundary: protocol RpcSlashCommand_

- [ ] 2. 核心：服务端合流与重载

- [x] 2.1 runner 重启转发与 SessionReloader 注入
  - 在会话对象上新增薄方法转发底层 runner 的 requestRestart（重 spawn 续会话、重解析资源）
  - 实现并准备注入的 SessionReloader（调该方法）
  - 完成态：单测显示该方法转发 requestRestart；reloader 调用不抛
  - _Requirements: 6.1, 6.2_
  - _Boundary: restartRunner, session reloader_

- [x] 2.2 挂载扩展安装路由并注入 reloader
  - 在宿主路由注入处调用既有 createExtensionRoutes，传入 piCli/store/管理员策略/审计，并注入上一步的 reloader
  - 完成态：GET/POST /extensions、DELETE /extensions/:extId、POST /sessions/:id/reload 四端点可达
  - _Requirements: 4.1, 4.3, 5.1, 5.3, 6.1_
  - _Depends: 2.1_
  - _Boundary: extension routes mount_

- [x] 2.3 (P) 命令合流
  - GET 会话命令端点把内置命令映射为 source=builtin 并前置合流到 agent 命令前；同名内置优先
  - 完成态：单测显示返回列表内置前置、含 /plugin、同名以内置胜
  - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - _Boundary: commands merge, toRpcSlashCommand_

- [ ] 3. 核心：客户端分派与面板

- [ ] 3.1 (P) 扩展安装 transport 方法
  - 前端 REST client 增 list/install/remove/reloadSession 方法，打既有 /extensions 与 /sessions/:id/reload
  - 完成态：方法以正确 method/path/body 发起请求（单测/契约校验）
  - _Requirements: 3.2, 3.3, 4.1, 8.1_
  - _Boundary: pi-client ext methods_

- [ ] 3.2 客户端 handler 与面板分派
  - /plugin 客户端 handler 注册表：install/uninstall/list/enable/disable/update 调 transport；无参开面板
  - 命令面板 select 按 source 分派：builtin 走 handler（不填输入框、不发提示），其余维持现状；内置命令带可区分徽标
  - 完成态：选中内置命令不向会话发送提示；选中 agent 命令仍填输入框
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2, 3.3, 3.4, 1.4_
  - _Depends: 3.1_
  - _Boundary: client-handlers, palette dispatch_

- [ ] 3.3 plugin 管理面板
  - 面板列出已安装 plugin 及作用域、错误项；提供启用/禁用/卸载并刷新
  - 完成态：面板打开渲染已装列表;操作后刷新
  - _Requirements: 8.1, 8.2, 8.3_
  - _Depends: 3.1_
  - _Boundary: plugin-panel_

- [ ] 4. 集成

- [ ] 4.1 app-shell 接线
  - 把面板挂到 ui-surface 插槽、把分派接入运行中的面板与会话上下文；安装/卸载后呈现生效或失败反馈
  - 完成态：从对话内 /plugin 可打开面板并执行装/卸，得到生效或失败反馈
  - _Requirements: 3.1, 6.2, 9.1, 9.2_
  - _Depends: 2.2, 3.2, 3.3_

- [ ] 4.2 装后双路生效回填 webext
  - 安装完成挂点同时触发 webext 加载生效路径（实现在 webext-package-install），与资源重载并行
  - 完成态：安装含 webext 的包后资源重载与 webext 加载两路均发生（与 webext-package-install 联测）
  - _Requirements: 6.3_
  - _Depends: 2.2, 4.1_

- [ ] 5. 验证

- [ ] 5.1 (P) 合流/重载/映射单元测试
  - toRpcSlashCommand 映射、合流前置+同名优先、restartRunner 转发
  - 完成态：单测全绿
  - _Requirements: 1.1, 1.2, 1.3, 6.1_
  - _Boundary: commands merge, restartRunner_

- [ ] 5.2 挂载与安装链集成测试
  - 挂载后四端点可达；install→reload 触发 restartRunner
  - 完成态：集成测试全绿
  - _Requirements: 4.1, 5.1, 6.1_
  - _Depends: 2.2_

- [ ] 5.3 浏览器端到端验证
  - /plugin 出现在面板且带 builtin 徽标、无参开面板；选中内置命令不向会话发提示
  - 完成态：NEXT_DIST_DIR=.next-e2e external server 下 e2e 全绿
  - _Requirements: 1.1, 1.4, 2.1, 2.3, 3.1_
  - _Depends: 4.1_
