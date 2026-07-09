# Research & Design Decisions — cli-component-add

> Discovery 类型:Extension(集成型,聚焦既有接缝)。日期:2026-07-09。
> 上位设计稿:`docs/component-installer-design.md`(v1 范围即本 spec)。

## 1. 勘察结论(全部已对源码核实)

### 1.1 CLI 分发层现状
- `bin/pi-web.mjs`:`SUBCOMMAND_NAMES`(六命令)+ `SUBCOMMAND_SPECS`(UX 契约表)在 `:44/:63`;
  `main()` 的 `intent === "subcommand"` 分支(`:544`)是**占位**(打「尚未接入」并退出 1)——
  真正分发归 cli-package-commands 任务 6.1,未落地。
- `server/cli/index.ts` 是 `dist/cli-commands.mjs` 的 esbuild 构建入口,现只有占位导出
  `cliCommandsEntryReady()` + context/reporter/scaffold re-export。**尚无 `runSubcommand`。**
- **裁决**:本 spec 不实现通用 `runSubcommand`(那是 6.1 的边界),只在占位分支**前**为
  `add` 增加一个专用 early-dispatch(`name === "add"` → 动态 `import()` 产物调 `runAdd`),
  其余子命令的占位行为逐字节不变(Req 10.3)。6.1 落地通用分发时,`add` 顺势并入。

### 1.2 清单 schema
- `packages/protocol/src/plugin/plugin-manifest.ts`:`PluginKindSchema = z.enum(["agent","plugin"])`,
  顶层非 strict(未知字段忽略→向前兼容)。扩 `"component"` 是 enum 加值 + 新字段组,零迁移。
- **裁决**:protocol 只承载**结构**(zod 形状);业务校验(files 必含测试、路径逃逸、wiring
  白名单、registryDeps 空)放 CLI 侧纯函数——与「protocol zero-runtime、isomorphic」分层一致。

### 1.3 可复用机构
| 能力 | 坐标 | 复用方式 |
|---|---|---|
| 来源形态判别 | `server/cli/install/source-resolver.ts` `classifySourceForm`/`CLI_ALLOWLIST` | 组件来源先剥 `#子目录` 片段,基串走同一判别与白名单 |
| git 拉取 | `packages/server/src/agent-source/git-clone.ts` `ensureGitSource`(clone + pinned ref checkout,缓存) | 原样复用 |
| 运行上下文/报告器 | `server/cli/context.ts` `CliContext`、`reporter.ts` `createProgressReporter`/`redactSecrets`/`CliError` | 原样复用 |
| 临时目录测试范式 | `test/cli/*.test.ts` 的 `mkdtempSync` | 原样复用 |
| webext 编译 | `packages/web-kit/build/build.ts` `buildWebExtension`(esbuild `bundle:true`,入口 `web.config.tsx`) | e2e 直接程序化调用;入口 import 的相对 `.tsx` 被递归打包 → **add 进 components/ 的源码被 web.config 引用即自动编译,零构建改动** |
| 插件契约 | `packages/canvas-kit/src` `defineCanvasLayer/Tool/Action`、`CanvasPluginBundle`(`layers-plugin.ts:70`) | 范例组件直接消费 |

### 1.4 三个「仓里没有」的事实(需自带实现)
1. **无 semver 依赖**(全 workspace 均无 `semver` 包,也无自写比较器)→ 自带极简实现
   (精确/`>=`/`^`/`~` 四种,约 40 行纯函数)。不引入新 npm 依赖(与仓惯例一致)。
2. **既有摘要是 sha384**(`web-kit/build/manifest-emit.ts` `computeIntegrity`,publish 车道用)
   → 溯源用 `node:crypto` sha256,独立小函数,不共享(两者语义不同:SRI vs 本地分叉检测)。
3. **无 unified diff 工具** → 自带极简行级 LCS diff(输出 unified 格式,仅供终端呈现,
   不追求 git 兼容性)。

### 1.5 git `#子目录` 语法可行性(Req 2.3)
既有 git 来源语法的 ref 固定用 **`@<ref>`**(`source-allowlist.ts:14`,`PINNED_REF` 拒裸分支),
`#` 片段**空闲**。裁决:CLI 在把实参交给 `classifySourceForm`/`checkAllowlist` **之前**剥离末段
`#<子目录>`;子目录在 clone 后 join 并做 realpath 包内校验。故 `git:host/u/r@v1.2.0#packages/foo`
成立,不触碰白名单解析器。

### 1.6 `update` 子命令名冲突(需求阶段已裁决)
`update` 已被 source 级更新占用(`SUBCOMMAND_NAMES`)。更新三态并入 `add` 幂等语义
(shadcn 同型:重复 add 即更新)。设计稿 §4.5 的独立 `update` 废止,v2 也沿 `add`。

### 1.7 范例组件的测试执行位置
`packages/canvas-ui` 已有 jsdom + react 测试基建且依赖 canvas-kit。裁决:范例的测试逻辑
写在组件包内 `watermark.test.tsx`(随源分发,Req 1.4/8.1);仓内经 `packages/canvas-ui/test/`
下一个 wrapper 文件相对路径 `import` 该测试文件使其注册进套件(Req 8.4)。若 wrapper-import
在 vitest 收集下有障碍,回退方案:wrapper 直接 import 组件模块并内联同等断言(实现期二选一,
验收标准不变)。

## 2. 架构模式评估

- **选型**:沿 cli-package-commands 的「子域纯函数 + 编排器」模式(`server/cli/<子域>/`),
  新增 `server/cli/component/` 子域。所有校验/判定/生成均为可注入依赖的纯函数,编排器
  `runAdd` 只做穿针引线——与 scaffold/install 子域同构,单测无需 mock 文件系统之外的东西。
- **否决**:把 add 实现进 `packages/server` 运行时包(CLI 子域与 web 运行时分层已定,
  组件安装是纯 CLI 关注点);否决引入 `semver`/`diff` npm 依赖(仓惯例零新增运行依赖,
  且需求面极窄)。

## 3. 关键设计决策

1. **原子写入 = staging-and-swap**(Req 5.3):全部源文件先读入内存(小源码文件),写入
   `.pi/web/components/.staging-<id>-<random>/`,成功后 rename 进位(更新态:旧目录先
   rename 为 `.bak`,swap 成功后删除;任何失败清 staging、还原 `.bak`)。
2. **三态判定纯函数化**:`classifyInstallState(落点, 溯源, 来源清单)` 返回判别式 union
   (`fresh | clean-same-version | clean-new-version | modified | unmanaged`),编排器按值分派
   ——三态逻辑可穷举单测。
3. **peer 解析 = 目标目录向上走 node_modules**:从目标 source 目录逐级向上找
   `node_modules/<pkg>/package.json` 读 `version`(monorepo 里命中根 node_modules 的
   workspace 链接,恰是「目标 source 实际可解析到的版本」语义)。不执行 node resolution
   算法全集(exports 等),版本探测只需 package.json。
4. **错误码沿 `CliError` 形状**(reporter 既有),稳定码小写下划线,全表见 design §Error Handling。
5. **e2e 形态 = `e2e/node/` vitest**(与 `webext-build-load.e2e.test.ts` 同款):临时目录复制
   干净 source(`examples/webext-runtime-code-agent`,最小 3 文件)→ 程序化 `runAdd` → 按指引
   写接线 → `buildWebExtension` → 断言产物含水印标记;另覆盖 dry-run 零写入与拒绝路径。
   bin 层判别(`add` 进 `SUBCOMMAND_NAMES`/dispatch 特例)由 `test/cli/` 单测 + 既有
   cli-commands 构建集成测试覆盖。

## 4. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 与 cli-package-commands 并行推进的分发接缝(6.1)合并冲突 | add 的 early-dispatch 是占位分支**之前**的独立 if,不改占位文本;6.1 落地后迁移成本 = 删 if 加词条 |
| wrapper-import 测试文件在 vitest 收集下的行为未实证 | §1.7 已备回退方案,验收标准不依赖具体载体 |
| 极简 semver 与生态语义偏差(prerelease 等) | v1 显式只支持四种写法,其余稳定码拒绝(Req 4.4),不猜 |
| `--force` 语义被误解为「强制覆盖本地修改」 | 帮助文本与错误提示明确:`--force` 只降级 peer 校验;modified 态无逃生门(Req 7.3) |
