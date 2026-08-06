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
## Revision Ledger
