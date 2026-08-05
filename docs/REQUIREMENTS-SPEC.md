# REQUIREMENTS-SPEC

- 需求版本:`v1.0.0`

## Active Requirements

## REQ-A13 · Pane 生命周期、公共加载与环境载体

- 状态: ACTIVE
- 行为: Pane 在载体握手及首屏未就绪时显示公共 loading；关闭后后台保活；显式重载、切 Agent 或退出可销毁。

## REQ-PANE-201 · Pane 隔离载体与宿主交互

- 状态: ACTIVE
- 批准依据: 用户要求禁止 React Pane；网页仅用 iframe，Tauri 仅用 ChildWebView，并修复弹层、缩放、主题及日志 Pane。
- 行为: 所有 Pane 以隔离文档承载；宿主统一管理创建、隐藏、恢复、销毁、缩放与主题同步，日志作为同类隔离 Pane 接入。

## REQ-PANE-202 · AIGC Agent 独立装载与工作区 Pane

- 状态: ACTIVE
- 批准依据: 用户要求 pi-web 装载独立 aigc-agent 源，并恢复素材、搜图、画布与日志 Tab；aigc-agent 可独立打包。
- 行为: pi-web 通过稳定静态入口装载独立 aigc-agent 包；缺失或畸形 Pane 声明不得令宿主白屏。

## REQ-PANE-203 · 草稿带入与标题投射

- 状态: ACTIVE
- 批准依据: 用户要求“带入对话”只写入输入框、不直接发送；移除扩展头部，并将标题投射到网页标签与 Tauri 窗口。
- 行为: Pane 可把文字与附件暂存到当前对话草稿；宿主不得自动提交；扩展标题同步到 document.title 与桌面窗口标题。

### REQ-20260804-01 · Agent 视频工作室竞品与开源实现深度调研

- Approval evidence:`批准你创建这个笔记本`
- Status:`ACTIVE`
- Version:`1`
- Behavior:`在 NotebookLM 最外层新建独立 Notebook“Agent 视频工作室｜产品与技术路线调研”，完成可追溯的中文深度调研；结论用于指导产品定位、交互范式、视频设计流程、自动化边界、实时介入机制与研发路线。`
- Boundary:`本轮不修改 pi-web 业务代码，不实现 Agent 视频工作室，不承诺未由官方来源证实的能力，不做付费订阅或外部发布；不以单独 Notes 替代最外层 Notebook；NotebookLM 项目常驻来源受“两份持久来源”规则约束。`
- Acceptance:`NotebookLM 最外层列表存在新 Notebook“Agent 视频工作室｜产品与技术路线调研”；Notebook 内研究成果含执行摘要、分类法、商业竞品矩阵、开源项目矩阵、主流实现模式、目标 UX/实时介入流程、参考架构、自动化分级、MVP 与三阶段路线、风险/未知项、建议决策及逐项来源链接；商业样本数 ≥8、开源样本数 ≥8；关键结论均可回溯至来源；Notes 按闭环规则清理。`
- Traceability:`REQ-20260804-01 → NotebookLM 最外层 Notebook“Agent 视频工作室｜产品与技术路线调研” → 来源清单与本地闭环证据；本轮无代码/测试落点。`

### REQ-20260804-02 · agic-video-agent 首版视频工作室

- Approval evidence:`批准`
- Status:`ACTIVE`
- Version:`1`
- Behavior:`仓库新增可独立装载、构建与运行的 examples/agic-video-agent；其 Agent 复用 aigc-agent 的 AIGC/媒体能力，并提供一个隔离 iframe 视频工作室 Pane，支持从创意简报生成镜头草案、逐镜头生成/重试/暂停/继续、实时人工介入、预览与导出首版流程。`
- Boundary:`不改写或删除 examples/aigc-agent；沿用 pi-web 的隔离 Pane 载体与宿主生命周期、TypeScript strict 与既有 Agent/Panes Kit 接口；视频工作室首版不得要求 React Pane 或改动既有 aigc-agent 行为。`
- Acceptance:`(1) `pnpm -C examples/agic-video-agent typecheck` exit 0；(2) `pnpm -C examples/agic-video-agent build` exit 0 并生成可装载产物；(3) Agent 元数据声明 `agic-video-agent` 与视频工作室 Pane；(4) Pane 首屏可见简报/镜头列表/时间线或预览区域及生成、暂停、重试、人工修改、导出入口；(5) 关键状态迁移与宿主消息契约有自动化测试；(6) 既有 `pnpm typecheck` 与相关 pane/agent 测试不回归。`
- Traceability:`REQ-20260804-02 → examples/agic-video-agent/index.ts + panes/video-studio* + package metadata → tests/e2e evidence。

### REQ-20260805-01 · LLM 驱动视频拆解、电影级创作与可复用工作流平台

- Approval evidence:`批准`
- Status:`ACTIVE`
- Version:`1`
- Behavior:`平台以 pi Agent 为对话编排层，支持导入视频并进行技术、时间线、视觉、叙事及生成流程拆解；从创意、脚本、素材与分镜生成多镜头视频；以 Scene、Shot、Transition、Continuity 和统一 VideoProject 模型承载可编辑工程；通过结构化 Command/Transaction 修改项目；提供 WorkflowSpec 与可恢复 Workflow Runtime；支持质量评估、增量渲染、MP4 导出、历史提炼工作流、热门视频结构抽象与原创复用。`
- Boundary:`不预设单一渲染引擎；保留现有 pi-web 隔离 Pane、宿主生命周期、公共 UI 与已验证 aigc-agent 行为；Video Domain、Workflow、Runtime、Renderer、Preview、Export、Evaluation 分层解耦；LLM 只能通过 Schema 校验的 Command、Patch 或 Transaction 改项目；引擎通过 Adapter 接入。`
- Acceptance:`统一 VideoProject/VideoSpec、Scene/Shot/Transition/Continuity、WorkflowSpec、Command/Transaction 具 Schema 与测试；完成 Level 1/2 图片信息流并导出可播放 MP4；完成不少于 8 镜头、至少 3 种衔接、至少 1 种复杂多层特效的多镜头验收；完成带置信度、依据、人工修正与不可恢复项的视频拆解；完成具 DAG、分支、并行、重试、暂停/恢复、Checkpoint、缓存、影响范围失效与预算限制的 Workflow Runtime；项目修改、渲染、评估、工作流运行均经 pi Agent 结构化工具；单镜头修改只重算受影响范围；工作流须以第二组素材复现并通过质量检查；交付真实 MP4、指定帧/区间预览、可复用演示工程、自动化测试、POC/性能报告、ADR、开发/安全/限制文档。`
- Traceability:`REQ-20260805-01 → Video Domain/Workflow/Runtime/Renderer/Analysis/Agent tools/UI modules → unit/integration/E2E/real-render evidence → PROJECT-STATE and archive record.`
## Revision Ledger
