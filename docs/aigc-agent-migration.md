# aigc-agent 迁移(源仓库 → pi-web)

> 状态:**基础波已落地**(2026-07-21,分支 `feat/migrate-aigc-agent-base`)。
> 源仓库 `C:/workcode/aigc-agent`(分支 `feat/image-aigc-agent`)仍在持续迭代;
> 本文档是迁移的单一事实来源:迁移面、定点变换、同步流程、未随迁清单、后续波次。

## 1. 格局

源仓库是独立 pnpm workspace:`vendor/pi-web`(完整 git 克隆,基础波时 HEAD=`a56ea0a`,
为本仓库 main 的祖先且**零本地改动**——无散落 vendor 补丁须上提)+ 自研三包 + agent 定义
+ 一个从 pi-web 壳 fork 出去独立迭代的应用壳(workspace 右栏 / 分屏 / 素材抽屉 / 搜索页)。

迁移语义:agent 定义按 examples 惯例落 `examples/aigc-agent`;可公共复用者上提本仓库;
宿主壳专属者**不迁**,待 Tab 面板架构(`docs/final-tab-architecture-design.md` 等)落地后承接。

## 2. 基础波迁移面(已完成)

| 源(aigc-agent) | 落点(pi-web) | 方式 |
|---|---|---|
| `agents/aigc/**`(16 文件:index、routes/、attachment-catalog、persist-extension、platform-keys、`.pi/web/*9`) | `examples/aigc-agent/` | 整树同步 + 2 处定点变换 |
| `packages/aigc-media-tools`(`@aigc-agent/media-tools`,自述"任意 pi-web agent 皆可装载") | `packages/aigc-media-tools`(workspace 包,**保留原包名**以便迭代期同步;正式割接时再议改名 `@blksails/*`) | 整树同步 |
| `packages/platform-client/src/index.ts`(单文件、零依赖、aigc 专属胶水) | `examples/aigc-agent/platform-client.ts` | 内联(不上提包) |
| **壳层工作区 10 组件**(`components/workspace-{panel,modules,launcher}`、`material-drawer`、`search-panel`、`sandbox-module-frame`、`distribute-dialog`、`folder-picker-dialog`、`image-lightbox`、`query-provider`) | `examples/aigc-agent/.pi/web/workspace/` | 整份同步 + 变换 C(import 相对化)+ 文件头 banner |
| **壳层工作区 7 lib**(`lib/workspace/{module-registry,layout-tree,workspace-store,search-query-store,iframe-rpc}`、`lib/stores/material-drawer-store`、`lib/app/material-drop-cache`) | `examples/aigc-agent/.pi/web/workspace/lib/` | 同上 |
| `app/globals.css`(壳层全部 `aigc-*`/`cv-*` 样式与调色板 token) | `examples/aigc-agent/.pi/web/aigc-shell.css` | 变换 D(见下) |
| `public/sandbox/preview.html`(沙箱模块静态页) | `public/sandbox/preview.html` | 原样拷贝 |
| —(pi-web 侧生成物) | `.pi/web/workspace/host-adapter.tsx` | 脚本生成:QueryProvider 自包 + `.aigc-embed` token 作用域 + 三槽组合(`AigcWorkspacePanel`/`AigcDialogLayer`/`AigcWorkspaceRail`) |
| — | root `package.json` | 补 `@aigc-agent/media-tools: workspace:*`(examples 经 root node_modules 解析)+ `lucide-react`(画廊/工具栏)+ `zustand`、`@tanstack/react-query`(壳层工作区状态/数据层) |
| — | `tailwind.config.ts` | content 补 `./examples/*/.pi/web/**/*.{ts,tsx}`(webext 静态车道组件的 Tailwind 类须纳入扫描) |

**替换说明**:`examples/aigc-agent` 旧内容为早期最小 AIGC 示例(image_generation/image_edit
渲染器 + visionExtension),是本 agent 的简化祖先,git 历史可查;vision 教学由
`examples/vision-agent` 独立承接。壳侧 `lib/app/webext-registry.ts` 的静态注册
(match `"aigc-agent"`)无需改动,替换目录内容即生效。

### 定点变换(A–D,由同步脚本机械执行)

- **A. platform-client 内联重写**:example 根层 `*.ts` 的
  `from "@aigc-agent/platform-client"` → `from "./platform-client.js"`(现命中 3 文件:
  attachment-catalog / persist-extension / platform-keys)。
- **B. web.config 三槽接入**:`.pi/web/web.config.tsx` 的壳层 import
  (`@/components/workspace-modules`、`@/components/workspace-panel`)改指向迁移后的
  `./workspace/`,经 `host-adapter` 接三槽:`panelRight: AigcWorkspacePanel`(工作区容器,
  QueryProvider 自包)、`dialogLayer: AigcDialogLayer`(SkillPanel + SearchCommandPalette)、
  `sidebarLeft: AigcWorkspaceRail`(「＋ 添加模块」导轨)。
  (历史:壳层未迁时此变换曾降级为纯画布 `AigcCanvasPanel`;壳层工作区波起恢复完整
  `WorkspacePanel` 体系——源代码"不可移植"注释的唯一成因就是 `@/` import 指壳层目录,
  整体搬入 `.pi/web/workspace/` 后不再成立。)
- **C. workspace import 相对化**:`.pi/web/workspace/` 内文件的 `@/components/X` → `./X.js`、
  `@/lib/{workspace,stores,app}/X` → `./lib/X.js`(lib 层内为 `./X.js`)、
  `@/agents/aigc/.pi/web/X` → `../X.js`;变换后残留任何 `"@/` 即告警(源新增了未映射依赖)。
- **D. aigc-shell.css 宿主化**:源 `app/globals.css` → `.pi/web/aigc-shell.css`:
  去头部 `@import`(宿主 `src/globals.css` 已引 ui/canvas-ui 样式,避免重复注入)与
  `@tailwind` 指令(与宿主 tailwind 冲突);裸 `html/body` 全局规则改死选择器中和
  (宿主自管文档级样式);调色板 token 选择器组追加 `.aigc-embed`(pi-web 里没有
  `.aigc-shell` 容器,host-adapter 的包装 div 以 `display:contents` 挂此类供 token 继承);
  尾部追加 `.aigc-embed-rail`(sidebarLeft 槽导轨定宽,源壳层由 rail grid 列管)。
  源文件是 CRLF,读取即归一 LF。壳层专属死规则(topbar/rail/statusbar 等,选择器挂在
  pi-web 不存在的类上)不裁剪——保持与源 diff 最小,无副作用。

## 3. 迭代期同步流程(源仓库还在改)

```bash
node scripts/sync-from-aigc-agent.mjs   # 幂等;默认源 C:/workcode/aigc-agent
git diff                                 # 审阅
# 验证(见 §5)→ 提交
```

- 脚本整树覆盖 + 重放变换 A/B;锚点丢失(源结构变了)会**告警退出码 2**,勿静默照单全收。
- `examples/aigc-agent/README.md` 为 pi-web 侧自有文件(脚本保留名单),不受覆盖。
- media-tools 若在源侧新增依赖:除包内 `package.json` 随同步带来外,检查 root
  `package.json` 是否需补声明(examples/`.pi/web` 均经 root node_modules 解析)。
- **勿在 `examples/aigc-agent/`、`packages/aigc-media-tools/` 手改逻辑**——下次同步即被覆盖;
  要改就改源仓库,或改同步脚本的变换规则。

## 4. 未随迁清单(后续波次)

| 部分 | 现状 | 承接方式 |
|---|---|---|
| ~~应用壳 workspace 体系~~ | **已承接(壳层工作区波,§2)**:WorkspacePanel(分屏+Tab+`<Activity>` 保活)+ 画布/素材/搜图/沙箱 4 模块 + launcher/对话框/样式,组件级整体搬入 `.pi/web/workspace/` | 该体系正是三份 Tab 设计稿的组件级落地;后续 iframe 化(`docs/final-tab-architecture-design.md` 的 PiBridge/沙箱车道)是**演进**而非前提,sandbox 模块已是其先导 |
| `packages/platform`(`@aigc-agent/platform`,Supabase 服务端:资产库/租户 key)+ `app/api/*` 平台路由(`/api/materials*`、`/api/creative-search`、`/api/material-distribute`、`/api/assets` 等)+ `supabase/` schema | 仅被壳层 API 路由使用;**素材抽屉的"目录"栏、搜图、分发依赖它们** | **波次 3**:平台是宿主部署形态问题。当前 pi-web 里这些接口缺席 → react-query 请求失败,LibPane(会话素材,galleryState/surface 驱动)照常,DirPane 目录树/搜图结果为空——不崩、可用面清晰。要点亮:起 supabase + 以 agent routes 或宿主路由承接 `app/api/*` |
| 搜索页路由(`src/routes/search.tsx` 独立页面形态) | 壳专属(SearchPanel 组件本体已随工作区波迁入,以"搜图"模块承接) | 不迁(pi-web 里以工作区模块形态存在) |
| 源仓库 e2e(`e2e/browser`、`e2e/node`) | 面向其壳 | 按波次随功能迁移改写 |

## 5. 基础波验证记录(2026-07-21,Windows,Node 25.9 / pnpm 9.12)

| 验证 | 结果 |
|---|---|
| `pnpm --filter @aigc-agent/media-tools typecheck` | ✅ 零错误 |
| root `tsc -p tsconfig.json --noEmit` | ✅ 迁移面零错误(examples web 链 8 文件确认在检查范围);仅存量错误:`@pi-clouds/registry-client` 缺失(main 上 registry 新提交需兄弟仓库包,与迁移无关) |
| 真实 loader 冒烟(`agent-loader` 同别名/同基点 jiti 加载 example) | ✅ AgentDefinition 完整:extensions=4、routes=1、attachmentCatalog{list,resolve};平台缺席优雅降级 |
| `pnpm build:client`(vite,含 webext 静态导入车道) | ✅ 构建通过 |
| `pnpm test:app` | ✅ 迁移相关套件全绿(webext-load-client 4/4、webext-resolve 5/5);26 个失败均为存量/本机环境:@pi-clouds 缺失 12 套件、Windows 路径分隔符断言、Node25 localStorage、bash spawn 超时,与迁移无因果 |

## 5.1 iteration-8 审查记录(2026-07-21,源侧 `2bf0da9`)

源侧 iteration-8 结算(8 目标全交付)后重跑同步脚本:**迁移面零 diff**——该轮对
`agents/aigc` 仅改空态短标题(基础波复制时已在源侧工作区,当时即带上);其余改动全在
未随迁的壳层与文档。按合同逐项核对:

| 合同项 | pi-web 侧结论 |
|---|---|
| 目标 1 frame-rpc 上游化 | 已按纪律交付:`feat/frame-rpc` 在远端、**PR #9 OPEN**、未动 main、submodule 指针未跟随。等维护者 review 合并,本仓库不需动作;合并后源侧换 import 属其下一轮 |
| 目标 2 注册表段尾匹配 | **真 bug,本壳同源同病,已上提**:`lib/app/webext-registry.ts` 子串 `includes` → 段尾匹配 + `normalizeSource`(反斜杠/`.git`/尾斜杠归一)+ match 键全部带 `examples/` 段;另加 `agents/aigc` → aigcExt 迁移期对照规则。钉死测试 `test/webext-registry-resolve.test.ts`(7 用例,含注册表全量段化约束) |
| 目标 3–8(壳 UI:去品牌/窄栏降级/账号行/最小宽度/登录页/浮标) | 全部属未随迁壳层,不影响迁移面;其中目标 3 的空态短标题已同步 |
| iteration-9 合同(注册表反查/身份收敛/生成链路冒烟/MCP/素材上传/会话业务元) | 均为源仓库壳/平台侧目标,无迁移面影响;其目标 1「注册表可达性反查」精神已在本仓库钉死测试的全量约束用例中先行落地 |

验证:注册表新测试 7/7 + 相邻 webext 套件 9/9 全绿;`build:client` ✅;root tsc 除已知
存量 `@pi-clouds` 缺失外零新增错误;e2e source 形态(`./examples/<name>`)与段尾匹配兼容。

## 5.2 壳层工作区波验证记录(2026-07-21)

背景:基础波后 pi-web 里的 aigc agent 是"空架子"——panelRight 只有降级纯画布,且全仓
**零 `aigc-*`/`cv-*` 样式**(已迁画布一直裸样式跑)。本波把源壳层 WorkspacePanel 体系
(分屏+Tab+`<Activity>` 保活、模块注册表、素材抽屉、搜图、沙箱、对话框)与全部样式整体
搬入 agent 自带 `.pi/web/`,三槽(panelRight/dialogLayer/sidebarLeft)接通宿主。

| 验证 | 结果 |
|---|---|
| 同步脚本重跑 | 幂等零告警(首跑曾暴露源 css CRLF,读取归一 LF 后 D1–D7 全命中) |
| root tsc(`--noEmit`) | 壳层 18 文件(17 同步 + host-adapter)全在编译范围,除已知存量 `@pi-clouds` 缺失外**零新增错误** |
| `build:client` | ✅ 39s(仅既有 chunk 体积警告) |
| vite dev 模块链 | `web.config` / `workspace-panel` / `material-drawer` / `host-adapter` / `aigc-shell.css` 转换全 200 |
| 静态页 | `/sandbox/preview.html` 200(vite public 车道) |
| 前提核验 | react 19.2.7 正式导出 `Activity`;root 已声明全部 `@blksails/*` 依赖;宿主 `src/globals.css` 已引 ui/canvas-ui 样式(css 头去 `@import` 不缺样式);PiChat 已实现 `sidebarLeft` 槽(`ExtSlotRegion`) |
| 浏览器 UI 验收 | 交用户(分工约定):左栏应现「＋ 添加模块」导轨,右栏为多 Tab 工作区(画布/素材默认开),素材抽屉 LibPane 走会话 galleryState;**目录树/搜图/分发因平台 API 未接入为空**(见 §4 波次 3) |

## 6. 割接(源仓库退役)时再做

- `@aigc-agent/media-tools` 是否改名 `@blksails/pi-web-media-tools` 并发布。
- 平台形态定案(pi-web 宿主内建 / 独立服务)后迁 `packages/platform` 与 supabase schema。
- 删除同步脚本与本节,`examples/aigc-agent` 转为本仓库直接维护。
