# pi-web · 项目现状(PROJECT-STATE)

> 此为 tracked 稳定正文；NotebookLM 使用 `state_snapshot.py` 生成的同名运行快照。

## 当前迭代目标

- 已批准并完成 `REQ-20260804-02`：视频工作室已并入 `aigc-agent`，交付 workflow-first 首版视频工作室 Pane。

## 已验证代码事实

- `examples/aigc-agent` 已构建；复用 AIGC/媒体工具，并以隔离 iframe 提供视频工作室 UI。
- CodeGraph `1.5.0` 已就绪；索引含 1,783 个文件、17,763 个节点、34,983 条边。
- NotebookLM 深研发现 126 个候选来源；以官方材料、论文及官方仓库为主筛选商业与开源代表样本。
- 研究结论推荐“对话 + 故事板/画布 + 时间线”混合工作室；节点图后置为高级模式，默认自动化等级为 L2。
- 视频 Surface 已覆盖简报、镜头草案、排队/生成/暂停/继续/重试/回滚、实时工具回流、预览与导出请求。

## 相关模块与 symbol

- `examples/aigc-agent/video-studio/model.ts`：项目/镜头状态机与边界。
- `examples/aigc-agent/video-studio/surface.ts`：Agent 单写 Surface、视频工具事件回流与命令白名单。
- `examples/aigc-agent/video-studio/guest.tsx`：隔离 Pane UI；`lib/app/webext-registry.ts`：宿主静态注册。

## 最近完成与当前 diff

- 最近完成：视频工作室并入 `aigc-agent`、草稿自动保存/恢复、宿主注册、构建产物与自动化测试。
- 当前 diff：工作树已有用户未提交改动；本轮仅在批准范围内新增 Agent 与宿主装载链。

## 验证状态

- `requirements_gate.py assert-task-executable`：退出码 0，`INTAKE-20260804-08` executable。
- `iteration_gate.py`：退出码 0。
- `preflight.py --strict`：退出码 0；无 blocker。
- `pnpm -C examples/aigc-agent typecheck`：退出码 0。
- `pnpm -C examples/aigc-agent video-studio tests`：25/25 通过。
- `pnpm -C examples/aigc-agent build`：退出码 0，生成 `.pi/web/dist/web-extension.mjs`。
- `pnpm exec vitest run test/webext-registry-agic-video.test.ts`：1/1 通过。
- 根 `pnpm typecheck`：Agent workspace 均通过；根测试引用缺失 `bin/pi-web.mjs`，属既有基线失败。
- `notebook_gate.py validate-output`：退出码 0；`valid:true`。
- Notebook 最外层存在；Studio 报告状态 `completed`；Note 数 1；常驻来源数 2。

## 当前失败信号与风险

- 失败信号：两次全源/缩源 Notebook 对话综合查询超时；深研任务、报告生成及本地结构化综合均成功，未重试第三次。
- 风险：商业产品能力与项目热度具时效性，须以执行日官方来源复核。
- 风险：真实视频供应商未配置时，生成任务按失败/可重试状态呈现；暂不承诺生产级 NLE 或多用户协作。

## 架构边界

- 目标/非目标：首版聚焦简报→镜头→生成→复核→导出；不实现完整专业 NLE。
- 锁定决策：NotebookLM 最外层新建独立 Notebook，不以 Notes 代替。
- 基线依据：当前分支及 CodeGraph `status --json`。
- 模块与落点：NotebookLM 外部研究空间；本地仅存准入、快照与闭环证据。
- 关键接口/直接路径：NotebookLM CLI/MCP，经认证与冷闸后调用。

## 需求—代码—测试追踪

| Active REQ | 状态 | 代码证据 | 测试/质量证据 |
| --- | --- | --- | --- |
| `REQ-20260804-01` | research approved | NotebookLM 调研与 Note | 需求闸、冷闸、Notebook 存在性与来源追踪 |
| `REQ-20260804-02` | implemented v1 | `examples/aigc-agent/video-studio` + 宿主注册 | workspace typecheck、25 项单测、构建、注册契约测试 |

## Known failed approaches

- `npx --yes @colbymchenry/codegraph@latest init -i`：误入交互安装器并超时。
- `npx --yes --package @colbymchenry/codegraph@latest codegraph init -i`：包获取超时；改用官方全局安装成功。

## 下一项已批准工作

- 下一步可在真实供应商凭据下做浏览器手测，并补齐媒体任务 e2e；当前首版已可构建与装载。

## 本轮 delta

- 变更：需求治理、`aigc-agent` 视频工作室、Pane 构建/宿主注册、锁文件与验证测试。
- 直接影响：视频能力并入既有 AIGC Agent；旧 `agic-video-agent` 目录已删除。
- 验证：workspace typecheck、25 项 Node 测试、构建及宿主注册测试均完成。
- 质量：CodeGraph ready；根 typecheck 仍受缺失 `bin/pi-web.mjs` 基线错误阻断。
- Agent 编排：单一 NotebookLM 冷循环任务，串行执行。
- 模型路由：complex/frontier/high；NotebookLM 仅作策略研究层。
- Worker 回收：不派写代码 Worker；研究串行执行。
- Token：未作 A/B，不宣称节省。

## 桌面端启动白屏排查交接（2026-08-12）

- 结论：Windows 首次“约 60 秒后错误页”对应本地后端 `GET /` 就绪超时；重开与 macOS 白屏大概率由启动错误事件过早发送、页面未能收到而放大。
- 次级原因：旧壳仅注入 `HOSTNAME`，而 `server/index.ts` 读取 `HOST`；外层若已有 `HOST`，可造成后端监听地址与桌面探测地址不一致。
- 资源/权限：磁盘不足或用户运行时目录不可写仍须排除，但应优先呈现 `disk-full` / `runtime-root-unwritable`；不要求管理员安装，默认写入用户目录。
- 本轮修复：解包超时、启动错误留存与补读、`HOST` 注入、对应权限与回归测试。
- 详细原因排序、验证顺序及 macOS 原生 WebView 隔离试验见 [桌面端启动白屏原因与交接](desktop-startup-white-screen-handoff.md)。

## MOMA 视频生成接入交接（2026-08-12）

> 本节记录 `feat/moma-video-generation` 最新交付；父仓与 `examples/aigc-agent` 为两个独立 Git 仓库。

### 分支与提交

| 仓库 | 分支 | 提交 |
| --- | --- | --- |
| `pi-web` | `feat/moma-video-generation` | `84bf9501` |
| `aigc-agent` | `feat/moma-video-generation` | `54b6dfc` |

两分支均已推送 `origin`。父仓 `.gitignore` 刻意排除 `examples/aigc-agent`，故媒体实现须在子仓同步维护。

### 已交付

- 父仓新增 MOMA 配置解析、Kimi-K3 聊天目录与统一视频模态目录；视频模型不注册为聊天模型。
- 子仓接入 MiniMax-H3、Seedance 2.0 的 T2V / I2V / R2V 异步媒体路由，并复用现有轮询、附件落库链。
- 配置入口：`MOMA_BASE_URL`、`MOMA_API_KEY`；`MOMA_BASE_URL` 可填主机、`/v1` 或完整 `/v1/chat/completions` 地址。
- 子仓启动时从 `MOMA_BASE_URL` 推导原生媒体主机；无需新增用户配置项。

### 路由契约

| 模型 | 提交 | 轮询 |
| --- | --- | --- |
| `minimax/minimax-h3` | `POST /v2/video_generation`（原生 body `MiniMax-H3`） | `GET /v2/query/video_generation/{task_id}` |
| `gdmz/doubao-seedance-2.0` | `POST /api/v3/contents/generations/tasks` | `GET /api/v3/contents/generations/tasks/{task_id}` |

H3 路由按 [MiniMax 官方视频 API](https://platform.minimax.io/docs/guides/video-generation) 接线；两者均为 10 秒轮询、30 分钟超时。

### 验证回执

以下均已通过：

```text
pnpm --dir examples/aigc-agent/media-tools typecheck
pnpm --dir examples/aigc-agent exec vitest run --root . --config ../../../packages/adapters/vitest.config.ts test/moma-video.test.ts
pnpm --dir packages/adapters test -- test/moma/config.test.ts
pnpm --dir packages/server test -- test/model-catalog/service.test.ts
pnpm exec vitest run test/route.integration.test.ts
pnpm typecheck
pnpm build:server
```

### 已知阻塞与接手动作

- 当前 MOMA 实例 `GET /v1/models` 可用；H3 / Seedance 原生视频候选路由实测均返 `404`。代码会明确报告“原生接口未开放”，不伪造媒体结果。
- 因未取得 MOMA 视频原生接口的账号级文档/授权，暂不宣称真机视频生成已通。
- 接手后先确认账号的视频 entitlement、原生媒体 host、提交/轮询路径及 body；若原生 host 不同，再把 `MOMA_MEDIA_BASE_URL` 加入父仓 passthrough，并同步更新子仓推导逻辑、契约测试与 live smoke。
- 工作树中仍有既有临时文件与构建产物改动，未纳入上述提交；勿用清理/重置命令覆盖。
