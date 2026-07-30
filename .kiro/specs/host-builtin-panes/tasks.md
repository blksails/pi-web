# Implementation Plan — host-builtin-panes

> 阶段顺序:Foundation(构建管道与契约位)→ Core(合并原语、内置 pane 内容)→
> Integration(宿主装载与 agent 声明路径)→ Validation(判据矩阵与真机取证)。
>
> ★ 全局取证纪律(design 7.3/7.4):组件级测试全绿**不构成**达标 —— 既有前科是
> panes-kit 单测 31/31 绿而真实浏览器 4 套 e2e 全红。每条「不应出现」类断言,必须先证明
> 它在缺陷存在时会报红,否则「正确地没出现」与「判据根本没装上」在观察上无法区分。

- [ ] 1. Foundation:内置 pane 构建管道与 agent 声明契约

- [x] 1.1 (P) 建立内置 pane guest 的构建管道
  - 新增构建脚本,把内置 pane 的 guest 源码打成自足的内联文档字符串,形态镜像既有
    `build-webext-examples` 脚本(同样的 esbuild + 内联 CSP meta 模式)
  - **按目录扫描**内置 pane 的 guest 入口,无 pane 时产出空映射 —— 使本任务不依赖 3.1 的
    guest 源码即可独立完成,也落实「新增内置 pane = 加一个目录」的纪律
  - 产物**不入库**:构建完即用,类型侧由类型垫片兜住,使类型检查不依赖构建产物
  - 把构建挂到既有客户端构建链之前,使正常构建流程自动产出
  - 内联文档的内容安全策略只允许内联 style/script,其余一律禁止
  - 可观察完成:执行构建命令后产出内置 pane 的文档产物并打印其路径;删除产物后类型检查
    仍通过(证明垫片生效);产物路径已被版本忽略规则覆盖
  - _Requirements: 6.1_
  - _Boundary: 构建管道 — `scripts/build-builtin-panes.ts`, `panes/generated.d.ts`, `panes/README.md`, `package.json`, `.gitignore`_

- [x] 1.2 (P) 为 agent 增加可被宿主枚举的 pane 声明键
  - 在 web extension 契约上新增可选的 pane 声明键,宿主对其领域中立:只搬运与合并,
    不解析 pane 内部语义(形态照抄既有 canvas 插件捆声明键)
  - 文档注明它与既有右侧面板槽的互斥语义:同时声明时旧槽优先、本键被忽略
  - 该键可选,既有扩展零改动仍按旧槽路径工作
  - 可观察完成:一个声明该键的扩展描述符通过类型检查,且宿主侧能读到该声明的内容
  - _Requirements: 2.2_
  - _Boundary: WebExtension 契约 — `packages/web-kit/src/define-web-extension.ts`_

- [ ] 2. Core:pane 来源合并原语

- [x] 2.1 实现来源合并的顺序与上限合成
  - 实现纯函数:接受若干 pane 来源(每个来源带类型、来源标识、定义),输出单一合并定义
  - 顺序权威:内置来源在前、agent 来源在后;输出顺序只由输入顺序决定,不受装载时序影响
  - 同时打开上限取各来源声明值的**最大者**,使 agent 原有可同时打开数量不因内置加入而缩水
  - 初始打开集合:agent 的集合完整保留;内置的默认打开项仅在追加后不超上限时追加,
    超出则丢弃**内置的**而非 agent 的
  - 结构合法性一律交既有定义校验函数,不自建第二套校验
  - 可观察完成:单测证明交换输入来源顺序不改变各来源内部的相对顺序;上限取最大者;
    越界时被丢弃的是内置默认项
  - _Requirements: 1.6, 2.1, 2.3, 2.4, 2.5_
  - _Boundary: mergePaneSources — `packages/panes-kit/src/merge.ts`, `packages/panes-kit/test/merge.test.ts`_

- [x] 2.2 实现保留命名空间与冒用拒绝
  - 定义内置 pane 标识的保留前缀常量,使内置与 agent 的标识在结构上不可能相同
  - agent 来源中使用该前缀的 pane 被淘汰并记入拒绝清单,**该来源其余合法 pane 仍保留**(不连坐)
  - 内置来源的 pane 必须使用该前缀,违反者同样被淘汰并记录
  - agent 的 pane 永不覆盖、遮蔽或改写同标识的内置 pane
  - 可观察完成:单测证明 agent 冒用前缀时该 pane 消失、同来源其余 pane 存活、拒绝清单含被拒
    pane 的标识与原因;另有一条用例证明内置项漏前缀也会被拒
  - _Requirements: 3.1, 3.2, 3.3_
  - _Boundary: mergePaneSources — `packages/panes-kit/src/merge.ts`, `packages/panes-kit/test/merge.test.ts`_

- [x] 2.3 实现逐来源校验与分级降级
  - 逐来源单独校验后再整体校验 —— 否则无法区分「哪个来源非法」,诊断会指错
  - 单个来源整体非法只淘汰该来源;某内置项非法只淘汰该项,其余内置仍保留
  - 全部来源被淘汰时返回空定义,由调用方落到「面板整体不渲染」的分支
  - 拒绝清单每条含来源标识、来源类型、被拒范围、原因与可读细节;合并函数自身**不打日志**
    (保持纯函数,诊断由调用方输出)
  - 可观察完成:单测证明 agent 来源整体非法时仍返回仅含内置的合法定义;某内置项非法时其余
    内置仍在;全部非法时定义为空且拒绝清单完整
  - _Requirements: 5.4, 7.1, 7.2_
  - _Boundary: mergePaneSources — `packages/panes-kit/src/merge.ts`, `packages/panes-kit/test/merge.test.ts`_

- [x] 2.4 导出合并原语与命名空间常量
  - 从 panes-kit 包入口导出合并函数、保留前缀常量与相关类型
  - 可观察完成:从包入口(而非深路径)导入合并函数与前缀常量可通过类型检查
  - _Requirements: 2.2, 3.1_
  - _Boundary: panes-kit 出口 — `packages/panes-kit/src/index.ts`_

- [x] 2.5 把协议常量从 schema 模块抽出,使 guest bundle 不再内联 zod
  - **实测根因**(本任务由实现期发现,非原计划):guest SDK 从 schema 模块 import 一个
    `= 1 as const` 的协议版本常量,而该模块顶层是一串 `z.object({...})` 副作用表达式 ——
    打包器不敢摘,于是**只导入一个常量就拖进约 62KB 的 zod**。实测:barrel 与深路径导入
    都是 65KB,单独 import 该常量仍是 62KB,可见与 barrel 无关
  - 把该常量(及其同类纯常量)移到一个**零依赖**的小模块,schema 模块与 guest SDK 都从那里取;
    schema 模块 re-export 以保持既有导入点零破坏
  - 为什么现在做:内置 pane 的文档是**内联进宿主 bundle 的字符串**,下游还要加 3–4 个内置
    pane,每个都会重复内联一份 zod。留到下游等于把一个已知的体积问题乘以 4
  - 可观察完成:同一份 guest 探针的 bundle 体积从约 65KB 降到不含 zod 的量级,且产物中
    `ZodError` 出现次数为 0;panes-kit 既有测试与类型检查不回退
  - _Requirements: 6.1_
  - _Boundary: panes-kit 协议常量 — `packages/panes-kit/src/protocol-version.ts`, `packages/panes-kit/src/contract.ts`, `packages/panes-kit/src/guest.ts`, `packages/panes-kit/src/index.ts`_

- [ ] 3. Core:最小内置 pane 与宿主清单

- [x] 3.1 (P) 实现会话信息 pane 的 guest 侧
  - guest 入口连接宿主通道,订阅承载会话信息的具名信号并渲染会话标识、agent 源、工作目录
  - **对信号载荷做运行期校验**:字段缺失时显示空态而非崩溃 —— 通道返回值的泛型是断言不是校验,
    同类缺陷已在既有 pane 迁移中出现过(错误体被当正常结果解构,整个 pane 被卸载)
  - guest 代码不从宿主 realm 引入任何东西(它跑在独立 realm)
  - ★ 校验与渲染抽到**零副作用**的视图模块,入口只做接线 —— 入口顶层有 `void main()`,
    import 它就会尝试建连,测试无从引用;而「缺字段不把 pane 打死」恰恰是最该被测的行为
  - 可观察完成:构建后的文档在浏览器中打开能完成握手并显示传入的会话信息;喂入缺字段的
    信号时显示空态且不卸载
  - _Requirements: 6.2, 6.3_
  - _Depends: 1.1_
  - _Boundary: session-info guest — `panes/session-info/main.tsx`, `panes/session-info/view.ts`, `test/panes/session-info-view.test.ts`_

- [x] 3.2 建立内置 pane 单一权威清单与会话信号组装
  - 建立内置 pane 清单:**新增内置 pane = 加一个文件 + 清单加一行**(镜像内置扩展清单纪律)
  - 会话信息 pane 的定义使用保留前缀标识,`capabilities` **全空** —— 它不需要任何授权,
    同时充当「内置身份不提权」的活体证据
  - 组装会话信息为具名信号载荷(会话标识、agent 源、工作目录);不含凭据
  - 清单为空时来源组装返回空,使装载判据落到「面板整体不渲染」分支
  - 门控若将来需要,应落各 pane 定义内部(能力不可用时自行降级),**不落清单** ——
    清单按条件过滤会重新引入「某形态下静默缺失」
  - 可观察完成:清单含且仅含会话信息 pane;单测证明清单内每项标识均带保留前缀;
    清单置空时来源组装返回空
  - _Requirements: 1.1, 6.1, 7.2_
  - _Depends: 3.1, 2.2_
  - _Boundary: 内置清单 — `lib/app/builtin-panes/index.ts`, `lib/app/builtin-panes/session-info.ts`, `lib/app/builtin-panes/session-signal.ts`, `test/panes/builtin-panes-manifest.test.ts`_

- [ ] 4. Integration:宿主侧装载

- [x] 4.1 改写面板启用判据并接受宿主 pane 定义
  - 会话外壳接受宿主 pane 定义与宿主具名信号两个入参;对 pane 内容零认知
  - 把面板启用判据从「agent 是否声明右侧面板槽」改为「宿主内置非空 ∨ agent 有 pane 贡献」
  - ★ **同一判据有两处**:面板容器与内容区各算一份,还有一处控制**空闲控制流**是否开启 ——
    漏改后者会表现为「pane 起来了、能力也对,但 agent 快照永不更新」,这是既有缺陷症状族
  - 面板宽度调整与比例切换沿用既有逻辑,不另写
  - 合并必须是渲染期纯计算,不可放进副作用 —— 否则首帧无定义,宿主组件会以空定义建连,
    产生一次无效握手
  - 可观察完成:宿主定义非空且 agent 无任何贡献时,面板容器、显示/隐藏开关、比例切换器出现;
    宿主定义为空且 agent 无贡献时三者均**不**出现且与改动前逐字一致
  - _Requirements: 1.1, 1.3, 1.5, 1.7_
  - _Depends: 2.4_
  - _Boundary: 会话外壳判据 — `packages/ui/src/chat/pi-chat.tsx`_

- [x] 4.2 实现装载点的双路径分派与注入等价
  - agent 声明了旧槽 → 走旧槽路径,内置 panes 让位,并输出说明迁移途径的诊断
  - 否则 → 渲染宿主 pane 组件,定义取自合并结果
  - ★ **两条路径注入同一批能力**(共享状态、agent 状态访问、上传、基址、会话标识、轮末同步
    信号、会话能力对象、宿主具名信号)—— 少任何一项都是一个静默失效面
  - 合并产生的拒绝清单经既有日志输出,每条含来源标识与 pane 标识;时机在会话装载期,
    不得推迟到用户点开 pane
  - 可观察完成:声明旧槽的 agent 走旧路径且产生迁移诊断;不声明旧槽时渲染宿主 pane 组件;
    两条路径的注入项逐项一致
  - _Requirements: 1.2, 5.1, 5.2, 5.3, 3.4, 7.1_
  - _Depends: 4.1_
  - _Boundary: 会话外壳装载点 — `packages/ui/src/chat/pi-chat.tsx`_

- [x] 4.3 会话装配侧同步判据并注入内置清单
  - 外层容器的同名启用判据同步改写 —— 与内层不同步会导致「外层容器与内层内容一个显示
    一个不显示」
  - 把内置清单与会话信号经入参传给会话外壳
  - 可观察完成:内外两层判据在四种输入组合(内置有无 × agent 贡献有无)下结论一致
  - _Requirements: 1.1, 1.7_
  - _Depends: 3.2, 4.1_
  - _Boundary: 会话装配 — `components/chat-app.tsx`_

- [ ] 5. Integration:agent 声明路径验证

- [x] 5.1 把 panes 示例 agent 迁到新声明键
  - 该示例改用可枚举的 pane 声明键,不再自行渲染右侧面板槽 —— 用它验证合并路径真的通
  - ★ **刻意不动** canvas 示例:保留其旧槽形态作为「既有形态不回退」的活体回归守卫。
    两个都迁则旧槽路径再无活的测试守着
  - 可观察完成:该示例的 pane 与内置 pane 同时出现在同一面板,顺序为内置在前;
    该示例既有的 pane 功能行为不变
  - _Requirements: 2.1, 2.2_
  - _Depends: 1.2, 4.2_
  - _Boundary: panes 示例 — `examples/panes-agent/web/web.config.tsx`_

- [ ] 6. Validation:判据矩阵与真机取证

- [x] 6.1 (P) 装载判据的组件级矩阵测试
  - 覆盖四种输入组合:内置有无 × agent 贡献有无,断言面板容器/开关/比例切换器的出现与否
  - ★ 「不应出现」这条必须先证明其判别力:构造一个判据写错的形态,确认该用例会报红。
    否则「正确地没出现」与「判据根本没装上」观察上同形
  - 断言宿主定义为空时的外观与改动前逐字一致
  - 可观察完成:矩阵四格全绿,且判别力自证记录在案(篡改判据时对应用例报红)
  - _Requirements: 1.1, 1.7_
  - _Depends: 4.3_
  - _Boundary: 判据测试 — `packages/ui/test/chat/host-panes-gating.test.tsx`_

- [ ] 6.2 (P) 注入等价性与分派测试
  - 逐项比对两条路径注入的能力集合,缺任一项即报红
  - 断言声明旧槽的 agent 走旧路径、内置让位、且产生迁移诊断
  - 断言拒绝清单在会话装载期即输出,而非用户点开 pane 时
  - ★ **镜像与 canonical 的双向可赋值断言**:web-kit 的 pane 声明键是 panes-kit 定义的最小
    结构镜像(两包刻意无依赖边),故防漂移断言只能落在同时依赖两者的这一层 —— 与既有 canvas
    插件捆在 canvas-ui 聚合处断言同理。漂移的表现是 agent 作者无法把 `definePanes()` 的产物
    赋给声明键,而那在两包各自的测试里都看不见
  - 可观察完成:注入项清单以数据驱动方式断言(新增注入项若忘记接到宿主路径会自动报红);
    让位与诊断各有独立用例;双向断言在任一侧类型收窄时报红
  - _Requirements: 1.2, 5.2, 5.3, 3.4, 7.1_
  - _Depends: 4.3_
  - _Boundary: 分派测试 — `packages/ui/test/chat/host-panes-dispatch.test.tsx`_

- [ ] 6.3 (P) 内置身份不提权测试
  - ★ 测试**用带保留前缀的夹具 pane**,不引入真实内置清单 —— panes-kit 不得反向依赖 app 层
    (依赖方向:panes-kit → ui → app);夹具足以证明「前缀不产生特权」这个性质
  - 零授权的夹具 pane 发起受管操作被拒,拒绝载荷与无前缀 pane 在相同情形下逐字一致
  - 断言保留前缀不出现在任何授权判定条件中(带前缀与不带前缀的 pane 走同一路径、同一结果)
  - 断言两个 pane 同时在世时互不可见对方运行环境
  - 可观察完成:三条断言各自独立用例;若有人给保留前缀加了特权分支,「拒绝载荷逐字一致」
    这条会报红
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Depends: 2.2_
  - _Boundary: 授权测试 — `packages/panes-kit/test/builtin-identity-no-escalation.test.ts`_

- [x] 6.4 真实浏览器端到端取证(四种组合)
  - 组合一:**不带 web extension 的 agent** — 打开会话 → 右侧面板可见 → 点开会话信息 pane →
    显示真实会话标识。这是本 spec 的核心验收路径
  - 组合二:**cli 模式 agent** — 同上链路成立
  - 组合三:**带新声明键的 agent** — 内置与 agent pane 同时出现、内置在前、两者都能正常建连
  - 组合四:**带旧槽的 canvas agent** — 行为与本 spec 实施前一致
  - ★ 四种组合**各自**须有独立证据;仅在其中一种上取证不构成覆盖
  - 可观察完成:四条 e2e 用例在真实浏览器中通过,并留下每条的运行证据(截图或断言输出)
  - _Requirements: 1.2, 1.3, 1.4, 5.1, 5.3, 6.2, 7.3, 7.4_
  - _Depends: 5.1, 6.1, 6.2_
  - _Boundary: e2e — `e2e/browser/host-builtin-panes.e2e.test.ts`_

- [ ] 6.5 全量回归与既有 panes 不回退核验
  - 跑全部测试面(含各子包)与类型检查;核对汇总行算术(passed+skipped 是否等于总数)——
    worker 静默崩溃会伪装成「0 failed」
  - 专项核验 canvas 示例与 panes 示例的既有 pane e2e 仍通过
  - 可观察完成:类型检查退出码 0;全部测试面退出码 0 且汇总算术自洽;既有 pane e2e 全绿
  - _Requirements: 5.1, 5.2, 5.3, 7.3_
  - _Depends: 6.4_
