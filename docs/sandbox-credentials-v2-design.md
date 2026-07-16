# 沙箱凭据保护 v2:分面 scoped token 代理认证 + 扩展接口 env 覆盖(pre-spec 设计稿)

> 状态:讨论稿(pre-spec)。取代被搁置的 fetch-bridge 全局 fetch 接管方案(分支
> `feat/aigc-key-proxy`,尖 09e860f,保留不合 main)。本稿基于 main(9776eb5)现状盘点。

## 1. 背景与教训

前方案(fetch-rpc-bridge + fetch-bridge-request-rewrite)用「沙箱全局 fetch 接管 +
宿主转发器 token-as-key 换真实 key / SigV4 重签」实现凭据不进沙箱。技术上双后端
(MinIO + 真实 aliyun OSS)live 全通,但被判定**过于侵入**而整体搁置:

- 接管全局 `fetch` 改变了沙箱内所有代码的网络语义,影响面不可控;
- 所有出站流量被迫经宿主转发器,单点、且引入 undici 版本混搭类环境脆弱性
  (实测踩中 npm undici@8.5 全局 dispatcher 与内置 fetch 混搭拒绝重复 content-length);
- token 伪装成上游 key(冒充 OpenAI key、冒充 S3 AK/SK 再重签)语义太绕,
  每接一种上游协议就要多一种「重写」逻辑,复杂度随协议数线性增长。

## 2. 原则(定稿输入)

1. **按接口性质分两面**:
   - **平台基础配额面**——LLM 主对话模型、附件 store API 这类云平台本身会提供的
     基础服务:在沙箱中实现**统一的 token 代理认证**。沙箱只持 scoped token,
     平台服务端点**原生校验该 token**(不是伪装成上游 key),真实上游凭据零进沙箱。
   - **扩展接口面**——AIGC 等 agent 带来的扩展 API 调用:凭据经 **pi-clouds
     settings UI** 配置,以 **env 变量覆盖**方式注入沙箱,凭据管理与注入归平台层。
2. **代理 token 是多种、分作用域的**:按 provider、按 store 分别签发,
   一枚 token 只开一扇门——可独立过期/吊销/审计/计配额,一枚泄露只损失单面。
3. **pi-web 仅实现必要的接头**:不做全局 fetch 接管、不做转发器协议重写;
   网关/校验端点本体归平台(pi-clouds),pi-web 提供装配期接线与开发期替身。

## 3. 现状资产盘点(main 9776eb5 + pi-clouds 主仓)

盘点结论:三个面各自都已有基础,v2 是**收敛与补缺**,不是新建。

### 3.1 AIGC 扩展面 —— env 覆盖接头已在 main;aigc-proxy **定为废弃**

- tool-kit provider 端点全部支持 env 覆盖占位符:`${NEWAPI_BASE_URL:-默认}` +
  `apiKeyVar`(`packages/tool-kit/src/aigc/providers/*.ts`),运行期
  `var-resolver.ts` 从 runner 进程 env 展开——**env 覆盖接头天然存在,这就是
  扩展面需要的全部 pi-web 侧接头**。
- main 上现存 aigc-proxy(`packages/server/src/aigc-proxy/` 三件 +
  `lib/app/aigc-proxy-config.ts` + pi-handler 接线 `lib/app/pi-handler.ts:486-524`
  + `/api/aigc-proxy/:provider/*` 路由挂载):**已定废弃,v2 摘除**。
  理由:扩展面凭据归平台层(settings UI + env 注入),pi-web 不该为扩展接口
  自带反代;其「BASE_URL 覆盖 + token」机制由平台注入实现同等效果
  (BYOK 注真实 key,或平台自己的代理端点 base+token),pi-web 零参与。
- pi-clouds 已有 settings UI:`apps/cloud/app/settings/provider-keys/`
  (org 级 provider-key 管理、掩码、信封加密存 Supabase)+ env 注入双通道
  (容器级白名单 secret `packages/sandbox/src/security/env-injection.ts` +
  configure 帧 `packages/sandbox/src/agent-runner/agent-runner.ts:48-53`)。

### 3.2 附件 store 面 —— token 代理认证已基本成型

- pi-web main 已有 cloud-http 附件后端:`packages/server/src/attachment/http/`
  (HttpBlobStore/HttpAttachmentRegistry,认证 `X-Pi-Attachment-Token`,
  decl 里 `tokenEnv` 只放变量名);沙箱 runner 经同构 `AttachmentStore` 门面
  按透传拓扑走 HTTP+token 回平台,**S3 凭据根本不出现**。
- pi-clouds 已有对应 scoped token:`apps/cloud/lib/attachment-token.ts`
  (payload `{companyId, sessionId, scope:"attachment", exp}`,独立 secret,TTL 8h)。
- 现存缺口:纯 pi-web 自部署(无 pi-clouds)时附件仍走 s3 后端 = S3 凭据经
  `computePassthroughEnv` 进沙箱(`backends-config.ts:309-315`)。

### 3.3 LLM 主对话面 —— 泄露面主体,缺平台网关

- 现状泄露:`lib/app/config.ts` `PROVIDER_KEY_NAMES` 10 个真实 provider key
  从宿主 env 抓取后**自动并入 e2b 透传白名单**进沙箱(pi-handler:493-534,563-571);
  沙箱基座镜像 entrypoint 按容器 env 落 `models.json`。pi-clouds 同样是把真实
  key 经 configure 帧注入(`packages/cloud-app/src/keys/provider-env-map.ts`),
  **无 LLM 网关端点**。
- pi SDK 侧「网关认 token」**零改动可行**:models.json provider 支持
  `baseUrl` 指任意网关 + `apiKey: "$SOME_ENV"` + `authHeader:true` 自动出
  `Authorization: Bearer <token>`;另支持自定义 `headers` 与运行时
  `pi.registerProvider`(`@earendil-works/pi-coding-agent@0.80.3`
  dist/core/model-registry.js:532-565)。

### 3.4 token 基建 —— 已有三种,等待统一

| 现有 token | 签发/校验方 | payload/域 | secret |
|---|---|---|---|
| aigc-proxy 会话 token(**随 aigc-proxy 废弃**) | pi-web 宿主 | `aigc-proxy.v1.` + sessionId+exp | `PI_WEB_AIGC_PROXY_SECRET`(回退 attachment) |
| attachment token | pi-clouds cloud | scope:"attachment" + companyId+sessionId+exp | `PI_CLOUDS_ATTACHMENT_TOKEN_SECRET` |
| registry consume token | pi-clouds registry | scope:"consume" + companyId+exp | `PI_CLOUDS_REGISTRY_CONSUME_TOKEN_SECRET` |

三者都是 HMAC-SHA256 + timingSafeEqual + 独立域,模式一致、实现分散。

## 4. 目标架构

三个面 × 三层(沙箱内 / pi-web / pi-clouds):

```
面           沙箱内(只见 token)              pi-web(接头)                pi-clouds(权威)
─────────── ─────────────────────────────── ─────────────────────────── ─────────────────────────
LLM 主对话   models.json:                    装配期:签发/转发             LLM 网关端点
            baseUrl=<LLM网关>/v1             per-provider LLM token env   /api/llm-gateway/:provider/*
            apiKey=$PI_LLM_TOKEN_<PROVIDER>  + models.json env 组装;      校验 scope=llm:<provider>
            (authHeader:true)               dev 替身网关(本地开发)      换真实 key 转发(流式透传)
                                                                          配额/审计挂此处

附件 store   cloud-http 后端                  (已有)cloud-http 客户端     (已有)attachment API
            X-Pi-Attachment-Token            + tokenEnv 装配              校验 scope=attachment
            = $PI_ATTACH_TOKEN                                            落 OSS/Supabase

AIGC 扩展    *_BASE_URL / *_API_KEY           (已有)env 覆盖占位符;       settings UI 配 BYOK key
            由平台注入覆盖:                  摘除 aigc-proxy;             → 白名单 secret/configure 帧
            BYOK=真实用户key 或               装配期平台注入优先、          注入;或指向平台代理
            平台代理 base+token               宿主透传兜底(可信部署)
```

关键差异 vs 前方案:**没有任何 fetch 层拦截**。每个面走各自协议原生的
认证注入点(models.json 的 apiKey、附件客户端的 token 头、AIGC 的 env 覆盖),
token 就是 token,由端点原生校验,不冒充上游凭据。

### 4.1 LLM 网关详设

网关只做三件事:**认 token → 换真钥 → 字节透传**,不碰协议语义。LLM 上游
清一色 Bearer key,换一个请求头即可——这是它比 fetch-bridge 干净的根本原因
(不存在 SigV4 类逐协议重写;新 provider = 登记表加一行)。

**请求全链路**:

```
沙箱内 pi agent
  models.json(镜像 entrypoint 按 env 生成):
    providers.<id> = { baseUrl: "$PI_LLM_GATEWAY_BASE/<id>",
                       apiKey:  "$PI_LLM_TOKEN_<ID>",
                       authHeader: true, api: <该 provider 的 api 类型> }
  ↓ POST {base}/chat/completions   Authorization: Bearer pw2.llm:<id>.<sid>.<exp>.<sig>

网关 /llm-gateway/:provider/*
  ① 路由:provider=:provider,余部路径+query 原样保留
  ② 认证:verify(token)——域=llm secret 族;scope 须逐字等于 "llm:<provider>"
     (store/他 provider token → 403;过期/无效 → 401)→ 得 {sessionId, companyId?}
  ③ 换钥:登记表 <provider> → { upstreamBase, key }(请求期即时取,不缓存;
     dev=env,生产=平台 key resolver 信封解密)
  ④ 转发:URL = upstreamBase + 余部路径;剥入站 authorization+逐跳头,
     注入 Authorization: Bearer <真实key>;请求 body 缓冲后转发
     (JSON 小体;⚠绝不手动 set content-length——undici 混搭重复头前车之鉴)
  ⑤ 响应:new Response(upstream.body) 字节流透传(SSE 不解析不缓冲);
     client abort → AbortController 传播到上游(主对话常被打断,不传播=上游白烧)
  ⑥ 计量:{companyId, sessionId, provider, status, duration}(配额/审计挂点,
     usage 解析后置)
```

**关键决策**:
- **路径透传,不做端点白名单**:LLM API 面随 `api` 类型各异(chat/completions、
  responses、/v1/messages、embeddings…),白名单追着 SDK 跑必然脆;token 已绑
  provider+会话+过期,滥用面只剩该 provider 其他端点,配额按请求计兜底。
  只限方法 POST/GET。
- **body 零改动**:请求缓冲转发(自动得 Content-Length),响应流原样透传;
  网关零协议知识。
- **dev 替身与生产网关共享契约、不共享实现**:契约=路径形态+token 格式+
  错误码(401 无效/过期、403 scope 不符、404 未登记、502 上游不可达,一律
  不回显 key)+env 名;pi-web dev 版登记表=env(现 PROVIDER_KEY_NAMES 十键),
  pi-clouds 生产版=provider-key resolver(Supabase+信封解密)+配额,token
  payload 多带 companyId。
- **签发与校验永远同侧**(无跨系统 secret 分发):dev=pi-web 装配签/pi-web
  路由验;生产=pi-clouds create-channel 签/pi-clouds 网关验。pi-web 固化的
  只是 env 名与 token 格式契约。
- **装配期切换**:配置 `PI_LLM_GATEWAY_BASE` 时,pi-handler 不再透传
  PROVIDER_KEY_NAMES 真实值,改为逐 provider 签 `llm:<id>` token 注入
  `PI_LLM_TOKEN_<ID>`;镜像 entrypoint 见网关 env 即生成网关形态 models.json。
  未配置 → 现状透传 + warn(渐进启用)。

## 5. token 模型:多种 scoped token(定稿输入 #2)

统一 token 形态(向后兼容三种现有 token 的演进目标):

```
格式:  pw2.<scope>.<sessionId>.<exp>.<sigHex>
scope:  llm:<providerId> | store:<backendName> | consume | ...(可扩展)
签名:  HMAC-SHA256(secret_of_scope_family, "pi-token.v2." + scope + "." + sessionId + "." + exp)
```

(AIGC 扩展面废弃 aigc-proxy 后不再有 pi-web 签发的 token;平台若为扩展面
提供代理端点,token 归平台自管,不占本表 scope。)

- **按面分 secret 族**:LLM 网关、attachment、registry 各自独立 secret
  (沿现状),一族泄露不波及他族。
- **scope 编码进 payload 并参与签名**:校验方先验域再验 scope 匹配自身,
  `llm:newapi` 的 token 打 attachment API 必 401。
- **每会话 × 每 scope 一枚**:装配期按该会话实际启用的 provider/store 逐枚签发,
  注入各自约定的 env(`PI_LLM_TOKEN_NEWAPI`、`PI_ATTACH_TOKEN`、…)。
- 过期:TTL 对齐沙箱最大存活;吊销:平台侧按 sessionId/scope 黑名单(v2 可后置)。
- 现有三种 token 不强迁,新 LLM token 直接用 v2 形态,存量随各自 spec 演进收敛。

## 6. pi-web 侧「必要的接头」(本仓 spec 候选边界)

1. **LLM token 接线(核心新增)**:
   - 装配期(pi-handler e2b/代理模式):不再把 `PROVIDER_KEY_NAMES` 真实值并入
     透传白名单;改为按会话签发 per-provider LLM token,注入
     `PI_LLM_TOKEN_<PROVIDER>` + `PI_LLM_GATEWAY_BASE`;
   - models.json 组装接头:让沙箱内 agent 的 provider 指向网关
     (镜像 entrypoint 按 env 落 models.json 的现有约定即可承载:
     baseUrl=`$PI_LLM_GATEWAY_BASE/<provider>`,apiKey=`$PI_LLM_TOKEN_<PROVIDER>`,
     authHeader:true);
   - **dev 替身网关(可选,待决 #1)**:pi-web 本地开发想验证 token 链路时,
     提供 `/api/llm-gateway/:provider/*` 最小反代路由(登记表+即时读 key+
     流式转发,校验 scope=llm:<provider> 的 v2 token)。平台部署时该 base
     指向 pi-clouds 网关,pi-web 路由不启用。若不做,dev 走「未配置网关 →
     真实 key 透传 + warn」的渐进兜底即可。
2. **token v2 原语**:`packages/server/src/tokens/`——mint/verify(scope 化),
   供 LLM 接线(与可选 dev 网关)用;secret 解析沿
   `PI_WEB_*_SECRET` → `PI_WEB_ATTACHMENT_SECRET` 回退惯例。
3. **摘除 aigc-proxy(废弃决定)**:删 `packages/server/src/aigc-proxy/`、
   `lib/app/aigc-proxy-config.ts`、pi-handler 接线与路由挂载、相关 env
   (`PI_WEB_AIGC_PROXY_PUBLIC_BASE/SECRET`)及测试;AIGC 扩展面回归纯 env
   覆盖:装配期「平台注入优先、宿主透传兜底(可信部署)」,tool-kit 占位符
   机制零改动。
4. **附件面**:接头已有(cloud-http);spec 内只做自部署模式的对齐说明
   (推荐 cloud-http 指向宿主自身附件 API 的回环形态,替代 s3 凭据透传;
   s3 直连保留为「宿主可信部署」显式选项)。

**边界外(归 pi-clouds)**:LLM 网关生产端点、settings UI 扩展(BYOK per-provider
覆盖开关)、env 注入通道、配额/审计;pi-web 侧仅约定 env 名与 token 校验契约。

## 7. 迁移与兼容

- 未配置网关 base(自部署最简形态):行为不变(真实 key 透传),打 warn——
  与 aigc-proxy 现有的「未配置仅告警」策略一致,渐进启用。
- 兼容矩阵:local spawn(继承宿主 env,无沙箱边界)零变化;e2b/ACS 代理模式
  是本方案的全部作用域。
- fetch-bridge 分支资产不复用代码,但复用两条验证结论:aliyun OSS 认 AWS SigV4
  (与本方案无关了);会话 token HMAC 域隔离模式(v2 token 的直接前身)。

## 8. 待决问题(立 spec 前需拍板)

1. **dev 替身 LLM 网关做不做**:不做则本地 dev 无 pi-clouds 时走「真实 key
   透传 + warn」兜底,token 链路只能在平台环境验证;做则 pi-web 多一个最小
   反代路由(仅 dev/自部署启用)。(建议:做,否则 e2e 无法在本仓闭环。)
2. **per-provider token vs 单枚 LLM token**:严格按 provider 分(定稿输入 #2)
   ——确认沙箱 env 注入的键数量上限无碍(每 provider 两个 env)。
3. **models.json 落地通道**:沿用「镜像 entrypoint 按容器 env 落盘」约定,
   还是 pi-web 侧直接生成 models.json 内容经 configure 帧/文件注入?
   (建议:沿用 entrypoint 约定,镜像侧加网关模板分支,改动最小。)
4. **aigc-proxy 摘除的时机**:与 LLM 接线同 spec 一并做(推荐,一次换血),
   还是先独立摘除?摘除后 AIGC 三键在无平台注入时回归宿主透传,
   行为等同「未配置代理」现状,无功能回退。
5. pi-clouds 侧网关端点、settings UI 扩展面注入的立项与排期(兄弟仓 spec,
   不在本仓;本仓只固化 env 名与 token 校验契约)。
