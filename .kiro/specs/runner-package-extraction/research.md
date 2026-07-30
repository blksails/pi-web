# Research & Design Decisions: runner-package-extraction

## Summary

- **Feature**: `runner-package-extraction`
- **Discovery Scope**: Extension（在既有多包工作区里新增第三个包）
- **勘察方式**：三路子代理并发派出后**只报 idle 未交结论**，故全部结论由主对话直接实测取得。
  下文每条断言都附 `path:line` 或**可复现的命令输出**。
- **Key Findings**：
  1. ★ **引导路径的「三难」已被一次真机实验解除**：在真实 `dist/` 树里，
     `createRequire(<dist/server.mjs>).resolve("@blksails/pi-web-core/trust")`
     **解析成功**。包解析链在打包产物里是通的，只是当前 `exports` 未声明
     `runner-bootstrap.mjs` 这一子路径。⇒ 改用包解析可让三个约束同时成立。
  2. ★ **`pack-dist.mjs` 自动扫 `packages/`，不含硬编码包名清单**，且会为每个包建
     `dist/node_modules/@blksails/<name>` 符号链接。新包**零改动**即进产物并可解析。
  3. ★ **esbuild 不内联 `import.meta.url`** —— 与 `build-server.mjs` 与
     `runner-bootstrap-path.ts` 两处文件头注释所述**相反**（那两段描述的是 webpack 行为，已过时）。
  4. runner 的出向依赖**已全部是包级 specifier**，静态 `../` 上行边为 **0**；
     非测试入向依赖只有 **1 处**。搬迁难度远低于 brief 初稿预估。

---

## Research Log

### 引导路径：包解析在 dist 树里是否成立

- **Context**：brief 记录的「三难」—— `runnerBootstrapPath` 必须①留在 313 符号基准、
  ②与 `runner-bootstrap.mjs` 同包、③而引导脚本该随 runner 走。三者不能同时成立。
  候选解法是改用包解析，但**必须先证明 dist 树里有可用的包解析链**，否则等于用一个
  未经验证的机制换掉一个已在生产生效的机制。

- **实测命令与输出**（worktree 根，`dist/` 为既有产物）：

  ```
  $ ls -la dist/node_modules/@blksails/
  pi-web-core   -> ../../packages/core
  pi-web-server -> ../../packages/server
  …（共 15 条，全部为相对符号链接）

  $ node -e 'createRequire(<cwd>/dist/server.mjs).resolve(spec)'
  OK   @blksails/pi-web-core/trust        -> dist/packages/core/src/trust/index.ts
  OK   @blksails/pi-web-core/session/index.js -> dist/packages/core/src/session/index.ts
  OK   @blksails/pi-web-server            -> dist/packages/server/src/index.ts
  FAIL @blksails/pi-web-server/runner-bootstrap.mjs -> ERR_PACKAGE_PATH_NOT_EXPORTED
  ```

- **Findings**：
  - 包解析链**完整可用**，连**通配子路径** `./*.js → ./src/*.ts` 都能在 dist 树里展开。
  - 唯一的 FAIL 是 `ERR_PACKAGE_PATH_NOT_EXPORTED` —— Node **已经找到了包并读了它的
    `package.json`**，只是 `exports` 没声明这条子路径。这是一行声明就能补的，
    与「解析链不通」是完全不同的失败。
  - 对照实验证实 brief 的第二条硬结论：
    ```
    主路径推算 = <repo>/runner-bootstrap.mjs            存在? false
    cwd 回退   = <repo>/dist/packages/server/runner-bootstrap.mjs  存在? true
    ```
    dist 形态下**主路径必然落空**，真正生效的是 `runner-bootstrap-path.ts:49` 的
    硬编码 cwd 回退。

- **Implications**：方案「改用 `createRequire(...).resolve()`」可行，且**严格强于现状** ——
  现状在 dist 下的成立依赖 `process.cwd()` 恰好等于产物根（standalone 是靠
  `bin/pi-web.mjs` 显式设 cwd 才凑成），包解析则与 cwd 无关。

### esbuild 是否内联 `import.meta.url`

- **Context**：`scripts/build-server.mjs:6-12` 与 `packages/server/src/runner-bootstrap-path.ts:24-26`
  都声称构建器会把 `import.meta.url` 内联为构建机绝对路径。这一断言决定
  `createRequire(import.meta.url)` 在产物里是否有意义。

- **实测**：`grep -c "import.meta.url" dist/server.mjs` → **7**（活的，未内联）。
  同时 `dist/server.mjs:20453` 保留了 `path14.join(process.cwd(), "packages/server/runner-bootstrap.mjs")`。

- **Findings**：esbuild（`format: "esm"`）**保留** `import.meta.url`。两处注释描述的是
  **webpack/Next 时代**的行为，迁到 Vite + esbuild 后已不成立。

- **Implications**：`createRequire(import.meta.url)` 在 `dist/server.mjs` 里求值基准为
  `dist/` 目录 → 命中 `dist/node_modules/@blksails/*`。**两处过时注释必须在本 spec 内修正**，
  否则后人会据此否掉正确的方案。

### 产物打包是否需要为新包改动

- **Sources**：`scripts/pack-dist.mjs:333-365`（`packWorkspacePackages`）
- **Findings**：`for (const pkg of readdirSync(pkgsDir))` —— **自动遍历**，以
  `existsSync(package.json)` 为准入；逐包拷 `src` + `package.json`，并
  `existsSync(<pkg>/runner-bootstrap.mjs)` 时一并拷贝；最后按 `package.json` 里的
  `name` 建 `dist/node_modules/<name>` → `../../packages/<pkg>` 相对链接。
- **Implications**：新包**无需改 pack-dist**；引导脚本落到 `packages/runner/runner-bootstrap.mjs`
  后会被同一段 `existsSync` 逻辑自动拷贝。这是「零登记点」的一处，与下文那些必须手工登记的地方形成对比。

### runner 的依赖出向与入向

- **Sources**：`packages/server/src/runner/**`（28 文件 / 3807 行）
- **Findings**：
  - 出向 specifier 全量统计：`@blksails/pi-web-protocol` ×12、
    `@earendil-works/pi-coding-agent` ×8、`@blksails/pi-web-core/*` ×17（含 `agent-definition.js` ×4）、
    `@blksails/pi-web-logger` ×3、`@blksails/pi-web-tool-kit/{mcp,extension,auto-title}-entry` 各 ×1、
    `jiti` ×1、node: 内置 ×9、包内相对 ×50。
  - ★ **静态 `../` 上行边 = 0**。仅两条**动态** import 上行，均在 `runner.ts`：
    `:340 → ../host-assembly/session-store.js`、`:508 → ../host-assembly/model-sources.js`，
    已在 `module-roster.ts:126-131` 作为运行期组合豁免登记。
  - 入向：全仓唯一非测试消费方是 `host-assembly/model-sources.ts` →
    `../runner/model-source-registrar.js`。其余 **53 处全部是 `packages/server/test/` 下的测试**。
    主入口 `packages/server/src/index.ts:3-8` 明确注释「不再从主入口 re-export `./runner/index.js`」，
    该断言**仍然成立**。
- **Implications**：搬迁的真实耦合面只有一条产品边 + 测试。测试须随实现一起搬。

### `builtin-extensions` 的解析根（brief 记载需修正）

- **Sources**：`packages/server/src/runner/builtin-extensions.ts:28-31, 51-55, 82-87`
- **Findings**：
  - 该文件**自身不调用 `createJiti`**。jiti 根建在 `runner-bootstrap.mjs:33` 的
    `createJiti(here)`；`builtin-extensions.ts` 只是静态 import 三个
    `@blksails/pi-web-tool-kit/*-entry`，各 entry-path 函数用**自身** `import.meta.url` 推算。
  - 解析不到时走 `log.warn("builtin extension entry not resolvable in this install tree")`
    （`:84`）后 `continue` —— **不是全静默**，有可观测信号，但不失败。
- **Implications**：
  - brief 里「`createJiti(here)` 在 builtin-extensions.ts:12-15」的说法**不准确**（那是文件头
    对机制的**叙述**，不是该文件的代码）。设计据此修正。
  - 结论方向不变：`@blksails/pi-web-tool-kit` 必须是新包的**运行时依赖**，
    否则三个内置扩展在新解析根下解析不到。
  - R4.2 要求「可观测的失败信号」—— `log.warn` 已满足，本 spec **不改该降级语义**
    （改它属于逻辑变更，且会让某形态缺代码时从"能力不可用"升级为"会话失败"）。

### 层归属与守卫现状

- **Sources**：`packages/core/test/tiering/`
- **Findings**：
  - `module-roster.ts:29-38`：层序 `neutral 0 / core 1 / runner 2 / adapters 2 / assembly 3`。
  - `module-roster.ts:84`：**只有 `runner` 一个模块判 `runner` 层**；
    `model-source-registrar` 是 `runner/` 内的文件，不是顶层模块 —— 名册按顶层模块归类，
    故它随 `runner` 模块整体移动，**名册无需为它新增条目**。
  - `module-roster.ts:89`：`runner-bootstrap-path` 判 **`assembly`** —— 它本就不属 runner 层，
    留在兼容层包与层归属一致。
  - `package-roots.ts:35-38`：`PACKAGE_ROOTS` 现有 2 项（core / server）。
  - `module-roster.test.ts:147-169`：层⟹物理断言目前**硬编码只查 `core` 包**
    （`roots.get("core")`），双向判据为「名册判 neutral/core ⇒ 在 core 包」+「在 core 包 ⇒ 层是 neutral/core」。
  - `package-deps.ts:10-24`：`FORBIDDEN_PACKAGE_DEPS` 七项（hono / e2b / pg / MCP SDK /
    两个 registry-client / ws）；`PEER_ONLY_DEPS = ["@earendil-works/pi-coding-agent"]`。
  - `core/vitest.workspace.ts:19,28`：fast 档把 `node:child_process` 与 `child_process`
    双双 alias 到 `test/setup/child-process-guard.ts`。
  - `core/scripts/run-tests.mjs:55-63`：fast 档**故意不给** `--passWithNoTests`，
    "fast 档为空必须是一次响亮的失败"。

- **Implications**：新包必须同时进 `PACKAGE_ROOTS`，且层⟹物理断言必须从
  「只查 core」推广为「按层→包映射查全部三包」，否则新包成立后该断言对 runner 层**恒真**。

---

## Architecture Pattern Evaluation

| 方案 | 描述 | 优点 | 风险 / 限制 | 判定 |
|---|---|---|---|---|
| (a) 平移字面量 | 保持两段式，把两处 `packages/server` 改成 `packages/runner` | 改动最小，机制不变 | 仍不做 `existsSync`；仍依赖 `process.cwd()` 等于产物根这一巧合；desktop/未来形态一旦 cwd 不同即静默错路径 | ❌ 保留了本 spec 要根治的失败模式 |
| (b) 包解析 | `createRequire(import.meta.url).resolve("@blksails/pi-web-runner/runner-bootstrap.mjs")`，cwd 回退降级为第二级并补 `existsSync` | 与 cwd 无关；已在真实 dist 树实证可行；三个约束同时成立 | 需新包 `exports` 声明该子路径；e2b 烘焙态路径常量须同步改 | ✅ **选定** |
| (c) runner 包自导出 `bootstrapPath()` | 由新包导出解析函数，兼容层转发 | 归属最"干净" | 兼容层为拿到路径必须 import 新包 → **把 runner 包拉进服务端 bundle**，而主入口注释 `index.ts:3-8` 正是为避免这件事才排除 runner | ❌ 与既有约束直接冲突 |

---

## Design Decisions

### Decision: 引导路径改用包解析（三难解除）

- **Context**：见上文「三难」。
- **Selected Approach**：三级解析 —— ①`createRequire(import.meta.url).resolve(<runner 包子路径>)`；
  ②失败则 `process.cwd()` 下的 `packages/runner/runner-bootstrap.mjs`，**并做 `existsSync`**；
  ③两级皆不成立则**抛出**并在错误里列出所查过的位置（R3.3）。
- **Rationale**：①覆盖 dev / dist / standalone / desktop（均有可解析的包链）；
  ②保住"产物被以产物根为 cwd 启动"这一既有形态的兜底；③把失败从 spawn 时的
  ENOENT 提前到解析时，错误现场紧贴根因。
- **Trade-offs**：③是**逻辑变更**（现状无条件返回回退串），违反"只搬不改"，
  故必须**单独成任务、单独标注**。它同时也是 R3.3 的唯一实现方式。
- **Follow-up**：新包 `exports` 必须含 `"./runner-bootstrap.mjs"`；
  `packages/server/package.json` 的 `files` 去掉 `runner-bootstrap.mjs`。

### Decision: `model-source-registrar` 随 runner 走

- **Context**：它是唯一一条产品级入向边的目标。
- **Alternatives**：留在 server（则 runner 反向依赖 server，方向非法）；
  下沉 core（它是 runner 层契约，下沉会让 core 承载 runner 层概念）。
- **Selected Approach**：随 `runner` 模块整体搬入新包。
- **Rationale**：层序 `assembly(3) → runner(2)` 为正向，跨包后依然合法；
  名册按顶层模块归类，`runner` 模块整体移动即可，无需新增条目。
- **Trade-offs**：`packages/server` 因此必须把新包声明为 `dependencies` —— 这是**期望的**方向。

### Decision: agent 运行时 SDK 声明为**非可选** peer

- **Context**：core 把它声明为 `optional: true` 的 peer，因为 core 只有 1 处 `import type`。
  runner 有 **8 处值导入**，没有它根本跑不起来。
- **Selected Approach**：`peerDependencies` 声明，**不加** `peerDependenciesMeta.optional`。
- **Rationale**：宿主决定版本（R1.3），但"可选"会是一句谎 —— runner 缺它必然运行时失败。
- **Trade-offs / Risk**：源码直连分发下，消费方 `tsc` 会编译新包的每个 `.ts`，
  需要能解析到 SDK 类型。`packages/server` 自身已声明该依赖，故 server 侧成立；
  **但新包自己的 `pnpm typecheck` 能否解析到，须在实施时实测**（见 Risks R-1）。
  注意：把 SDK 放进新包的 `devDependencies` 会**直接触发** `PEER_ONLY_DEPS` 守卫。

### Decision: 层⟹物理断言推广为映射表驱动

- **Context**：现断言硬编码 `roots.get("core")`，新包成立后对 runner 层恒真。
- **Selected Approach**：引入「层 → 包根名」映射（`neutral|core → core`、`runner → runner`、
  `adapters|assembly → server`），双向断言对表内每一项执行，并对每个包根做非空校验。
- **Rationale**：保住原断言的防重言性质（两端仍是**两个独立事实源**：名册 vs 磁盘），
  同时消除"新包不被检查"这一空洞。

---

## Risks & Mitigations

- **R-1｜新包 typecheck 解析不到 agent SDK 类型**（peer 且不在自身 node_modules）——
  实施时以 `pnpm --filter @blksails/pi-web-runner typecheck` 实测；
  若失败，退路是把 SDK 同时列入新包 `devDependencies` **并**在 `PEER_ONLY_DEPS`
  守卫里为 `devDependencies` 字段开一条带理由的豁免（豁免须显式，不得靠改判据绕过）。
- **R-2｜e2b 烘焙态在本仓测不到**——`bake-plan.ts:179` 的常量必须随包名改，
  但真机验证要等跨仓 Dockerfile 改 + 基础镜像重烘焙。本 spec 只改本仓常量并
  登记为 Revalidation Trigger；e2b 形态明确列为**已知未验**（R3.6）。
- **R-3｜dev 态的绿是假证据**——两条路径在 dev 下恒等命中。
  缓解：验收以 `pnpm e2e:cli:reloc`（藏起构建目录复现换机）+ dist 树包解析实测为准，
  并在 requirements R3.5 里已把"dev 与单测的绿"排除在证据之外。
- **R-4｜14 个真实 spawn 的测试丢分档后缀**——fast 档把 `node:child_process` alias
  到抛错守卫（`core/vitest.workspace.ts:28`），导入不报错、**调用才报错**。
  缓解：搬迁按**文件名逐字保留**，并在验收时核对各档文件数。
- **R-5｜两处过时注释会误导后人否掉正确方案**——`build-server.mjs:6-12` 与
  `runner-bootstrap-path.ts:24-26` 声称 `import.meta.url` 被内联，实测为假。
  缓解：本 spec 内一并修正，并写上实测命令。

## References

- `packages/server/src/runner-bootstrap-path.ts` — 现行两段式解析与其文件头警告
- `packages/server/runner-bootstrap.mjs` — jiti 根锚定与 `runner.ts` 的硬编码相对路径（`:35`）
- `scripts/pack-dist.mjs:333-365` — 工作区包的自动遍历与符号链接
- `packages/core/test/tiering/` — 依赖方向、分档、包依赖三组守卫
- `e2e/cli/cli-reloc.mjs`（`pnpm e2e:cli:reloc`）— 唯一能抓到换机路径断裂的端到端验证
