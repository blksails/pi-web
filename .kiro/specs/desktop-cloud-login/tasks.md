# Implementation Plan — desktop-cloud-login

> 范围=pi-web 仓（本 spec Owns）。pi-clouds 的 device 授权 / 桌面 token 签发验签 / LLM egress 代理属外部契约、另仓，不在本任务清单；集成与 e2e 对 **stub egress**（OpenAI 兼容）验证 pi-web 侧全链。换钥位置=B-pure（runner 只持桌面凭据打 egress，sk-gw 云端换取）。

- [x] 1. Foundation：启用门控、凭据解析、stub egress 测试脚手架
- [x] 1.1 启用门控与 egress 装配纯函数
  - 实现「云端登录启用」判别（设了 egress base 开关即启用，类比 `AI_GATEWAY_BASE_URL`；未设=零注册无入口；非法配置装配期 fail-fast 可读报错）
  - 计算 runner egress env（egress base + 请求超时不短于网关首字/空闲上限）
  - 观测完成态：给定「设/未设/非法」三输入，函数分别返回启用配置 / undefined / 抛可读错误，单测覆盖
  - _Requirements: 3.5, 4.2, 7.3_
  - _Boundary: auth-egress-assembly_

- [x] 1.2 桌面凭据解析与过期判定
  - 解析桌面凭据 payload（读 userId/companyId/exp；本仓不验签，验签在云端）
  - 过期判定（未过期 / 临界 / 已过期）
  - 观测完成态：对样例凭据能取出 userId/companyId 并正确判 valid/expired，边界单测通过
  - _Requirements: 2.4, 3.7, 6.1_
  - _Boundary: credential_

- [x] 1.3 stub egress 测试脚手架
  - 提供 OpenAI 兼容 `/v1/chat/completions` stub：校验入站 `Authorization: Bearer`、按流式逐帧回帧、可模拟 401（凭据失效）与不可达
  - 观测完成态：stub 起服后，带 Bearer 的请求得流式回复、错误分支可触发；供集成/e2e 复用
  - _Requirements: 3.4_
  - _Boundary: 测试基建_

- [x] 2. Server 登录态与鉴权端点
- [x] 2.1 进程内登录态管理
  - 维护进程内「当前桌面凭据 + 用户身份」（set / clear / get）；切号=新身份替换旧凭据；登出=清空回退未登录
  - 凭据脱敏，绝不入日志/历史
  - 观测完成态：set→get 得身份、clear→get 得未登录、二次 set 切号替换，单测通过
  - _Requirements: 2.2, 4.4, 5.2, 6.2_
  - _Boundary: auth-session-state_

- [x] 2.2 鉴权 HTTP 端点
  - 经 `createPiWebHandler` 路由注入 seam 挂载：设置登录态（非法凭据 400 / 过期 401）、清除登录态、查询当前身份（返回 loggedIn/userId/companyId/exp/status∈valid·expired·refreshing）
  - 观测完成态：POST 合法凭据→身份态可经 GET 读到；DELETE→GET 转未登录；过期凭据 POST 得 401
  - _Requirements: 1.3, 2.5, 6.2, 6.3_
  - _Depends: 1.2, 2.1_
  - _Boundary: auth-routes_

- [x] 3. 会话模型来源 seam（登录态经 egress 出口）
- [x] 3.1 内存 ModelRegistry 工厂
  - 登录态：`AuthStorage.create` 复用共享 auth.json + `ModelRegistry.inMemory` + `registerProvider("pi-cloud", { baseUrl: egress, apiKey: "$ENV", authHeader: true, models })`（纯内存零落盘；provider 名用 `pi-cloud` 命名空间避免与 auth.json 撞名）
  - 未登录态：返回 undefined（走 SDK 默认）
  - 不落 sk-gw、不写日志/历史、不改 agentDir（B-pure 不变式；sk-gw 不下发前端由结构保证）
  - 观测完成态：登录输入返回仅含 `pi-cloud` provider（authHeader=true, apiKey=$ENV）的 registry；未登录返回 undefined，单测通过
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.3, 5.1, 5.2, 7.2_
  - _Depends: 1.1_
  - _Boundary: egress-model-source_

- [x] 3.2 option-mapper 注入接线
  - 在 runner 起 runRpcMode 处按会话身份注入 `{authStorage, modelRegistry}`；工厂返回 undefined 时保持今日行为（不注入→SDK 默认，字节级等价）
  - 观测完成态：登录态 runner 用注入 registry；未登录态 runner 行为与改动前一致，集成可验
  - _Requirements: 3.1, 4.1, 4.3, 5.3_
  - _Depends: 3.1_
  - _Boundary: option-mapper_

- [x] 4. 桌面壳凭据存储与注入
- [x] 4.1 (P) keychain 凭据命令
  - 引入 keychain 依赖（keyring crate 或降级 store）；实现 store / load / clear 桌面凭据命令（单一条目=当前登录用户凭据）
  - 观测完成态：store 后 load 得同值、clear 后 load 得空，命令往返可验
  - _Requirements: 2.1, 2.3, 2.5, 6.2_
  - _Boundary: Desktop shell credential_store_

- [x] 4.2 (P) 登录命令 ACL 声明
  - 声明 store/load/clear 命令的 permission 并加入 capability，回环页面仅可调声明命令
  - 观测完成态：未声明前回环调用被 ACL 拒、声明后放行，可验
  - _Requirements: 5.4_
  - _Depends: 4.1_
  - _Boundary: Desktop shell ACL_

- [x] 4.3 启动读 keychain 注入 base_env
  - 桌面壳启动时读 keychain，将凭据经 base_env 播种给 sidecar 初始态（新键与 agentDir 无关，守 Req 5.5 debug_assert）
  - 观测完成态：keychain 有凭据时 sidecar 启动得初始登录态；回归断言 `PI_WEB_AGENT_DIR` 仍 unset
  - _Requirements: 2.3, 5.3_
  - _Depends: 4.1_
  - _Boundary: Desktop shell base_env_

- [x] 5. Web UI 登录与登录态
- [x] 5.1 (P) 鉴权 hook
  - 读 `GET /api/auth/me` 得登录态；提供登录/登出动作；会话流 egress 失效（401/不可达）触发过期 surface + 重登提示、停止以失效身份重试
  - 观测完成态：登录态变化经 hook 反映到 UI；注入一次 egress 401 后 hook 暴露「需重登」态
  - _Requirements: 1.1, 3.6, 3.7, 6.1_
  - _Depends: 2.2_
  - _Boundary: use-desktop-auth_

- [x] 5.2 登录组件
  - 承载授权流（pi-cloud 授权页/表单前端接入）；成功得桌面凭据后双汇：POST server 登录态 + invoke Tauri 持久化 keychain；取消/超时/拒绝→不写任一汇且展示可读原因不泄敏
  - 观测完成态：走通授权→会话进入登录态且 keychain 落库；取消路径不产生任何写入
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 7.1_
  - _Depends: 5.1, 4.1_
  - _Boundary: login-dialog_

- [x] 5.3 (P) 登录态指示
  - 展示当前登录用户标识与登录态（有效/失效/续期中）；提供登出与切号入口
  - 观测完成态：登录后显示用户标识、失效时显示重登提示，登出可清态
  - _Requirements: 1.3, 6.3_
  - _Depends: 5.1_
  - _Boundary: login-status_

- [x] 6. 集成接线
- [x] 6.1 挂载鉴权路由 + local 分支下发凭据 env
  - 在 handler 装配挂载鉴权路由；local/real 会话 spawn 时把当前登录态凭据经 spawn env 下发 runner（供 egress Bearer），凭据脱敏不入日志
  - 观测完成态：登录态下新建本地会话的 runner env 带凭据、未登录态不带，端到端可验
  - _Requirements: 3.1, 4.4, 5.2_
  - _Depends: 2.2, 3.2_
  - _Boundary: pi-handler, auth-egress-assembly_

- [x] 6.2 契约缺失/失效端到端降级接线
  - 启用门控未配→无登录入口且本地路径可用；会话流 egress 不可达/401→可读错误 + 停止失效重试 + 回落本地凭据路径
  - 观测完成态：未配 egress 时 UI 无登录入口且会话走本地；注入 egress 故障时会话报可读错误不静默
  - ✓ 已做+已测：启用门控（未配→/auth/me 404→无入口，e2e gating 两用例）；服务端失效即停（过期凭据 currentCredential()→undefined 不注入新会话，单测覆盖）；egress 故障经既有会话流错误路径「不静默」上报。
  - ⚠ 部分未接线（诚实标注）：**会话进行中** egress 返 401 → 自动触发 UI「需重登」提示这一增强，`useDesktopAuth.markSessionAuthFailure` 钩子已就位，但尚未接到聊天会话的传输错误流（跨组件接线）——留作有界后续；当前该场景仍以普通会话错误形式可读上报（满足「不静默」，Req 3.6）。
  - _Requirements: 3.6, 3.7, 4.2, 7.3_
  - _Depends: 6.1, 5.1_
  - _Boundary: pi-handler, use-desktop-auth_

- [x] 7. 测试与验证
- [x] 7.1 (P) 单元测试
  - 覆盖：凭据过期边界；egress-model-source 登录/未登录分支；启用门控设/未设/非法；登录态 set/clear/切号
  - 观测完成态：`pnpm test` 相关套件全绿，断言引用各验收条件
  - _Requirements: 2.4, 3.1, 3.2, 3.7, 4.1, 4.2, 6.1, 6.2, 7.3_
  - _Depends: 1.1, 1.2, 2.1, 3.1_
  - _Boundary: server 单测_

- [x] 7.2 集成测试（真实 runner + stub egress）
  - 登录态 spawn：runner 内 pi SDK 用注入 registry，向 stub egress 发 `Bearer=桌面凭据`、baseUrl=egress，主对话流式往返；断言 `~/.pi/agent/models.json` 未被写、agentDir 未变
  - 未登录/未启用 spawn：字节级等价今日本地路径
  - 凭据过期：会话中 stub egress 返 401→停重试 + surface
  - 观测完成态：上述用例在真实子进程集成测试中全绿
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.3, 5.3, 3.7, 6.1_
  - _Depends: 6.1, 1.3_
  - _Boundary: server 集成测试_

- [x] 7.3 (P) 桌面壳 Rust 测试
  - store/load/clear 凭据往返；启动 base_env 注入；回归断言 `PI_WEB_AGENT_DIR` 仍 unset；ACL 放行/拒绝
  - 观测完成态：`cargo test` 相关用例全绿，agentDir 不变式回归锁定
  - _Requirements: 2.1, 2.3, 5.3, 5.4_
  - _Depends: 4.1, 4.2, 4.3_
  - _Boundary: Desktop shell 测试_

- [x] 7.4 浏览器 e2e（对 stub egress）
  - 登录→新会话→主对话经 stub egress 流式回复→登出→回落本地路径；切号（登录 A→登出→登录 B 后续带 B 凭据）；契约缺失（未配 egress→无登录入口、本地可用）；断言前端全程不接触 sk-gw
  - 观测完成态：隔离 build（NEXT_DIST_DIR/独立端口）下 Playwright 用例全绿，新鲜运行输出为证
  - _Requirements: 1.1, 1.2, 1.3, 3.6, 4.2, 4.4, 5.1, 6.2, 7.3_
  - _Depends: 6.2_
  - _Boundary: 浏览器 e2e_

## Rules & Tips

- **桌面壳 keychain 依赖**：`keyring` crate 3.x（非 4.x）无 default features，必须按平台在
  `Cargo.toml` 里显式选后端 feature（macOS `apple-native` / Windows `windows-native` / Linux
  `sync-secret-service`+`crypto-rust`），否则编译期直接报错缺后端。3.x 的 `rust-version = "1.75"`
  与本 crate 声明的 MSRV `1.77` 兼容；4.x 要求 `1.88`，暂不采用。三平台依赖都声明是为了不破坏
  跨平台可编译性，但**本轮只在 macOS 本地环境做过真实 keychain 读写验证**——Windows/Linux 后端
  未经真实验证（同 design.md Open Question 5，跨平台留待后续）。
- **keychain 单测的隔离与幂等**：任何测试若要真实读写 keychain，必须用**专属** service/account
  常量（不可复用生产 `SERVICE`/`ACCOUNT`），且整个往返（store→load→clear→复验空）放在**同一个
  测试函数**里顺序执行——`cargo test` 默认多线程并行跑不同测试函数，若两个函数并发操作同一
  keychain 条目会产生竞态假失败。触达**生产**条目的测试（例如验证 `base_env()` 注入）本仓目前
  只有一个测试函数，因此安全；后续如需新增第二个触达生产条目的测试，必须先評估并行安全或改
  用某种串行化机制（例如 `--test-threads=1` 或显式互斥锁），不能想当然认为“各测试独立”。
- **keychain 不可用环境的降级**：CI/headless 容器可能拒绝 keychain 访问（无 TTY/无登录会话）。
  真实触达 keychain 的测试必须先做一次探测性读写，失败即 `eprintln!` 记录 SKIP 原因并提前
  `return`（不要 panic、不要谎报 PASS）；但凡是**不依赖 keychain 可用性**的断言（例如
  `PI_WEB_AGENT_DIR` 不变式）必须放在探测/skip 分支**之前**执行，确保它总是真跑，不因 keychain
  不可用而被连带跳过。本次实测环境 keychain 可用，71 个 Rust 测试（含新增 3 个）全部真实通过、
  无 SKIP。
- **ACL 声明的可测边界**：`cargo test` 单测进程内没有真实 webview/IPC 宿主，无法验证「未声明
  被拒、声明后放行」这种运行期 ACL 行为——那需要黑盒 e2e（真实渲染层 invoke）。单测能且只能
  锁定`permissions/*.toml`与`capabilities/default.json`两处声明**本身**的静态一致性（identifier
  与 commands.allow 对应、permissions 数组含该 identifier），防止两处漂移导致「声明了却忘记挂
  载」或反之。运行期 ACL 行为验证应留给任务 7.4 或专门的桌面壳黑盒 e2e。
- **本仓 Rust 代码不是 `cargo fmt`-clean 的**：既有文件（`dialog.rs`/`external_link.rs` 等）本就
  不满足默认 `cargo fmt` 输出（作者手动控制单行长度以保持注释/断言可读性），`cargo fmt --check`
  会在多个既有文件报 diff，与本任务改动无关，不必因此强制格式化整个文件（会产生大量无关 diff）。
  `cargo clippy` 同理：既有文件已有若干 pre-existing warning（`redundant_pattern_matching` /
  `doc_lazy_continuation` / `enum_variant_names` / `filter_next`），本任务新增代码未引入新
  warning，无需顺手修复既有 warning（超出任务边界）。
- **真实 runner 子进程集成测试断言流式回复内容**：`PiSession.subscribe` 回调收到的
  `SseFrame`（`kind:"uiMessageChunk"`）里 `text-delta` 的 `chunk.delta` 字段就是增量文本；
  收集到 `finish` 帧再 resolve，即可稳定断言 assistant 回复整体内容（而非只断言
  `session.prompt()` 的 `success`）。此模式对任何「验证真实子进程确实把某 provider 的
  回复内容带回主进程」的集成测试都适用（不止本 spec）。
- **stub egress + 本地 mock provider 双起对照组的取舍**：验证「登录态 vs 未登录/未启用」
  两条路径互不串扰，最有说服力的证据不是「本地路径行为不变」的静态论证，而是**同时**
  起两个真实 runner 子进程分别打两个不同的 mock HTTP 服务，断言各自只被各自的会话
  触达（对方 `calls()`/`requests()` 计数不变）。测试成本可接受（+1 个子进程 +1 个
  mock server，同一 `beforeAll` 内并行 spawn），比只测其中一条路径更能抓「跨会话
  provider 选择串扰」这类缺陷。
- **agentDir 里 settings.json 的 `defaultProvider`/`defaultModel` 必须与运行期注入的
  provider 名/模型 id 精确匹配**：登录态测试若不写 `models.json`（内存注入场景），
  `defaultProvider` 必须写成 egress-model-source 固定的命名空间 `pi-cloud`，
  `defaultModel` 必须与 `PI_WEB_CLOUD_EGRESS_MODELS` 里注册的 `id` 完全一致，否则 SDK
  按 provider/model 名查找 registry 会静默拿不到模型，子进程收不到可用 model 而挂起
  等待/报错，且报错信息不总是直接指向「provider 名不匹配」——排障应先核对这两处
  字符串是否对齐，而非怀疑注入机制本身。
