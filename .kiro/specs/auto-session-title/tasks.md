# Implementation Plan

## 1. 基础：配置解析与标题生成纯逻辑

- [x] 1.1 实现自动标题配置解析（环境变量 → 配置，含默认与非法值兜底）(P)
  - 从注入的环境变量映射解析触发模式、生成策略、总结模型、标题长度上限
  - 缺省时回退默认值：模式 `once`、策略 `llm`、模型空（用会话当前模型）、长度上限约 24
  - 非法取值（未知枚举、非正整数长度）回退对应默认且不抛错
  - 完成判定：单测覆盖「全缺省→默认」「非法 MODE/MAX_LEN→回退」「合法值正确解析」三类用例并通过
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 2.4, 3.4, 4.2_
  - _Boundary: auto-title-config_

- [x] 1.2 实现标题生成纯函数（启发式 / 清洗截断 / 上下文构造 / 文本抽取）(P)
  - 启发式：取首条用户消息文本生成候选标题；无用户文本返回空
  - 清洗截断：去换行与控制字符、首尾去空白、按字符边界截断到长度上限（多字节 emoji 不截半）
  - 构造一次性总结上下文：以总结型 system 提示 + 转换后的会话消息组成调用上下文
  - 从模型应答中抽取文本标题（拼接 text 内容，无则返回空）
  - 完成判定：单测覆盖启发式取值、字符边界截断、控制字符清洗、空输入安全返回空、上下文含 system 提示与消息，全部通过
  - _Requirements: 1.3, 1.4, 3.1, 3.5, 4.1, 4.3_
  - _Boundary: title-generator_

## 2. 核心：自动标题扩展本体

- [x] 2.1 实现自动标题扩展（监听 agent_end，按模式与策略生成并设置标题，失败静默兜底）
  - 注册 agent_end 监听，读取配置后据策略选择 LLM 总结或启发式生成
  - `once` 模式仅在成功设置标题后置位、后续不再处理；首轮失败允许后续重试；`refresh` 模式每轮重设
  - LLM 策略下模型缺失或调用失败/超时/空结果时回退启发式；启发式仍为空则跳过、不设空标题
  - 模型调用以依赖注入方式传入，便于以替身单测；全程捕获异常，绝不抛出、不打断会话
  - 完成判定：集成单测（注入假 pi/上下文/模型调用）覆盖 once 单次设置、once 失败重试、refresh 多次设置、LLM 失败兜底启发式，全部通过
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 3.2, 7.1, 7.2, 7.3_
  - _Boundary: auto-title-extension_
  - _Depends: 1.1, 1.2_

## 3. 集成：入口导出与注入接线

- [x] 3.1 暴露自动标题扩展入口子入口导出 (P)
  - 在工具包导出清单中新增自动标题入口的子入口，使主进程可在不引入 pi SDK 的前提下解析扩展绝对路径
  - 完成判定：从该子入口可导入入口解析函数，typecheck 通过；主进程侧 import 不拉入 pi 运行时
  - _Requirements: 5.1_
  - _Boundary: tool-kit package exports_

- [x] 3.2 主进程按总开关门控下发扩展入口环境变量
  - 总开关开启（默认）时解析扩展入口路径并经子进程 spawn 环境变量下发；关闭时不解析、不下发
  - 入口路径解析不到时跳过下发，不阻塞会话创建
  - 完成判定：单测/手动验证总开关开→下发该环境变量、关→不下发、解析失败→跳过且会话仍创建
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.5_
  - _Boundary: pi-handler_
  - _Depends: 3.1_

- [x] 3.3 runner 读取入口环境变量并加入强制注入路径 (P)
  - 在运行期工厂构建处读取自动标题入口环境变量，非空则并入强制注入扩展路径集合
  - 完成判定：单测验证设置该环境变量时强制注入路径含该项、未设置时不含；既有强制注入用例不回归
  - _Requirements: 5.5_
  - _Boundary: option-mapper_

## 4. 验证：端到端与回归

- [x] 4.1 编写离线确定性端到端测试（真实 runner + mock provider + 启发式策略）
  - 启动真实 custom 模式 runner 子进程，模型配置指向本地 mock OpenAI Chat Completions provider 使 agent_end 离线触发
  - 经环境变量注入自动标题扩展入口并设策略为启发式，发送一条用户消息后断言 stdout 出现 setTitle 扩展 UI 请求帧、标题来自首条用户消息
  - 完成判定：该 e2e 用例在无真实 API key 下稳定通过，断言到确定性 setTitle 帧
  - _Requirements: 1.1, 1.2, 5.1, 5.5_
  - _Boundary: e2e/node, auto-title-extension, pi-handler, option-mapper_
  - _Depends: 2.1, 3.1, 3.2, 3.3_

- [x] 4.2 跑通类型检查与相关测试套件，确认无回归
  - 工作区 typecheck 通过；tool-kit 单测、server runner 单测、新增 node e2e 全绿
  - 完成判定：贴出 typecheck 与各测试套件新鲜运行输出，全部通过
  - _Requirements: 7.1, 7.2_
  - _Depends: 4.1_

## 5. 增量：标题持久化为会话名（出现在会话历史）

- [x] 5.1 实现 setTitle → 会话名持久化接线并接入 runner（写侧）
  - 在 runner 新增一处接线：prototype-patch 会话的扩展绑定，使每次绑定的 UI 上下文 `setTitle` 被包装为「先执行原 setTitle（保留既有标题展示）→ 再尽力持久化标题为会话名」
  - 持久化经可写会话管理器的 `appendSessionInfo` 落库，复用既有镜像链路写入会话存储；不去重，每次 setTitle 都更新（与 refresh 一致）
  - 包装与持久化全程捕获异常：原 setTitle 失败或持久化失败均不互相影响、不中断会话
  - 在 runner 运行时装配后注入该接线，持久化目标闭包到当前可写会话管理器
  - 完成判定：单测覆盖「包装后 setTitle 同时触发原逻辑与持久化」「两侧异常各自被吞」「幂等重复 wire」「无绑定接口时优雅降级」，全部通过
  - _Requirements: 8.1, 8.2, 8.3, 8.6_
  - _Boundary: session-title-wiring, runner_

- [x] 5.2 补全读侧：会话存储显示名随 session_info 更新（让历史列表显示标题）
  - 发现并修复：会话历史读 `SessionMeta.name` 仅来自创建时 header，追加 session_info 不更新它
  - sqlite/postgres：在批量追加遇 session_info 时维护 name 列（最新生效）；fs-store：新增按需扫 session_info 的显示名派生
  - 会话列表路由：分页后仅对未命名页项按需派生显示名（限成本，sqlite/postgres 已在列中→跳过）
  - 完成判定：单测覆盖「fs 派生最新 session_info 名/无则空/会话不存在不抛」「sqlite append/批量后 list().name 即更新」；既有 store/list 全套不回归
  - _Requirements: 8.4, 8.5_
  - _Boundary: session-store(types/fs/sqlite/postgres), session-list-routes_
  - _Depends: 5.1_

- [x] 5.3 扩展端到端测试断言会话名已持久化
  - 在自动标题 e2e 增 SESSION_STORE=sqlite 用例：收到 setTitle 帧后优雅退出释放句柄，轮询读回 sqlite `list(cwd).name` 等于首条用户消息
  - 证明端到端：setTitle → appendSessionInfo → 镜像 → name 列维护 → 列表显示名
  - 完成判定：e2e 在无真实 API key 下稳定通过，断言到持久化的会话名
  - _Requirements: 8.1, 8.4, 8.5_
  - _Boundary: e2e/node, session-title-wiring, runner, session-store_
  - _Depends: 5.1, 5.2_

- [x] 5.4 跑通类型检查与相关测试套件，确认无回归
  - 工作区 typecheck 通过；server 全量、tool-kit 全量、node e2e 全绿
  - 完成判定：贴出 typecheck 与各测试套件新鲜运行输出，全部通过
  - _Requirements: 8.6_
  - _Depends: 5.3_
