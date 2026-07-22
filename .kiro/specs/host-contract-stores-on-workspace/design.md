# Design Document

## Overview

**Purpose**: 把契约 §3.7 表中「其余 store」的默认实现改建到 M1 的 `LocalWorkspace` 之上(M4)。承接 M2(ConfigStore 切片验证)、M3(装配经 compose)。每个 store **保留类型化接口**,内部读写改建到 `createLocalWorkspaceNamespace(...)` 命名空间(与 M2 的 `ConfigCodec` 同模式),行为零变化。

**Users**: 各 store 的既有调用方(路由、runner)不感知;云端(C1)实现 1 个 `TenantWorkspace` 后可据同一形态收敛这些 store(见「云端白拿」边界)。

**Impact**: **4 个** store 内部改建到 Workspace(FavoritesStore / SessionFavoritesStore / per-source settings / sources 注册表);**trust store 本期不迁**(D0 拍板,记录契约张力)。per-source 的第三份 `deepMerge` 私有副本收敛到 `deepMergeJson`(M2 已收敛 config 那份)。

### Goals
- 4 个 store 经 `LocalWorkspace` 命名空间读写,键按 §3.7 表,**行为零变化**。
- Workspace 三处收紧(损坏抛 corrupt、1 MiB 上限、原子写)在各 store 层等价处置(catch 降级保静默、正常路径不触上限、原子写增强)。
- per-source `deepMerge` 收敛到 `deepMergeJson`(全仓 merge 副本从 2 减到 1)。
- trust store 的迁移张力被显式拍板与记录,不默默破坏 pi CLI 字节契约。

### Non-Goals
- **不迁 trust store**(D0:与 pi CLI 的跨进程字节契约 + 同步 API,Workspace 迁移会破坏兼容,风险 > 收益)。
- **不迁** AttachmentRegistryPort(已可插拔后端,多文件形态)、SessionEntryStore(§3.9 语义正交)。
- **不改** M1 冻结面(`LocalWorkspace` / `deepMergeJson` / 错误类型 / 键校验)。
- **不做** 云端白拿所需的「注入抽象 Workspace 端口」统一改造 —— M4 沿用 M2 的「store 内部建 `LocalWorkspaceNamespace`」形态(R1.1),云端注入统一是后续工作项(见边界)。

## Boundary Commitments

### This Spec Owns
- `favorites-store.ts` / `session-favorites-store.ts` / `source-settings-codec.ts` / `registry-provider.ts` 四个 store 的内部改建。
- 这 4 个 store 的行为零变化回归(各 store 单测 + 相关路由/e2e)。
- trust store 的不迁决策与契约张力记录。

### Out of Boundary
- trust store(`FsProjectTrustStore`)—— 本期不改(D0)。
- AttachmentRegistryPort / SessionEntryStore —— 语义/形态不合。
- M1 `workspace/*` 冻结面 —— 只消费。
- 各 store 的**业务逻辑**(zod 校验、去重、sourceKey 校验)—— 保持不变,只换底层读写。
- 云端 `TenantWorkspace` 注入统一 —— 后续。

### Allowed Dependencies
- `workspace/index.js`:`createLocalWorkspaceNamespace`、`deepMergeJson`、`WorkspaceCorruptError`(按 `code` 判别)。
- 依赖方向:各 store → `workspace`(单向)。不反向。

### Revalidation Triggers
- §3.7 表键名/命名空间变化 → 触发对应 store 与云端重新核对。
- `deepMergeJson` 语义变化 → 触发 per-source 合并行为核对。
- trust store 若后续决定迁移 → 须重开该端口的契约张力评审。

## Existing Architecture Analysis(现状,Explore 已证)

| store | 定义 | 现状路径 | 数据形态 | merge | 损坏处理 | 原子写 |
|---|---|---|---|---|---|---|
| FavoritesStore | `agent-source-list/favorites-store.ts:44` `createFavoritesStore({filePath})` | `<agentDir>/agent-source-favorites.json` | `{favorites:[]}` 整值 | 无(全量替换) | 静默 `[]` | ✅ temp+rename |
| SessionFavoritesStore | `session-actions/session-favorites-store.ts:53` `createSessionFavoritesStore({filePath})` | `<agentDir>/session-favorites.json` | `{sessionIds:[]}` 整值 | 无 | 静默 `[]` | ✅ |
| per-source settings | `config/source-settings-codec.ts:79` `SourceSettingsCodec` | user:`<agentDir>/sources/<k>/settings.json` · project:`<cwd>/.pi/source-settings/<k>.json` | 整值对象/按 sourceKey 分文件 | **第三份私有 deepMerge**(:45) | 静默 `{}` | ❌ 直接 writeFile |
| sources 注册表 | `agent-source-list/registry-provider.ts:93` `createRegistrySourceProvider({registryPath})` | `PI_WEB_SOURCES_REGISTRY ?? <agentDir>/sources.json` | `{sources:[]}` 整值 | 无(**只读**) | 静默 `[]` | N/A |

**Workspace 相对现状的三处收紧**(同 M2):损坏 JSON → `readJson` 抛 `WorkspaceCorruptError`(现状静默);`writeJson` 1 MiB 上限(现状无);temp+rename 原子写(FavoritesStore/SessionFavoritesStore 已有,per-source 是增强)。

## Architecture

### 关键设计决策

**D0 — trust store 本期不迁(拍板 B)**
`FsProjectTrustStore`(`trust/trust-store.ts`)有三处使 Workspace 迁移会破坏「行为零变化」或跨进程兼容:
1. **同步 API**(`get/set` 用 `readFileSync/writeFileSync`);Workspace 是 async。迁移须 async 化,牵连 `project-trust-policy.ts` 及调用链 —— 非纯内部改建。
2. **与 pi CLI 共享 `~/.pi/agent/trust.json` 的字节格式契约**(key 排序 + 末尾 `\n`,`trust-store.ts:111`;文件头注释明写「刻意与 pi CLI 共享」)。`writeJson` 固定 2-space 无末尾换行,**无法定制序列化**(改 Workspace 违反 R7 冻结面),会破坏 pi CLI 读取。
3. **损坏 → 抛错**(非静默,安全语义)+ 键名 `trust.json` vs 契约 `trust-store.json` + 用 `PI_CODING_AGENT_DIR`。
**结论**:trust 与 pi CLI 的跨进程字节契约是安全敏感的真实障碍,强迁风险 > 收益。**本期不迁**,记录为契约张力(§7.5:发现障碍回契约而非打补丁)。契约「五个」据此收敛为 M4 迁 4 个 + trust 待契约层面重新决策(如:云端 trust 是否需要、是否值得为它引入可定制序列化的 Workspace 变体)。

**D1 — 迁移模式:store 内部 `createLocalWorkspaceNamespace` + 固定键(与 M2 一致)**
每个 store 的工厂改为接受 **root**(user 用 agentDir、project 用 `<cwd>/.pi`),内部 `createLocalWorkspaceNamespace(root)` + 固定键(§3.7 表),读写委托 namespace。消费方从「传 filePath」等价改写为「传 root/agentDir」(store 内部拼键)。业务逻辑(zod/去重/sourceKey 校验)不动。
> 沿用 M2 的 X 形态(store 内建 LocalWorkspace),不做云端白拿的注入抽象——R1.1 已定此形态;云端白拿的注入统一属后续(M2+M4 一起改),本期诚实记录。

**D2 — FavoritesStore / D3 — SessionFavoritesStore(最干净)**
```
list(): try { const o = await ns.readJson("agent-source-favorites.json"); return parse(o.favorites) } catch(e){ if code==="corrupt" return []; throw }
set(favs): await ns.writeJson("agent-source-favorites.json", { favorites: favs }, { merge:false })
```
损坏 → catch `corrupt` → `[]`(保静默降级);全量替换用 `writeJson(merge:false)`;原子写白拿(现状已原子)。SessionFavoritesStore 同构(键 `session-favorites.json`、`{sessionIds}`)。

**D4 — per-source settings(双命名空间 + deepMerge 收敛)**
- scope="source" → `createLocalWorkspaceNamespace(agentDir)`,键 `sources/<sourceKey>/settings.json`;scope="project" → `createLocalWorkspaceNamespace(join(cwd,".pi"))`,键 `source-settings/<sourceKey>.json`。两键与现状落盘路径逐一致。
- `load` catch `corrupt` → `{}`(保静默);`save` read-modify-write 在本层(复用 `deepMergeJson`)、底层 `writeJson(merge:false)`(同 M2 D3,避免损坏磁盘二次 read 抛 corrupt)。
- **删除内部第三份私有 `deepMerge`**(`:45-69`),收敛到 `deepMergeJson`(R4.2;语义已证等价)。
- `isSourceKey` 校验保留(路径安全)。

**D5 — sources 注册表(只读 + env 覆盖处置)**
- `list()` 改经 `createLocalWorkspaceNamespace(agentDir).readJson("sources.json")`,catch `corrupt` → `[]`;坏条目逐条跳过不变。
- **env 覆盖张力(R5.3)**:现状 `registryPath = PI_WEB_SOURCES_REGISTRY ?? <agentDir>/sources.json`。迁到固定 workspace 键 `sources.json` 会丢 `PI_WEB_SOURCES_REGISTRY` 覆盖能力。**处置**:保留工厂接受可选 `registryPath` 覆盖 —— 未设 env 时用 `createLocalWorkspaceNamespace(agentDir)` 键 `sources.json`(= `<agentDir>/sources.json`,与现状默认等价);设 env 时沿用旧 fs 直读该路径(env 覆盖是运维逃生舱,非 workspace 键)。装配层判定不变。这样默认路径经 workspace、env 覆盖保留,行为零变化。

## File Structure Plan

### Modified Files
- `packages/server/src/agent-source-list/favorites-store.ts` — 内部改建 workspace namespace(D2)。
- `packages/server/src/session-actions/session-favorites-store.ts` — 同上(D3)。
- `packages/server/src/config/source-settings-codec.ts` — 双命名空间改建 + 删私有 deepMerge(D4)。
- `packages/server/src/agent-source-list/registry-provider.ts` — 只读改建 + env 覆盖处置(D5)。
- 各 store 的**消费方**(`favorites-routes.ts` / `session-actions-routes.ts` / `source-settings-routes.ts` + runner wiring / `agent-sources-routes.ts`)— 仅「传 filePath → 传 agentDir/root」的等价构造改写。

### Unchanged (显式声明)
- `trust/trust-store.ts`(D0 不迁)、`attachment/*`(排除)、`session-store/*`(排除)、`workspace/*`(M1 冻结)。
- 各 store 的业务逻辑(zod/去重/sourceKey/坏条目跳过)。

## Requirements Traceability

| Requirement | 实现要素 |
|---|---|
| 1.1–1.4 | D1 迁移模式;各 store workspace namespace + 固定键 |
| 2.1–2.4 | D2 FavoritesStore |
| 3.1–3.4 | D3 SessionFavoritesStore |
| 4.1–4.5 | D4 per-source(双命名空间 + deepMerge 收敛 + catch corrupt) |
| 5.1–5.4 | D5 sources(只读 + env 覆盖处置) |
| 6.1–6.3 | D0 trust=B(不迁 + 记录张力) |
| 7.1–7.4 | 范围隔离;不改 M1/attachment/session-store |
| 8.1–8.4 | 回归 + fresh-evidence |

## Error Handling

统一「损坏 JSON 降级」分区(同 M2,按 `err.code === "corrupt"` 判别,不用 instanceof):
- FavoritesStore / SessionFavoritesStore / sources:corrupt → 返回 `[]`(保既有静默)。
- per-source:corrupt → 返回 `{}`。
- io 等非 corrupt:rethrow(复刻现状对非缺文件错误的处置)。
- 各 store 的 `list`/`load` 均在本层 catch corrupt;`writeJson(merge:false)` 不触发内部 read 故不产 corrupt;1 MiB 上限正常路径不可达(favorites/sources/settings 值远小于)。

## Testing Strategy

### Unit(行为零变化基线,每 store)
- 既有单测**不改断言全绿**:`favorites-store.test.ts`、`session-favorites-store.test.ts`、`source-settings-codec.test.ts`、`registry-provider.test.ts`。
- 每 store 补收紧守卫(参照 M2 的 `config-codec.error-partition.test.ts`):① 磁盘损坏 JSON → list/load 返回 `[]`/`{}`(catch corrupt);② 落盘字节 = `JSON.stringify(x,null,2)` 无尾换行、权限 0600;③ per-source:损坏磁盘时 save(merge) 以空为基底不抛(D4)。每条附变异判据。
- per-source:`deepMergeJson` 合并结果与迁移前逐项等价(删私有副本后)。

### Integration / E2E
- `source-settings-routes.test.ts` + `e2e/node/source-settings-endpoint.e2e.test.ts`(经真实路由)全绿。
- `favorites-routes.test.ts` / `session-actions-routes.test.ts` 全绿。
- 受影响 node e2e 全绿或既有失败基线对照。

### 回归验证(R8,fresh-evidence)
- `packages/server` 全量单测(真实计数,防假绿)+ typecheck 0 + 受影响 e2e;命令+计数+时间戳落 `verification/`。
