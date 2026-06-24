# Implementation Plan

- [x] 1. agent-kit 公共表面与最小化预设
- [x] 1.1 在 AgentDefinition 公共表面新增系统扩展白名单声明
  - 在 agent-kit 的 `AgentDefinition` 增加可选的 `allowExtensions: string[]` 字段,独立于仅"追加"语义的 `extensions`
  - JSDoc 说明三态语义:缺省=SDK 默认发现全部;`[]`=关闭全部 disk 发现的系统扩展;`["a"]`=仅保留命名项
  - 完成判据:`tsc --noEmit` 通过,字段在类型测试中可被赋值且为可选
  - _Requirements: 2.1, 3.1_
- [x] 1.2 实现最小化预设常量与一行启用工厂并从入口导出
  - 提供 `minimalAgentPreset`(显式声明 `noTools: "all"` + skills 空覆盖保留 diagnostics + `allowExtensions: []`)
  - 提供 `defineMinimalAgent(overrides?)`,在预设上浅合并作者覆盖(overrides 优先)并返回定义
  - 从包入口 re-export 两个产物
  - 完成判据:`import { minimalAgentPreset, defineMinimalAgent } from "@blksails/pi-web-agent-kit"` 可解析,预设对象三处关闭字段均存在
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.3, 4.4_
  - _Depends: 1.1_
- [x] 1.3 为预设与工厂补充单元测试
  - 断言 `minimalAgentPreset` 的 `noTools:"all"`、`skills` 空覆盖(调用返回 `skills:[]` 且回传 diagnostics)、`allowExtensions:[]`
  - 断言 `defineMinimalAgent({ model, systemPrompt, customTools })` 保留覆盖字段且不丢失关闭语义;`{ allowExtensions:["foo"] }` 覆盖白名单
  - 完成判据:`pnpm --filter @blksails/pi-web-agent-kit test` 新增用例全绿(新鲜运行输出)
  - _Requirements: 1.2, 1.3, 1.4, 4.1, 4.2, 4.4, 5.4_
  - _Depends: 1.2_

- [x] 2. server 运行时映射
- [x] 2.1 在 server 镜像类型同步新增白名单字段 (P)
  - 在 server 的 `AgentDefinition` 结构镜像增加可选 `allowExtensions: string[]`,与 agent-kit 表面保持结构一致
  - 完成判据:`tsc --noEmit`(server)通过,经 `defineAgent(...)` 含 `allowExtensions` 的定义可赋值给镜像类型
  - _Requirements: 2.5_
  - _Boundary: agent-definition.ts_
- [x] 2.2 在资源映射中落实白名单关闭语义
  - 在资源加载映射中处理 `allowExtensions`:空集映射为 SDK 扩展关闭(跳过发现、保留显式追加项);非空映射为覆盖钩子,保留命名白名单项与显式追加项(工厂内联项 + 显式路径项),其余丢弃
  - 覆盖钩子透传 `errors` 与 `runtime`;白名单未命中任何已发现扩展时安全忽略不抛错;字段缺省时不注入任何扩展关闭键(保留 SDK 默认)
  - 在代码注释标注已知限制:非空白名单会先加载全部发现扩展再过滤
  - 完成判据:映射函数对 `[]` / 非空 / 缺省三种输入产出预期的 `resourceLoaderOptions`
  - _Requirements: 2.2, 2.3, 2.4, 3.2, 3.3, 3.4, 3.5_
  - _Depends: 2.1_
- [x] 2.3 为映射逻辑补充集成测试
  - `allowExtensions: []` → 设 `noExtensions === true` 且不设覆盖钩子;缺省 → 二者均不注入
  - `allowExtensions: ["keep"]` → 以伪造扩展集合(发现项 keep/drop、工厂 `<inline:1>`、显式路径项)断言保留 keep+内联+显式路径、丢弃 drop、透传 errors/runtime;`["missing"]` → 过滤后无项且不抛错
  - 完成判据:`pnpm --filter @blksails/pi-web-server test`(映射相关)新增用例全绿(新鲜运行输出)
  - _Requirements: 2.2, 2.3, 2.4, 3.2, 3.3, 3.4, 3.5, 5.4_
  - _Depends: 2.2_

## Implementation Notes
- 2.2 首轮评审 REJECTED:行为型任务的 `extensionsOverride` keep 谓词与 `...base`(errors/runtime)透传缺行为级测试,存活变异体(filter→`return false`、删 `...base`)仍通过分支形状测试。补救轮在 `option-mapper.test.ts` 增加**调用 override** 的伪造 `LoadExtensionsResult` 测试,两变异体均被杀。
- 因补救轮已实现原 2.3 计划的全部 override 调用级行为断言(keep/drop/inline/explicit/missing + errors/runtime 透传),2.3 与 2.2 在同一测试文件中一并完成,故同批标记完成。
- 教训:行为型任务的测试必须**调用**被测函数返回的回调/钩子并断言其输出,仅断言"返回了函数"会留下存活变异体。

- [x] 3. 示例与回归验证
- [x] 3.1 新增最小基线示例 agent (P)
  - 在 `examples/` 下新增最小基线示例,用预设(或工厂)声明工具/skills/系统扩展全关,并附说明注释区别于 hello-agent 的更彻底基线
  - 完成判据:示例 `index.ts` 通过类型检查,默认导出为合法 `AgentDefinition`
  - _Requirements: 1.1, 1.4_
  - _Boundary: examples/minimal-agent_
  - _Depends: 1.2_
- [x] 3.2 全量回归与类型一致性校验
  - 运行 agent-kit 与 server 两包既有 + 新增测试,确认全绿;`examples/hello-agent` 语义不变
  - 运行两包 `tsc --noEmit`,守护 agent-kit↔server 镜像结构一致(`defineAgent` 定义可被运行时消费)
  - 完成判据:两包 `test` 与 `typecheck` 命令均以新鲜运行输出证明通过,`defineAgent` 恒等性测试仍绿
  - _Requirements: 2.5, 5.1, 5.2, 5.3, 5.4_
  - _Depends: 1.3, 2.3, 3.1_
