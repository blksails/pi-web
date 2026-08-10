# 手机 / 微信桌面登录 — 环境变量

pi-clouds 与 webapp **同一 Supabase**；微信 **同一开放平台 appid**。

## pi-clouds

| 变量 | 说明 |
| --- | --- |
| `PI_CLOUDS_SUPABASE_URL` | Supabase URL（已有） |
| `PI_CLOUDS_SUPABASE_KEY` | service_role（已有） |
| `PI_CLOUDS_DESKTOP_TOKEN_SECRET` | 桌面凭据 HMAC（已有） |
| `WECHAT_APPID` 或 `PI_CLOUDS_WECHAT_APPID` | 与 webapp 相同 |
| `WECHAT_SECRET` 或 `PI_CLOUDS_WECHAT_SECRET` | 与 webapp 相同 |
| `WECHAT_DESKTOP_REDIRECT_URI` | 例：`https://<cloud-host>/api/desktop/wechat/callback`（须在微信开放平台登记） |

## 新增云端路由

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/api/desktop/login` | 邮箱密码（既有） |
| POST | `/api/desktop/otp/send` | 发短信 |
| POST | `/api/desktop/otp/verify` | 验短信 → 桌面 token |
| POST | `/api/desktop/wechat/start` | state + QR URL |
| GET | `/api/desktop/wechat/callback` | 微信回调 → poll 槽 |
| GET | `/api/desktop/wechat/poll?state=` | 桌面轮询（token 一次） |
| POST | `/api/desktop/otp/bind/send` | 绑手机发码（Bearer 桌面凭据） |
| POST | `/api/desktop/otp/bind/verify` | 绑手机校验 |

## pi-web

无需新 env：登录 URL 仍由 `cloud.egressBase` 推导 `…/login`，再推导 sibling 路径。  
本地代理：`/api/identity/*`。
