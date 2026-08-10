# Implementation Plan — desktop-aigc-egress

> 迁移分三步、每步可独立回滚（design.md §Migration Strategy）：
> **阶段 1（任务 1）** 纯加法，行为零变化 → **阶段 2（任务 2）** chat 面生效 → **阶段 3（任务 3–4）** 图像面生效并收口 provider 归属。

## 1. 基础：能力契约与授予转换（行为零变化）

- [x] 1.1 在能力快照中新增可选的网关接入授予
  - 定义网关授予的形状：出口根地址、可选的图像模型清单、失效时刻
  - 作为**可选**成员并入能力快照；字段缺失即该能力不可用，消费方逐项降级
  - 保持该模块的 pi-SDK-free 纪律（只依赖同模块纯类型），不得引入值依赖
  - 观察态：契约版本常量**未变**（同版本内加可选成员是合规增量），`pnpm typecheck` 全绿
  - _Requirements: 1.1_
  - _Boundary: CapabilityGatewayGrant — `packages/core/src/capability/types.ts`, `packages/core/test/host-contract-version.test.ts`_

- [x] 1.2 (P) 使桌面能力客户端解析新授予
  - 解析新授予字段并纳入静态能力快照
  - 单项授予解析失败**只使该字段缺失**，不抛；整体加载失败仍抛（既有两种失败语义不可混同）
  - 观察态：授予字段损坏时，既有的 egress 与 sources 两项授予仍可用的单测通过
  - _Requirements: 1.1, 1.5_
  - _Depends: 1.1_
  - _Boundary: DesktopCapabilitiesClient — `packages/adapters/src/auth/desktop-capabilities-client.ts`, `packages/adapters/test/auth/desktop-capabilities-client.test.ts`_

- [x] 1.3 (P) 实现授予到网关实例的转换
  - 把授予转换为与既有 env 来源**同构**的网关实例配置，使下游无法分辨来源
  - **裸基址归一**：授予地址含 `/v1`，而实例配置的地址是裸基址（下游自己拼 `/v1/models` 与 `/v1`），必须剥除，否则产生 `/v1/v1`
  - 凭据为空或地址非法 → 返回「不可用」而非抛错（与能力端口的降级语义一致）
  - 实例凭据字段承载**桌面凭据**，须在注释中钉死其不是网关数据面密钥
  - 观察态：以随包固化的默认云端地址（**含 `/v1`**）为输入的单测，断言产出为裸基址——这是本设计头号风险的唯一机械防线
  - _Requirements: 1.1, 4.1, 5.1, 8.1, 8.2_
  - _Depends: 1.1_
  - _Boundary: grantedGatewayInstance — `packages/adapters/src/ai-gateway/granted-instances.ts`, `packages/adapters/test/ai-gateway/granted-instances.test.ts`, `packages/adapters/src/ai-gateway/instances.ts`_
  - ⚠ 实施期扩边界:`instances.ts` 的 `createGatewayCatalogs` 需把「空 `allowedOwners`」翻译为「不按归属过滤」。原因是实施中核实出 `filterByOwner` 对 `undefined` 放行、对**空集全部滤除**(语义相反),不接这一环则云端出口的目录恒为空。env 路径的 `parseProviderAllowlist` 永不产出空集,故该哨兵对既有行为零影响(adapters 全量 691 pass 佐证)

## 2. 装配合并：对话面生效

- [x] 2.1 实现三源实例合并与定序
  - 合并「使用者配置 / 环境配置 / 云端授予」三个来源，定序为：使用者配置 > 环境配置 > 云端授予
  - 因使用者配置优先而被让位的实例须被产出为**可见信息**，不得静默丢弃
  - 保持使用者经设置手填网关的既有入口不变，本任务不移除也不改写该入口
  - 观察态：无授予且无使用者覆盖时，合并结果与仅环境来源**逐元素相等**的单测通过
  - _Requirements: 1.2, 6.1, 6.2, 6.3, 6.4, 9.4_
  - _Depends: 1.3_
  - _Boundary: mergeGatewayInstanceSources — `lib/app/gateway-grant-assembly.ts`, `test/gateway-grant-assembly.test.ts`_

- [x] 2.2 将合并结果接入装配点，使对话面生效
  - ⚠ 设计已回改（design.md `GrantedGatewayRuntime`）：合并**不能**在装配期一次求值——登录态是运行期可变的进程级单例，装配期求值会使登录后永不更新，直接违反 4.3/8.4。改为按需惰性求值，并以**凭据指纹**为缓存键
  - 把网关实例列表的取值来源改为惰性合并结果；目录聚合与本地会话下发两个消费点改经它，前端换钥转发路由**不经过**（授予实例的凭据不在 env 里，该路由的 `InstanceEnvKeyResolver` 天然不适用，已记入 Out of Boundary）
  - 桌面登录态下模型目录呈现网关按该账号凭据可见的模型，并与云端下发的固定清单去重
  - 目录暂时拉取不到时保留既有清单、不清空、不整体报错（沿用既有 stale-while-revalidate 与 fail-soft）
  - 观察态：登录态下模型目录出现网关来源条目且可分辨来源；未登录、非桌面宿主两种情形下条目集合与改造前一致
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.4_
  - _Depends: 2.1_
  - _Boundary: 装配接线 — `lib/app/pi-handler.ts`, `test/gateway-grant-assembly-wiring.integration.test.ts`_

- [x] 2.3 使登录态变化即时生效与失效
  - 登入后无需重启应用即可用；登出后网关来源的模型与目录快照随之失效
  - 观察态：登出后模型目录不再含网关来源条目的测试通过（防「已登出仍可调用」的窗口）
  - _Requirements: 4.3, 8.4_
  - _Depends: 2.2_
  - _Boundary: auth-egress-assembly — `lib/app/auth-egress-assembly.ts`, `test/auth-egress-assembly.test.ts`_
  - ✅ **无独立代码改动**：核实后本任务的机制已由 2.1/2.2 的 `GrantedGatewayRuntime` 承担——缓存键含凭据指纹，登出使 `getCredential()` 返回 `undefined`，授予实例与目录一并消失。另有第二道防线：`cachedStatic()` 自身比对当前凭据，凭据不符即返回 `undefined`（故 `clearSession` 未调 `clearCache()` 这一既有事实不构成泄露）。证据：`test/gateway-grant-assembly.test.ts` 的「登出后授予实例与其目录一并消失」「登录后无需重启即出现授予实例」「切号 → 目录重建」三条（含判别力探针：缓存键去掉凭据后第三条精确报红）

## 3. 图像面按实例化

- [x] 3.1 扩展跨进程实例契约以携带图像模型清单
  - 在既有的逐实例下发契约上增加**可选**的图像模型清单项
  - 对话侧的还原与注册行为保持不变
  - 观察态：未携带图像清单时，既有会话实例还原的结果与改造前逐字节一致
  - _Requirements: 4.1, 4.2_
  - _Depends: 1.3_
  - _Boundary: AiGatewaySessionSpec — `packages/adapters/src/ai-gateway/session-model-source.ts`, `packages/adapters/test/ai-gateway/session-model-source.it.test.ts`_

- [x] 3.2 实现图像侧的实例契约解析器与契约互锁测试
  - 在工具层实现只读解析器，从同一批跨进程契约键还原实例的标识、基址、凭据与图像清单
  - ⚠ 依赖方向硬约束：工具层**不得** import 内核层或适配层，故必须自带解析器而非复用适配层的那一份
  - 解析不出的实例跳过（fail-soft），不做 fail-fast
  - 观察态：**契约互锁测试**通过——同一份环境输入分别喂给两个解析器，实例标识、基址、凭据三项结果一致。缺这条测试，两份解析会在未来悄悄分家
  - _Requirements: 2.1, 2.2_
  - _Depends: 3.1_
  - _Boundary: resolveGatewayImageInstances — `packages/tool-kit/src/aigc/gateway-instances.ts`, `packages/tool-kit/test/aigc/gateway-instances.test.ts`, `test/gateway-image-instance-contract-lock.test.ts`_

- [x] 3.3 使网关图像路由按实例生成并收口供应商归属
  - 把写死单一网关配置的常量与两张静态路由表改为按实例生成
  - 供应商归属取实例标识，不再是写死的名称；上游厂商名降级为可展示元数据
  - 同一模型经不同实例暴露时路由键不得互相覆盖
  - ⚠ 声明层**不得**读环境变量：基址与凭据一律来自入参（双入口硬约束，违反会在浏览器 bundle 中崩）
  - 观察态：两个不同实例下生成的路由，其供应商归属各自等于对应实例标识的单测通过
  - _Requirements: 2.1, 2.2, 5.1, 5.2, 5.3, 5.4_
  - _Depends: 3.2_
  - _Boundary: createGatewayImageRoutes — `packages/tool-kit/src/aigc/providers/ai-gateway.ts`, `packages/tool-kit/src/aigc/tools/image-generation.ts`, `packages/tool-kit/src/aigc/tools/image-edit.ts`, `packages/tool-kit/src/aigc/model-catalog.ts`, `packages/tool-kit/test/aigc/model-catalog.test.ts`, `packages/tool-kit/test/aigc/providers/`_

- [x] 3.4 使图像模型清单与账号实际可用性一致
  - 授予携带图像清单 → 与内置白名单取交集后呈现；未携带 → 回退内置白名单（与改造前一致）
  - 不可发起调用的模型呈现为不可选中并说明原因，而非允许选中后在调用时才失败
  - 观察态：给出白名单子集时选择器只出现交集条目、给空清单时不出现网关图像条目的单测通过
  - _Requirements: 4.1, 4.2_
  - _Depends: 3.3_
  - _Boundary: 图像清单交集 — `packages/tool-kit/src/aigc/gateway-instances.ts`, `packages/tool-kit/test/aigc/gateway-instances.test.ts`_

- [x] 3.5 使图像工具按实例并入网关路由
  - 并入判据由「单一环境变量非空」改为「解析到的实例列表非空」，逐实例并入
  - 被禁用的模型对网关来源同样生效，与本地来源的禁用行为一致
  - Canvas 中使用网关图像模型的可用性与结果呈现，与在对话中一致
  - 观察态：无实例时两个图像工具暴露的路由集合与改造前**逐字节一致**；有实例时新增条目且禁用清单对其生效
  - _Requirements: 1.2, 2.1, 2.2, 2.3, 2.5_
  - _Depends: 3.3, 3.4_
  - _Boundary: aigcExtension — `packages/tool-kit/src/aigc/extension.ts`, `packages/tool-kit/test/aigc/ai-gateway-extension-control.integration.test.ts`_

## 4. 失效语义

- [x] 4.1 实现出口失效的分类与呈现
  - 鉴权失败（凭据过期或无效）与其他失败（配额、上游异常）必须可区分，前者明确提示重新登录
  - 图像请求失败时**不自动改用其他供应商**完成该请求
  - 失败经既有工具错误通道进入会话流，在当前会话内可见而非仅入日志
  - 任何失败文案不得包含桌面凭据或网关密钥
  - 观察态：桩出口分别返回鉴权失败与其他失败时，两类提示可区分、且响应中不含凭据串的测试通过
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.3_
  - _Depends: 3.5_
  - _Boundary: 出口失效分类 — `packages/tool-kit/src/aigc/providers/ai-gateway.ts`, `packages/tool-kit/src/engine/endpoint-types.ts`, `packages/tool-kit/src/engine/endpoint-adapter.ts`, `packages/tool-kit/test/aigc/gateway-egress-failure.test.ts`_
  - ⚠ 实施期扩边界:引擎需新增可选钩子 `mapTransportError`。原因是 `detectError` **只在 HTTP 200 带业务 error 体**时被调用,够不着 401/403/429 —— 而「凭据过期」恰恰走 401。钩子为可选,未提供时错误文案逐字节不变(tool-kit 全量 657 pass 佐证)。实际落点不在 tools/ 而在 providers/ 与 engine/

## 5. 验证

- [x] 5.1 以真实子进程与桩出口做集成验证
  - 断言图像请求的目标地址**不含重复的 `/v1`**、认证头为桌面凭据、且请求确实发往出口而非网关直连
  - 对照组一：未登录态下的图像路由集合与本特性引入前逐字节一致
  - 对照组二：沙箱分支的既有注入未受影响
  - 观察态：三组断言在真实 runner 子进程下全部通过
  - _Requirements: 1.2, 1.3, 2.4, 8.1, 8.2_
  - _Depends: 3.5, 4.1_
  - _Boundary: 集成验证 — `test/desktop-aigc-egress.integration.test.ts`, `packages/tool-kit/test/aigc/gateway-egress-failure.test.ts`_
  - ⚠ 实施期调整:未起真实 runner 子进程。链路上唯一的跨进程环节是 env 传递(纯数据),故在同进程内用**两侧真实函数**走完整条链;「实际发请求」的断言(URL / Authorization 头)下沉到 tool-kit 包内,因为引擎属 node-only 的 runtime 层,根测试面 import 它会把 node-only 依赖拖进前端安全那一侧

- [x] 5.2 以浏览器端到端验证关键旅程
  - 登录 → 模型选择器出现网关来源图像模型 → 生图成功
  - 登出 → 网关来源模型从选择器消失
  - 桌面凭据失效 → 生图失败并提示重新登录，且未自动换供应商
  - 观察态：三条旅程的 e2e 用例全部通过
  - _Requirements: 2.1, 2.3, 4.3, 7.1, 7.3, 8.4_
  - _Depends: 5.1_
  - _Boundary: 端到端 — `e2e/browser/desktop-aigc-egress.e2e.ts`, `e2e/fixtures/fake-cloud-server.mjs`, `playwright.config.ts`_
  - ✅ 2 passed（登录后网关模型入目录 / 登出后消失）；既有 registry 档 7 passed 未受影响
  - ★ **e2e 抓到了单测覆盖不到的真实缺陷**：目录聚合器的凭据走 `InstanceEnvKeyResolver`（从 **env** 读），而授予实例的凭据在 `instance.apiKey` 里、根本不在 env —— 目录拉取必然无凭据失败，表现为「登录了、实例也合成了，目录里一个网关模型都没有」。单测抓不到是因为那层用桩 catalog 不会真拉。修复见 `instances.ts` 的凭据二选一
  - ★ **陈旧产物教训**：e2e 跑的是 `dist/server.mjs`，改源码后**必须先 `pnpm build`**。首轮失败正因产物比源码旧近 3 小时，症状（模型完全不出现）与「代码写错了」一模一样
  - ⚠ 第三条旅程「凭据失效 → 提示重新登录且不换供应商」未走 UI：需要在真实会话里触发生图失败，而 e2e 用的是离线 stub agent（不跑真实图像工具）。该行为已由 `packages/tool-kit/test/aigc/gateway-egress-failure.test.ts` 经**真实引擎**覆盖（含「恰好一次上游调用」断言）

- [x] 5.3 验证云端出口的外部契约
  - 对真实（或本地起的）云端出口实测三类请求：图像生成、图像编辑（multipart）、模型目录（GET）
  - ⚠ multipart 与 GET 两条路径的代理行为**尚未核验**，是本设计的已知风险
  - 若实测不通，呈现为该能力不可用并记为兄弟 spec 依赖，**不在本仓以放宽凭据保密的方式绕开**
  - 观察态：三类请求的实测结论（通过 / 不通过 + 证据）写入研究日志的外部契约小节
  - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - _Depends: 5.1_
  - _Boundary: 契约验证记录 — `.kiro/specs/desktop-aigc-egress/research.md`_
  - ✅ **代码层**：`hasBody = method !== "GET" && "HEAD"`（GET 正确）、`arrayBuffer()` 物化（multipart 字节保真）、头净化不删 `content-type`
  - ✅ **真机路由与认证**：对真实云端实测，三类请求（图像生成 / 图像编辑 / 模型目录）与 capabilities 全部返回 401，而不存在的路径返回 404 —— **对照组证明 401 是真的路由到代理后被认证拒绝**，非「什么都 401」。据此 R9.1 的可达性与 R9.2 的「认证失败先于上游调用」已验
  - ⚠ **未验（诚实边界）**：带**有效**凭据的完整业务往返（sk-gw 换取、上游对 `/v1/images/*` 的实际响应、multipart 字节保真）。需真实云端账号，本轮不具备。这也是本 spec 唯一剩余的外部依赖

- [x] 5.4 全量回归
  - 跑子包测试面与应用测试面**两条**命令（只跑其一会漏另一面的红），外加全包类型检查
  - 观察态：三条命令均以新鲜输出证明通过，且汇总行的通过数与总数算术自洽
  - _Requirements: 1.4_
  - _Depends: 5.1, 5.2, 5.3_
  - _Boundary: 回归验证 — 无源码写入_
