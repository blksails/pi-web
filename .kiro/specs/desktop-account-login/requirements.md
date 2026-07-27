# Requirements Document

## Project Description (Input)

**谁有问题**:pi-web 桌面用户 —— 目前**无法登录**。

**现状**:`desktop-cloud-login` 交付了登录组件、鉴权端点、凭据解析与钥匙串存取,但那个"登录"是一个**粘贴凭据串**的输入框,而用户手上根本没有凭据串、也没有途径获得。云端地址已可配置(该 spec Req 8),登录能力面已能启用(`/api/auth/me` 返回 200),唯独差"怎么拿到身份"。

更深一层:宿主契约 v1 定义了 P2 端口 `CapabilityProvider`(标注**「云端可选;桌面必须」**),负责用身份换取 `tenant` / `egress` / `sources` / `attachments` 授予,但**契约本身没有定义身份如何获得**。没有身份就拿不到任何授予 —— 桌面实现卡在起点。

**该改成什么**:桌面用户填账号密码即可登录,登录后身份与授予一次到位(线上源可见可用、模型走云端出口),全程不接触任何凭据串。

## 实测确认的事实(2026-07-27)

1. **云端真实契约是账号密码**:`POST /api/desktop/login { email, password }` —— 400 `email and password required` / 401 `Invalid login credentials`。**没有 device 授权端点**(`/api/desktop/device`、`/api/desktop/device/start`、`/api/auth/login`、`/api/auth/signin` 全 404)。故 `login-control.tsx:14` 注释所称"device 授权流由 pi-cloud 承载"是**过时推测**。
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

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase(需先定 A/B 选型) -->
