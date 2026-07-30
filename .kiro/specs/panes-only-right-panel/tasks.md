# Implementation Plan — panes-only-right-panel

> 阶段顺序不可换(design Migration Strategy):补能力 → 迁低成本者 → 迁 state-bridge →
> 迁 canvas 系 → 删除与收尾。删除必须最后,且以机械核验为前置。
>
> ★ 全局纪律:**本波最大的假绿来源是「删断言换绿」**。每个迁移任务必须逐条列出
> 「原断言 → 新断言」的对应;断言的载体可换,**保护面不可缩**。
> 每条「不应出现」类断言须先证明判别力(篡改实现确认报红)——删除类改动尤其危险,
> 「正确地没有了」与「守卫根本没装上」在观察上同形。
>
> ★ 存量红基线:`attachment-tool-bridge`×1 + `desktop-cloud-login`×5 已实测为基线失败
> (基线 `efa3bd9e` 同样红)。不得计为本波回归,**也不得作为放宽验收的理由**。

- [ ] 1. Foundation:能力补齐(B 类迁移的前置)

- [x] 1.1 扩展 pane 协议:共享状态的读/订阅授权与写回操作
  - 请求判别式增写回操作(设置与删除);能力结构增**读键表与写键表两张**——
    读授权不得蕴含写授权(写是显著更强的权力,不该被顺带捎上)
  - 授权判定复用既有结构化错误,**不另立一套**:未授权 → 能力被拒;超限 → 载荷过大
  - ★ 键越权拒绝**不得泄露该键是否存在**:"未授权"与"键不存在"返回**逐字相同**的载荷
  - 可观察完成:单测覆盖读/写授权分离、越权读、越权写、键不在授权内;
    且有一条断言证明两种拒绝载荷逐字一致
  - _Requirements: 2.5, 2.6, 2.7, 2.8_
  - ★ 边界实际外扩一处(实施期发现):`conversation.submit` 原本靠「排除其余全部 operation」
    收窄,新增两个 operation 后收窄失效 —— 类型检查红而 vitest 绿。故 `panes-host.tsx` 必须
    同步加写回分支与 `state` 入参,不能留到 1.2。
  - _Boundary: 协议与授权 — `packages/panes-kit/src/contract.ts`, `packages/panes-kit/src/authorization.ts`, `packages/panes-kit/src/react/panes-host.tsx`, `packages/panes-kit/test/state-authorization.test.ts`_

- [x] 1.2 实现共享状态的宿主侧绑定(★ 含换身份重绑)
  - 逐授权键读取当前值并订阅,经下行帧推送;形态镜像既有 surface 绑定
  - ★ **访问器换身份 → 所有在世连接整组重绑,且重绑时立即重推当前值**。这不是优化项:
    宿主访问器由 useMemo 依赖会话连接构造,就绪握手与控制流重开都会换出新实例,新实例读的是
    **新的** store;建连那一刻的订阅挂在旧 store 上此后永不触发。症状是「pane 起来了、能力也
    对,但值永远是空的」,且极易被误判成 agent 没发数据 —— 既有实现为此写了整段注释,是前科
  - 立即重推同时覆盖「建连早于首帧数据到达」的竞态
  - 可观察完成:单测证明逐键推送、订阅到变化、未授权键不推送;
    ★ 有一条独立用例构造「访问器换身份」并断言在世连接收到重推
  - _Requirements: 2.1, 2.2, 2.4_
  - _Depends: 1.1_
  - _Boundary: 宿主绑定 — `packages/panes-kit/src/state-binding.ts`, `packages/panes-kit/src/react/panes-host.tsx`, `packages/panes-kit/test/state-binding.test.ts`_

- [x] 1.3 guest SDK 增共享状态门面
  - 提供读、订阅、写回、删除四个操作,签名与宿主侧既有共享状态访问器保持一致,
    使迁移方只改取得途径、不改调用形状
  - ★ 不得因此把 schema 模块拖进 guest bundle(既有前科:只导入一个常量就内联了整个校验库)
  - 可观察完成:guest 探针 bundle 不含校验库标识;门面四操作各有单测
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 1.1_
  - _Boundary: guest SDK — `packages/panes-kit/src/guest.ts`, `packages/panes-kit/test/guest.test.ts`_

- [x] 1.4 (P) 宿主环境信号族:主题与对话流焦点
  - 主题明暗由宿主权威状态计算并推送,agent 不再自行观察 DOM
  - 对话流内可聚焦元素被点击时以**领域中立**形式通知,通知内容足以识别被点击对象
  - ★ **连点同一目标两次必须都触达**:下行具名信号是「最后值即真值」,值不变不重推。
    既有示例靠附加递增序号规避,宿主内置化时须自带等效语义
  - ★ 信号名与实现**不得含任何领域词汇** —— 会话外壳有领域中立守卫,含领域词会直接报红
    (本作者上一轮已被它拦过一次)
  - 「悬浮态可点」的样式钩子一并移交宿主并中立化(它当前由示例打在宿主根元素上)
  - 可观察完成:单测覆盖主题切换传播、连点两次都触达、信号名零领域词;
    领域中立守卫在改动后仍绿
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - _Boundary: 宿主信号族 — `packages/ui/src/chat/host-signals.ts`, `packages/ui/src/chat/pi-chat.tsx`, `packages/ui/test/chat/host-signals.test.tsx`_

- [x] 1.5 (P) 抽出可复用的 pane 文档构建函数
  - 把「画布组件 + 自选插件集 → 自足产物 + 内联样式 → 带内容安全策略的文档」抽成一个函数,
    调用方传入自己的插件集
  - 理由:两个 source 迁移后都需要这条同样的流水线,各抄一份是可预见的漂移源
    (两份安全策略、两份样式内容配置)
  - 产物**不入库**,类型侧由垫片兜住(沿用既有纪律)
  - 可观察完成:既有画布 source 改用该函数后产物行为不变;删除产物后类型检查仍通过
  - _Requirements: 4.1, 4.5_
  - _Boundary: 构建函数 — `packages/canvas-ui/src/build-canvas-pane.ts`, `examples/aigc-canvas-agent/build.ts`_

- [ ] 2. Integration:迁低成本声明者

- [ ] 2.1 (P) 槽车道夹具改挂其余保留槽
  - 五个夹具(多槽渲染、运行时代码、签名有效/无效/被篡改)改用其余任一保留槽承载
  - ★ 它们守的是**槽机制本身与签名校验**,与面板形态无关;右侧面板槽只是 19 个保留槽之一
  - ★ 保护面不可缩:签名无效与内容被篡改两种拒绝情形的用例**一条都不能少**
  - 可观察完成:相关 e2e 全绿;逐条列出「原槽 → 新槽」对应,且断言语义未变
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: 槽夹具 — `examples/webext-layout-agent/`, `examples/webext-slots-agent/`, `examples/webext-runtime-code-agent/`, `examples/webext-slots-runtime-{,badsig-,tampered-}agent/`_

- [ ] 2.2 (P) 迁 surface 演示 source 为 pane
  - ★ **纯 UI 改写,零协议工作**:该示例用的读快照/订阅/执行命令/探测可用性四件套,
    guest SDK **已全部具备**(勘察 I4 修正了 brief 中「中高成本」的预判)
  - 保留其能力退化路径:会话未就绪或命令不可用时的降级表现不变
  - 可观察完成:该 source 的既有 e2e 全绿,逐条列出「原断言 → 新断言」
  - _Requirements: 1.1, 5.1, 5.2, 5.3_
  - _Depends: 1.4_
  - _Boundary: surface 演示 — `examples/surface-demo-agent/`, `e2e/browser/agent-authoritative-surface.e2e.ts`_

- [ ] 3. Integration:迁共享状态声明者(新通道的活体验证)

- [ ] 3.1 迁状态桥 source 为 pane
  - 该示例是**唯一**真正需要新通道的声明者:它演示「人在面板点 +1 → agent 工具下次读到新值」
    的人机共驾闭环,单向信号结构上无法承载
  - 它同时是任务 1.1–1.3 的活体验证 —— 通道做错了这里会直接暴露
  - ★ 验收必须包含**跨边界闭环**的独立断言:仅断言面板显示了数字不构成覆盖,
    必须验证写回后 agent 侧读到新值
  - 可观察完成:该 source 的既有 e2e 全绿;新增一条写回闭环断言
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.1, 5.4_
  - _Depends: 1.2, 1.3_
  - _Boundary: 状态桥 — `examples/state-bridge-agent/`, `e2e/browser/state-bridge.e2e.ts`_

- [ ] 4. Integration:迁画布系三个声明者

- [ ] 4.1 画布 source 的包装层两处逻辑分别下沉与内置化
  - ★ 该包装层**不是纯包装**(这是既有 spec「刻意不动它」的真因):它带两处宿主 realm 逻辑
  - **轮末自动同步下沉进 pane 内部**:guest 本就能执行 surface 命令,且轮末同步信号已由宿主
    推入 pane ⇒ 宿主侧代发那段随之消失
  - **主题与焦点改用任务 1.4 的宿主信号族**
  - 完成后该 source 改用 pane 声明键,不再自行实例化面板宿主
  - ★ **轮末自动同步是有前科的静默失效面**:断链后表现仅仅是「生成了但没刷新」,
    极易被当成后端问题。验收须有独立断言直接检查同步结果
  - 可观察完成:该 source 的既有 e2e 全绿,其中轮末同步那条**保持为独立断言**
  - _Requirements: 1.1, 3.1, 3.3, 5.1, 5.4_
  - _Depends: 1.4, 1.5_
  - _Boundary: 画布 source — `examples/aigc-canvas-agent/web/web.config.tsx`, `examples/aigc-canvas-agent/build.ts`_

- [ ] 4.2 (P) 迁无 surface 的画布降级 source
  - 该 source 演示「贡献面板但 agent 无对应权威表面」时的只读降级,迁移后降级表现须不变
  - 可观察完成:其既有降级 e2e 全绿
  - _Requirements: 1.1, 5.1, 5.2_
  - _Depends: 1.5, 4.1_
  - _Boundary: 降级 source — `examples/aigc-canvas-nosurface-agent/`, `e2e/browser/aigc-canvas-degrade.e2e.ts`_

- [ ] 4.3 插件 source 改构建期组合并迁为 pane
  - ★ 勘察修正:插件**不需要跨 realm 传组件**。pane 文档已是构建期打出的自足产物,
    组件框架与画布组件就跑在里面 ⇒ 插件与画布组件**一起打包**,在 pane 内用既有注册函数接入。
    brief 里估的「本波最大单点、接近一个独立 spec」**不成立**
  - 该 source 因此需要自己的 pane 文档构建(调用任务 1.5 的函数,传入自己的插件集)
  - 单个插件不合法时:淘汰该插件并留可定位诊断,该 pane 其余部分与其他插件仍可用
  - 可观察完成:其既有插件 e2e 全绿(图层/工具/检视器/动作四条链路);
    另有一条用例证明单插件不合法不连坐
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1_
  - _Depends: 1.5, 4.1_
  - _Boundary: 插件 source — `examples/canvas-plugin-stickers/`, `e2e/browser/canvas-plugin-stickers.e2e.ts`_

- [ ] 5. Validation:删除与收尾

- [x] 5.1 零声明者的机械核验守卫
  - 实现一条可执行核验:全仓不存在该槽键的声明、类型定义与引用
  - ★ **先证明判别力**:人为植入一处声明,确认核验报红;移除后转绿。
    否则「正确地没有了」与「守卫根本没装上」观察上同形
  - 该核验接入测试面**常驻**,不是一次性脚本
  - 可观察完成:核验在当前(尚有声明者)状态下报红并列出全部位置;判别力自证记录在案
  - _Requirements: 1.4, 1.5, 7.3, 7.4_
  - _Boundary: 守卫 — `scripts/check-no-panel-right.ts`, `test/guards/no-panel-right.test.ts`_

- [ ] 5.2 删除槽键与双路径分派
  - 前置:任务 5.1 的核验必须**已通过**(零声明者),否则不执行删除
  - 删除契约与协议中的该槽键;删除装载点的旧路径分派与内外两层的双路径判据
  - 终结插件声明键作为宿主 realm 用途的部分
  - 可观察完成:核验通过;类型检查零错误;装载点只剩单一路径
  - _Requirements: 1.1, 1.2, 1.3, 7.3_
  - _Depends: 2.1, 2.2, 3.1, 4.1, 4.2, 4.3, 5.1_
  - _Boundary: 契约删除 — `packages/web-kit/src/{slots,define-web-extension}.ts`, `packages/protocol/src/web-ext/{config,descriptor}.ts`, `packages/protocol/src/plugin/plugin-manifest.ts`, `packages/ui/src/chat/pi-chat.tsx`, `components/chat-app.tsx`_

- [ ] 5.3 清理因删除而失效的断言与死代码
  - 上游 spec 的「旧槽让位」规则随之作废:其让位断言与过渡期废弃诊断的断言一并移除
  - ★ 移除的判据是「该断言的触发条件已不可能成立」,不是「它碍事」——
    逐条说明为何不可能成立
  - 不留永不触发的死代码与死断言
  - 关于需求 7.1(过渡期诊断):该诊断由上游 spec **已实现**且在本波全程有效 ——
    迁移窗口内旧槽仍在,声明旧槽的 agent 会收到指明迁移途径的诊断。本任务不新建它,
    只在删除后移除它。**本波实施期间不得削弱该诊断**,它是迁移方的唯一提示来源
  - 可观察完成:被移除的断言逐条给出「触发条件为何已不可能」的说明;
    相关测试文件全绿且无跳过项
  - _Requirements: 7.1, 7.2_
  - _Depends: 5.2_
  - _Boundary: 断言清理 — `packages/ui/test/chat/host-panes-gating.test.tsx`, `packages/ui/test/chat/host-panes-dispatch.test.tsx`, `.kiro/specs/host-builtin-panes/design.md`_

- [ ] 5.4 全量回归与等价性总核验
  - 一次运行同时给出:类型检查、各测试面、面板相关端到端验收三者结果
  - ★ 核对汇总行算术(通过+跳过+失败 是否等于总数)—— worker 静默崩溃会伪装成「零失败」;
    ★ 数值可能带终端颜色码,累加得零时须剥掉重算(本作者上一轮吃过)
  - ★ 逐个迁移任务复核其「原断言 → 新断言」对应表,确认无保护面缩水
  - 存量红单列,不计入本波,也不作为放宽依据
  - 可观察完成:类型检查退出码 0;各测试面退出码 0 且算术自洽;
    面板相关 e2e 全绿;等价性对应表完整
  - _Requirements: 5.5, 5.6, 7.5_
  - _Depends: 5.3_
  - _Boundary: 回归核验 — 全仓_
