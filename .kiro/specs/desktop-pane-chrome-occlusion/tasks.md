# Implementation Plan

> ★ **顺序上的一条硬约束：诊断必须在行为改动之前。**
> 本缺陷的真实触发条件尚未定位（`research.md` 主题四列了 C1/C2/C3 三个候选）。若先做结构性修复，
> 降级面被整体消除，触发条件也就永远无法再被观测——需求 4.4 将变成一句无法回答的话。
> 所以第 1 组先把六个静默点变成可取证，在真机上判别一次，**再**动行为。
>
> ★ **「跑绿」不构成证据。** 每条新增断言写完后须先在未修复的代码上运行并确认其报红（需求 6.4）。
>
> 测试命令按 steering 分档：实现者用 `node scripts/scoped-test.mjs <paths>`；
> Rust 侧用 `cargo test`（在 `desktop/src-tauri/`）；复查者跑 `pnpm test` **+** `pnpm test:app` **+** `pnpm typecheck`。

- [ ] 1. 可观测性先行

- [x] 1.1 (P) 宿主侧量槽与上报改为可判别的三态并留痕
  - 量槽结果由「裸 `undefined`」改为带拒绝原因（detached / 过小 / 未布局）与实测 rect 的判别联合——现状把「没量到」与「量到 0」压成同一个值，是本缺陷查不出来的直接原因
  - 上报失败不再无声：既不吞掉也不让异步拒绝逃逸，留下含原因的记录
  - native 几何门查询由「压成 `false`」改为三态：是 native / 非 native / 查询失败，三者各自留痕——现状把「命令报错」和「本来就不是 native」混成同一个值
  - 观察点：三种拒绝原因各自能在测试中取到具体 reason；「查询失败」与「非 native」在返回值上可区分，不再需要读代码才能分辨
  - _Requirements: 3.1, 3.2_
  - _Boundary: 量槽器与上报器 — `packages/panes-kit/src/adapters/tauri-runtime.ts`, `packages/panes-kit/test/pane-slot-geometry.test.ts`_

- [x] 1.2 (P) 布局侧校验拒绝留痕，并提供当前生效几何的读取途径
  - 几何校验拒绝时记录被拒数值与拒绝原因；现状只返回错误，调用侧无回执
  - 提供一条能取得「当前实际生效的槽位几何」的途径，使维护者不必靠读代码反推
  - 诊断须在不重新编译的前提下可开启（沿用仓库既有日志约定，默认关闭）
  - 观察点：真机开启诊断后能直接读到当前顶边的实际取值，而不是只能猜它是不是 0
  - _Requirements: 3.3, 3.4, 3.5_
  - _Boundary: 几何校验器 — `desktop/src-tauri/src/native_layout.rs`_

- [x] 1.3 真机跑一次诊断，判别三个候选触发条件
  - 打包并运行桌面版，装载一个声明多个 pane 的 agent，开启诊断收集几何链路各环取值
  - 对照 `research.md` 主题四的判别表，判定实际断在 C1（载体/几何门分叉）、C2（首帧量槽失败）还是 C3（校验拒绝）
  - 观察点：能明确指出几何链路断在哪一环并附诊断输出；若加诊断后问题不再复现，**如实记为不可复现**并写明依据，不得以「已修复」含混带过
  - _Requirements: 4.4_
  - _Boundary: 视觉验收记录 — `.kiro/specs/desktop-pane-chrome-occlusion/visual-acceptance.md`_
  - _Depends: 1.1, 1.2_

- [ ] 2. 让「未知」可表达

- [x] 2.1 顶边改为可选，解算器提纯并引入「不显示」语义
  - 顶边字段由必填浮点改为可选，与同结构体的左缘、槽宽语义对齐——「未知」不再坍缩成 `0.0`
  - 内容槽解算结果区分「可显示的矩形」与「无可显示内容槽」，后者不是宽高为零的矩形（那仍会被落位流程当矩形用）
  - 解算改为不依赖窗口句柄的纯函数，使其可被断言——现状产生遮挡矩形的兜底分支埋在落位流程内，结构上跑不到测试里
  - 移除「槽过小则回落到从窗口顶端铺满」这一兜底；子 WebView 首建位置同样受「未知」约束，不再以默认矩形创建
  - 所有既有消费点因可选化在编译期暴露，逐个显式处置；**禁止用 `unwrap_or(0.0)` 糊过去**——那会原样恢复本缺陷
  - 观察点：该文件内 `unwrap_or(0.0)` 零命中；几何未知时解算结果为「不显示」，且全屏模式行为不变
  - _Requirements: 2.1, 2.2, 2.5, 4.1, 5.2, 5.4_
  - _Boundary: 槽位解算器与几何校验器 — `desktop/src-tauri/src/native_layout.rs`_
  - _Depends: 1.2_

- [x] 2.2 解算器穷举断言，含反序列化缺字段一项
  - 顶边未知 + 工作区模式 → 恒为「不显示」，且对多组窗口尺寸都成立（该输入当前零覆盖，是本 spec 的核心断言）
  - 顶边已知 → 产出的矩形顶边不小于该值
  - 全屏模式无论几何如何 → 「不显示」（锁 5.2 不回归）
  - 上报载荷缺顶边字段时反序列化为「未知」而非 `0`——缺了这条，可选化会被序列化默认值悄悄抵消
  - 观察点：`cargo test` 通过；且**先确认这些断言在未改动的代码上会红**，再信它们报的绿
  - _Requirements: 6.1, 6.2, 6.4, 5.2_
  - _Boundary: 槽位解算器单测 — `desktop/src-tauri/src/native_layout.rs`_
  - _Depends: 2.1_

- [x] 2.3 上报载荷与可选顶边对齐
  - 未量到顶边时不发送该字段，而非发送 `0`——否则布局侧收到的仍是一个"确定的 0"，可选化形同虚设
  - 保持既有单路 rAF 合并与近似去重不变（5.1 的基线在此）
  - 观察点：未量到时的载荷中不含顶边字段；量到时逐字段与改动前一致
  - _Requirements: 2.1, 4.1_
  - _Boundary: 上报器 — `packages/panes-kit/src/adapters/tauri-runtime.ts`, `packages/panes-kit/test/pane-slot-geometry.test.ts`_
  - _Depends: 1.1, 2.1_

- [ ] 3. 显示时机门控（跨边界集成）

- [x] 3.1 显示前置条件扩为「几何已送达」，并在几何迟到后自动落位
  - `show` 的前置由「chrome 未折叠」扩充为「chrome 未折叠**且**几何已送达」；现状是量不到也照样显示
  - 未送达时不显示，并安排在布局完成后重量重报；几何转为可用后自动落位，不需要用户操作
  - 降级态下 chrome 保持可见可交互，「新开 Pane」可用
  - 网页宿主路径完全不经过本门控，逐字段不变
  - 观察点：几何未送达时 pane 不显示且 chrome 可交互；随后几何可用时 pane 自动落到正确位置，全程无需用户操作
  - _Requirements: 1.4, 2.3, 2.4, 4.2, 4.3, 5.3_
  - _Boundary: 宿主几何门控 — `packages/panes-kit/src/react/panes-host.tsx`, `packages/panes-kit/test/pane-slot-geometry.test.ts`_
  - _Depends: 2.3_

  - ✅ 已补上（任务 4.1）：把判定抽成纯函数 `shouldShowNativePane` 后穷举断言，8 条，
    红对照双向通过（删几何条件红 2 条、把「与」写成「或」红 4 条）。以下是此前两次失败的记录，
    保留以免重蹈：`pane_layout_is_native` 返回 true 时，内容 pane 在 jsdom 下压根不会被创建
    （relayListeners 已就绪、overlay-ready 已发，`created` 仍为 0），握手走不完就到不了
    show 那一步。初版还写成了重言式——把门控整个删掉照样跑绿，红对照当场抓出。
    已删除该用例而非留一条假绿。这条缺口由真机视觉验收（4.3）兜底，或另开一个
    「native pane 在 jsdom 下的可测性」的口子解决。

- [ ] 4. 回归与验收

- [x] 4.1 跟手与既有路径回归断言
  - 拖拽路径的合并与去重调用次数与改动前一致——**以调用计数断言，不以耗时断言**（耗时在 CI 上不可复现）
  - 网页宿主路径与浮层叠放、焦点表现逐字段不变
  - 观察点：调用计数与改动前基线相等；网页宿主与浮层相关既有用例无新增失败
  - _Requirements: 5.1, 5.3, 5.4_
  - _Boundary: 上报器与宿主几何门控回归 — `packages/panes-kit/test/pane-slot-geometry.test.ts`_
  - _Depends: 3.1_

- [x] 4.2 全量回归与算术核对
  - 跑 `pnpm test` **和** `pnpm test:app` 两条；对每个汇总行核对 `failed + passed + skipped === 总数`，文件数与用例数**各算一遍**
  - 跑 `pnpm typecheck`；在 `desktop/src-tauri/` 跑 `cargo test`
  - 与改动前基线比对：根面已知 2 个既存红（`webext-slots-runtime.integration`、`publish-preview`），不得把它们算成新增，也不得拿它们掩盖新增
  - 观察点：四条命令退出码 0（既存红除外）、算术自洽、无新增失败
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Boundary: 回归验证（不改代码）— 无写入_
  - _Depends: 4.1_

- [~] 4.3 真机视觉验收（★ 验收条件已被 1.3 证伪，见 visual-acceptance.md）
  - 打包桌面版，装载声明多个 pane 的 agent；截图须**同时**可见 tab 栏与 pane 内容，且可据图数出已打开的 pane 数
  - 覆盖四种情形各一张：初次打开、切换 pane、拖拽面板宽度中、窗口尺寸变化后
  - 截图按 `vaN-<情形>.png` 编号存档并在验收记录中索引（沿用 `agent-web-extension-visual-acceptance` 的证据约定）
  - 观察点：四张截图中 tab 栏均可见；点击「新开 Pane」能真的开出一个新 pane（不是只弹出菜单）
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 6.3, 6.5_
  - _Boundary: 视觉验收记录 — `.kiro/specs/desktop-pane-chrome-occlusion/visual-acceptance.md`_
  - _Depends: 4.2_

- [x] 4.4 触发条件结论落档
  - 把 1.3 的判别结果写成结论：实际触发条件是什么，结构性修复如何覆盖它；或如实记录不可复现及其依据
  - 记录本轮**未**处理但已识别的相邻问题（载体门与几何门是否应合并——本 spec 边界外）
  - 观察点：验收记录里对「真实触发条件」有一个明确答复，而不是留白
  - _Requirements: 4.4_
  - _Boundary: 视觉验收记录 — `.kiro/specs/desktop-pane-chrome-occlusion/visual-acceptance.md`_
  - _Depends: 4.3_
