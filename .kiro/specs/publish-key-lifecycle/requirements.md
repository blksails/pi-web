# Requirements Document

## Project Description (Input)

给发布签名补上**密钥这一环**：本机自动生成密钥对、公钥自动登记到本企业的 publisher，
并给 `PublisherKey` 补上最起码的溯源元数据。

这是设计稿 `docs/registry-publish-identity-design.md` 里 **P2 的前置** ——
P2（打通真实发布）本身卡在这里：当前 provision 出的 publisher 是**空钥**的，
`registerVersion` 会在 `publisher.keys.some(k => k.status === "enabled" && verifyManifest(...))`
上必然失败。缺的不是接线，是密钥。

**跨两仓**：
- `agents/pi-web`：本机密钥生成与保管、发布前确保公钥已登记
- `agents/pi-clouds`：公钥登记的窄口（复用 P1 的进程内 nonce 实例）+ `PublisherKey` 元数据

### 已裁定（用户决策）

- **私钥留在用户本机**，云端不代管 —— 保住 registry「授权本体是验签」的设计意图；
- **自动生成**，不要求用户先跑 `keygen`；
- **同时补元数据**（选项 A），不推迟。

### 关键实证（决定了本 spec 的形状）

| 事实 | 依据 | 影响 |
|---|---|---|
| 全仓**没有**密钥生成入口 | pi-web grep `generateEd25519KeyPair`/`keygen` 零命中；`bin/pi-web.mjs` 只有 `--key <path>` 收既有文件 | 用户当前**无任何受支持方式**拿到可用密钥 |
| 生成函数已存在且是**纯计算** | `registry-client/src/manifest/signature.ts:89`（注释写"供 seed 与测试用"） | 生成本身零成本，改注释即可复用 |
| 私钥仅 **32 字节** | Ed25519，JWK `d` → base64 | 可放文件亦可放 env，形态轻 |
| 密钥文件形态 `{publicKey, privateKey}` | `manifest-compiler.ts:414`，`sign()` 已按此读 | 生成侧必须产出同一形态，否则签名读不了 |
| manifest 写的是**指纹**不是公钥 | `computeFingerprint` = `ed25519:<sha256(pub) b64url>` | 验签靠指纹反查 publisher |
| **丢私钥不是灾难** | 已发布包签名仍有效（公钥仍 enabled）；可新生成并登记，`PublisherKey[]` 支持多钥并存 | 自动生成因此是合理默认，不必强迫用户备份 |
| `addPublisherKey` 是 **admin 门** | `registry-service.ts:178` | 登记须走窄口，与 P1 provision 同构 |
| 同一公钥**不得跨 publisher** 登记 | 同上 :184 注释（否则指纹反查多命中，而那是自动建 source 的归属依据） | 登记逻辑不得放宽该约束 |
| `PublisherKey` 只有 `fingerprint`/`publicKey`/`status` | `entities.ts:45-51` | **无创建时间、无来源标识** —— 本 spec 要补的正是它 |

### 为什么元数据必须现在补

自动生成会让每台新机器、每次重装、每个 CI 容器都**悄悄多一把 enabled 公钥**挂在该 publisher 下。
没有元数据就意味着：

- 没人知道它存在 → **没人会去停用它**；
- 任何一把泄露都能以该 publisher 身份签包，直到有人手工排查；
- 事后**分不清哪把是哪台机器的**，想清理只能全停重来。

也就是说，自动生成会把"一个待补的小缺陷"变成"持续产生不可辨数据的机制"。
**现在补的成本最低 —— 存量是零。**

## Introduction

本特性让发布者在**不知不觉中拥有一把可用的签名密钥**，同时保证这些密钥在服务端是
**可辨认、可撤销**的。私钥永不离开用户机器；公钥的登记由宿主按企业身份自动完成，
用户不接触任何管理员凭据。

## Boundary Context

- **In scope**
  - 本机密钥对的自动生成、保管与读取；
  - 发布前确保本机公钥已登记到本企业 publisher（幂等）；
  - 公钥登记的窄口（只允许为自己企业的 publisher 登记）；
  - `PublisherKey` 溯源元数据（创建时间 + 可读标签）及其读写；
  - 相关单测。
- **Out of scope**
  - 打通真实发布（`uploadBundle → registerVersion → setChannel`）—— 那是 P2 本身；
  - 密钥**停用/撤销**的操作入口（服务端能力已存在，UI/CLI 入口另议）；
  - 可见性选择（P3）；
  - 密钥在多机之间同步/导出 —— 本 spec 的取向是**每机一把**，不做同步。
- **Adjacent expectations**
  - 本 spec 落地后，`/agent publish` 的行为**仍然不变**（仍 `PUBLISH_NOT_AVAILABLE`）——
    密钥就位不等于发布通路打开，那要等 P2。这是刻意的：每步各自可验。
  - 一个 publisher 下会出现多把 enabled 公钥（每机一把），这是**预期状态**，不是异常。

## Requirements

### Requirement 1：本机密钥自动就位

**Objective:** As a 发布者, I want 不必先学会生成密钥就能发布, so that 发布不被一道
密码学准备工作卡住。

#### Acceptance Criteria

1. When 需要签名而本机尚无密钥, the 宿主 shall 自动生成一对并持久化，无需用户预先操作。
2. The 生成结果 shall 与既有签名实现所读的文件形态一致，不引入第二种形态。
3. The 私钥文件 shall 以**仅属主可读**的权限写入。
4. The 宿主 shall 不在任何输出面（stdout、日志、错误消息、结果卡片）打印私钥。
5. When 本机已有密钥, the 宿主 shall 复用它，**不得**覆盖或重新生成。
6. If 已有密钥文件存在但无法解析, then the 宿主 shall 明确报错并停止，
   **不得**静默覆盖 —— 覆盖会让该机器既有的已登记公钥永久失去对应私钥。

### Requirement 2：公钥自动登记

**Objective:** As a 发布者, I want 我的公钥自动出现在我企业的 publisher 下, so that 我不需要
接触任何管理员凭据。

#### Acceptance Criteria

1. When 本机公钥尚未登记到当前企业的 publisher, the 宿主 shall 自动登记它。
2. The 登记 shall 幂等 —— 同一把公钥重复触发不得产生重复条目或报错。
3. The 登记 shall 只能针对**调用方自己企业**的 publisher，不得为其它 publisher 登记。
4. The 登记 shall 保持"同一公钥不得跨 publisher 登记"这一既有约束，不得放宽。
5. If 登记失败, then the 宿主 shall 如实转达且不留下半状态，
   并使后续发布走既有的诚实降级路径。
6. The 登记路径 shall 不向客户端暴露任何管理员凭据。

### Requirement 3：密钥可辨认、可撤销

**Objective:** As a 平台运维者, I want 能看出每把公钥是何时、从哪来的, so that 泄露时
知道该停用哪一把。

#### Acceptance Criteria

1. The 公钥记录 shall 携带创建时间与一个可读标签（用于区分来源机器/用途）。
2. The 标签 shall 由登记方提供；缺失时 shall 落一个明确的缺省值，
   **不得**留空（留空等于回到无法分辨的状态）。
3. The 既有的公钥记录（无元数据者）shall 仍可被读取与验签，不因新增字段而失效。
4. The 元数据 shall 不影响验签判定 —— 验签只看公钥与启用状态。
5. The 元数据 shall 不包含任何凭据或私钥派生物。

### Requirement 4：多把密钥并存是正常状态

**Objective:** As a 发布者, I want 换机器后照常发布, so that 我不必在机器间搬运私钥。

#### Acceptance Criteria

1. The 同一 publisher shall 支持多把处于启用状态的公钥同时存在。
2. When 在一台新机器上首次发布, the 宿主 shall 生成并登记该机器自己的密钥，
   **不得**要求导入既有私钥。
3. While 某台机器的私钥丢失, the 该 publisher 已发布内容的签名 shall 仍然有效。
4. The 宿主 shall 不提供把私钥导出或跨机同步的路径 —— 那会让"本机持钥"失去意义。

### Requirement 5：验证

**Objective:** As a 维护者, I want 这套密钥流程有可执行证据, so that "自动就位"不是靠替身证明。

#### Acceptance Criteria

1. The 测试套件 shall 覆盖生成：无密钥→生成并可被签名实现读取；已有→复用不覆盖；
   坏文件→报错不覆盖；文件权限为仅属主可读。
2. The 测试套件 shall 断言私钥**不出现**在任何输出面。
3. The 测试套件 shall 覆盖登记：首次登记；重复触发幂等；跨企业登记被拒；
   跨 publisher 复用同一公钥被拒（既有约束不被放宽）。
4. The 测试套件 shall 覆盖元数据：新记录带创建时间与标签；缺标签落缺省；
   **既有无元数据记录仍能验签**。
5. The 测试套件 shall 断言签名与验签**端到端互通**：本机生成的密钥签出的 manifest，
   经登记后能被服务端验签通过 —— 两侧各测各的测不出形态不一致。
