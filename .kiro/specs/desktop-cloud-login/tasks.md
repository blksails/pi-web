# Implementation Plan — desktop-cloud-login

> 范围=pi-web 仓（本 spec Owns）。pi-clouds 的 device 授权 / 桌面 token 签发验签 / LLM egress 代理属外部契约、另仓，不在本任务清单；集成与 e2e 对 **stub egress**（OpenAI 兼容）验证 pi-web 侧全链。换钥位置=B-pure（runner 只持桌面凭据打 egress，sk-gw 云端换取）。

- [ ] 1. Foundation：启用门控、凭据解析、stub egress 测试脚手架
- [ ] 1.1 启用门控与 egress 装配纯函数
  - 实现「云端登录启用」判别（设了 egress base 开关即启用，类比 `AI_GATEWAY_BASE_URL`；未设=零注册无入口；非法配置装配期 fail-fast 可读报错）
  - 计算 runner egress env（egress base + 请求超时不短于网关首字/空闲上限）
  - 观测完成态：给定「设/未设/非法」三输入，函数分别返回启用配置 / undefined / 抛可读错误，单测覆盖
  - _Requirements: 3.5, 4.2, 7.3_
  - _Boundary: auth-egress-assembly_

- [ ] 1.2 桌面凭据解析与过期判定
  - 解析桌面凭据 payload（读 userId/companyId/exp；本仓不验签，验签在云端）
  - 过期判定（未过期 / 临界 / 已过期）
  - 观测完成态：对样例凭据能取出 userId/companyId 并正确判 valid/expired，边界单测通过
  - _Requirements: 2.4, 3.7, 6.1_
  - _Boundary: credential_

- [ ] 1.3 stub egress 测试脚手架
  - 提供 OpenAI 兼容 `/v1/chat/completions` stub：校验入站 `Authorization: Bearer`、按流式逐帧回帧、可模拟 401（凭据失效）与不可达
  - 观测完成态：stub 起服后，带 Bearer 的请求得流式回复、错误分支可触发；供集成/e2e 复用
  - _Requirements: 3.4_
  - _Boundary: 测试基建_

- [ ] 2. Server 登录态与鉴权端点
- [ ] 2.1 进程内登录态管理
  - 维护进程内「当前桌面凭据 + 用户身份」（set / clear / get）；切号=新身份替换旧凭据；登出=清空回退未登录
  - 凭据脱敏，绝不入日志/历史
  - 观测完成态：set→get 得身份、clear→get 得未登录、二次 set 切号替换，单测通过
  - _Requirements: 2.2, 4.4, 5.2, 6.2_
  - _Boundary: auth-session-state_

- [ ] 2.2 鉴权 HTTP 端点
  - 经 `createPiWebHandler` 路由注入 seam 挂载：设置登录态（非法凭据 400 / 过期 401）、清除登录态、查询当前身份（返回 loggedIn/userId/companyId/exp/status∈valid·expired·refreshing）
  - 观测完成态：POST 合法凭据→身份态可经 GET 读到；DELETE→GET 转未登录；过期凭据 POST 得 401
  - _Requirements: 1.3, 2.5, 6.2, 6.3_
  - _Depends: 1.2, 2.1_
  - _Boundary: auth-routes_

- [ ] 3. 会话模型来源 seam（登录态经 egress 出口）
- [ ] 3.1 内存 ModelRegistry 工厂
  - 登录态：`AuthStorage.create` 复用共享 auth.json + `ModelRegistry.inMemory` + `registerProvider("pi-cloud", { baseUrl: egress, apiKey: "$ENV", authHeader: true, models })`（纯内存零落盘；provider 名用 `pi-cloud` 命名空间避免与 auth.json 撞名）
  - 未登录态：返回 undefined（走 SDK 默认）
  - 不落 sk-gw、不写日志/历史、不改 agentDir（B-pure 不变式；sk-gw 不下发前端由结构保证）
  - 观测完成态：登录输入返回仅含 `pi-cloud` provider（authHeader=true, apiKey=$ENV）的 registry；未登录返回 undefined，单测通过
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.3, 5.1, 5.2, 7.2_
  - _Depends: 1.1_
  - _Boundary: egress-model-source_

- [ ] 3.2 option-mapper 注入接线
  - 在 runner 起 runRpcMode 处按会话身份注入 `{authStorage, modelRegistry}`；工厂返回 undefined 时保持今日行为（不注入→SDK 默认，字节级等价）
  - 观测完成态：登录态 runner 用注入 registry；未登录态 runner 行为与改动前一致，集成可验
  - _Requirements: 3.1, 4.1, 4.3, 5.3_
  - _Depends: 3.1_
  - _Boundary: option-mapper_

- [ ] 4. 桌面壳凭据存储与注入
- [ ] 4.1 (P) keychain 凭据命令
  - 引入 keychain 依赖（keyring crate 或降级 store）；实现 store / load / clear 桌面凭据命令（单一条目=当前登录用户凭据）
  - 观测完成态：store 后 load 得同值、clear 后 load 得空，命令往返可验
  - _Requirements: 2.1, 2.3, 2.5, 6.2_
  - _Boundary: Desktop shell credential_store_

- [ ] 4.2 (P) 登录命令 ACL 声明
  - 声明 store/load/clear 命令的 permission 并加入 capability，回环页面仅可调声明命令
  - 观测完成态：未声明前回环调用被 ACL 拒、声明后放行，可验
  - _Requirements: 5.4_
  - _Depends: 4.1_
  - _Boundary: Desktop shell ACL_

- [ ] 4.3 启动读 keychain 注入 base_env
  - 桌面壳启动时读 keychain，将凭据经 base_env 播种给 sidecar 初始态（新键与 agentDir 无关，守 Req 5.5 debug_assert）
  - 观测完成态：keychain 有凭据时 sidecar 启动得初始登录态；回归断言 `PI_WEB_AGENT_DIR` 仍 unset
  - _Requirements: 2.3, 5.3_
  - _Depends: 4.1_
  - _Boundary: Desktop shell base_env_

- [ ] 5. Web UI 登录与登录态
- [ ] 5.1 (P) 鉴权 hook
  - 读 `GET /api/auth/me` 得登录态；提供登录/登出动作；会话流 egress 失效（401/不可达）触发过期 surface + 重登提示、停止以失效身份重试
  - 观测完成态：登录态变化经 hook 反映到 UI；注入一次 egress 401 后 hook 暴露「需重登」态
  - _Requirements: 1.1, 3.6, 3.7, 6.1_
  - _Depends: 2.2_
  - _Boundary: use-desktop-auth_

- [ ] 5.2 登录组件
  - 承载授权流（pi-cloud 授权页/表单前端接入）；成功得桌面凭据后双汇：POST server 登录态 + invoke Tauri 持久化 keychain；取消/超时/拒绝→不写任一汇且展示可读原因不泄敏
  - 观测完成态：走通授权→会话进入登录态且 keychain 落库；取消路径不产生任何写入
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 7.1_
  - _Depends: 5.1, 4.1_
  - _Boundary: login-dialog_

- [ ] 5.3 (P) 登录态指示
  - 展示当前登录用户标识与登录态（有效/失效/续期中）；提供登出与切号入口
  - 观测完成态：登录后显示用户标识、失效时显示重登提示，登出可清态
  - _Requirements: 1.3, 6.3_
  - _Depends: 5.1_
  - _Boundary: login-status_

- [ ] 6. 集成接线
- [ ] 6.1 挂载鉴权路由 + local 分支下发凭据 env
  - 在 handler 装配挂载鉴权路由；local/real 会话 spawn 时把当前登录态凭据经 spawn env 下发 runner（供 egress Bearer），凭据脱敏不入日志
  - 观测完成态：登录态下新建本地会话的 runner env 带凭据、未登录态不带，端到端可验
  - _Requirements: 3.1, 4.4, 5.2_
  - _Depends: 2.2, 3.2_
  - _Boundary: pi-handler, auth-egress-assembly_

- [ ] 6.2 契约缺失/失效端到端降级接线
  - 启用门控未配→无登录入口且本地路径可用；会话流 egress 不可达/401→可读错误 + 停止失效重试 + 回落本地凭据路径
  - 观测完成态：未配 egress 时 UI 无登录入口且会话走本地；注入 egress 故障时会话报可读错误不静默
  - _Requirements: 3.6, 3.7, 4.2, 7.3_
  - _Depends: 6.1, 5.1_
  - _Boundary: pi-handler, use-desktop-auth_

- [ ] 7. 测试与验证
- [ ] 7.1 (P) 单元测试
  - 覆盖：凭据过期边界；egress-model-source 登录/未登录分支；启用门控设/未设/非法；登录态 set/clear/切号
  - 观测完成态：`pnpm test` 相关套件全绿，断言引用各验收条件
  - _Requirements: 2.4, 3.1, 3.2, 3.7, 4.1, 4.2, 6.1, 6.2, 7.3_
  - _Depends: 1.1, 1.2, 2.1, 3.1_
  - _Boundary: server 单测_

- [ ] 7.2 集成测试（真实 runner + stub egress）
  - 登录态 spawn：runner 内 pi SDK 用注入 registry，向 stub egress 发 `Bearer=桌面凭据`、baseUrl=egress，主对话流式往返；断言 `~/.pi/agent/models.json` 未被写、agentDir 未变
  - 未登录/未启用 spawn：字节级等价今日本地路径
  - 凭据过期：会话中 stub egress 返 401→停重试 + surface
  - 观测完成态：上述用例在真实子进程集成测试中全绿
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.3, 5.3, 3.7, 6.1_
  - _Depends: 6.1, 1.3_
  - _Boundary: server 集成测试_

- [ ] 7.3 (P) 桌面壳 Rust 测试
  - store/load/clear 凭据往返；启动 base_env 注入；回归断言 `PI_WEB_AGENT_DIR` 仍 unset；ACL 放行/拒绝
  - 观测完成态：`cargo test` 相关用例全绿，agentDir 不变式回归锁定
  - _Requirements: 2.1, 2.3, 5.3, 5.4_
  - _Depends: 4.1, 4.2, 4.3_
  - _Boundary: Desktop shell 测试_

- [ ] 7.4 浏览器 e2e（对 stub egress）
  - 登录→新会话→主对话经 stub egress 流式回复→登出→回落本地路径；切号（登录 A→登出→登录 B 后续带 B 凭据）；契约缺失（未配 egress→无登录入口、本地可用）；断言前端全程不接触 sk-gw
  - 观测完成态：隔离 build（NEXT_DIST_DIR/独立端口）下 Playwright 用例全绿，新鲜运行输出为证
  - _Requirements: 1.1, 1.2, 1.3, 3.6, 4.2, 4.4, 5.1, 6.2, 7.3_
  - _Depends: 6.2_
  - _Boundary: 浏览器 e2e_
