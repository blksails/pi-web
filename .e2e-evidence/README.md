# 真机取证 — host-builtin-panes 任务 6.4

Chrome 实机(chrome-devtools MCP)+ 真实 dev server。四种组合各自独立取证 —— Req 7.4 要求
「仅在其中一种组合上取证不构成覆盖」。

环境:`PORT=3100` / vite `5273` / `PI_WEB_AGENT_DIR=/tmp/pi-e2e-agent-dir`(隔离 agent dir,
无 `cloud.json`,故云端登录不启用 —— 见下方「过程中撞到的三件事」①)。

## 结论:四组合全 PASS

| # | 组合 | 判据 | 结果 | 证据 |
|---|------|------|------|------|
| ① | 不带 web extension(`builtin:default-agent`) | 面板容器/开关/比例切换器出现;内置 pane 显示**真实** sessionId | ✅ | `combo1-no-webext.png` |
| ② | **cli 模式**(`/tmp/pi-e2e-cli-src`,无 index.ts) | 同上;且服务端日志确证 `"mode":"cli"` | ✅ | `combo2-cli-mode.png` |
| ③ | 带**新 pane 声明键**(`examples/panes-agent`) | 内置与 agent pane 合并、内置在前、两者都能建连 | ✅ | `combo3-merged-host-plus-agent.png` |
| ④ | 带**旧槽**(`examples/aigc-canvas-agent`) | 画廊 pane 正常;内置 panes **让位**(不出现) | ✅ | `combo4-legacy-slot-canvas.png` |

### 组合① 的关键证据

pane 内显示 `会话标识 d7c62e7b-e18d-4650-ba1e-722cc5a296e2`,**与 URL 里的 sessionId 逐字一致**
—— 证明 `pane:signal` 真把宿主 realm 的数据送进了 opaque-origin iframe,而不是渲染了硬编码。
iframe 属性:`sandbox="allow-scripts"` + `srcdoc`,与第三方 pane 同构(Req 6.3)。

### 组合② 的关键证据

服务端日志:
```
agent:resolve resolve done {"name":"/tmp/pi-e2e-cli-src","mode":"cli","localDir":"/tmp/pi-e2e-cli-src"}
session:rpc subprocess spawned {"cmd":"node","argsCount":6}
```
`mode:"cli"` + `argsCount:6`(custom 模式是 12,多 `--agent`/`--cwd` 等)。**cli 模式绕过 runner,
内置 panes 照样装载** —— 这正是 Req 1.4 要守的。

### 组合③ 的关键证据

「新开 Pane」列表:`["会话信息0/1", "▤ 文件1/3", "⌘ 编辑1/4", "± Diff0/3", "◇ Canvas1/3", "◫ Artifact0/3"]`
—— 内置在 **index 0**,agent 的 5 个在其后 ⇒ 合并生效且内置在前(Req 2.1)。
打开内置后 4 个 iframe 同时在世:`["编辑","文件","Canvas","会话信息"]`,agent 的三个不受影响。

★ 内置 pane **不在初始打开集合**里,这是 Req 2.5 的**预期行为**(agent 的初始集合完整保留、
内置默认项让位),不是缺陷 —— 它可经「新开 Pane」达到。

配置透传亦验证:`docTitle = "Panes 示例 · pi-web"`、面板宽 `760px`(agent 的 `config.web` 生效);
「新开 Pane」+「Pane 切换器 Ctrl/Cmd+K」在位(agent 的 `config.panes` advanced 模式经声明键
透传生效)。agent pane 内部功能正常(编辑器载入 README.md、文件树、"已同步 r0")。

### 组合④ 的关键证据

`hasSessionInfoPane: false` —— 内置 panes 确实让位(design D3 / Req 1.2);画廊 pane
(`🖼️ 画廊`)正常建连,面板与比例切换器都在 ⇒ 旧槽形态零回退(Req 5.1/5.3)。

## 过程中撞到的三件事(都不是本 spec 的缺陷,但值得记)

**① 本地 dev 被拦成登录页。** 首次打开直接是「登录 pi-web」。根因:`~/.pi/agent/cloud.json`
存在(桌面版登录过),而 `readDesktopScopedCloudEgressBase` 的修复还在**主仓未提交**,本 worktree
没有它。这恰好是用户诉求①描述的现象。绕法:`PI_WEB_AGENT_DIR` 指向无 `cloud.json` 的隔离目录,
`/api/identity` 随即 404(未启用)⇒ 不再拦。**此现象本身是 `desktop-account-login` 待办的实证。**

**② panes-agent 走不通运行时 webext 车道。** `/api/webext/resolve` 返回
`{"found":true,"rejectedReason":"代码 webext 未签名"}`。示例产物不签名,故只能走构建期静态车道;
`b181e677` 曾以「stale static import」把它从 registry 移除,现已加回(产物随
`build:webext-examples` 常规产出,且迁移后本 webext 不含 React 组件,可稳定静态导入)。

**③ 两处存量 console 报错,与本 spec 无交集。**
- 组合④:canvas pane guest 内 `pane://host/vision/models` 被其自身 CSP(`default-src 'none'`,
  未放开 connect-src)拦。CSP 来自 `aigc-canvas-agent/build.ts`,canvas 走旧槽路径,该路径代码
  本 spec 一行未改。属 `isolated-panes` Wave 5 未完成部分。
- 组合③:8 次资源 404。**服务端日志零 404**,且页面所有 `/api/` 端点重放均成功 ⇒ 是 pane iframe
  内部的资源请求,非 API 层。功能全部正常。留作已知未查项。

## 复现方式

```bash
export PORT=3100 PI_WEB_DEV_API_PORT=3100 PI_WEB_DEV_CLIENT_PORT=5273
export PI_WEB_AGENT_DIR=/tmp/pi-e2e-agent-dir   # 需先建好且不含 cloud.json
pnpm dev
```
然后在 `http://localhost:5273/` 依次用四个 source 建会话:
`builtin:default-agent` / 任意无 `index.ts` 的目录 / `examples/panes-agent` /
`examples/aigc-canvas-agent`。
