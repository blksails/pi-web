# Implementation Plan

> 实施按波次推进。Foundation(契约/脚手架/registry 改造)先行解锁其余;Core 三簇(web-kit+build / 宿主加载器+安全门 / UI↔agent RPC)在 Foundation 后可较大并行;随后宿主 UI 集成、示例 source、e2e 验证。
> MVP 垂直切片 = 任务 1~5 + 示例 6.1/6.2/6.3/6.4 + 验证 7;Tier 4 artifact(5.4/6.5)与签名硬化为同批次后段,若需进一步收敛可整体后移(在对应任务注明)。

> ## 实施进度快照(2026-06-19)— 24/24 子任务完成 ✅
> **已完成 + 已验证(全 6 包 + app typecheck EXIT 0;全量测试绿):** 全部 1.1~7.3。
> 新增测试:protocol web-ext 16 · ui registry 命名空间 4 · web-kit 16(含 esbuild 集成 build)·
> web-kit 示例构建 4 · gate 11 · loader 6 · ui-rpc-bus 6 · PiSession ui-rpc 4 · apply-extension 6 ·
> PiChat×extension 3 · artifact-surface 5 · contributions-controller 4 · node e2e 6(含 Tier3 ui-rpc 闭环)·
> 浏览器 Playwright webext e2e 2(layout 区域插槽渲染 + declarative 零 bundle 回退)。
> 4.1:channel 原始行约定 `ui_rpc`/`ui_rpc_response` + `PiSession.uiRpc` + control:ui-rpc 帧,stub agent 实现 handler。
> app-shell:`lib/app/webext-registry.ts` 构建期集成(按 source 解析示例扩展 → PiChat);CSP 加 `'unsafe-inline'` 兼容 Next hydration;web-kit 入 transpilePackages。
> 浏览器 e2e 运行:`NEXT_DIST_DIR=.next-e2e next build` → 外部 server(`PI_WEB_E2E_EXTERNAL_SERVER=1` + `next start -p 3100`)→ `playwright test e2e/browser/webext.e2e.ts --project=fs`(2 passed)。
> 注:全 fs 浏览器套件另有 settings-config / rich-chat 2~3 个失败,属**既有 config-UI WIP**(app/settings、pi-command-palette 在本会话前已改),与本特性无关。

## 1. Foundation:协议契约、包脚手架与 registry 改造

- [x] 1.1 在 protocol 新增 UI 控制层契约 schema
  - 定义 `WebExtensionManifest`(id/targetApiVersion/entry/css/integrity/signature/capabilities)zod schema 与类型
  - 定义 `WebExtension` 描述符(slots/renderers/contributions/config/artifact)与 `SlotKey` 联合
  - 定义 `UiRpcRequest`/`UiRpcResponse` 与 `control` 帧 `ui-rpc` 载荷;定义 `ArtifactMessage` 联合;均带 `protocolVersion`
  - 经 protocol barrel 导出;新增 schema 的合法/非法样例可被 zod 校验通过/拒绝
  - 完成态:`pnpm --filter @blksails/protocol test` 含新 schema 单测且通过
  - _Requirements: 1.3, 2.1, 4.1, 4.6, 5.4, 6.1_
  - _Boundary: protocol web-ext schema_

- [x] 1.2 脚手架 `@blksails/web-kit` 工作区包
  - 新建包 `package.json`(exports `.` 与 `./build`,bin `pi-web`,依赖 `@blksails/protocol`、esbuild)、tsconfig、空 barrel
  - 仅依赖 protocol,不依赖 server 内部;`pnpm install` 后包可被解析、`typecheck` 通过(空实现占位)
  - 确立示例 `.pi/web` 如何解析 `@blksails/web-kit`:示例经 standalone `pi-web build` 构建(不纳入 `pnpm-workspace.yaml`),避免后续 (P) 示例任务争用共享工作区配置
  - 完成态:`pnpm --filter @blksails/web-kit typecheck` EXIT 0;示例构建解析路径已文档化
  - _Requirements: 9.1, 9.4_
  - _Boundary: web-kit package scaffold_

- [x] 1.3 registry 改为 per-session 作用域 + extId 命名空间
  - 在 `renderer-registry` 增加按会话创建实例的使用路径,注册 key 以 `<extId>:` 前缀命名空间化
  - 保留 `defaultRendererRegistry` 单例兼容既有宿主直接注册路径
  - 提供会话结束时清空该会话注册的能力
  - 完成态:单测证明两个 extId 注册同一 type 互不覆盖,且会话结束后实例为空
  - _Requirements: 3.2, 3.5_
  - _Boundary: renderer-registry_

## 2. Core:web-kit 作者 SDK 与 `pi-web build` 工具

- [x] 2.1 (P) 实现 web-kit 作者 SDK 面
  - `defineWebExtension()` identity + 编译期类型校验;`UiRpcClient` 接口与经宿主注入桥的实现
  - `host-context`(从宿主取 registry/bus/theme)与受控设计原语 re-export;`slots` key 常量与 protocol 对齐
  - 与 `@blksails/agent-kit` 的 `defineAgent` 使用范式对称
  - 公共 API 遵循语义化版本,在导出面明确标注稳定核与 experimental 区(experimental 入口加显式标记/命名空间)
  - 完成态:示例性 `.pi/web/web.config.ts` 能以类型安全方式书写并通过 typecheck;导出面区分稳定/experimental
  - _Requirements: 9.1, 9.2, 9.4, 9.5_
  - _Boundary: web-kit src_
  - _Depends: 1.1, 1.2_

- [x] 2.2 (P) 实现 `pi-web build` 编排与 externals 强制
  - esbuild 编排:将 `react`/`react-dom`/`@blksails/web-kit`/设计系统标 external,产出自包含 ESM
  - `externals-guard`:扫描产物,内联了上述任一单例则 `exit 1` 并报告
  - 完成态:对内联 React 的样例输入 build 失败;对正确 external 的输入产出 `.mjs`
  - _Requirements: 6.1, 6.4, 9.3_
  - _Boundary: web-kit build_
  - _Depends: 1.2_

- [x] 2.3 (P) 实现 CSS scoping 构建插件
  - 所有 class 前缀 `pw-<extId>-<hash>`;拒绝/剥离全局选择器(`*`/`html`/`body`/`:root`/顶层标签/`@layer base`)
  - `@keyframes`/`@font-face` 命名空间化;拒绝 Tailwind preflight;强制 `--pw-<extId>-*` 变量前缀(只读宿主 token);资源 URL 经 `import.meta.url` 改写
  - 完成态:单测覆盖前缀注入、全局选择器剥离、keyframes 命名空间、preflight 拒绝四类输入
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - _Boundary: web-kit build css-scope-plugin_
  - _Depends: 1.2_

- [x] 2.4 实现 manifest 产出(SRI/签名)与 CLI 入口
  - 计算 entry SRI 摘要写入 `manifest.json`;可选用配置私钥对规范化 manifest 字节签名;`pi-web` bin 串起 2.2/2.3
  - 完成态:`pi-web build` 在样例 `.pi/web` 上产出 `web-extension.mjs` + `manifest.json`(integrity 与 entry 字节一致)
  - _Requirements: 6.1, 7.2, 9.3_
  - _Depends: 2.2, 2.3_

## 3. Core:宿主加载器与安全门

- [x] 3.1 (P) 实现扩展安全门校验
  - `verify(manifest, opts)` 校验 SRI 完整性、签名 ∈ 白名单、`targetApiVersion` 兼容宿主 web-kit 主版本
  - 任一不通过返回带原因的拒绝;记录被拒原因供审计
  - 完成态:单测证明 SRI 不符 / 签名不在白名单 / 版本不兼容分别被拒,合法通过
  - _Requirements: 1.5, 6.5, 7.1, 7.2, 7.4, 7.5_
  - _Boundary: react web-ext extension-gate_
  - _Depends: 1.1_

- [x] 3.2 (P) 实现运行时扩展加载器
  - 探测 agent source 的 `.pi/web`/manifest;注入 import map 把裸 specifier 映射到宿主单例 URL;动态 `import()` 入口返回描述符
  - 纯声明扩展(无 entry)走零 bundle 路径;无 `.pi/web` 或加载失败回退默认 UI 不报错;per-session 懒加载(仅会话激活时加载)
  - 完成态:集成测试加载样例 bundle 不触发重复 React(无 invalid hook);缺失/非法时回退默认
  - _Requirements: 1.1, 1.2, 1.4, 6.2, 6.3, 6.4, 6.6_
  - _Boundary: react web-ext extension-loader_
  - _Depends: 1.1_

- [x] 3.3 应用收紧 CSP 与门控配置注入
  - 在宿主响应头应用 CSP(限制 connect-src、禁 unsafe-eval);从 env 注入白名单公钥/签名要求/CSP 配置到装配层
  - 完成态:开发与构建态响应含预期 CSP 头;门控配置可经 env 改变白名单
  - _Requirements: 7.3, 7.5_
  - _Depends: 3.1_

## 4. Core:UI↔agent RPC 总线

- [x] 4.1 (P) 实现服务端 ui-rpc 转发与下行翻译
  - 新增 `POST /sessions/:id/ui-rpc` 端点把请求转发给 agent;将 agent 侧 ui-rpc 事件翻译为 `control: ui-rpc` 帧下行
  - 完成态:对真实/stub 子进程发起 ui-rpc,服务端返回 ack 且经 SSE 回传带相同 correlationId 的响应帧
  - _Requirements: 4.1, 4.6_
  - _Boundary: server http ui-rpc, translate-event_
  - _Depends: 1.1_

- [x] 4.2 实现客户端 ui-rpc 总线 hook
  - 发起请求并按 correlationId 关联响应;高频补全防抖与取消;超时与错误暴露可观察状态且不阻塞输入/不崩会话
  - 完成态:集成测试覆盖配对、超时、错误三路径,InlineComplete 高频输入下不阻塞
  - _Requirements: 4.2, 4.3, 4.4, 4.5_
  - _Boundary: react web-ext use-ui-rpc_
  - _Depends: 4.1_

## 5. Core/Integration:宿主 UI 集成(Tier 1/2/3/4)

- [x] 5.1 实现描述符并入与区域插槽组件(隔离单元)
  - `apply-extension` 把描述符并入 per-session registry / slots / contributions 数据结构;`slot-host` 组件渲染具名插槽,未声明用默认;以 error boundary 隔离扩展渲染错误。本任务**不**改 `pi-chat.tsx`,以独立测试 harness 验证(在 chat 内的实际挂载归 5.2)
  - 完成态:单测/组件测试证明 `slot-host` 在给定描述符下把内容渲染到对应具名插槽、未声明回退默认、扩展抛错被 error boundary 隔离
  - _Requirements: 2.2, 2.3, 2.5, 10.3_
  - _Boundary: ui web-ext apply-extension, slot-host_
  - _Depends: 1.3, 2.1, 3.2_

- [x] 5.2 PiChat 接入扩展、区域插槽挂载与 Tier 2 渲染
  - PiChat 接受可选 `extension` 与 per-session registry,挂载 `slot-host`;Tier 2 渲染器经 registry 命中,内联消息流仅允许声明式白名单(复用 SandboxRenderer);多候选按「扩展声明 > 宿主默认」优先级解析;保证 PromptInput 提交契约语义不被改;内核(根/会话/传输)不被扩展替换;缺省 extension 时行为与现状一致(向后兼容)
  - 本任务独占 `pi-chat.tsx` 的扩展接线;为显式集成任务
  - 完成态:集成测试证明声明的区域插槽内容出现在 chat 内指定位置、自定义 data-part 经 registry 命中、内联走白名单、提交契约不变、无 extension 时回归现有行为
  - _Requirements: 2.1, 2.4, 3.1, 3.3, 3.4, 10.1, 10.2, 10.4_
  - _Boundary: ui chat pi-chat_
  - _Depends: 5.1_

- [x] 5.3 实现 Tier 3 贡献点宿主端并挂载 ui-rpc 总线
  - 在 PiChat 宿主挂载 ui-rpc 总线;实现 SlashCommands / Mentions / Autocomplete / InlineComplete / Suggestions / CommandPalette 注册 / Keybindings,触发时经总线回 agent 取候选/执行并渲染结果
  - 完成态:集成测试证明输入 `/` 与 `@` 经总线触发请求、渲染返回候选、选择后回填或执行
  - _Requirements: 4.2, 4.3_
  - _Boundary: ui web-ext contributions, ui chat pi-chat_
  - _Depends: 4.2, 5.2_

- [x] 5.4 实现 Tier 4 artifact 隔离表面
  - 宿主在独立 origin 沙箱 iframe 渲染 artifact(挂在 `artifactSurface` 插槽,经 5.2 的 slot 挂载机制),经 postMessage 中转(校验 origin 与结构,丢弃非法消息);LLM 输出强制走此表面;iframe 无同源 cookie/存储/DOM/凭证访问
  - 完成态:集成测试证明 artifact 在 sandbox iframe 渲染、resize 消息生效、非法 postMessage 被丢弃、无同源凭证访问
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Boundary: ui web-ext artifact-surface_
  - _Depends: 1.1, 5.2_

## 6. Integration:示例 agent source(各携带 `.pi/web` 与预构建产物)

- [x] 6.1 (P) 纯声明示例(Tier 5)
  - `examples/webext-declarative-agent`:agent `index.ts` + `.pi/web/web.config.ts` 仅声明 theme/layout,无自定义代码(零 bundle 路径)
  - 完成态:选该 source 后 theme/layout 生效且未加载任何 bundle
  - _Requirements: 1.4, 11.1_
  - _Boundary: examples webext-declarative-agent_
  - _Depends: 3.2_

- [x] 6.2 (P) 区域插槽示例(Tier 1)
  - `examples/webext-layout-agent`:`.pi/web` 声明并预构建填充若干区域插槽(如 panelRight、headerCenter、accessory)
  - 完成态:`pi-web build` 产出产物,选该 source 后插槽内容出现在指定位置
  - _Requirements: 2.1, 11.1_
  - _Boundary: examples webext-layout-agent_
  - _Depends: 2.4, 5.1_

- [x] 6.3 (P) 渲染器示例(Tier 2)
  - `examples/webext-renderer-agent`:注册自定义 data-part/tool 渲染器(经 registry/白名单)
  - 完成态:agent 产出对应 part 时由自定义渲染器命中渲染
  - _Requirements: 3.1, 11.1_
  - _Boundary: examples webext-renderer-agent_
  - _Depends: 2.4, 5.2_

- [x] 6.4 (P) 贡献点示例(Tier 3 + RPC)
  - `examples/webext-contrib-agent`:agent 端实现 ui-rpc 处理(slash 列表/@mention 解析/autocomplete),`.pi/web` 注册对应贡献点
  - 完成态:输入 `/` 经 RPC 回该 agent 返回候选并可执行回填
  - _Requirements: 4.2, 4.3, 11.1_
  - _Boundary: examples webext-contrib-agent_
  - _Depends: 2.4, 5.3_

- [x] 6.5 (P) artifact 示例(Tier 4)
  - `examples/webext-artifact-agent`:产出经 artifact 表面渲染的内容(含一段 LLM 风格输出走 iframe)
  - 完成态:选该 source 后 artifact 在 sandbox iframe 中渲染并可交互
  - _Requirements: 5.1, 5.3, 11.1_
  - _Boundary: examples webext-artifact-agent_
  - _Depends: 2.4, 5.4_

## 7. Validation:单测、集成测试与浏览器 e2e

- [x] 7.1 单元测试套件
  - 覆盖 protocol schema(合法/非法)、css-scope-plugin、externals-guard、extension-gate、per-session registry 命名空间
  - 完成态:相关包 `test` 全绿,以实际运行输出为证
  - _Requirements: 11.2_
  - _Depends: 2.3, 3.1, 1.3_

- [x] 7.2 集成测试套件
  - 覆盖 loader+import map(单例不重复)、ui-rpc 闭环(配对/超时/错误)、apply-extension(并入+错误隔离)、artifact postMessage 校验
  - 完成态:集成测试全绿,stub agent 下 ui-rpc 闭环通过
  - _Requirements: 11.2_
  - _Depends: 3.2, 4.2, 5.1, 5.4_

- [x] 7.3 浏览器 e2e 闭环(隔离 build)
  - 在隔离构建产物上,对 5 个示例分别跑通:选源 → 加载 WebExtension(或声明)→ 自定义 UI 生效 →(贡献点)经 RPC 回 agent 返回结果;任一失败给出可定位诊断
  - 在生产 CSP(收紧 connect-src、禁 unsafe-eval)下验证扩展动态 `import()` 加载与 artifact sandbox iframe 仍正常工作(避免 CSP 与加载器/iframe 冲突仅在 e2e 才暴露)
  - 完成态:`webext-*` e2e 全绿且在生产 CSP 下加载/渲染通过,不污染开发态 `.next` 缓存
  - _Requirements: 7.3, 11.1, 11.3, 11.4, 11.5_
  - _Depends: 6.1, 6.2, 6.3, 6.4, 6.5_
