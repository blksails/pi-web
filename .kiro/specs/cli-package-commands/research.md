# Research & Design Decisions — cli-package-commands

## Summary

- **Feature**: `cli-package-commands`
- **Discovery Scope**: Extension（对既有 CLI 与既有安装链路的扩展）
- **Key Findings**:
  1. **pi 的包管理器无法把包装到 `~/.pi-web/agents`**。`getBaseDirForScope(scope)` 只返回 `join(cwd, ".pi")`（project）或 `agentDir`（user），无第三种落点。因此 `kind: "agent"` 的安装**必须自建落盘通道**，不能复用 `pi install`。这是本设计最重要的架构分叉。
  2. **`fs.globSync` 在 Node 22.22 可用且支持 `exclude` 谓词**，实测可展开 `examples/**/*.md`。glob 展开、`!exclusion` 求值**零第三方依赖**。
  3. **pi 的 `install` 没有 `--ignore-scripts`**（`install-args.ts:43` 源码注释：「pi 0.79.6 install 的实际 flags 为 `[-l] [--approve|--no-approve]`」）。`roadmap.md:26` 关于 `--ignore-scripts` 的描述与实现不符，已据此修正 requirements 3.5 并新增 3.12。

---

## Research Log

### pi 包管理器的落盘目录约束

- **Context**: 需求 3.6 要求 `kind: "agent"` 的包落到 `~/.pi-web/agents`，而 3.7 要求 `plugin` 交由 pi 的包管理。需确认前者能否复用后者。
- **Sources Consulted**: `node_modules/.pnpm/@earendil-works+pi-coding-agent@0.80.3/.../dist/core/package-manager.js`（`getBaseDirForScope`、`getNpmInstallRoot`、`getGitInstallRoot`）；`dist/core/package-manager.d.ts`。
- **Findings**:
  - `getBaseDirForScope(scope)`：`project` → `join(this.cwd, CONFIG_DIR_NAME)` 且触发 `assertProjectTrustedForScope`；`user` → `this.agentDir`。构造参数只有 `{ cwd, agentDir, settingsManager }`。
  - 没有任何 API 允许指定第三个安装根。把 `agentDir` 指向 `~/.pi-web` 会同时改写 settings/auth 的读写位置，属破坏性副作用。
- **Implications**: **两条安装通道**，按 `kind` 分派。`plugin` → 复用既有 `ChildProcessPiCli` + `assembleInstallArgs`（shell out `pi install`）。`agent` → 自建 `AgentInstaller`（git 浅克隆 / npm tarball 解包）。二者共用来源校验与进度上报。

### glob 展开与完整性摘要的依赖选择

- **Context**: 需求 5.4 要求展开通配与排除模式；5.5 要求逐文件完整性摘要。CLI 必须零新增运行时依赖（`bin/pi-web.mjs` 只 import `node:`）。
- **Sources Consulted**: 本机 `node -e` 实测（Node v22.22.0）；`package.json` engines `>=22.19.0`。
- **Findings**: `fs.globSync(pattern, { exclude })` 存在且可用，`exclude` 接受谓词函数。摘要可由 `node:crypto` 的 `createHash("sha384")` 计算。
- **Implications**: 无需 `fast-glob` / `minimatch` / `globby`。`pi-web.json` 的 `["extensions", "!extensions/legacy.ts"]` 形态可解析为「正模式数组 + 排除谓词」后交给 `globSync`。

### pi install 的真实参数面

- **Context**: 需求 3.5 原拟要求禁止执行第三方安装脚本。
- **Sources Consulted**: `packages/server/src/extensions/install/install-args.ts:42-54`；`packages/server/src/extensions/cli/pi-cli.ts`。
- **Findings**: `assembleInstallArgs` 产出 `["install", <src>, "--no-approve"]`。源码注释明确「pi 0.79.6 无 `--ignore-scripts`」。`ChildProcessPiCli.childEnv()` 只透传 `PATH`/`HOME` 并注入 `GIT_TERMINAL_PROMPT=0`、`CI=1`，**不透传完整环境**（已满足需求 10.2）。
- **Implications**: 修正 requirements 3.5 为 `--no-approve` 的真实语义；新增 3.12 声明 `agent` 通道不执行包脚本（因其只解包，不调用包管理器）。`plugin` 通道的脚本执行行为归 pi 所有，划出边界。

### 跨仓消费 `@pi-clouds/registry-client`

- **Context**: 需求 5.8/5.9、7.x、8.x 依赖签名与注册表客户端。该包 `exports["."]` 直接指向 `./src/index.ts`，无 build 步骤（pi-clouds 的 `source-registry-mvp` R8.4 把分发方式留为悬空项）。
- **Sources Consulted**: `pi-clouds-source-registry/packages/registry-client/package.json`、`src/index.ts`、`src/manifest/signature.ts`。
- **Findings**: 需要的全部是同构纯函数（`signManifest` / `computeIntegrity` / `computeFingerprint` / `canonicalManifestBytes` / `verifyManifest`）与一个 HTTP 客户端。`src/testing/` 提供 in-proc fake registry。
- **Implications**:
  - **不得 vendored 复制签名实现**——规范化字节必须与服务端逐字节一致，副本必然漂移。
  - 采纳方式：**构建期 bundle**。`dist/cli-commands.mjs` 由 esbuild 打包时把 registry-client 的纯函数与 HTTP 客户端内联，运行时零依赖（满足需求 10.6：随包分发的产物在任意路径可解析）。
  - 开发期经 esbuild alias + tsconfig paths + vitest alias 指向兄弟仓源码，与既有 workspace 包同一套机制。
  - **风险**：pi-clouds 的分发形态尚未定（其 spec 决策 9）。若最终发内部 npm，本设计只需把 alias 换成普通依赖，`RegistryPort` 接口不变。

### 本地目录登记的既有接缝

- **Context**: 需求 9 要求为扫描根之外的目录提供不削弱安全门控的登记途径（软链被 realpath 门控静默剔除，已实证）。
- **Sources Consulted**: `packages/server/src/agent-source-list/registry-provider.ts`；`lib/app/pi-handler.ts:496-502`。
- **Findings**: `GET /agent-sources` 的来源本就是「目录扫描 ∪ 注册表文件」。注册表文件路径 `PI_WEB_SOURCES_REGISTRY`，默认 `<agentDir>/sources.json`，形态 `{ "sources": [ { source, name?, title?, description?, avatar? } ] }`。该 provider 只读、坏条目静默跳过。
- **Implications**: 无需新增子命令，也无需放宽 realpath 门控。`install <本地路径>` 判别为直接来源且 `kind` 为 agent 时，**写入 `sources.json` 而非拷贝目录**；`uninstall` 除名。需求 9 的四条验收由 `install`/`uninstall` 天然满足。

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| CLI 内起 HTTP server 打 `POST /extensions` | 复用 Web 侧全部安装路径 | 零新代码 | 为装包启 web 服务器；`adminPolicy` 默认拒绝需绕过；启动延迟 | **否决**（已在 requirements 记录） |
| CLI 直接 `import` packages/server 的 TS | 直接复用校验逻辑 | 简单 | `bin/pi-web.mjs` 是纯 `.mjs`，无 TS 运行时 | 不可行 |
| **esbuild 第二产物 + 动态 import** | 产出 `dist/cli-commands.mjs`，CLI 按需加载 | 复用校验逻辑；运行时零依赖；可重定位 | 构建脚本需改；产物必须落产物根 | **选定** |

---

## Design Decisions

### Decision: 按 `kind` 分派为两条安装通道

- **Context**: 需求 3.6 / 3.7 落盘目标不同，而 pi 的包管理无法落到 `~/.pi-web/agents`。
- **Alternatives Considered**:
  1. 把 `agentDir` 指向 `~/.pi-web` —— 会连带改写 settings/auth 位置，破坏性。
  2. 装到 `~/.pi/agent` 再软链到 `~/.pi-web/agents` —— 软链被 realpath 门控剔除（已实证），不可行。
  3. 自建 `AgentInstaller`。
- **Selected Approach**: 方案 3。`PluginInstaller` 走 `pi install`；`AgentInstaller` 自建落盘（git 浅克隆 / npm tarball 解包）。二者实现同一个 `Installer` 端口，由 `kind` 选择。
- **Rationale**: 保持 pi 的资源目录语义不被污染；`agent` 通道天然不执行包脚本（需求 3.12）。
- **Trade-offs**: 新增自建下载逻辑（约两种来源形态），但避免了对 pi 内部目录约定的侵入。
- **Follow-up**: `AgentInstaller` 的 npm 通道用 `npm pack` 获取 tarball 后本地解包，不执行 `npm install`。

### Decision: `RegistryPort` 端口隔离，publish 与直连解耦

- **Context**: 需求 8.9 要求注册表不可达时直连安装照常工作；注册表本身未部署。
- **Alternatives Considered**:
  1. 直接在各子命令内调用 registry HTTP 客户端。
  2. 定义 `RegistryPort` 接口，`HttpRegistryAdapter` 与测试用 fake 各自实现。
- **Selected Approach**: 方案 2。`create`/`uninstall`/`list`/`update` 与直连 `install` **完全不引用** `RegistryPort`。
- **Rationale**: 使 Wave 1 可独立实现与验证，不阻塞于 pi-clouds spec；同时满足需求 10.5（借助契约夹具离线验证 publish）。
- **Trade-offs**: 多一层接口。但它有两个真实实现（HTTP + fake），不属投机抽象。
- **Follow-up**: fake 优先复用 pi-clouds 交付的 `registry-client/src/testing/`，而非自写替身。

### Decision: 复用注册表文件而非放宽 realpath 门控

- **Context**: 需求 9。
- **Selected Approach**: `install <本地路径>` 写 `sources.json`；不拷贝目录、不动 `scan-provider` 的安全门控。
- **Rationale**: 门控是安全边界；`createAgentSourcesRoutes` 本就是「扫描 ∪ 注册表」的并集，登记是既有接缝而非新开口。
- **Trade-offs**: 本地目录被移动或删除后 `sources.json` 会残留失效条目 —— `RegistrySourceProvider` 对坏条目静默跳过，不影响列表可用性。

### Simplification outcomes

- **不新增 `link` / `unlink` 子命令**：需求 9 由 `install <本地路径>` / `uninstall` 覆盖，命令集保持六个。
- **不引入 glob / hash 第三方库**：`fs.globSync` + `node:crypto` 足够。
- **不为 `ProgressReporter` 定义事件总线**：进度是单进程内的同步回调，直接写 stderr。

### Generalization outcomes

- 需求 3（直连安装）与需求 8（经注册表安装）是同一能力的两种**来源解析前置**：注册表路径只是多了「解析 + 验签 + 复核」三步，落盘阶段共用同一个 `Installer` 端口。故设计一个 `resolveSource(spec) → ResolvedSource` 的统一前置，而非两套安装流程。
- 需求 5（编译）与需求 6（校验）共享同一份「手写清单 → 磁盘产物」的遍历。设计上先产出 `CompiledPackage`（文件列表 + 摘要），校验器与签名器都消费它，避免二次遍历与不一致。

---

## Risks

| 风险 | 影响 | 缓解 |
|---|---|---|
| pi-clouds 的 `registry-client` 分发形态未定 | publish 与 registry-install 无法构建 | `RegistryPort` 隔离；Wave 2 阻塞但 Wave 1 不受影响；alias 换普通依赖即可 |
| 注册表未部署 | publish 无法真机验证 | 用 pi-clouds 交付的 in-proc fake registry 做端到端验证（需求 10.5）；真机验证标注为 `[真机]` |
| 两侧 `kind` 缺省相反 | 编译出的清单被对侧误判 | 编译时**显式写出** `kind`（需求 5.7），并由单测固定 |
| `fs.globSync` 在 Node 22 标注为实验性 | 未来行为变更 | 用法限于 `pattern + exclude` 最小面；engines 已锁 `>=22.19.0`；若失效可换 `node:fs/promises` 的 `glob` 或引入 minimatch |
| `dist/cli-commands.mjs` 未落产物根 | 路径解析回退 `process.cwd()` 失败 | 构建脚本断言产物路径；`e2e:cli:reloc` 覆盖重定位场景 |
