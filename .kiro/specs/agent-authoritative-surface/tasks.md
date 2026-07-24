# Implementation Plan — agent-authoritative-surface

> 前置:上游 `state-injection-bridge` 的**通用粘性帧修复**(`PiSession.handleRawLine` 的 `piweb_state` 分支 `sticky.set`)须已合并 —— 本 spec 消费它,不实现它。命令走 **agent 转发路径**(无 `name` 逃逸 host 拦截),回流经 `fs.writeSync(1)` 直写 fd1(`takeOverStdout` 坑,只有真实子进程集成测试能抓到)。零 REST route、零 protocol 结构改、宿主零领域语义。

- [x] 1. 协议:surface 命令 payload/result schema
- [x] 1.1 定义 `SurfaceCommandPayloadSchema` / `SurfaceCommandResultSchema` + `SurfaceKey` 类型 (P)
  - 新增 `packages/protocol/src/web-ext/surface.ts`:`SurfaceCommandPayloadSchema`(`domain`/`action` 非空 + `args:unknown` 可选,**无顶层 `name`**)、`SurfaceCommandResultSchema`(`domain`/`action`/`ok`/`data?`/`error?`)、`SurfaceKey = \`surface:${string}\``
  - `web-ext/index.ts` barrel 导出;不改 `UiRpcRequestSchema` / `UiRpcResponseSchema` / `ControlPayloadSchema`
  - 观察完成:`import { SurfaceCommandPayloadSchema } from "@blksails/pi-web-protocol"` 可解析;`safeParse({domain,action})` 成功、`safeParse({name,...})`(无 domain)失败
  - _Requirements: 6.1, 6.2, 6.3, 6.5_
  - _Boundary: protocol/web-ext/surface.ts_
- [x] 1.2 surface schema 单元测试 (P)
  - `packages/protocol/test/web-ext/surface.test.ts`:合法 payload(无 name)、缺 domain/action 拒绝、result round-trip、`UiRpc*` 结构未变(向后兼容断言)
  - 观察完成:`pnpm --filter @blksails/pi-web-protocol test` 覆盖 surface 全绿
  - _Requirements: 6.1, 6.2, 6.4_
  - _Boundary: protocol/test/web-ext/surface.test.ts_
  - _Depends: 1.1_

- [x] 2. agent 侧:进程内 surface 注册表 seam
- [x] 2.1 实现 `surfaceRegistry` + `__piWebSurfaces__` seam
  - 新增 `packages/tool-kit/src/surface/surface-registry.ts`:`SURFACE_REGISTRY_SEAM_KEY`、`getSurfaceRegistry(scope?)`(读/建 globalThis seam)、`register(domain, entry)`/`get(domain)`;`SurfaceDispatch` 接口
  - seam key 常量导出供 server 端 `wireSurfaceBridge` 复用(单一真源)
  - 观察完成:`getSurfaceRegistry(fakeScope)` register 后 `get` 返回同一 entry;未注册返回 `undefined`;不同 scope 隔离
  - _Requirements: 1.1, 3.2_
  - _Boundary: tool-kit/src/surface/surface-registry.ts_
- [x] 2.2 surfaceRegistry 单元测试 (P)
  - `packages/tool-kit/test/surface/surface-registry.test.ts`:register/get/未注册/seam 隔离
  - 观察完成:`pnpm --filter @blksails/pi-web-tool-kit test` 覆盖 registry 全绿
  - _Requirements: 1.1, 3.2_
  - _Boundary: tool-kit/test/surface/surface-registry.test.ts_
  - _Depends: 2.1_

- [x] 3. agent 侧:createSurface 门面
- [x] 3.1 实现 `createSurface(pi, config)`
  - 新增 `packages/tool-kit/src/surface/create-surface.ts`:`SurfaceCtx`/`SurfaceConfig`/`SurfaceHandle` 类型;`update`/`ctx.setState` 经 `getSessionState().set("surface:<domain>", snapshot)`(不自造 control 帧);`dispatch(action,args)` 命中 `commands[action]`(未知 action → `ok:false` `unknown_action`;处理器抛出 → 捕获 `ok:false`);注册进 `getSurfaceRegistry().register(domain,{dispatch})`;经 `pi.registerCommand("surface:<domain>",…)` 注册探针;`ctx.attachments = getAttachmentToolContext()`;`hydrate?` 装配期调用后 `set` 推快照;`replay()` 重推当前快照
  - `initialState` 默认值下沉函数体(避免共享引用);runtime 子入口 barrel 导出 `createSurface`
  - 观察完成:在 fake `pi`/seam 下 `createSurface` 返回 handle;`update` 令 `getSessionState().set` 收到正确 key+snapshot;`dispatch("nope",…)` 返回 `ok:false`
  - `dispatch` 结果**归一化**为 `SurfaceCommandResult`:handler 返回普通值 → `{ok:true,data}`;handler 返回**非抛错** `{ok:false,error}`(领域码如 `edit_failed`)→ 透传;抛出 error → 取 `.code`(如导出的 `SurfaceCommandError{code}`)无则兜底 `dispatch_failed`;并导出 `SurfaceCommandHandlerResult` 联合类型与 `SurfaceCommandError`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 7.1, 7.2, 7.3_
  - _Boundary: tool-kit/src/surface/create-surface.ts, tool-kit/src/surface/index.ts, tool-kit/src/runtime.ts_
  - _Depends: 1.1, 2.1_
- [x] 3.2 createSurface 单元测试 (P)
  - `packages/tool-kit/test/surface/create-surface.test.ts`:注入 fake `getSessionState`/`getSurfaceRegistry`/`pi.registerCommand`;断言 update→set(key,snapshot)、探针注册被调、initialState 不共享引用、hydrate 重建后推快照
  - **dispatch 错误归一化**单测点:命中普通返回值→`{ok:true,data}`;未知 action→`{ok:false,unknown_action}`;handler **非抛错**返回 `{ok:false,error:{code:"edit_failed"}}`→原样透传(ok:false + code 保留);handler 抛 `SurfaceCommandError("edit_failed",…)`→`ok:false` 且 `error.code==="edit_failed"`(code 传播);抛普通 `Error`→兜底 `error.code==="dispatch_failed"`
  - 观察完成:tool-kit test 覆盖 create-surface 全绿
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 5.1_
  - _Boundary: tool-kit/test/surface/create-surface.test.ts_
  - _Depends: 3.1_

- [x] 4. runner 侧:ui-rpc 命令接收与派发接线
- [x] 4.1 实现 `wireSurfaceBridge`
  - 新增 `packages/server/src/runner/surface-wiring.ts`:第二个 stdin JSONL 读取器截获 `{"type":"ui_rpc","request"}`;仅当 `point==="command"` && `action==="execute"` && `SurfaceCommandPayloadSchema.safeParse(payload).success` 时消费,否则**放行**(不写回);按 `payload.domain` 查 `getSurfaceRegistry().get(domain)`,命中 dispatch、未注册 → `ok:false` `surface_not_registered`;回流经 `fs.writeSync(1, line+"\n")` 直写 fd1(单次原子);`stdin`/`stdout`/`globalScope` 可注入;env/挂载失败 → 记诊断 no-op 降级;`cleanup()`
  - 复用 `SURFACE_REGISTRY_SEAM_KEY`(与 tool-kit 一致);结构对齐 `state-wiring.ts`
  - 观察完成:注入 stdin 写 ui_rpc 命令行 → 注入 stdout 出现 `ui_rpc_response`;写非 surface 行(如 slash list)→ stdout 无写回(放行)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - _Boundary: server/src/runner/surface-wiring.ts_
  - _Depends: 1.1, 2.1_
- [x] 4.2 接入 runner 装配序
  - 改 `packages/server/src/runner/runner.ts`:`startRunner` 内在 `wireStateBridge(...)` 之后、`return runRpcMode(runtime)` 之前调 `wireSurfaceBridge(runtime, {sessionId})`
  - 观察完成:启动真实/stub runner 无回归;未注册 surface 的会话行为与接入前一致
  - _Requirements: 3.1, 3.6, 10.5_
  - _Boundary: server/src/runner/runner.ts_
  - _Depends: 4.1_
- [x] 4.3 wireSurfaceBridge 单元测试 (P)
  - `packages/server/test/runner/surface-wiring.test.ts`(注入 stdin/stdout/registry):命中派发写回、非 surface 行放行、未注册 domain→`surface_not_registered`、payload 畸形不写回、无 registry 惰性降级
  - 观察完成:`pnpm --filter @blksails/pi-web-server test` 覆盖 surface-wiring 全绿
  - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6_
  - _Boundary: server/test/runner/surface-wiring.test.ts_
  - _Depends: 4.1_

- [x] 5. UI 侧:useSurface hook
- [x] 5.1 实现 `useSurface(domain)`
  - 新增 `packages/react/src/hooks/use-surface.ts`:`state`/`rev` 基于 `useExtensionState("surface:<domain>")`(未就绪 `null`);`run(action,args?)` 经注入 ui-rpc bus 发 `{point:"command",action:"execute",payload:{domain,action,args}}`(**不用** `client.uiRpcCommand`),结果 `SurfaceCommandResultSchema` safeParse 后解析;`available` 挂载时 `getCommands()` 查 `surface:<domain>`;react barrel 导出
  - 观察完成:mock ControlStore/bus/getCommands 下 `run` 发对形 payload 并按 correlationId 解析;`state` 随 `control:"state"` 帧收敛;`available` 反映探针存在
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.2, 5.3, 5.4, 2.1, 2.3_
  - _Boundary: react/src/hooks/use-surface.ts_
  - _Depends: 1.1_
- [x] 5.2 useSurface 单元测试 (P)
  - `packages/react/test/hooks/use-surface.test.tsx`:state 镜像 + rev 收敛/丢弃乱序、run 发对形 payload+correlationId 配对、available true/false、未就绪 state=null
  - 观察完成:`pnpm --filter @blksails/pi-web-react test` 覆盖 use-surface 全绿
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.2_
  - _Boundary: react/test/hooks/use-surface.test.tsx_
  - _Depends: 5.1_

- [x] 6. 领域无关示例 surface(e2e/集成夹具)
- [x] 6.1 实现 `surface-demo-agent`
  - 新增 `examples/surface-demo-agent/{index.ts,README.md,.pi/web/web.config.tsx}`:经 `extensions:[(pi)=>createSurface(pi,{domain:"demo",initialState:{count:0,log:[]},commands:{increment, echo}})]` 装载;`.pi/web` 用 `SlotContribution` 具名槽挂 `SurfaceDemoPanel`,内部 `useSurface("demo")` 渲染 count + `available===false` 退化只读;**无任何 AIGC/领域语义泄漏进宿主**
  - `examples/README.md` 注册一行
  - 观察完成:`surface-demo-agent` 可被 runner 加载;命令 `increment` 令快照 count+1
  - _Requirements: 9.4, 10.4, 8.4_
  - _Boundary: examples/surface-demo-agent_
  - _Depends: 3.1, 5.1_
- [x] 6.2 注册示例到 webext-registry(e2e 静态加载)
  - 改 `lib/app/webext-registry.ts`:静态 import `surface-demo-agent` 的 `.pi/web`(绕签名门控,对齐既有示例)
  - 观察完成:隔离 build 下 `surface-demo-agent` slot 渲染器可挂载
  - _Requirements: 10.4_
  - _Boundary: lib/app/webext-registry.ts_
  - _Depends: 6.1_

- [x] 7. 真实子进程集成测试(fd1 直写坑)
- [x] 7.1 命令转发 → 派发 → fd1 回流 集成测试
  - `packages/server/test/runner/surface-bridge.integration.test.ts`(真实子进程,装 `wireSurfaceBridge` + 一个 surface):server 经 `PiSession.uiRpc` 发 surface 命令 → 子进程派发 → **fd1** 出现 `ui_rpc_response` → server `handleRawLine` 合成 `control:"ui-rpc"` 帧(按 correlationId);断言 `process.stdout.write` 路径无法送达(fd1 直写坑,stub 抓不到)
  - 观察完成:集成测试断言收到 `control:"ui-rpc"` 帧且 result 为 `SurfaceCommandResult`
  - _Requirements: 3.3, 10.3, 2.4, 2.5_
  - _Boundary: server/test/runner/surface-bridge.integration.test.ts_
  - _Depends: 4.1, 4.2, 3.1_
- [x] 7.2 命令内 setState 下行 + 放行 集成测试
  - 同/邻集成测试:命令处理器 `ctx.setState` → `piweb_state`(fd1)→ `control:"state"` 帧(`key="surface:demo"`);另断言无 surface 注册时非 surface 命令行被放行、既有链路正常(降级/放行)
  - 观察完成:断言收到 `control:"state"` 帧(key=surface:demo)且 value 为新快照;放行场景无回归
  - _Requirements: 1.2, 3.4, 3.6, 10.5_
  - _Boundary: server/test/runner/surface-bridge.integration.test.ts_
  - _Depends: 4.1, 4.2, 3.1_

- [x] 8. 浏览器 e2e:端到端闭环 + 退化
- [x] 8.1 surface 命令闭环 + 退化 e2e
  - 新增 `e2e/browser/agent-authoritative-surface.e2e.ts`(external server + 隔离 `NEXT_DIST_DIR`):① `surface-demo-agent` 挂载 → 点击触发 `run("increment")` → 转发 → 派发 → 快照回流 → 视图计数更新,断言**无 `/messages`**(命令不过 LLM);② 切非该 domain source(如 `hello-agent`)→ `getCommands` 无 `surface:demo` → `available===false` → 退化只读不报错
  - 观察完成:playwright 新鲜运行两条断言全绿(计数递增 + 退化)
  - _Requirements: 2.1, 4.4, 5.3, 5.5, 8.3, 10.4_
  - _Boundary: e2e/browser/agent-authoritative-surface.e2e.ts_
  - _Depends: 6.1, 6.2, 5.1_

- [x] 9. 质量门与宿主中立性验收
- [x] 9.1 全量 typecheck + 受影响包测试 + 中立性 grep
  - 全工作区 `typecheck`(strict、无 `any`);`pnpm test` 覆盖 protocol/tool-kit/server/react + app 受影响包;grep `app/` + `packages/server` 无领域语义(`demo`/`canvas`/`gallery`)出现在 value/payload 解析路径(仅示例夹具与 UI 渲染器含 domain 名)
  - 观察完成:typecheck EXIT 0;受影响包测试 + 集成 + e2e 全绿;中立性 grep 无宿主匹配,以新鲜运行证据记录
  - _Requirements: 8.1, 8.2, 8.3, 10.1, 10.2, 10.5_
  - _Boundary: (跨包验证任务)_
  - _Depends: 1.2, 2.2, 3.2, 4.3, 5.2, 7.1, 7.2, 8.1_

## Implementation Notes

**2026-07-24 记账核实回勾(非重新实现)**:本 spec 的全部产物早已随 surface 栈落地 main(见记忆 `surface-stack-implemented-and-ses-docs` / `surface-runtime-facade-spec`,FF 合本地 main `29c5390`),但 26 项任务从未回勾。本轮以**新鲜运行证据**逐面核实后回勾,零代码改动:

- **1.2 protocol schema**:`packages/protocol/test/web-ext/surface.test.ts` 5/5 绿。
- **2.2/3.2 tool-kit**:`surface-registry.test.ts` + `create-surface.test.ts` 共 23/23 绿(含 dispatch 错误归一化四点)。
- **5.2 react**:`use-surface.test.tsx` 7/7 绿。
- **4.3/7.1/7.2 server**:`surface-wiring.test.ts` 9/9 + `surface-bridge.integration.test.ts` **2/2 真实子进程 fd1 回流 + setState 下行**;下游 `canvas-surface.integration.test.ts` 4/4 佐证整栈端到端。
- **3.1/4.2/6.2 接线**:`createSurface` 经 `runtime.ts` / `surface/index.ts` barrel 导出;`useSurface` 经 react barrel 导出;`wireSurfaceBridge` 在 `runner.ts:420` 装配序接入;`surface-demo-agent` 在 `webext-registry.ts:105` 静态注册。
- **8.1 browser e2e**:`e2e/browser/agent-authoritative-surface.e2e.ts` 2/2 绿(increment 计数递增 + 命令不过 LLM + 无关 source 退化)。
- **9.1 质量门**:全量 `pnpm typecheck` 零 error;宿主中立性 grep —— `server/src/runner/surface-{wiring,command-dispatcher}.ts` 与 `protocol/.../surface.ts` **均无 demo/canvas/gallery 领域语义**,领域名仅出现在示例夹具与 UI 渲染器(符合 tasks 约定)。
