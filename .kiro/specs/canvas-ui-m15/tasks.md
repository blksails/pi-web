# Implementation Plan

> 基线 b507d43(canvas-kit-m1 已合 main,e2e 6/6 绿)。行号引用开工时以 grep 重校准(styles.css/pi-chat 等有并发 WIP)。黄金基准恒取 `git show HEAD:`。

- [ ] 1. Foundation:primitives 下沉
- [ ] 1.1 primitives 包脚手架与六组件+cn 迁入
  - 照 canvas-kit 先例建 packages/primitives(exports "."→src/index.ts;peer react;deps=@radix-ui/react-popover、@radix-ui/react-select、class-variance-authority、clsx、tailwind-merge、lucide-react,零 @blksails);button/card/input/popover/select/textarea 自 packages/ui/src/ui/ 迁入,cn 自 src/lib/cn.ts 迁入——仅 import 改线:`../lib/cn.js`→`./cn.js`,其余零变(六文件唯一内部依赖即 cn,已核穷尽);src/index.ts 唯一出口+出口纪律注释
  - 根 tsconfig paths + tailwind content(packages/ 与 node_modules/ 双 glob)+ workspace install
  - 测试:六组件渲染 smoke + cn 语义锚定 + 出口清单快照
  - 完成态:pnpm --filter @blksails/pi-web-primitives typecheck/test 绿;workspace install 识别新包
  - _Requirements: 1.1, 1.2, 1.4, 5.1_
  - _Boundary: packages/primitives_
- [ ] 1.2 (P) ui 共享件改线为转发 primitives
  - packages/ui/src/ui/{button,card,input,popover,select,textarea}.tsx 与 src/lib/cn.ts 改写为显式转发(@deprecated 一个大版本;显式清单禁 export *,清单=HEAD 版导出全集逐文件对照);ui package.json +primitives 依赖;ui vitest alias +primitives 条目
  - 完成态:packages/ui 全量测试零改动通过(698 基线)+ ui typecheck 绿;ui 公开导出面与 HEAD 守恒
  - _Requirements: 1.3, 3.4_
  - _Boundary: packages/ui 转发层(共享件侧)_
  - _Depends: 1.1_

- [ ] 2. Core:canvas-ui 迁出
- [ ] 2.1 (P) canvas-ui 包脚手架与 8 文件迁入
  - 建 packages/canvas-ui(exports "."→src/index.ts、"./styles.css"→src/styles.css;deps=canvas-kit/primitives/pi-web-kit(web-kit)/pi-web-react/tool-kit+lucide-react,peer react,**零 pi-web-ui**);8 文件自 packages/ui/src/canvas/ 原样迁入,仅 import 改线(`../ui/*`→primitives、`../lib/cn.js`→primitives,`./` 兄弟引用保持);src/styles.css 收 ui styles.css 的 canvas 两段(现约 :142-160,grep 重校准)
  - **src/index.ts = 8 文件 HEAD 导出全集的去重并集**(严格超集于 ui index canvas 块:含 aigc-model-meta 全部三导出、workbench 的 decideGenerate/buildSurfaceOp/buildToolPrompt/GenerateDecision(Input)/ImageLoader/composeInpaintBack/LoadedImage、use-canvas-view 的 canvasViewStore/UseCanvasViewResult 等——深路径 named import 与设置面板消费须从包入口可达;已核无跨文件重名,client-image-ops 显式清单刻意排除 LoadedImage 无冲突)
  - 根 tsconfig paths + tailwind content 配套;canvas-ui vitest alias 表覆盖 canvas-kit/web-kit/react 包及 **tool-kit aigc-canvas-schema 子路径**(子路径 alias 坑先例)
  - 测试:出口清单快照(按并集锚定)
  - 完成态:canvas-ui typecheck/test 绿;canvas-kit 222+出口快照零改动(亲跑)
  - _Requirements: 2.1, 2.2, 2.3, 5.1_
  - _Boundary: packages/canvas-ui_
  - _Depends: 1.1_
- [ ] 2.2 ui 侧 canvas 转发层与样式随迁
  - packages/ui/src/canvas/{8 文件}改写为显式转发 canvas-ui(@deprecated;清单=各文件 HEAD 导出全集);ui styles.css 删 canvas 两段;app/globals.css +`@import "@blksails/pi-web-canvas-ui/styles.css";`;ui package.json +canvas-ui 依赖;ui vitest alias +canvas-ui
  - 完成态:packages/ui 全量测试零改动通过(canvas 组件测试经深路径→转发→canvas-ui 真实链路);设置面板字段(aigc-model-toggles-field)零语义改动(3.1 允许加豁免锚注释)、index.ts 除 3.1 豁免锚外零改动仍绿;ui typecheck 绿
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 2.4_
  - _Boundary: packages/ui 转发层(canvas 侧)+ app 样式装配_
  - _Depends: 2.1, 1.2_

- [ ] 3. 中立线固化
- [ ] 3.1 SES-H1 与封装静态断言
  - canvas-ui test/encapsulation.test.ts:①canvas-ui 零 pi-web-ui import;②canvas-ui 零 canvas-kit 深路径;③primitives 零 @blksails import;④SES-H1 线(跨包 fs 读 packages/ui/src:白名单=src/canvas/ 目录;豁免锚 `/* ses-h1-exempt: … */` 全仓仅两处=index.ts canvas 导出块首尾 + toggles-field import 行,断言同时锚定**锚总数=2** 防无档扩散;其余含 styles.css 零领域词表命中,词表照 design)
  - 配合改动:词表 grep 驱动改写白名单外**全部**注释命中(基线=pi-chat.tsx ×5 / apply-extension.tsx ×4 / pi-tool-part.tsx ×1,不锚行号);index.ts canvas 导出块首尾插豁免锚(唯一 index.ts 改动,纯注释);toggles-field import 行插豁免锚
  - 完成态:静态断言全绿且每条有变异证据(注入违规即红,Edit 精确还原);ui 全量测试仍零改动绿
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Boundary: canvas-ui/test + ui 注释与豁免锚(index.ts/aigc-model-toggles-field/pi-chat/apply-extension/pi-tool-part)_
  - _Depends: 2.2_

- [ ] 4. Validation:回归与端到端
- [ ] 4.1 全量回归与 e2e
  - workspace typecheck 全绿;primitives/canvas-ui/canvas-kit 各包测试绿(canvas-kit 222 零改动);packages/ui 全量 698 零改动绿
  - canvas 相关全部 e2e 零改动全绿:aigc-canvas.e2e.ts 5 条 + aigc-canvas-degrade.e2e.ts 1 条(基线 b507d43 后 6/6 已绿——任何红都不是 pre-existing;外部 server 模式 + .next-e2e 隔离构建先例)
  - 完成态:全部命令新鲜输出为证
  - _Requirements: 5.2, 5.3, 3.4_
  - _Depends: 3.1_
