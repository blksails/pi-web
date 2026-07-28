# Requirements Document

## Project Description (Input)

打通**真实发布**:`/agent publish <dir>` / `/plugin publish <dir>`(不带 `--dry-run`)
走完 编译 → 签名 → 上传 bundle → 登记版本 → 移通道,用登录态的发布授予作凭据。

这是设计稿 `docs/registry-publish-identity-design.md` 的 **P2**。前置(P0/P1/密钥)均已就位:
- P0 `registry-org-identity`:org 派生、`createSource` 不再接收 tenantId;
- P1 `publish-grant-issuance`:cloud 签发 publish token,registry 侧有 `HmacPublishTokenVerifier`;
- `publish-key-lifecycle`:本机密钥自动生成、公钥自动登记 → `publisher.keys` 不再恒空。

**跨两仓**:
- `agents/pi-clouds`:把 publish token 校验器**接进** registry 服务装配(见下,这是本轮发现的真阻塞);
- `agents/pi-web`:host 命令非 dry-run 分支接真实发布 + 结果契约扩写 + 渲染。

### 关键实证(本轮勘察,决定了本 spec 的形状)

| 事实 | 依据 | 影响 |
|---|---|---|
| ★ **`buildTokenVerifier()` 只组合了 `HmacConsumeTokenVerifier`** | `apps/registry/src/main.ts:86-113` | P1 造了 `HmacPublishTokenVerifier` 却**从未接进装配** → cloud 签发的 publish token 会被真实 registry **拒绝**。不修这条,P2 其余全部白做 |
| publish 授予的 `baseUrl` 指向**真实 registry**(非 cloud) | `apps/cloud/lib/desktop-capabilities.ts:159` ← `PI_CLOUDS_REGISTRY_HTTP_BASE_URL` | 发布不经 cloud 只读面,故 `CloudTokenVerifier.verifyPublish` 恒抛那颗钉子不受影响 |
| **首次发布无需 `createSource`** | `registry-service.ts:394` → `autoCreateSourceBySignature` | 归属由**指纹反查 publisher** + 该 publisher 自己的公钥验签确立;org 段必须等于 ctx.org |
| 发布全流程**编排器已存在** | `server/cli/publish/publish-orchestrator.ts` `publish()` | pi-web 侧主要是**接线**,不是重写 |
| `RegistryPort` / `HttpRegistryAdapter` 已支持发布面 token | `server/cli/registry/http-registry-adapter.ts` | 用授予的 `{baseUrl, token}` 构造即可 |
| ★ 登记失败会**落 `failed` 记录**并占用该版本号 | `registry-service.ts:397-403` `persistFailed` | 同 `sourceId@version` 不可再登记 —— **一次失败发布会烧掉一个版本号**。用户必须被如实告知 |
| 版本不可删(触发器强制),只能 yank | `pg-registry-client.ts` `registry_version_no_delete` | 发布是**实质不可逆**动作 |
| `PublishPreviewData` 已预留真实发布位 | `packages/protocol/src/web-ext/publish-command.ts:33-35` | 契约扩写而非重造 |
| host 命令非 dry-run 现返回 `PUBLISH_NOT_AVAILABLE` | `lib/app/package-host-command.ts:497` | 本 spec 要替换的正是这一分支 |

## Introduction

本特性让登录用户可以**真的把包发出去**。发布用登录态的短时授予作凭据,用本机私钥签名,
归属由公钥指纹反查确立 —— 用户既不接触管理员凭据,也不需要平台预先为其建 source。

发布是**实质不可逆**的:版本一经登记即不可改、不可删(只能 yank),且一次失败也会占用该版本号。
因此本 spec 对"如实告知后果"的要求与对"功能可用"的要求同等重要。

## Boundary Context

- **In scope**
  - registry 服务装配接上 publish token 校验(pi-clouds);
  - host 命令非 dry-run 分支接真实发布(编译→签名→上传→登记→通道);
  - 发布前置校验(kind 门、org 前缀、密钥与公钥就位)在**发起任何外部写之前**完成;
  - 结果契约扩写 + 渲染器呈现已发布结果;
  - 审计与凭据卫生;
  - 相关单测与契约级集成测试。
- **Out of scope**
  - **可见性选择**(`private` / `org` / `public`)—— P3;本 spec 用自动建 source 的既有缺省;
  - yank / 回滚 / 版本管理的用户入口;
  - `--commit-only` 之类的运维语义(CLI 已有,host 面不引入);
  - 密钥撤销入口;
  - 真实生产环境的发布验证(须另行请示,见验证边界)。
- **Adjacent expectations**
  - `--dry-run` 的行为与输出**完全不变** —— 它是本 spec 的对照组。
  - 未登录 / 未配置 org / 无授予时,行为仍是既有的诚实降级(`PUBLISH_NOT_AVAILABLE`),
    不得变成崩溃或静默失败。

## Requirements

### Requirement 1:registry 认得云端签发的发布凭据

**Objective:** As a 平台运维者, I want 真实 registry 接受 cloud 签发的 publish token, so that
登录用户的发布请求不会被当作未授权而拒绝。

#### Acceptance Criteria

1. When 部署配置了 publish token 密钥, the registry 服务 shall 在发布面**同时**接受
   HMAC 签发的 token 与既有静态 token。
2. The 接入方式 shall 与既有的消费面 HMAC 接入**同构**(同一组合器、同样的主备顺序),
   不引入第二种表达方式。
3. While 未配置该密钥, the registry 行为 shall 与本 spec 引入前**完全一致**。
4. The 启动日志 shall 表明该能力是否启用,且**不得**打印密钥本身。

### Requirement 2:登录用户能真的发布

**Objective:** As a 发布者, I want `/agent publish <dir>` 真的把包发出去, so that 我不必为
发布另外配一套 registry 凭据。

#### Acceptance Criteria

1. When 用户执行不带 `--dry-run` 的 publish 且持有发布授予, the 宿主 shall 完成
   编译 → 签名 → 上传 → 登记版本 → 移通道的全流程。
2. The 发布凭据 shall 取自登录态的发布授予,用户**无需**配置任何 registry 环境变量。
3. The 签名 shall 使用本机私钥;私钥不得出现在任何输出面。
4. When 该 source 在注册表中尚不存在, the 发布 shall 仍能成功 —— 归属由公钥指纹确立,
   不需要平台预先建 source。
5. The 成功结果 shall 呈现:包标识、版本、通道是否已指向该版本,以及**发布者身份**
   (以谁的身份、在哪个命名空间下发)。
6. The 发布通道 shall 可指定;未指定时落一个明确的缺省。

### Requirement 3:一切校验先于任何外部写

**Objective:** As a 发布者, I want 能在本地就知道发不出去, so that 我不会因为一个本可提前发现的
问题而烧掉一个版本号。

#### Acceptance Criteria

1. The 宿主 shall 在发起任何外部写之前完成:命令与包 kind 是否相符、包标识的命名空间段是否
   属于当前发布身份、本机密钥是否可用、公钥是否已登记。
2. If 上述任一项不成立, then the 宿主 shall 拒绝并给出**指向修复动作**的说明,
   且**不产生任何外部写**。
3. The 命名空间不符 shall 在本地判定并给出可懂说明,而不是把它推给服务端变成一句
   "禁止访问"。
4. The 前置校验失败 shall 与发布过程失败**可区分** —— 前者没花掉版本号,后者可能花掉了。

### Requirement 4:发布的不可逆性必须被如实告知

**Objective:** As a 发布者, I want 知道这一步意味着什么, so that 我不会以为它像安装那样可以撤销。

#### Acceptance Criteria

1. The 成功结果 shall 表明该版本已不可更改,后续修改需要提新版本号。
2. If 发布在登记阶段失败, then the 结果 shall 明确告知该版本号**已被占用**、需改版本号重试
   —— 这是最容易让人反复重试同一版本而困惑的地方。
3. The 结果 shall 不把"上传成功但登记失败"呈现为整体成功。
4. The 差异声明(`disclaimers`)在真实发布成功时 shall 表明这**不是**预览。

### Requirement 5:失败可区分、可定位

**Objective:** As a 发布者, I want 失败时知道卡在哪一步, so that 我知道该改包、改版本号,还是重试。

#### Acceptance Criteria

1. The 失败结果 shall 标明失败发生在哪个阶段(编译 / 签名 / 上传 / 登记 / 通道)。
2. The 各阶段的失败 shall 各自给出对应的修复动作,不压成一句"发布失败"。
3. If 授予缺席或已过期, then the 结果 shall 是既有的诚实降级语义,而不是一个技术性错误。
4. The 通道移动失败 shall 不否定已成功的版本登记 —— 结果须表明版本已登记但通道未移。

### Requirement 6:凭据卫生

**Objective:** As a 平台运维者, I want 发布凭据不泄露, so that 它不会经日志、卡片或审计扩散。

#### Acceptance Criteria

1. The 发布授予的 token shall 只作为请求头使用,不进日志、不进结果数据、不进审计事件、不落盘。
2. The 服务端返回的错误细节 shall 不被原样透出 —— 它可能内嵌带凭据的 URL。
3. The 用户提供的目录路径 shall 不被原样回显(既有裁断:`path.resolve` 会破坏脱敏形态)。
4. The 审计事件 shall 记录发布动作与结果,但不含任何凭据。

### Requirement 7:验证

**Objective:** As a 维护者, I want 这条链路有可执行证据, so that "能发布了"不是靠替身证明。

#### Acceptance Criteria

1. The 测试套件 shall 断言 registry 装配在配了密钥时接受 HMAC publish token、
   未配时行为不变、静态 token 始终可用。
2. The 测试套件 shall 覆盖成功发布的完整链路,并断言各阶段**按序**发生。
3. The 测试套件 shall 覆盖每一条前置校验拒绝路径,并断言其**零外部写**。
4. The 测试套件 shall 覆盖各阶段失败的可区分呈现,含"版本已登记但通道未移"这一部分成功态。
5. The 测试套件 shall 断言 `--dry-run` 的输出**逐字段不变**(它是本 spec 的对照组)。
6. The 测试套件 shall 断言授予 token 不出现在结果数据、审计事件与日志中。
7. The 端到端证据 shall 用**进程内契约夹具**(既有 `createFakeRegistry`)完成,
   不依赖真实网络;真实环境发布须另行请示,**不在本 spec 的验证范围内**。
