# 18 · 故障排查 / FAQ

本章收录 pi-web 开发与运维过程中已知的高频问题，每条按「症状 → 原因 → 对策」三段式展开。急用时可直接跳到末尾的 [6. 诊断速查](#6-诊断速查) 按关键词定位。

---

## 1. 开发服务器问题

### 1.1 dev 运行期间执行 `pnpm build` 后页面报 webpack 500

**症状**：`pnpm dev` 正在运行，另开终端执行 `pnpm build`，之后浏览器刷新出现 webpack 模块解析 500 错误，或者页面彻底空白。

**原因**：`pnpm build`（即 `next build`）默认写入 `.next/`，与 `pnpm dev` 共享同一输出目录。build 过程会覆盖 dev 服务器已经内存映射的 chunk，导致文件句柄错乱。

**对策**：
1. 永远不要在 `pnpm dev` 运行期间执行不加隔离目录的 `pnpm build`。
2. CLI 构建和 e2e 构建均使用 `NEXT_DIST_DIR` 隔离：
   ```bash
   # CLI 独立产物
   NEXT_DIST_DIR=.next-cli next build

   # e2e 隔离构建（不影响 dev）
   PI_WEB_STUB_AGENT=1 NEXT_DIST_DIR=.next-e2e pnpm build
   PI_WEB_STUB_AGENT=1 NEXT_DIST_DIR=.next-e2e next start -p 3100
   ```
3. 如果 `.next/` 已污染，停掉 dev，删除 `.next/`，再重新 `pnpm dev`：
   ```bash
   rm -rf .next && pnpm dev
   ```

相关配置：`next.config.ts:55`（`distDir: process.env.NEXT_DIST_DIR ?? ".next"`）

---

### 1.2 改注入路由或配置域后路由没生效

**症状**：修改了 `app/api/` 下的路由文件或配置域相关代码，保存后 Next.js 热重载触发，但新路由仍不可用（404 或行为不变）。

**原因**：`lib/app/pi-handler.ts` 中的 `createPiWebHandler` 实例**首次调用后被 pin 在 `globalThis`**（`lib/app/pi-handler.ts:342`），在 `dev` 模式下热重载仅替换模块，不重置 `globalThis`，故旧 handler 实例持续响应请求。

**对策**：
1. 手动重启 dev 服务器（`Ctrl-C` → `pnpm dev`）。
2. 默认监听 `:3000`（检阅清单提示部分机器约定 `:3010`，以 `pnpm dev` 实际输出端口为准）。
3. 重启后若修改涉及 session 状态，建议新建会话测试，不要复用旧 session URL。

---

### 1.3 pi SDK 在主进程 import 致 dev 路由 `node:fs` 崩溃

**症状**：`pnpm dev` 下访问任意路由报错，日志包含类似 `Cannot read properties of undefined (reading 'existsSync')` 或 `Module not found: Can't resolve 'node:fs'`。

**原因**：`@earendil-works/pi-coding-agent` 及其传递依赖（`@earendil-works/pi-ai`）包含 `node:fs / node:os / node:path` 及动态 `require()`。若这些包被打进路由 bundle（而非在 Node 运行时外置引入），webpack 在处理这些 import 时会报解析失败。

**根因位置**：`next.config.ts` 的 `serverExternalPackages`（`next.config.ts:96`）+ webpack `externals` 配置（`next.config.ts:131` 起的 `webpack()` 钩子）。

**对策**：
1. 确认 `next.config.ts` 中 `serverExternalPackages` 包含：
   ```ts
   serverExternalPackages: [
     "jiti",
     "@earendil-works/pi-coding-agent",
     "@earendil-works/pi-ai",
   ],
   ```
2. 同时确认 webpack `externals` 的 `piSdkExternal` 函数对 `@earendil-works/pi-coding-agent` 返回 `module <absolute-path>` 形式（`next.config.ts:148`，绝对路径由 `piSdkEntryAbsPath()` 解析）。
3. 任何在主进程（路由 handler）中引入 pi SDK 的代码，必须走子路径导入（如 `@blksails/pi-web-server/trust`、`@blksails/pi-web-server/model-options`），不能经 barrel 让 webpack 把 pi SDK 打进 bundle。

---

## 2. Provider / 模型问题

### 2.1 自定义 provider 鉴权 401

**症状**：在 `~/.pi/agent/models.json` 配置了自定义 provider，调用时返回 HTTP 401，或日志显示"渠道不存在"、"This token has no access to model (model 名为空)"。

**可能原因 A — 配置文件写错了位置**：自定义 provider 必须写在 `~/.pi/agent/models.json`，不能写在 `auth.json`。`auth.json` 由 pi CLI 登录流程管理，手动写入会被覆盖且不被 `ModelRegistry` 识别为自定义 provider。

**可能原因 B — 必填字段缺失**：`baseUrl` 和 `apiKey` 是必填字段，任何一个缺失均导致 SDK 无法构造请求。

**可能原因 C — DashScope / MAAS key 与端点不匹配**：DashScope 的 MAAS token（通义千问主账号 API key）**不能**用于图像生成端点（`/api/v1/services/aigc/multimodal-generation`）；两者是独立的 key 体系，相互打对方端点均 401。

**对策**：

**步骤 1**：确认 `models.json` 位置与格式：
```bash
cat ~/.pi/agent/models.json
```
最小合法结构：
```json
{
  "providers": {
    "my-gateway": {
      "name": "My Gateway",
      "baseUrl": "https://example.com/v1",
      "apiKey": "sk-...",
      "api": "openai-completions",
      "models": [
        {
          "id": "some-model",
          "name": "Some Model",
          "input": ["text"],
          "contextWindow": 131072,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

**步骤 2**：校验模型出现在列表中（需全局 `pi` CLI 在 PATH 上；`--list-models` 与 pi-web 进程内模型枚举同源，见 `packages/server/src/config/model-options.ts:7`）：
```bash
pi --list-models           # 列全部可用模型
pi --list-models my-gateway # 模糊搜索,只看该 provider
```
预期结果：输出中出现 `my-gateway` 下的 `some-model`。若仍看不到，回到步骤 1 核对 `models.json` 是否为合法 JSON（可用 `jq . ~/.pi/agent/models.json` 验证）。

**步骤 3**（DashScope 场景）：文本对话与图像生成分两个 provider 条目，分别配置对应 key 和端点；AIGC 图像走原生 DashScope 协议，详见 [11-aigc-tools.md](11-aigc-tools.md)。

---

### 2.2 iPhone 多图 JPEG 上传致网关报错"空 model 名"或"渠道不存在"

**症状**：从 iPhone 拍摄的多张照片（HEIC 转 JPEG 或直接 JPEG）上传后，图像编辑请求返回"可用渠道不存在"或"This token has no access to model"，且 model 名为空字符串；同一图用普通 JPEG 工具截图则正常。

**原因**：iPhone 多图 JPEG 含 MPF（Multi-Picture Format，`APP2` 段）索引，以及主图 `EOI` 之后追加的第二张 JPEG（HDR gain map）。NewAPI 类网关在解析这类文件时进行上游渠道匹配失败，返回误导性错误。

**已修状态**：`packages/tool-kit/src/engine/normalize-image.ts` 中的 `normalizeImageDataUri()` 函数已实现**纯 JS、零依赖**的 MPF 剥离与尾部截断逻辑（剥除 `MPF` 类 `APP2` 段并在主图首个 `EOI` 处截断；保留 `ICC_PROFILE` 类 `APP2`、EXIF 方向与其它元数据，无损不重编码），由图像编辑工具在上传网关前自动调用（`packages/tool-kit/src/engine/compile-tool.ts:263`）。用户无需手动干预。

**若仍遇到此问题**（例如使用了自定义工具未经过 `normalizeImageDataUri`），手动预处理：
```bash
# 用 ImageMagick 只取多图 JPEG 的第一帧（主图），丢弃 MPF 索引与尾部 gain map
convert 'input.jpg[0]' output.jpg
```

---

## 3. Web Extension / UI 问题

### 3.1 webext artifact 区域空白、没有 iframe

**症状**：配置了 `.pi/web/web.config.tsx` 并期望在 artifact 区域渲染内容，但右侧区域完全空白，浏览器 DOM 里找不到 `<iframe>`。

**原因**：`components/chat-app.tsx:375` 仅在 `process.env.NEXT_PUBLIC_PI_EXTENSION_BASE_URL` 有值时才将 `extensionBaseUrl` 传入 `<PiChat>`；`ArtifactSurface` 组件未收到 base URL 则不挂载 iframe（这是正确的安全门控，而非 bug）。

**对策**：
```bash
# dev 模式（webext 与主 app 同源时直接用 dev 地址）
NEXT_PUBLIC_PI_EXTENSION_BASE_URL=http://localhost:3000  pnpm dev

# 或在 .env.local 中持久化
echo 'NEXT_PUBLIC_PI_EXTENSION_BASE_URL=http://localhost:3000' >> .env.local
```

注意：该变量以 `NEXT_PUBLIC_` 前缀开头，必须在构建时注入（Next.js 将其内联到客户端 bundle），修改 `.env.local` 后需要重启 `pnpm dev` 才生效。

---

### 3.2 `split` 布局右侧为空（历史问题：曾出现 384px 空白浮动区域）

**症状**：在 `web.config.tsx` 中设置 `config.layout = "split"`，但没有配置 `panelRight`，期望左右分栏却看不到右侧内容。

**原因**：`layout: "split"` 在布局表里标记 `hasAside: true`（`packages/ui/src/customization/layout.ts:49`）。早期实现无条件渲染 `<aside>` 让位区，当 `panelRight` 插槽与 artifact 都为空时会在 lg 视口下留出一整列约 384px 的「分离空白浮动区域」。

**已修状态**：`packages/ui/src/chat/pi-chat.tsx:1058` 起，仅在让位区有实际内容（`panelRight` 插槽或 artifact）时才渲染 `<aside>`；`config.layout="split"` 但无内容时**优雅退化为居中版面**（`content` 宽度与 `centered` 同为 `max-w-3xl`），不再留空白（修复见提交 `72394b6`）。

**对策**：若确实需要分栏右侧内容，把内容放进 `panelRight` 插槽——真实配置 API 是 `defineWebExtension`，`layout`（`LayoutPreset`，定义见 `packages/ui/src/chat/pi-chat.tsx:110`）与 `panelRatio` 在 `config` 字段下，`panelRight` 在 `slots` 字段下。可运行参考：`examples/webext-layout-agent/.pi/web/web.config.tsx`（该例用 `config.panelRatio: "3:7"` + `slots.panelRight`，宿主据此渲染分栏让位区）。下面是带 `layout: "split"` 的等价写法：
```tsx
// .pi/web/web.config.tsx
import { defineWebExtension } from "@blksails/pi-web-kit";

export default defineWebExtension({
  manifestId: "my-ext",
  capabilities: ["slots", "config"],
  config: { layout: "split", panelRatio: "2:1" },
  slots: { panelRight: <MyPanel /> },
});

// 或改用不分栏的布局预设
export default defineWebExtension({
  manifestId: "my-ext",
  capabilities: ["config"],
  config: { layout: "wide" }, // "centered" / "wide" / "full"
});
```

---

### 3.3 背景插槽被壳底遮挡（`backgroundLayer` 不可见）

**症状**：在 webext 配置中向 `backgroundLayer` 插槽注入了内容（如自定义背景图），但在浏览器中看不到，页面仍显示默认白色背景。

**原因**：负 `z-index` 元素在没有建立独立 stacking context 的父容器里会逃逸到 `<body>` 根上下文，被不透明的 app-shell `<div>` 覆盖。

**已修状态**：`packages/ui/src/chat/pi-chat.tsx:938` 已在 wrapper 上加 `isolate` Tailwind 类（即 CSS `isolation: isolate`），使 `backgroundLayer` 的 `z-index: -10` 限定在该列内，不再被外层覆盖。

**若自行实现 slot 时遇到类似问题**，确保包含负 `z-index` 子元素的容器设置了 `isolation: isolate` 或 `position: relative` + `z-index: 0`，为其建立独立 stacking context：
```css
.my-container {
  isolation: isolate; /* 建立 stacking context */
}
```

---

### 3.4 对话回合失败但助手气泡空白（看不到错误原因）

**症状**：一次对话回合因 provider / 流式错误失败（如 `Connection error.`、鉴权失败），但 Web UI 的助手气泡是空的，看起来「像没话可说」，无法判断是模型没回应还是出错了，也看不到真实错误信息。

**原因**：会话翻译层早期把承载真实错误的运行时事件（`message_end` 的 `stopReason:"error"` + `errorMessage`、`agent_end` 的 `willRetry`、`auto_retry_end` 的 `finalError`）要么丢弃、要么翻成正常结束，前端因此只渲染出一个空助手气泡。

**已修状态**（spec `stream-error-surfacing`，已实现）：
- 翻译层 `packages/server/src/session/translate/translate-event.ts` 在**重试耗尽或不可重试**时把终态错误翻译为用户可见错误信号，并透传真实 `errorMessage`（不再用硬编码文案覆盖）。
- 前端实时流：`packages/ui/src/chat/pi-chat.tsx:871` 用 `<ChatError>` 元件呈现（`role="alert"`、destructive 配色）。
- 历史回放：`packages/react/src/transport/agent-message-to-ui.ts:212` 为 `stopReason === "error"` 的 assistant 消息追加 `data-pi-error` part，由 `part-renderer.tsx:115` 内联渲染红块。
- 用户主动中止（abort）不会被误报为错误。

**若仍看到空气泡**：确认运行的版本已包含该 spec 的实现；用浏览器开发者工具检查失败回合的助手消息节点是否带 `data-pi-error`，并查看 dev 服务端日志中的原始 `agent_end` / `message_end` 事件以核对 `errorMessage` 是否为空（provider 本身未返回错误文案时翻译层会用兜底文案）。

---

## 4. 测试与工具链问题

### 4.1 jsdom 下工具调用 JSON 代码块 `textContent` 为空

**症状**：在 vitest（`environment: "jsdom"`）中用 `screen.getByRole(...)?.textContent` 断言工具调用入参 JSON 内容，结果为空字符串或 `undefined`，但在真实浏览器中显示正常。

**原因**：`<Response>` 组件底层使用 `streamdown`（`packages/ui/src/ui/response.tsx:7`），其代码块高亮是**异步**的（Shiki）。jsdom 无真实布局引擎，异步渲染未完成时 `textContent` 为空。

**已修状态（工具/数据 JSON）**：`packages/ui/src/parts/pi-tool-part.tsx` 的 `<ToolInput>` 用**同步** `<pre><code className="language-json">` 配合 `highlightJson()` 渲染，不走 `<Response>` / streamdown，保证 jsdom 下可同步读取 `textContent`（`pi-tool-part.tsx:238`）。

**对策（自定义组件）**：
- 工具入参、数据类 JSON 展示使用同步 `<pre><code className="language-json">` 方案，不用 `<Response>`。
- 若必须用 `<Response>`，在 jsdom 测试中 `await act(async () => { ... })` 等待 shiki 完成，或 mock `streamdown`。

---

### 4.2 `--no-skills` 参数被丢弃（已修）

**症状**（历史问题，已修复）：通过 URL 参数或会话配置传入 `--no-skills` 后，系统 skills 仍然被加载；设置页"系统资源"开关切换后无效果。

**原因（已修）**：`parseRunnerArgs` 曾有路径未正确解析 `--no-skills` 标志并写入 `RunnerArgs`。

**已修状态**：`packages/server/src/runner/runner.ts:115–134` 已正确处理：
```ts
} else if (arg === "--no-skills" || arg!.startsWith("--no-skills=")) {
  noSkills = arg === "--no-skills" ? true : takeValue("--no-skills") !== "false";
}
// ...
if (noSkills !== undefined) result.noSkills = noSkills;
```
`option-mapper.ts:184` 下游也正确应用 `noSkills` 覆盖（清空 skills）。

**若仍遇到开关无效**：确认使用的是 `system-resource-toggle-fix` 分支或其后合并到 `main` 的版本。注意 `--no-skills` 是会话激活时由 runner 解析的运行时参数（来自 URL 参数 / 会话配置），**不**落在 `settings.json`，因此 `GET /api/config/extensions/global`（返回 `<agentDir>/settings.json` 的扩展配置）不会反映它。要验证，对照 runner 实际收到的参数：`parseRunnerArgs` 把 `--no-skills` 写入 `RunnerArgs.noSkills`（`runner.ts:115`），`option-mapper.ts:184` 据此用空 `skills` 覆盖（`skillsOverride` 返回 `{ skills: [] }`）。

---

## 5. 并发与工作树问题

### 5.1 并发会话重置主工作树分支、毁提交

**症状**：多个 AI agent 会话并行运行时，`git` 操作互相干扰——某个会话切换分支后另一个会话的文件状态错乱，或 commit 丢失。

**原因**：多个进程在同一 git 工作树（`agents/pi-web/`）上并发做 `git checkout / reset`，会互相覆盖对方的 `HEAD` 指针。

**对策**：长任务（超过几分钟的实现类任务）在**隔离 git worktree** 中运行，不在主工作树操作：
```bash
# 创建隔离 worktree（相对于 repo 根一级）
git worktree add ../pi-web-attach -b feat/my-feature HEAD

# 在隔离目录里干活
cd ../pi-web-attach
# ... 编辑、提交 ...

# 完成后合并回主分支，删除 worktree
cd ../pi-web
git merge feat/my-feature
git worktree remove ../pi-web-attach
```

---

## 6. 诊断速查

| 问题关键词 | 优先检查 |
|---|---|
| webpack 500 / chunk 错误 | 是否在 dev 运行时跑了 `pnpm build`；删 `.next/` 重启 |
| 路由新增不生效 | handler 单例在 globalThis；重启 dev |
| `node:fs` 解析失败 | `next.config.ts` `serverExternalPackages` + `externals` |
| 自定义 provider 401 | `models.json` 位置（`~/.pi/agent/`）；`baseUrl`+`apiKey` 必填 |
| DashScope 图像 401 | MAAS token 与 DashScope 原生 key 独立；走对端点 |
| iPhone JPEG"空 model 名" | `normalizeImage` 是否在调用链上；自定义工具需显式调用 |
| webext 无 iframe | `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` 未设置；重启 dev |
| split 右侧无内容 | `slots.panelRight` 未配置；新版已退化为居中，非空白 |
| 助手气泡空白看不到错误 | 终态错误翻译；查 `data-pi-error` / 服务端 `agent_end` 事件 |
| 背景插槽被遮挡 | 外层容器缺 `isolation: isolate` |
| jsdom textContent 空 | streamdown 异步高亮；工具 JSON 改用同步 `pre+language-json` |
| `--no-skills` 无效 | 确认已包含 `system-resource-toggle-fix` 修复 |
| 并发会话 commit 丢失 | 长任务放隔离 worktree（`git worktree add`） |

---

## 相关链接

- [05-configuration.md](05-configuration.md) — env 变量完整表，含 `NEXT_DIST_DIR`、`NEXT_PUBLIC_PI_EXTENSION_BASE_URL`
- [06-providers-and-models.md](06-providers-and-models.md) — `models.json` 格式与 DashScope key 详解
- [10-web-ui-extension.md](10-web-ui-extension.md) — webext 配置、layout/slot 用法
- [11-aigc-tools.md](11-aigc-tools.md) — AIGC 图像工具、`normalizeImage`、DashScope 端点
- [14-cli.md](14-cli.md) — CLI 启动、`--port` 参数
- [17-development-and-testing.md](17-development-and-testing.md) — 测试环境隔离、e2e 构建跑法
