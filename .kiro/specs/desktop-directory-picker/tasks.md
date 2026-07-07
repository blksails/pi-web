# Implementation Plan

## 1. 基础层(文案与前端桥访问器)

- [x] 1.1 新增「浏览文件夹」i18n 文案键(zh/en) (P)
  - 在 UI 自研字典中新增 `agentSourcePicker.browseDirectory`,zh 为「浏览文件夹…」,en 为对应英文(如 "Browse folder…")
  - 观察完成:两套字典均含该键,`useI18n` 取键返回对应语言文案,现有键不受影响
  - _Requirements: 1.1_
  - _Boundary: i18n messages_

- [x] 1.2 实现 app 侧桌面桥类型契约与访问器 + 单测 (P)
  - 定义 `PiWebDesktopBridge` 接口(`readonly`/`platform` + 可选 `pickDirectory`),提供 `getPiWebDesktopBridge()` 读取 `globalThis.piWebDesktop`,`no any`
  - 浏览器/SSR 态(无注入)返回 `undefined`;桌面态透出 `pickDirectory`
  - 观察完成:单测证明缺省全局 → `undefined`;存在全局 → 返回带 `pickDirectory` 的对象
  - _Requirements: 1.2, 1.3, 4.2_
  - _Boundary: getPiWebDesktopBridge_

## 2. 核心层(桌面主进程 / preload / 前端 picker)

- [x] 2.1 实现桌面主进程目录选择 IPC handler + 单测 (P)
  - 注册 `piweb:pick-directory` handler,调 `dialog.showOpenDialog(win, { properties: ["openDirectory","createDirectory"] })`,以主窗口为父窗体
  - 仅返回被选目录绝对路径字符串;取消/无选择/异常一律返回 `undefined`(异常经 `try/catch` 降级 + stderr 记录,不使 IPC reject);绝不返回目录内容或 fs 元数据
  - 观察完成:单测覆盖三分支——选中 → 路径、取消 → `undefined`、`showOpenDialog` 抛错 → `undefined`(不 reject)
  - _Requirements: 2.1, 2.2, 2.5, 3.3, 4.3, 5.1_
  - _Boundary: dialog-bridge_

- [x] 2.2 preload 桥暴露 pickDirectory + 形状单测/断言 (P)
  - 在既有 `piWebDesktop` 上追加 `pickDirectory: () => ipcRenderer.invoke("piweb:pick-directory")`,保留 `readonly`/`platform`(向后兼容追加);不引入任何通用 fs / Node 能力
  - 断言窗口 `webPreferences` 的 `contextIsolation`/`sandbox`/`nodeIntegration` 隔离标志未被本改动触碰
  - 观察完成:测试证明 `piWebDesktop` 暴露 `pickDirectory` 且仍含 `readonly`/`platform`;隔离标志断言通过
  - _Requirements: 2.2, 3.1, 3.2, 3.4_
  - _Boundary: preload_
  - _Depends: 2.1_

- [x] 2.3 扩展 AgentSourcePicker:门控「浏览文件夹」入口 + 回填 + 单测 (P)
  - 新增可选 prop `onBrowseDirectory`;仅当注入时在来源框旁渲染 `data-agent-source-browse` 按钮(文案取 `agentSourcePicker.browseDirectory`)
  - 点击:置局部 browsing 标志(仅禁用该按钮,`loading` 中亦禁用)→ `await onBrowseDirectory()` → 非空字符串则 `setValue(path)` 且不触发提交;`undefined`/异常保持原值(`try/catch` 吞异常);`finally` 清标志;手输框与源列表全程不被禁用
  - 观察完成:单测覆盖——未注入 prop 无按钮 / 注入渲染按钮 / resolve 路径回填且无 `onSubmit` / resolve `undefined` 与 reject 均保持原值且手输可用
  - _Requirements: 1.1, 1.4, 2.3, 2.5, 5.1, 5.2_
  - _Boundary: AgentSourcePicker_
  - _Depends: 1.1_

## 3. 集成层(装配到桌面壳与前端)

- [x] 3.1 在桌面主进程启动链注册目录选择桥
  - 在 `app.whenReady()` 编排中调用一次桥注册,传入主窗口获取器(复用 `ensureWindow`),使打包/未打包态渲染层可经 IPC 触达 handler
  - 观察完成:桌面壳启动后 `ipcMain` 存在 `piweb:pick-directory` handler,渲染层调用 `piWebDesktop.pickDirectory` 能触达主进程(经 e2e 亲验)
  - _Requirements: 2.1_
  - _Depends: 2.1_

- [x] 3.2 chat-app 装配:将桌面桥的 pickDirectory 注入 AgentSourcePicker
  - 在唯一的 `<AgentSourcePicker>` 渲染点,把 `getPiWebDesktopBridge()?.pickDirectory` 作为 `onBrowseDirectory` 传入;桌面态出现入口,浏览器态因桥缺省而不传、入口不渲染
  - 回填路径后经既有 `onSubmit` 通道建会话(与手输等价字符串完全一致)
  - 观察完成:桌面态 picker 显示浏览按钮并可回填→提交建会话;浏览器态 picker 无浏览按钮且现有手输/源列表行为不变
  - _Requirements: 1.1, 1.2, 1.3, 2.4_
  - _Depends: 1.2, 2.3_

## 4. 验证层(端到端 + 安全回归)

- [x] 4.1 真实 Electron 目录选择桥闭环 e2e
  - 新增可重复的真实(未打包)Electron e2e:`electronApp.evaluate` 猴补 `dialog.showOpenDialog` 返回固定临时目录 → 渲染层调用 `window.piWebDesktop.pickDirectory()` → 断言经 preload contextBridge→ipcRenderer.invoke→ipcMain handler→dialog 回传该目录绝对路径,且桥暴露保留 `readonly`
  - 说明:桌面壳首屏恒 autostart 进会话,故 e2e 直测桥机制(真实壳唯一能证);「浏览」按钮→回填输入框的 UI 接线由 jsdom 单测覆盖(task 2.3)
  - 观察完成:e2e 本地跑出新鲜通过证据(pickDirectory 回传 == 桩目录),落 evidence 截图
  - _Requirements: 2.1, 2.2, 3.1, 3.3, 3.4_
  - _Depends: 3.1, 3.2, 2.2_

- [x] 4.2 安全边界回归与全量校验
  - 断言浏览器态不存在 `data-agent-source-browse`(能力零外溢);全局核查未新增任何本地目录枚举/浏览服务端路由;确认服务端 source 解析/信任裁定文件未被本特性改动
  - 跑受影响范围 typecheck + 相关包/前端单测 + 浏览器 e2e 冒烟,确认无回归
  - 观察完成:上述断言与测试均出新鲜通过证据;`grep` 结果证明无新增目录枚举路由
  - _Requirements: 3.2, 4.1, 4.2, 4.4_
  - _Depends: 4.1_
