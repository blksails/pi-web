# Research Log — desktop-aigc-egress

> 勘察类型：**light discovery（既有系统扩展）+ 外部契约假设核验**。
> 日期：2026-08-07。基线：pi-web `main` `48e69e07`；pi-clouds 工作树分支 `chore/npm-mirror-scope-split`；ai-gateway `6f1f7b5`。
> 本文严格区分「**实况**」（带 `file:line`，可核）与「**推论/提案**」。

## Summary

勘察推翻了立项时设想的实现形状，并把工作量重新分配：

- **chat 目录面几乎白拿**。`multi-gateway-providers`（33 任务已全部实现）已经把网关配置做成了**多实例**，且 `GatewayInstanceConfig` 是纯数据结构、`resolveGatewayInstances(env)` 只是它的**一个来源**。三个下游消费点（目录聚合 / 路由挂载 / 本地 runner spawn env）都吃这一份实例列表。桌面登录态只需把云端授予**合成为一个实例**追加进去，R3/R4/R5 在 chat 侧即随之满足。
- **图像面必须自己做**。AIGC 侧**完全没有多实例化**（`grep instanceId|instances packages/tool-kit/src/aigc/*.ts` 零命中），仍是「单实例 env 占位符 + 静态路由白名单」。
- **发现一处会让实现直接踩坑的 URL 拼接不变式**（见 Decision D3），立项描述里没有。

## Research Log

### 1. runner spawn env 注入路径是否可行（requirements 遗留存疑之一）

**可行，且已有两套现成机制，不必新造。**

- 桌面登录态既有注入器：`lib/app/auth-egress-assembly.ts` 的 `computeAuthEgressSpawnEnv(config, credential)`，跨进程契约三键 `PI_WEB_DESKTOP_CREDENTIAL` / `PI_WEB_CLOUD_EGRESS_BASE` / `PI_WEB_CLOUD_EGRESS_MODELS`。
- 网关多实例既有注入器：`lib/app/pi-handler.ts:1199-1206` 的 `computeAiGatewaySessionsSpawnEnv({instances})`，逐实例下发 `基址 + 凭据 + 目录 id 清单`；runner 侧 `resolveAiGatewaySessionSpecsFromEnv`（`packages/adapters/src/ai-gateway/session-model-source.ts:284`）还原并逐实例 `registerProvider`。契约键：`PI_WEB_AI_GATEWAY_SESSIONS` + 每实例前缀三件套（`session-model-source.ts:44-58`）。

**含义**：本 spec 不引入新的跨进程 env 契约，复用第二套即可。

### 2. AIGC 图像路由的 env 判别与展开（requirements 遗留存疑之二）

- 判别在 **runtime 层**：`packages/tool-kit/src/aigc/extension.ts:179-180` 读 `process.env.BLKSAILS_GATEWAY_BASE_URL` 非空 → 把 `AI_GATEWAY_IMAGE_ROUTES` / `AI_GATEWAY_IMAGE_EDIT_ROUTES` 经 `extraRoutes` 并入。
- 值在**执行期**展开：`packages/tool-kit/src/aigc/providers/ai-gateway.ts:47-49` 的 `baseUrl: "${BLKSAILS_GATEWAY_BASE_URL:-http://127.0.0.1:8080}/v1"` 与 `apiKeyVar: "BLKSAILS_GATEWAY_API_KEY"`，经 var-resolver 在 runner 进程内解析。声明层不读 `process.env`，符合 steering 的双入口硬约束（`tech.md` §双入口边界）。
- ⚠ `extension.ts:121-128` 的旧名归一化**会写 `process.env`**（`process.env[next] = legacyVal`），有进程级副作用，本 spec 的注入顺序需避开。

**含义**：单实例形态下「注入两个 env 即可零改 tool-kit」这条路**技术上成立**，但它把云端出口伪装成了那个全局单实例，与 chat 侧的多实例模型不一致，且无法同时存在「本地配置的网关」与「云端授予的出口」。故不采纳（见 Decision D2）。

### 3. 云端出口能否转发图像与目录请求（外部契约核验）

**能，且无需 pi-clouds 新增端点。**

- `pi-clouds` `apps/cloud/app/api/desktop/egress/[...path]/route.ts` 是 catch-all，路径无限制，导出 `GET` 与 `POST`，认证走 `requireCurrentUser` 的桌面凭据分支，上游拼 `${gatewayRawBaseUrl()}/<path>`。
- ai-gateway 侧 `GET /v1/models` 存在，且语义是**按 key 可见性 + 产品目录**返回（`ai-gateway` 仓 `cmd/gateway/main.go:355`）。
- pi-web 的目录聚合器打的正是 `${baseUrl}/v1/models`（`packages/adapters/src/ai-gateway/model-catalog.ts:251`）。

**含义**：经代理后，用户看到的目录天然就是自己那把 sk-gw 能见的那份 —— 这不是巧合的便利，而是 R3.1「按该账号凭据可见」的语义正好由上游保证。

⚠ **曾未核验，2026-08-07 实施期已在代码层核实**（真机仍待验，见下）：`proxyDesktopEgress` 对 `GET` 与 `multipart/form-data` 的处理。

**代码层结论（`pi-clouds` `packages/cloud-app/src/egress/desktop-egress-proxy.ts`）：两条路径都被支持。**

- `:102` `const hasBody = req.method !== "GET" && req.method !== "HEAD";` —— **GET 不带 body**，模型目录请求可正常转发。
- `:103` `const body = hasBody ? await req.arrayBuffer() : undefined;` —— 以**字节**物化，`multipart/form-data` 的边界与二进制内容原样保真；物化是 401 重签重试所必需（`:101` 注释自述）。
- 头净化删的是 `authorization` / `cookie` / `host` / `content-length` / `connection`，**不删 `content-type`** —— multipart 的 boundary 参数随之保留。

**真机探测结论（2026-08-07，任务 5.3）：真实云端已部署，三类请求的路由与认证行为均已验证。**

对 `https://pi-cloud.apps.blksails.cn` 实测（`curl --noproxy '*'`，无凭据）：

| 请求 | 结果 | 说明 |
|---|---|---|
| `POST /api/desktop/capabilities` | **401** | 端点存在，认证生效 |
| `GET  /api/desktop/egress/v1/models` | **401** | **GET 被 catch-all 接住**（不是 405/404） |
| `POST /api/desktop/egress/v1/images/generations` | **401** | 图像生成路径可达 |
| `POST /api/desktop/egress/v1/images/edits` | **401** | 图像编辑路径可达 |
| `POST /api/desktop/egress/v1/chat/completions` | **401** | 既有对话路径（对照） |
| `POST /api/desktop/NOPE`（对照组） | **404** | ★ 证明上面的 401 不是「什么都 401」，而是真的路由到了代理并被认证拒绝 |

**对照组是这组判据可信的关键**：若不做它，「全是 401」与「服务端对任何路径都返回 401」无法区分。

由此已验证：**R9.1** 的路由可达性（三类请求都到达代理）、**R9.2** 的「凭据无效 → 可区分的鉴权失败，且在发起上游调用之前」（401 而非 502/500）。

⚠ **仍未验证（诚实边界）**：带**有效**桌面凭据的完整往返 —— 即 `sk-gw` 换取、上游 ai-gateway 对 `/v1/images/*` 的实际响应、以及 multipart 图像编辑的字节保真。这需要一个真实云端账号，本轮不具备。风险 R2 的等级：**路由与认证已真机验证，业务往返待验**。

### 4. 图像模型清单是静态白名单，不是动态目录

`AI_GATEWAY_IMAGE_ROUTES`（`packages/tool-kit/src/aigc/tools/image-generation.ts:202+`）是**固定几条**（`gpt-image-1` / `gpt-image-2` …）的静态表，注释自述「首批仅纳入已真机验证可出图的模型」。它与 chat 侧「拉网关 `/v1/models` 动态目录」是两种完全不同的清单来源。

**含义**：R4.1「可选中的就是真能跑的」在图像侧不能靠静态表自动满足 —— 某账号的网关未必开通 `gpt-image-1`。故授予需支持**可选下发图像模型清单**并与静态表取交集（见 Decision D5）。

### 5. provider 展示归属硬编码（R5 的收口点）

`packages/tool-kit/src/aigc/providers/ai-gateway.ts:53` 把 `provider` 写死为 `"cloudflare"`，源码注释自述「这把某个部署的配置写进了常量……若指向真正的自建网关，界面仍显示 cloudflare（已知取舍）」。同一取舍在 `packages/tool-kit/src/aigc/model-catalog.ts:95` 的目录条目上重复了一次。

chat 侧同一问题已由 `multi-gateway-providers` 根治：provider 名 = 实例 id，`mergeModelCatalog` 按 `entry.instanceId` 归属。**图像侧只是还没跟上**，不是设计分歧。

## Architecture Pattern Evaluation

| 候选 | 形状 | 判定 |
|---|---|---|
| **A. 注入单实例 env** | 桌面登录态设 `BLKSAILS_GATEWAY_BASE_URL` + `BLKSAILS_GATEWAY_API_KEY` 为云端出口值 | ❌ 否决。tool-kit 零改动很诱人，但它把云端出口伪装成全局单实例：与本地已配置的网关**互斥**（只有一个槽），且 chat 侧会绕开已建成的多实例机制，制造第二套语义 |
| **B. 合成网关实例（选定）** | 云端授予 → 一个 `GatewayInstanceConfig` → 追加进实例列表 | ✅ 采纳。三个下游消费点自动生效；与本地实例天然共存；provider 身份 = 实例 id，R5 在 chat 侧随之满足 |
| **C. 新建独立的「云端图像出口」子系统** | 图像面另起一套授予→路由→目录链路 | ❌ 否决。与 B 重复建设，且会让 chat 与 image 的 provider 身份再次分家——正是 `multi-gateway-providers` 刚消灭的那类问题 |

## Design Decisions

### Decision: D1 · 云端授予以「合成网关实例」形态进入系统

**决定**：把 `CapabilityProvider` 的图像/网关授予转换为一个 `GatewayInstanceConfig`，与 `resolveGatewayInstances(env)` 的结果**合并**后交给既有三个消费点。实例来源从「只有 env」扩展为「env + 云端授予」，`GatewayInstanceConfig` 结构不变。

**理由**：`resolveGatewayInstances` 是一个**来源**而非唯一入口，其产物是纯数据。在其之上做合并是加法，不触碰已实现且已有测试覆盖的解析逻辑。

**影响**：`lib/app/pi-handler.ts:689` 一行的取值来源改为「env 实例 ∪ 授予实例」；下游 `gatewayCatalogs` / 路由表 / spawn env 三处零改动。

### Decision: D2 · 不复用单实例 env 通路

**决定**：不设 `BLKSAILS_GATEWAY_BASE_URL` / `BLKSAILS_GATEWAY_API_KEY` 来激活云端出口。

**理由**：见上表候选 A。补充一条实证顾虑：`extension.ts` 的旧名归一化会写 `process.env`，在进程级留下副作用，与「登录态可随登入登出变化」（R4.3）相冲突——env 改了不会自动回退。

### Decision: D3 · URL 拼接不变式：合成实例时必须剥掉 `/v1`

**决定**：授予里的出口地址（形如 `https://<cloud>/api/desktop/egress/v1`，**含** `/v1`，因为 pi SDK 的 `baseURL` 语义要求）在合成为 `GatewayInstanceConfig.baseUrl` 时必须剥为**裸基址**。

**理由（实况）**：`GatewayInstanceConfig.baseUrl` 是裸基址——目录聚合器自己拼 `${baseUrl}/v1/models`（`model-catalog.ts:251`），AIGC provider 自己拼 `${...}/v1`（`ai-gateway.ts:47`）。不剥就会得到 `/v1/v1/models` 与 `/v1/v1/images/generations`。pi-clouds 侧已就同一不变式吃过一次（其 `gatewayRawBaseUrl()` 与 `gatewayDataPlaneBaseUrl` 的区分即为此）。

**影响**：合成函数必须显式做这件事并有单测钉住；`cloud-defaults.ts` 固化的那个默认值**含** `/v1`，是本不变式最可能被违反的入口。

### Decision: D4 · 图像面按实例生成路由，收口 provider 归属

**决定**：把 AIGC 的网关图像路由由「静态表 + 全局占位符」改为**按实例生成**：每个网关实例（含云端授予合成的那个）产出自己的一组图像路由，`provider` 取实例 id，凭据与基址随实例走。

**理由**：这是 R5.1/5.3 的唯一正解——展示归属要正确，就不能把 provider 写成常量。同时它让图像侧与 chat 侧共用同一套 provider 身份，消除 `multi-gateway-providers` requirements §④ 记录的「同名不同义」残留。

**影响**：`packages/tool-kit/src/aigc/providers/ai-gateway.ts` 的常量 `AI_GATEWAY_CONFIG` 与两个静态路由表需要参数化。⚠ 必须守住 steering 的双入口硬约束：声明层**不得**读 `process.env`，实例信息只能由调用方（runtime 层 `extension.ts`）注入。

### Decision: D5 · 图像模型清单 = 静态表 ∩ 授予下发清单（授予可选）

**决定**：授予**可选**携带图像模型清单。携带 → 与静态白名单取交集后呈现；未携带 → 回退静态白名单（与今天一致）。

**理由**：满足 R4.1/4.2「能选中的就是真能跑的」而不把 pi-clouds 的改造变成本 spec 的硬前置（R9.4 要求云端不具备时降级而非绕开）。

### Decision: D6 · 用户手填配置优先于云端授予

**决定**：`providers` 配置域中使用者自填的条目，与合成实例 id 冲突时以使用者的为准，且冲突事实需可见（R6.3）。

**理由**：与 `lib/app/cloud-defaults.ts` 已确立并写进注释的三条约束一致（「固化值只是使用者还没表过态时的起点」）。

## Risks & Mitigations

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | `/v1` 重复拼接（D3） | 图像与目录请求 404，且错误信息不指向根因 | 合成函数单测钉死裸基址；用固化默认值（含 `/v1`）做输入的用例必须存在 |
| R2 | pi-clouds 代理对 `GET` / `multipart` 的处理未核验 | 图像编辑或目录拉取在真机失败 | 列为 R9 外部契约验证项；实现期先以真实云端或本地 pi-clouds 实测该两类请求，失败则记为兄弟 spec 依赖，不在 pi-web 侧绕开 |
| R3 | 双入口边界被破坏 | tool-kit 主入口被浏览器 bundle eval 时 `process` 未定义 | D4 参数化时严禁在声明层读 env；`pnpm typecheck` + 既有双入口测试为守卫 |
| R4 | 与 e2b/沙箱既有注入 `computeAiGatewaySessionEnv` 冲突 | 沙箱会话拿到错误的网关配置 | 合成实例只作用于**本地 spawn** 路径；e2b 分支沿用既有行为，本 spec 不改，并以对照测试证明其未受影响 |
| R5 | 目录 TTL 缓存跨登录态泄漏 | 登出后仍能看到网关模型（违反 R8.4） | 登录态变化时使合成实例及其目录快照失效；以「登出后目录不含网关条目」的用例钉住 |

## References

- `docs/pi-web-host-contract-v1.md` §1（版本与兼容）、§4（CapabilityProvider）
- `.kiro/specs/multi-gateway-providers/{requirements,design,tasks}.md`
- `.kiro/specs/desktop-account-login/`、`.kiro/specs/desktop-cloud-login/`
- pi-clouds：`apps/cloud/app/api/desktop/{capabilities,egress}/`、`packages/cloud-app/src/egress/desktop-egress-proxy.ts`
- ai-gateway：`cmd/gateway/main.go:355`（`/v1/models` 按 key 可见性）
