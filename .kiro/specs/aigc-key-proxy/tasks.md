# Implementation Plan — aigc-key-proxy

- [ ] 1. Foundation:Router 尾段通配能力
- [x] 1.1 实现模板尾段 `*` 匹配并以单测钉死语义
  - 模板尾段为 `*` 时放宽段数约束(`*` 可匹配零段),余段逐段 decodeURIComponent 后以 `/` 连接存入 `params["*"]`
  - 非通配模板匹配语义零变化;通配路由与精确路由共存时先注册先赢(内置在前);path 匹配但方法不符仍走 405
  - `*` 仅在尾段位置生效,中段 `*` 保持字面量语义(向后兼容)
  - 观察:router 单测新增用例(通配匹配零段/一段/多段、`params["*"]` 余段还原、精确优先、既有路由行为回归)全绿
  - _Requirements: 2.3_

- [ ] 2. 核心模块(三者边界互不重叠,可并行)
- [x] 2.1 (P) 会话凭据模块:签发与校验
  - token 格式 `pwap1.<sessionId>.<exp>.<sigHex>`,HMAC-SHA256,签名域前缀 `aigc-proxy.v1.` 与附件签名隔离
  - 校验顺序:格式 → 过期(注入时钟便于测试)→ timingSafeEqual 常量时间签名比对,失败返回判别原因(malformed/expired/bad-signature)不抛
  - secret 解析:`PI_WEB_AIGC_PROXY_SECRET` 优先,回退 `PI_WEB_ATTACHMENT_SECRET`,皆缺时抛清晰错误;sessionId 含 `.` 拒签
  - 观察:单测覆盖同 secret 互验通过、篡改 sessionId/exp/sig 任一字段必失败、过期判定、含点拒签,全绿
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Boundary: session-token_

- [x] 2.2 (P) provider 登记表
  - 静态映射 newapi/sufy/dashscope → { 上游 base, 真实 key 的 env 变量名 };上游 base 与 tool-kit 占位默认字面量逐字一致
  - 真实 key 在请求期从宿主 env 读取不缓存;未知 provider 查表返回 undefined
  - 观察:查表单测(三命中 + 未知返回 undefined + 上游 base 与 tool-kit 字面量一致性断言)全绿
  - _Requirements: 2.2_
  - _Boundary: provider-registry_

- [x] 2.3 (P) 工具侧网关地址占位化
  - newapi/sufy 的 baseUrl 与 dashscope 的 BASE 常量改为 `${X_BASE_URL:-<原字面量>}`(三键独立);dashscope 异步轮询 URL 由同一 BASE 拼接自动跟随
  - 保持模块顶层不读 process.env 的双入口约束(占位为字符串字面量,展开发生在执行期)
  - 观察:集成测试证明 env 设 `NEWAPI_BASE_URL` 指 stub 时请求打到 stub、未设时打默认字面量;既有 aigc 全部测试零回归
  - _Requirements: 5.1, 5.2, 5.3_
  - _Boundary: tool-kit provider 声明_

- [ ] 3. 代理路由段
- [x] 3.1 代理转发处理器与注入路由工厂
  - 处理顺序:provider 查表(未登记→404 且零上游请求)→ Bearer token 校验(缺失/无效/过期→401 且零上游请求,对外文案不区分原因)→ 宿主真实 key 查 env(缺失→502,文案提示宿主未配凭据、不含 key 值)→ 转发
  - 转发:请求 headers 剔除 host/authorization/content-length/逐跳头后透传(content-type 的 multipart boundary、x-dashscope-async、accept 保留),注入真实 key 的 authorization;请求体 `duplex:"half"` 流式透传;响应以 `Response(upstream.body)` 流式透传状态码与过滤后 headers
  - 上游 4xx/5xx 状态与体原样透传;fetch 网络错误→502、超时→504,错误体固定脱敏文案
  - 日志(`server:aigc-proxy` 命名空间)仅记 sessionId/provider/path/status/耗时,authorization 与 token 全文绝不落日志
  - server 包 barrel(`packages/server/src/index.ts`)导出 aigc-proxy 模块,遵守「barrel 不得重导出含 pi SDK 取数」约束(本模块不 import pi SDK)
  - 观察:工厂产出可注入的 InjectedRoute 数组;处理器门控顺序与错误映射的单测全绿
  - _Depends: 1.1, 2.1, 2.2_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.2, 4.3_

- [x] 3.2 真实 HTTP stub 上游集成测试
  - 起 node:http stub 上游:有效 token → stub 收到 `Bearer <真实key>` 且响应体透传;无效/过期 token → 401 且 stub 零请求;未知 provider → 404 且零请求
  - 流式:stub 发 SSE 分片 → 调用方按片增量收到(非一次性);multipart 请求体 → stub 收到 boundary 完整的原始字节
  - 错误:stub 返回 400/500 → 状态码与体透传;上游端口不通 → 502 且响应体不含真实 key
  - 观察:集成测试文件全绿
  - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 3.3_

- [ ] 4. 宿主接线
- [x] 4.1 配置解析与 fail-fast 校验
  - config 层收原始 `PI_WEB_AIGC_PROXY_PUBLIC_BASE` 与 aigc 网关键子集常量(NEWAPI/SUFY/DASHSCOPE 三键);解析函数校验 http/https,非法值抛携带变量名与三种修复路径的清晰错误,未设返回 undefined
  - token TTL 计算:e2b 沙盒超时 + 安全余量,可被 `PI_WEB_AIGC_PROXY_TOKEN_TTL_MS` 独立覆盖
  - 沙盒网关 env 构造:publicBase 尾斜杠归一后拼 `/api/aigc-proxy/<provider>`,产出六键(三 BASE_URL + 三 API_KEY=token)
  - 观察:单测(合法通过/非法抛错含指引/未设 undefined/TTL 优先级/尾斜杠归一/六键形状)全绿
  - _Requirements: 1.4, 3.2_

- [x] 4.2 e2b 分支注入切换与路由注入
  - e2b 分支在会话创建路径调用配置校验:非法地址 → 会话创建以清晰错误失败,不静默回退透传
  - 代理模式:签发会话 token;`e2bSpec.env` 以 providerKeys 剔除三真实网关键后并入、再并入六 gateway 键;envPassthrough 同步(三真实键名不出现、六键并入)
  - 兼容模式(未配置):注入逻辑与现状逐键一致,输出含 `aigc-proxy` 可检索标识的警告日志
  - handler 装配的 routes 数组注入代理路由工厂(secret 与 token 签发同源)
  - 观察:集成测试断言(代理模式下 env 与白名单无三真实键、六键形状正确且 API_KEY 值为合法 token;兼容模式与现状一致且有警告日志;非法地址会话创建失败且错误含修复指引;local 分支在配置代理与否两种情况下 spawnSpec 逐键一致)全绿
  - _Depends: 2.1, 3.1, 4.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1_

- [ ] 5. 端到端验证
- [ ] 5.1 核心链路 e2e(无 e2b 依赖)
  - 起真实 pi-web server(代理路由启用,宿主 env 含真实 key `sk-real-e2e`)+ node:http stub 上游;独立子进程 env 仅含代理地址与会话 token(无真实 key),经真实 runEndpoint 发起文生图
  - 断言:产物 b64 正确回传;stub 收到且仅收到 `Bearer sk-real-e2e`;子进程 env 全程无 `sk-real-e2e`;工具错误语义:过期 token → 401
  - 观察:e2e 脚本 exit 0 并输出断言摘要
  - _Depends: 2.3, 4.2_
  - _Requirements: 2.1, 3.3, 4.1, 5.2_

- [ ] 5.2 全量回归
  - server 与 tool-kit 全部单测+集成测试全绿;既有 e2e:node 基线不回退(config-domains/webext-build-load 既有失败除外)
  - 观察:测试命令输出计数全绿,与实现前基线对比无新增失败
  - _Requirements: 1.3, 5.1_

- [ ]* 5.3 e2b 沙盒全链回归(条件跑)
  - 既有 e2e:sandbox-browser 基建(kind 集群/凭据)可用时:沙盒内生图经宿主代理完成,验收 2.1/4.1 在真实沙盒环境成立
  - 缺基建/凭据时 SKIP(exit 0),不阻塞本 spec 完成判定
  - _Requirements: 2.1, 4.1_

## Implementation Notes
- 「三真实键名不出现」是速记:语义为真实**值**不出现——六键含三个与真实键同名的 `*_API_KEY`(值=会话 token),断言按值做(4.2 复核确认)
- 代理路由注册门控在 config.aigcProxyPublicBase;secret 皆缺在装配期(buildSingleton)抛,属合理 fail-fast
- e2b 闭包断言技术:捕获 transport 构造参数 + 惰性 FakeChannel 经 getHandler()+createSession() 走真实路径(沿 e2b-env-assembly.test.ts 惯例,无需抽纯函数)
