# 真机诊断与视觉验收记录

## 结论摘要（★ 本 spec 的前提被真机证伪）

**几何链路是通的，chrome 没有被遮挡。本 spec 立项时的机制假设不成立。**

真机数据（打包版 `pi-web_0.3.0_aarch64.dmg`，装载 `../pi-agents/aigc-agent`，
`PI_WEB_PANE_LAYOUT_DEBUG=1`，代码为提交 `bf8fa79a`——含诊断、**不含**修复）：

```
[panes] 落位 slot=(0.0,0.0,0.0x0.0)       窗口=1200x800   top_height=0   mode=HostFullscreen
[panes] 落位 slot=(792.0,0.0,408.0x800.0)  窗口=1200x800   top_height=0   mode=Workspace   ← 瞬态
[panes] 落位 slot=(717.0,29.0,479.0x771.0) 窗口=1200x800   top_height=29  mode=Workspace   ← 稳定态
[panes] 落位 slot=(2957.0,29.0,479.0x1386.0) 窗口=3440x1415 top_height=29 mode=Workspace  ← 最大化后
```

稳定态的槽从 **y=29** 起，即 chrome 那 29px **是被正确让出来的**。窗口最大化后
（3440×1415）槽为 `(2957, 29, 479×1386)`，坐标与截图中右侧面板的边缘吻合。

## 真实症状（与假设的差别）

- **假设**：pane 内容盖住 tab 栏 → 用户无法切换 pane。
- **实测**：pane 内容**没有**盖住任何东西。chrome 的 29px 带子存在、被正确保留，
  但**那条带子里什么也没画**——没有 tab、没有「新开 Pane」、没有刷新按钮。
- **交互验证**：在该带子内点击（最大化窗口下 `(1550, 30)`），**无任何反应**，
  不弹菜单。说明不是「画出来了但看不见」，而是那里根本没有可交互的 chrome。

因此真正的缺陷是 **panes chrome 渲染为空**，而不是被遮挡。用户「无法切换 pane」
的后果是对的，成因判断错了。

## 那么本 spec 的修复还有价值吗

**有，但它修的不是这个症状。** 上面日志的第 2 行是硬证据：

```
[panes] 落位 slot=(792.0,0.0,408.0x800.0) 窗口=1200x800 top_height=0 兜底=false mode=Workspace
```

在 metrics 到达之前，确实存在一帧 **y=0、高度铺满** 的槽——那正是会盖住 chrome 的
矩形。它是**瞬态**的（几何随后到达并自我纠正），所以不构成用户看到的持久症状；
但它是真实的降级面，且此前有三条路径都会落进去（默认解算 + 两处兜底副本）。
本 spec 的改动消除了整个降级面，属于**真实但潜在**的缺陷修复。

## 后续该查什么（不在本 spec 范围内，另立）

chrome 占了 29px 布局却不渲染任何内容。可查方向按代价排序：

1. `panes-host.tsx:1728` 的 `<header data-panes-chrome data-panes-tabs>` 在真机上
   是否真的挂载了子节点——29px 与「一个空 header」的高度是否相符。
2. 「新开 Pane」「刷新」两个按钮是无条件渲染的（`:1697`、`:1702`），它们不出现
   意味着 header 的整个子树没渲染，而不是被样式藏了。
3. `tabInstances` 为空时的分支，以及 chrome 是否被 `isPanesHostChromeHidden`
   之类的门控折叠。

## 未完成项

- **视觉验收（任务 4.3）未做**：修复版尚未重新打包，且既然症状成因已被证伪，
  「修复后 tab 栏可见」这一验收条件本身不成立——tab 栏不可见与本 spec 的改动无关。
- **任务 4.1 的断言两次都没写成**（详见 `tasks.md` 的 ⚠ 记录），未留假绿。

## 顺带发现的两个无关缺陷

1. 宿主顶栏的沙箱状态把 ANSI 颜色码当文本渲染了：实际显示为
   `[38;2;138;190;183m Sandbox: 10 domains, 3 write paths[39m`。
2. 打包版首启会重新解包一份运行时（`0.3.2-9aab56ab6924`），与已安装版本
   （`0.3.2-b4b585c337e8`）并存，会话状态不共享。

---

## 追加：根因范围已用开关判别锁定（2026-08-05）

**`PI_WEB_NATIVE_CHILD_WEBVIEWS=0` 时 chrome 完好，默认（开启原生子 WebView）时 chrome 死。**

同一份打包产物、同一个 agent、同一个会话，只切这一个环境变量：

| 原生子 WebView | chrome 表现 |
|---|---|
| 开（默认） | 29px 带子全空，点击无反应 |
| 关（`=0`） | 「搜图 ×」「素材 ×」「画布 ×」三个标签 + 收起/更多/新开/刷新/切换器按钮**全部正常渲染** |

截图证据：关闭态下放大 `[836,92]-[1058,112]` 可见完整 tab 栏。

### 已排除的两个候选

1. **几何算错** —— 排除。日志实测槽为 `(2957, 29, 479×1386)`，chrome 的 29px 被正确让出。
2. **预热的 overlay 子 WebView 盖住** —— 排除。`tauri-runtime.ts:763-778` 显示 overlay 壳建在
   `x=screenX-200, y=screenY-200`、320×240、`visible:false`，在屏幕外且隐藏。

### 下一步该取的证据

`apply_layout` 时把**所有**子 WebView 的 label、bounds、visible 逐条 dump 出来——
现有的 `pane_layout_debug_state` 只给内容槽，给不出「谁实际盖在那 29px 上」。
候选：内容 pane 的实际句柄 bounds 与 Rust 下发值不一致；或某个 `pane-warm-N` 壳
未被隐藏/未被布局管辖（`apply_layout` 的循环对 `!initialized && !keep_alive` 会 `continue`，
这类句柄的 bounds 从创建后就没人再动过）。

### 给用户的即时规避

启动时设 `PI_WEB_NATIVE_CHILD_WEBVIEWS=0`，pane 切换即可恢复。代价是回退到旧的
浮层载体（非原生子 WebView），性能与视觉略差，但功能完整。

---

## 追加：句柄快照读数——四个假设全部被推翻，故障在我们的布局逻辑之下

真机取数（新构建含全量句柄快照，`PI_WEB_PANE_LAYOUT_DEBUG=1`，窗口 1474×908）：

```
落位 slot=(991.0, 29.0, 479.0x879.0)  top_height=Some(29.0)  mode=Workspace
句柄 main-host    bounds=(0.0,   0.0, 1474.0, 908.0)
句柄 pane-warm-6  bounds=(989.0, 29.0,  479.0, 879.0)
句柄 pane-warm-7  bounds=(989.0, 29.0,  479.0, 879.0)
句柄 pane-warm-8  bounds=(989.0, 29.0,  479.0, 879.0)
句柄 pane-warm-9  bounds=(989.0, 29.0,  479.0, 879.0)
```

出现过的全部 label：`main-host`、`pane-overlay-menu`、`pane-warm-0..9`
（内容 pane 复用预热壳，故没有独立的 `pane-<id>-N` 标签）。

### 被推翻的四个假设（都有机械证据，别再重查）

| # | 假设 | 判据 | 结论 |
|---|------|------|------|
| 1 | 几何算错，槽落在 y=0 | 槽实测 `(991, 29, 479×879)` | **推翻** |
| 2 | chrome 子树没渲染 | `PI_WEB_NATIVE_CHILD_WEBVIEWS=0` 时完整渲染 | **推翻** |
| 3 | 某个句柄压在 chrome 带上 | **全部**非宿主句柄 y ≥ 29，无一例外 | **推翻** |
| 4 | 句柄实际位置与下发值差一个标题栏高度 | 377 个样本 `dy` **恒为 0.0** | **推翻** |

（第 4 项的 `dx` 有 ±6px 波动，那是 resize 过程中「下发」与「读回」之间槽已改变，
与垂直方向无关。）

### 因此故障在哪一层

我们的布局逻辑**被测量结果洗清**：算得对、下发对、句柄也确实落在对的位置，
且没有任何东西盖在 chrome 带上。而 chrome 依然不可见、不可点，一关原生子
WebView 就恢复。剩下的解释空间全在 wry / WKWebView / macOS 合成层：

- 存在 child webview 时宿主 WebView 不重绘右上那 29px（重绘/脏区问题）；
- child 的 CALayer 超出其 frame（layer ≠ frame），视觉上盖住而 bounds 读数正常；
- child 的 NSView 进入响应链，吞掉该区域的点击（可解释「点击无反应」）。

三者都能同时解释「看不见」+「点不到」+「关掉即恢复」。

### 下一步该做什么

不再猜。需要 macOS 侧的视图层次证据：把窗口的 NSView 树（frame + layer.frame +
是否 hidden）dump 一次，或用 Xcode 的 View Debugger 抓一帧。这已经超出本 spec
（几何）的边界，且需要在 Tauri/wry 层排查，建议另立。

**期间的可用规避不变：`PI_WEB_NATIVE_CHILD_WEBVIEWS=0`。**

### 本轮受阻项

截图能力在取数后失效（`SCContentFilter failure`，此前可用，屏幕未锁），
故「修复后视觉验收」这一步无法继续。诊断态 `.app` 已存档，能力恢复后可直接重跑。
