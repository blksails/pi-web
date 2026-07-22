# Implementation Plan

> 垂直切片:把 `ConfigCodec` 改建到 `LocalWorkspace.user` 之上,行为逐字节零变化。
> 所有任务限定在 `packages/server/src/config/config-codec.ts` 与其单测 + 回归验证。
> **范围铁律(R7)**:不触碰 `mcp-config-routes.ts` / `extensions-config-routes.ts` / `source-settings-codec.ts`;不改 `LocalWorkspace` 本体。遇耦合必须触碰上述文件 → 停止并回报边界冲突。
> 强耦合于同一文件同一类,**串行执行,无 (P)**。

- [x] 1. 改建 `ConfigCodec` 内部实现到 `LocalWorkspace.user`

- [x] 1.1 构造持有 `WorkspaceNamespace` + `load` 错误分区复刻(收紧①)
  - 构造改为 `this.ns = createLocalWorkspaceNamespace(rootDir ?? resolveDefaultRoot())`(D1/D5:**不传** `maxValueBytes`,取缺省 1 MiB 安全网;刻意不经 `resolveWorkspaceValueLimit(env)`,以免为 config 域引入「非法 env → 构造抛错」的新失败模式)。保留 `resolveDefaultRoot()` 与既有 `rootDir` 注入语义。
  - `load(domain)` 改为委托 `this.ns.readJson(`${domain}.json`)`,并**逐分区复刻** `ConfigCodec` 既有语义:ENOENT→`{}`(由 `readJson` 自身归零);catch `err.code === "corrupt"` → 返回 `{}` 并 `log.warn`(带 domain);其余(`io` 等)→ **rethrow**(复刻 `config-codec.ts:78` 的 throw,**不**降级)。
  - 错误判别一律用 `err.code`,禁用 `instanceof`(契约 §3.6)。
  - 移除 `import { promises as fs }`;`load` 不再直接 `node:fs`。
  - 观察性完成态:`load` 对缺文件/损坏/非对象返回 `{}`、对 io 错误 rethrow;`node:fs` 的 `readFile` 从 `load` 消失。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 3.1, 3.2, 3.3, 3.4, 6.1_

- [x] 1.2 `save` 改为 read-modify-write + `writeJson(merge:false)`,删私有 `deepMerge`(D3/D4)
  - `save(domain, values, opts)` 改为:`const next = opts.merge === false ? values : deepMergeJson(await this.load(domain), values);` 然后 `await this.ns.writeJson(`${domain}.json`, next, { merge: false })`(D3:底层恒 `merge:false`,不触发二次 read;逐字节复刻 `config-codec.ts:108-113`)。
  - 删除文件内私有 `deepMerge`(`:25-49`),合并语义收敛到 `deepMergeJson`(R5)。`source-settings-codec.ts` 的第三份副本本期不动(记入 Implementation Notes)。
  - 移除 `save` 对 `fs.mkdir`/`fs.writeFile` 的直接调用(目录创建 + 原子写由 `writeJson` 承接,D6);落盘字节须仍为 `JSON.stringify(next, null, 2)` 无尾换行、文件 0600 / 目录 0700。
  - 保留 `ConfigCodec` 类名与公开签名(构造/`load`/`save`)不变,消费方零改动(R6);`config/index.ts` barrel 导出名不变。
  - 观察性完成态:`save(merge:false)` 整值覆盖、`save(默认/merge:true)` 深合并且损坏磁盘以 `{}` 为基底;`config-codec.ts` 内不再出现 `node:fs` 与私有 `deepMerge`;`tsc` 零错误。
  - _Requirements: 2.2, 2.3, 2.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 6.2, 6.3_
  - _Depends: 1.1_

- [x] 2. 行为零变化守卫测试

- [x] 2.1 既有单测全绿 + 补三处收紧守卫用例(变异测试判据)
  - 确认 `packages/server/test/config/config-codec.test.ts` 既有断言(缺文件→`{}`、roundtrip、未知字段保留 merge、0600 权限、目录递归、多次 save 累积)**一条不改、全部通过**;仅允许因内部改建做等价的 setup 调整,不放宽/不删断言。
  - 新增守卫用例(每条须能被一个具体错误实现杀死):① 磁盘非法 JSON / 数组 / 标量 → `load` 返回 `{}`(杀「删掉 corrupt catch」);② `load` 遇模拟 io 错误(非 corrupt)→ **rethrow**(杀「把 io 也降级为 {}」);③ 磁盘损坏时 `save(merge:true)` 以 `{}` 为基底合并、不抛(杀「writeJson 用 merge:true 让内部 read 抛 corrupt」);④ `save` 后原始文件文本 = `JSON.stringify(x,null,2)` 无尾换行、权限 0600(杀字节/权限漂移)。
  - 观察性完成态:`vitest run test/config/config-codec.test.ts` 真实计数全绿(非 `no tests`、非 `Errors N error`);四条守卫用例存在且各自有对应变异体判据。
  - _Requirements: 2.4, 3.1, 3.2, 5.2, 2.5_
  - _Depends: 1.2_

- [x] 3. 垂直切片回归验证(R8)

- [x] 3.1 全量单测 + typecheck + config e2e,fresh-evidence 落盘
  - 运行 `packages/server` 全量单测并全绿(真实测试计数;防 vitest 假绿:`no tests` 或输出含 `Errors N error` 一律不算通过)。
  - 运行 `packages/server` `typecheck` 零错误。
  - 运行 config e2e:`e2e/node/config-domains.e2e.test.ts`(以及受影响的 `logging-config`/`sandbox-config`/`config-routes` 路由测试)并全绿 —— 这是 goal 要求的 e2e 环节。
  - 观察性完成态:三项命令的**真实计数 + 时间戳**记录于 `.kiro/specs/host-contract-config-on-workspace/verification/`(命令原文 + pass/fail 数 + `sha`/时间),不得以「应当通过」替代实际运行。
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Depends: 2.1_

## Implementation Notes

- **等价映射的核心决策(D3)**:`ConfigCodec.save` 缺省 `merge=true`,原实现是 `deepMerge(this.load(domain), values)` 后覆盖写——`this.load` 对损坏磁盘返回 `{}`。若改建时图省事直接 `writeJson(key, values, { merge: opts.merge })` 让 workspace 内部 merge,则 `merge:true` 遇损坏磁盘时 `writeJson.readAt` 抛 `WorkspaceCorruptError`,与原「损坏当空基底」**不等价**。解法:在 `ConfigCodec` 层做 read-modify-write(`deepMergeJson(await this.load(domain), values)`),底层 `writeJson` **恒 `{merge:false}`**——corrupt 降级只在 `load` 统一处理,底层整值写不触发二次 read。reviewer 亲手把底层改 `merge:true` 验证守卫转红(报 `WorkspaceCorruptError`)。

- **D5 决策修正(实现中改的,已同步 design/tasks)**:原设计写「构造经 `resolveWorkspaceValueLimit(process.env)` 传上限」。实现时发现该函数对**非法 env 抛 `WorkspaceConfigError`**,接入会给 config 域引入「非法 env → 构造抛错」的新失败模式,偏离行为零变化(`ConfigCodec` 原本与该 env 无关)。改为**不传 `maxValueBytes`**,取 `createLocalWorkspaceNamespace` 缺省 1 MiB 安全网。代价:config 上限固定 1 MiB 不随 env 变——但正常 config 远小于此,不可观测。

- **`load` 逐分区复刻(D2)**:`readJson` 自身把 ENOENT/ENOTDIR/EISDIR 归为 `{}`;`ConfigCodec.load` 只需 catch `code === "corrupt"`→`{}`+`logger.warn`,其余(`io`)rethrow(复刻原 `config-codec.ts:78` 对非 ENOENT 读错的 throw)。按 `err.code` 判别,**不用 `instanceof`**(契约 §3.6)。error-partition 测试用**非 WorkspaceError 实例**的普通对象 stub 精确证明按 code。

- **类型阻抗几乎为零**:`JsonObject = Readonly<Record<string,unknown>>`,`Record<string,unknown>` 可流入 `deepMergeJson`/`writeJson` 的 `JsonObject` 参数(mutable→readonly 安全),`readJson` 返回可作 `Record<string,unknown>` 返回值。**无需任何类型断言**,`ConfigCodec` 公开签名(`Record<string,unknown>`)不变。

- **merge 收敛(R5,诚实边界)**:`config-codec.ts` 私有 `deepMerge` 已删、收敛到 `deepMergeJson`。全仓仍剩**第三份** `source-settings-codec.ts:45-69` 的独立副本 —— 属 Out of scope,本期未动,待后续 spec 收敛。**不制造「已全部收敛」的假象。**

- **module-settings-agent.e2e 的 2 failed 是既有的**:失败点为 agent route `entities` declaration 握手超时(不经 ConfigCodec)。stash 本 spec 改动回 HEAD 基线跑 → 同样 2 failed | 8 passed,逐一致 → 既有问题,非本 spec 引入。对照实验证据见 `verification/README.md`。

- **验证真实性**:全量 2165 passed | 17 skipped(rc=0);typecheck rc=0;config-domains.e2e + source-settings-endpoint.e2e PASS。防 vitest 假绿:全程看真实测试计数。
