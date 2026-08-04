# Research Log — cli-agent-build

## 调研范围

design 阶段并发派出三路调研（2026-08-04），全部为只读勘察：

1. **CLI 集成点与分发形态可行性**（assumption check：设计所依赖的外部契约是否真实存在且行为如假设）
2. **manifest 协议变更影响面**（R2.6 要求 manifest 表达双入口）
3. **pane 声明约定与既有抽取层**（R3 约定发现机制）

requirements 阶段另有三路调研（宿主既有构建能力、agent 侧构建脚本解剖、steering 与相邻 spec 约定），其结论已并入 `requirements.md` 的 Project Description 与 Boundary Context。

---

## 一、关键发现

### F1【确证】分发形态下现有全部子命令即已失效 —— 前置阻断

- 根 `package.json` `files: ["bin","payload","vite.config.ts"]`，**npm 包不含 `dist/`**（`scripts/pack-payload.mjs:5` 明写「`dist/` 本身不再随包」）。
- `distCliCommandsJs()`（`bin/pi-web.mjs:502-505`）只看 `PKG_ROOT/<PI_WEB_DIST_DIR ?? "dist">/cli-commands.mjs`，**从不调用 `resolveRuntime()`**（`bin/pi-web.mjs:462-474`，三级解包解析仅服务于 `run` 意图）。
- ⇒ 全局安装态下 `create`/`install`/`uninstall`/`list`/`update`/`publish` 全部命中 `bin/pi-web.mjs:663-669` 的「未找到子命令实现产物」并退 1。
- 至今无守卫：`e2e/cli/cli-reloc.mjs:221-238` 直接 `import()` 解包出的文件，**绕过了壳层**。

**影响**：`pi-web build` 若不先修这条，在真实安装形态下同样不可用。列为 Phase 0。

### F2【确证】构建工具链在分发形态下缺失

实测（dist 树）：
```
ls dist/node_modules/{esbuild,postcss,tailwindcss}  → 三者皆无
grep -c esbuild dist/cli-commands.mjs               → 0
grep -c tailwindcss dist/cli-commands.mjs           → 0
```

| 包 | esbuild | postcss | tailwindcss |
|---|---|---|---|
| 根 `package.json` | dev | dev | dev |
| `packages/web-kit/package.json:25` | **dependencies** ^0.24.0 | — | — |
| `packages/canvas-ui/package.json:43-45` | dev | dev | dev |

- esbuild 经 `@blksails/pi-web-kit` 传递依赖可随包安装；**postcss / tailwindcss / autoprefixer 在任何被发布包里都只是 devDependencies ⇒ 全局安装态完全缺失**。
- `scripts/build-server.mjs:47-53` 的 `EXTERNAL` 不含三者 ⇒ 一旦 `server/cli/**` 引入，会被静态内联进 `cli-commands.mjs`。esbuild 是原生二进制包装器，内联必崩。
- `scripts/pack-dist.mjs:52-57` 的 `RUNTIME_PACKAGES` 只有 4 项，工具链不在收集范围。

### F3【确证】`packages/ui/tailwind-preset.ts` 在分发树中不可达

- `scripts/pack-dist.mjs:333-352` `packWorkspacePackages()` 只拷 `package.json` / `src/` / `runner-bootstrap.mjs` / `build/` 四类，**包根散装文件不在其中**。实测 `ls dist/packages/ui` → 仅 `package.json  src`。
- `packages/canvas-ui/build/pane-document.ts:49-51` 的 `resolve(repoRoot,"packages","ui","tailwind-preset.js")` 在 dist 树中既无 `.js` 也无 `.ts` ⇒ 必失败。
- 对照：`dist/packages/web-kit` 含 `build/`，故 `@blksails/pi-web-kit/build` 在 dist 树中**可解析**（仍需 jiti 加载 `.ts`）。

**既有同类问题的解法（应照抄）**：`examplesRootCandidates` 模式 —— 壳层构造候选数组，产物内以纯函数取第一个存在者（`bin/pi-web.mjs:673`、`server/cli/index.ts:60-66`、`e2e/cli/cli-reloc.mjs:232-238`）。

### F4【确证】manifest schema 非 strict，加可选字段不破坏加载，但有静默剥离

- `packages/protocol/src/web-ext/manifest.ts:37` 是裸 `z.object(...).superRefine(...)`，zod v3 默认 **strip**。
- **旧宿主读新 manifest**：不报错，但 `resolve-webext.ts:47` 的 `parsed.data` 丢掉新字段，`webext-trust-service.ts:41-45` 的 `strip()` 基于它展开 ⇒ **新字段永远到不了浏览器**。
  ⇒ **`entry` 必须继续指向旧宿主可用的产物**（现有运行时分派器短期内不能删）。
- **新宿主读旧 manifest**：可选字段 `undefined`，完全兼容。
- `targetApiVersion` 语义已退化为纯声明（`extension-gate.ts:11-13`、`docs/release-checklist.md:14`），无代码据它判兼容 ⇒ 提升它无功能效果。

### F5【确证】签名取舍：二者只能取其一

- `canonicalManifestBytes()`（`manifest.ts:72-80`）是**硬编码固定 7 键有序对象**（`id/targetApiVersion/entry/css/integrity/capabilities/config`），`signature` 被排除；签验两侧调同一函数。
- **不把新字段加入** ⇒ 规范化字节不变 ⇒ **既有 Ed25519 签名继续通过**；代价是新入口字段**落在签名覆盖之外**，可被追加/篡改而不破坏签名。
- **加入**（哪怕 `?? null`）⇒ 规范化字节改变 ⇒ **全部既有签名立即失效**，需全量重签重发。

### F6【确证】SRI 与 entry 是写死的单数关系

耦合点五处：`manifest.ts:49-57`（superRefine：有 entry 必有 integrity）、`manifest-emit.ts:83-85`（一对一派生）、`build.ts:90,117-125`（一次构建只产一份 entryBytes）、`extension-gate.ts:67-68,122-129`、`extension-loader.ts:58`（单 URL 拼接）。加第二入口必须引入 per-entry 结构。

### F7【确证】隔离车道既有安全缺口（非本特性引入）

跨仓实证（`../pi-clouds`）：`resolve-cloud-webext.ts:129-131` 取的是**同一个 `entry` 字段**，无第二字段可选；`pane-loader-route.ts:45-57` 生成的 loader HTML **没有 import map** ⇒ 裸 `react` specifier 必然解析失败，这正是「运行时 `await import("react")` 判 realm」hack 的根因。且隔离车道**全程不做 integrity 校验也不验签**（`resolve-cloud-webext.ts:12-21` 自述验签退化为声明式判定）。

### F8【确证】builtin panes 的目录约定不可原样复用

`scripts/build-builtin-panes.ts` 的「扫 `panes/<id>/main.tsx`、目录名即 paneId」有四条硬阻断：
1. **id 来源不兼容** —— 跨包 pane（`canvasPaneModule`）源码在 `packages/canvas-ui/src/`，不可能出现在 agent 的 `panes/<id>/` 下，除非复制文件（破单源）。
2. **丢 `capabilities`** —— 目录扫描只产 HTML；宿主自己是靠 `lib/app/builtin-panes/*.ts` 手写补上的，**即宿主实际是两处声明**，正是本 spec 要消除的东西。
3. **丢 `canvasStyles`**。
4. **入口文件名不匹配** —— 既有 agent 入口叫 `guest.tsx` / `pane-guest.tsx`，非 `main.tsx`。

**可复用的是它的三条行为纪律**：不存在即空集不报错（满足 3.3）、排序保产物稳定、产物不入库 + `.d.ts` 垫片（满足 5.2）。

### F9【确证】pane 声明必须导入 TS 模块并求值

- `eventTargets` 的键是**计算属性名** `[CANVAS_OPEN_ATTACHMENTS_EVENT]`，值来自运行时常量导出（`aigc-agent/panes/agent-config.ts:26`；消费点 `packages/panes-kit/src/react/panes-host.tsx:892,1076`）。
- `capabilities.events.subscribe/publish` 同理引用 `CANVAS_OPEN_ATTACHMENTS_EVENT`、`SESSION_LOCATE_EVENT`。
- `entry` 的 `new URL(..., import.meta.url)` 语义是**相对声明模块自身**解析。

⇒ 三者都无法在 JSON 或 AST 静态解析层面表达，发现机制必须以 jiti 导入并求值。

### F10【确证】构建期/运行期字段互不重叠

| 字段 | 期别 |
|---|---|
| `id` / `title` / `icon` / `capabilities` | 两期共用 |
| **`entry` / `canvasStyles`** | **构建期独占**（运行期在 `web.config.tsx:33` 显式解构丢弃） |
| `document` | 构建期产物注入 |
| `allowMultiple` / `maxInstances` / `lifecycle` / `hostView` | 运行期独占 |
| `persistenceKey` | host 私有，不进模块层 |

⇒ 模块层是唯一单源，两期各取子集且互不重叠地扩展。构建期只需从模块额外读 `entry` + `canvasStyles` 两个字段。

### F11【确证】React 单例问题在现有守卫中无着力点

- `EXTERNAL_SINGLETONS` 与 `assertNoBundledSingletons`（`web-kit/build/build.ts:18-25,87`）**只作用于 `buildWebExtension` 的 ESM 产物**。
- **pane bundle 走完全独立的第二条路径**：`bundlePaneEntry`（`pane-document.ts:55-71`）与 `scripts/build-builtin-panes.ts:116-127`，二者都是 IIFE、**无 `external` 数组、不调守卫**。pane 是 opaque-origin iframe 独立 realm，无 import map，React **必须打进去** —— 对 pane 而言 external 是错的。
- aigc 的 `paneReactSingletonPlugin` 解决的是第三个问题：**打进来的是哪一份**。独立仓与 pi-web 各装一份 React 时，esbuild 按 importer 就近解析会把两份 React 拖进同一个 IIFE ⇒ Invalid Hook Call 白屏。
- `bundlePaneEntry` **连 `plugins` 参数都没有**，插件无处注入。
- 守卫方向相反：pane 产物需要「React 恰好出现一次」，而 `findBundledSingletons` 只报命中不计数。

### F12【确证】通用 pane 文档层缺六项能力

`packages/web-kit/build/pane-document.ts` 相对 aigc 实际所需缺：① `bundlePaneEntry` 的 plugins/define/external 透传（最硬）；② `entry` 接受 `URL`；③ CSP 可配（aigc 需 `media-src`、`connect-src`，URL 形态还需 `script-src 'self'` + `ipc:`）；④ 「一次算 canvasCss、按 pane 复用」的分离（现 `buildCanvasPaneDocument` 每 pane 重跑完整 tailwind）；⑤ URL 形态出口（`pane-<id>.js` + `.html`）；⑥ `repoRoot` 换包出口解析。

---

## 二、综合结论（Synthesis）

### S1 三个可独立移动的责任缝 —— 判定为一个 spec 的三个阶段，不拆分

| 缝 | 内容 | 可独立交付？ |
|---|---|---|
| A · 分发链可用性 | F1/F2/F3 的修复 | **是**（本身即修复既有 bug） |
| B · 构建命令与 pane 收编 | R1–R7 主体 | 依赖 A |
| C · manifest 双入口协议 | R2.6 | 依赖 B 的产物形态 |

**决策**：保留在一个 spec 内，但以 Phase 0/1/2 强制排序。理由：A 单独交付无用户可见价值（现有子命令在安装态失效这件事，只有当有人真去用安装态时才暴露，而本特性正是那个人）；C 若不做，R2.4 的分派器 hack 就得永久保留，与「消除漂移」的立意冲突。三者共享同一套验收路径（`e2e:cli:reloc` 经壳层跑真实构建），拆开会导致同一条 e2e 被写三遍。

### S2 build-vs-adopt

| 能力 | 决策 | 依据 |
|---|---|---|
| webext 打包主体 | **Adopt** `buildWebExtension` | 已满足 R2.1/R2.7，含 externals 守卫与 CSS scoping |
| pane 文档渲染 | **Adopt + 扩展** `pane-document.ts` | 已有 CSP/BASE_CSS/renderPaneDocument，缺 F12 六项 |
| pane 发现 | **Build** 新机制 | F8 四条硬阻断，目录约定不可复用 |
| 候选路径解析 | **Adopt** `examplesRootCandidates` 模式 | F3，同构问题已有既证解法 |
| 错误呈现 | **Adopt** `ProgressReporter` + 判别联合 | 既有契约，`redactSecrets` 直接满足 7.3 |
| canvas 样式管线 | **Adopt + 重构** `buildCanvasPaneDocument` | 拆出 `resolveCanvasCss()` 一次算（F12④） |

### S3 泛化：三处 `htmlDocument` 实现收敛为一处

`web-kit/build/pane-document.ts:42`、`scripts/build-builtin-panes.ts:72`、`aigc-agent/build.ts:111` 是同一函数的三份副本（后两者的注释均自承「与 examples 逐字同策」）。R6.4 要求收敛。收敛后 `scripts/build-builtin-panes.ts` 也应改为消费通用层。

### S4 签名取舍的决策

**采纳「不加入 `canonicalManifestBytes`」**：新入口字段不进签名覆盖范围，既有已发布包签名不失效。

理由与代偿：
- F7 已证隔离车道**当前全程不验签也不验 SRI**，因此「新入口不受签名保护」**不是本特性新增的风险敞口**，而是既存缺口的延续；
- 反之若加入，需全量重签重发所有已发布 webext 包，成本与本特性不成比例；
- 代偿：在 design 的 Security Considerations 中显式记录该限制，并列为 `Revalidation Triggers` —— 当隔离车道补上验签时，须一并把入口字段纳入规范化字节并做一次协议大版本迁移。

### S5 简化：不引入 agent 侧新配置文件

R3 决策已定「保留 TS 模块」。F9/F10 进一步证明这不只是偏好而是硬约束。因此**不新增 `pi-web.json` 的 build 配置段**，避免第二声明源（R3.2）。约定发现失败时的逃生口用 CLI 显式选项（R3.6），而非配置文件。

---

## 三、风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R-1 | Phase 0 改 `distCliCommandsJs()` 可能影响现有全部子命令 | 先补 e2e：经**壳层**在解包形态跑既有子命令，证明修复前红、修复后绿 |
| R-2 | esbuild 原生二进制在 dist 树的解析 | 进 `EXTERNAL` + `RUNTIME_PACKAGES`；`e2e:cli:reloc` 覆盖分支 ③ |
| R-3 | tailwind content 扫描基准随 `entry` 漂移（entry 在 `node_modules` 深处时会去扫 node_modules） | 扫描基准显式化为「声明模块所在包根」，不用 `dirname(entry)` |
| R-4 | 旧宿主静默剥离新入口字段 | `entry` 保持指向分派器产物；分派器在协议双入口普及前不删（F4） |
| R-5 | `paneReactSingletonPlugin` 的解析基准若取 CLI 自身位置，会反向解析到 pi-web 的 React | 基准必须是 **agent source 根**；与 1.7 相互作用，在 design 中写死 |
| R-6 | 迁移 6 个示例可能改变产物字节 | R6.2 要求产物集合等价；用 `packages/web-kit/test/examples-build.test.ts` 作为回归基线 |

---

## 四、待后续 spec 处理（本 spec 明确不做）

- 隔离车道补验签与 SRI 校验（F7），及随之而来的 `canonicalManifestBytes` 迁移（S4 代偿）。
- 宿主消费侧读取 pane 声明的两处崩溃（`pi-chat.tsx:627`、`panes-kit/merge.ts:98`）—— 见 `requirements.md` Boundary Context，产物重建后应自然消解。
- `lib/app/builtin-panes/*.ts` 的手写声明与目录约定的两处声明合一（F8②暴露的宿主自身问题）。
