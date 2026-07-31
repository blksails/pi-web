# Implementation Plan

## 1. 基础原语

- [x] 1.1 建立 provider 标识的校验与冲突检测规则 (P)
  - 定义合法标识形态（小写字母、数字、连字符，不以连字符起止），非法时给出可读原因
  - 冲突检测须返回**全部**冲突项及其来源，而非遇到第一个即停
  - 维护保留名清单（pi SDK 内置 provider 名），使自定义标识不得与之重名
  - 提供存量标识归一函数，且该函数幂等
  - 完成判据：单测覆盖「两来源同名返回全部冲突」与「归一幂等」两条
  - _Requirements: 1.4, 2.2, 7.6, 9.3_
  - _Boundary: packages/core/src/model-catalog/provider-identity.ts, packages/core/test/model-catalog/provider-identity.test.ts_

- [x] 1.2 建立输入/输出类型维度的取值域与筛选谓词 (P)
  - 取值域由本产品维护（text/image/video/audio），不受上游 SDK 的两值联合约束
  - 上游模型定义缺少输出声明时，按对话缺省补齐为 text
  - provider 级声明可被模型级声明覆盖
  - 提供筛选谓词，支持按输入方向、输出方向或两者组合匹配
  - 完成判据：单测覆盖缺省补齐、继承覆盖、四种取值的筛选各一条
  - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7_
  - _Boundary: packages/core/src/model-catalog/modality.ts, packages/core/test/model-catalog/modality.test.ts_

- [x] 1.3 建立 provider 来源契约与注册表
  - 来源契约：来源身份、同步列出其 provider 定义、**列出时不得抛错**（失败即空集并自记）
  - 注册表在组装时做标识唯一性校验，冲突则抛出含全部冲突标识与来源的错误
  - 注册表按启用状态过滤，并提供按标识精确查找
  - 未注册任何来源时，输出与该来源不存在时逐字节一致
  - 完成判据：单测覆盖「单来源抛错不牵连其他来源」与「零来源输出为空」
  - _Requirements: 1.1, 1.3, 1.5, 2.1, 2.3, 8.1, 8.2, 8.3_
  - _Depends: 1.1, 1.2_

- [x] 1.4 补齐模型源注册表的契约单测
  - 该模块目前**无任何单测**，而后续任务要改其契约，先补测试再改
  - 覆盖登记、按身份去重覆盖、共享服务构造器的单例约束、测试复位
  - 完成判据：新测试文件在改造前先跑绿，作为契约变更的回归基线
  - _Requirements: 6.2_
  - _Boundary: packages/runner/test/runner/model-source-registrar.test.ts_

## 2. 缺陷修复（独立价值，优先落地）

- [x] 2.1 使注入模型源时不再丢失本地模型配置
  - 共享模型服务改为在**读取本地模型配置文件**的注册表之上叠加注册，而非用空的内存注册表替换
  - 修复后：启用任一模型源（云端出口或网关套件）时，本地自定义 provider、内置 provider 的覆写、以及以本地模型配置形式提供的凭据均不再消失
  - 订正两处文件头注释中「纯内存/不读本地模型配置」的失效表述
  - 完成判据：新增集成测试——在有本地模型配置的目录下启用一个模型源，断言该配置里的自定义 provider 仍在可用清单中；该测试在修复前必须能报红
  - _Requirements: 6.1, 6.3, 6.4_

## 3. 多网关实例

- [x] 3.1 支持从环境解析多个网关实例
  - 以实例清单加逐实例配置的形式解析，实例标识即其 provider 名
  - 任一实例配置不合法（地址、取值域、超时）即在启动期抛错并指明是哪个实例的哪个字段
  - 未配置实例清单但配置了既有单实例变量时，合成一个标识沿用旧名的缺省实例，行为与改造前逐字节一致
  - 完成判据：单测覆盖多实例解析、缺省实例合成、非法配置的错误信息含实例标识
  - _Requirements: 1.1, 1.2, 1.6, 9.1, 10.2_

- [x] 3.2 使目录合并按实例标识归属而非固定常量
  - 网关条目的 provider 取其所属实例标识，上游渠道名仍降级为展示用元数据
  - provider 清单按实例逐个列出，两个实例同时启用时分别出现
  - 同名模型的取舍仍只影响排序，不做覆盖删除
  - 日志带实例标识，使多实例的拉取与过滤可分辨
  - 完成判据：单测断言两实例的模型各自归属正确，且 provider 清单含两个实例标识
  - _Requirements: 1.2, 1.3, 10.3_
  - _Depends: 3.1_

- [x] 3.3 使凭据解析与目录缓存按实例独立
  - 每个实例独立解析其凭据，独立持有目录快照与过期时间
  - 单个实例拉取失败时仅其自身为空集，其余实例与本地模型不受影响
  - 完成判据：集成测试构造两个实例、令其一失败，断言另一实例的模型仍完整
  - _Requirements: 1.5_
  - _Depends: 3.1_

- [x] 3.4 使网关转发路由按实例分流
  - 转发路径与授权范围按实例区分，不再使用单一固定范围
  - 完成判据：集成测试断言两个实例的转发互不串扰
  - _Requirements: 1.3_
  - _Depends: 3.1_

- [x] 3.5 扩展模型源契约以支持一个来源注册多个 provider
  - 去重键改为来源身份；新增「该配置将注册哪些 provider 名」的回读能力
  - 会话侧的环境变量契约改为可承载多实例
  - 失败文案的判据改为按来源判定，不再与单一常量比对
  - 完成判据：1.4 建立的契约测试扩展后仍绿，且新增「一个来源注册两个 provider」用例
  - _Requirements: 1.1, 6.2, 6.5_
  - _Depends: 1.4, 3.1_

- [x] 3.6 在装配层接通多实例
  - 装配处由单变量改为按实例集合构造；会话启动时下发的多实例配置须能被子进程正确还原
  - 完成判据：集成测试断言两实例同时挂载时，部署级目录与会话可用清单均含两者
  - _Requirements: 1.1, 1.3_
  - _Depends: 3.2, 3.3, 3.5_

- [ ] 3.7 使失败文案的来源判据覆盖全部实例名
  - `session-options.ts` 的来源判据当前是硬编码单元素数组（只含缺省实例名），多实例下非缺省实例（如 `cloudflare` / `blksails-ai`）的模型解析失败会退回裸文案，拿不到「网关套件未启用 / 凭据缺失 / 目录已变化」这类来源专属指引
  - 判据须取自运行时实际注册的 provider 名集合（模型源契约已提供该回读能力），而非模块级常量
  - 完成判据：新增用例断言非缺省实例名的解析失败也给出来源专属文案；**该用例在改动前必须能报红**（当前实现下它会拿到裸文案）
  - _Requirements: 6.5_
  - _Depends: 3.5_

## 4. 目录统一与端点合一

- [ ] 4.1 将目录服务收敛为单一带筛选的查询
  - 原先按用途分开的两个取数方法合并为一个接受输入/输出类型与是否应用隐藏名单的查询
  - 条目字段统一命名，不再因用途而异；每个条目标明其来源
  - 零来源时输出与本特性引入前逐字节一致
  - 完成判据：单测覆盖按输出类型筛选、按输入类型筛选、零来源等价三条
  - _Requirements: 3.1, 3.3, 3.5, 4.4, 4.5, 10.1_
  - _Depends: 1.3, 3.2_

- [ ] 4.2 使各来源的模型条目携带类型信息
  - 本地模型、网关模型、图像静态目录三类来源的条目均补齐输入/输出类型
  - 图像目录的 provider 字段由封闭取值放宽，使新增图像 provider 不必改类型定义
  - 完成判据：单测断言三类来源的条目均有非空的输入与输出类型
  - _Requirements: 2.4, 4.1, 4.3_
  - _Depends: 1.2, 4.1_

- [ ] 4.3 合并三个只读模型端点为一个
  - 部署级目录端点接受类型筛选参数；删除图像模型目录端点与视觉模型目录端点
  - 旧端点的能力由类型筛选完全覆盖
  - 完成判据：集成测试断言按输出为图像筛选的结果与旧图像端点等价、按输入为图像筛选与旧视觉端点等价（网关条目的增量单独断言）
  - _Requirements: 3.1, 3.2, 3.4_
  - _Depends: 4.1, 4.2_

- [ ] 4.4 使隐藏名单成为彻底禁用
  - 隐藏的 provider 其模型不出现在任何筛选结果中，不因类型不同而例外
  - 工具侧的可用模型派生同样应用隐藏名单，使被隐藏的模型不可被工具选用
  - 设置界面不将被隐藏 provider 的模型呈现为可选项
  - 完成判据：集成测试断言隐藏某 provider 后，部署级目录、会话清单、工具模型清单三处均不含其模型
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Depends: 4.1_

## 5. 自定义 provider 配置

- [ ] 5.1 定义 providers 配置域的校验与表单结构 (P)
  - 以可增删的条目列表承载：标识、显示名、启用开关、访问地址、凭据、输入/输出类型、模型清单
  - 标识唯一性与保留名冲突在保存时校验，错误须精确指向出错条目
  - 校验结构与表单结构两侧手写并保持同步（生成器不支持所需的列表与多态形态）
  - 完成判据：单测覆盖标识重复、标识与保留名冲突两种拒绝场景，且错误定位到条目下标
  - _Requirements: 7.1, 7.5, 7.6, 7.7_
  - _Boundary: packages/protocol/src/config/domains/providers.ts, packages/protocol/test/config/providers-domain.test.ts_

- [ ] 5.2 实现列表内凭据的掩码与合并 (P)
  - 通用实现不遍历数组，故需一个能下钻到列表条目内的掩码与合并遍历器
  - 读回时凭据只呈现掩码态，明文绝不回传
  - 写入支持保留、清除、覆盖三态
  - 完成判据：单测断言列表内的凭据字段被掩码（**这是通用实现的已知盲点，此测试必须先能报红**），且三态合并各一条
  - _Requirements: 7.3, 7.4_
  - _Boundary: packages/core/src/config/provider-secrets.ts, packages/core/test/config/provider-secrets.test.ts_

- [ ] 5.3 将自定义 provider 接入目录与会话
  - 自定义 provider 作为一类来源进入注册表，其模型出现在部署级目录
  - 同一份定义在会话侧注册，使其模型在会话中同样可用
  - 停用某 provider 时其模型从目录消失但配置保留
  - 完成判据：集成测试断言新增一个自定义 provider 后其模型出现在目录，停用后消失且配置仍在
  - _Requirements: 7.2, 7.5_
  - _Depends: 1.3, 5.1, 5.2, 3.5_

- [ ] 5.4 在设置界面提供 provider 管理入口
  - 注册配置面板，使新增、编辑、启停 provider 可在界面内完成
  - 列表标明每个 provider 来自内置注册、云端下发还是使用者自定义
  - 完成判据：浏览器 e2e 能新增一个 provider 并在保存后看到它出现在列表中
  - _Requirements: 7.1, 11.7_
  - _Depends: 5.1, 5.2_

## 6. 界面消费面接线

- [ ] 6.1 使设置界面的 provider 与模型下拉改用统一目录
  - 改用统一端点并按所需类型筛选；取数缓存按筛选参数分桶而非单例
  - provider 徽章按来源实例标识展示
  - 完成判据：组件测试断言按不同筛选参数取数互不串扰
  - _Requirements: 11.1, 11.2, 11.6_
  - _Depends: 4.3_

- [ ] 6.2 使图像模型开关清单改用统一目录 (P)
  - 改用统一端点并按输出为图像筛选；启停语义与存量存储值保持不变
  - 完成判据：组件测试断言清单来自统一端点，且既有启停设置仍生效
  - _Requirements: 9.2, 11.1, 11.2_
  - _Boundary: packages/ui/src/config/fields/aigc-model-toggles-field.tsx, packages/ui/test/config/aigc-model-toggles-field.test.tsx_
  - _Depends: 4.3_

- [ ] 6.3 使视觉模型清单改用统一目录并消除重复取数
  - 设置界面与画布弹层两处改用统一端点并按输入为图像筛选，且共用同一取数与缓存
  - 复合标识由消费面自行拼装，使存量偏好值格式不变
  - 完成判据：组件测试断言两处共用一次取数；存量偏好值仍能命中清单
  - _Requirements: 9.2, 11.1, 11.2, 11.6_
  - _Depends: 4.3_

- [ ] 6.4 使会话模型选择器显示当前模型为选中态
  - 当前模型由会话状态派生而非仅记本地，刷新页面后仍显示为选中
  - 当前模型不在可用清单中时该项仍可辨识，不静默消失
  - 完成判据：组件测试断言在有会话状态时初次渲染即为选中态
  - _Requirements: 11.8, 11.9_

- [ ] 6.5 变更会话模型切换的接口路径
  - 切换操作与会话模型查询共用同一路径，仅以请求方法区分
  - 旧路径以可辨识方式告知已变更，不静默失效
  - 完成判据：集成测试断言新路径生效、旧路径返回含新路径指引的错误
  - _Requirements: 3.7, 3.8_

- [ ] 6.6 使 provider 变更在各消费面反映
  - provider 新增、停用或删除后，各消费面无需重启即反映变化；工具侧清单若受会话生命周期限制，须在界面明示生效时机
  - 完成判据：e2e 断言新增 provider 后设置界面无需重启即出现该 provider
  - _Requirements: 11.3, 11.4, 11.5_
  - _Depends: 5.3, 6.1, 6.2_

## 7. 存量兼容

- [ ] 7.1 使存量配置在改造后继续生效
  - 存量的默认 provider 与默认模型继续有效；因标识变化而需映射的自动归一，不静默丢弃
  - 存量的图像模型启停设置与视觉模型偏好继续生效
  - 完成判据：集成测试以改造前的配置文件内容为输入，断言默认模型、图像开关、视觉偏好三者均仍生效
  - _Requirements: 9.1, 9.2, 9.3_
  - _Depends: 3.1, 4.3_

- [ ] 7.2 使指向已不存在 provider 的设置可辨识
  - 存量设置指向的 provider 不存在时保留该值并给出提示，不静默清除
  - 会话中默认 provider 不可用时给出可辨识提示，不静默回落
  - 完成判据：组件测试断言失效值带可辨识标记而非被移除
  - _Requirements: 6.5, 9.4_

## 8. 验证

- [ ] 8.1 补齐诊断信息
  - 各来源在组装时记录其提供数、经类型筛选后数、经隐藏过滤后数，使「模型为何没出现」可从日志判定
  - 完成判据：单测断言日志含上述计数
  - _Requirements: 10.3_

- [ ] 8.2 端到端验证多实例与自定义 provider
  - 浏览器 e2e：两个网关实例同时启用时在 provider 下拉中分别可见；新增一个自定义 provider 后其模型出现在会话模型选择器
  - 完成判据：e2e 用例通过，且用例在功能未接线时能报红
  - _Requirements: 1.3, 7.2, 11.3_
  - _Depends: 3.6, 5.4, 6.6_

- [ ] 8.3 全量回归与类型检查
  - 全部工作区包的测试与类型检查通过；核对测试汇总的算术（通过数加跳过数等于总数），防止 worker 崩溃被计为全绿
  - 逐条复核本特性的验收标准，对未被自动化覆盖者说明其人工验证方式
  - 完成判据：给出测试与类型检查的实际输出，而非「应该通过」的断言
  - _Requirements: 10.1_
  - _Depends: 8.2_

## Implementation Notes

### 第一批（1.1-1.4, 2.1）完整性批评发现（2026-07-31）

**已修复：**

1. **分档守卫真红（我方引入）** —— 1.4 新建的测试命名为 `.test.ts`（fast 档）却 import 了 pi SDK，跨包分档守卫判定其为 it 档，导致 `packages/core` 的 `test/tiering/tier-guard.test.ts` 报红。★ 这条**只在跑 core 包时暴露**，跑 runner 包（1.4 的边界）恒绿 —— 正是逐任务复查看不见的缝。已按守卫提示改名为 `model-source-registrar.it.test.ts`，两侧复验转绿。
2. **2.1 漏订正的第二处注释** —— `session-model-source.ts` 文件头与 `option-mapper.ts` 两处仍称「纯内存 / 内存 ModelRegistry」，与改后事实相反。已订正。

**遗留给后续任务的输入（不是本轮的完成）：**

3. **验收命令选错了面** —— 本轮下发的 `pnpm test:app` 与本轮改动**零交集**（改动全在 `packages/*/test` 下，而 `test:app` = 根 `vitest run` 只跑仓根 `test/`），且它本身当前就有 8 个文件失败（publish-preview / panes-agent-build / no-panel-right 守卫 / chat-app 等，**全部与本 spec 无关的存量红**）。
   → **任务 8.3 必须按包指定验收命令**：`pnpm --filter @blksails/pi-web-{core,runner,adapters,ui,protocol} test`；且根 `pnpm typecheck` 会因 desktop 的 `cargo check` 先失败而**提前中断、根 tsc 根本没跑**，需单独跑 `tsc -p tsconfig.json --noEmit`。

4. **2.1 的证据只到 adapters 层** —— 断言停在 `registry.find("local-custom", ...)`（在注入对象上直接查），没有走到会话装配路径（`option-mapper` → `getSharedModelServicesFactory` → `createAgentSessionServices`）或会话级模型清单端点。Req 6.1/6.4 声称的「部署级目录里有的在会话中不缺失」仍缺端到端可观测证据。
   → **在 3.5 或 8.3 补一条 runner 包 it 用例**：准备含自定义 provider 的 `agentDir/models.json` + 一个已登记模型源的 env，走 option-mapper 装配路径，断言会话可用清单同时含 egress provider 与 local-custom。

5. **保留名与 AIGC 既有 provider 冲突（4.2/5.1 之前必须定）** —— `RESERVED_PROVIDER_IDS` 把 `openrouter` 列为保留名（手抄自 pi SDK 的 33 项内置 provider），但 AIGC 静态目录里已有 **6 条在用的 `provider: "openrouter"`**。Req 2.1 要求合并为单一标识空间后，这批条目要么撞保留名、要么须归并进 SDK 内置 openrouter，取舍未定。
   → 写进 design 迁移策略表后再动 4.2。

6. **`LEGACY_PROVIDER_ID_MAP` 交付为空，但已知有一项必须迁移** —— 注释断言「本特性引入时尚无需要迁移的已知记录」，然而需求与决策表明确要求消除 image 侧 `ai-gateway`（= BlackSail 自建网关）这个同名不同义标识、自建网关实例 id 定为 `blksails-ai`。于是 Req 9.3 目前是恒等函数 + 空表，零可观测。
   → **在 3.1/4.2 中把 image 侧 `ai-gateway` → `blksails-ai` 写进该表**，并补「真映射」用例（现有用例只覆盖幂等）。

7. **`RESERVED_PROVIDER_IDS` 是手抄快照，无守卫** —— 与 pi SDK 0.80.3 的 `BUILT_IN_PROVIDER_DISPLAY_NAMES` 逐项比对一致（33 项），但仓内没有任何测试把它钉在 SDK 上，SDK 升级后漂移无声。
   → 建议加一条比对守卫测试（pi SDK 是 optional peer，放 it 档）。

### 第二批（Phase 3）中断与账本重建（2026-07-31）

workflow 进程中途退出，已按铁律跑 `recover-run.mjs` 重建账本（派出 34 个子代理 / 返回 32 / 中断时在飞 2）。判定：

| 任务 | 判定 | 三视角复查 |
|---|---|---|
| 3.1 | ✅ OK | 全 pass |
| 3.2 | ✅ OK | 2 pass / 1 reject（多数决通过） |
| 3.3 | ✅ OK | 全 pass |
| 3.4 | ✅ OK | 混合，多数决通过 |
| **3.5** | ❌ **REJECTED** | 边界/验收/证据三视角**全票打回**，调试结论 `RETRY_TASK` |
| 3.6 | ✅ OK | 边界 pass，另两视角**未返回**（中断时在飞） |

★ **3.6 建立在被打回的 3.5 之上**，且其自身有两个视角的复查未完成 —— 两者都需重做或补验。

**从子代理经验中捞到的、必须由父层落盘的约束：**

1. **`session-options.ts` 的 `GATEWAY_SOURCE_PROVIDER_NAMES` 仍是模块级单元素数组** —— 把它接到真实的 per-instance provider 名集合需要改 `resolveModel` 签名，明确超出 3.5/3.6 当前划定的范围。→ 需单列一个任务，否则「失败文案按来源分化」在多实例下会漏判非默认实例名。

2. **多实例 env 命名契约（design.md 未写全，由 3.1 推定并已落地）**：`PI_WEB_GATEWAYS=<id1>,<id2>` 列实例；逐实例 `PI_WEB_GATEWAY_<ID>_{BASE_URL,API_KEY,ALLOWLIST,TTL_MS,TIMEOUT_MS,INPUT,OUTPUT}`，`<ID>` = id 大写且 `-`→`_`（与 `PI_LLM_TOKEN_<ID>` 同源）。归一规则的单一事实源是 `config.ts` 的 `envSafeInstanceId`，后续任何 env 名派生须 import 它而非重写正则。

3. **e2b 沙箱分支仍硬编码默认实例** —— `lib/app/ai-gateway-assembly.ts` 的 token 铸造未多实例化。design.md 的 3.6 文件表未列该文件，故留作后续任务，不擅自扩大 3.6 边界。

4. **`CreateAiGatewayRoutesDeps.timeoutMs` 是全局单值而非按实例** —— 3.4 的契约限制，装配层暂取第一个实例的超时作为务实默认。

5. **跨层约束**：`lib/app` 不是 `@blksails/pi-web-core` 的直接依赖（只依赖 adapters），故 `lib/app` 下引用 core 常量必须经 adapters 的 re-export barrel，直连 `@blksails/pi-web-core/*.js` 会让根 tsc 报 TS2307。

6. **测试环境限制**：jsdom 不实现 `AbortSignal.any`，任何走到 ai-gateway 路由真实上游 fetch 的集成测试都会崩；验证鉴权/scope 对齐要让 KeyResolver 解析不出 key，使 handler 在 fetch 前以 502 短路。

7. **flaky 噪声**：`packages/core` 偶发 SQLite `database is locked`（并发临时文件锁），干净重跑即过 —— 单次此类失败按基建噪声处理，但必须重跑一次确认。

**3.5 打回项的处置（父层裁定）：**

复查打回的三条理由，逐条核对当前代码后的结论：

| 打回理由 | 当前状态 | 处置 |
|---|---|---|
| (b) 会话侧 env 契约未多实例化 | **已由 3.6 补上** —— 新增 `computeAiGatewaySessionsSpawnEnv`（复数），单实例且 id 等于缺省名时才回落旧的扁平 env 名 | 已解决 |
| (c) 来源判据常量声明后从未引用（零判别力） | **已接线** —— `session-options.ts:94` 现在用 `GATEWAY_SOURCE_PROVIDER_NAMES.includes(model.provider)` | 部分解决 |
| (c) 遗留：该数组仍是**单元素硬编码** | 多实例下非缺省实例名不在其中，仍会退回裸文案 | **单列为任务 3.7** |
| `registerAiGatewayProvider` 的 `providerName` 第四参当时是死代码 | 3.6 已实际传参使用 | 已解决 |

★ 另一条打回理由指「3.1/3.2/3.3 在 tasks.md 里仍是 `[ ]` 却被当作既成前提」—— 这是复查者不了解 kiro 的状态回写机制（铁律 2：勾选归编排层，workflow 内子代理禁止改 tasks.md），非真实缺陷。

**验证证据（父层实跑，非采信自述）：**

- `packages/adapters` 全量 11 文件 / 96 用例绿
- `packages/runner` 全量 20 通过 + 1 跳过 / 91 通过 + 5 跳过（算术核对：20+1=21、91+5=96 ✓）
- `packages/core` 全量 57 文件 / 568 用例绿
- **仓根 `test/ai-gateway*` 6 文件 / 40 用例绿** ← 这一面是复查者点名的盲点：包级 `--filter` 跑不到仓根 `test/`，而 `pi-handler` 的真实接线正在那里被端到端验证
