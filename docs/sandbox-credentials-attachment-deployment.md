# 附件后端部署形态指引(自部署运维)

> 对应 spec `sandbox-credentials-v2` Requirement 5(附件面部署形态对齐,文档性任务,不引入代码改动)。
> 拓扑机制本身由 `attachment-backend-pluggable` spec 实现(`PI_WEB_ATTACHMENT_BACKENDS`),
> 本文档只是给自部署运维者的**选型与配置指引**。

## 背景

`sandbox-credentials-v2` 把「凭据是否进沙箱」按接口性质分两面治理:

- LLM 主对话面(Req 2):装配期已切换为 scoped token 代理(见 `docs/sandbox-credentials-v2-design.md`);
- 附件 store 面(Req 5,本文档):**接头已经存在**(`cloud-http` 后端 + token 认证),
  本任务只是把「该怎么选」讲清楚——现状代码不用改,运维配置对了就天然满足「沙箱内不含对象存储静态凭据」。

附件后端拓扑由单一 env `PI_WEB_ATTACHMENT_BACKENDS` 声明(JSON,判别联合 `kind`),
实现见 `packages/server/src/attachment/backends-config.ts`。三种 `kind`:`local-fs`、`s3`、`cloud-http`。
本文档只讨论自部署(无 pi-clouds)场景下 `s3` 与 `cloud-http` 两者的取舍。

## 1. 推荐形态:`cloud-http` 回环(沙箱零静态凭据)

**做法**:自部署时,在宿主自身暴露一个附件 HTTP API(即现有的 `HttpBlobStore`/
`HttpAttachmentRegistry` 服务端点的对应实现,或复用 pi-clouds 侧同构端点),
沙箱内 runner 只经 `X-Pi-Attachment-Token` 这一枚 scoped token 访问该端点——**对象存储
(S3/OSS 等)的 access key / secret key 全程只留在宿主进程,根本不下发进沙箱环境**。

拓扑配置示例(`PI_WEB_ATTACHMENT_BACKENDS`,单行 JSON):

```json
{
  "backends": [
    { "kind": "cloud-http", "name": "attach", "endpoint": "https://your-host/api/attachment", "tokenEnv": "PI_ATTACH_TOKEN" }
  ],
  "write": "attach",
  "registry": { "kind": "cloud-http", "backend": "attach" }
}
```

- `tokenEnv` 只放**变量名**,不放明文 token;明文经该变量名(此例 `PI_ATTACH_TOKEN`)单独下发。
- 认证机制:客户端(`packages/server/src/attachment/http/http-blob-store.ts`)对每个请求发送
  请求头 `X-Pi-Attachment-Token: <token>`,由端点原生校验 scoped token(域=attachment,
  按会话/过期),校验通过后由**宿主进程**代为访问真实对象存储——沙箱侧从始至终只持有这一枚
  可过期、单一作用域的 token。
- 子进程 env 透传(`computePassthroughEnv`,`packages/server/src/attachment/backends-config.ts`)
  对 `cloud-http` 后端只下发拓扑 JSON 本身 + `tokenEnv` 指向的 token 值,**不涉及任何对象存储
  静态凭据变量**。
- 对应 Req 5.2 的验证性确认:当拓扑内**全部**后端(含 `write` 与 `registry` 引用的后端)均为
  `cloud-http` 时,子进程 spawn env 里不会出现任何 `accessKeyEnv`/`secretKeyEnv`/
  `sessionTokenEnv` 类变量(这些字段只在 `s3` 声明里存在,`computePassthroughEnv` 对
  `cloud-http` 分支只处理 `tokenEnv`)。

## 2. 显式选项:`s3` 直连(宿主可信部署)

若运维明确接受「沙箱内进程可读对象存储静态凭据」这一暴露面(例如沙箱与宿主同处一个可信
边界、无需多租户隔离),可以显式选择 `s3` 后端直连,免去自建附件 HTTP 网关的运维成本:

```json
{
  "backends": [
    { "kind": "s3", "name": "store", "bucket": "my-bucket", "region": "us-east-1",
      "accessKeyEnv": "ATTACH_S3_ACCESS_KEY", "secretKeyEnv": "ATTACH_S3_SECRET_KEY" }
  ],
  "write": "store",
  "registry": { "kind": "s3", "backend": "store" }
}
```

**凭据暴露面(必须明确告知运维)**:

- `accessKeyEnv`/`secretKeyEnv`(及可选 `sessionTokenEnv`)指向的宿主 env 变量,其**明文值**
  会被 `computePassthroughEnv` 一并计入子进程 spawn env 下发清单,最终落在沙箱容器的进程
  环境变量中——`s3` 后端下,S3 静态凭据(access key / secret key)**会**进入沙箱环境,
  沙箱内运行的任意代码(含 agent 自身、agent 调用的第三方工具)理论上均可读取
  `process.env` 拿到这两枚凭据,直接对目标 bucket 发起请求(不限于 pi-web 附件协议约定
  的操作范围)。
- 该暴露面在「宿主可信部署」(沙箱与宿主同属同一信任域,或 bucket 本身按最小权限单独隔离,
  凭据泄露的影响面可接受)下是可接受的显式选择;**多租户/零信任场景不建议使用**,应改用
  §1 的 `cloud-http` 回环形态。

## 3. LLM 网关迁移警示:AIGC 三键会被一并剔出沙箱

配置了 LLM 网关(`PI_WEB_LLM_GATEWAY_PUBLIC_BASE` 已设置)后,装配期不再把
`PROVIDER_KEY_NAMES`(`lib/app/config.ts`,10 个真实 provider key 变量)透传进沙箱——
改为逐 provider 签发 scoped LLM token 注入 `PI_LLM_TOKEN_<PROVIDER>`(见
`lib/app/llm-gateway-assembly.ts`)。

**这不是纯 LLM 主对话面的隔离**:`PROVIDER_KEY_NAMES` 里的以下三键**同时是 AIGC
图像工具(newapi/sufy 路由 + DashScope 视觉/生图)在子进程 `execute` 期直接读取的凭据**:

- `NEWAPI_API_KEY`
- `SUFY_API_KEY`
- `DASHSCOPE_API_KEY`

配置网关后这三键会随其余 7 个 provider key 一起被剔出沙箱 env(`providerKeysForE2b = {}`)。
若沙箱内 agent 仍需使用依赖这三键的 AIGC 工具(如 `gpt-image-2`/`gpt-image-2-sufy` 生图、
DashScope 视觉委派),需要以下两条路径之一:

1. **平台部署(有 pi-clouds)**:这三键由 pi-clouds settings UI 走扩展接口面的 env
   注入通道(容器级白名单 secret / configure 帧)单独下发,与 LLM 网关是否启用无关——
   自部署运维若接了 pi-clouds 的 settings UI,可直接沿用这条路径,无需额外配置。
2. **自部署且未接 pi-clouds**:operator 需二选一:
   - **显式透传**:把这三键加进 `PI_WEB_E2B_ENV_PASSTHROUGH`(逗号分隔白名单,
     `packages/server/src/rpc-channel/e2b-config.ts`),例如:

     ```bash
     PI_WEB_E2B_ENV_PASSTHROUGH=NEWAPI_API_KEY,SUFY_API_KEY,DASHSCOPE_API_KEY
     NEWAPI_API_KEY=...
     SUFY_API_KEY=...
     DASHSCOPE_API_KEY=...
     PI_WEB_LLM_GATEWAY_PUBLIC_BASE=https://your-gateway/...
     ```

     该白名单机制会从 `spawnSpec.env` 按变量名逐一透传进沙箱——效果等同网关启用前的
     现状透传,仅作用于这三个显式列出的变量,不影响网关对其余 7 个 provider key 的隔离。
   - **暂不启用 LLM 网关**:不设置 `PI_WEB_LLM_GATEWAY_PUBLIC_BASE`,保持现状全量透传
     (含 warn 日志的渐进兜底路径),等具备平台侧注入能力后再启用网关。

**装配期日志现状**:当前实现(`lib/app/llm-gateway-assembly.ts` + `pi-handler.ts`,
namespace `app:llm-gateway`)只在**网关未配置**时输出一条 warn(提醒可配置网关以让沙箱
不再持有真实凭据);**网关已配置**这一分支目前不区分「AIGC 三键是否已经过其他路径
(平台注入/`PI_WEB_E2B_ENV_PASSTHROUGH`)补齐」——是否需要补齐属于运维在启用网关前
需要自行核对的部署前提,请对照上面两条路径确认后再启用
`PI_WEB_LLM_GATEWAY_PUBLIC_BASE`。
