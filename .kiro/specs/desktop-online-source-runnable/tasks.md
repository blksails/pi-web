# Implementation Plan

> 范围铁律：**不自行实现安装落盘** —— 下载/解包/完整性校验/原子替换/回执一律复用 `installFromRegistry`；
> **`@pi-clouds/registry-client` 不得出现在 `packages/server/src` 的任何真实 import 中**；
> 不改 `create-session.ts`、`AgentSourceResolver` 核心、`compareAgentSourceRecords`。

- [x] 1. 包内基础：形态判别与已装索引

- [x] 1.1 (P) `sourceId@channel` 形态判别
  - 新建 `packages/server/src/agent-source/online-source-id.ts`：`isOnlineSourceRef` / `parseOnlineSourceRef` / `formatOnlineSourceRef`，纯字符串处理，不读 fs 与 env。
  - **严格判别**（该判别在 `identify()` 中优先级最高，误判会劫持本地源解析）：排除以 `/`、`.`、`~` 开头的路径形态；排除含 `://` 的 URL；排除 `git:`、`builtin:` 前缀；要求恰有一个 `@` 且其后非空、其前非空。
  - 经 `packages/server/src/agent-source/index.ts` 导出。
  - 观察性完成态：单测覆盖 `acme/canvas@stable` 命中，以及 `/abs/p`、`./rel`、`~/x`、`https://h/x@v`、`git:h/u/r@ref`、`builtin:x`、无 `@`、`a@`、`@b` 全部不命中。
  - _Requirements: 8.1_
  - _Boundary: online-source-id_

- [x] 1.2 (P) 已安装线上源的本机索引
  - 新建 `packages/server/src/agent-source-list/installed-registry-index.ts`：`readInstalledReceipt(dir)` 与 `createInstalledRegistryIndex({ roots })`（含 `lookup(sourceId)`）。
  - 只读回执中的 `sourceId` 与 `channel`（`version` 可选、仅诊断用）；**容忍未知字段**，缺任一必需字段即返回 `undefined`（视为非本通道目录并降级）。
  - 仅用 Node `fs`/`path`；**不得** import `@pi-clouds/registry-client`。JSON 解析失败、目录不可读一律降级为「无回执」而非抛出。
  - 经 `packages/server/src/agent-source-list/index.ts` 导出。
  - 观察性完成态：单测覆盖有效回执 → `lookup` 命中并返回目录；无回执 / JSON 损坏 / 缺 `sourceId` / 根不存在 → 不命中且不抛。
  - _Requirements: 1.3, 2.2, 7.2_
  - _Boundary: installed-registry-index_

- [x] 2. 列表身份归一（消除装后重复条目）

- [x] 2.1 扫描记录认领线上身份
  - 改 `packages/server/src/agent-source-list/scan-provider.ts`：目录含合法回执时，`id` 归一为 `sourceId`、`source` 归一为 `sourceId@channel`；`origin` **保持 `scan`**（不得改为 registry，否则触碰排序语义）。
  - 无回执的目录：记录构造与今日**逐字段等价**（回归护栏）。
  - 不改 `compareAgentSourceRecords`，不改分页游标语义。
  - 观察性完成态：单测断言 —— 含回执目录产出 `id === sourceId` 且 `source === "<sourceId>@<channel>"` 且 `origin === "scan"`；无回执目录的记录与改动前逐字段相同；既有 `scan-provider` 用例全绿。
  - _Requirements: 3.1, 3.2, 3.3, 1.4, 8.3_
  - _Boundary: scan-provider_
  - _Depends: 1.1, 1.2_

- [x] 3. 应用层：安装端口与解析插件

- [x] 3.1 注册表安装端口
  - 新建 `lib/app/online-source/registry-install-port.ts`：取 P1 授予 → 构造消费面 `HttpRegistryAdapter` → 调 `installFromRegistry(port, sourceId, { channel, targetDir })` → 把结果归一为 `{ ok: true, dir }` 或 `{ ok: false, failure }`。
  - `InstallFailure` 判别联合：`NOT_AUTHENTICATED` / `GRANT_UNAVAILABLE` / `NOT_FOUND` / `UNSUPPORTED_DISTRIBUTION` / `DOWNLOAD_FAILED` / `EXTRACT_FAILED` / `INTEGRITY_MISMATCH` / `TARGET_OCCUPIED`。
  - **无凭据时直接返回 `NOT_AUTHENTICATED`，不得发起任何网络请求**。
  - 目标目录名由 `sourceId` 派生（`/` → `__`，其余不安全字符保守处理），确定性且无路径穿越；目标位置已存在**非本通道**安装（无回执）时返回 `TARGET_OCCUPIED`，**不静默覆盖**。
  - **不自行实现下载/解包/校验/落盘**，全部委托既有实现。
  - 观察性完成态：单测覆盖各阶段失败 → 对应 `InstallFailure`；无凭据 → `NOT_AUTHENTICATED` 且注入的 fetch/adapter **零调用**；断言任一失败载荷与日志参数中**不含** token 字面量。
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 5.2, 5.3, 5.4, 6.1, 6.2, 7.1, 7.3, 2.1_
  - _Boundary: registry-install-port_
  - _Depends: 1.1_

- [x] 3.2 线上源解析插件
  - 新建 `lib/app/online-source/registry-source-resolver.ts`：实现 `SourceResolverPlugin`。`canHandle` 直接复用 1.1 的判别；`resolve` **先查索引**命中即返回该目录，未命中才经 3.1 的端口安装。
  - 安装失败 → 抛出携带失败分类的解析错误（使 `create-session` 不创建会话）。
  - 观察性完成态：单测覆盖 —— 索引命中 → 端口**未被调用**且返回索引目录；未命中 → 端口被调用**恰一次**并返回其目录；端口失败 → `resolve` 抛出且错误可辨识失败分类；无凭据 → 以 `NOT_AUTHENTICATED` 失败。
  - _Requirements: 1.1, 1.2, 1.3, 2.2, 4.4, 5.1, 6.3_
  - _Boundary: registry-source-resolver_
  - _Depends: 1.1, 1.2, 3.1_

- [x] 4. 装配接线

- [x] 4.1 把插件接入既有 resolver wrapper
  - 改 `lib/app/pi-handler.ts`：在装配处按已解析的扫描根构造索引与端口、构造插件；令 `makeRealResolver` 转发的解析选项带上 `sourceResolver`。
  - **仅在云登录与能力端点均已配置时注入**；未配置则不注入插件，解析链路与本特性引入前完全一致。
  - 复用 P1 既有的 `DesktopCapabilitiesClient` 与 `authSessionState` 凭据权威，不新建第二条凭据通路。
  - 观察性完成态：装配后 typecheck 通过；未配置云登录时以本地目录源建会话行为不变；已配置时以 `sourceId@channel` 建会话可走到插件路径。
  - _Requirements: 1.1, 8.1, 8.2_
  - _Boundary: pi-handler assembly_
  - _Depends: 2.1, 3.2_

- [x] 4.2 失败分类经 HTTP 呈现
  - **实施期发现的缺口**：设计假设「`create-session` 据既有错误映射返回」，但真机烟雾证实
    `mapEngineError` 对未映射错误一律兜底 `500 INTERNAL`（`error-map.ts`），Req 4.1（可区分的
    结构化错误）与 Req 5.1（说明需要登录）因此落空 —— 用户只看到「Internal server error.」。
  - 在 `packages/server/src/agent-source/` 定义失败码联合与 `OnlineSourceInstallError`
    （纯数据错误类，**不引入** registry-client），由应用层的解析插件抛出它。
  - `mapEngineError` 增加分支：按失败码映射到合适状态码（未认证 401、未找到 404、
    形态不支持 400、目标被占 409、上游/环境类 502），响应体带上失败码供前端区分。
  - 观察性完成态：单测覆盖各失败码 → 对应状态码与响应体 `code`；真机烟雾中以线上标识建会话
    得到非 500 的明确拒绝。
  - _Requirements: 4.1, 5.1_
  - _Boundary: error-map + online-source-errors_
  - _Depends: 3.2_

- [x] 5. 验证

- [x] 5.1 集成验证
  - 在 `packages/server` 新增集成用例：mock 线上一条 + 本机已装同源一条 → 列表**恰一条**且 `source` 为 `sourceId@channel`（Req 3.1/3.2）；清凭据后列表仍含该源且标识不变（Req 2.3/3.2）。
  - 断言未配置云登录时列表与建会话与今日等价（Req 8.2）。
  - 观察性完成态：新增用例全绿；`packages/server` 既有用例零回归。
  - _Requirements: 3.1, 3.2, 2.3, 8.2_
  - _Boundary: agent-source-list 集成_
  - _Depends: 4.1_

- [x] 5.2 端到端验证
  - 新增 e2e：真实 server + mock 能力端点 + mock 注册表（返回**真实 tarball 字节**）。
  - **复用既有夹具，勿重造**：`test/install/registry-install.test.ts` 已有 `makeTarball({path: content})`（经 `tar -czf` 产出真实 gzip 字节）与 `fakeRegistry({ origin, manifest, bundleBytes })`（fake `RegistryPort`），并已覆盖「篡改字节 → 回滚」；能力端点的 mock 可参照 P1 的 `hybrid-agent-sources.test.ts` 与 `desktop-capabilities-client.test.ts`（经 `fetchImpl` 注入）。
  - 主路径：`POST /sessions { source: "<id>@stable" }` → 会话创建成功、目标目录存在且含回执、列表中该源恰一条。
  - 复用与离线：第二次建会话时断言注册表**未被再次调用**；随后清凭据仍可建会话。
  - 失败不留残迹：注册表返回损坏字节 → 建会话失败且为完整性类错误、目标位置**不存在**半成品目录、此前已有安装未被破坏。
  - 未登录拒绝：无凭据时以 `sourceId@channel` 建会话 → 明确拒绝且注册表**零请求**。
  - 观察性完成态：上述四条路径均以新鲜运行证据通过。
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 4.1, 4.2, 4.3, 4.4, 5.1, 7.1_
  - _Boundary: e2e_
  - _Depends: 4.1_

- [x] 6. 边界守卫

- [x] 6.1 依赖方向守卫
  - 新增守卫用例：断言 `packages/server/src/**` 中**不存在** `@pi-clouds/registry-client` 的真实 import（注释不计）。
  - 守卫须能在将来有人误加依赖时失败（不得写成恒真的重言式）。
  - 观察性完成态：守卫用例通过；人为在包内加一行该 import 时守卫会失败（本地验证后撤销）。
  - _Requirements: 8.1_
  - _Boundary: 依赖守卫_
  - _Depends: 3.1_

## Implementation Notes

- **5.1 集成验证并入 5.2**:e2e 用例已直接覆盖「线上一路 ∪ 本机扫描一路 → 列表恰一条 + 标识为 `sourceId@channel`」与「登出后仍可解析」，且用的是真实安装链路而非 mock 装配，比原计划的集成层更强。单独再造一份包内集成用例属重复覆盖，故合并。
- **★ 单测全绿 ≠ 能跑**:`@pi-clouds/registry-client` 不是 npm 依赖，而是经 vitest / tsconfig / esbuild **三处别名**指向兄弟仓源码（`scripts/build-server.mjs:60`「首个越仓 alias…构建期 inline，运行时零依赖」）。静态引入它会让 828 个单测与 tsc 全绿、而 `pnpm dev:server`(jiti，无别名）**整个 server 启动即 MODULE_NOT_FOUND**。故安装后端必须惰性动态引入。`@/` 别名同理只在 vitest 生效。
- **错误映射不会自己发生**:`mapEngineError` 对未映射错误一律兜底 500 INTERNAL。设计里写「据既有错误映射返回」是不够的 —— 必须显式加分支，否则用户看到的是「Internal server error.」而非「需要登录」。此缺口由真机烟雾发现，补为任务 4.2。
- **块注释里别写 `*/`**:注释中写 `examples/*/pi-web.json` 会提前终结块注释，typecheck 立刻报十余个语法错。
