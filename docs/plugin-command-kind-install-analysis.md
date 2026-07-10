# /plugin 内置命令重构分析 — 增加 agent/plugin 安装（复用 CLI 子命令实现）

> 状态：分析报告（2026-07-10，pre-spec）。范围裁定:**component 安装不进 /plugin**（暂限
> CLI `pi-web add`,理由见 §6）。
> 相关:[组件安装器设计](./component-installer-design.md) ·
> cli-package-commands spec（六子命令,分支 8f3a9f7）· unified-command-result-layer(决策A)。

---

## 1. 现状:web 面装东西有三张脸（全部已核实到坐标）

| 面 | 现状 | 装什么 / 落哪 | 门控 |
|---|---|---|---|
| **A · `/plugin` agent 扩展命令(现役)** | `pi.registerCommand("plugin")`,在 **agent 子进程**内执行;子动作 install/uninstall/list;成功后 `ctx.reload()`;web 端 `extensionCommandPolicy` 按名放行 fire-and-forget | 仅 pi 资源:经 `ChildProcessPiCli → pi install` 落 `DefaultPackageManager`(`~/.pi/agent` 或 `.pi/`) | agent 进程内无 adminPolicy/allowlist(信任=会话本身) |
| **B · REST `POST /extensions`** | `makeInstallExtensionHandler` 五步编排;装后 `POST /sessions/:id/reload` 重启 runner | 同 A(pi 资源) | adminPolicy(默认拒绝)+ `DEFAULT_ALLOWLIST`(allowLocal:false;env `PI_WEB_EXT_ALLOW_LOCAL/ALLOW_NPM/ADMIN_ALLOW_ANY` 放行) |
| **C · host 命令骨架** | `host-command-registry` + `command-routes.ts` 的 ui-rpc 拦截(**服务端同步执行,HTTP 响应体回结果**,不走 SSE);现只挂 `/clear`;结果契约 `CommandResultSchema{effect,message,data}` | —(骨架) | 主进程,可注入任意策略 |

历史注:决策A(unified-command-result-layer)确立的「host 命令走同步 HTTP 响应体」通道
就是 C;`/plugin` 后来在 detoolspec/extension-manager 演化中迁成了 A 形态(host 注册表
只剩 /clear,`lib/app/pi-handler.ts:428` 有迁出注释)。

## 2. CLI 侧新能力（feat/cli-package-commands 8f3a9f7,即将复用的实现）

- `server/cli/install/installer.ts` — `createInstaller`:**kind 判别 → 通道分派**
  (`determineKind`:本地读 `pi-web.json#kind`、npm/git 缺省 plugin、`kindHint` 覆盖);
  agent 拒绝 project 作用域(`:361`)。
- `agent-installer.ts` — **web 面完全没有的能力**:agent source 落 `~/.pi-web/agents/<name>`
  + `sources.json` 登记(git/npm/local 三形态,`CommandRunner`/`TarballDownloader` 可注入)。
- `plugin-installer.ts` — 与 A/B 同终点(pi `DefaultPackageManager`),另有
  list/update/精确 semver 校验。
- **耦合度结论(关键,已核实)**:这些实现**不绑 CliContext**——端口只收已解析的原子字段
  (`sourcesRoot`/`registryPath`/`env`/reporter 接口),web handler 在装配期闭包注入即可
  直接调用,零改造。仅两处共享依赖(`redactSecrets`、`checkAllowlist`/`probeEntry`)
  本就在 server 包内,主进程可用。
- ⚠ **本 worktree(feat/component-installer)只有 4.1/4.2 底座**;4.3–6.x 六笔提交在
  cli-package-commands 分支上——本重构的**硬前置是分支整合**(§7)。

## 3. 目标与差距

**目标**:`/plugin install <source>` 能装 **agent**(落 `~/.pi-web/agents`+登记,装完可在
source 选择器切换)与 **plugin**(pi 资源,现状能力),kind 自动判别、`--kind` 可覆盖;
uninstall/list 对齐;实现复用 §2 的 CLI 子域。

**差距清单**:

1. **执行位置错位(最大架构问题)**:现役 /plugin 在 **agent 子进程**(tool-kit 层),
   而 CLI install 子域在 **server 层**(主进程)。子进程直调 `installAgentSource` 意味着
   tool-kit → server 的**跨层依赖**(违反「protocol ← everything、依赖单向」),且
   agent 通道要写 `~/.pi-web/agents` + `sources.json`——把这个写权限放进每个 agent
   子进程也是错误的信任面。
2. **信任模型不可搬运**:CLI 的 `CLI_ALLOWLIST`(allowLocal:true)是「本地单用户即
   admin」裁决,**不得带进 web 面**;web 必须沿 B 面既有三门(adminPolicy + DEFAULT_ALLOWLIST
   + env 放行),agent 通道同样过这三门。
3. **装后生效语义分叉**:plugin → `ctx.reload()`/`restartRunner`(既有);**agent → 不该
   reload 当前会话**——新装的 agent source 是给「下一个会话/选择器切换」用的,生效面 =
   source 列表刷新(`GET /agent-sources` 扫描根∪注册表天然可见)+ 提示引导,而非重启 runner。
4. **补全与 e2e**:`plugin-arg-provider.ts` 子命令表、`listArgs` 数据源、浏览器 e2e
   硬编码三候选,均需随子动作/argKind 扩展。
5. **结果呈现**:agent 安装结果需要结构化卡片(装到哪/如何切换);A 面的 `ctx.ui.notify`
   表达力不够。

## 4. 通道选型(核心决策,三案对比)

| 案 | 形态 | 优 | 劣 |
|---|---|---|---|
| ① 留在 A(agent 命令内加 kind 分派) | extension-manager 直调 CLI 子域 | 改动集中 | **跨层依赖 + 子进程持有 agents 根写权限**;门控要在子进程重造;结果呈现受限。**否决** |
| ② **/plugin 迁回 C(host 命令)** ★推荐 | 主进程 host handler 调 `createInstaller`(kind 分派);pi 资源通道复用 B 的同一实现;结果走 `CommandResult{effect,data}` + 新 `data-plugin-result` 渲染器(BashResultRenderer 同型) | 主进程天然复用 CLI 子域**零跨层**;与 B 共享三门策略(一处配置);同步 HTTP 响应体(决策A 铁律,不碰 SSE);agent/plugin 生效语义可分道(effect: panel-refresh vs notify+reload) | 需迁移:摘除 tool-kit 的 `registerCommand("plugin")`(避免同名双注册仲裁)、补全 provider 改指 host 命令、既有 /plugin e2e 迁移;`ctx.ui` widget 交互改为卡片形态 |
| ③ 扩 B(REST)+ 前端 slash 直打端点 | /plugin 变前端糖 | 端点已有三门 | 违背决策A(命令回到「离 UI 补丁」);agent 子进程发起时无 auth 上下文;命令语义割裂。**否决** |

**推荐案②**。要点:
- host `/plugin` handler 在 `lib/app/pi-handler.ts` 装配期闭包注入:`sourcesRoot`、
  `registryPath`、`extAllowlist`(B 面同一份,含 env 放行)、`adminPolicy`、
  `ChildProcessPiCli`(plugin 通道)、`reloadRunner`。
- kind 语义:`install <source> [--kind agent|plugin]`;本地源自动读清单 kind;
  agent 拒绝 `--project`(沿 installer 既有裁决)。
- 生效分道:plugin → `effect:"notify"` + 触发 reload(沿 B);agent → `effect:"panel-refresh"`
  (source 列表/收藏锚点刷新)+ data 卡片给出「在选择器切换」指引。
- **同名仲裁**:tool-kit 摘除 `registerCommand("plugin")` 与 `extensionCommandPolicy`
  的 "plugin" 放行项,一次到位,不留双通道(灰度期如需保留,须명确 host 优先并在
  palette 去重——不建议)。

## 5. 复用映射表(CLI 子域 → web host 命令)

| CLI 实现 | web 复用方式 | 改造量 |
|---|---|---|
| `createInstaller`(kind 分派) | 直调,`kindHint` 接 `--kind` | 零 |
| `installAgentSource`/`uninstallAgentSource` | 直调,注入 web 侧 sourcesRoot/registryPath | 零 |
| `plugin-installer` | 可直调;或保持 B 面 `assembleInstallArgs+piCli`(同终点,建议**统一走 plugin-installer** 消除双实现) | 小 |
| `resolveSource` | 直调,但 `allowlistConfig` 必须传 **web 面的 extAllowlist**(绝不用 CLI_ALLOWLIST) | 零(参数本就可注入) |
| `ProgressReporter` | 实现一个「收集为 CommandResult.data.steps」的 reporter | 小 |
| `redactSecrets` | 结果 message 出口统一过一遍 | 零 |

## 6. component 为何暂不进 /plugin(本轮裁定,写进边界)

1. **写入目标语义缺失**:`pi-web add` 写的是**某个 agent source 的源码目录**
   (`.pi/web/components/`);web 会话里「当前 source」可能是 git 缓存工作树、
   `~/.pi-web/agents` 下的安装副本、或他人目录——没有安全的「装进哪个 source」答案。
2. **人审车道是终端交互**:dry-run 文件清单、修改态 unified diff、接线指引都是
   为 CLI 设计的呈现;塞进聊天流会退化成不可审的黑箱。
3. **信任模型**:组件车道合法绕过验签的前提是「操作者 = source 所有者且人审源码」,
   web 多用户面不成立。
   → `/plugin install` 遇到 `kind:"component"` 包时**显式拒绝并指引**:
   「组件包请在该 source 目录用 `pi-web add` 安装」(kind 判别已免费拿到,给出好错误即可)。

## 7. 落地前置与实施顺序

0. **分支整合(硬前置)**:`feat/cli-package-commands`(8f3a9f7,+6 笔)与
   `feat/component-installer`(e1de556)同源分叉(基 12858eb),改动面基本正交
   (前者 4.3–6.x 在 install/ 与 index.ts 分发层;后者在 component/ 与 bin add
   early-dispatch)。**预期冲突点仅 `server/cli/index.ts` 导出段与 `bin/pi-web.mjs`
   词条/分发段**(6.1 的通用分发 vs add 的 early-dispatch——正好按设计把 add 并入
   词条表)。建议:cli-package-commands ← merge component-installer 成整合线,本重构
   基于整合线立 spec。
1. host `/plugin` 命令 + 装配注入(kind 分派、三门、reporter→CommandResult)。
2. tool-kit 摘除 agent 侧 /plugin;补全 provider 改造(+argKind:agent 来源沿
   `GET /sessions/:id/install-sources`);`data-plugin-result` 渲染器。
3. 生效分道(agent→panel-refresh/列表刷新;plugin→reload)。
4. 测试:installer 直调层单测(已在 CLI 侧覆盖,web 只测装配注入)+ host 命令集成
   (command-routes 同步执行)+ 浏览器 e2e(/plugin install 本地 agent → 选择器可见;
   component 包被拒并出指引;补全三态)。

## 8. 风险与未决问题

1. **B 面(REST)与 host /plugin 的关系**:建议保留 REST 作为程序化面、host 命令内部
   与其共享同一编排(避免第三份实现);是否让 REST 也长 agent 通道 → 立 spec 时拍板。
2. **多用户面的 agent 安装授权粒度**:adminPolicy 是全局 admin;要不要按 scope
   (user-only)收紧 agent 安装 → 拍板。
3. **`update`/`list` 子动作是否同轮迁移**:CLI 已有实现,建议同轮(否则 /plugin list
   与 host list 语义分裂)。
4. **灰度**:摘除 agent 侧 /plugin 是一次性切换,老会话(runner 未重启)仍带旧命令
   ——`getCommands` 探针下前端会看到双源,需确认 palette 合并行为或强制 reload。
5. 命令帮助文本与 `/plugin --help` 的呈现形态(CommandResult.message vs data 卡片)。
