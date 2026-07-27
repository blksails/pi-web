# Brief: desktop-account-login

> Discovery 日期:2026-07-27 · 上游 `desktop-cloud-login`(`implementation-complete`)、宿主契约 v1 P2 端口

## Problem

桌面用户**无法登录**。`desktop-cloud-login` 交付了登录组件、鉴权端点、凭据解析与钥匙串存取,但那个"登录"是一个**粘贴凭据串**的输入框 —— 用户手上根本没有凭据串,也没有任何途径获得它。

更深一层:宿主契约 v1 定义了 P2 端口 `CapabilityProvider`(标注 **「云端可选;桌面必须」**),它负责"拿着身份换授予"(`tenant` / `egress` / `sources` / `attachments`),但**契约里没有定义身份本身怎么获得**。桌面实现因此卡在起点 —— 没有身份就拿不到任何授予。

## Current State

**已有(实测确认)**:

- 云端真实契约(2026-07-27 探明):`POST /api/desktop/login { email, password }` —— 400 `email and password required` / 401 `Invalid login credentials`。**没有 device 授权端点**(`/api/desktop/device`、`/api/desktop/device/start`、`/api/auth/login`、`/api/auth/signin` 全 404)。
- 本地服务端只接受**已获得**的凭据:`POST /api/auth/session { credential }` / `DELETE /api/auth/session` / `GET /api/auth/me`;`AuthSessionState` 提供 `set`/`clear`/`isValid`/`currentCredential`/`snapshot`。
- `DesktopCapabilitiesClient`(P1 `desktop-hybrid-agent-sources` 交付)已能用凭据换 `sources` 授予,但**只取了 `sources` 一个字段**。
- 云端地址已可配置(`desktop-cloud-login` Req 8,`~/.pi/agent/cloud.json` + 设置面板),登录能力面已能启用(`/api/auth/me` 200)。

**缺口**:

1. **身份获取未落契约** —— `CapabilityProvider` 定义了"用身份换授予",没定义"怎么拿到身份"。
2. **`tenant` 字段无人消费** —— `CapabilitySnapshot.tenant`(`userId`/`companyId`/`role`)契约里有,代码里没有任何消费方。
3. **登录 UI 名不副实** —— `login-control.tsx:14` 的注释称"device 授权流由 pi-cloud 承载",而云端**根本没有 device 端点**;该注释是过时推测。

## Desired Outcome

桌面用户打开应用 → 填账号密码 → 登录成功 → 身份与授予(`tenant`/`egress`/`sources`)一次到位 → 线上源可见可用、模型走云端出口。整条链路不需要用户接触任何凭据串。

## Approach

**待定(本 spec 的第一项设计决策)**:身份获取应落在哪一层。两条候选:

- **A. 扩契约** —— 在宿主契约新增 `IdentityProvider`(或给 `CapabilityProvider` 加身份获取方法),桌面与云端各自实现。语义最正,但动的是 v1 契约。
- **B. 桌面实现自带** —— 身份获取视为桌面 `CapabilityProvider` 实现的内部细节,契约不动。改动面小,但"怎么登录"在不同宿主间无法复用。

选型须一并回答:云端(多租户 web)是否也需要这条路径,还是它的身份天然来自会话 cookie。

**已确定的实现约束**:凭据明文**不得进渲染层** —— 前端提交 email/password 到本地服务端,由服务端转发云端并持有凭据。理由:桌面壳有 CSP;跨域;且现有"粘贴凭据串"形态已让明文过渲染层,应一并修掉。

## Scope

- **In**:身份获取的契约定位与实现;账号密码登录端点(本地代理);登录 UI(替换粘贴框);`tenant` 字段的消费(登录态展示身份);登录后授予三件套(`tenant`/`egress`/`sources`)一次到位;失败态(401/网络/未配置云端)。
- **Out**:云端 `/api/desktop/login` 本身的任何改动;注册/找回密码/多因素;`attachments` 会话作用域授予(属既有附件线);云端多租户 web 的身份实现(除非选型判定需要一并做)。

## Boundary Candidates

- **身份获取**(登录 → 凭据):本 spec 的核心新增。
- **授予装载**(凭据 → `CapabilitySnapshot`):扩写既有 `DesktopCapabilitiesClient`,补齐 `tenant`/`egress`。
- **登录 UI**:替换 `login-control.tsx` 的粘贴形态;用户已明确表示 UI 可自行实现。
- **契约面**:是否新增端口 —— 决定后才知道边界落在 pi-web 还是跨仓。

## Out of Boundary

- 不改云端契约(`POST /api/desktop/login` 按现状对接)
- 不动 `Workspace`(P1 端口)—— 它是存储抽象,与身份无关(已核实:`workspace/types.ts` 中 `auth`/`credential`/`login` 命中 0 次)
- 不改既有 `POST /api/auth/session` 的语义(粘贴形态可保留为兜底)

## Upstream / Downstream

- **Upstream**:`desktop-cloud-login`(登录态、凭据解析、钥匙串、云端地址配置)、宿主契约 v1 P2 `CapabilityProvider`、`desktop-hybrid-agent-sources`(`DesktopCapabilitiesClient`)
- **Downstream**:`desktop-online-source-runnable`(线上源安装依赖 `sources` 授予)、模型目录与 egress 出口(依赖 `egress` 授予)

## Existing Spec Touchpoints

- **Extends**:`desktop-cloud-login`(登录这件事本属它;若契约不动,可考虑并入其任务组 9 而非独立 spec —— 见下方 Constraints)
- **Adjacent**:`host-contract-ports`(若选 A 需更新契约文档与该 spec)、`desktop-hybrid-agent-sources`(`DesktopCapabilitiesClient` 扩写)

## Constraints

- 云端契约固定:`POST {cloudBase}/api/desktop/login { email, password }`,401 `Invalid login credentials`。
- 凭据明文不进渲染层、不落日志、不进响应体(延续 `desktop-cloud-login` Req 5 的安全不变式)。
- 桌面凭据格式由云端签发:`base64url(JSON{userId,companyId,scope,exp}) + "." + HMAC`;本仓只解 payload、**不验签**(验签在云端 egress)。
- 登录 URL 由已配置的 `egressBase` 推导(与 capabilities URL 同款推导规则),不新增配置项。
- **独立成 spec 还是并入 `desktop-cloud-login` 任务组 9,取决于选型 A/B** —— 选 A(动契约)边界明显更大,值得独立;选 B 则应并入。这是进入 requirements 前要先定的事。
