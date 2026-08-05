# pi-web · 项目现状(PROJECT-STATE)

> 此为 tracked 稳定正文；NotebookLM 使用 `state_snapshot.py` 生成的同名运行快照。

## 当前迭代目标

- 正在推进已批准的 `REQ-20260805-01`：LLM 驱动的视频拆解、电影级创作、VFX 合成与可复用工作流平台。
- 已完成本轮基础闭环：统一 VideoProject 结构、结构化事务、Workflow Runtime、视频拆解契约与 FFmpeg 渲染 POC。

## 已验证代码事实

- `examples/agic-video-agent` 已独立构建；复用 AIGC/媒体工具，并以隔离 iframe 提供视频工作室 UI。
- CodeGraph `1.5.0` 已就绪；索引含 1,783 个文件、17,763 个节点、34,983 条边。
- NotebookLM 深研发现 126 个候选来源；以官方材料、论文及官方仓库为主筛选商业与开源代表样本。
- 研究结论推荐“对话 + 故事板/画布 + 时间线”混合工作室；节点图后置为高级模式，默认自动化等级为 L2。
- 视频 Surface 已覆盖简报、镜头草案、排队/生成/暂停/继续/重试/回滚、实时工具回流、预览与导出请求。
- VideoProject 已具 schemaVersion、Scene/Shot/Transition/Continuity、稳定 ID 与归一化；LLM 修改只能经 VideoTransaction。
- Workflow Runtime 已覆盖 DAG、并行、分支跳过、重试、Checkpoint 暂停/恢复、缓存、子工作流与步骤/成本预算。
- VideoAnalysis 已覆盖技术、时间线、视觉、叙事、生成五域，并要求 evidence、confidence、unresolved 与人工 correction。
- `video_workflow` / `video_analyze` / `video_render` / `video_vfx` 已接入 Agent Surface；失败工作流/渲染不提交本地暂态修改，暂停返回 checkpoint，成功渲染/特效回流 MP4 attachment。

## 相关模块与 symbol

- `examples/agic-video-agent/video-studio/model.ts`：项目/镜头状态机与边界。
- `examples/agic-video-agent/video-studio/surface.ts`：Agent 单写 Surface、视频工具事件回流与命令白名单。
- `examples/agic-video-agent/video-studio/guest.tsx`：隔离 Pane UI；`lib/app/webext-registry.ts`：宿主静态注册。

## 最近完成与当前 diff

- 最近完成：需求晋级、`agic-video-agent` 模板复制、视频工作室 Pane、统一视频域基础、可恢复工作流、视频拆解契约、FFmpeg 真实 MP4 POC。
- 当前 diff：仅含本轮视频平台域文件、需求批准记录与 POC 状态文档；未触碰根工作树中用户的公共 UI/地基改动。

## 验证状态

- `requirements_gate.py assert-task-executable`：退出码 0，`REQ-20260805-01` 无 Pending requirement。
- `iteration_gate.py`：退出码 0。
- `preflight.py --strict`：退出码 0；无 blocker。
- `pnpm -C examples/agic-video-agent typecheck`：本轮新增代码无错误；全包仍受既有 workspace 缺失 `clsx`、`tailwind-merge`、Radix、`lucide-react` 阻断。
- `pnpm -C examples/agic-video-agent test`：22/22 通过，含真实八镜头 MP4 解码、图片 attachment 回流与四层 VFX POC。
- `node --import jiti/register media-tools/test/ffmpeg.selfcheck.ts`：通过，本机 ffmpeg → data URI → attachment 回流链路通过。
- `pnpm -C examples/agic-video-agent build`：受上述既有缺失前端依赖阻断，未生成新构建产物。
- `pnpm exec vitest run test/webext-registry-agic-video.test.ts`：1/1 通过。
- 根 `pnpm typecheck`：Agent workspace 均通过；根测试引用缺失 `bin/pi-web.mjs`，属既有基线失败。
- `notebook_gate.py validate-output`：退出码 0；`valid:true`。
- Notebook 最外层存在；Studio 报告状态 `completed`；Note 数 1；常驻来源数 2。

## 当前失败信号与风险

- 失败信号：两次全源/缩源 Notebook 对话综合查询超时；深研任务、报告生成及本地结构化综合均成功，未重试第三次。
- 风险：商业产品能力与项目热度具时效性，须以执行日官方来源复核。
- 风险：真实视频供应商未配置时，生成任务按失败/可重试状态呈现；暂不承诺生产级 NLE 或多用户协作。

## 架构边界

- 目标/非目标：首版聚焦简报→镜头→生成→复核→导出；不改写 `examples/aigc-agent`，不实现完整专业 NLE。
- 锁定决策：NotebookLM 最外层新建独立 Notebook，不以 Notes 代替。
- 基线依据：当前分支及 CodeGraph `status --json`。
- 模块与落点：NotebookLM 外部研究空间；本地仅存准入、快照与闭环证据。
- 关键接口/直接路径：NotebookLM CLI/MCP，经认证与冷闸后调用。

## 需求—代码—测试追踪

| Active REQ | 状态 | 代码证据 | 测试/质量证据 |
| --- | --- | --- | --- |
| `REQ-20260804-01` | research approved | NotebookLM 调研与 Note | 需求闸、冷闸、Notebook 存在性与来源追踪 |
| `REQ-20260804-02` | implemented v1 | `examples/agic-video-agent` + 宿主注册 | 历史 v1 证据 |
| `REQ-20260805-01` | active · foundation iteration complete | `video-studio/model.ts`, `workflow.ts`, `analysis.ts`, `renderer.ts`, `surface.ts` | 19 项 Node 测试、模型/分析/Surface 严格单文件编译、FFmpeg self-check、真实 MP4 解码 |

## Known failed approaches

- `npx --yes @colbymchenry/codegraph@latest init -i`：误入交互安装器并超时。
- `npx --yes --package @colbymchenry/codegraph@latest codegraph init -i`：包获取超时；改用官方全局安装成功。

## 下一项已批准工作

- 把至少 3 类转场做成真实非降级效果，并扩展 VFX 到音轨/字幕/时域层；当前 FFmpeg 旧版能力不足，须保留降级标记。
- 增加质量评估、增量失效范围、浏览器 Pane 预览与第二组素材复现验收。

## 本轮 delta

- 变更：统一视频域模型、结构化事务、Workflow Runtime、视频拆解契约、Pi Agent workflow/analyze 工具、FFmpeg Adapter POC、状态与 POC 文档。
- 直接影响：仅新增/扩展 `examples/agic-video-agent/video-studio`；既有 `aigc-agent`、公共 UI 与 Pane 宿主行为不变。
- 验证：需求准入、上下文/迭代闸、19 项 Node 测试、严格单文件编译、ffmpeg self-check、真实 MP4 解码均通过。
- 质量：CodeGraph ready；全包 typecheck/build 仍受隔离工作树未具备的既有前端依赖阻断。
- Agent 编排：单一 NotebookLM 冷循环任务，串行执行。
- 模型路由：complex/frontier/high；NotebookLM 仅作策略研究层。
- Worker 回收：不派写代码 Worker；研究串行执行。
- Token：未作 A/B，不宣称节省。
