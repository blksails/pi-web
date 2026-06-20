# 检阅 · webext 多源批量验收清单

> **检阅** = 用 chrome-devtools 同时打开多个 tab，每个 tab 加载一个 webext 相关的
> agent source，完成「最简首次步骤」（选 source → 会话激活），供人工逐项验收。
> 一次覆盖全部 webext 示例，对照各自的 Tier 能力。

---

## 0. 前置环境检查

| 检查项 | 命令 / 操作 | 期望 |
|---|---|---|
| dev server 在跑 | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` | `200`（注意：通常约定 3010，本机当前 3000，以实际监听为准） |
| source picker 在场 | `curl -s localhost:3000/ \| grep -o 'data-agent-source-[a-z]*'` | `input/picker/submit` 三件套 |
| chrome-devtools 专用 Chrome 可连 | `list_pages` | 不报 "browser already running / profile locked" |

**不要** 在 dev 运行时跑 `next build`（污染共享 `.next` → webpack 500）。见 [[no-next-build-while-dev-running]]。

### 0.1 Chrome profile 锁卡死的解法
若 `list_pages` 报 *"browser is already running for …/chrome-profile, use --isolated"*：
旧 MCP 进程用管道独占了 profile 锁，当前会话连不上。释放（**只杀 MCP 专用 Chrome，别动你日常 Chrome**）：

```bash
# 1. 确认目标是 MCP 专用 Chrome：command 里含 --user-data-dir=.cache/chrome-devtools-mcp/chrome-profile
ps aux | grep 'chrome-devtools-mcp/chrome-profile' | grep -v grep | awk '{print $2}'
# 2. 杀这些 PID，并清残留锁
rm -f ~/.cache/chrome-devtools-mcp/chrome-profile/Singleton{Lock,Socket,Cookie}
# 3. 重新 list_pages，让当前 MCP 拉起干净 Chrome
```

---

## 1. 检阅对象 · 7 个 webext source 与验收要点

| # | source（`./examples/…`） | Tier / 能力 | 验收要点 | 首屏可见？ |
|---|---|---|---|---|
| 1 | webext-layout-agent | Tier1 区域插槽 | panelRight「领域检视面板」+ header 三区(Nav/Layout Agent/Help) + footer | ✅ |
| 2 | webext-slots-agent | Tier1 12 保留插槽 | 12 个 `data-pi-ext-*` 全渲染；**追加不替换**内核输入/消息面 | ✅ |
| 3 | webext-background-agent | Tier1 自定义背景 | 极光背景在消息层之下；会话态浮动底栏**无**纯色渐隐带 | ⚠️ 需进会话态 |
| 4 | webext-renderer-agent | 自定义消息渲染器 | 自定义 part 渲染 | ⚠️ 需有消息 |
| 5 | webext-artifact-agent | Tier4 artifact iframe | **仅当设了 `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` 才挂载 `<ArtifactSurface>` iframe**；裸 dev 无 iframe/无 `data-pi-ext-artifact-surface` 是**正确门控**（别误判）。见 [[webext-artifact-base-url-gate]] | ⚠️ 需配 base-url |
| 6 | webext-declarative-agent | 纯声明(theme/layout) | **零 bundle、无扩展面板、回退默认聊天**（预期"像默认"，别误判为没加载） | ✅ |
| 7 | webext-contrib-agent | Tier3 ui-rpc 贡献点 | slash/mention/autocomplete/keybinding 贡献 | ⚠️ 仅 `hasContributions && !isBusy` 时开，见 [[pi-web-uirpc-idle-control-stream]] |

---

## 2. 每个 tab 的「最简首次步骤」（chrome-devtools）

> 每个 source 一个 tab；picker 快照结构固定：textbox=`uid=N_7`、submit=`uid=N_8`。

1. `new_page` → `http://localhost:3000/`（第一个可复用现有空白页 `navigate_page`）
2. `take_snapshot` → 取 picker uid
3. `fill` `uid=N_7` = `./examples/webext-<name>`
4. `click` `uid=N_8` → URL 落到 `/session/<id>`（会话激活）
5. **验证扩展已渲染**（确认不是空壳）：
   ```js
   // evaluate_script
   () => {
     const s = new Set();
     for (const el of document.querySelectorAll('*'))
       for (const a of el.attributes) if (a.name.startsWith('data-pi-ext')) s.add(a.name);
     return { url: location.pathname, extCount: s.size,
              sessionActive: !!document.querySelector('[data-session-active]') };
   }
   ```
   - slots → `extCount===12`；layout → panelRight/footer 在；declarative → 仅 `data-pi-ext-theme` 一个包裹（`extCount===1`、`panelRight===false`，符合预期：声明式只应用主题/布局，无 slot 面板）。

---

## 3. 验收注意事项

- **3 / 4 / 7 需驱动一轮**才显形：`fill [data-pi-input-textarea]` + 点 `[data-pi-submit-state="send"]`（或 `发送`）发一条 stub 消息。
- **刷新不丢扩展**（已修复）：source 经 app 级 `sessionId→source` 映射按 id 恢复，URL 保持纯净 `/session/:id`，不暴露文件路径。验收时刷新一个 fresh 会话应仍见扩展。见 [[webext-review-checklist]] 关联的 resume 修复。
- **declarative 的"无扩展"是正确结果**，不是 bug。
- 改了注入路由 / 配置域后需重启 dev（handler 单例 pin 在 globalThis）。见 [[pi-web-handler-singleton-restart]]。
- 背景层负 z-index 需 `isolation:isolate` 逃逸壳底遮挡。见 [[pi-web-bg-slot-isolate]]。

---

## 4. 一键收尾

- 列出全部会话：`list_pages`，逐 tab `select_page` + 截图/快照存证。
- 证据落 `.kiro/specs/agent-web-extension-visual-acceptance/evidence/`。
- 相关特性总览见 [[agent-web-extension-spec]]。
