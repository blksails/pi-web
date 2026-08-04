# 完整性批评发现的缺口（cli-agent-build 第二轮）

> 来源：workflow `wf_cd1402dd-ea4` 的收尾 critic（判定 `gaps-found`）。
> **这是下一轮的输入，不是本轮的完成。** 每条都带实测证据，未经复现不得关闭。

## 已由父层修复并加回归守卫

### G1 · 分派入口用裸说明符（原属 3.7）— ✅ 已修

- **现象**：`renderDispatcherSource()` 经 `JSON.stringify(targets.*)` 原样写出文件名，无 `./` 前缀。ESM 解析器一律把裸说明符当**包名**，于是 `pi-web build` 产出的每个扩展加载即 `ERR_MODULE_NOT_FOUND`。
- **连带**：把 `test/chat-app.test.tsx` / `page.render.test.tsx` / `chat-app-logs-wiring.test.tsx` 三个文件打成「0 个用例执行」，而 vitest 汇总行仍显示大片绿。
- **为何逐任务复查看不见**：3.7 的单测只驱动可注入的 `resolveDispatchTarget()` 桩，从不加载真实产出的字节。
- **修复**：`server/cli/build/isolated-entry.ts` 新增 `relativeSpecifier()`；测试断言由「文件名出现过」改强为「必须是相对说明符」，并新增一条独立回归守卫（对裸说明符有判别力）。

### G2 · 构建工具链被静态拖进发布路径（原属 4.1）— ✅ 已修

- **现象**：`server/cli/index.ts` 静态 `import { runBuild }`，而 `runBuild` 静态引入 esbuild/jiti/web-kit build。esbuild 在 jsdom 下因 `new TextEncoder().encode("") instanceof Uint8Array` 不变式检查抛错，导致 `test/publish/publish-orchestrator.test.ts` **0 个用例执行**。
- **修复**：改为 `case "build"` 分支内 `await import("./build/index.js")`，与壳层动态载入 cli-commands 同构。

### G3 · 静态车道 import 了分派器（父层发现，非 critic）— ✅ 已修

- **现象**：修好 G1 后暴露——`lib/app/webext-registry.ts` 是**构建期静态集成车道**（只服务同源宿主），却 import 185 字节的分派器，分派器再动态拉入两份大产物。六个示例合计 2MB+ 被 vite 拖进 jsdom，实测 **V8 OOM**，`chat-app-logs-wiring.test.tsx` 的 10 个用例从汇总里**静默消失**（既不计 passed 也不计 failed）。
- **判据**：基线该文件为 `✓ (10 tests) 319ms`，故属本轮回归而非存量。
- **修复**：六处 import 改为 `web-extension.same-origin.mjs`。

---

## 未修复 —— 下一轮必须处理

### G4 · `entries` 没有任何生产写入方，SRI 退化为常量（属 6.2）

- 6.1（schema）/6.2（`emitManifest` 支持 entries）/6.3（loader 按 realm 选入口）三处都落地了，但 **`runBuild` 手搓 manifest，只写 `entry`+`integrity`**，`emitManifest` 的 `entries` 入参零调用方。
- **后果**：(a) R2.6「分派关系可被静态发现」端到端不可观测；(b) `manifest.integrity` 只覆盖那 2 行分派器，**真正的扩展代码（`web-extension.same-origin.mjs` / `isolated-entry.mjs`）在 manifest 里没有任何完整性记录** —— SRI 从「绑定扩展字节」退化为常量。
- **铁证**（父层已复现）：重建后两个不同示例的 `entry` integrity 完全相同 `sha384-TO6jWABn1P5g+uUPwkVBXWbhGVEaQUdBO+F1ZI0weTnPi20Et9xHZEN0nkJQRC4i`，而各自的 `isolated-entry` integrity 互不相同。
- **相对 `agent-web-extension` R9.3 是实质倒退。**
- **动作**：`runBuild` 改经 `emitManifest({ entries: [...] })`；补一条从**真实构建**出发的断言：两个 entries 的 integrity 各自与其字节一致，且三份产物 integrity 互不相同。

### G5 · 迁移后六个示例的 webext id 全变（属 5.1 / 3.8）

- `runBuild` 用 `location.manifest?.id ?? basename(sourceRoot)` 取 id，把**注册表包 id**（`pi-web.json` 的 `id`，带命名空间斜杠）当成了 webext id。
- `aigc-canvas-agent` 因此得到 `"e2e/aigc-canvas-agent"` —— 而 webext id 是 CSS scoping 的命名空间根（`pw-${extId}-` / `--pw-${extId}-`），**含斜杠会生成非法 CSS 标识符**；该示例目前恰好无 CSS 才没炸。
- 迁移前 → 后：`panes`→`panes-agent`、`aigc-canvas`→`e2e/aigc-canvas-agent`、`surface-demo`→`surface-demo-agent`、`state-bridge`→`state-bridge-agent`、`aigc-canvas-nosurface`→`aigc-canvas-nosurface-agent`。**R6.2「产出与迁移前等价」不成立。**
- **为何没被抓到**：迁移前 `examples-build.test.ts` 有 `expect(result.manifest.id).toBe(ex.id)`，新增的 pane 示例断言块把 id 断言**整条去掉了**。
- **动作**：给 `pi-web build` 增加 webext id 的独立来源（`--id` 或 `pi-web.json` 的 `web.id`），缺省时至少剥掉命名空间段并校验其符合 CSS ident；把六个示例 id 钉回迁移前的值；在回归测试里补回 id 断言。

### G6 · `kind:"html"` 相对路径在宿主侧无解析逻辑（属 5.1）

- 5.1 把六个示例的 pane 声明从 `{kind:"inline", srcDoc}` 改成 `{kind:"html", src:"pane-<id>.html"}`（相对路径），但 `PanesHost`（`packages/panes-kit/src/react/panes-host.tsx:1672`）把 `src` **原样**交给 iframe，无 base 拼接。
- 这六个示例走的是 webext-registry 的构建期静态 import 车道，**根本没有 baseUrl**，`.pi/web/dist/*.html` 也不由任何路由提供 → 相对路径会相对宿主页面解析成 `http://<host>/pane-canvas.html`，全部迁移示例的 pane 面板运行期空白/404。
- 仓内此前唯一的 `kind:"html"` 用法是测试里的**绝对 URL**，所以这条相对路径语义是本轮新引入且从未被验证过的。
- **动作**：要么让示例继续消费 3.5 已算好的**内联文档**形态（见 G7），要么在 PanesHost/merge 层按扩展 baseUrl 解析相对 `src`；并补一条真实浏览器 e2e（打开任一迁移示例的 pane，断言 iframe 内容，而非仅断言磁盘上有 .html）。

### G7 · R2.2 的内联形态没有落盘消费方（属 3.8）

- 3.5 的 `buildPaneArtifacts` 两种形态都算了，但内联形态只以 `documents: Record<paneId, html>` 返回内存；3.8 的 `runBuild` **只取 `paneResult.files`，把 `documents` 整个丢弃**，落盘/清单/manifest 里都没有它。
- `pane-build.ts` 头注自己写着「内联文档由后续阶段（任务 3.8 的职责）按需消费」—— **该消费方没有实现**。
- 于是 R2.2 的内联半边端到端无任何可观测产物，示例也因此被迫改用 URL 形态（即 G6 的来源）。
- **动作**：明确内联形态的落点（落盘为 `pane-documents.json`，或写进 `panes.json` 的 `document` 字段），否则该需求应回 requirements 层重新裁剪。

### G8 · 7.1 添加的 e2e 真跑是红的（属 7.1）

- 任务 7.1 被记为完成，但把它添加的那条 e2e 真跑一遍是红的：分发形态下 `pi-web build` 报 `UNKNOWN_*`（critic 原文在此处被截断，需重跑取完整错误）。
- **动作**：重跑 `pnpm e2e:cli:reloc` 取完整报错，修到真绿；在此之前 7.1 不得勾选。

---

## 未完成任务清单（与上述缺口对应）

| 任务 | workflow 判定 | 关联缺口 |
|---|---|---|
| 3.5 | OK | G7（内联形态无消费方） |
| 3.8 | OK | G5、G7 |
| 5.1 | UNREVIEWED | G5、G6 |
| 5.2 | UNREVIEWED | — 待补复查 |
| 5.3 | **REJECTED** | — 待重做 |
| 6.2 | OK | G4（entries 无写入方） |
| 7.1 | UNREVIEWED | G8 |
| 7.2 | **REJECTED** | — 待重做 |
| 7.3 | 未跑（依赖 7.1） | — |

---

## 第三轮（父层真机验证）新增 / 更正

### ✅ G4 已修 — `entries` 逐入口完整性

`runBuild` 改经 manifest 写出 `entries`（same-origin / isolated 各自绑定自己的字节）。
实测六个示例的 same-origin 与 isolated integrity **各不相同**，`entry`（分派器）保持一致是正确的
——它对所有扩展就是同两行，且必须保持旧宿主可加载。回归断言已补进 `examples-build.test.ts`。

### ✅ G5 已修 — webext id

新增 `--id`，缺省时剥掉注册表包 id 的命名空间段，并**校验其为合法 CSS 标识符**（不合法即以
`BUILD_INVALID_EXT_ID` 终止，走统一错误通道）。六个示例的 id 已钉回迁移前的值，
`examples-build.test.ts` 补回了被删掉的 `expect(manifest.id).toBe(...)`。

### ✅ G6 / G7 已修 — 内联文档落点

`runBuild` 在 **webext 打包之前**把 pane 内联文档落成 `web/pane-documents.generated.ts`
（构建产物，已被 .gitignore 排除且经 `git check-ignore` 验证）。六个示例的 pane 声明改回
`{kind:"inline", srcDoc}`，相对路径引用清零。

### ✅ G8 已修 — 分发形态 e2e 全绿

`pnpm e2e:cli:reloc` 退出码 0、`PASS: 全部通过`。修复链条：
1. `dist/cli-commands.mjs` 需重建（旧产物无 build 分支）；
2. **工具链预检必须放在壳层** —— 打包后 `import { build } from "esbuild"` 是静态 ESM import，
   无论实现层怎么改成「先 resolveToolchain 再动态 import」都会被提升到模块顶层，工具链缺失时
   `import(cli-commands.mjs)` 当场抛裸 `ERR_MODULE_NOT_FOUND`，永远走不到友好报错。壳层是唯一
   能在模块加载前拦截的位置。

### ★ G9（新）— `import.meta.url` 自解析在打包产物中失效

`packages/canvas-ui/build/pane-document.ts` 曾用 `import.meta.url` 自解析 `PACKAGES_ROOT`，
理由是「本文件永远与 packages/ 同处一棵树」。**该前提在分发形态不成立**：它被 esbuild 内联进
`dist/cli-commands.mjs`，`import.meta.url` 于是指向那个产物，路径错位两级（实测算成
`<agents>/canvas-ui/src/styles.css`）。已改为经 `CanvasCssOptions.packagesRoot` 显式注入，
与 `presetPath` 同一套候选路径机制；`import.meta.url` 仅留作开发形态回落。

**教训**：任何会被打包内联的模块都不能用 `import.meta.url` 推断仓库布局。

### ★ G10（新）— tailwind 内容扫描扫进 node_modules

`canvasContentGlobs` 原先扫 `resolve(packageRoot, "**", "*.{ts,tsx}")`，在真实 agent 上把整棵
依赖树拖进扫描（tailwind 自己警告 "accidentally matching all of node_modules"）。已收窄为
`src/**` 与 `panes/**`。

### ★ G11（新，**推翻 requirements 的边界判断**）— 两层包装不是漂移

requirements 的 Boundary Context 写着「`{definition, config}` 两层是外部 agent 陈旧产物的
单方面漂移，产物按当前版本重建后即自然消解」。**真机证伪**：用 `pi-web build` 完整重建后，
产物导出的仍是 `panes: { definition, config }` —— 因为那是 agent 的 `.pi/web/web.config.tsx`
本来就这么写的，不是产物陈旧。

更关键的是，**宿主内部两处消费方自己就不一致**：

| 消费方 | 读法 | 与 agent 产物 |
|---|---|---|
| `packages/panes-kit/src/merge.ts:98` | `source.definition.panes` | **吻合** |
| `packages/ui/src/chat/pi-chat.tsx:627` | `extension.panes.panes` | 期望扁平，**不吻合** |

因此真正的缺陷在 `pi-chat.tsx:627`，属于宿主消费侧 bug，不是本 spec 的产物问题。
**requirements 的 Out of scope 理由需要改写**（原因错了，结论「不在本 spec 内修」仍成立，
但必须另立 spec 而非等它自然消解）。

### ★ G12（新）— npm 发布版落后于 workspace，外部 agent 无法纯 npm 消费

真机验证被迫全程 link 到 workspace 才跑通，逐个卡点：

| 包 | npm 版 | 问题 |
|---|---|---|
| `@blksails/pi-web-canvas-ui` | 0.2.0 | `exports` 无 `./pane` 子路径（workspace 版有） |
| `@blksails/pi-web-panes-kit` | 0.1.0 | 缺 `PaneLoadingSkeleton` 导出 |
| `@blksails/pi-web-kit` | — | agent 未声明该依赖（提供 `defineWebExtension`） |

**结论：`pi-web build` 本身在独立仓工作正常**（12 个产物文件，退出码 0），但要让外部 agent
真正走纯 npm 依赖模式，必须先把这几个包的新版发布上去。这条不属于本 spec 的实现缺陷，
而是发布节奏问题，需单独排期。

### 真机验证遗留

- `aigc-agent/node_modules/@blksails/*` 目前是**指向 workspace 的软链**（联调态），
  非纯 npm 安装态。若要复现纯 npm 场景，需先发布上述包的新版再 `pnpm install` 还原。
- 该 agent 的 `package.json` 已加 `@blksails/pi-web-canvas-ui` 依赖，
  `pnpm-workspace.yaml` 已放行 `esbuild` 的 postinstall（原生二进制必需）。
- 新增 `panes/panes-declaration.ts`（薄适配层，复用既有 `modules.ts` / `agent-config.ts`，
  不复制数据）以满足 `pi-web build` 的汇总声明约定。

### ★ G13（新）— `examples/` 没有任何类型检查覆盖

根 `tsconfig.json` 的 `exclude` 含 `"examples"`，只通过 `lib/app/webext-registry.ts` 的 import
间接拉进 17 个纯声明式扩展的 `web.config.tsx`；pane 示例的 `web/panes/index.ts` **不在其中**
（registry 现在 import 的是 dist 产物 `.mjs`，不是源码）。

**后果**：5.3 原完成态「全新检出后类型检查通过」是**空断言** —— 实测把垫片整个移走，
`pnpm typecheck` 仍是 0 错误。垫片目前只对 IDE 有意义，没有任何 CI 层面的判据。

**本 spec 的处置**：改用「对每个示例的 pane 声明文件单独跑 `tsc --noEmit`，统计因缺失中间产物
产生的 TS2307」作为判据，并做了转红对照（移走垫片 → 计数 1）。六个示例均已验证为 0。

**遗留**：这只是本 spec 内的绕行，`examples/` 整体仍无类型检查覆盖。要根治需给 examples 建
tsconfig 并纳入 `pnpm -r typecheck`，属独立改进，不在本 spec 范围。

### ✅ G11 已修（**超出原边界的必要改动**）— 宿主两处消费方归一

7.3 的完成态「pane 面板可正常打开」被 G11 阻塞：`pi-chat.tsx` 两处按扁平结构读 webext 的
`panes`，遇到 agent 的两层形态直接崩成白屏。requirements 原把它划在 Out of scope，但它
**阻塞本 spec 自身的验收**，且 `panes-kit/merge.ts` 已证明两层形态是宿主接受的，故在此修复：

- `pi-chat.tsx` 的 `logsPaneHosted`：改为「先取 `definition`，取不到再当扁平用」，并对数组做防御；
- `pi-chat.tsx` 的 `agentPaneDecl`：同样先剥外层再交给 `mergePaneSources`，否则
  `merge.ts` 的 `for...of` 抛 "source.definition.panes is not iterable"；
- `agentPaneConfig` 改从**未剥层**的原始声明取（两层形态下 `config` 与 `definition` 平级）。

**真机验证（浏览器）**：aigc-agent 会话完整渲染，Pane 切换器列出 agent 声明的全部四个 pane
（搜图 / 素材 / 画布 / 日志），打开「素材」后 iframe 加载 `pane-materials.html` → HTTP 200、
含 script 与 CSP、`<title>素材</title>`，面板内容（素材库 / 素材目录 / 分类筛选 / 分页）完整渲染。
控制台零错误。

⚠ 该改动**超出 requirements 声明的边界**，属于「阻塞验收故必须修」的例外，已在此显式记录。

### ★ G14（新，5.2 复查 REJECT 的根因）— esbuild 版本在开发/分发形态之间不一致

5.2 首轮复查判 REJECT，依据是「收敛前后产物差 100 字节」。父层定位根因：**与收敛逻辑无关**。

| 调用点 | 解析到的 esbuild |
|---|---|
| 仓库根（收敛前 `scripts/build-builtin-panes.ts` 直接 import） | **0.28.1**（根 devDependencies `^0.28.1`） |
| `packages/web-kit`（收敛后经 `bundlePaneEntry`） | **0.24.2**（web-kit dependencies `^0.24.0`） |

对照实验（同配置、同入口、只换版本）：0.28.1 → 9015 字节且**不含** `tauri-host-adapter` /
`tauri-host-overlay` 符号；0.24.2 → 9111 字节且包含 —— 两个大版本 tree-shaking 行为不同。

复查者推测是「tsconfig / absWorkingDir 别名解析随调用脚本目录而异」，方向对（调用点决定解析）
但机制判断有误，实际是**依赖版本解析**。

**顺带暴露的既存缺陷**：分发形态用的是 0.24.2（`dist/node_modules/esbuild@0.24.2`），而开发形态
脚本用 0.28.1 —— 同一份源码在两种形态下产出不同产物，此前无人察觉。

**处置**：把 `packages/web-kit` 的 esbuild 统一到 `^0.28.1`。统一后两侧同为 9015 字节，
5.2 的「字节等价」完成态成立；完成态表述已澄清为「同一 esbuild 版本下等价」。
