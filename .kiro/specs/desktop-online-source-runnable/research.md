# Research: desktop-online-source-runnable

## Summary

Light discovery（Extension 型特性）。核心结论：**本特性几乎不需要新建机制，只需接线** —— 安装链路、解析扩展点、装配 wrapper 三者都已存在且互相咬合，缺的只是把它们连起来，外加解决一处 P1 遗留的列表重复。

三个决定设计形态的发现：

1. **`SourceResolverPlugin` 是为此预留的一等扩展点，且生产侧至今无人实现**。
2. **安装实现已完备**（`installFromRegistry`），且其所需凭据形态与 P1 的 grant 精确对齐。
3. **装配侧已有 resolver wrapper**（`makeRealResolver`），扩展它即可，无需新造间接层。

## Research Log

### 线上源如何进入解析链路

`packages/server/src/agent-source/source-type.ts:96` 的 `identify()` 在最前面就检查：

```ts
if (opts.sourceResolver && opts.sourceResolver.canHandle(source)) {
  return { kind: "plugin", plugin: opts.sourceResolver, source };
}
```

注释写明「插件优先于内置分发（Req 8.1）」——**优先级高于 `builtin:`、`git:`、本地目录判定**。接口（`types.ts:81-84`）：

```ts
export interface SourceResolverPlugin {
  canHandle(source: string): boolean;
  resolve(source: string, opts: ResolveOptions): Promise<{ localDir: string }>;
}
```

`resolver.ts:86` 处 `identified.plugin.resolve(...)` 取得 `localDir` 后，**后续流程与本地目录源完全相同**（入口探测 → 模式判定 → spawnSpec）。

**含义**：这正是 brief 里「装完即普通本地源」策略所需要的接缝，且是既有设计有意预留的。全仓 grep 显示 `sourceResolver:` **只出现在两个测试文件**中，生产侧无实现 —— 即这是一个已设计、已测试、但尚未被使用的扩展点。

**推翻的初始假设**：我原本预期需要在 `create-session.ts` 里加分支或包装 resolver（装饰器）。实际不需要 —— `create-session.ts:28-34` 的 resolver 本就是注入依赖，而 `sourceResolver` 又是 resolve 选项，两层都无需改动。

### 安装能力的现状与凭据形态

`server/cli/install/registry-install.ts:120` `installFromRegistry(port, sourceId, { channel, version, targetDir })`：resolve → 经 registry 代理下载（安装侧不接触 OSS 凭据）→ staging 解包 → sha384 逐项完整性复核 → 失败回滚 / 成功原子移入 → 写回执 `.pi-web-registry.json`（记 `sourceId`/`version`/`channel`/`pinnedVersion`）。只处理 `oss` origin。

`server/cli/registry/http-registry-adapter.ts` 的 `HttpRegistryAdapter` 自持 baseUrl + **消费面 `consumeToken`**（`resolve` 用），token 不外泄给上层。

**含义**：P1 的 `DesktopCapabilitiesClient.getSourcesGrant() → { baseUrl, token }` 可直接构造消费面 adapter。Req 4.1/4.2/7.1/7.3（分阶段失败、不留残迹、完整性校验、不接触对象存储凭据）全部由既有实现满足，本特性**不得自行实现落盘**，只做编排。

### 装后列表为何必然重复（Req 3 的根因）

| 来源 | `id` | `source` | `origin` |
|---|---|---|---|
| 线上（`registry-http-provider.ts:82-86`） | `sourceId` | `sourceId@channel` | `registry` |
| 装完后扫描（`scan-provider.ts:151-155`） | 绝对路径 | 绝对路径 | `scan` |

`composite-provider.ts:56` 按 `r.id` 去重（`byId.has(r.id)`）。两者 `id` 不同 ⇒ **去重必然命不中，同一 agent 出现两条**。

**含义**：必须让已安装目录的扫描记录「认领」它的线上身份。回执里正好记着 `sourceId` 与 `channel`，构成归一所需的全部信息。

### 标识稳定性对归一方案的约束

Req 3.2 要求「可提交标识稳定，使调用方无需分辨来源即可创建会话」。若归一只改 `id` 而 `source` 仍为绝对路径，则登录态下用户提交 `sourceId@channel`、登出后提交绝对路径 —— **标识不稳定，违反 3.2**。

**含义**：归一必须同时覆盖 `id` 与 `source`，令已安装的线上源在两种登录态下都以 `sourceId@channel` 作为可提交标识；随之要求解析链路能**离线**把 `sourceId@channel` 映射回已装目录（这也正是 Req 1.3 与 2.2 所需）。

### 装配侧的注入通道

`lib/app/pi-handler.ts:937` 已注入 `resolver: makeRealResolver(config)`；该 wrapper（`:169`）本就负责把 `runnerEntry`/`piCliEntry`/`agentDir` 补进解析选项。`create-session.ts:90/122` 两处调用（新建与恢复）共用同一注入 resolver。

**含义**：把 `sourceResolver` 加进这个既有 wrapper 转发的选项即可，两条调用路径同时覆盖，无需新增间接层。

## Architecture Pattern Evaluation

| 方案 | 评估 | 结论 |
|---|---|---|
| **A. 实现 `SourceResolverPlugin` 注入** | 命中既有一等扩展点；`packages/server` 零改动（解析侧）；新建与恢复两条路径自动覆盖；registry-client 留在应用层 | **采用** |
| B. 在 `create-session.ts` 加线上源分支 | 需改 `packages/server/src`，且会把「先装后跑」的编排责任塞进 HTTP 路由层，违反其「不 spawn、不解析」的自述职责 | 否决 |
| C. 装饰注入的 resolver（外层包一层） | 可行但多一层间接；既然 `sourceResolver` 就是为此设计的选项，绕开它反而更晦涩 | 否决 |
| D. 不安装，直接从注册表流式运行 | 与既定策略冲突（离线不可用），且需为云端源新造 spawn 通路 | 否决（discovery 已排除） |

## Design Decisions

### Decision: 以 `SourceResolverPlugin` 为唯一接入点

**决定**：实现一个 `canHandle` 识别 `sourceId@channel` 形态的 `SourceResolverPlugin`，由装配层注入，其 `resolve()` 返回已安装目录。

**理由**：这是既有架构明确预留、且优先级已定义好的扩展点；接入后线上源在解析链路下游与本地目录源**完全同构**，天然满足 Req 8.1（既有行为不回归）与 Req 1.1（按本地目录源方式建会话）。

**代价**：`canHandle` 的形态判别必须足够严格 —— 它优先于 `git:`/本地目录判定，误判会劫持本地源解析。判别需排除绝对/相对路径与 URL 形态，并要求 `@channel` 段存在。

### Decision: 依赖方向 —— 判别与索引下沉，安装留在应用层

**决定**：
- `packages/server/src`：回执读取、已装索引、扫描记录归一、`sourceId@channel` 形态判别 —— **纯 fs + 字符串解析，不引入 `@pi-clouds/registry-client`**。
- 应用层（`lib/app/` + `server/cli/`）：真正的安装动作（需 registry-client）。
- 两者经 `SourceResolverPlugin` 与一个可注入的安装端口对接（依赖倒置）。

**理由**：直接回应 P1 的范围铁律「registry-client 不得进入 `packages/server/src`」。回执只是一个 JSON 文件，读它不需要注册表客户端；安装才需要。按此切分，铁律无需破例，且与 P1 自己用的 `getGrant` 注入模式一致。

**代价**：回执的字段形状在两侧各有一份认知。缓解：`packages/server` 侧只读取它真正需要的两个字段（`sourceId`、`channel`），并容忍未知字段与缺字段（缺则视为非本通道目录，退回原有绝对路径语义）。

### Decision: 归一同时覆盖 `id` 与 `source`

**决定**：扫描到的目录若含合法回执，其记录的 `id` 归一为 `sourceId`、`source` 归一为 `sourceId@channel`；`origin` 仍为 `scan`。

**理由**：`id` 归一使去重命中（Req 3.1）；`source` 归一使可提交标识在登录/登出两态下一致（Req 3.2）。`origin` 保持 `scan` 则排序语义不变（Req 3.3、Req 8.3），且 composite 的「registry 路在前」使线上元数据（更新的 displayName）在登录态下自然胜出。

**代价**：解析链路必须能离线把 `sourceId@channel` 映射回目录，否则登出后该条目不可用 —— 这由 `SourceResolverPlugin` 先查已装索引、查不到才要求授予来满足（Req 1.3、2.2）。

## Risks & Mitigations

| 风险 | 影响 | 缓解 |
|---|---|---|
| `canHandle` 误判劫持本地源 | 高 —— 本地目录源无法解析（Req 8.1 回归） | 判别严格化：排除路径分隔符开头、`.`/`..` 开头、含 scheme（`://`）、`git:`/`builtin:` 前缀；要求恰有一个 `@` 且其后非空。以既有本地源用例作回归护栏 |
| 回执字段漂移（`cli-package-commands` 侧改格式） | 中 —— 归一失效导致列表重复回归 | `packages/server` 侧只依赖 `sourceId`/`channel` 两个字段；缺失即视为非本通道目录并保持原语义（降级而非崩溃）；在 Revalidation Triggers 中登记 |
| 同步安装导致建会话请求久等 | 中 —— 大包下载时前端观感卡死 | 用户已拍板同步形态；本特性只保证失败可诊断与不留残迹，进度形态明确划出范围（后续 spec） |
| 目标目录命名与既有安装冲突 | 中 —— 覆盖用户手放的同名目录 | 目录名由 `sourceId` 派生且需文件系统安全；落盘沿用既有原子替换语义；对「目标位置已有非本通道安装」的情形须明确失败而非静默覆盖（Req 4.3） |
| `installFromRegistry` 位于 CLI 层，签名为 CLI 用途所定 | 低 —— 复用时可能需调整其签名 | 若需调整须回头更新 `cli-package-commands` spec（已在 brief 的 Adjacent 中登记） |

## References

- `packages/server/src/agent-source/source-type.ts:96-107`（`identify()` 的 plugin 优先分支）
- `packages/server/src/agent-source/types.ts:81-84, 102`（`SourceResolverPlugin` 与 `ResolveOptions.sourceResolver`）
- `packages/server/src/agent-source/resolver.ts:86`（plugin 解析取 `localDir`）
- `packages/server/src/agent-source-list/scan-provider.ts:151-155`（扫描记录构造）
- `packages/server/src/agent-source-list/registry-http-provider.ts:82-86`（线上记录投影）
- `packages/server/src/agent-source-list/composite-provider.ts:56`（按 `id` 去重）
- `server/cli/install/registry-install.ts:120`（`installFromRegistry`）
- `server/cli/registry/http-registry-adapter.ts:29-31`（消费面 token）
- `lib/app/pi-handler.ts:169, 937`（`makeRealResolver` 与注入点）
- 上游 spec：`desktop-hybrid-agent-sources`（P1，`implemented`）、`cli-package-commands`、`agent-source-resolver`
