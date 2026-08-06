# Implementation Plan

> 每条任务的「完成」判据都写成可机械观察的形式。凡涉及竞态的判据，**须先证明它能报红
> 再采信**（还原旧行为应立即失败）——本缺陷两次都是真机才暴露，跑绿不等于修好。

- [x] 1. 解除「无模型即不注册」的一票否决
- [x] 1.1 会话侧网关源解析判据改为「声明 + 凭据」 (P)
  - `resolveAiGatewaySessionSpecsFromEnv`：某实例 `BASE`+`KEY` 齐备而 `MODELS` 缺失/空白时
    仍产出 spec，模型集为空并带 `pendingCatalog: true`
  - `BASE` 或 `KEY` 缺失 → 仍不产出（凭据缺失是另一种成因，不得与「目录未就绪」混淆）
  - 未声明任何实例 → 仍返回空数组
  - 完成判据：新增单测三例（齐备无 MODELS / 缺 KEY / 未声明）全绿；**把判据还原为旧的
    「无 MODELS 即 undefined」后第一例必须报红**
  - _Requirements: 1.1, 4.1, 5.1_
  - _Boundary: packages/adapters/src/ai-gateway/session-model-source.ts + 其同名测试_
- [x] 1.2 装配层移除空快照跳过 (P)
  - `computeAiGatewaySessionsSpawnEnv` 删除 `if (modelIds.length === 0) continue;`
  - 凭据齐备即产出 `SESSIONS`/`BASE`/`KEY`；`MODELS` 仅在快照非空时附带
  - 凭据缺失仍跳过
  - 完成判据：单测断言「空目录快照 + 凭据齐备 → env 含 SESSIONS/BASE/KEY 且不含 MODELS」；
    **还原 `continue` 后该例必须报红**
  - _Requirements: 1.1, 1.3, 4.1_
  - _Boundary: lib/app/ai-gateway-session-assembly.ts + test/ai-gateway-session-assembly.test.ts_
- [x] 1.3 runner 侧:模型集为空也构造共享 registry
  - `option-mapper.ts` 的 `resolved.length > 0` 判据现由 1.1 的 spec 产出驱动；确认
    `pendingCatalog: true` 的实例能让共享 `ModelRegistry` 被构造（否则事后无处注册）
  - 以空模型集 `registerProvider`，先验证同名重复注册是覆盖还是叠加；若非覆盖则改用
    `unregisterProvider` + 重注册
  - 完成判据：单测断言「仅有 pendingCatalog 实例时共享 registry 仍被构造」；且
    「未声明任何实例时 `servicesOptions` 完全不被触碰」（Req 5.1 零侵入守卫）
  - _Requirements: 1.1, 5.1_
  - _Depends: 1.1_

- [x] 2. 新增 runner 发起的关联往返
- [x] 2.1 帧对 schema 与类型
  - `agent_gateway_models`（runner→宿主）：`{ id, instanceIds }`
  - `piweb_gateway_models_result`（宿主→runner）：`{ id, instances[{instanceId, models}], reason }`
  - ⚠ 新增上行帧须同时加入 runner 侧 `validateFrame` 白名单（既有教训：runner-ready-frame）
  - 完成判据：schema 往返单测通过；**故意漏加白名单时集成用例必须报红**
  - _Requirements: 1.1_
  - _Boundary: packages/protocol/src 下新增网关模型帧模块_
- [x] 2.2 宿主侧应答：按需等待目录，超时如实作答
  - `pi-session.ts` 用既有 `add(type, {schema, handle})` 注册 `agent_gateway_models`
  - 目录已就绪 → 立即以收敛后快照应答（`reason: "ready"`）
  - 未就绪 → await 该实例目录首次刷新，**带超时上限**；超时以空集 + `reason: "timeout"` 应答
  - 收敛完全复用 `GatewayModelCatalog`，不得新增第二套规则
  - 完成判据：单测覆盖 ready / timeout 两条路径；断言收敛结果与部署级目录同源
  - _Requirements: 1.1, 2.1, 2.3, 3.3, 5.2, 5.3_
  - _Depends: 2.1_
- [x] 2.3 runner 侧发起与在途表
  - 新建 `gateway-models-wiring.ts`：镜像宿主既有 `PendingRequests` 语义（未知/迟到 id
    安全丢弃），在 `runner_ready` 之后发起请求
  - 拿到清单后 `registerProvider` 覆盖（按 1.3 验证的语义）
  - 完成判据：单测覆盖「迟到 id 丢弃不抛」「应答后 registry 含网关模型」
  - _Requirements: 1.1, 1.2_
  - _Depends: 2.1, 1.3_

- [x] 3. 诊断可判别
- [x] 3.1 四种成因各自可判别且不含凭据
  - 「实例未声明」「凭据缺失」记在装配层；「目录未就绪」「收敛后为空」记在应答处与 runner
  - 补齐事件另记一条：实例标识 + 模型条数
  - 完成判据：单测断言四种成因产出**互不相同**的可判别记录；且断言凭据串不出现在任何记录中
  - _Requirements: 4.1, 4.2, 4.3, 2.2_
  - _Depends: 1.2, 2.2_

- [x] 4. 竞态判据与集成验证
- [x] 4.1 可主动构造「目录未就绪」窗口的集成判据
  - 构造窗口（注入受控的目录刷新时机），断言：会话先起 → 目录后到 →
    `getAvailableModels` 最终含网关模型，且**全程未重建会话**
  - 覆盖「目录始终不可达」对照组：会话仍可创建、可用本地模型、清单不含网关模型
  - 完成判据：两例均绿；**分别还原 1.1 / 1.2 / 2.3 任一处旧行为，第一例必须报红**
    （逐项验证，不可只验一处）
  - _Requirements: 6.1, 6.2, 6.3, 1.2, 3.3_
  - _Depends: 2.3, 1.2_
- [x] 4.2 一致性与零侵入守卫 (P)
  - 同一运行期内先后两个会话最终网关模型集合一致
  - 会话内清单与部署级目录在网关 provider 上一致
  - 未声明网关实例时行为与本特性实施前一致
  - 完成判据：三例全绿
  - _Requirements: 1.4, 2.1, 5.1_
  - _Boundary: test/ai-gateway-coldstart-parity.test.ts(新建,唯一写入);不改产品代码_
  - _Depends: 2.3_
- [x] 4.3 启动不阻塞守卫 (P)
  - 断言上游目录慢/不可达时，服务端首个请求耗时不受其影响
  - 完成判据：**把等待改到启动期后该例必须报红**（否则这条守卫是重言式）
  - _Requirements: 3.1, 3.2_
  - _Boundary: test/ai-gateway-coldstart-nonblocking.test.ts(新建,唯一写入);不改产品代码_
  - _Depends: 2.2_

- [x] 5. 收尾
- [x] 5.1 回写被本 spec 修订的既有约定
  - `ai-gateway-session-models/design.md:232` 那条「目录为空 → 不注册」加指回本 spec 的
    修订注记（该行为已由本 spec 推翻，不加注记会让后来者继续当作现行约定）
  - 完成判据：该文件含指向 `ai-gateway-catalog-coldstart` 的注记
  - _Requirements: 2.2_
- [x] 5.2 真机验证（不可省）
  - 重启 dev → **不做预热请求**立即建会话 → `GET /api/sessions/:id/models` 应含 cloudflare
  - 与 `GET /api/config/models` 比对网关 provider 与模型集合一致
  - 完成判据：两项均通过并留下实际读数；本缺陷两次都是真机才暴露，离线全绿不构成完成证据
  - _Requirements: 1.1, 1.2, 2.1_
  - _Depends: 4.1_

## Implementation Notes

### 任务 1.1–1.3（已完成）

- **修复着力点确认在 `research.md` §5.2 那条**：`option-mapper.ts` 的 `resolved.length > 0`
  才构造共享 `ModelRegistry`。冷启会话若无任何源解析成功，registry 从未被构造，
  「事后补注册」无处落脚。故 1.1 把网关源的**启用判据**由「有模型清单」改为
  「已声明 + 凭据齐备」——1.3 的 registry 构造由此**传递满足**，无需单独改
  `option-mapper.ts`。
- **`registerProvider` 语义已实证：覆盖（replace），非叠加**。空集注册不抛，`find` 可解析。
  故补注册无需先 `unregisterProvider`。已固化为两条用例（外部契约，SDK 变更即报红）。
- **判据均已证明能报红**：还原 `if (modelIds.length === 0) continue;` → 装配层用例
  1 failed / 18 passed；还原后复跑 19 passed。
- **既有用例按新期望更新而非放宽**：`session-model-source.it.test.ts` 与
  `ai-gateway-session-assembly.test.ts` 中编码旧契约的 4 条断言逐条改写，并把
  「凭据缺失 → 缺席」与「目录未就绪 → 在场且 pendingCatalog」拆成两条独立用例
  （Req 4.1 的可判别性依赖这条分界）。
- **存量红（与本 spec 无关）**：根 tsconfig 下 `test/cli/cli-args.test.ts(277,14)` TS2339。
  已用「stash 本次改动后复跑」验证为基线既有，非本次引入。

### 任务 2.1–5.2（已完成）

- **反向拉取三段**：帧对（protocol）→ 宿主应答（core 端口 + app 实现）→ runner 在途表。
  ★ 这是本仓**首个「runner 发起 + 宿主应答」的关联往返** —— 既有的 `ui_rpc`、attachment
  catalog 全是宿主发起、在途表在宿主侧。
- **端口而非直接依赖**：`GatewayModelsResolver` 定义在 core，实现（持有 `GatewayModelCatalog`）
  由装配层闭包注入 —— core 不得反向依赖 adapters。
- **等待落在应答路径内**：目录未就绪时宿主在**这一次应答**里等（15s 上限），启动与首个
  请求一概不经过它。这是选「拉」而非「推」的实质理由。
- **登记顺序不可假定**：会话构造（登记待补清单）与 runner 启动（登记帧通道）谁先谁后都
  可能，双方各自「登记 + 尝试触发」。两种顺序各有用例——只测一种的话另一种排列下会静默失效。
- ⚠ **上行帧白名单已登记**（`runner.it.test.ts` 的 `validateFrame`）——`runner-ready-frame`
  留下的教训。
- **凭据缺失此前是静默 `continue`**，诊断上与其余三种成因不可分辨；现已指名记录。

### 判据的报红验证（逐条实做，非声称）

| 还原的改动 | 结果 |
| --- | --- |
| 1.1 解析判据（无 MODELS → undefined） | 集成判据 2 failed / 1 passed |
| 1.2 装配层 `continue` | 集成判据 2 failed / 1 passed |
| 2.3 runner 不发起索取 | 集成判据 2 failed / 1 passed |
| 成因合并为单一 `ready` | resolver 判据 2 failed |
| 等待挪回装配期 | 不阻塞守卫 1 failed |

全部还原后各自复跑均全绿。

### ★ 真机验证读数（2026-08-05）

冷启窗口**真实复现**：会话 `81874d24` 创建 `1785928693169` / spawn `1785928693189`，
网关目录首拉完成 `1785928695017` —— 会话早 **1.85 秒**，与修复前同一时序。

`ps -E` 直读该 runner 进程环境：`PI_WEB_AI_GATEWAY_SESSIONS=cloudflare` +
`_BASE` + `_KEY` 共 **3 个键，无 `_MODELS`** —— 证明走的是**拉取路径**而非快路径。

结果：

| | 修复前 | 修复后 |
| --- | --- | --- |
| 冷启会话内模型总数 | 63 | **61** |
| 其中 cloudflare | **0** | **14** |

与部署级目录逐条比对：两侧 cloudflare 各 14 条，**完全一致**（Req 2.1）。

### 存量红（与本 spec 无关，已 stash 验证）

- 根 tsconfig：`test/cli/cli-args.test.ts` TS2339
- 根测试：`webext-slots-runtime.integration` / `publish-preview`（webext dist / 产物相关）
