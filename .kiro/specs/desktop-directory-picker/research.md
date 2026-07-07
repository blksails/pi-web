# Research Log — desktop-directory-picker

## Discovery Scope
- **类型**:对既有系统(pi-web 桌面壳 + AgentSourcePicker)的扩展(集成型发现,light)。
- **目标**:定位注入接缝(preload 桥 / 主进程 / 前端 picker / chat-app 装配 / i18n / 构建 / e2e),使新增能力零回归接入。

## Key Findings

### F1. preload 桥已预留扩展点
`desktop/src/preload.ts` 现仅 `contextBridge.exposeInMainWorld("piWebDesktop", { readonly, platform })`,注释明写「后续桌面能力(如原生对话框桥)在 M2 按需扩展」。sandbox 下 `ipcRenderer` 仍可用,`ipcRenderer.invoke` + 主进程 `ipcMain.handle` 是官方推荐的隔离态双向调用范式。

### F2. 主窗口引用可得,dialog 需父窗体
`desktop/src/main.ts` 持有模块级 `mainWindow`,`ensureWindow()` 保证可取。`dialog.showOpenDialog(win, { properties: ["openDirectory"] })` 以主窗口为父可得原生 sheet/modal。

### F3. 构建脚本无需改动
`desktop/build.mjs` 用 esbuild 只以 `src/main.ts`、`src/preload.ts` 为入口 bundle。新模块 `dialog-bridge.ts` 被 main.ts import 后自动内联进 `dist/main.js`;preload 编辑进 `dist/preload.js`。**结论:不动 build.mjs。**

### F4. AgentSourcePicker 是纯注入式组件,单一渲染点
组件所有数据/回调经 props 注入(`listAgentSources`/`favoriteSources`/`onToggleFavorite`),自身不碰全局——沿此风格新增 `onBrowseDirectory?` prop 与门控(prop 未注入 ⇒ 不显示入口)与既有 `enableSourceList` 同构。全仓仅 `components/chat-app.tsx` 一处渲染 `<AgentSourcePicker>`(`grep -rln AgentSourcePicker` 证实),故装配注入点唯一。

### F5. 前端桌面态检测靠 `window.piWebDesktop`
浏览器态该全局为 `undefined`;据其存在与否天然门控入口。为避免 `any` 且集中 window 类型,在 app 侧建一个受类型约束的访问器,picker 保持纯净不读全局。

### F6. i18n 走 packages/ui 自研字典
`packages/ui/src/i18n/messages.ts` 有 `agentSourcePicker.*` 键(zh/en 双字典)。新增按钮文案加一个键并补两字典。

### F7. e2e 用 Playwright `_electron` 驱动真实壳
`e2e/desktop/desktop-real.mjs` 用 `_electron.launch` 起真实未打包壳、mock provider、临时 agent-dir。原生对话框无法被 Playwright 点选;标准解法是 `electronApp.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[STUB] }) })` 在触发前猴补——零生产测试钩子。因 `dialog-bridge.ts` 以 `dialog.showOpenDialog(...)` 调用(`dialog` 为同一对象引用),替换其 `.showOpenDialog` 属性即生效。

## Design Decisions

- **D1 IPC 通道名**:`"piweb:pick-directory"`,`ipcMain.handle` ↔ `ipcRenderer.invoke`,返回 `string | undefined`(取消/失败均 undefined)。桥契约在 preload(desktop 侧)与 app 访问器(前端侧)两处以字面量对齐,单方法桥重复可接受,以文档锚定防漂移。
- **D2 失败即取消语义**:主进程 handler `try/catch` → 失败返回 `undefined` 并打 stderr(观测),渲染层不 reject。前端另加 catch 兜底。满足 Req 5.1(不建会话/不改原值/非破坏)。
- **D3 填入不提交**:选中路径仅 `setValue(path)`(Req 2.3),复用既有 submit 流程(Req 2.4)。
- **D4 不阻塞与防重入**:仅在调用期禁用「浏览」按钮自身(`try/finally` 清标志),不禁用手输/源列表(Req 5.2);`loading`(建会话中)时一并禁用浏览按钮(与 submit 一致)。
- **D5 类型契约集中**:app 侧 `PiWebDesktopBridge` 接口 + `getPiWebDesktopBridge()` 访问器,`no any`;picker 只认 `onBrowseDirectory` 函数 prop。

## Synthesis
- **Generalization**:桥面命名为「桌面能力桥」通用形态,当前只实现 `pickDirectory` 一个方法,接口留可追加(future: 选文件/系统托盘)——泛化接口不泛化实现。
- **Build vs Adopt**:采用 Electron 原生 `dialog.showOpenDialog` + `contextBridge`/`ipcRenderer.invoke`,不自造对话框或文件浏览器;OS 原生对话框即用户授权面。
- **Simplification**:不新增服务端路由、不持久化最近项、不碰 source 解析/信任;最小闭环 = 主进程 handler + preload 一方法 + picker 一按钮 + 一装配注入。

## 实现期发现(修订 F3)

**F3 修正 —— 构建脚本必须改(原判「无需改」证伪)**:实现后跑真实 Electron e2e 时,渲染层
`window.piWebDesktop` 恒为 undefined。根因:`desktop/build.mjs` 的 `common.banner` 注入
`const __piImportMetaUrl = require('node:url').pathToFileURL(__filename).href;`,被同时套到 main
与 **preload** 两个入口;而 **sandbox 下的 preload 无 `__filename`**,加载即抛
`ReferenceError: __filename is not defined` → 整个 preload 脚本不执行 → contextBridge 暴露失效。
这是 **M1 起潜伏的桌面壳 bug**(此前无人依赖桥、e2e 未验渲染层暴露,故未暴露)。修复:banner/define
拆为 `mainOnly`,**仅套 main.js**;preload 用纯 `common`(不含 `__filename` banner)。preload 不使用
import.meta.url,故无需该 shim。诊断锚点:Playwright `page.on("console")` 捕获到 preload 加载错误。

## Risks
- **R1**:destructured `import { dialog }` 若被内联优化可能与 evaluate 猴补脱钩——已核实调用形态为 `dialog.showOpenDialog(...)`(属性访问),替换对象属性即生效;e2e 亲验为准。
- **R2**:桥契约两处字面量漂移——以本 research D1 + design Boundary 锚定,单测覆盖 preload 形状与 handler 行为。
