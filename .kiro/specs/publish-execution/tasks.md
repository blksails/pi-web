# Implementation Plan

> **跨两仓**：**[web]** = pi-web worktree `agent-plugin-commands`；**[cloud]** = pi-clouds worktree `registry-org-identity`。
>
> **红线**：不得对真实 registry / 生产库发起任何写。端到端一律用进程内 `createFakeRegistry`。

---

- [x] 1. registry 认得云端签发的发布凭据

- [x] 1.1 **[cloud]** `buildTokenVerifier()` 接上 publish 面 HMAC 校验
  - `apps/registry/src/main.ts`：读 `PI_CLOUDS_REGISTRY_PUBLISH_TOKEN_SECRET`，配了则把
    `HmacPublishTokenVerifier` 组合进去；与既有 consume 分支**同构**（HMAC 主、静态兜底）
  - 两个 secret 各自独立：只配 consume / 只配 publish / 都配 / 都不配，四种组合都要成立
  - 启动日志说明是否启用，**不打印密钥**
  - 完成态：四种 env 组合下 `buildTokenVerifier()` 各返回预期结构；未配 publish secret 时行为与改动前逐字节一致
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - _Boundary: apps/registry/src/main_

- [x] 1.2 **[cloud]** 装配单测
  - `apps/registry/test/token-verifier.test.ts`
  - 覆盖：配 publish secret → HMAC token 解出三元身份；未配 → 该 token 被拒；
    静态 publish token 在**四种**组合下始终可用；consume 面不受影响
  - 完成态：新增用例 ≥ 8 条全绿；既有 apps/registry 测试零改动
  - _Requirements: 7.1_
  - _Depends: 1.1_
  - _Boundary: apps/registry/test_

---

- [x] 2. 结果契约与渲染

- [x] 2.1 **[web]** `PublishPreviewData` 加 `published` 字段 (P)
  - `packages/protocol/src/web-ext/publish-command.ts`：新增 `PublishedResultSchema`
    （`sourceId/version/bundle/channel/channelMoved/publisherId/org`）与可选 `published`
  - **可选**：预览与失败结果不带它 → 既有断言与渲染路径零影响
  - 更新顶部注释：真实发布成功时 `disclaimers` 两位皆 false（该注释早已如此预告）
  - 完成态：`packages/protocol` 测试全绿；既有 publish 相关断言零改动即通过
  - _Requirements: 4.4_
  - _Boundary: packages/protocol/web-ext/publish-command_

- [x] 2.2 **[web]** 渲染器呈现已发布结果
  - `packages/ui/src/chat/publish-preview-renderer.tsx`
  - `published` 存在 → "已发布"块：`sourceId@version`、通道、发布者身份（publisherId/org）、
    **版本不可更改**提示
  - `channelMoved === false` → **单独的醒目提示**，不得渲染成纯成功
  - 既有 disclaimers 布尔位渲染逻辑不动
  - 完成态：新增渲染测试断言两种形态（全成功 / 通道未移）可区分
  - _Requirements: 2.5, 4.1, 5.4_
  - _Depends: 2.1_
  - _Boundary: packages/ui/chat/publish-preview-renderer_

---

- [x] 3. 真实发布编排

- [x] 3.1 **[web]** `publish-execute.ts` — 前置校验层
  - 新建 `lib/app/publish-execute.ts`，接口与流程图见 design.md
  - 顺序（**顺序本身是契约**）：取授予 → 编译 → kind 门 → org 前缀 → 密钥 → 公钥登记 → 发布
  - 无授予 → `PUBLISH_NOT_AVAILABLE`（既有降级语义），且**不编译、不建 adapter**
  - org 前缀本地判定（D2）：`orgOf(sourceId) !== grant.org` → `PUBLISH_ORG_MISMATCH`，
    文案指向"把包 id 前缀改成你的命名空间"，而不是服务端那句"禁止访问"
  - 公钥登记从 best-effort 升为**硬前置**（D3）：没登记则 `registerVersion` 必然验签失败，
    而那次失败会**烧掉一个版本号**
  - 完成态：五道前置各自返回对应 code，且断言 `createPort` **从未被调用**（零外部写）
  - _Requirements: 2.2, 3.1, 3.2, 3.3, 3.4_
  - _Boundary: lib/app/publish-execute_

- [x] 3.2 **[web]** `publish-execute.ts` — 发布与结果映射
  - 构造 `HttpRegistryAdapter{baseUrl, publishToken}` → 调既有 `publish()` 编排器
  - 结果映射按 design.md 的表：全成功 / 通道未移（`ok:true`，部分成功）/
    登记失败（★ 说明含"版本号已被占用，请提版本号"）/ 上传失败（可原版本重试）
  - ★ 登记失败与通道失败的文案给出**相反**指导（改版本号 vs 别改）
  - `RegistryError.detail` **整体丢弃**，只用 `code`（可能内嵌带凭据的 URL）
  - 完成态：结果对象整体序列化后全文搜索授予 token → 零命中
  - _Requirements: 2.1, 2.5, 2.6, 4.1, 4.2, 4.3, 5.1, 5.2, 5.4, 6.1, 6.2_
  - _Depends: 2.1, 3.1_
  - _Boundary: lib/app/publish-execute_

- [x] 3.3 **[web]** 编排单测
  - `test/publish/publish-execute.test.ts`
  - 覆盖 design.md Testing Strategy 的第 5–12 条（含零外部写断言、token 不外泄、
    detail 不外泄、部分成功态）
  - 完成态：新增用例 ≥ 12 条全绿
  - _Requirements: 7.2, 7.3, 7.4, 7.6_
  - _Depends: 3.2_
  - _Boundary: test/publish/publish-execute_

---

- [x] 4. 命令层接线

- [x] 4.1 **[web]** argv 支持 `--channel`
  - `lib/app/package-host-command.ts`：`parseOptions` 收 `--channel <name>`；
    `ValidatedPublish` 加 `channel?`
  - **不引入** `--commit-only`（运维语义，host 面只会多一种用户搞不清的状态）
  - 用法文本同步更新（两条命令各自的 usage）
  - 完成态：`--channel beta` 被解析出来；未给时为 undefined（由下游落缺省）
  - _Requirements: 2.6_
  - _Boundary: lib/app/package-host-command_

- [x] 4.2 **[web]** 非 dry-run 分支接真实发布
  - 替换 `PUBLISH_NOT_AVAILABLE` 分支为 `deps.executePublish?.(...)`；
    **未注入时仍返回 `PUBLISH_NOT_AVAILABLE`**（该部署未接入发布身份，语义不变）
  - dry-run 分支**一字不改**
  - 审计：发布动作与结果落审计事件，**不含**任何凭据
  - 完成态：`--dry-run` 输出与改动前逐字段相同（用既有测试期望值回归比对）
  - _Requirements: 2.1, 5.3, 6.4_
  - _Depends: 3.2, 4.1_
  - _Boundary: lib/app/package-host-command_

- [x] 4.3 **[web]** 装配注入
  - `lib/app/pi-handler.ts`：注入 `executePublish`，依赖取自既有的
    `desktopCapabilitiesClient` / `ensurePublishKey` / `ensurePublishKeyRegistered`
  - 未配置云端 → 不注入（保持既有降级）
  - 完成态：装配处不新增任何 env 依赖
  - _Requirements: 2.2_
  - _Depends: 4.2_
  - _Boundary: lib/app/pi-handler_

- [x] 4.4 **[web]** 命令层测试
  - `test/commands/publish-execute-command.test.ts`
  - 覆盖 design.md Testing Strategy 第 13–17 条，**含 dry-run 对照组**
  - 完成态：新增用例 ≥ 6 条全绿
  - _Requirements: 7.5, 7.6_
  - _Depends: 4.3_
  - _Boundary: test/commands/publish-execute-command_

---

- [x] 5. 端到端与收尾

- [x] 5.1 **[web]** 进程内契约端到端
  - 扩写或新建：用既有 `createFakeRegistry` 走完整链路（签名 → 上传 → 登记 → 通道），
    断言各阶段**按序**发生、bundle 可被安装侧原样取回
  - **无网络**；不触碰任何真实 registry
  - 完成态：链路测试绿，且能观察到调用顺序
  - _Requirements: 7.2, 7.7_
  - _Depends: 3.2_
  - _Boundary: test/publish_

- [x] 5.2 **[web]** 两仓全量测试与基线归因
  - 先跑基线记录存量红（已知：pi-clouds `dist-exports` 1 条、apps/cloud 26 条）
  - pi-web 须跑全部测试面：根 vitest + `packages/{server,ui,tool-kit,protocol}`
  - 完成态：新旧对照表，**新增红为零**
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - _Depends: 1.2, 3.3, 4.4, 5.1_
  - _Boundary: 跨仓验证_

- [x] 5.3 **[web]** 文档收口
  - `docs/registry-publish-identity-design.md`：P2 标为已落地，记下 P3（可见性）的剩余缺口
  - `.kiro/specs/publish-grant-issuance/requirements.md` 实施状态表同步
  - 完成态：无遗留的"未决/待定"表述与代码事实不符
  - _Requirements: —_
  - _Depends: 5.2_
  - _Boundary: docs_

---

## 实施红线

1. **不碰生产**：不对真实 registry 发起任何写。真机验证须先请示。
2. **dry-run 是对照组**：它的输出必须逐字段不变。
3. **凭据零外泄**：授予 token 只进 Authorization 头；`RegistryError.detail` 整体丢弃。
4. **零外部写的前置**：五道前置校验任一失败，都不得已经发出上传/登记请求。

## Implementation Notes

### ★ 本轮最重要的发现:P1 的组件造好了但没接上

`HmacPublishTokenVerifier` 在 spec publish-grant-issuance 就已实现**并有 17 条单测**,
却从未出现在 `apps/registry/src/main.ts` 的 `buildTokenVerifier()` 里。
后果:cloud 签得出 publish token,真实 registry **一律拒绝** —— 而这**不会有任何报错**,
只在真机上表现为"登录了也发不出去"。

已接入(任务 1.1),并把**装配点本身**纳入验收(`apps/registry/test/token-verifier.test.ts`,
四种 env 组合 10 条)。**教训**:为一个组件写了测试 ≠ 它在跑。

### 与设计不同的三处

1. **改了 `publish()` 编排器**(设计里写的是"不改")。
   原因:`setChannel` 失败时它只返回 `{stage:"channel", error}`,**丢掉了 sourceId/version/bundle**,
   上层因此无法呈现"版本已登记、只是通道没移"这个部分成功态(Req 5.4)。
   最小改动:给 `stage:"channel"` 加一个 `registered` 字段。CLI 侧只读 `stage`/`error`,行为不变。
   把 Req 5.4 砍掉的代价更大 —— 那会诱导用户在"通道没移"时去改版本号,而那既没必要也解决不了。

2. **`ensurePublishKeyRegistered` 由布尔改为三态**(`registered`/`already`/`skipped`)。
   把它从 best-effort 升为硬前置时暴露的问题:布尔表示下,"回执命中(已登记)"只能记成 `false`,
   于是真实发布路径会把**已就位**误判成**没就位**而拒绝发布。这是一个原设计没想到的耦合。

3. **`getPublishGrant` 恒注入,不按"有没有云端"分支**。
   未配置云端时它取不到授予,`executePublish` 自己就返回与引入前**逐字相同**的
   `PUBLISH_NOT_AVAILABLE`。判两次 = 两处文案要同步,迟早漂移。

### 跨仓事实(端到端测试踩到)

**pi-web 的 `@pi-clouds/registry-client` 别名指向 pi-clouds 主仓,不是我的 worktree。**
所以 pi-web 侧的进程内契约测试跑的是**旧版 registry 语义** —— P0(`registry-org-identity`,
让 registerVersion 从 token 派生 tenantId 自动建 source)还在 worktree 分支上未合主仓。

表现:自动建 source 会抛
`publisher "acme" has no tenant association yet ... must be provisioned by the platform`。

处理:e2e 夹具里**显式建一次 source**,并注明「P0 合入主仓后可删,届时删掉它反而是一条
有价值的回归断言」。本文件测的是 `executePublish` 这一层的接线,registry 侧的自动建 source 归 P0 管。

### 验证结果(2026-07-28)

| 面 | 结果 |
|---|---|
| pi-web 根 vitest | 1010 passed / 0 failed |
| pi-web packages/server | 2435 passed |
| pi-web packages/ui | 857 passed |
| pi-web packages/tool-kit | 463 passed |
| pi-web packages/protocol | 417 passed |
| pi-web 根 typecheck | 0 error |
| pi-clouds apps/registry | 21 passed |
| pi-clouds registry-server | 218 passed |
| pi-clouds registry-client | 252 passed / **1 failed(存量 `dist-exports`)** |
| pi-clouds sandbox / adapters-aliyun | 189 / 78 passed |
| pi-clouds apps/cloud | 658 passed / **26 failed(存量,与改动前同数)** |

**新增红:零。**

### 未做(有意)

- **未在真实环境发布过** —— 那会产生不可逆写入(版本登记后不可删,只能 yank),须另行请示。
- **部署前置未配置**:`PI_CLOUDS_REGISTRY_PUBLISH_TOKEN_SECRET` 需在 apps/cloud 与
  apps/registry **两侧同值**;`PI_CLOUDS_REGISTRY_HTTP_BASE_URL` 须指向真实 registry。
  任一缺失 → 发布不可用(诚实降级,不报错)。
- **P1 Req 4 的路由接线仍未做** —— 但本 spec 不依赖它(登记路由自带 provision)。
