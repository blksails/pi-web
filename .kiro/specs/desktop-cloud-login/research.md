# Gap 分析 — desktop-cloud-login

> 目标：勘定 R1–R7 与现有代码库的实现缺口，为设计阶段提供决策信息。范围 = pi-web 仓（主战场）+ pi-clouds 仓（外部契约）。分支基准：pi-web `main`（`445a787`）、pi-clouds 当前工作树。**信息而非决策**：给选项与工作量，不做最终裁定。

## 0. 关键更正与关键发现（先读）

1. **[更正] 两套网关集成都已在 main**（此前 memory 误记 sandbox-credentials-v2 未合）：
   - `packages/server/src/ai-gateway/`（X，外部 Go 网关，启用判别 `AI_GATEWAY_BASE_URL`）— 引入 `d111ba1`，model-catalog 重写 `e3b4af8`。
   - `packages/server/src/llm-gateway/` + `packages/server/src/tokens/`（Y，自建 scoped-token 反代 `/api/llm-gateway/:provider/*`）— 引入 `04528ce`/`9b5442d`/`ef2c8ad`，均为 origin/main 祖先。
2. **[发现 A] 桌面/本地（非 e2b）runner 当前完全不走网关**：`lib/app/pi-handler.ts:657-673` local/real 分支 spawn env = `resolved.spawnSpec.env` + `config.providerKeys`（真实 provider key 直接透传）+ 附件 env，**零网关注入**；runner 内 pi SDK 从 `<agentDir>/auth.json`+`models.json` 解析模型（`packages/server/src/config/model-options.ts:31-32`）。网关 env 注入**只在 e2b 分支**（`pi-handler.ts:534,549,563`）。
3. **[发现 B] pi-web 全仓无 models.json 写入器**：只读不写（`grep writeFile.*models.json` 全空）；「把 baseUrl+Bearer(authHeader:true) 写进 runner models.json」的能力在**跨仓沙箱镜像 entrypoint**里，明确标注超出本仓范围（`lib/app/ai-gateway-assembly.ts:11-12`、`lib/app/llm-gateway-config.ts:139-145`）。
4. **[发现 C] userId 从未被生产或消费**：接缝已留（`ai-gateway/key-resolver.ts:14-17` `KeyResolveInput.userId`、`:54-67` `PerUserKeyResolver` 占位抛错），但 `routes.ts:228` 恒 `keyResolver.resolve({})` 传空；scoped-token（`tokens/scoped-token.ts:83-103` mint / `:116-156` verify）不含 userId 字段。生产端与消费端两头全空。
5. **[发现 D] pi-clouds 的「egress」不是给外部客户端的 HTTP 端点**：`cloud-ai-gateway-egress`（phase=implementation，库层已实现、沙箱改写/接线/E2E 未做）的 egress = **沙箱内 pi 的 models.json 改写机制**，出口端点是 **ai-gateway 自己的 `/v1/*` 数据面**（`design.md:38,55-64`）；`apps/cloud/app/api` 下**无任何 egress HTTP 路由**。→ 架构 B 假设的「桌面可指向的 pi-clouds 云端 egress 代理」**当前不存在**。
6. **[发现 E] 桌面壳零持久化先例**：无 `tauri-plugin-store`、无 keyring/keychain crate（`desktop/src-tauri/Cargo.toml:21-25` 仅 dialog/opener/serde）；安全存储桌面 token 是**全新能力**。

## 1. 当前态勘定（file:line）

### 1.1 桌面壳（Tauri）
- env 注入接入点：`desktop/src-tauri/src/main.rs:55-72` `base_env()`（当前仅 `PI_WEB_DEFAULT_SOURCE`/`PI_WEB_DEFAULT_CWD`，注释明示不含 agentDir）；运行期覆盖 `server_supervisor.rs:76-98` `build_child_env`（叠 PORT/HOSTNAME/PI_WEB_AUTOSTART/PI_WEB_NODE_BIN；`.envs()` 继承父 env）。
- 命令注册：`main.rs:261-265` `generate_handler![dialog::pick_directory, retry, quit]`；新增 command = 函数(`#[tauri::command]`) + 入列 + ACL（`capabilities/default.json:14` permissions 数组 + `permissions/*.toml` 定义）。回环远端页面 invoke 应用 command 必须显式 ACL 放行。
- 前端加载：`tauri.conf.json:6-8` frontendDist=`frontend/`（`index.html`/`app.js`/`style.css`，近零脚本 pre-server 静态壳，CSP `default-src 'none'; script-src 'self'`）；`window.rs:62-89` 先加载 `index.html`，后端就绪后 `main.rs:196-199` 导航到 `http://127.0.0.1:<port>`（Node server 真实 UI 接管）。
- Req 5.5 不变式硬锁：`server_supervisor.rs:93-96` `debug_assert!`（子进程 env 出现 `PI_WEB_AGENT_DIR` 当且仅当来自 base_env）+ 回归测试 `:362-377`。

### 1.2 pi-web 服务端模型出口
- 启用判别：`ai-gateway/config.ts:15` `AI_GATEWAY_BASE_URL`（未设→套件不注册 `:91-94`）；路由挂载 `lib/app/pi-handler.ts:848-855`；resolver 装配 `pi-handler.ts:381`（只 new `EnvKeyResolver`）。
- 换钥转发：`ai-gateway/routes.ts:202-243`（白名单→404/Bearer→401/verifyScopedToken→401·403/resolve→502/换钥流式直通 `:309`）。
- e2b 网关 env 装配（可复用形态参照）：`lib/app/llm-gateway-assembly.ts:113` `computeE2bProviderEnv`→`llm-gateway-config.ts:147` `buildSandboxLlmEnv`（产 `PI_LLM_GATEWAY_BASE`+`PI_LLM_TOKEN_<ID>`）；`lib/app/ai-gateway-assembly.ts:55` `computeAiGatewaySessionEnv`（铸 scope=ai-gateway token，产 `PI_AI_GATEWAY_BASE`+`PI_AI_GATEWAY_TOKEN`）。均只导出 env，**不生成 models.json**。
- 本地默认路径：`pi-handler.ts:530` 默认 local；`:642-675` local/real 分支真实 provider key 直透。

### 1.3 pi-clouds 外部契约
- 桌面 token 参照实现：`apps/cloud/lib/attachment-token.ts`（payload `{companyId,sessionId,scope,exp}`，`base64url(json)+"."+HMAC_SHA256`，默认 8h TTL `:30`，secret env `PI_CLOUDS_ATTACHMENT_TOKEN_SECRET` `:32`，`timingSafeEqual` `:114-119`，统一错误防 oracle `:39-44`）。
- 验签落点：`apps/cloud/lib/current-user.ts` `extractToken`（`:29-41` Bearer 优先→cookie）；`requireCurrentUser`（`:47-66` getUserFromToken→getMembership）。桌面 token 分支落点 = `:52-55` 之间（取 token 后判类型→本地 HMAC 验签→由 payload 直构 AuthContext）。
- sk-gw 签发：链路 A（admin 手动，`apps/admin/lib/ai-gateway.ts:594-600` `POST /admin/users/{userId}/keys`，`apps/admin/app/api/ai-gateway/users/[userId]/keys/route.ts:31`，**已实现生效**）；链路 B（egress 自动，`packages/cloud-app/src/keys/gateway-key-provisioner.ts:42-64` + `gateway-key-store.ts:57-73` 信封加密落 `pi_clouds.gateway_keys` 表，**库层已实现、运行时未接线**，`resolver.ts:70` gatewayKeys 可选依赖未注入）。
- device 授权流 / OAuth / refresh_token：**全仓零命中，从零建成立**。
- login route：`apps/cloud/app/api/login/route.ts` 仅塞 httpOnly cookie `sb-access-token`（`:90-97`），**不读/不回传/不存 refresh_token**（access_token ~1h）。

## 2. 需求 → 资产映射（gap 标签：Missing 缺失 / Unknown 待研究 / Constraint 约束）

| 需求 | 可复用资产 | Gap |
| --- | --- | --- |
| **R1 登录与身份获取** | pi-clouds password-grant 登录 route、Supabase Auth | **Missing**：device 授权流（pi-clouds 从零）；桌面登录 UI 及其宿主位置（见决策 2）。**Constraint**：现 login route 只塞 cookie 不回传 token |
| **R2 凭据安全存储/生命周期** | attachment-token.ts（HMAC 形态参照，可延长 TTL） | **Missing**：桌面 token 签发端（pi-clouds）；OS 安全存储（桌面壳全新，需 keyring / tauri-plugin-store）；续期/重登路径。**Constraint**：现有仅 ~1h JWT，长效需新 token 类型 |
| **R3 登录态经网关出口** | Y `llm-gateway/` + X `ai-gateway/` 反代（在 main）；e2b env 装配形态；gateway-key-store 链路 B（库层） | **Missing**：①桌面本地 runner 走网关的 models.json 注入器（发现 B，pi-web 从无）；②sk-gw 换钥收口位置（决策 1）；③云端 egress 代理端点（若走 B-pure，pi-clouds 从零，发现 D）。**Constraint**：本地路径当前零网关（发现 A） |
| **R4 未登录降级** | local/real 分支现状本就是本地 auth.json | **Constraint**：须保「登录为叠加、未登录零变化」；启用开关（类比 `AI_GATEWAY_BASE_URL`）待定 |
| **R5 安全不变式** | Req 5.5 debug_assert + 回归测试；scoped-token 脱敏惯例 | **Constraint**：不注入 agentDir（守 5.5）；网关 key 不下发前端/不落日志；原生命令 ACL 门控（新 command 需声明） |
| **R6 失效/切号** | — | **Missing**：会话中过期检测与停用、切号替换、登录态指示。**Unknown**：token 过期时进行中的 runner 会话如何优雅收口 |
| **R7 外部契约容错** | 门控 fail-fast 惯例（config.ts）；契约缺失降级 | **Missing**：契约缺失/不兼容的探测与降级到本地路径 |

## 3. 关键实现决策与选项（带入 design）

### 决策 1（核心）：sk-gw 换钥收口位置 — B-pure vs B2
用户已定架构 B「sk-gw 不落本地」，但发现 D 表明「桌面可指向的云端 egress 代理」不存在。两子变体：
- **B-pure（云端换钥）**：pi-clouds **新建** HTTP egress 代理端点（认 Bearer 桌面 token → 验签得 AuthContext → gateway-key-store 链路 B 取该用户 sk-gw → 转发 ai-gateway `/v1/*` → 流式回传）。本地 runner models.json baseUrl 直指该端点。sk-gw **完全不离云**。
  - ✅ 最强安全姿态，契合用户「不落本地」原意；复用链路 B（已写库层）。❌ pi-clouds 新建云端代理（新工作量最大项）；现有 egress 机制帮不上（是 models.json 改写非 HTTP 代理）。
- **B2（本地服务端换钥）**：本地 pi-web server 复用**已在 main 的 Y `llm-gateway/` 反代形态**，向 pi-clouds 拉取该用户 sk-gw（新增一个「认桌面 token → 返回/映射 sk-gw」的 pi-clouds 端点，或直接复用链路 B 的取钥语义），在本地进程内存持 sk-gw 转发 ai-gateway。models.json 只写 localhost 反代 + 桌面 token，**sk-gw 不落磁盘、不进 runner 子进程、不下发前端**，但**短暂驻留本地 server 进程内存**。
  - ✅ pi-clouds 侧工作量小（一个取钥端点即可，无需完整流式代理）；复用 main 已有反代。❌ sk-gw 到达本地 RAM，严格意义非「完全不离云」，与用户原话有张力（需确认「不落本地」是否含进程内存）。

### 决策 2：登录 UI 位置与时序
- **(A) Node server 端 UI 登录**（后端就绪后渲染富 UI，可达身份后端）：与「先于 sidecar 注入身份」时序颠倒——但架构 B 的 egress 配置本就是 **per-session**（runner spawn 时装配），身份无需在壳启动前就位，故 A 时序自洽。token 持久化经新 Tauri command 落 OS keychain（满足 R2.1/R5.1）。
- **(B) 原生壳前端登录**（`frontend/` 内，先于 sidecar）：须放宽其近零脚本 CSP、在 `main.rs:266-274` setup 插「等待登录」门。仅当身份必须在 sidecar 启动前就位时才需要——架构 B 不需要。
- 倾向 A + keychain 混合（富 UI 在 server 端，安全存储在原生壳）。

### 决策 3：本地 runner 走网关的 models.json 注入（不碰共享 ~/.pi/agent）
发现 B+Req 5.5 的张力：本地 runner 读 `<agentDir>/models.json`，而桌面共享 `~/.pi/agent`——不能直接覆写用户/CLI 的 models.json。选项：
- **Unknown/Research**：pi SDK 是否支持 models.json 覆盖路径 / 会话级 override（需查 pi SDK d.ts）。
- 会话级 overlay：为登录会话生成一份临时 models.json 于 session-scoped 目录，经 env 指给 pi（若 SDK 支持），不碰共享目录、不违反 5.5（经 base_env 显式意图而非 build_child_env 内生成）。
- 或在 pi-web 新增 models.json 写入器 + 明确的「managed models.json」区隔策略。

### 决策 4：桌面 token 安全存储
`tauri-plugin-store`（明文 JSON 落 app_data_dir，弱）vs keyring crate（OS keychain，强，满足 R2.1）。倾向 keyring；跨平台可用性需验证（Windows/Linux）。

### 决策 5：userId 贯通（发现 C）
接缝已留但两端空。需：pi-clouds 桌面 token payload 载 userId/companyId → 经 egress/取钥端点解出 → 若走 B2，在 pi-web 把 userId 贯通到 `KeyResolveInput`（实现 `PerUserKeyResolver` 或等价）；若走 B-pure，userId 消费全在云端，pi-web 侧仅透传桌面 token。

## 4. 工作量与风险

| 组件 | Effort | Risk | 说明 |
| --- | --- | --- | --- |
| pi-clouds 桌面 token 签发/验签 + device 授权流 | M | Medium | attachment-token 有参照，但 device 流从零 + requireCurrentUser 加分支 |
| pi-clouds egress 代理端点（B-pure）**或** 取钥端点（B2） | B-pure: L / B2: S–M | B-pure: High / B2: Medium | B-pure 是完整流式代理 + 链路 B 接线；B2 仅认证取钥 |
| pi-web 桌面壳登录 UI + keychain 存储 + Tauri command/ACL | M | Medium | 零持久化先例，新引 crate；跨平台 keychain 待验 |
| pi-web 本地 runner 走网关（models.json 注入 + userId 贯通） | M | High | 发现 B（无 writer）+ Req 5.5 张力 + pi SDK override 未知 |
| pi-web 未登录降级 + 失效/切号 + 契约容错 | S–M | Low | 顺现有门控/降级惯例 |

## 5. Research Needed（带入 design 深挖）
1. **pi SDK 是否支持 models.json 覆盖路径 / 会话级 override**（决定决策 3 可行性；查 node_modules d.ts，勿信虚构 API）。
2. **「不落本地」的精确定义**：是否允许 sk-gw 短暂驻留本地 server 进程内存（决定决策 1 B-pure vs B2）——需用户在设计评审点确认。
3. **keyring/keychain 跨平台可用性**（macOS/Windows/Linux）与 Tauri 集成方式。
4. **桌面 token 撤销/过期与进行中 runner 会话的收口语义**（R6.1）。
5. **启用开关形态**（编译期 feature vs 运行期 env，类比 `AI_GATEWAY_BASE_URL`）。
6. **pi-clouds egress/取钥端点的认证与 gateway-key-store 链路 B 的运行时接线**（当前未注入）。

## 6. 对 design 阶段的建议
- **首要设计决策 = 决策 1（B-pure vs B2）**，直接决定跨仓工作量与「sk-gw 不落本地」的严格程度；建议在设计中明确 Boundary Commitment 并在设计评审点请用户拍板（尤其「不落本地是否含进程内存」）。
- 采用 **Hybrid（Option C）**：pi-web 复用 main 已有的 X/Y 反代与 e2b env 装配形态（决策 2A + keychain），pi-clouds 新建桌面 token + device 流 +（B-pure 的完整 egress 代理 或 B2 的取钥端点）。
- 明确跨仓边界：**pi-web 拥有**桌面壳登录/存储/注入、本地 runner 网关接线、userId 贯通（若 B2）、降级容错；**pi-clouds 拥有**device 授权、桌面 token 签发/验签、sk-gw 换钥（B-pure）或取钥（B2）、gateway_keys 映射、计费。
- 优先消解 Research Needed #1（models.json override）与 #2（不落本地定义），二者卡住 R3 的落地形态。

---

# 设计阶段补充（discovery + synthesis）

## 7. [已消解 Research #1] pi SDK 支持进程内注入 ModelRegistry — 决策 3 定型

事实源 `@earendil-works/pi-coding-agent@0.80.3` 的 `.d.ts`/`.js`（node_modules）。**结论：本地 runner 可用「进程内注入自定义 ModelRegistry」走网关，复用共享 `auth.json`，完全不碰 `~/.pi/agent/models.json`、不注入独立 agentDir → 天然守 Req 5.5。**

关键 seam（均已查证）：
- `createAgentSessionServices({ agentDir, authStorage?, modelRegistry? })` — `authStorage`/`modelRegistry` 可注入（`core/agent-session-services.d.ts:31,33`）。
- `ModelRegistry.create(authStorage, modelsJsonPath?)` 接受自定义路径；或 `ModelRegistry.inMemory(authStorage)` + `registerProvider(name, {baseUrl, apiKey, authHeader, headers, models})`（`core/model-registry.d.ts:30,31,97`）——**纯内存注入，零落盘**。
- `AuthStorage.create(getAuthPath())` 独立指向共享 `~/.pi/agent/auth.json`（`core/auth-storage.d.ts:59`）。
- provider schema 字段 `baseUrl/apiKey/authHeader` 真实（`core/model-registry.js:156,157,161`）；`authHeader:true` → `Authorization: Bearer ${apiKey}`（`:546-550`）；`apiKey` 支持 `$ENV`/`${VAR}` 解析（`resolve-config-value.d.ts:10-17`）。
- **唯一改动点** = `packages/server/src/runner/option-mapper.ts:281-287`（当前未注入 modelRegistry/authStorage，二者由 SDK 从 agentDir 默认派生）。
- ⚠陷阱：网关 provider 名不得与 `auth.json` 已有 provider 撞名，否则 auth.json 的 key 覆盖 models.json 的 apiKey（`model-registry.js:536-540`）。→ 用独立命名空间如 `pi-cloud`。

**选定：`ModelRegistry.inMemory` + `registerProvider`（纯内存，不落盘）**——比自定义 models.json 文件更简、更安全（网关 baseUrl/token 不落磁盘），直接消解发现 B「pi-web 无 models.json 写入器」的缺口（根本不需要写入器）。

## Design Synthesis（三镜头）

- **Generalization**：runner 的「模型来源」当前硬编码为 agentDir 默认派生。抽象为**可注入的「会话模型来源」seam**（一个函数：给定会话身份 → 产出 `{authStorage, modelRegistry}`）。登录网关态与本地 auth.json 态是该 seam 的两个策略，接口一处、实现两条。
- **Build vs Adopt**：
  - 桌面 token → **Adopt** pi-clouds `attachment-token.ts` 的 HMAC 形态（不自造密码学）。
  - 模型注入 → **Adopt** pi SDK 原生 `inMemory + registerProvider` seam（不建 models.json 写入器）。
  - 安全存储 → **Adopt** OS keychain（keyring crate），非明文文件。
  - device 授权 → **Build**（pi-clouds 无任何现成），形状可参 OAuth 2.0 Device Grant(RFC 8628)，但因桌面壳自带 webview，password-grant→mint 桌面 token 的单端点是更简实现（pi-clouds 侧决定，属外部契约）。
  - 网关代理（B-pure）→ pi-clouds **Build** 云端流式 egress 代理（复用 X/Y 反代**形态**，链路 B 取钥库层已实现）。
- **Simplification**：内存 ModelRegistry 免落盘；不用独立 agentDir 隔离（会连带挪走 auth.json）；模型来源两策略而非可配置多态。

## Design Decisions

### Decision: sk-gw 换钥位置 = B-pure（云端）为提交设计，B2 为评审待确认备选
- **Context**：用户定架构 B「云端 BFF egress，sk-gw 不落本地」；但发现 D=现成 egress 是沙箱 models.json 改写，非 HTTP 端点。
- **Alternatives**：B-pure（pi-clouds 新建云端流式代理，sk-gw 完全不离云）；B2（本地 pi-web server 持 sk-gw 转发，pi-clouds 仅取钥端点，sk-gw 短暂驻本地 RAM）。
- **Selected**：**B-pure** 为提交设计（贴合用户原话「不落本地/云端 BFF」）；runner 内存 registry 的 `baseUrl` 指 pi-clouds egress、`apiKey`=桌面凭据（authHeader→Bearer），换钥在云端。
- **Trade-offs**：B-pure 安全姿态最强但 pi-clouds 工作量最大（完整流式代理）；B2 pi-clouds 轻但 sk-gw 触达本地内存。
- **Follow-up**：设计评审点请用户确认「不落本地是否含本地进程内存」——若允许则可降级 B2 大幅缩 pi-clouds 工作量。

### Decision: 登录 UI 位置 = Hybrid A（server 端 web UI 登录 + 原生壳 keychain 存储）
- **Context**：桌面壳 `frontend/` 是近零脚本 pre-server 静态壳（CSP 锁死），无法承载富登录 UI；架构 B 的 egress 配置是 per-session（runner spawn 时装配），身份无需先于 sidecar 就位。
- **Selected**：登录 UI 作 pi-web web UI 组件（后端就绪后在 webview 渲染，可达 pi-clouds 身份端点）；桌面 token 持久化经**新 Tauri command → OS keychain**（原生壳拥有安全存储）。
- **Rationale**：富 UI 与安全存储各归其位；启动时壳从 keychain 读 token 经 base_env 注入 server 初始态，运行时登录经 server 端点更新内存态。
- **Trade-offs**：数据流有「web UI → server 内存态」与「web UI → Tauri → keychain」两汇；换来时序自洽与最小 CSP 改动。

## Risks & Mitigations（补充）
- 桌面 token 在 webview JS 中短暂出现（登录完成态）——属用户自身身份 token 在自身 webview，同任意 web 登录；at-rest 由 keychain 保护；sk-gw（真正敏感项）在 B-pure 下永不到前端。
- 桌面 token 进 runner 子进程 env（作 egress Bearer）——同今日 providerKeys 的信任边界，且 token 可撤销/短效、仅经 egress 生效，优于今日裸 provider key。**可选强化**：pi-web server 用桌面 token 换一枚 per-session `scope=llm-egress` 窄 token 再下发 runner（复用 `packages/server/src/tokens/` 机制）。
- keychain 跨平台（Windows/Linux）可用性——Research #3 仍需实现期验证；macOS 优先。
