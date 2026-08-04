# Implementation Plan

> 全部改动落在 `packages/panes-kit`。测试命令按 steering 分档：实现者用
> `node scripts/scoped-test.mjs <paths>`，复查者跑 `pnpm test` **+** `pnpm test:app`。
>
> ★ `packages/panes-kit/src/react/panes-host.tsx` 被 2.1 / 2.2 / 3.1 三个任务先后修改，
> 它们**不可并发**（同一写入集）。真正可并行的只有 1.1 与 2.1。

- [ ] 1. 补齐判定的纯逻辑层

- [x] 1.1 实现 `reconcilePaneWorkspace` 纯函数 (P)
  - 在 `packages/panes-kit/src/instances.ts` 新增 `ReconcilePaneWorkspaceInput` 与 `reconcilePaneWorkspace`，签名与 design 的 Service Interface 逐字一致；`createPaneWorkspace` 保持不动
  - `candidates = definition.initialPaneIds − 已打开 paneIds − (knownPaneIds − 已打开 paneIds)`；`knownPaneIds` 为 `undefined` 时略去第三项
  - 只增不减：返回值的 instance 列表以入参 `state.instances` 为前缀原样保留，其后追加新 instance；`activeInstanceId` 不变
  - 超 `maxOpenPanes` 时只截断 candidates 一侧，既有 instance 一个不动
  - 在 `packages/panes-kit/src/index.ts` 导出该函数与入参类型，与既有 `createPaneWorkspace` / `reducePaneWorkspace` 并列
  - 观察点：`candidates` 为空时 `return state` 返回**同一引用**（不是等值新对象），调用方可用引用相等跳过重渲染
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.1, 2.4, 4.1, 4.3, 4.4_
  - _Boundary: reconcilePaneWorkspace — `packages/panes-kit/src/instances.ts`, `packages/panes-kit/src/index.ts`_

- [x] 1.2 为 `reconcilePaneWorkspace` 写穷举单测
  - 新建 `packages/panes-kit/test/instances.test.ts`（该模块目前无任何专项测试）
  - 六个用例逐一对应 design 的 Unit Tests 清单：补开新出现的初始 pane / 既有 instanceId 与相对顺序逐一不变 / 用户关闭的不复现 / 无可补开时 `expect(result).toBe(state)` / 超上限从 candidates 侧截断 / `knownPaneIds` 为 `undefined` 的降级行为
  - 「既有 instanceId 不变」必须断言**集合与相对顺序两者**——这是桌面 WebView 不被重建的机械保证，只断言集合会漏掉重排
  - 观察点：`node scripts/scoped-test.mjs packages/panes-kit/test/instances.test.ts` 退出码 0 且 6 个用例全部执行（核对报告的用例数，不是只看"没红"）
  - _Requirements: 1.1, 1.4, 1.5, 2.1, 4.1, 4.3_
  - _Boundary: reconcilePaneWorkspace 单测 — `packages/panes-kit/test/instances.test.ts`_
  - _Depends: 1.1_

- [ ] 2. 持久化契约演进

- [x] 2.1 快照增记 `knownPaneIds` 并在恢复时消费 (P)
  - 在 `packages/panes-kit/src/react/panes-host.tsx` 的 `PersistedPaneWorkspace` 增加可选字段 `readonly knownPaneIds?: readonly string[]`，保留既有三个字段不变
  - 持久化写入 effect（现 `:499-517`）补写该字段，取值为**当前 `definition.panes` 的全部 id**；必须与 `paneIds` 在**同一次 `setItem`** 中写入，避免撕裂快照
  - `restoredPaneWorkspace` 读出该字段并透传给调用方（本任务只负责取到并传出，降级判定见 2.2）
  - 观察点：装载任一带 pane 的 agent 后，`localStorage` 中该 key 的值同时含 `paneIds` 与 `knownPaneIds` 两个数组
  - _Requirements: 2.2, 2.3, 3.2, 4.2_
  - _Boundary: PersistedPaneWorkspace 结构与读写 — `packages/panes-kit/src/react/panes-host.tsx`_

- [x] 2.2 旧快照的降级纠正判定
  - 在 `restoredPaneWorkspace` 内实现降级判定，**仅当 `knownPaneIds === undefined`** 时执行
  - 三个条件必须同时成立才判为「可确证被污染」：快照 `paneIds` 非空且每一个 id 都以 `HOST_PANE_ID_PREFIX` 开头；`definition.initialPaneIds` 中存在不以该前缀开头的 id；那些 agent 初始 pane 无一出现在快照中
  - 判定成立 → 忽略快照走 `createPaneWorkspace`；不成立 → 原样沿用快照（不得借纠正之名丢用户布局）
  - 前缀一律取既有导出的 `HOST_PANE_ID_PREFIX`，不得新写字面量 `"host:"`
  - 观察点：预置 `{"paneIds":["host:session-info"]}` 旧快照后进入会话，agent 声明的初始 pane 全部出现；而预置一份与 definition 相称的旧快照时布局原样保留
  - _Requirements: 3.1, 3.3, 3.4_
  - _Boundary: restoredPaneWorkspace 降级判定 — `packages/panes-kit/src/react/panes-host.tsx`_
  - _Depends: 2.1_

- [ ] 3. 接线

- [x] 3.1 在既有 `[definition]` effect 中触发补齐
  - 在 `packages/panes-kit/src/react/panes-host.tsx` 现有的 `React.useEffect(..., [definition])`（现 `:483`，本职是重置 parked / nativeErrors / hostError）内调用 `reconcilePaneWorkspace`
  - 返回值与当前 workspace **引用相等时不得调用 `setWorkspace`**，否则每次 definition 变化都会触发一轮无谓重渲染
  - `knownPaneIds` 取自 2.1 恢复出的值，并随每次持久化写入更新
  - 确认补齐 dispatch 与同 effect 内的 `setParkedInstanceIds(new Set())` 无顺序依赖；在注释中写明该 effect 现承担的两类职责及其关系
  - 观察点：pane 清单从仅内置变为含 agent pane 时，面板上出现 agent 声明的初始 pane；清单始终不变时该 effect 不产生任何 workspace 变更
  - _Requirements: 1.2, 4.5_
  - _Boundary: definition 变化接线 — `packages/panes-kit/src/react/panes-host.tsx`_
  - _Depends: 1.1, 2.1_

- [ ] 4. 时序与持久化集成测试

- [x] 4.1 在 `panes-host.test.tsx` 增补五个集成用例
  - 五个用例逐一对应 design 的 Integration Tests 清单：清单后到 / 存量污染快照被纠正 / 相称快照不被丢弃 / 关闭后重进保持关闭 / 首帧即完整的路径不变
  - 「清单后到」必须用 **rerender 传入新 definition** 显式构造时序，禁止依赖任何真实网络时机或定时器——这是竞态类缺陷唯一可信的验证方式
  - 「存量污染」用例预置的快照必须是**旧格式**（不含 `knownPaneIds`），否则测不到降级路径
  - 观察点：`node scripts/scoped-test.mjs packages/panes-kit/test/panes-host.test.tsx` 退出码 0；且先确认这些新用例在**未打补丁的代码上会红**，再信它们在补丁后报的绿
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Boundary: PanesHost 集成测试 — `packages/panes-kit/test/panes-host.test.tsx`_
  - _Depends: 2.2, 3.1_

- [ ] 5. 真机验证

- [x] 5.1 aigc-agent 与 panes-agent 双向实机验证
  - 清空 `pi-web:aigc-studio:panes:*` 后进入 aigc-agent 会话，确认 `search` / `materials` / `canvas` / `logs` 四个 pane 全部打开
  - **必须复测 reload**：排查期间曾出现「新建会话偶然全开、reload 又打回 host-only」，只测一次进入会漏掉竞态
  - 以 panes-agent 作对照，确认构建期静态装载车道的三个 pane 行为与修复前一致
  - 观察点：两个 agent 各自 reload 两次后 pane 集合稳定不变；浏览器 console 无新增错误
  - _Requirements: 1.2, 4.1, 5.4_
  - _Boundary: 真机验证（不改代码）— 无写入_
  - _Depends: 4.1_

- [ ] 6. 回归

- [x] 6.1 全量回归与算术核对
  - 跑 `pnpm test` **和** `pnpm test:app` 两条（steering 明示：只跑其一会漏掉子包的红，而它看起来和全绿一模一样）
  - 对每个汇总行核对 `failed + passed + skipped === 总数`，文件数与用例数各算一遍；不相等即存在静默漏跑的文件，须用差集法定位
  - 跑 `pnpm typecheck`
  - 观察点：两条测试命令退出码均为 0、算术全部自洽、typecheck 0 error；与修复前的基线相比无新增失败
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: 回归验证（不改代码）— 无写入_
  - _Depends: 5.1_
