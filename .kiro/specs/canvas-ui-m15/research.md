# Research & Design Decisions

## Summary
- **Feature**: `canvas-ui-m15`
- **Discovery Scope**: Extension + 双新包抽取(考古代理穷尽盘点 packages/ui 的 canvas 依赖面)
- **Key Findings**:
  - **i18n 零依赖(原范围③作废)**:canvas 8 文件无任何 t() 调用(grep 实证),文案硬编码中文;无字典迁移需求。
  - **共享件穷尽清单=6+1**:Button(49 行,CVA+cn)/Card(21)/Input(25)/Popover(36,@radix-ui/react-popover)/Select(81,@radix-ui/react-select+lucide)/Textarea(24)+ cn(clsx+tailwind-merge 三行)。全部 shadcn 薄封装,下沉成本低。
  - **canvas 清单=8 文件 2977 行**:workbench(1741)/gallery(292)/aigc-quick-settings(289)/use-canvas-view(214)/lineage-view(170)/launcher(168)/aigc-model-meta(53)/client-image-ops(50,M1 转发层)。hooks 目录无 canvas 件。
  - **两笔意外账**:① ui 设置面板字段 aigc-model-toggles-field.tsx:14 反向消费 aigc-model-meta 的 ProviderBadge/displayNameOf;② styles.css:143-159 有 canvas 领域样式块(.canvas-checkerboard / [data-canvas-tool-image-clickable])。
  - **深路径 import 载荷**:packages/ui/test/canvas/ 9 个测试文件全部深路径 `../../src/canvas/*.js`(7 个组件模块被引),转发模块是硬要求(client-image-ops 先例)。
  - **样式送达机制**:app/globals.css:6 `@import "@blksails/pi-web-ui/styles.css"`(ui package.json exports "./styles.css");canvas-ui 照此形状自带 styles.css,由 app 装配层 @import(app 不受 SES-H1 约束)。

## Research Log

### canvas 文件对 ui 内部的 import 面(死结主体)
- **Sources**: 考古代理逐文件 import 原文(canvas-workbench.tsx:41-53 等)。
- **Findings**: workbench 消费 Button/Card/Input/Popover/Select/Textarea/cn 七项;aigc-quick-settings 消费 Select;lineage-view 消费 Button/Card/cn;其余(gallery/launcher/use-canvas-view/aigc-model-meta)对 ui 内部**零依赖**(只依赖 @blksails 兄弟包与 react/lucide)。
- **Implications**: 死结面精确=6 组件+cn;primitives 首批只收这七项即可解结,其余 ui 组件(dialog/cmdk 等)不迁。

### 转发链路的零改动杠杆
- **Findings**: ui/src/index.ts:185-207 canvas 导出块 import 自 `./canvas/*.js`;设置面板字段 import `../../canvas/aigc-model-meta.js`;测试深路径 import 同目录。ui 内部对 6 共享件的消费者(chat/config 等)import `../ui/button.js` 等相对路径。
- **Implications**: **双侧转发模块策略把 churn 压到最低**——① packages/ui/src/ui/{button,card,input,popover,select,textarea}.tsx 与 src/lib/cn.ts 改写为转发 primitives(ui 内部全部消费者零改动);② packages/ui/src/canvas/*.ts(x) 8 个改写为转发 canvas-ui(index.ts、设置面板字段、全部测试深路径零改动)。index.ts 本体可以完全不动。

### 样式随迁机制
- **Sources**: app/globals.css:6;packages/ui/package.json:9(exports "./styles.css");styles.css:143-159。
- **Findings**: canvas 样式块仅两段(棋盘底 + 工具图可点 affordance),均纯 CSS 变量表达。
- **Implications**: canvas-ui 自带 src/styles.css + exports "./styles.css",app/globals.css 增一行 @import;ui/styles.css 删除 canvas 块(SES-H1 词汇线达成)。tailwind content 增 canvas-ui/primitives glob(canvas-kit 先例同规则)。

### 反向消费者与公开面
- **Findings**: examples 两个 agent 经 `@blksails/pi-web-ui` 包名 import CanvasLauncher/CanvasPanel/AigcQuickSettings;lib/app/webext-registry 间接经 examples;非 canvas 测试零 canvas import。
- **Implications**: index 导出链经转发模块保持 → examples 零改动(Req 3.1);canvas-ui 自身 index.ts 成为新 canonical 出口。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| primitives 下沉 + 双侧转发(选定) | 共享件下沉新包;ui 侧组件文件与 canvas 文件全部改写为转发模块 | churn 最小(index/测试/设置面板/examples 全零改动);死结一次性解除;先例成熟(client-image-ops) | 多一个包;primitives 与 ui 的组件出口面短期双轨 | 用户裁决 2026-07-06 |
| canvas-ui 自持共享件副本 | 组件包内复制 6 件 | 不新增底座包 | 双份维护漂移;用户已否 | 否决 |
| ui 内子路径隔离不真迁 | SES-H1 弱化 | 最省事 | 宿主中立判据不成立 | 否决 |

## Design Decisions

### Decision: 双侧转发模块(churn 最小化)
- **Selected Approach**: ① `packages/ui/src/ui/{6 组件}.tsx` 与 `src/lib/cn.ts` 改写为显式转发 `@blksails/pi-web-primitives`(@deprecated 一个大版本;ui 内部消费者与公开导出零改动);② `packages/ui/src/canvas/{8 文件}` 改写为显式转发 `@blksails/pi-web-canvas-ui`(index.ts/设置面板/测试深路径/examples 全零改动)。
- **Rationale**: canvas-kit-m1 1.3 先例(显式清单防新出口经 export * 链泄漏);Req 3 全部 AC 由转发结构性满足。

### Decision: primitives 依赖面 = react(peer)+ 组件既有第三方原语,零 @blksails
- **Selected Approach**: dependencies: @radix-ui/react-popover、@radix-ui/react-select、class-variance-authority、clsx、tailwind-merge、lucide-react(select 的 chevron 图标);peer: react。测试:六组件渲染 smoke + cn 语义 + 出口快照(照 canvas-kit index-exports 先例)。
- **Trade-offs**: lucide-react 在 ui/canvas-kit/canvas-ui/primitives 四处出现(版本对齐由 workspace 管);可接受。

### Decision: canvas-ui 依赖面与样式载体
- **Selected Approach**: dependencies: @blksails/pi-web-canvas-kit、@blksails/pi-web-primitives、@blksails/pi-web-kit、@blksails/pi-web-react、@blksails/pi-web-tool-kit(schema 子入口)、lucide-react;peer react。src/styles.css 收 canvas 两段样式,package.json exports "./styles.css",app/globals.css @import(装配层职责)。
- **Rationale**: 依赖面即考古清单,零 @blksails/pi-web-ui(Req 2.2);样式送达照 ui 既有机制。

### Decision: SES-H1 判据白名单
- **Selected Approach**: packages/ui/src 允许 canvas 词的白名单=`src/canvas/`(转发模块目录)+ index.ts 的 canvas 兼容导出块(标注注释锚定);其余(含 styles.css)零 canvas 领域词。领域词表:canvas/Canvas/lineage/Lineage/aigc-model-meta/workbench 等(设计定稿);pi-chat/apply-extension 现存注释里的 Canvas 提及须改写或纳入词表豁免规则(倾向:注释改写,代码零 canvas 标识符)。静态断言放 canvas-ui 包 test(照 4.3 encapsulation 先例),跨包 fs 读源。
- **Follow-up**: pi-chat.tsx:260/706、apply-extension.tsx:136 为注释性提及,迁移任务顺手改写为领域无关表述。

## Risks & Mitigations
- workbench 1741 行文件整体搬迁 + import 改线出错 → 逐文件 `git mv` 语义(diff 可读)+ ui 698/canvas 83 测试零改动回归线 + e2e 6 条兜底。
- 转发双轨期类型漂移(primitives 与 ui 各自演化)→ ui 侧转发为显式 re-export,无本地实现;出口快照测试双包锚定。
- tailwind content 漏配新包 → 样式类不生成;配套任务显式含 glob + e2e 视觉兜底。
- vitest alias 坑(memory 反复踩)→ ui/canvas-ui 的 vitest.config alias 表同步两个新包条目;先例:canvas-kit-m1 1.3。
- 并发负载假阳性(vitest waitFor 超时)→ 判别链已文档化(定向重跑;duration 膨胀信号)。

## References
- docs/canvas-extension-mechanism-design.md §8(M1.5 前置小修条目)、docs/surface-extension-standard.md(SES-H1)
- .kiro/specs/canvas-kit-m1/(M1 先例:转发模块/出口快照/encapsulation 静态线/Implementation Notes 留账)
- packages/web-kit、packages/canvas-kit(包脚手架先例)
