# 扩展/Skill 安装器(install / uninstall)— 讨论记录

> 状态:**讨论记录(尚未设计成型,不实现)**
> 来由:内置工具讨论(`builtin-web-tools-design.md`)的延伸 —— 与其把能力都"内置",不如让用户**按需 install/uninstall** pi 与 pi-web 的扩展或 skills。
> 本文只记录讨论与已查实的事实,**不落实现方案、不定稿**。

---

## 1. 想法一句话

给 pi-web 增加一个**安装器**:`install` / `uninstall`(及 update),用来安装/卸载 **pi 的 extensions 或 skills**,以及(可能)**pi-web 自己的 web-ext / 内置工具包**。

---

## 2. 已查实的关键事实(决定本设计性质)

### 2.1 pi 已自带完整的包管理器 —— 不必从零造

pi 0.79.6 **已导出** `DefaultPackageManager`(`@earendil-works/pi-coding-agent` → `index.d.ts:12-13`),是一个成型的安装器:

- **动作**:`install` / `installAndPersist` / `remove` / `removeAndPersist` / `update` / `resolve` / `checkForAvailableUpdates` / `listConfiguredPackages`。
- **统一管四类资源**:`ResolvedPaths = { extensions, skills, prompts, themes }` —— extensions 与 skills **同一套机制**安装。
- **来源**(`docs/packages.md`):**npm**、**git**(含 `git@host:path` / `ssh://` / 版本 ref)、**本地路径**。
- **scope**:`user`(`~/.pi/agent/`)/ `project`(`.pi/`)/ `temporary`。
- **进度回调** `ProgressCallback`(`start|progress|complete|error` × `install|remove|update|clone|pull`)—— 天然可往 Web UI 推进度。
- **持久化**:`addSourceToSettings` / `removeSourceFromSettings`,落到 pi settings(`PackageSource`,`SettingsManager`)。
- 还有 CLI 入口 `dist/package-manager-cli.js`(`pi` 的包管理子命令)。

> **结论:pi-web 的"安装器"本质是给 pi `DefaultPackageManager` 套一个 pi-web 入口(RPC + Web UI 面板),复用其 install/uninstall/persist/进度,而非重造安装逻辑。**

### 2.2 pi 的发现目录约定(安装目标)

- Extensions:`~/.pi/agent/extensions/*.ts`(全局)/ `.pi/extensions/*.ts`(项目级);项目级**需 project trust** 后才加载(`docs/extensions.md`)。
- Skills:`~/.pi/agent/skills/`(全局)/ `.pi/skills/`(项目级);根目录 `.md` 即一个 skill(`docs/skills.md`)。

### 2.3 与"系统资源开关"是两个层次,别混

pi-web 已有「扩展 → 系统资源」面板的 **enable/disable**(`--no-skills`/`--no-extensions`,memory `system-resource-toggle-fix`)。那是**开关已安装的资源**;本设计是 **install/uninstall 资源本体**。两层应协同:装上 → 默认可被开关管理。

### 2.4 与内置工具设计的取舍关系

`builtin-web-tools-design.md` 讨论的是 pi-web **硬编码内置**的媒体工具。安装器提供了另一条路:某些能力可做成**可安装的 pi extension 包**(`pi.registerTool`),由用户 install 而非 pi-web 内置。两者边界(哪些内置、哪些做成可装包)是后续要权衡的点。

---

## 3. 待讨论 / 待决策(开放问题,先记下)

1. **复用面**:pi-web installer 直接调 `DefaultPackageManager` 实例(它已在 services 里?需查 `createAgentSessionServices` 是否已构造 PM),还是另起?倾向**直接复用同一 PM + 同一 pi settings**,避免两套来源台账。
2. **入口形态**:
   - RPC 方法(`install`/`uninstall`/`listPackages`/`checkUpdates` + 进度流)?
   - Web UI 面板(市场/已装列表/装卸按钮 + 进度条,接 `ProgressCallback`)?
   - 是否也暴露给 CLI?
3. **scope 选择**:user(`~/.pi/agent/`)还是 project(`.pi/`)?项目级涉及 **project trust** 门控,需与现有 trust 流程(memory 里 pi-trust 设计)对齐。
4. **安全面(重)**:install 第三方 npm/git = **执行第三方代码**。需明确信任模型、是否限制来源、是否走 pi-web 沙箱(`PI_WEB_SANDBOX_ENTRY` / `forcedExtensionPaths`)、卸载是否彻底。
5. **pi-web 自有资源是否纳入同一 installer**:pi-web 的 **web-ext**(agent source 的 `.pi/web` UI 控制层)与未来的**内置工具包**是 pi-web 概念,pi PM 不认。要不要统一一个"安装/管理"面,还是 pi 资源走 pi PM、pi-web 资源走另一套?
6. **dev 热重载约束**:改注入路由/配置域后需重启 dev(memory `pi-web-handler-singleton-restart`);install 后资源生效是否需要 `/reload` 或重启,需在 UX 里说清。
7. **来源浏览/发现**:只支持"按 source 字符串装"(npm 名/git url),还是要做一个可浏览的来源目录(pi 官方 example extensions 70+ 个可作为初始来源)?

---

## 4. 明确不做(本轮)

- 不写实现、不定稿、不建 spec。
- 不决定入口形态与 scope —— 待进一步讨论。

## 5. 下一步(候选,待用户拍板)

- 查 `createAgentSessionServices` / runner 里是否已实例化 `DefaultPackageManager`、pi-web 当前怎么消费 `ResolvedPaths`。
- 决定入口形态(RPC / Web UI / CLI)与首个 scope。
- 必要时转成 kiro spec(`/kiro-spec-init`)。
