# Requirements Document

## Project Description (Input)

**谁有问题**:pi-web 桌面用户 —— 目前**无法登录**。

**现状**:`desktop-cloud-login` 交付了登录组件、鉴权端点、凭据解析与钥匙串存取,但那个"登录"是一个**粘贴凭据串**的输入框,而用户手上根本没有凭据串、也没有途径获得。云端地址已可配置(该 spec Req 8),登录能力面已能启用(`/api/auth/me` 返回 200),唯独差"怎么拿到身份"。

更深一层:宿主契约 v1 定义了 P2 端口 `CapabilityProvider`(标注**「云端可选;桌面必须」**),负责用身份换取 `tenant` / `egress` / `sources` / `attachments` 授予,但**契约本身没有定义身份如何获得**。没有身份就拿不到任何授予 —— 桌面实现卡在起点。

**该改成什么**:桌面用户填账号密码即可登录,登录后身份与授予一次到位(线上源可见可用、模型走云端出口),全程不接触任何凭据串。

## 实测确认的事实(2026-07-27)

1. **云端真实契约是账号密码**:`POST /api/desktop/login { email, password }` —— 成功返回 **`{ token }`**(★ 不是 `credential`;首版按 `credential` 解导致真机上「密码正确却报无法连接云端」)/ 400 `email and password required` / 401 `Invalid login credentials` / **403 无租户归属**(与 401 是两回事:用户该换账号而非改密码)。事实源是被撤回的 `7c184ed:packages/server/src/auth/signin-endpoint.ts`,那是本仓唯一跑通过成功路径的实现。**没有 device 授权端点**(`/api/desktop/device`、`/api/desktop/device/start`、`/api/auth/login`、`/api/auth/signin` 全 404)。故 `login-control.tsx:14` 注释所称"device 授权流由 pi-cloud 承载"是**过时推测**。
2. **`CapabilitySnapshot.tenant` 无人消费**:契约定义了 `{ userId, companyId, role }`,但代码中没有任何消费方;P1 的 `DesktopCapabilitiesClient` 只取了 `sources` 一个字段。
3. **`Workspace` 与身份无关**:它是存储抽象(`readJson`/`writeJson`/`list`/`delete`/`exists`,分 user/project 命名空间),`workspace/types.ts` 中 `auth`/`credential`/`login` 命中 **0** 次。身份属 `CapabilityProvider` 那一层。

## 已定的首要设计决策(2026-07-27:选 A)

**身份获取补进宿主契约**——新增 `IdentityProvider` 端口,或给 `CapabilityProvider` 增加身份获取方法(具体形态属 design 阶段)。桌面与云端各自实现。

**理由**:`CapabilityProvider` 已定义「用身份换授予」却没定义「身份怎么来」,这是**契约的缺口**,不是某个宿主的实现细节。补在契约里,两种宿主的身份获取才可能各自实现而调用方不变。

**已否决 B(桌面实现自带)**:改动面小,但「怎么登录」跨宿主不可复用,且会把契约缺口掩盖成一次性实现。

**由此确定的边界**:本 spec **独立成立**(不并入 `desktop-cloud-login` 任务组 9);相邻 spec `host-contract-ports` 与契约文档 `docs/pi-web-host-contract-v1.md` 需同步更新;可能联动 pi-clouds。

**云端多租户 web 也走该端口**(2026-07-27 定)。两种宿主同口不同实现:

| 宿主 | 身份来源 | 是否需要交互 |
|---|---|---|
| 桌面 | 账号密码 → 云端签发桌面凭据 | **需要**(用户填表单) |
| 云端多租户 web | 既有会话(cookie / Bearer) | **不需要**(打开即已有身份) |

**由此产生的端口设计约束**(design 阶段必须满足):

1. 端口须容纳「**身份可能已经具备**」——云端实现打开即能返回身份,不得被迫做假的登录交互。
2. 端口须容纳「**身份需要交互换取**」——桌面实现要能表达「当前无身份,需要凭据」以及「用这组凭据换身份」两种状态。
3. 调用方(装配层与 UI)**不得据宿主类型分支** ——否则两种实现就白抽象了。UI 应据端口返回的状态决定「直接可用」还是「渲染登录表单」,而不是据「我是不是桌面」。
4. 凭据交换是**可选能力**:云端实现不提供它属正常,不是缺陷。

## 已确定的实现约束

- **凭据明文不得进渲染层**:前端提交 email/password 到本地服务端,由服务端转发云端并持有凭据。理由:桌面壳有 CSP;跨域;现有粘贴形态已让明文过渲染层,应一并修掉。
- 登录 URL 由已配置的 `egressBase` 推导(与 capabilities URL 同款规则),不新增配置项。
- 凭据格式由云端签发(`base64url(payload).HMAC`),本仓**只解 payload、不验签**(验签在云端 egress)。
- 延续 `desktop-cloud-login` Req 5 安全不变式:凭据不落日志、不进响应体。

## Boundary Context

- **In scope**:身份获取能力面的跨宿主统一语义;桌面账号密码登录(经本地服务端代理);账号密码登录界面(替换粘贴凭据串主路径);登录后 `tenant`/`egress`/`sources` 三类授予一次到位;身份展示改用 `tenant`;登出与切号;失败态与安全不变式;契约文档同步。
- **Out of scope**:云端 `POST /api/desktop/login` 端点本身的任何改动;注册 / 找回密码 / 多因素;`attachments` 会话作用域授予(属既有附件线);云端多租户宿主**自身**的登录页与会话签发(本 spec 只要求它能经统一能力面暴露既有身份);凭据签名校验(在云端 egress 侧)。
- **Adjacent expectations**:云端按现状提供 `POST {cloudBase}/api/desktop/login { email, password }`(400 缺参 / 401 凭据错)与 `POST {cloudBase}/api/desktop/capabilities`;云端地址沿用 `desktop-cloud-login` Req 8 已交付的配置(不新增配置项);线上源安装(`desktop-online-source-runnable`)与云端模型出口依赖本 spec 产出的授予,但其自身行为不由本 spec 改变。

## Requirements

### Requirement 1:跨宿主统一的身份获取能力面

**Objective:** As a pi-web 宿主集成者, I want 一个不区分宿主类型的身份获取能力面, so that 桌面与云端各自实现身份来源,而调用方与界面无需知道自己运行在哪种宿主上。

#### Acceptance Criteria

1. The pi-web 宿主 shall 经统一的身份能力面获取当前身份,**不得**据宿主类型(桌面 / 云端)选择不同的调用路径。
2. When 宿主启动且身份已经具备(例如云端多租户宿主的既有会话), the 身份能力面 shall 直接返回「已具备身份」状态,且**不要求**任何用户交互。
3. When 宿主启动且身份尚不具备, the 身份能力面 shall 返回「无身份」状态,并表明当前是否支持以凭据交换身份。
4. Where 某宿主实现不提供凭据交换能力, the 身份能力面 shall 将其表达为「不支持交换」,且宿主**不得**因此报错、告警或拒绝启动。
5. The 登录界面 shall 仅据身份能力面返回的状态决定展示「已登录信息」还是「登录入口」,**不得**据宿主类型判断。
6. If 身份能力面返回「无身份」, then the pi-web 宿主 shall 以未登录形态正常启动并保持本地能力可用,不得阻断启动。

### Requirement 2:桌面账号密码登录

**Objective:** As a pi-web 桌面用户, I want 用我的账号密码直接登录, so that 我不需要从任何外部渠道获取并粘贴一串凭据。

#### Acceptance Criteria

1. When 用户在登录界面提交邮箱与密码, the 登录服务 shall 将其提交至已配置云端的登录端点,并在成功时取得桌面凭据。
2. If 邮箱或密码为空, then the 登录界面 shall 阻止提交并提示两项均为必填。
3. If 云端判定账号或密码错误, then the 登录服务 shall 展示「账号或密码错误」并保持未登录态。
4. If 云端不可达、超时或返回非预期响应, then the 登录服务 shall 展示可读的连接失败提示并允许用户重试,不得使应用崩溃或长时间无响应。
5. If 云端地址尚未配置, then the pi-web 宿主 shall 不展示登录入口(与既有未启用形态一致),不得展示一个注定失败的登录表单。
6. When 登录成功, the pi-web 宿主 shall 使此后新建的会话直接使用云端出口与线上源,用户**无需重启应用**。

### Requirement 3:账号密码登录界面

**Objective:** As a pi-web 桌面用户, I want 一个正常的登录表单, so that 登录这件事的形态与我在任何其他应用里的经验一致。

#### Acceptance Criteria

1. The 登录界面 shall 提供邮箱与密码两个输入项,并将密码以掩码显示。
2. While 登录请求进行中, the 登录界面 shall 展示进行中状态并禁止重复提交。
3. When 用户取消登录, the 登录界面 shall 清空已输入的邮箱与密码,且不产生任何持久化写入。
4. The 登录界面 shall 不再以「粘贴凭据串」作为登录主路径。
5. Where 因凭据过期或会话失败需要重新登录, the 登录界面 shall 以同一账号密码表单收集凭据,而非要求用户粘贴凭据串。

### Requirement 4:登录后授予一次到位

**Objective:** As a pi-web 桌面用户, I want 登录成功后能力立刻齐备, so that 我不必再做任何额外动作就能用上线上源与云端模型。

#### Acceptance Criteria

1. When 登录成功, the pi-web 宿主 shall 一次性取得 `tenant`、`egress`、`sources` 三类授予。
2. If 授予获取整体失败, then the pi-web 宿主 shall **不进入已登录态**,并向用户展示可读的失败原因。
3. If 授予获取成功但其中某一项缺失, then the pi-web 宿主 shall 就该项降级为本地形态并继续运行,不得整体失败。
4. When `sources` 授予到位, the pi-web 宿主 shall 使线上 agent source 可见且可安装。
5. When `egress` 授予到位, the pi-web 宿主 shall 使新建会话的可用模型清单来自云端出口。

### Requirement 5:身份展示

**Objective:** As a pi-web 桌面用户, I want 登录后看到自己是谁, so that 我能确认登录到了正确的账号与组织。

#### Acceptance Criteria

1. While 处于已登录态, the 登录界面 shall 展示来自 `tenant` 授予的用户标识,而非凭据串自身解析出的字段。
2. Where `tenant` 授予包含所属公司标识, the 登录界面 shall 一并展示该公司标识。
3. If `tenant` 授予缺失, then the 登录界面 shall 退回展示当前可得的最小身份信息,不得展示空白或错误。

### Requirement 6:云端多租户宿主经同一能力面暴露身份

**Objective:** As a 云端多租户 web 用户, I want 打开即是已登录状态, so that 我不会被要求做一次多余的、本不存在的登录。

#### Acceptance Criteria

1. When 请求已携带有效会话, the 身份能力面 shall 返回「已具备身份」,且界面**不**展示登录表单。
2. If 会话不存在或已失效, then the 身份能力面 shall 返回「无身份」状态,由该宿主自身既有的登录路径处理,本能力面不介入。
3. The 云端多租户宿主 shall 不因未实现凭据交换能力而被判定为契约不完整。

### Requirement 7:登出与切号

**Objective:** As a pi-web 桌面用户, I want 能干净地登出或换一个账号, so that 共用设备或多组织场景下不会残留上一个身份。

#### Acceptance Criteria

1. When 用户登出, the pi-web 宿主 shall 清除本地持有的凭据与已缓存授予,并回到未登录形态。
2. When 用户在已登录态用另一账号重新登录并成功, the pi-web 宿主 shall 以新身份**整体替换**旧身份与旧授予,不得残留旧授予。
3. While 处于未登录态, the pi-web 宿主 shall 保持本地能力可用(本地 agent source、本地模型配置)。

### Requirement 8:凭据与授予的安全不变式

**Objective:** As a 运维者, I want 账号密码与授予 token 不出现在任何可被旁人读到的地方, so that 一次日志泄漏不会等同于一次账号泄漏。

#### Acceptance Criteria

1. The 登录服务 shall 不将密码写入日志、响应体或任何持久介质。
2. The pi-web 宿主 shall 不在任何接口响应体中回传桌面凭据明文。
3. The pi-web 宿主 shall 仅将桌面凭据存入操作系统钥匙串,不写入工作区存储、配置文件或环境变量文件。
4. If 记录登录相关事件, then the 记录 shall 仅含结果与失败类别,不含密码或凭据材料。
5. The 授予中的短期 token shall 不被写入日志或任何持久介质。

### Requirement 9:契约与文档同步

**Objective:** As a pi-web 宿主集成者, I want 身份能力面像其他端口一样被契约文档定义, so that 后续新增宿主能照着实现,而不是逆向阅读桌面代码。

#### Acceptance Criteria

1. When 身份获取能力面并入宿主契约, the 契约文档 shall 记录其语义保证、状态取值,以及两类宿主各自的实现义务。
2. The 契约演进 shall 保持 v1 兼容 —— 仅新增可选成员或新端口,不得改动既有端口的签名或语义。
3. The 契约文档 shall 更正「device 授权流」这一过时表述,改以实测确认的账号密码形态描述桌面身份获取。

### Requirement 10:登录门禁与独立登录页

> 2026-07-27 真机测试后由用户追加。原设计把登录做成头部内联控件,用户反馈「登陆不了」
> 且「没有登陆无法进入主页面」——后者是产品诉求,不是缺陷报告。

**Objective:** As a pi-web 桌面用户, I want 未登录时直接看到一个完整的登录页面, so that 我不必在头部找一个小按钮,也不会在未登录状态下面对一个大部分功能都不可用的主界面。

#### Acceptance Criteria

1. While 身份状态为「无身份」且当前宿主**支持**凭据交换, the pi-web 宿主 shall 以独立登录页替代主界面,主界面不得挂载。
2. Where 当前宿主**不支持**凭据交换, the pi-web 宿主 shall **不**拦截主界面 —— 身份由该宿主自身路径处理。
3. If 云端未配置(登录能力面不存在), then the pi-web 宿主 shall **不**拦截主界面,本地能力照常可用。
4. If 身份探测失败, then the pi-web 宿主 shall **不**拦截主界面 —— 不因网络问题把用户关在门外。
5. While 身份状态尚未确定, the pi-web 宿主 shall 既不渲染登录页也不渲染主界面,避免先闪一次登录页再跳走。
6. When 登录成功, the pi-web 宿主 shall 立即进入主界面,无需刷新或重启。
7. The 独立登录页 shall 不提供「取消」——它没有可返回之处。

### Requirement 11:随包固化云端默认接入地址

> 2026-07-27 用户追加。全新安装的桌面版打开后没有登录入口(`/api/auth/me` 404),
> 因为它不知道云端在哪 —— 而用户也无从得知该去哪里填。

**Objective:** As a pi-web 桌面用户, I want 装完就能直接登录, so that 我不必先去设置里手填一个我根本不知道的云端地址。

#### Acceptance Criteria

1. When 桌面版首次启动且用户从未配置云端地址, the pi-web 宿主 shall 采用随应用包分发的默认云端地址,使登录入口直接可用。
2. If 用户已配置云端地址, then the pi-web 宿主 shall 采用用户的配置 —— 固化默认值**不得**覆盖它。
3. If 环境变量显式给出云端地址, then the pi-web 宿主 shall 采用环境变量值,优先于用户配置与固化默认值。
4. Where 宿主**不是**桌面应用(命令行、开发服务、浏览器), the pi-web 宿主 shall **不**采用固化默认值,云端登录保持关闭 —— 行为与本特性引入前一致。
5. The 固化默认值 shall 可在构建期被覆盖,使私有化部署无需修改源码即可出自己的桌面包。

### Requirement 12:登录状态跨重启保留

> 2026-07-27 用户裁定:「我们需要保存登陆的状态,每次开应用都重新登陆影响体验」。
> 此前方案曾倾向「不持久化」,理由是凭据本就带 `exp`;该判断被用户以体验为由否决,按用户决定实现。

**Objective:** As a pi-web 桌面用户, I want 关掉应用再打开时仍是登录状态, so that 我不必每次开应用都重输一遍账号密码。

#### Acceptance Criteria

1. When 登录成功, the pi-web 宿主 shall 将凭据持久化到操作系统钥匙串。
2. When 应用重新启动且钥匙串中存在未过期凭据, the pi-web 宿主 shall 直接进入已登录态,不展示登录页。
3. If 钥匙串中的凭据已过期或被云端拒绝, then the pi-web 宿主 shall 回到未登录态并展示登录页,不得停在一个用不了的"已登录"外观上。
4. When 用户登出, the pi-web 宿主 shall 一并清除钥匙串中的凭据。
5. The 凭据 shall **不经过渲染层** —— 持久化路径不得要求渲染层持有凭据明文(延续 Req 8.2)。
6. The 凭据 shall 不出现在任何日志、诊断输出或错误回显中。
7. Where 宿主不是桌面应用, the pi-web 宿主 shall 不产生任何凭据持久化行为。

### Requirement 13:桌面登录为硬性要求

> 2026-07-28 用户裁定:「桌面登陆是必须的,而且绑定默认远程端口」。
> 此前一版曾据打包态烟雾失败加过「暂不登录」出口,**已撤销**(commit 62ea71fe)——
> 那是我把烟雾测试的困境误当成了产品缺陷。

**Objective:** As a 产品负责人, I want 桌面版必须登录才能使用, so that 桌面形态与云端能力绑定,而不是一个可离线使用的本地工具。

#### Acceptance Criteria

1. The 桌面版 shall 绑定随包固化的默认远程端点(Req 11),不提供「跳过登录」之类的旁路。
2. While 桌面宿主处于未登录态, the pi-web 宿主 shall 以登录页替代主界面,不得提供进入主界面的其它入口。
3. Where 宿主**不是**桌面(浏览器 / npm CLI / 云端未配置), the 门禁 shall 不生效 —— 那些形态下登录仍是可选的(Req 10.2/10.3/10.4 不变)。
4. The 自动化验收 shall 走**完整的真实登录链路**验证该门禁,而非绕过它。

> ⚠ 由 3 可知:门禁的"硬性"只对桌面成立。把它做成全局硬性会废掉浏览器与 CLI 形态。
