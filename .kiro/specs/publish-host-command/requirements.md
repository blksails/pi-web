# Requirements Document

## Project Description (Input)

给 pi-web 加 `/agent publish` 与 `/plugin publish` 两条 host 命令。**本轮只交付「发布前校验与预览」**
（编译 + 校验 + 预览，**不签名、不上传、不登记**）；真正的对外发布留待云端发布身份就绪。

### 为什么切在这里（勘察结论，非取舍偏好）

对外发布需要两样东西，pi-web 当前**一样都没有**：

| 需要 | CLI 怎么拿 | web/桌面端现状 |
|---|---|---|
| 签名私钥（JSON `{publicKey, privateKey}`，`publisher` = 公钥指纹） | `--key <path>` | 无来源 |
| publish 授予 | `PI_WEB_REGISTRY_TOKEN` | **有 token 但用不了** |

第二条是硬阻塞：登录取得的 `sources` 授予在 registry 侧是 **consume scope**
（`consume-token.ts:22` `scope: "consume"`），且 `HmacConsumeTokenVerifier` 明写
`verifyPublish` **恒抛 `UnauthorizedError`**。发布身份目前只来自 `StaticTokenVerifier`
的静态 `token → publisherId` 配置表。

**已裁定（用户决策）**：发布身份走**云端托管** —— 登录用户由 cloud 建 publisher、签发发布授予、
代管代签。故 pi-web 侧**不引入任何私钥来源**，签名不在本 spec 内。

### 三处需要纠正的常见误解（勘察实证，写入需求以免后人重蹈）

1. **registry 是三档可见性**（`entities.ts:25-31`）：`private` = 仅 admin/发布面可见（只有自己）、
   `org` = 同租户消费者可见、`public` = 任意租户可见。日常口语说的「private = 公司内可见」
   对应的是 registry 的 **`org`**。照字面发 `private` 会让同事一个都看不见，且**不报错**。
2. **可见性不放宽发布面**。`Visibility` 文档原话：「三者都不放宽发布面：发版 / 移动 channel /
   yank 恒需属主或 admin」。`token.ts` 更明确：「token 仅传输层，不承担授权语义；发布授权本体是
   **验签**，归属授权是 publisher/org 匹配」。故「org/private 免密钥、public 才要密钥」不成立 ——
   三档都要密钥与属主身份。
3. **`visibility` 挂在 `createSource`，不在 `registerVersion`**（`api.ts:24-32`）。而
   `publish-orchestrator` **从不调用** `createSource`/`registerPublisher`（全仓 grep 零命中），
   它直接 `uploadBundle → registerVersion`。所以「发布时选 public/org」在现有链路里**没有位置**，
   首次建源是缺失的一步 —— 归云端侧，不在本 spec。

### 本轮交付的独立价值

`compile()` 的错误面正是**会烧掉版本号**的那几类失败：清单缺失/非法、`kind` 未显式声明、
agent 入口探测不到、入口覆盖声明的文件不存在、入口越出包目录、webext 有源无产物、
声明路径缺失。`manifest-compiler.ts` 注释原话：「registry 侧会拒绝包外路径，**前置拦截以免烧
版本号**」。把这些在发布前拦下来，是一道独立成立的闸门，不是「半个发布」。

## Introduction

本特性给命令面加一条**发布前校验与预览**通道：用户在聊天框里对一个本地包目录执行
`/agent publish <dir>`，得到「这个包将被发布成什么」的结构化预览与全部编译告警；若包有问题，
在**任何外部写发生之前**如实报出。真实的编译与校验一律复用既有 `compile()`，本 spec 不重造。

## Boundary Context

- **In scope**：`/agent publish` 与 `/plugin publish` 两条 host 命令；参数位补全（本机可发布目录）；
  清单 `kind` 与命令名的一致性判定；预览结果卡片（含告警与文件清单）；未接入发布授予时的
  诚实降级；相关单测与 e2e。
- **Out of scope**：
  - 签名（`sign()`）与任何私钥来源 —— 已裁定归云端；
  - `uploadBundle` / `registerVersion` / `setChannel` 三步外部写；
  - `createSource` / `registerPublisher` 与 `visibility` 选择 —— 归云端；
  - `compile()` 本身的编译/校验实现 —— **一行不改**；
  - CLI `pi-web publish` 的既有行为 —— 不改；
  - 密钥生成、备份、轮换；
  - `--channel` / `--commit-only` 选项 —— 正式发布开通时再议，现在加只是空参数。
- **Adjacent expectations**：
  - CLI 的 `--dry-run` **是签名的**，本 spec 的预览**不签名**，两者**不等价**：预览是 CLI dry-run
    的真子集，给不出 `publisher` 指纹与签名，也验不出密钥类失败。这个差异必须对用户可见。
  - 类别判定沿用 `installer-registry-channel` 已确立的心智：**清单里的 `kind` 是权威**，
    与命令名不符即拒绝并指路另一条命令。

## Requirements

### Requirement 1：`/agent publish` 与 `/plugin publish` 的发布前预览

**Objective:** As a agent/plugin 作者, I want 在聊天框里检查一个包"将被发布成什么", so that 我能在
烧掉一个版本号之前发现清单与产物的问题。

#### Acceptance Criteria

1. When 用户提交 `/<kind> publish <dir>`, the host 命令层 shall 对该目录执行既有编译与校验，
   并在**不发生任何外部写、不接触任何凭据**的前提下产出预览结果。
2. The 预览结果 shall 至少包含：包标识、版本、类别、将纳入发布的文件清单、逐文件完整性摘要，
   以及编译产生的全部告警。
3. The host 命令层 shall 复用既有的编译实现，不重造第二套清单解析或文件收集逻辑。
4. When 预览成功, the host 命令层 shall 明确告知这是**预览而非发布**，且不改变任何本地或远端状态。
5. The 预览 shall 不重载当前会话（它不改变会话可用的能力）。

### Requirement 2：预览与真实发布的差异必须可见

**Objective:** As a 发布者, I want 知道"预览通过"不等于"一定能发布成功", so that 我不会把预览当成
发布许可而在真正发布时才踩坑。

#### Acceptance Criteria

1. The 预览结果 shall 显式说明本次预览**未签名**，因而不含发布者身份与签名。
2. The 预览结果 shall 显式说明预览**不校验发布授予与属主关系**，那些只有在真正发布时才判定。
3. The host 命令层 shall 不使用任何会让用户误以为已发布的措辞（如"已发布""已提交"）。

### Requirement 3：类别以清单为权威

**Objective:** As a pi-web 维护者, I want 命令名与包的真实类别不一致时被拦住, so that 不出现
「用 `/agent publish` 预览一个 plugin 包」这类错位预期。

#### Acceptance Criteria

1. The host 命令层 shall 以编译所得清单中的 `kind` 为该包类别的权威判据，不依赖任何缺省值。
2. If 清单 `kind` 与命令锁定的类别不符, then the host 命令层 shall 拒绝并指出应改用哪条命令。
3. If 清单未显式声明 `kind`, then the host 命令层 shall 如实转达该失败并说明必须显式声明
   （两侧缺省相反，不可推断）。

### Requirement 4：发布对象的指定与补全

**Objective:** As a 用户, I want 不必手敲路径就能选中要预览的包, so that 执行基准与补全基准一致、
不会选中即失败。

#### Acceptance Criteria

1. The 命令 shall 接受一个目录参数作为发布对象。
2. The 参数位补全 shall 产出本机**含发布清单文件**的目录作为候选 —— 与安装参数位的候选判据
   （入口/包描述文件）不同，不可直接套用。
3. The 补全候选与执行 shall 使用同一个路径解析基准，使选中的候选可直接提交并成功解析。
4. If 目标目录不存在发布清单, then the host 命令层 shall 给出可操作的说明，而不是笼统失败。

### Requirement 5：编译失败的如实转达

**Objective:** As a 发布者, I want 每类编译失败都给出足以定位的信息, so that 我知道改哪个文件。

#### Acceptance Criteria

1. The host 命令层 shall 对既有编译错误的**每一个分类**给出可区分的用户可见说明，
   不把它们压成同一条笼统消息。
2. When 编译产生非阻断告警, the host 命令层 shall 如实展示，不静默吞掉
   （告警被吞掉会让预览变成假预览）。
3. If 预览失败, then the host 命令层 shall 不留下任何本地状态变更。

### Requirement 6：正式发布的诚实降级

**Objective:** As a 用户, I want 尝试真正发布时得到明确说明, so that 我不会把"发不了"误解为
"命令坏了"。

#### Acceptance Criteria

1. When 用户以任何方式请求**真正发布**（而非预览）, the host 命令层 shall 返回一条明确指出
   该部署尚未接入发布身份的失败结果，并说明预览可用。
2. The 失败说明 shall 不暴露任何令牌、密钥路径或内部端点地址。

### Requirement 7：治理与凭据卫生

**Objective:** As a pi-web 运维者, I want 预览通道不成为读取任意本地路径或泄露信息的旁路,
so that 命令面只有一套安全语义。

#### Acceptance Criteria

1. While 管理员校验未通过, when 用户提交 publish 命令, the host 命令层 shall 拒绝执行并记录
   被拒审计事件，与既有安装命令的拒绝路径一致。
2. The host 命令层 shall 不在任何输出面（结果卡片、审计事件、错误消息、日志）泄露用户输入中
   可能夹带的凭据。
3. The 参数位补全 shall 沿用既有的路径边界约束，不产出解析基准之外的候选。

### Requirement 8：验证

**Objective:** As a pi-web 维护者, I want 这条通道有可执行证据, so that "预览能拦住坏包"不是
只靠替身证明。

#### Acceptance Criteria

1. The pi-web 测试套件 shall 覆盖：预览成功路径、每一类编译失败的可区分转达、清单 `kind` 与
   命令不符的拒绝、告警不被吞掉、管理员拒绝路径。
2. The pi-web 测试套件 shall 以**真实包目录夹具**（而非注入的编译替身）至少覆盖一次成功预览与
   一次编译失败，证明接的是真实编译实现。
3. The pi-web e2e 套件 shall 覆盖 `/agent publish` 的成功预览卡片，并断言卡片含"未签名 / 仅预览"
   的说明。
4. The pi-web 测试套件 shall 断言预览路径**零外部写**（不产生网络请求、不修改包目录）。
