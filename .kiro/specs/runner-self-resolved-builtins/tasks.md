# Implementation Plan

> runner 从自身安装树(runner-bootstrap 的 jiti 根 = server 包目录)自解析 pi-web 自带内置扩展入口,取代主进程下发绝对路径;server 依赖 tool-kit 使三个扩展代码随包进入沙箱镜像。
> **范围铁律**:不改内置扩展功能逻辑;不改 AgentDefinition.extensions;仅迁移自动标题一处门控(下沉到扩展内部);本地行为逐字节不变。

- [x] 1. Foundation:依赖与单一清单

- [x] 1.1 建立 server → tool-kit 运行时依赖
  - 在 server 的运行时依赖中加入 `@blksails/pi-web-tool-kit`,使其三个内置扩展入口进入 server 安装树。
  - 确认无循环依赖(tool-kit 不依赖 server),且只引 node-only 的 runtime/entry 子入口,不引前端专用代码。
  - 观察性完成态:构建后 `@blksails/pi-web-tool-kit` 在 server 的 node_modules 中可解析;server typecheck 通过。
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - _Boundary: server package.json_

- [x] 1.2 内置扩展单一清单 + 自解析
  - 新建 runner 侧模块,以**单一数组**枚举三个 pi-web 自带内置扩展(extension-tools / auto-title / mcp)的入口说明符;逐个从 runner 模块位置解析为实际路径。
  - 解析不到的条目跳过并记日志(维护者可观测),不抛出;返回顺序稳定可预期。
  - 观察性完成态:单测证明四项按稳定顺序解析、注入可控解析器时某项解析不到被跳过且不抛、跳过时日志被触发。
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 5.2, 5.3_
  - _Boundary: builtin-extensions(runner)_

- [x] 2. Core:接线自解析并退役下发

- [x] 2.1 runner 改用自解析结果注入内置扩展
  - `buildRuntimeFactory` 把自解析入口并入 forcedExtensionPaths/additionalExtensionPaths;`collectForcedExtensionPaths` 降级为过渡期兼容(识别既有 `*_ENTRY` env,不作为主来源,存在时不重复不报错)。
  - 观察性完成态:单测证明——自解析结果进入 additionalExtensionPaths;既有 `*_ENTRY` env 同时存在时路径不重复、不报错;本地形态注入集合与改造前等价。
  - _Requirements: 1.1, 1.2, 3.1, 3.3_
  - _Boundary: option-mapper_
  - _Depends: 1.2_

- [x] 2.2 自动标题总开关门控下沉到扩展内部
  - 把 `PI_WEB_AUTO_TITLE` 的判定从「主进程是否下发路径」下沉到自动标题扩展装配处:关闭时扩展不注册 handler(空转),保持「关闭=无效果」的用户可观察结果不变。
  - 观察性完成态:单测证明 `PI_WEB_AUTO_TITLE=0` 时扩展装配后不注册标题 handler;默认(未设/非 0)时照常注册。
  - _Requirements: 3.2_
  - _Boundary: auto-title-extension_

- [x] 2.3 主进程退役内置扩展路径下发
  - 移除 `pi-handler` 对三个 tool-kit 内置扩展 `*_ENTRY` 的 spawn env 下发接线(`PI_WEB_SANDBOX_ENTRY` 保留)(自解析已接管);过渡期允许既有 env 存在而不破坏启动。
  - 观察性完成态:主进程不再计算/下发内置扩展绝对路径;根 typecheck 通过;既有 e2b 白名单不再需要为这些键接线。
  - _Requirements: 1.2, 3.3, 4.4, 5.1_
  - _Boundary: pi-handler 装配_
  - _Depends: 2.1, 2.2_

- [x] 3. Validation:回归与端到端

- [x] 3.1 本地端到端:自解析注入 + MCP 工具可用
  - 真实 runner(stub agent,本地传输):不经 spawn env 下发路径,内置扩展经自解析注入,MCP 工具在会话中可被调用 —— 证明机制成立(1.2/4.4)。
  - 观察性完成态:e2e 用例通过并留存真实计数;沙箱内解析记为 SKIP 并说明(无凭据环境边界)。
  - _Requirements: 1.2, 4.1, 4.2, 4.4_
  - _Depends: 2.3_

- [x] 3.2 全量回归与四侧验证
  - server/protocol/tool-kit/根 全量单测与四侧 typecheck 通过;确认内置扩展本地行为逐字节不变、既有测试断言未被削弱。
  - 观察性完成态:四面真实计数全绿(`no tests`/`Errors N error` 不算过);既有 auto-title / option-mapper / mcp 守卫仍绿。
  - _Requirements: 3.1, 3.4_
  - _Depends: 3.1_

## Implementation Notes

- **自解析锚点**:runner-bootstrap 用 `createJiti(here)` 把根锚在 server 包目录,故 runner 内 import 从 server 的 node_modules 解析。sandbox 扩展(`builtin-agents/entry-path.ts`,server 包内)已是活体先例,本 spec 把该范式推广到全部四个。

- **★ 唯一门控迁移**:自动标题原靠「关闭→不下发路径→不注入」。自解析后入口恒解析,故总开关判定须下沉到扩展内部(关闭即不注册 handler),否则「关闭=无效果」的用户可观察语义会破。这是 Req 3.2 的核心,也是本改造唯一动到功能门控的地方。

- **无循环依赖**:tool-kit deps = agent-kit/logger/protocol/undici/zod,不含 server;runtime 子入口 node-only。server→tool-kit 方向正确。

- **e2b base 镜像非本仓**:本 spec 只保证「标准装 server 即带上内置扩展代码」这一可打包前提;base 镜像是否据此重建由部署方决定。真实沙箱内解析验证记 SKIP。

- **过渡期兼容**:`collectForcedExtensionPaths` 保留识别既有 `*_ENTRY` env,防止外部编排仍设置时破坏;主来源已是自解析。后续可另立 spec 清理 env 残留。

- **★ 范围勘误(实现时发现)**:`sandbox/entry.ts` 文件头明写其入口**在 agent 包内**(由 source 决定、须传 agentDir),
  **不能像 tool-kit 那样从自身模块位置推算** —— 它是 agent 作用域扩展,与三个 pi-web 自带扩展范式不同。
  故自解析清单只含 extension-tools / auto-title / mcp;sandbox enforcement **保持现状不动**,
  `PI_WEB_SANDBOX_ENTRY` 不在退役范围。requirements 中"四个"按"pi-web 自带内置扩展(三个)"理解。

## 验证证据(2026-07-24)

| 面 | 结果 |
|---|---|
| `packages/server` 全量 | **2216 passed** / 17 skipped / 0 failed(前一 spec 基线 2203) |
| `packages/tool-kit` 全量 | **454 passed**(基线 451 + 3 门控守卫) |
| `packages/protocol` 全量 | **401 passed**(未受影响) |
| 根测试面 | **828 passed** |
| 四侧 typecheck | 全部 rc=0 |
| **自解析 e2e** | **5 passed / 1 skipped** —— 零 env 下三个入口被解析且**文件真实存在**;旧 env 共存去重;sandbox 仍走 env |
| 既有守卫 | option-mapper-mcp / option-mapper-auto-title / auto-title 既有 9 例全绿(行为等价) |

## 实现记录

- **★ 范围收窄为三个(实现时发现)**:`sandbox/entry.ts` 文件头明写其入口**在 agent 包内**(由 source 决定、须传 agentDir),**不能**从自身模块位置推算 —— 属 agent 作用域扩展。故自解析清单只含 extension-tools / auto-title / mcp;`PI_WEB_SANDBOX_ENTRY` 保留不动。requirements 中"四个"按"pi-web 自带内置扩展(三个)"理解。

- **零新解析机制**:三个 tool-kit 的 `entry-path.ts` 本就用 `import.meta.url` 从自身位置推算。server 依赖 tool-kit 后,这些模块位于 server 的 node_modules 内,推算结果在任何形态都是该环境的有效路径 —— 无需新写解析器,只需把它们聚成单一清单并在 runner 侧调用。

- **门控下沉是唯一功能改动**:自动标题原靠「主进程不下发路径」实现关闭。自解析后入口恒解析,故 `PI_WEB_AUTO_TITLE` 判定下沉到扩展内部(关闭即不注册 handler)。既有 9 个 auto-title 测试全绿佐证行为等价。

- **过渡兼容而非硬切**:`collectForcedExtensionPaths` 保留识别旧 env,新增 `collectExtensionPaths` 做「自解析 ∪ env」去重合并 —— 外部编排若仍设置旧 env 不会重复注入也不报错。

- **沙箱验证边界**:真实 e2b 沙箱内解析需凭据 + 重建 base 镜像,记为 SKIP。机制层面由本地 e2e 证明;镜像侧只要标准安装 server(其依赖已含 tool-kit)即自动就位。
