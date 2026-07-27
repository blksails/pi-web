# aigc-agent 对齐清单（examples/aigc-agent ← 独立仓 aigc-agent）

> 判据文档。源＝`C:\workcode\aigc-agent` @ `feat/image-aigc-agent`(44a17cd)；靶＝本仓 `examples/aigc-agent`。
> 需求见 `.local/docs/REQUIREMENTS-SPEC.md`（REQ-A1 全量对齐 · REQ-A2 侧栏形态豁免 · REQ-A7 外延全含 · REQ-A9 按 pi-clouds 规范嵌入）。
>
> **状态**：`✅ 已迁` / `🟡 部分` / `⬜ 未迁` / `➖ 形态豁免`（REQ-A2）/ `🔀 改落点`（按 pi-clouds 规范改由平台端口承载）。
> 每条注**源文件:行**，便于逐条取证。行数为 git 跟踪实测（2026-07-27）。

---

## 一、webext 插槽（宿主内渲染，`.pi/web/`）

| # | 交互 | 源 | 承载位 | 状态 |
|---|---|---|---|---|
| S1 | promptToolbar：＋ 分栏工具菜单（图片/视频生成/多媒体处理，15 工具） | `agents/aigc/.pi/web/prompt-toolbar.tsx:294`(SECTIONS 菜单) | `.pi/web/prompt-toolbar.tsx` | ✅ |
| S2 | promptToolbar：hover 图钉固定快捷 pill（localStorage，≤5） | 同上 `:211 togglePin` | 同上 | ✅ |
| S3 | promptToolbar：选中态意图胶囊 `× 工具名` | 同上 `:257` | 同上 | ✅ |
| S4 | promptToolbar：图像工具内联 模型/尺寸/数量（会话偏好 KV） | 同上 `:268-282` | 同上 | ✅ |
| S5 | promptToolbar：选中即预填 slash（输入框空时） | 同上 `:108 primeSlash` | 同上 | ✅ |
| S6 | promptToolbar：「添加附件」触发宿主隐藏 file input | 同上 `:118 triggerUpload` | 同上 | ✅ |
| S7 | promptToolbar：「管理技能…」入口 | 同上 `:325` | 待 SkillPanel | ⬜ |
| S8 | dialogLayer：SkillPanel 技能管理 modal | `agents/aigc/.pi/web/skill-panel.tsx`(230) | 待迁 | ⬜ |
| S9 | 技能启动器 + 面板开合 store | `skill-launcher.tsx`(24) / `skill-panel-store.ts`(28) | 待迁 | ⬜ |
| S10 | headerRight：登录态 / 登出 | `components/auth-status.tsx`(60) | `.pi/web/auth-status.tsx` + `auth/identity.ts` | ✅ |
| S11 | panelRight 容器：模块 Tab + `<Activity>` 保活 + layout-tree 分屏≤4 窗 | `components/workspace-panel.tsx`(417) | `PanesHost` 多 tab | ➖ |
| S12 | 工作区模块注册表（新增模块零外壳改动） | `components/workspace-modules.tsx`(126) / `lib/workspace/module-registry.ts` | `web/panes/index.ts` `definePanes` | ➖ |
| S13 | 工作区布局持久化（`aigc.workspace.v2` localStorage） | `lib/workspace/workspace-store.ts:42` | PanesHost 自有 | ➖ |

## 二、画布域（canvas pane）

| # | 交互 | 源 | 状态 |
|---|---|---|---|
| C1 | 画廊网格 + 资产卡 | `agents/aigc/.pi/web/gallery.tsx`(251) | ⬜ |
| C2 | 二创工作台：整图编辑 / 局部重绘（mask）/ 参考图融合 / 扩图 | `agents/aigc/.pi/web/canvas-panel.tsx`(571) | 🟡 骨架在 `web/panes/canvas.tsx`(66) |
| C3 | 画布 ↔ Agent 同源状态（Surface 快照/命令） | `canvasSurfaceExtension`（tool-kit） | ✅ |
| C4 | 工具产物点击进画布（`aigc-open-canvas-asset`） | `tool-card.tsx:236 openInCanvas` | 🟡 事件已发，画布未接 |
| C5 | 图片灯箱（缩放/翻页/下载） | `components/image-lightbox.tsx`(368) | ⬜ |

## 三、素材域（materials pane）

| # | 交互 | 源 | 状态 |
|---|---|---|---|
| M1 | 本会话生成素材列表 + 多选/全选 | `material-drawer.tsx` / `web/panes/materials.tsx`(127) | ✅ |
| M2 | 「带入对话」（attachmentId 引用经 prompt 通道） | `materials.tsx:76 bring` | ✅ |
| M3 | 选中态权威在 agent（`surface:materials` 订阅回流） | `panes/materials-surface.ts`(120) | ✅ |
| M4 | 全局素材库（跨会话） | `material-drawer.tsx`(1969) | ⬜ |
| M5 | 目录树：浏览 / 建目录 / 重命名 / 移动 / 删除 / 素材归类 | 同上 + `app/api/materials/folders`、`materials/tree` | 🟡 写命令已成（`panes/materials-surface.ts` 五命令 + 11 例自检），guest UI 未接 |
| M6 | 上传素材（进度、失败重试） | 同上 + `app/api/material-uploads` | ⬜ 经 `PanesUpload` + 登记命令 |
| M7 | 分发到广告账户 | `components/distribute-dialog.tsx`(326) + `app/api/material-distribute` | ⬜ |
| M8 | 失败角标 + 逐项重试 | `lib/app/material-upload-status.ts`、`app/api/material-uploads/retry` | ⬜ |
| M9 | 批量重试弹窗（收集失败对 + 串行编排） | `components/batch-retry-dialog.tsx`(156) + `lib/app/batch-retry.ts` | ⬜ |
| M10 | 目录选择弹窗 | `components/folder-picker-dialog.tsx`(246) | ⬜ |
| M11 | 拖拽 chip 入 composer（`text/att-id`） | `material-drawer` 发端 + pi-web `feat/composer-att-drop` 受口 | 🟡 受口已在本分支，发端未接 |
| M12 | 大列表虚拟滚动 | `material-drawer.tsx` | ⬜ |

## 四、搜索域（search pane）

| # | 交互 | 源 | 状态 |
|---|---|---|---|
| Q1 | 以词搜图（语义检索历史生成素材） | `components/search-panel.tsx`(128) → `web/panes/search.tsx`(103) | ✅ |
| Q2 | 检索走 agent route `creative-search`（子进程零凭证） | `agents/aigc/routes/creative-search.ts` → `routes/creative-search.ts`(38) | ✅ |
| Q3 | 以图搜图 | `packages/platform/src/vector.ts:273 search` | ⬜ |
| Q4 | 结果直送对话流 | 设计目标（源仓亦未做） | ⬜ |

## 五、对话面

| # | 交互 | 源 | 状态 |
|---|---|---|---|
| D1 | 图像工具产物渲成 `<img>` + 卡壳（工具名/状态/折叠） | `image-renderer.tsx`(142) → `.pi/web/image-renderer.tsx`(96)+`tool-card.tsx` | ✅ |
| D2 | 图像卡「图片 / JSON」双视图 | 同上 | ✅ |
| D3 | 媒体工具（13 个）产物渲染：video/audio/image | `media-renderer.tsx`(248) → `.pi/web/media-renderer.tsx`(83) | ✅ |
| D4 | 产物「画布」「下载」动作 | `tool-card.tsx:288` | ✅ |
| D5 | 空态起手式（图像三式，replace 宿主默认） | `web.config.tsx` config.empty | ✅ |
| D6 | 输入历史翻阅（↑/↓） | pi-web `feat/composer-att-drop` | ✅ 基座已在本分支 |
| D7 | 「定位我的输入」悬浮钮 + 输入导航弹层 | `components/chat-input-nav.tsx`(156) | ⬜ |
| D8 | reasoning 折叠展示 | `components/chat-reasoning.tsx`(23) + `ai-elements/reasoning.tsx`(217) | ⬜ |
| D9 | 矩形「发送」按钮（替宿主圆形图标钮） | `components/chat-submit-button.tsx`(52) | ⬜ |
| D10 | 会话历史列表 / 改名 / 删除 | `components/session-history.tsx`(249) | 🔀 pi-clouds `session.list`/`session.actions` |
| D11 | 会话转写查看 | `components/session-transcript.tsx`(164) | ⬜ |

## 六、平台面（按 REQ-A9 改落点）

| # | 交互 | 源 | 目标落点 | 状态 |
|---|---|---|---|---|
| P1 | provider key 管理 | `components/keys-panel.tsx`(216) + `app/api/keys` | 🔀 cloud `app/api/provider-keys` + cloud-app `resolver` | ⬜ |
| P2 | 平台托管 key 解析（三层：会话→租户→平台） | `agents/aigc/platform-keys.ts`(59) | 🔀 cloud-app `supabase-platform-key-store` | 🟡 example 侧 59 行在，未接 cloud |
| P3 | 音色复刻管理（创建/删除/列表） | `components/voices-panel.tsx`(115) + `app/api/aigc/voices` | example 领域后端 | ⬜ |
| P4 | 公司管理（公司名 owner 可改 / 成员角色） | `components/company-panel.tsx`(121) + `app/api/company` | 🔀 cloud 租户/角色面 | ⬜ |
| P5 | 会话协作分享（成员 viewer/editor / 移除 / 复制链接） | `components/share-session-dialog.tsx`(205) + `app/api/sessions/[id]/collaborators` | 🔀 cloud 会话归属 | ⬜ |
| P6 | 认证（登录态 / 登出 / SSO ticket / cookie 同步） | `src/auth/*`(505) | 🔀 维持宿主 `/api/auth/me`（REQ-A6） | ✅ |
| P7 | 附件存储（落库 + 签名 URL） | `packages/platform` + UnionStore | 🔀 `attachment.routes` + cloud-app `quota-blob-backend` | 🟡 宿主 UnionStore 在，未接云配额 |
| P8 | 用量 / 配额 | 源仓无 | 🔀 cloud-app `usage-meter` / `quota-plan-store` | ⬜ |
| P9 | MCP 配置 | `app/api/mcp` | 🔀 cloud `config.mcp` | ⬜ |
| P10 | per-source 设置 | `app/api/session-source` | 🔀 cloud `config.source` | ⬜ |

## 七、生成能力（agent 侧）

| # | 能力 | 源 | 状态 |
|---|---|---|---|
| G1 | 图像生成 / 编辑（image_generation / image_edit） | `aigcExtension`（tool-kit） | ✅ |
| G2 | 视频五种（文生/图生/多模态参考/编辑/数字人） | `media-tools/src/tools/video-tools.ts`(186) | ✅ 已下沉 example |
| G3 | TTS（CosyVoice WS 全协议） | `media-tools/src/providers/dashscope-audio.ts` | ✅ |
| G4 | ffmpeg 族（拼接/截片/GIF/截帧/套音轨/转码/音轨提取） | `media-tools/src/tools/ffmpeg-tools.ts`(179) | ✅ |
| G5 | 产物落库为 attachment（displayUrl 引用，不进 base64） | `media-tools/src/persist-media.ts`(150) | ✅ |
| G6 | 素材/资产 agent routes（assets-list / gallery-stats） | `routes/`(137) | ✅ |
| G7 | 素材写命令（建目录/重命名/移动/删除/归类） | 源仓走 Next API | ✅ 经 Surface 控制面（`create-folder`/`rename-folder`/`move-folder`/`delete-folder`/`move-items`） |

## 八、验证资产（REQ-A8 随迁）

| # | 内容 | 源 | 状态 |
|---|---|---|---|
| T1 | e2e/node 31 文件 2845 行 | `e2e/` | ⬜ 按新落点改写 |
| T2 | example typecheck 闸 | — | ✅ 手动；⬜ 入 CI |
| T3 | webext 构建闸（`build.ts`） | — | ✅ 手动；⬜ 入 CI |

---

## 九、pi-clouds 嵌入（REQ-A9）

| # | 规范面 | 要求 | 状态 |
|---|---|---|---|
| N1 | 分发＝registry 车道 | 经 `pi-web publish` 发布为**已签名 oss bundle**；cloud `RegistryAgentSourceProvider` 要求 kind=agent + origin=oss，否则「云版暂不支持此来源」 | ⬜ |
| N2 | 引用形态 | `sourceId@stable` | ⬜ |
| N3 | 能力面 | 不得要求 cloud 新增能力面 id 或路由（16 面已冻结全表态） | — 守则 |
| N4 | key | 建会话路径 `DefaultProviderKeyResolver` + gatewayKeys 换钥，不走 HTTP 网关 | ⬜ |
| N5 | 附件 | `attachment.routes`(use) + cloud-app 配额后端 | ⬜ |
| N6 | per-source 设置 | `config.source`（registry 驱动 + EncryptingWorkspace 信封加密） | ⬜ |
| N7 | 运行时 | 云沙箱 `lib/create-channel.ts` → `SandboxWsChannel`；spawnSpec 过江由 agent-runner 执行 | ⬜ |
| N8 | cloud 侧零 aigc 字样 | 不在 pi-clouds 写 aigc 专属分支 | — 守则 |

---

## 统计（2026-07-27）

| 分组 | 总数 | ✅ | 🟡 | ⬜ | ➖/🔀守则 |
|---|---|---|---|---|---|
| 一 插槽 | 13 | 7 | 0 | 3 | 3 |
| 二 画布 | 5 | 1 | 2 | 2 | 0 |
| 三 素材 | 12 | 3 | 2 | 7 | 0 |
| 四 搜索 | 4 | 2 | 0 | 2 | 0 |
| 五 对话 | 11 | 6 | 0 | 5 | 0 |
| 六 平台 | 10 | 1 | 2 | 7 | 0 |
| 七 生成 | 7 | 7 | 0 | 0 | 0 |
| 八 验证 | 3 | 0 | 2 | 1 | 0 |
| 九 pi-clouds | 8 | 0 | 0 | 6 | 2 |
| **合计** | **73** | **27** | **10** | **33** | **3** |

**对齐度**（2026-07-27 第 11 轮末）：完成 27/70（形态豁免与守则不计分母）≈ **39%**；含部分完成计权（🟡按半分）≈ **46%**。
> 本轮增量：S1–S6 promptToolbar 六项（`acb8600`）、G7 素材写命令（`ee42d7f`）、M5 转部分。
