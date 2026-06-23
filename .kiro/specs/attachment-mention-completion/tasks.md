# Implementation Plan

- [x] 1. 核心：附件补全 Provider
- [x] 1.1 实现附件候选发现（complete）
  - 基于当前会话上下文列举本会话已有附件（含上传与工具产出来源），不混入其它会话
  - 按查询字符串对附件名做匹配过滤；查询为空时返回本会话全部候选
  - 将每个附件映射为补全候选：显示标签取附件名，副信息含可区分的类型与可读大小，候选类型标记为 attachment
  - 候选插入文本形如 `@attachment:<id>`，符合 `<触发符><类型>:<id>` 令牌文法
  - 会话无附件或列举失败时返回空候选而不抛错
  - 完成判据：以注入的附件列表存根调用，返回的候选均为 attachment 类型、标签为附件名、插入文本为 `@attachment:<id>`，空查询返回全量、带查询按名收敛
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 3.3, 4.1, 4.2, 5.1, 5.2, 7.1, 7.3_
  - _Boundary: AttachmentCompletionProvider_

- [x] 1.2 实现提交期引用解析（resolve）
  - 对类型为 attachment 的引用令牌，按 id 取附件并校验其归属当前会话
  - 命中且同会话时复用既有附件引用标记构造逻辑，产出与列表注入完全一致的单行规范标记（含 id、类型、名称）
  - 附件不存在或不属于当前会话时返回空结果，使框架保留原始令牌文本不阻断发送
  - 完成判据：同会话有效 id 解析为 `[attachment id=… type=… name=…]`；不存在或跨会话 id 解析返回空（令牌原文保留）
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3_
  - _Boundary: AttachmentCompletionProvider_

- [x] 1.3 导出 Provider 工厂与常量
  - 从 completion 公共出口导出附件 provider 工厂及其 id/kind 常量，供注册接线引用
  - 完成判据：工厂与常量可从 completion 包出口被外部模块导入
  - _Requirements: 2.1_
  - _Boundary: AttachmentCompletionProvider_

- [x] 2. 集成：注册接线
- [x] 2.1 在处理器构造期条件注册附件 Provider
  - 在注册内置文件 provider 之后、注册外部注入 provider 之前，当附件存储可用时把附件 provider 注册进补全注册表
  - 不改动注册表/端点契约，不改动文件 provider；附件存储不可用时行为与现状完全一致
  - 合并后的 file 与 attachment 候选受框架统一结果上限约束
  - 完成判据：附件存储可用时，触发符 `@` 的补全在同一查询下同时返回 file 与 attachment 两个分组且总数不超过框架上限；triggers 端点对 `@` 的暴露不退化
  - 注：实现期发现 handler 选项 `attachmentStore` 被窄化声明为 `AttachmentMetaSource`（仅 `head`），需同步加宽为含 `listBySession`（见 design.md Modified Files 契约修正）
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.3_
  - _Depends: 1.3_
  - _Boundary: create-handler 注册接线, handler.types 选项类型_

- [x] 3. 验证
- [x] 3.1 (P) Provider 单元测试
  - 用附件存储只读存根覆盖 complete：候选类型/标签/插入文本/副信息、空会话空集、带查询收敛与空查询全量
  - 覆盖 resolve：同会话命中产出规范标记、id 不存在与跨会话归属失配返回空
  - 完成判据：单元测试套件全部通过，断言上述候选与解析行为
  - _Requirements: 1.1, 1.3, 3.1, 3.2, 4.1, 4.2, 5.1, 6.2, 6.3, 7.2_
  - _Depends: 1.1, 1.2_
  - _Boundary: AttachmentCompletionProvider 测试_

- [x] 3.2 节点端 E2E 测试
  - 预置会话附件后，查询触发符 `@` 的补全结果含 attachment 分组与候选，候选插入文本形如 `@attachment:<id>`
  - 提交包含该令牌的消息后，令牌被改写为规范附件引用标记
  - 同一路径下验证文件 provider 的既有候选与 `@file:` 解析行为不退化
  - 完成判据：以 stub agent 运行的 e2e 用例全部通过，覆盖候选出现、令牌形态、解析改写、file provider 不退化
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Depends: 2.1_
  - _Boundary: e2e 测试_
