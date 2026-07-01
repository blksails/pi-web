# 检阅 · webext / aigc 多源批量验收清单

> **检阅** = 用 chrome-devtools 同时打开多个 tab，每个 tab 加载一个示例
> agent source，完成「最简首次步骤」（选 source → 会话激活），供人工逐项验收。
> 一次覆盖全部 webext 示例 + **aigc-agent(图像生成/编辑)**，对照各自的 Tier 能力。

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

## 1. 检阅对象 · 7 个 webext source + 1 个 aigc source 与验收要点

| # | source（`./examples/…`） | Tier / 能力 | 验收要点 | 首屏可见？ |
|---|---|---|---|---|
| 1 | webext-layout-agent | Tier1 区域插槽 + 比例切换 | panelRight「领域检视面板」+ header 三区(Nav/Layout Agent/Help) + footer；**初始 3:7**(对话 30%/面板 70%)+ 右下角段控切换器(居中/2:1/3:7)运行时动态切换 | ✅ |
| 2 | webext-slots-agent | Tier1 18 保留插槽全集 | **15 个** `data-pi-ext-*` 全渲染(12 RESERVED + header/footer/panel-right) + `background` fixture(`[data-testid=slot-background]`,**不发** `data-pi-ext-*`)；**追加不替换**内核输入/消息面 | ✅ |
| 3 | webext-background-agent | Tier1 自定义背景(空/活两态) | 极光背景在消息层之下；会话态浮动底栏**无**纯色渐隐带。**空屏 vs 交互后两态**:背景靠祖先 `[data-pi-chat-empty]` 自切观感(空屏=静谧 `saturate(0.72)`/光斑 opacity 0.30/无辉光;交互后=鲜明 `saturate(1.15)`/0.62/居中辉光淡入),发首条消息即 1.2s 过渡 | ⚠️ 需进会话态(对比两态) |
| 4 | webext-renderer-agent | 自定义工具/消息渲染器 | 发 `echo the text: ...` → 真实 LLM 调 `echo` 工具 → 命中 `EchoToolRenderer`（`data-testid="echo-tool-card"`，默认 `[data-pi-tool]`=0=注册表覆盖）。**富卡片**:读 `part.input/output/state`,渲染「头部+状态徽标(运行中/完成/出错) + 输入·text(`[data-testid=echo-input]`) + 输出·echoed(`[data-testid=echo-output]`)」三段,配色取宿主主题 token。见 [[webext-renderer-stub-trigger]] | ⚠️ 需发 echo 指令驱动一轮 |
| 5 | webext-artifact-agent | Tier4 artifact iframe | **仅当设了 `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` 才挂载 `<ArtifactSurface>` iframe**(挂载后 iframe 带 `data-pi-artifact`,在 `aside[data-pi-chat-aside]` 内,src=`webext-artifact/artifact.html`)。**注:`.env.local` 现已配置 base-url → 默认走「门控 ON」侧、有 iframe**；裸环境(未配)无 iframe 才是 OFF 侧正确门控。见 [[webext-artifact-base-url-gate]] | ⚠️ 取决于 base-url 是否配置 |
| 6 | webext-declarative-agent | 纯声明(theme/layout/empty) | **零 bundle、无扩展面板**,但有**可见的零代码效果**(别再误判"像默认没加载"):紫主题(`--primary: 262 83% 58%` 重着色发送键/焦点环)+ `layout:wide`(对话列 max-w-5xl 更宽)+ 自定义空态(标题「纯声明式扩展 · 零代码」+ 副标题 + 3 建议项)+ 标签页标题「Declarative · pi-web」。仍 `extCount===1`(仅 `data-pi-ext-theme`)、`panelRight===false` | ✅ |
| 7 | webext-contrib-agent | Tier3 ui-rpc 贡献点 | slash/mention/autocomplete/keybinding 贡献 | ⚠️ 仅 `hasContributions && !isBusy` 时开，见 [[pi-web-uirpc-idle-control-stream]] |
| 8 | aigc-agent | `@blksails/pi-web-tool-kit` AIGC 工具 + Tier2 媒体渲染器 | **两条端到端流程**:**①图像生成**(发文本 prompt → LLM 调 `image_generation` → provider 生成 → 产物落 attachment store → 回 `att_<id>`,渲成图片卡片);**②图像编辑**(上传图 → LLM 把 `att_…` 抄进 `image_edit({instruction,image})` → 编辑 → 回引用)。两工具产物均命中自定义渲染器 `[data-testid=aigc-tool-card]`(复用 `PiToolPart` 壳,output 换成 `![](displayUrl)` markdown → `<img>`),带**图片/JSON 视图切换**(`[data-testid=aigc-view-image]` / `[data-testid=aigc-view-json]`)。默认变体 `gpt-image-2`(NewAPI),**需 `NEWAPI_API_KEY`**;缺密钥工具仍加载但返回「能力不可用/缺少配置」降级,不崩溃 | ⚠️ 需驱动一轮 + 配置 provider 密钥(详见 §2.5) |
| 9 | state-bridge-agent | context 外**双向共享状态**(状态注入桥) + Tier1 panelRight 面板 | **人机共驾同一份会话级 KV**(权威在 agent 子进程,pi 无原生 ctx.state)。panelRight 面板 `[data-testid=state-bridge-panel]` 显示 `count`(`[data-testid=state-bridge-count]`,初始 `—`)+「+1(写回)」按钮 `[data-testid=state-bridge-increment]`。**两条方向**:**①AI→UI**(发 `increment the counter` → LLM 调 `increment` 工具 → 子进程 KV +1 → stdout `piweb_state` 行 → SSE `control:"state"` 帧 → 面板数值实时 +1);**②UI→AI**(点「+1(写回)」→ `POST /sessions/:id/state` → 子进程权威态更新 → 下行帧收敛,且 agent 下次 `read_state` 读到新值)。**需真实 runner**(`wireStateBridge` 装配,**stub 抓不到** state 帧);方向①需有效 default provider/model,方向②纯前端写回无需模型。详见 [[state-injection-bridge-spec]] | ⚠️ 需驱动一轮(方向①)/ 点按钮(方向②),真实 runner |

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
   - slots → `extCount===15`(18 槽全集:12 RESERVED + header/footer/panel-right;`background` 走 fixture 不计入 `data-pi-ext-*`)；layout → panelRight/footer 在,且 `[data-pi-panel-ratio-switch]` 初始 `3:7`、aside `style.width:70%`；declarative → 仅 `data-pi-ext-theme` 一个包裹（`extCount===1`、`panelRight===false`，符合预期：声明式只应用主题/布局，无 slot 面板）。

   **比例切换验收(仅 layout/slots 这类有 panelRight 的源)**:右下角 `[data-pi-panel-ratio-switch]` 段控,点 `[data-pi-ratio-option="2:1"|"3:7"|"centered"]`:
   - `3:7` → aside `style.width==="70%"`、`[data-pi-panel-ratio]="3:7"`;
   - `2:1` → `33.333%`;
   - `centered` → 收起 aside(`[data-pi-chat-aside]` 与 `[data-pi-ext-panel-right]` 均消失),但切换器仍在场,可切回。
   初始档由扩展 `config.panelRatio` 声明(layout-agent=`3:7`),缺省 `2:1`。

6. **三处演示增强的核对**(对应各 source 的"丰富度"验收):
   ```js
   // background:发一条消息前后各跑一次,对比应不同
   () => {
     const a = document.querySelector('.pw-webext-background-aurora');
     const b = document.querySelector('.pw-webext-background-blob-a');
     const g = document.querySelector('.pw-webext-background-glow');
     const empty = document.querySelector('[data-pi-chat-empty]')?.getAttribute('data-pi-chat-empty');
     return { empty, saturate: getComputedStyle(a).filter,
              blobOpacity: getComputedStyle(b).opacity, glow: getComputedStyle(g).opacity };
     // 空屏 → {empty:"true",  saturate:"saturate(0.72)", blobOpacity:"0.3",  glow:"0"}
     // 交互 → {empty:"false", saturate:"saturate(1.15)", blobOpacity:"0.62", glow:"1"}
   }
   // renderer:echo 富卡片三段齐全
   () => ({ card: document.querySelectorAll('[data-testid="echo-tool-card"]').length,
            input: !!document.querySelector('[data-testid="echo-input"]'),
            output: !!document.querySelector('[data-testid="echo-output"]') })  // {1,true,true}
   // declarative:紫主题 + 宽布局 + 空态 + 标题
   () => ({ primary: getComputedStyle(document.querySelector('[data-pi-ext-theme]')).getPropertyValue('--primary').trim(),
            wide: !!document.querySelector('[data-pi-chat-pro] .max-w-5xl'),
            title: document.title })  // {"262 83% 58%", true, "Declarative · pi-web"}
   ```

---

## 2.5 aigc-agent · 图像生成 / 图像编辑两条流程（chrome-devtools）

> source = `./examples/aigc-agent`。与 webext 不同,aigc 是**真实 LLM + 真实 provider 调用**:
> 必须先配好 provider 密钥,再各驱动一轮。两工具产物都命中同一自定义渲染器
> `[data-testid=aigc-tool-card]`,无需看 `data-pi-ext-*`(aigc 走 Tier2 `renderers.tools`,**非** slot 扩展)。

### 前置:provider 密钥
- 默认变体 `gpt-image-2`(NewAPI),`runner` 子进程经环境变量读 **`NEWAPI_API_KEY`**(其它变体:`DASHSCOPE_API_KEY` token plan / `OPENROUTER_API_KEY`)。
- **缺密钥不是 bug**:工具仍加载,调用时返回「能力不可用 / 缺少配置」可读降级(Req 5.3),会话不中断。验收「降级路径」时可故意不配 key,看是否优雅返回而非崩溃。
- 改了密钥 / 注入域后需**重启 dev**(handler 单例 pin 在 globalThis,见 [[pi-web-handler-singleton-restart]])。

### 流程 ①:图像生成（image_generation）
1. `new_page` → `localhost:3000/` → `take_snapshot` → `fill` picker textbox=`./examples/aigc-agent` → `click` submit → 落 `/session/<id>`。
2. 驱动一轮:`fill` `[data-pi-input-textarea]` = 例如 `生成一张赛博朋克城市夜景` → 点 `[data-pi-submit-state="send"]`(或「发送」)。
3. 等工具跑完(provider 同步/异步轮询都可能数秒~数十秒;`wait_for` 文本或轮询 DOM)。
4. **验收**(`evaluate_script`):
   ```js
   () => {
     const card = document.querySelector('[data-testid="aigc-tool-card"]');
     return {
       hasCard: !!card,
       img: !!card?.querySelector('img'),                                  // 图片视图渲出 <img>
       imgSrc: card?.querySelector('img')?.getAttribute('src')?.slice(0,40), // /api 前缀的带签名 displayUrl
       viewToggle: !!document.querySelector('[data-testid="aigc-view-image"]')
                && !!document.querySelector('[data-testid="aigc-view-json"]'),
     }; // 期望 { hasCard:true, img:true, imgSrc:"/api/...", viewToggle:true }
   }
   ```
5. 点 `[data-testid="aigc-view-json"]` → 卡片切到调用明细(`{ input, output }`,可见 prompt/model 与 content);点 `[data-testid="aigc-view-image"]` 切回图片。

### 流程 ②:图像编辑（image_edit）
1. 同上进入 aigc-agent 会话(可复用 ① 的 tab 续聊,或新开)。
2. **上传输入图**:`take_snapshot` 找到隐藏 file input `[data-pi-attachments-input]`(`accept=image/*`;入口为 compact paperclip 按钮 `[data-pi-attachments-add]` 或 panel dropzone `[data-testid=pi-attachments-dropzone]`)→ chrome-devtools `upload_file` 把本地图片喂给该 input 的 uid。上传后输入区出现附件 chip(`[data-pi-attachment-thumb]`);主进程发送时注入 `[attachment id=att_… …]` 引用。
3. 驱动一轮:`fill` `[data-pi-input-textarea]` = 例如 `把背景换成雪山` → 发送。LLM 应把 `att_…` id 抄进 `image_edit({ instruction, image })`。
4. **验收**:同 ① 的 `evaluate_script`,期望最新一张 `[data-testid=aigc-tool-card]` 内 `<img>` 为**编辑后**的图(与输入不同);属主校验失败 / 引用无效时应返回可读错误而非越权(Req 2.3/2.4)。

---

## 3. 验收注意事项

- **3 / 4 / 7 / 8 需驱动一轮**才显形：`fill [data-pi-input-textarea]` + 点 `[data-pi-submit-state="send"]`（或 `发送`）发一条消息。其中 **4 发 `echo the text: ...`** 让真实 LLM 调 echo 工具（**3 发任意消息进会话态——发前发后各看一次背景,对比空/活两态**、7 打 `/` 触发 ui-rpc、**8 见 §2.5:① 发文本 prompt 触发 `image_generation`、② 先 `upload_file` 上传图再发编辑指令触发 `image_edit`**）。
- **8(aigc)是真实 provider 调用,非 stub**:需先配 `NEWAPI_API_KEY`(默认 `gpt-image-2`),生成耗时数秒~数十秒,验收用 `wait_for`/轮询;缺密钥时优雅降级是正确行为(见 §2.5)。
- **刷新不丢扩展**（已修复）：source 经 app 级 `sessionId→source` 映射按 id 恢复，URL 保持纯净 `/session/:id`，不暴露文件路径。验收时刷新一个 fresh 会话应仍见扩展。见 [[webext-review-checklist]] 关联的 resume 修复。
- **declarative 仍是"无扩展面板"(零 bundle)**,但**有可见的零代码效果**(紫主题/宽布局/自定义空态/标签页标题)—— 不要再当成"像默认没加载"误判;`extCount===1`(仅 theme 包裹)是正确结果。
- 改了注入路由 / 配置域后需重启 dev（handler 单例 pin 在 globalThis）。见 [[pi-web-handler-singleton-restart]]。
- 背景层负 z-index 需 `isolation:isolate` 逃逸壳底遮挡。见 [[pi-web-bg-slot-isolate]]。
- **9(state-bridge)是真实 runner 双向验收,非 stub**:`wireStateBridge` 装配的状态核只在真实子进程存在,stub 模式下 `control:"state"` 帧不发、面板恒为 `—`。方向①(工具写)需 default provider/model;方向②(按钮写回)纯前端 `POST /state`,可独立验收。详见 [[state-injection-bridge-spec]] / [[pi-web-context-外双向-state]]。

---

## 4. 一键收尾

- 列出全部会话：`list_pages`，逐 tab `select_page` + 截图/快照存证。
- 证据落 `.kiro/specs/agent-web-extension-visual-acceptance/evidence/`。
- 相关特性总览见 [[agent-web-extension-spec]]。
