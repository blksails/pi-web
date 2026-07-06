# Implementation Plan

> 基线 b507d43(canvas-kit-m1 已合 main,e2e 6/6 绿)。行号引用开工时以 grep 重校准(styles.css/pi-chat 等有并发 WIP)。黄金基准恒取 `git show HEAD:`。

- [x] 1. Foundation:primitives 下沉
- [x] 1.1 primitives 包脚手架与六组件+cn 迁入
  - 照 canvas-kit 先例建 packages/primitives(exports "."→src/index.ts;peer react;deps=@radix-ui/react-popover、@radix-ui/react-select、class-variance-authority、clsx、tailwind-merge、lucide-react,零 @blksails);button/card/input/popover/select/textarea 自 packages/ui/src/ui/ 迁入,cn 自 src/lib/cn.ts 迁入——仅 import 改线:`../lib/cn.js`→`./cn.js`,其余零变(六文件唯一内部依赖即 cn,已核穷尽);src/index.ts 唯一出口+出口纪律注释
  - 根 tsconfig paths + tailwind content(packages/ 与 node_modules/ 双 glob)+ workspace install
  - 测试:六组件渲染 smoke + cn 语义锚定 + 出口清单快照
  - 完成态:pnpm --filter @blksails/pi-web-primitives typecheck/test 绿;workspace install 识别新包
  - _Requirements: 1.1, 1.2, 1.4, 5.1_
  - _Boundary: packages/primitives_
- [x] 1.2 (P) ui 共享件改线为转发 primitives
  - packages/ui/src/ui/{button,card,input,popover,select,textarea}.tsx 与 src/lib/cn.ts 改写为显式转发(@deprecated 一个大版本;显式清单禁 export *,清单=HEAD 版导出全集逐文件对照);ui package.json +primitives 依赖;ui vitest alias +primitives 条目
  - 完成态:packages/ui 全量测试零改动通过(698 基线)+ ui typecheck 绿;ui 公开导出面与 HEAD 守恒
  - _Requirements: 1.3, 3.4_
  - _Boundary: packages/ui 转发层(共享件侧)_
  - _Depends: 1.1_

- [x] 2. Core:canvas-ui 迁出
- [x] 2.1 (P) canvas-ui 包脚手架与 8 文件迁入
  - 建 packages/canvas-ui(exports "."→src/index.ts、"./styles.css"→src/styles.css;deps=canvas-kit/primitives/pi-web-kit(web-kit)/pi-web-react/tool-kit+lucide-react,peer react,**零 pi-web-ui**);8 文件自 packages/ui/src/canvas/ 原样迁入,仅 import 改线(`../ui/*`→primitives、`../lib/cn.js`→primitives,`./` 兄弟引用保持);src/styles.css 收 ui styles.css 的 canvas 两段(现约 :142-160,grep 重校准)
  - **src/index.ts = 8 文件 HEAD 导出全集的去重并集**(严格超集于 ui index canvas 块:含 aigc-model-meta 全部三导出、workbench 的 decideGenerate/buildSurfaceOp/buildToolPrompt/GenerateDecision(Input)/ImageLoader/composeInpaintBack/LoadedImage、use-canvas-view 的 canvasViewStore/UseCanvasViewResult 等——深路径 named import 与设置面板消费须从包入口可达;已核无跨文件重名,client-image-ops 显式清单刻意排除 LoadedImage 无冲突)
  - 根 tsconfig paths + tailwind content 配套;canvas-ui vitest alias 表覆盖 canvas-kit/web-kit/react 包及 **tool-kit aigc-canvas-schema 子路径**(子路径 alias 坑先例)
  - 测试:出口清单快照(按并集锚定)
  - 完成态:canvas-ui typecheck/test 绿;canvas-kit 222+出口快照零改动(亲跑)
  - _Requirements: 2.1, 2.2, 2.3, 5.1_
  - _Boundary: packages/canvas-ui_
  - _Depends: 1.1_
- [x] 2.2 ui 侧 canvas 转发层与样式随迁
  - packages/ui/src/canvas/{8 文件}改写为显式转发 canvas-ui(@deprecated;清单=各文件 HEAD 导出全集);ui styles.css 删 canvas 两段;app/globals.css +`@import "@blksails/pi-web-canvas-ui/styles.css";`;ui package.json +canvas-ui 依赖;ui vitest alias +canvas-ui
  - 完成态:packages/ui 全量测试零改动通过(canvas 组件测试经深路径→转发→canvas-ui 真实链路);设置面板字段(aigc-model-toggles-field)零语义改动(3.1 允许加豁免锚注释)、index.ts 除 3.1 豁免锚外零改动仍绿;ui typecheck 绿
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 2.4_
  - _Boundary: packages/ui 转发层(canvas 侧)+ app 样式装配_
  - _Depends: 2.1, 1.2_

- [x] 3. 中立线固化
- [x] 3.1 SES-H1 与封装静态断言
  - canvas-ui test/encapsulation.test.ts:①canvas-ui 零 pi-web-ui import;②canvas-ui 零 canvas-kit 深路径;③primitives 零 @blksails import;④SES-H1 线(跨包 fs 读 packages/ui/src:白名单=src/canvas/ 目录;豁免锚 `/* ses-h1-exempt: … */` 全仓仅两处=index.ts canvas 导出块首尾 + toggles-field import 行,断言同时锚定**锚总数=2** 防无档扩散;其余含 styles.css 零领域词表命中,词表照 design)
  - 配合改动:词表 grep 驱动改写白名单外**全部**注释命中(基线=pi-chat.tsx ×5 / apply-extension.tsx ×4 / pi-tool-part.tsx ×1,不锚行号);index.ts canvas 导出块首尾插豁免锚(唯一 index.ts 改动,纯注释);toggles-field import 行插豁免锚
  - 完成态:静态断言全绿且每条有变异证据(注入违规即红,Edit 精确还原);ui 全量测试仍零改动绿
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Boundary: canvas-ui/test + ui 注释与豁免锚(index.ts/aigc-model-toggles-field/pi-chat/apply-extension/pi-tool-part)_
  - _Depends: 2.2_

- [x] 4. Validation:回归与端到端
- [x] 4.1 全量回归与 e2e
  - workspace typecheck 全绿;primitives/canvas-ui/canvas-kit 各包测试绿(canvas-kit 222 零改动);packages/ui 全量 698 零改动绿
  - canvas 相关全部 e2e 零改动全绿:aigc-canvas.e2e.ts 5 条 + aigc-canvas-degrade.e2e.ts 1 条(基线 b507d43 后 6/6 已绿——任何红都不是 pre-existing;外部 server 模式 + .next-e2e 隔离构建先例)
  - 完成态:全部命令新鲜输出为证
  - _Requirements: 5.2, 5.3, 3.4_
  - _Depends: 3.1_

## Implementation Notes

- 环境纪律:一切操作限定 worktree `/Users/hysios/Projects/BlackSail/agents/pi-web/.claude/worktrees/canvas-ui-m15`,禁止 cd 主仓;黄金基准恒取 `git show HEAD:`(HEAD=3bb2431)。并发负载假阳性判别链沿 canvas-kit-m1 先例(失败集中无关文件+duration 膨胀→定向重跑)。
- 1.1:primitives 落地(出口=16 值+3 类型显式清单;vitest 需 setupFiles Radix polyfill=ui/test/setup.ts 去 jest-dom 版;devDeps 增 testing-library 渲染必需)。六组件唯一内部依赖=cn(考古+审查双确认)。1.2 转发清单以同一 16+3 全集对照。
- 1.2:7 转发文件落地(AST 级导出名集对照 7/7;变异红点落在三个真实消费者=aigc-quick-settings/canvas-workbench/enum-field,证明链路真实)。ui vitest alias 已含 primitives 条目;2.1/2.2 照抄形状加 canvas-ui。
- 2.1:canvas-ui 落地(出口并集=39 值+27 类型=66,13 个深路径命脉载荷全在;peer react ^19 对齐 primitives 审查裁定可接受——workspace react=19.2.7,ui 传递下限 1.2 起已收窄;styles.css 两段 verbatim,ui 本体留待 2.2 删)。2.2 转发清单=各文件 HEAD 导出全集,与并集口径一致。
- 2.2:8 转发文件落地(AST 8/8 守恒;client-image-ops 链路 ui→canvas-ui→canvas-kit);样式两段随迁 + app @import;**根 package.json +canvas-ui 依赖**(审查 ACCEPT:app 无自有 package.json 随根解析,根依赖是 @import 链接来源,同 pi-web-ui 先例,design 已补记档)。过程事故:执行者变异复原误用 git checkout 取到 HEAD 原件,已重写并全量复验(审查亲核现状为真转发层)——重申禁 git checkout 纪律。
- 3.1:四断言+豁免锚协议落地(canvas-ui 9/9;④b 反走私变异证明锚计数线有效)。计划外 7 处 @deprecated 注释改写("canvas-ui-m15"→"m15 迁移",1.2/2.2 自引入的词表命中,审查裁定属 Req 4.1 射程)。引号锚定收窄+父控制器补反引号加固;单行锚 ses-h1-exempt-next-line 形态已记 design。
- 4.1:收官全绿(workspace typecheck 11 项;单测 14+9+222+698=943;e2e 6/6 一次过 18.7s;CSS 冒烟 .canvas-checkerboard 在产物 2b86bbfa…css——canvas-ui styles.css 经 app @import 进产物实证)。
