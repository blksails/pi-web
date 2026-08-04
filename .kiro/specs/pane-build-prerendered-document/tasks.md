# Implementation Plan

> ★ 原始症状是**构建成功但产物少一个 pane**（静默丢失），所以「构建没报错」不构成任何证据。
> 每条验收都必须直接数 `panes.json` 里的条目数。
>
> 测试命令按 steering 分档：实现者用 `node scripts/scoped-test.mjs <paths>`，
> 复查者跑 `pnpm test` **+** `pnpm test:app`。

- [ ] 1. 声明层

- [x] 1.1 `PaneModule` 改判别联合并加互斥校验
  - `server/cli/build/pane-discovery.ts`：拆成 `PaneEntryModule`（带 `entry`）与
    `PaneDocumentModule`（带 `document`），二者各带一个 `?: undefined` 的反字段
    —— 没有它 TypeScript 无法据 `module.document !== undefined` 收窄联合
  - `normalizePaneModule`：先判形态再归一。`document` 为非空字符串 → 预渲染形态，跳过
    `normalizeEntry`；两者都给或都不给 → 抛 `BuildError{stage:"discover"}`，detail 含 pane id
  - `document` 存在但非字符串/空串 → 按「未给出」处理，并在 detail 里指明类型不符
  - 观察点：三种非法组合（都给 / 都不给 / document 非字符串）各自抛错且错误信息含该 pane 的 id；
    合法的预渲染声明产出的模块带 `document`、不带 `entry`
  - _Requirements: 1.1, 2.3, 2.4, 2.5, 4.1, 4.2_
  - _Boundary: pane 声明归一 — `server/cli/build/pane-discovery.ts`_

- [x] 1.2 声明层穷举单测
  - 新建 `test/cli/build/pane-prerendered-document.test.ts`，覆盖 design Unit Tests 的 1–3 项
  - 观察点：`node scripts/scoped-test.mjs test/cli/build/pane-prerendered-document.test.ts`
    退出码 0；且先确认这些用例在**未改动的代码上会红**，再信它们报的绿
  - _Requirements: 1.1, 2.3, 2.4, 4.2_
  - _Boundary: 声明层单测 — `test/cli/build/pane-prerendered-document.test.ts`_
  - _Depends: 1.1_

- [ ] 2. 构建层

- [x] 2.1 构建循环按形态分派
  - `server/cli/build/pane-build.ts`：预渲染形态**跳过** `bundlePane` 与 `resolvePaneCss`
    —— 该 HTML 自带样式，注入宿主 CSS 会改变其呈现
  - 只写文档文件、不写脚本文件；文档内容为声明给的字符串**原样**，不经 `renderPaneDocument`
    二次包装（它已经是完整文档）
  - 文件命名复用既有 `paneDocumentFilename`，使两形态同等可寻址
  - `artifacts` 汇总里该条目无 `scriptPath`：若既有结构要求其必填，改为可选并在消费处判空
  - 观察点：混合声明构建后，`documents[预渲染 id]` **逐字符等于**声明给的 HTML；
    产出文件里有该 pane 的 `.html` 而无 `.js`
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 3.2, 3.3_
  - _Boundary: 构建循环分派 — `server/cli/build/pane-build.ts`_
  - _Depends: 1.1_

- [x] 2.2 构建层单测与「仅入口不变」回归
  - 在同一测试文件补 design Unit Tests 的 4–6 项
  - 「内容相等」必须逐字符断言，只断言键存在测不出「被二次包装」这种错法
  - 「仅入口声明」一项要断言产出与改动前一致（Req 3.1 的机械保证）
  - 观察点：混合声明产出的 pane 数 == 声明数；顺序与声明一致
  - _Requirements: 1.5, 2.1, 2.2, 3.1, 4.3_
  - _Boundary: 构建层单测 — `test/cli/build/pane-prerendered-document.test.ts`_
  - _Depends: 2.1_

- [ ] 3. 真实 agent 验证

- [ ] 3.1 在 aigc-agent 上补回 logs pane 并重新构建
  - 在该 agent 的 pane 声明中以预渲染形态补回 logs pane（复用其既有的 HTML 常量与变量替换）
  - 重新 `pi-web build`，**直接数** `panes.json` 的条目：应为 4 且含 `logs`
  - 桌面版重新加载该 agent，确认四个 pane 全部可见
  - ★「构建没报错」不构成证据 —— 原始症状正是构建成功而产物少一个 pane
  - 观察点：`panes.json` 条目数 == 声明数；桌面版四个 pane 可见
  - _Requirements: 4.3, 5.1, 5.2, 5.3, 5.4_
  - _Boundary: 真实 agent 验证 — 写入 `../pi-agents/aigc-agent`（跨仓，改动需单独提交）_
  - _Depends: 2.2_

- [ ] 4. 回归

- [ ] 4.1 全量回归与算术核对
  - 跑 `pnpm test` **和** `pnpm test:app` 两条；对每个汇总行核对
    `failed + passed + skipped === 总数`，文件数与用例数各算一遍
  - 跑 `pnpm typecheck`（desktop 的 cargo 部分若因本机环境失败，须与 TS 侧分离判断）
  - 观察点：两条命令退出码 0、算术自洽、根 tsc 0 error；与改动前基线相比无新增失败
  - _Requirements: 3.1, 3.4_
  - _Boundary: 回归验证（不改代码）— 无写入_
  - _Depends: 3.1_
