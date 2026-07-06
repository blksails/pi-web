# Requirements Document

## Project Description (Input)
M1.5:canvas 组件迁出 ui 包 + SES-H1 宿主中立。依据 docs/canvas-extension-mechanism-design.md 与 canvas-kit-m1 spec 的范围修订记录(组件迁出当时因依赖方向死结推迟)。

范围:① 新建 @blksails/pi-web-primitives 包下沉共享薄封装(**用户裁决 2026-07-06:下沉 primitives 包而非组件自持副本**);② 新建 @blksails/pi-web-canvas-ui 包收 canvas 领域组件,零 @blksails/pi-web-ui 依赖,canvas-kit 纯逻辑定形不动;③ i18n 归属考古后定;④ ui 保留全量 re-export 兼容一个大版本;⑤ SES-H1 grep 线固化。非目标:M2/M3;canvas-kit 内核与 8 工具零改动;组件行为零变更。

> **考古修正(2026-07-06,证据在 research.md)**:③ i18n 实证为**零依赖**——canvas 组件无任何 t() 调用(文案硬编码中文),字典迁移需求消解,原 ③ 作废。共享件穷尽清单=6 组件(button/card/input/popover/select/textarea)+ cn;另发现两笔账:ui 设置面板字段(aigc-model-toggles-field)反向消费 aigc-model-meta 的 ProviderBadge/displayNameOf;styles.css 存在 canvas 领域样式块(.canvas-checkerboard / [data-canvas-tool-image-clickable])。

## Introduction

本 spec 把 packages/ui/src/canvas/ 的 8 个 canvas 领域文件(2977 行)迁出宿主 ui 包:被消费的 6 个共享薄封装与 cn 下沉到新包 @blksails/pi-web-primitives(解掉 ui↔canvas 依赖方向死结),canvas 组件迁入新包 @blksails/pi-web-canvas-ui。目标读者是宿主维护者(ui 包回归领域无关)与 canvas 应用面维护者;对最终用户零可见变化(行为回归零改动是硬验收)。canvas-kit(M1,纯逻辑 L1/L2)定形不动,本 spec 只做组件层搬迁与宿主中立判据固化(SES-H1)。

## Boundary Context

- **In scope**:新包 primitives(6 共享件 + cn 下沉;ui 全面改指 primitives);新包 canvas-ui(canvas/ 全部 8 文件迁入);ui 兼容层(index 导出链 + 8 个深路径转发模块,兼容一个大版本);canvas 领域样式块的归置;设置面板字段对 aigc-model-meta 消费的改线;SES-H1 与封装 grep 线固化;根 tsconfig paths / vitest alias / tailwind content 配套。
- **Out of scope**:M2 动作链/能力下发;M3 webext canvasPlugins;canvas-kit 内核与 builtin 工具任何改动;组件行为/DOM/样式的任何变更;i18n(考古证实零依赖);ui 包其余组件(dialog/cmdk 等非 canvas 消费件)的下沉——primitives 首批只收 canvas 消费面,其余按需后迁。
- **Adjacent expectations**:canvas-kit-m1 已合 main(b507d43,e2e 6 条基线全绿);examples(aigc-canvas-agent / aigc-canvas-nosurface-agent)经 @blksails/pi-web-ui 包名消费 canvas 组件,依赖 ④ 兼容层零改动;tool-kit 的 aigc-canvas-schema 子入口继续作为双端 schema 来源;design tokens(hsl(var(--*)) CSS 变量)继续由宿主样式层权威承载,primitives/canvas-ui 只消费变量名。

## Requirements

### Requirement 1: 共享薄封装下沉独立包(primitives)
**Objective:** As a 仓库维护者, I want canvas 消费的 ui 共享薄封装下沉为独立 primitives 包, so that ui→canvas-ui 兼容依赖与 canvas-ui→共享件依赖不再构成循环(死结解除),且后续任何领域包迁出可复用同一底座

#### Acceptance Criteria
1. The 仓库 shall 提供独立 workspace 包 `@blksails/pi-web-primitives`(packages/primitives),含独立 typecheck 与测试脚本,收纳 Button/Card/Input/Popover/Select/Textarea 六组件与 cn 工具,实现语义与迁移前逐一致(源自 packages/ui/src/ui/* 与 src/lib/cn.ts)。
2. The primitives 包 shall 只依赖 react(peer)与组件既有第三方原语(@radix-ui/react-popover、@radix-ui/react-select、class-variance-authority、clsx、tailwind-merge、lucide-react),零 @blksails/* 依赖。
3. The @blksails/pi-web-ui 包 shall 改为从 primitives 消费上述六组件与 cn(内部 import 改线),且 ui 自身对这些组件的既有公开导出面零变化(消费者无感)。
4. While 视觉一致性验收, the primitives 组件 shall 继续以 design tokens(CSS 变量)表达颜色/边框等主题量,不引入独立主题体系。

### Requirement 2: canvas 组件独立包(canvas-ui)
**Objective:** As a canvas 应用面维护者, I want canvas 领域组件独立成包, so that 宿主 ui 包回归领域无关,canvas 应用面有单一归属

#### Acceptance Criteria
1. The 仓库 shall 提供独立 workspace 包 `@blksails/pi-web-canvas-ui`(packages/canvas-ui),收纳 packages/ui/src/canvas/ 全部 8 文件(canvas-workbench/canvas-gallery/canvas-launcher/lineage-view/aigc-quick-settings/aigc-model-meta/use-canvas-view/client-image-ops 转发层),组件行为、DOM 结构与 data-* 锚点零变化。
2. The canvas-ui 包 shall 依赖面限定为:canvas-kit、primitives、react(peer)、lucide-react,及既有跨包契约(@blksails/pi-web-kit、@blksails/pi-web-react、@blksails/pi-web-tool-kit 的 aigc-canvas-schema 子入口);**零 @blksails/pi-web-ui 依赖**(依赖方向:ui 消费 canvas-ui,反向禁止)。
3. The canvas-kit 包 shall 保持 M1 定形零改动(纯逻辑、零 @blksails 依赖、L2 出口快照不变)。
4. The canvas 领域样式(.canvas-checkerboard、[data-canvas-tool-image-clickable] 块)shall 随迁至 canvas-ui 归属的样式载体,宿主样式文件不再含 canvas 领域规则;宿主消费路径经设计定义且最终呈现零变化。

### Requirement 3: 宿主兼容层(零破坏)
**Objective:** As a 既有消费者(examples/设置面板/测试), I want ui 包保留全量兼容导出, so that 迁移对我零改动

#### Acceptance Criteria
1. The @blksails/pi-web-ui 包 shall 保留 canvas 组件全部既有公开导出(index 导出链经 canvas-ui 转发)至少一个大版本,examples 与宿主装配经 @blksails/pi-web-ui 的既有 import 零改动可用。
2. The packages/ui/src/canvas/ 目录 shall 保留 8 个同名**转发模块**(照 client-image-ops 先例,显式转发 @deprecated 标注),使 packages/ui/test/canvas/ 的全部深路径 import(`../../src/canvas/*.js`)零改动继续解析。
3. The ui 设置面板字段(aigc-model-toggles-field)对 ProviderBadge/displayNameOf 的消费 shall 改线为 canvas-ui 来源(直连或经转发模块),行为零变化。
4. When 迁移完成, packages/ui 全部既有单测 shall 零改动通过;canvas 相关 6 条浏览器 e2e(闭环/粘性回放/auto-sync/B 档/门控独立/降级)shall 零改动通过。

### Requirement 4: SES-H1 宿主中立与封装线
**Objective:** As a 架构维护者, I want 宿主中立性与包边界以静态断言固化, so that 判据可回归、漂移即红

#### Acceptance Criteria
1. When 迁移完成, packages/ui/src 的 canvas 领域词出现面 shall 收敛至兼容层白名单(canvas/ 转发模块目录、index 兼容导出块),白名单外零 canvas 领域词(含样式文件);判据照 canvas-kit-m1 4.3 先例固化为静态断言测试。
2. The canvas-ui 包 shall 零 @blksails/pi-web-ui import(静态断言固化);canvas-ui 对 canvas-kit 的消费 shall 仅经包名入口(零 kernel 深路径,静态断言固化)。
3. The primitives 包 shall 零 @blksails/* import(静态断言固化)。
4. The 全部新增静态断言 shall 有变异证据(注入违规 import 即红)。

### Requirement 5: 工程配套与全量回归
**Objective:** As a 仓库维护者, I want 构建/测试基建随迁配齐, so that 新包在 dev/test/build 全链路可用

#### Acceptance Criteria
1. The 根 tsconfig paths、消费包 vitest alias、tailwind content shall 覆盖两个新包(canvas-ui 组件样式类与 canvas-kit 先例同规则纳入扫描)。
2. The workspace typecheck shall 全绿;两个新包 shall 各自 test/typecheck 绿(TS strict 禁 any);canvas-kit 222 用例与出口快照 shall 零改动通过。
3. When 全部迁移完成, `pnpm --filter @blksails/pi-web-ui test` shall 全量零改动通过(基线 698),且 workspace 其余包测试无回归。
