# Design Document — installer-registry-channel

## Overview

给 `Installer` 补一条 registry 通道，使 `/agent install <registry-id>` / `/plugin install <registry-id>`
与 CLI `pi-web install <registry-id>` 走**同一份**实现。真正的下载/解包/复核/回滚/落盘/回执一律
复用 `installFromRegistry()`（一行不改）；本设计只做三件事：

1. 在 `Installer` 里把「registry 形态」从死路（`REGISTRY_NOT_IMPLEMENTED`）改为分派到一个**注入的
   通道端口**；
2. 定义该端口，并把「清单 `kind` 是权威判据」这一裁断放在端口实现里（只有它读得到清单）；
3. 按 kind 决定落点：agent → 扫描根（端口自己落）；plugin → 端口只物化出目录，**由 `Installer`
   转交既有 plugin 通道**（两段组合）。

宿主差异（授予从哪来、落点在哪）全部由各自装配层注入，通道逻辑本身不感知宿主。

## Steering Alignment

- 依赖倒置是本仓既定手法（`RegistryPort`、`InstallSourceProvider`、`SourceResolverPlugin` 皆然）：
  接口在消费侧定义，实现由装配层注入。本设计沿用。
- `@pi-clouds/registry-client` 的分发形态（跨仓 alias）决定了**分层铁律**：它不得进 `packages/server/src`，
  且在 `lib/app/**` 只能惰性加载。本设计把通道逻辑放在 `server/cli/install/**`（该层已合法直连），
  应用层只做一层惰性委托。

## 现状（勘察结论，非假设）

| 事实 | 位置 | 对设计的约束 |
|---|---|---|
| `resolveSource()` 对 registry 形态**直接返回失败** | `source-resolver.ts:204` | `Installer` 里 `resolved.value.via === "registry"` 那段是**死代码**；分派必须在 `resolveSource` **之前**用 `classifySourceForm()` 判 |
| `installFromRegistry()` 不读 `kind`，只按 `targetDir` 落盘 | `registry-install.ts:120` | kind 判定必须由**调用方**在其之上完成 |
| `SignedManifest = Readonly<Record<string, unknown>>`（本仓不解析其结构） | `registry-port.ts` | 取 kind = 读 `manifest["kind"]` 并自行收窄，不引入 registry 侧类型 |
| `RegistryPort.resolve()` 已返回 `manifest` | 同上 | **下载前**即可拿到权威 kind → kind 不符可在零字节下载时拒绝 |
| CLI 的 registry 分支在 `server/cli/index.ts:290-300`，绕开 `Installer` | — | 收敛点即此处 |
| `registry-install-port.ts` 只给 `{dir}`，落点固定 | `lib/app/online-source/` | 不够用（缺 kind/version/落点可变）→ 需新端口；但**不改它**，选择器路径继续用它 |
| adminGate 在 `package-host-command.ts` 里、`installer` 之前 | — | 治理天然覆盖新通道，无需新增门 |

## Architecture

```
/agent install <id>                    pi-web install <id>
        │                                      │
  package-host-command                   server/cli/index.ts
   (adminGate → kindHint=agent)          (无 kindHint)
        └──────────────┬───────────────────────┘
                       ▼
              Installer.install(spec, {kindHint})
                       │
        classifySourceForm(spec) === "registry" ?
            │ 否                          │ 是
            ▼                             ▼
      既有 direct 路径            RegistryChannel.materialize(spec, {expectedKind})
      (resolveSource →                     │  ← 端口，接口在 installer.ts
       allowlist → agent/plugin)           │
                                    ┌──────┴───────┐
                             kind==="agent"   kind==="plugin"
                                    │              │
                          已落到扫描根        物化到暂存目录
                          (端口内完成)              │
                                    │       Installer 转交
                                    │    pluginChannel.install(local:<dir>)
                                    ▼              ▼
                            InstallOutcome    InstallOutcome
                             {kind:"agent"}    {kind:"plugin"}
```

**唯一一份通道逻辑**：`server/cli/install/registry-channel.ts`。两个装配层各自注入不同的
`getRegistry` 与 `agentTargetRoot`：

| 宿主 | 注入方式 | 授予来源 | agent 落点 |
|---|---|---|---|
| host 命令（web/桌面） | `lib/app/online-source/registry-channel-adapter.ts` **惰性 `import()`** 委托 | `desktopCapabilitiesClient.getSourcesGrant()` | `sourcesScanRoots[0]`（与选择器路径同根） |
| CLI | `server/cli/index.ts` 直接 import | `buildRegistryFromEnv(env)` | `registryInstallRoot(env, cwd)`（保持既有落点不变） |

## Components and Interfaces

### 1. `RegistryChannel` 端口（声明于 `server/cli/install/installer.ts`）

```ts
/** 清单权威的物化结果。agent 已落最终位置;plugin 落暂存目录待转交。 */
export interface RegistryMaterialization {
  readonly kind: Exclude<PluginKind, "component">;
  readonly sourceId: string;
  readonly version: string;
  /** agent: 最终安装目录;plugin: 待交给 plugin 通道的目录。 */
  readonly dir: string;
  readonly verifiedFiles: number;
  /** plugin 专用:转交完成后应清理的暂存根;agent 恒 undefined。 */
  readonly stagingRoot?: string;
}

export type RegistryChannelError =
  | { code: "NOT_AUTHENTICATED" }
  | { code: "GRANT_UNAVAILABLE" }
  | { code: "NOT_FOUND"; sourceId: string }
  | { code: "KIND_MISMATCH"; actual: PluginKind; expected: PluginKind }
  | { code: "KIND_COMPONENT_UNSUPPORTED" }
  | { code: "UNSUPPORTED_DISTRIBUTION"; originType: string }
  | { code: "DOWNLOAD_FAILED" }
  | { code: "EXTRACT_FAILED" }
  | { code: "INTEGRITY_MISMATCH" }
  | { code: "TARGET_OCCUPIED"; dir: string }
  | { code: "BACKEND_UNAVAILABLE" };

export interface RegistryChannel {
  materialize(
    spec: string,
    opts: { readonly expectedKind?: PluginKind },
  ): Promise<Result<RegistryMaterialization, RegistryChannelError>>;
}
```

设计裁断：

- **端口只有一个方法**。「先 describe 再 install」的两步形态会多打一次网络、且让 kind 门在调用方
  重复实现。单方法把 kind 门收进实现内部：`resolve` 拿到清单 → 比对 → 不符**立即返回，零字节下载**。
- **`expectedKind` 可缺省**。host 命令恒传（命令名即意图）；CLI 不带 `--kind` 时不传，此时清单
  说什么就是什么——这与直连来源「npm/git 缺省按 plugin」的约定不同，因为 registry 有可信清单，
  没有猜的必要（Req 2.2 明确禁止依赖任一侧缺省值）。
- **错误码不携带底层 `detail`**。沿用 `registry-install-port.ts` 已确立的凭据卫生：底层 detail 可能
  夹带含 token 的请求 URL，宁可少诊断信息（Req 5.3）。

### 2. `Installer` 的改动（`server/cli/install/installer.ts`）

```ts
// CreateInstallerOptions 新增
readonly registryChannel?: RegistryChannel;

// install() 开头新增分派(在 resolveSource 之前)
if (classifySourceForm(spec) === "registry") {
  return this.installFromRegistryChannel(spec, { kindHint, scope, cwd });
}
```

`installFromRegistryChannel` 的编排：

1. `registryChannel === undefined` → `{ code: "REGISTRY_UNAVAILABLE" }`（取代旧的
   `REGISTRY_NOT_IMPLEMENTED`，Req 5.1）。
2. `materialize(spec, { expectedKind: kindHint })`。
3. 失败 → 映射为 `InstallerError`（见下表）。
4. `kind === "agent"` → 直接返回 `{ kind:"agent", result:{ id, location: dir } }`。
   （`AgentInstallResult` 形状与 `installAgentSource` 对齐，使 host 命令的成功卡片无需分支。）
5. `kind === "plugin"` → `pluginChannel.install({ kind:"local", path: dir }, scope)` →
   成功后清理 `stagingRoot` → 返回 `{ kind:"plugin", result }`。

失败映射（新增 `InstallerErrorCode`）：

| RegistryChannelError | InstallerErrorCode | message 要点 |
|---|---|---|
| `NOT_AUTHENTICATED` / `GRANT_UNAVAILABLE` | `REGISTRY_UNAVAILABLE` | 「registry 未配置或未登录」+ 指路 |
| `BACKEND_UNAVAILABLE` | `REGISTRY_UNAVAILABLE` | 同上，附「安装后端不可解析」 |
| `KIND_MISMATCH` | `REGISTRY_KIND_MISMATCH` | 「该包是 `<actual>`，请改用 `/<actual> install`」 |
| `KIND_COMPONENT_UNSUPPORTED` | `KIND_COMPONENT_UNSUPPORTED` | 复用既有 component 指引（`pi-web add`） |
| 其余 | `REGISTRY_INSTALL_FAILED` | 携带子码（如 `INTEGRITY_MISMATCH`）便于诊断 |

`REGISTRY_NOT_IMPLEMENTED` 保留在 `ResolveError` 与 `mapResolveError`（`resolveSource` 仍会产出它），
但**经 `Installer` 已不可达**——分派在其之前。在两处加注释指明该状态，避免后人误以为还有 registry 死路。

**`uninstall` 不动**：registry 装的 agent 源落在扫描根，卸载由既有 `isAgentSourceInstalled` 探测命中
agent 通道处理；plugin 由 pi 台账管。本 spec 不引入 registry 专用卸载路径。

### 3. `registry-channel.ts`（`server/cli/install/`，唯一逻辑实现）

```ts
export interface CreateRegistryChannelOptions {
  /** 惰性取 RegistryPort;未配置/未登录 → undefined。 */
  readonly getRegistry: () => Promise<RegistryPort | undefined>;
  /** agent 落点根。 */
  readonly agentTargetRoot: string;
  /** plugin 物化的暂存根;缺省 os.tmpdir()。 */
  readonly pluginStagingRoot?: string;
}
export function createRegistryChannel(o: CreateRegistryChannelOptions): RegistryChannel;
```

流程：

1. 解析 `spec` 为 `sourceId` + **可选** `channel`。
   ★ **勘察修正**：`parseOnlineSourceRef()` 要求形如 `id@channel`，对**裸标识**
   （`acme/hello-cloud`，正是 `/agent install` 的主用法）返回 `undefined`——不能直接当解析器用。
   裁断：带 `@` → 走 `parseOnlineSourceRef`（不合法则 `NOT_FOUND`）；不带 `@` → 整串即 `sourceId`，
   `channel` 留空（`installFromRegistry` 缺省跟 registry 的默认 channel）。两条分支都用
   `isValidSourceId()` 校验字符集——该函数目前**未导出**，需在 `packages/server` 加一行
   `export`（纯加法，零行为变更）；不自写第二套字符集规则。
2. `getRegistry()` → undefined → `NOT_AUTHENTICATED`。
3. `registry.resolve(sourceId, { channel })` → 失败按 `SOURCE_ABSENT` 判 `NOT_FOUND`，其余
   `GRANT_UNAVAILABLE`（与 `registry-install-port` 的既有归一一致）。
4. **kind 门**：`readManifestKind(entry.manifest)` = 收窄 `manifest["kind"]` 到 `PluginKind`。
   - 缺失 / 非法值 → 视为 `KIND_MISMATCH`？**否**——裁断为：缺失即拒绝，返回
     `{ code:"KIND_MISMATCH", actual:"agent"… }` 语义不清。改用独立处理：缺失/非法 →
     `NOT_FOUND` 不合适、`EXTRACT_FAILED` 不合适。**裁断：新增 `MANIFEST_KIND_UNKNOWN`**，
     映射到 `REGISTRY_INSTALL_FAILED`，消息说明「清单未声明 kind，请发布方显式声明」。
     这直接落实 Req 2.2「不依赖任一侧缺省值」——两侧缺省相反，猜必错。
   - `component` → `KIND_COMPONENT_UNSUPPORTED`。
   - `expectedKind` 已给且不等 → `KIND_MISMATCH`（**此时尚未下载任何字节**）。
5. 计算 `targetDir`：
   - agent → `join(agentTargetRoot, registryInstallDirName(sourceId))`（复用既有 sanitize，与
     `pi-web update` 的目录匹配规则同源）。占位保护：已存在且无回执 → `TARGET_OCCUPIED`
     （与 `registry-install-port.ts` 既有语义一致）。
   - plugin → `join(mkdtemp(pluginStagingRoot), registryInstallDirName(sourceId))`。
6. `installFromRegistry(registry, sourceId, { channel, targetDir })` → 归一错误码。
7. 成功 → 组装 `RegistryMaterialization`（`kind` 来自步骤 4，`version`/`verifiedFiles` 来自返回值）。

回执：`installFromRegistry` 恒写 `.pi-web-registry.json`，两种 kind 都有（Req 3.4）。plugin 的回执
随目录交给 pi——**pi 是否保留该文件不在本仓控制内**，实现阶段实测并如实记录（见 Open Questions）。

### 4. 装配层

**app 层** `lib/app/online-source/registry-channel-adapter.ts`（新）：

```ts
export function createLazyRegistryChannel(o: {
  getSourcesGrant: () => Promise<SourcesGrant | undefined>;
  agentTargetRoot: string;
}): RegistryChannel {
  return {
    async materialize(spec, opts) {
      let mod, adapterMod;
      try {
        [mod, adapterMod] = await Promise.all([
          import("../../../server/cli/install/registry-channel.js"),
          import("../../../server/cli/registry/http-registry-adapter.js"),
        ]);
      } catch { return { ok:false, error:{ code:"BACKEND_UNAVAILABLE" } }; }
      const channel = mod.createRegistryChannel({
        getRegistry: async () => {
          const grant = await o.getSourcesGrant();
          return grant && new adapterMod.HttpRegistryAdapter({
            baseUrl: grant.baseUrl, consumeToken: grant.token,
          });
        },
        agentTargetRoot: o.agentTargetRoot,
      });
      return channel.materialize(spec, opts);
    },
  };
}
```

★ 惰性 `import()` 是**硬约束**：静态引入会让 `pnpm dev:server`（jiti，无跨仓 alias）启动即崩。
`RegistryChannel` 类型经 `import type` 引入（类型擦除，不产生运行时依赖）。

`pi-handler.ts` 里 `packageCommandDeps.installer` 增注入：

```ts
registryChannel: desktopCapabilitiesClient !== undefined
  ? createLazyRegistryChannel({
      getSourcesGrant: () => desktopCapabilitiesClient.getSourcesGrant(),
      agentTargetRoot: sourcesScanRoots[0] ?? defaultSourcesRoot(),
    })
  : undefined,
```

未配置云端 → `undefined` → `REGISTRY_UNAVAILABLE`（诚实降级，Req 5.1）。

⚠ **装配顺序**：`packageCommandDeps` 当前在 `desktopCapabilitiesClient` **之前**构造（第 833 行 vs
第 886 行）。`listAgentSources` 已用闭包惰性绕开同类问题，本项照同一手法（闭包内取，不在构造时求值）
或把 `packageCommandDeps` 下移。实现时取**闭包惰性**——移动构造顺序牵连面更大。

**CLI 层** `server/cli/index.ts`：`runInstall` 里那段 `classifySourceForm(source)==="registry" && registry`
的独立编排整段删除，改为在 `createDefaultInstaller(deps)` 时注入：

```ts
registryChannel: createRegistryChannel({
  getRegistry: async () => buildRegistryFromEnv(env, deps.registry),
  agentTargetRoot: registryInstallRoot(env, cwd),
}),
```

输出等效性（Req 4.2）：原分支 `complete("install", "<id>@<ver> 已装到 <dir>(复核 N 文件)")`。
`Installer` 成功路径当前打印 `${kind}: ${JSON.stringify(result)}` ——信息量不等。裁断：让
`InstallOutcome` 的 agent 分支携带 `version`/`verifiedFiles` 可选字段，CLI 在有值时打印等效文案。

## Data Models

无持久化格式变更。安装回执 `.pi-web-registry.json` 沿用既有形状（`sourceId`/`version`/`channel`/
`pinnedVersion`），由 `installFromRegistry` 写入，本设计不扩展字段。

## Error Handling

- 通道内**不抛异常**：一切失败以判别联合返回（与 install 子域既有风格一致）。
- 惰性 `import()` 失败 → `BACKEND_UNAVAILABLE`，不抛穿（否则 host 命令返回 500 而非失败卡片）。
- 凭据卫生：授予 token 只进 `Authorization`；错误归一丢弃底层 `detail`；host 命令层对 `id` 与审计
  一律用 `redactSecrets` 副本（既有机制，不变）。
- plugin 暂存目录：**`finally` 清理**，无论 `pi install` 成败。清理失败只记日志，不改变结果。

## Testing Strategy

| 层 | 覆盖 | 位置 |
|---|---|---|
| 单测 · Installer 分派 | registry 形态走通道 / 直连形态仍走原路 / 通道未注入 → `REGISTRY_UNAVAILABLE` / kind 不符 → `REGISTRY_KIND_MISMATCH` / plugin 物化后确实转交 pluginChannel（替身断言调用参数） | `test/cli/install/installer-registry.test.ts`（新） |
| 单测 · registry-channel | 清单 kind 权威（`expectedKind` 不覆盖它）/ kind 缺失 → `MANIFEST_KIND_UNKNOWN` / component 拒绝 / kind 不符时**零下载**（`downloadBundle` 替身零调用）/ 落点按 kind 分流 / `TARGET_OCCUPIED` | `test/cli/install/registry-channel.test.ts`（新），用进程内 `RegistryPort` 夹具 |
| 单测 · host 命令 | `/agent install <registry-id>` 成功卡片形状；`REGISTRY_UNAVAILABLE` 失败卡片；kind 不符卡片含指路文案 | 扩 `test/commands/package-host-command.test.ts` |
| 单测 · CLI | `pi-web install <registry-id>` 经注入 `Installer` 完成，输出含 id@version/落点/复核数；直连路径不变 | 扩既有 CLI install 测试 |
| e2e | 真实 HTTP：假 registry 提供 resolve + bundle 下载；`/agent install acme/hello-cloud` → 成功卡片 → 随后 `/agent list` 能看到它 | 改写 `e2e/browser/registry-agent-sources.e2e.ts` 末例（Req 7.3） |

**e2e 夹具扩展**（`e2e/fixtures/fake-cloud-server.mjs`）需新增两个端点，路径取自
`registry-http-client.ts`（`encodePath` 对每段 `encodeURIComponent`，故 `acme/hello-cloud` →
`sources/acme%2Fhello-cloud/...`）：

- `GET /registry/sources/:id/resolve?channel=...` → `{ sourceId, version, origin:{type:"oss",bundle}, manifest, ... }`
  manifest 含 `kind:"agent"` 与 `entry:{path,integrity}`。
- `GET /registry/sources/:id/bundle?key=...` → 一个**真实 tgz 字节流**，其 `entry` 文件的 sha384 与
  manifest 中的 integrity 一致（否则复核必失败）。夹具启动时用 `tar` 现场打一个最小 agent 目录并算
  integrity，保证两者永远自洽，而不是硬编码两个必然漂移的常量。

## Open Questions（已由实测裁定 —— 结论见 research.md）

1. ~~`pi install <本地目录>` 是拷贝还是链接？~~ → **只记路径，不拷贝内容**（写进
   `settings.json#plugins[]`）。故 plugin 落点改为**长期位置** `<agentDir>/registry-plugins/<dir>`
   （仍在 agent 扫描根之外），**取消**「转交后清理」——原设计的暂存方案会让插件失效。
   已加回归护栏：转交成功后断言物化目录仍存在。
2. ~~plugin 的回执是否随目录被 pi 保留？~~ → 正因 pi 不拷贝，回执随目录长期存在，
   Req 3.4 对两种 kind 一致达成，无需额外处理。
3. ~~`ExtSource` 的 local 形状~~ —— 已核实：`ext.types.ts:41` `{ readonly kind:"local"; readonly path:string }`，
   转交代码可直接构造。
