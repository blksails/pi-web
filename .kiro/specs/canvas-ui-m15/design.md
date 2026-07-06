# Design Document — canvas-ui-m15

## Overview

本设计把 canvas 领域组件迁出宿主 ui 包,以**双新包 + 双侧转发**完成:

1. `@blksails/pi-web-primitives`(packages/primitives)——下沉 canvas 消费的 6 个 shadcn 薄封装(Button/Card/Input/Popover/Select/Textarea)与 `cn`,零 @blksails 依赖,视觉一致性由 design tokens(CSS 变量)承载(用户裁决 2026-07-06:下沉而非自持副本)。
2. `@blksails/pi-web-canvas-ui`(packages/canvas-ui)——收纳 packages/ui/src/canvas/ 全部 8 文件(2977 行),依赖 canvas-kit + primitives + 既有跨包契约,**零 @blksails/pi-web-ui 依赖**。
3. **双侧转发**把 churn 压到最低:ui 侧 6 组件文件 + cn 改写为转发 primitives(ui 内部消费者与公开导出零改动);ui 侧 canvas/ 8 文件改写为转发 canvas-ui(index.ts、设置面板字段、测试深路径、examples 全零改动)。
4. SES-H1 宿主中立与包封装线照 canvas-kit-m1 4.3 先例固化为静态断言。

不引入任何新抽象;组件行为、DOM、data-* 锚点零变更(Req 2.1);canvas-kit 定形零改动(Req 2.3)。

## Boundary Commitments

- **Owns**:packages/primitives 全部;packages/canvas-ui 全部;packages/ui 的转发层(src/ui/6 件、src/lib/cn.ts、src/canvas/8 件)与 styles.css canvas 块摘除;app/globals.css 的 canvas-ui 样式 @import;根 tsconfig paths / vitest alias / tailwind content 配套;SES-H1 与封装静态断言;白名单外全部 canvas 注释改写(pi-chat.tsx ×5 / apply-extension.tsx ×4 / pi-tool-part.tsx ×1,词汇线配合,零代码语义变化)与两处 ses-h1-exempt 豁免锚(index.ts 导出块 / toggles-field import 行)。
- **Does NOT own**:canvas-kit 任何文件(零改动,出口快照锚定);canvas 组件的行为/样式变更;ui 包其余组件(dialog/cmdk/dropdown 等)的下沉;M2 动作链;M3 webext;e2e 用例文件。
- **Allowed Dependencies**:primitives → react(peer)+ radix/CVA/clsx/tailwind-merge/lucide,零 @blksails;canvas-ui → canvas-kit/primitives/web-kit(pi-web-kit)/react 包(pi-web-react)/tool-kit(仅 aigc-canvas-schema 子入口)+ react(peer)+ lucide;ui → +primitives、+canvas-ui(转发消费)。**反向禁止**:canvas-ui/primitives 零 @blksails/pi-web-ui import。
- **Revalidation Triggers**:若迁移中发现 canvas 组件对 ui 的未盘点依赖(考古清单外)→ 停task 回 design 补裁;若 ui 内部有第 7 个共享件消费浮现 → primitives 清单扩充并记档。

## Architecture

```
app/globals.css ──@import──> ui/styles.css(无 canvas 块)
                └─@import──> canvas-ui/styles.css(棋盘底 + 工具图 affordance)

@blksails/pi-web-ui ──依赖──> @blksails/pi-web-canvas-ui ──依赖──> @blksails/pi-web-canvas-kit
        │                          │                                  (M1 定形,零改动)
        └──依赖──> @blksails/pi-web-primitives <──依赖──┘
                        (零 @blksails 依赖)

ui/src/ui/button.tsx 等 6 件 + lib/cn.ts = 显式转发 primitives(@deprecated 一个大版本)
ui/src/canvas/*.ts(x) 8 件      = 显式转发 canvas-ui(@deprecated 一个大版本)
ui/src/index.ts                 = 经转发模块链保持全部公开导出(唯一改动=豁免锚注释)
```

### 转发模块契约(照 canvas-kit-m1 1.3 先例)

- **显式清单 re-export**(`export {…} from` / `export type {…} from`),禁 `export *`——防新包后续新增出口经 ui 链泄漏成既成公开面。
- 转发清单 = 迁移前该文件的**既有导出全集**(逐文件 `grep ^export` 对照,审查以 HEAD 版为黄金基准)。
- 文件头 `@deprecated` 注释:兼容一个大版本,新代码直连新包。

## File Structure Plan

### New Files — packages/primitives
| 文件 | 职责 |
|---|---|
| package.json / tsconfig.json / vitest.config.ts | 脚手架照 canvas-kit 先例;exports "." → src/index.ts |
| src/button.tsx · card.tsx · input.tsx · popover.tsx · select.tsx · textarea.tsx | 自 packages/ui/src/ui/ 同名文件**原样迁入**(语义零变,注释保留) |
| src/cn.ts | 自 packages/ui/src/lib/cn.ts 原样迁入 |
| src/index.ts | 唯一出口(六组件全导出 + cn;出口纪律注释) |
| test/primitives.test.tsx | 六组件渲染 smoke + cn 语义锚定 |
| test/index-exports.test.ts | 出口清单快照(防漂移) |

### New Files — packages/canvas-ui
| 文件 | 职责 |
|---|---|
| package.json / tsconfig.json / vitest.config.ts | 脚手架;exports "." → src/index.ts、"./styles.css" → src/styles.css |
| src/canvas-workbench.tsx · canvas-gallery.tsx · canvas-launcher.tsx · lineage-view.tsx · aigc-quick-settings.tsx · aigc-model-meta.tsx · use-canvas-view.ts · client-image-ops.ts | 自 packages/ui/src/canvas/ **原样迁入**;仅 import 来源改线(`../ui/*.js`→primitives、`../lib/cn.js`→primitives;相对 `./` 兄弟引用保持) |
| src/index.ts | canonical 出口 = **8 文件 HEAD 导出全集的去重并集**(严格超集于 ui index canvas 块——aigc-model-meta 全文件、workbench 的 decideGenerate/buildSurfaceOp/buildToolPrompt 等、use-canvas-view 的 canvasViewStore 均被深路径 named import 或设置面板消费,须从包入口可达;sanity 审查 F1 修正,已核 8 文件无跨文件重名) |
| src/styles.css | 收 ui/styles.css :142-160 两段 canvas 样式(原样;开工 grep 重校准) |
| test/index-exports.test.ts | 出口清单快照 |
| test/encapsulation.test.ts | 静态断言:canvas-ui 零 pi-web-ui import;零 canvas-kit 深路径;**SES-H1 线**(跨包 fs 读 packages/ui/src,白名单外零 canvas 领域词);primitives 零 @blksails import |

### Modified Files
| 文件 | 变更 |
|---|---|
| packages/ui/src/ui/{button,card,input,popover,select,textarea}.tsx | 改写为显式转发 primitives |
| packages/ui/src/lib/cn.ts | 改写为显式转发 primitives |
| packages/ui/src/canvas/{8 文件} | 改写为显式转发 canvas-ui |
| packages/ui/src/styles.css | 删 :142-160 canvas 两段(样式随迁;开工 grep 重校准) |
| packages/ui/src/chat/pi-chat.tsx · web-ext/apply-extension.tsx | 仅注释改写为领域无关表述(零代码变化;SES-H1 词汇线配合) |
| packages/ui/package.json | +primitives、+canvas-ui workspace 依赖 |
| packages/ui/vitest.config.ts | alias 表 +primitives、+canvas-ui 条目 |
| app/globals.css | +`@import "@blksails/pi-web-canvas-ui/styles.css";` |
| 根 tsconfig.json | paths +2 新包条目(照 canvas-kit 形状) |
| tailwind.config.ts | content +primitives、+canvas-ui 双 glob(packages/ 与 node_modules/ 两形,照 canvas-kit 先例) |
| 根 package.json | +canvas-ui workspace 依赖(2.2 审查 ACCEPT 记档:app/globals.css @import 的解析链接来源,同根依赖 pi-web-ui 先例) |
| pnpm-lock.yaml | install 联动 |

### 不改(显式承诺)
packages/ui/src/index.ts(转发链保持;**唯一例外**=canvas 兼容导出块首尾的 SES-H1 豁免锚注释,零代码变化——sanity F4 修正);packages/ui/test/** 全部;packages/canvas-kit/** 全部;e2e/** 全部;examples/** 全部。

## SES-H1 判据定义(Req 4.1)

- **领域词表**:`canvas|Canvas|CANVAS|lineage|Lineage|workbench|Workbench|checkerboard|aigc-model-meta|aigc-quick-settings`(大小写敏感按词形列举;`aigc` 单独不算——设置面板 aigc 域属 config 领域)。
- **白名单**:`packages/ui/src/canvas/`(转发模块目录本体)。
- **判据**:packages/ui/src 白名单外全部文件(含 styles.css)零词表命中;index.ts 的 canvas 导出块 import 自 `./canvas/*.js` 属白名单目录消费,但 index.ts 自身含 `Canvas*` 导出标识符——**裁定**:index.ts 的 canvas 兼容导出块以「块级豁免注释锚」标注(静态断言识别 `/* ses-h1-exempt: canvas 兼容导出(一个大版本) */` 区间),豁免区间外零命中。豁免锚本身是判据的一部分,防无档扩散。
- 注释改写范围=**词表 grep 驱动的白名单外全部命中**(基线:pi-chat.tsx ×5、apply-extension.tsx ×4、pi-tool-part.tsx ×1——sanity F2 修正 design 漏账;不锚行号,三文件均有并发 WIP 行号必漂),代码标识符本就无 canvas 词。
- **设置面板字段豁免(sanity F3)**:aigc-model-toggles-field 的 `../../canvas/aigc-model-meta.js` import 说明符本身命中词表且改直连同样含 canvas 词(无解于改线)——该 import 行套用与 index.ts 相同的 `ses-h1-exempt` 块级豁免锚(锚文案记档:config 域对 canvas-ui 的合法跨包消费)。豁免锚全仓仅两处(index.ts 块级开/闭锚 + toggles-field 的单行锚 `ses-h1-exempt-next-line:`——单行形仅豁免下一行,比块形更紧,3.1 审查 ACCEPT 记档),静态断言同时锚定「豁免锚总数=2」防无档扩散。

## Error Handling

迁移型 spec,无新运行时错误面。风险控制依赖:行为回归线(ui 698 + canvas 组件测试经转发跑)+ e2e 6 条 + 出口快照 ×3(primitives/canvas-ui/canvas-kit 不变)。

## Testing Strategy

1. **Unit(新增)**:primitives 六组件渲染 smoke + cn 语义;primitives/canvas-ui 出口快照;encapsulation 静态线(封装 ×3 + SES-H1,全部带变异证据纪律)。
2. **Regression(零改动硬线)**:packages/ui 全量 698(canvas 组件测试经深路径→转发模块→canvas-ui 真实链路,天然验证兼容层);canvas-kit 222 + 出口快照不变;workspace typecheck。
3. **E2E(零改动)**:aigc-canvas.e2e.ts 5 条 + aigc-canvas-degrade.e2e.ts 1 条(基线 6/6 绿,b507d43;任何红都不是 pre-existing)。外部 server 模式 + .next-e2e 隔离构建(先例跑法)。
4. **变异纪律**:每条新静态断言注入违规即红(4.3 先例);转发模块抽一路断开验证测试真锚定。

## Requirements Traceability

| Req | 设计落点 |
|---|---|
| 1.1-1.4 | packages/primitives(原样迁入 + 依赖面 + ui 改线经转发 + tokens) |
| 2.1-2.4 | packages/canvas-ui(8 件原样迁入仅 import 改线;依赖面;canvas-kit 零改动;styles.css 随迁 + app @import) |
| 3.1-3.4 | 双侧转发模块 + index/测试/设置面板/examples 零改动;回归线 |
| 4.1-4.4 | SES-H1 判据定义 + encapsulation.test 静态断言 + 变异纪律 |
| 5.1-5.3 | Modified Files 配套行 + Testing Strategy 2/3 |
