# webext-renderer-agent · 人工测试记录

- **日期**：2026-06-20
- **测试者**：pi-web 测试 agent（chrome-devtools 单实例串行）
- **被测对象**：`examples/webext-renderer-agent`（Tier 2 自定义渲染器示例）
- **分支**：`pi-team/260620-202918-4e`

## 1. 被测能力

`.pi/web/web.config.tsx` 通过 `defineWebExtension` 注册 `capabilities: ["renderers"]`，提供两个自定义渲染器：

| 渲染器 | 命中目标 | 标记 | 视觉 |
|---|---|---|---|
| `EchoToolRenderer` | tool `echo` | `data-testid="echo-tool-card"` | 🔧 紫框卡片（`#7c3aed` / 圆角 6px） |
| `MetricRenderer` | data-part `data-metric` | `data-testid="metric-card"` | label: value（灰框 `#ddd`） |

## 2. 测试环境与关键前置

- **真实 LLM dev（:3000）下渲染器永不显形**：该 source 的 `index.ts` 只有 systemPrompt，不发任何工具 / `data-metric` 部件 → 自定义渲染器无命中目标，只回纯文本。这是设计使然，非缺陷。
- 因此自定义渲染器的**视觉触发**改用隔离 stub dev（不扰动共享 :3000 的 `.next`）：

  ```bash
  # 从主仓 agents/pi-web 跑（worktree 无 node_modules）
  PI_WEB_STUB_AGENT=1 PI_WEB_DEFAULT_SOURCE=./examples/webext-renderer-agent \
  NEXT_DIST_DIR=.next-stub node_modules/.bin/next dev -p 3011
  ```

  stub agent 每轮自动发 `echo` 工具 → 命中 `EchoToolRenderer`。独立 `distDir` + 端口，不碰 :3000。

## 3. 最简首次步骤

1. `:3011/` picker（已由 `PI_WEB_DEFAULT_SOURCE` 预填 `./examples/webext-renderer-agent`）→ Start session
2. 落 `/session/a8198b93-…`，`sessionActive=true`、输入框在
3. 发一条 stub 消息 `hello renderer` → stub 回合发 `echo` 工具
4. `wait_for` "扩展自定义 echo 工具渲染器" → 命中

## 4. 逐项核对结果

| 核对项 | 方法 | 结果 | 判定 |
|---|---|---|---|
| **加载** | source 解析 → 会话激活，URL 纯净 `/session/:id` | `:3000` 与 `:3011` 均 `sessionActive=true`、输入框在；无 console error/warn | ✅ |
| **渲染** | 发 stub 消息驱动一轮，echo 工具命中扩展渲染器 | `echo-tool-card` 显形，文案 `🔧 扩展自定义 echo 工具渲染器(webext-renderer)`；边框 `rgb(124,58,237)=#7c3aed`、圆角 6px，与 `web.config` 一致 | ✅ |
| **UI 控制层（注册表覆盖）** | 统计内核默认工具渲染节点 `[data-pi-tool]` | `piToolCount=0` —— 扩展渲染器**完全替换**内核默认工具渲染，注册表覆盖生效 | ✅ |
| **右侧分离** | 取卡片 `getBoundingClientRect` | Tier 2 渲染器**不提供 panelRight**；卡片嵌入标准居中单列消息流（x=292, w=728, viewport=1271）。右侧分离对本 source **N/A**（属 Tier1 layout-agent 能力） | ➖ N/A |
| **暗色对比度** | 切暗色主题，计算 WCAG 对比度 | 文字 `rgb(250,250,250)` vs 背景 `rgb(9,9,11)` = **19.06**（远超 AA 4.5 / AAA 7）；紫框 vs 暗背景 = **3.49**（超非文字 UI 组件阈值 3.0，边框清晰可见）。渲染器未硬编码文字色 → 随主题自动反白 | ✅ |

## 5. 已知非问题

- **`data-metric` 渲染器（MetricRenderer）无产出点**：全仓任何车道（含 stub）都只发 `echo`，不发 `data-metric` 部件 → `metric-card` 计数恒为 0。属示例自身缺陷，非测试 / 实现问题。
- `MetricRenderer` 硬编码亮色边框 `#ddd`，暗色态会偏淡（如未来接入产出点需注意）；`EchoToolRenderer` 无此问题（边框用品牌紫、文字继承主题）。

## 6. 证据截图

| 文件 | 场景 |
|---|---|
| `renderer-01-session-active-20260620.png` | :3000 真实 dev — source 加载 + 会话激活（渲染器未显形，符合预期） |
| `renderer-02-echo-rendered-light-20260620.png` | :3011 stub — echo 工具渲染器命中（亮色态） |
| `renderer-03-echo-rendered-dark-20260620.png` | :3011 stub — echo 渲染器（暗色态，对比度核对） |

## 7. 结论

**PASS。** `webext-renderer-agent` 的 Tier 2 自定义工具渲染器在 stub 车道下正确命中并渲染，注册表覆盖（`[data-pi-tool]=0`）、暗色对比度（19.06 / 3.49）、加载 / 会话激活均达标，无 console 报错。右侧分离对本 source 不适用（N/A）。`data-metric` 渲染器无产出点为已知示例缺陷，不影响本验收。
