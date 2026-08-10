# 修订方案 v2：手机登录 + 微信登录移植（pi-web）

状态：已批准并实现（2026-08-07）  
依据：用户纠正 — webapp 与 pi-web 共用同一 Supabase 用户体系；短信 / 微信可完整搬迁，微信使用 webapp 同一 `WECHAT_APPID` / secret；**不得**以「假定端点 + mock」代替真实接入。  
设计规范：`docs/ui-redesign/pi-web-ui-design-spec.md`

---

## 1. 纠正相对 v1

| v1 错误 | v2 |
| --- | --- |
| 云端 SMS/微信契约未知 → adapter + stub | **直接对接同一 Supabase Auth**，流程与 webapp 对齐 |
| 微信仅「云端 ticket 假设」 | **复用 webapp 微信开放平台 appid/secret 与 openid 绑定逻辑** |
| Non-goal：不搬 Supabase、不做 bind-phone 等 | **未声明不做则不排除**；桌面侧做有意义的子集（见 §6） |
| 密码登录与新登录两套用户源 | **同一用户源**；成功后统一签发桌面凭据 |

---

## 2. 现状事实

### 2.1 webapp（源）

- **短信**：`sendSmsCode` → `supabase.auth.signInWithOtp({ phone, channel: 'sms' })`；`loginWithSms` → `verifyOtp({ phone, token, type: 'sms' })`。
- **手机号规则**：11 位大陆裸号为主（`lib/auth/phone.ts`），与 `auth.users.phone` 入库形态一致。
- **微信**：`createWechat` + 桌面 `WxLogin` 扫码；callback 校验 state → `getAccessToken` → 按 `user_metadata.wechat_openid` 找用户 / 建用户 → `admin.generateLink` + `verifyOtp` 建立 session。
- **密码 / 注册 / 绑手机 / 资料与公司门禁**：同属该用户体系（action.ts、account 流）。

### 2.2 pi-web / pi-clouds（目标）

- 桌面密码登录：`POST {cloud}/api/desktop/login { email, password }`  
  → Supabase **password grant** → 查 `profiles.company_id` → `signDesktopToken` → `{ token }`。
- pi-web：`CloudLoginClient` → `DesktopCapabilitiesClient.loadStatic` → `AuthSessionState.set`（**能力先于落态**）。
- 桌面凭据形态：`base64url(JSON{userId,companyId,scope,exp}).HMAC`（`credential.ts`）；secret 在 **pi-clouds**，pi-web 不持签发密钥。
- pi-web `.env.local` 已有本地 Supabase URL/key 注释，说明本机可对齐 webapp 的 Supabase。

**推论**：短信 / 微信在 Auth 层必须走 **同一 Supabase**；桌面长驻身份仍须 **pi-clouds 签发桌面凭据**（与密码路径同构）。不能只在渲染层建 Supabase session 而不换桌面 token。

---

## 3. 目标架构

```text
┌──────────── pi-web UI ────────────┐     ┌──────── pi-web server ────────┐
│ 密码 | 短信 | 微信（设计规范）     │────▶│ IdentityProvider multi-method │
│ autofill / 历史账户 / 重登        │     │ 代理 → 云端 desktop 登录族    │
└───────────────────────────────────┘     └───────────────┬──────────────┘
                                                          │
                                                          ▼
┌────────────────────────── pi-clouds ──────────────────────────────┐
│  POST /api/desktop/login          email+password → Supabase grant │
│  POST /api/desktop/otp/send       phone → Supabase OTP（同 webapp）│
│  POST /api/desktop/otp/verify     phone+code → grant → mint token  │
│  POST /api/desktop/wechat/start   state + QR 参数（同 appid）       │
│  GET  /api/desktop/wechat/callback 同 webapp openid 绑定 + session  │
│       → 校验租户 → signDesktopToken → 回桌面（见 §3.2）            │
└──────────────────────────┬─────────────────────────────────────────┘
                           │
                           ▼
                    同一 Supabase Auth
                    （webapp 用户表 / 短信通道 / wechat_openid）
```

### 3.1 短信（完整搬）

1. UI：手机号 + 验证码、60s 重发、`autocomplete` / `inputMode` 与 webapp 对齐（裸 11 位规则照搬 `phone.ts`）。
2. pi-web：`POST /api/identity/otp/send`、`exchange({ method:'sms', phone, code })` → 转发云端。
3. pi-clouds：
   - send：调用与 webapp 相同的 Supabase OTP API（`/auth/v1/otp` 或等价 `signInWithOtp`）。
   - verify：`/auth/v1/verify`（type sms）得 `access_token` → 与 password 路径相同的 `sub` + `profiles.company_id` + `signDesktopToken`。
4. 失败分类：invalid-otp / expired / rate-limited / no-membership / cloud-unreachable；**失败不写** `AuthSessionState`。

### 3.2 微信（完整搬，同一 appid）

1. 配置：`WECHAT_APPID` / `WECHAT_SECRET` **与 webapp 同源**（pi-clouds 服务端；secret 不进渲染层）。
2. state：与 webapp 同语义（`auth.state` 表或桌面进程内等价单次 state + TTL）；防 CSRF，用后即废。
3. 桌面 QR：
   - 优先：云端 `start` 返回 `appid + redirect_uri + state`，pi-web 用官方 `WxLogin` 或 HTTPS 二维码页（**禁止** `http://res.wx.qq.com` 混入 https CSP；改为 https 官方资源或云端托管页）。
   - `redirect_uri` 指向 **pi-clouds** 桌面微信 callback（可与 webapp callback **共享逻辑**，仅 redirect 终点不同）。
4. Callback 逻辑 **移植 webapp** `login/wechat/callback`：
   - code+state → access_token/openid  
   - `user_metadata.wechat_openid` 查找 / 创建用户  
   - 建立用户身份后 **签发桌面 token**（非 web cookie 主路径）。
5. 桌面取证方式（实现时二选一，优先 A）：
   - **A. 轮询**：callback 将 token 写入短 TTL 的 `state→token` 槽；桌面 `poll(state)` 取走一次（适合 Tauri/本地 server）。
   - **B. 深链**：callback 302 到 `pi-web://auth?token=...` 或 `http://127.0.0.1:<port>/auth/callback`（需确认桌面壳已有回跳能力）。
6. 成功后 pi-web 仍走 `loadStatic` → `AuthSessionState.set` → keychain 同步。

### 3.3 密码路径

- 保持现有 `POST /api/desktop/login` 与 UI；与短信/微信并列，**不削弱**。

### 3.4 登录后统一落态

任意 method 成功后同一管道：

`credential → loadStatic(capabilities) → AuthSessionState.set → onCredentialChanged / shell syncCredential`

禁止半登录（有凭据无授予）。

---

## 4. 行业标准便捷能力（一等公民）

| 能力 | 落地 |
| --- | --- |
| **自动填充** | `name`/`id`、`autocomplete=username\|email\|tel\|one-time-code\|current-password`、`inputMode`；真 label，不只靠 placeholder |
| **本机自动登录** | 沿用 keychain / `PI_WEB_DESKTOP_CREDENTIAL` 冷启动 seed；有效则 auto；过期则清 keychain + 展示登录，**禁止死循环** |
| **Auth 失效与续期** | `credentialStatus` 过期 → `needsReauth`；会话流 401 调 `markSessionAuthFailure`；若云端后续提供 refresh 桌面 token 则静默续，否则强制重登。Supabase refresh 仅用于 OTP/微信中间会话，**不以 Supabase session 替代桌面凭据** |
| **历史登录账户** | 本地存 email/phone/微信展示名等 **标识符**（可脱敏）；点击回填；可删除；**永不存** password/OTP/token |
| **短信 UX** | 60s 冷却、忙态、错误分类文案 |
| **微信 UX** | loading / 展示 / 过期重试 / 成功 / 取消停 poll |

---

## 5. UI（设计规范）

- 安静工作台登录：CSS vars、控件 `rounded-[7px]`、外层 ~10px、密度 6；无营销 Hero/大视频分栏（webapp 营销分栏 **不**照搬布局，只搬能力与交互语义）。
- 方法切换：密码 | 短信 | 微信；page / inline(reauth) 行为一致。
- a11y：label、`role=alert`、`aria-live`、focus ring；尊重 reduced-motion。

---

## 6. 范围（相对 webapp 全量）

### 6.1 本迭代必须

- 短信登录（发码 + 验证 → 桌面凭据）
- 微信扫码登录（同 appid，openid 绑定逻辑与 webapp 一致 → 桌面凭据）
- 密码不回归
- 便捷能力 §4
- 设计规范 UI
- 测试 + env/契约文档

### 6.2 同用户体系下应一并纳入（非 v1「不做」）

| 项 | 说明 |
| --- | --- |
| **无公司归属** | 与密码一致返回 403 `no-membership`；UI 明确文案（webapp 的 companies-required 语义对齐，路由可仍为登录内提示） |
| **未绑定手机号用户 OTP 后自动建户** | 与 webapp/SOP 一致；建户后无 company 仍走 no-membership |
| **微信新用户创建** | 与 webapp callback 一致（含 openid 元数据） |
| **绑手机 / 绑微信（已登录）** | 若桌面有账号设置入口则做；否则在 identity API 预留，UI 可放 account-bar 菜单 — **默认本迭代做最小绑手机入口**（设置或账号菜单），与 webapp `sendBindPhoneCode` / `verifyBindPhone` 同 Supabase API |

### 6.3 可后置（产品桌面非刚需，**不是永久砍掉**）

- webapp 控制台内 admin 用户 phone 展示
- 资料完善页完整克隆（profile_completed → 网页 account 流）
- 企微 / 微信客服等非开放平台扫码登录

---

## 7. Workstreams

### W1 · pi-clouds：桌面短信 + 微信签发

- 扩展 desktop 登录族：otp send/verify、wechat start/callback(+poll 槽)
- 抽取与 password 共用的：`subFromJwt`、tenantCompanyId、signDesktopToken
- 移植 webapp wechat callback 核心（openid 查找分页、建户、元数据）
- Env：`PI_CLOUDS_SUPABASE_*`、`WECHAT_APPID`、`WECHAT_SECRET`、`WECHAT_DESKTOP_REDIRECT_URI`、token secret
- 测试：mock Supabase / 微信

### W2 · pi-web adapters：客户端与 IdentityProvider

- `CloudSmsClient` / `CloudWechatClient`（或统一 `CloudLoginClient` 多 method）
- `IdentityCredentials` 扩 `sms` | `wechat`
- routes：otp send、exchange 分发、wechat start/poll
- 保持 capabilities-before-set
- 单测 + 脱敏探针

### W3 · pi-web UI

- `LoginForm` 多方法；`sms-login-form`、`wechat-login-panel`
- `use-identity` 扩展 API
- 设计规范 token / a11y / autofill
- 历史账户模块

### W4 · 便捷会话

- 历史账户存储
- 过期 seed 清理与 needsReauth 贯通
- 文档：env、host contract、与 webapp 共享 Supabase/微信配置说明

---

## 8. 主要改动路径（示意）

**pi-clouds**

- `apps/cloud/app/api/desktop/login/route.ts`（抽取公共签发）
- 新增 `.../otp/send`、`.../otp/verify`
- 新增 `.../wechat/start`、`.../wechat/callback`、（可选）`.../wechat/poll`
- 共享 lib：`desktop-token`、wechat client、phone normalize（对齐 webapp）

**pi-web**

- `packages/adapters/src/auth/*`、`identity/*`
- `components/auth/*`
- `lib/app/pi-handler.ts` 装配
- tests 对应目录
- docs：host contract / desktop-cloud-integration

---

## 9. 验收

1. 同一 Supabase 用户：webapp 注册/绑定的手机号，可在 pi-web 短信登录成功（有 company 时）。
2. 同一微信 openid：webapp 已绑用户，扫码可登 pi-web。
3. 密码路径回归绿。
4. 无 company → 明确失败，不落半登录。
5. 历史账户仅标识符；日志无 secret/OTP/token/password。
6. 冷启动有效凭据自动登；过期清凭据并显示登录。
7. UI 符合设计规范；短信 60s；微信 cancel 停 poll。
8. 相关单测绿。

---

## 10. 风险与配置

- **微信 redirect_uri**：须在微信开放平台配置 **pi-clouds 桌面 callback URL**（与 webapp 可并存多条授权回调域）。
- **短信配额 / 模板**：走既有 Supabase 短信通道，与 webapp 共用配额。
- **CSP**：WxLogin 脚本必须 https。
- **跨仓**：本能力需 **pi-clouds + pi-web** 联动；仅改 pi-web 无法签发桌面 token。

---

## 11. 请审批

请确认或批注：

1. **云端扩展**（§3 + W1）是否同意：在 pi-clouds 增加 otp/wechat 桌面签发，而不是只在 pi-web 直连 Supabase 却无法 mint 桌面凭据。  
2. **微信回桌面**优先 **A 轮询 state→token** 还是 **B 本地/深链 callback**。  
3. **绑手机最小入口**是否本迭代必做。  
4. 是否批准按 v2 **开工实现**（pi-clouds → pi-web adapters → UI）。
