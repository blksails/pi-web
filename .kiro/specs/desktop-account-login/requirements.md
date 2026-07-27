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

## 待定的首要设计决策(进 requirements 前须先答)

**身份获取落在哪一层**:

- **A. 扩契约** —— 新增 `IdentityProvider`,或给 `CapabilityProvider` 增加身份获取方法。语义最正,桌面与云端各自实现;但动的是 v1 契约,边界跨仓,值得独立成 spec。
- **B. 桌面实现自带** —— 身份获取视为桌面 `CapabilityProvider` 实现的内部细节,契约不动。改动面小;但"怎么登录"在不同宿主间不可复用,且本 spec 应并入 `desktop-cloud-login` 任务组 9 而非独立存在。

选型须一并回答:**云端多租户 web 是否也需要这条路径**,还是其身份天然来自会话 cookie。

## 已确定的实现约束

- **凭据明文不得进渲染层**:前端提交 email/password 到本地服务端,由服务端转发云端并持有凭据。理由:桌面壳有 CSP;跨域;现有粘贴形态已让明文过渲染层,应一并修掉。
- 登录 URL 由已配置的 `egressBase` 推导(与 capabilities URL 同款规则),不新增配置项。
- 凭据格式由云端签发(`base64url(payload).HMAC`),本仓**只解 payload、不验签**(验签在云端 egress)。
- 延续 `desktop-cloud-login` Req 5 安全不变式:凭据不落日志、不进响应体。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase(需先定 A/B 选型) -->
