# Design Document — publish-host-command

## Overview

给 `/agent` 与 `/plugin` 各加一个 `publish` 子动作，产出**发布前预览**：复用既有 `compile()`
做编译与校验，把「将发布什么 + 全部告警」渲染成卡片。不签名、不上传、不登记、零凭据、零外部写。

三处需要新东西，其余全是接线：

1. **预览结果的数据形状与渲染器**（`InstallResultData` 装不下，见决策 1）；
2. **卡片类型的选择机制**（当前按命令名查表，一个命令只能有一种卡片，见决策 2）；
3. **补全候选的判据**（publish 要含发布清单的目录，install 要含入口/包描述，见决策 4）。

## Steering Alignment

- 「清单里的 `kind` 是权威」沿用 `installer-registry-channel` 已确立的心智，同一套拒绝 + 指路。
- 端口化枚举（`InstallSourceProvider`）沿用 `agent-plugin-commands` 的既有抽象，只做参数化，
  不新增第二套扫描实现。
- 凭据卫生、`adminGate`、审计沿用 `package-host-command` 既有门控顺序，不新开旁路。

## 现状（勘察结论）

| 事实 | 位置 | 对设计的约束 |
|---|---|---|
| `compile(packageDir)` 独立可用，只读包目录 | `manifest-compiler.ts:155` | 预览可完全建在它之上，无需 `publish()` 编排器 |
| `CompileError` 有 8 个分支，其中 7 个与密钥无关 | `manifest-compiler.ts:99-113` | 预览能覆盖绝大多数「会烧版本号」的失败 |
| `sign()` 需 `{publicKey, privateKey}` JSON，`publisher` = 公钥指纹 | `:423`, `:459` | 本轮不碰；预览给不出 publisher/签名 |
| `publish()` 编排器**恒签名**（`opts.keyPath` 必填） | `publish-orchestrator.ts:19,70` | **不能复用它做预览** —— 会强制引入私钥 |
| 卡片类型按**命令名**查表 | `pi-chat.tsx:981` | 同一命令的不同子动作无法用不同卡片 → 决策 2 |
| `ScanInstallSourceProvider` 的 `MARKERS` 与 `insertText` 前缀是硬编码常量 | `scan-provider.ts:21,~90` | 参数化即可复用 → 决策 4 |

## Architecture

```
/agent publish <dir> --dry-run
        │
  package-host-command（既有工厂,新增 publish 子动作）
        │  adminGate → argv 解析 → cwd = session.cwd
        ▼
  lib/app/publish-preview.ts（新,薄编排）
        │
        ├─ compile(dir)  ← 既有实现,一行不改
        │     失败 → 按 CompileError 分支产出可区分说明
        │
        ├─ kind 门：compiled.kind vs 命令锁定类别 → 不符即拒绝并指路
        │
        └─ 组装 PublishPreviewData（含 disclaimer + warnings + files）
        ▼
  CommandResult { dataPart: "data-publish-preview", data }
        ▼
  pi-chat：result.dataPart 优先于按命令名查表（决策 2）
        ▼
  PublishPreviewRenderer（新）
```

## Components and Interfaces

### 决策 1：新增 `PublishPreviewData`，不复用 `InstallResultData`

`InstallResultData`（`packages/protocol`）是围绕装/卸/列/更新长出来的：`items` 的语义是
**已安装的包**，没有 `warnings` 的位置，`guidance` 是一句自由文本。把预览塞进去会有三处失真：

- 文件清单不是「包」，塞进 `items` 会让 `id/version/scope` 三个字段全空；
- 告警只能塞进 `steps`，而 `steps` 的 `status` 只有 `complete|failed` ——
  **非阻断告警会被渲染成成功步骤或失败步骤，两种都不对**（Req 5.2 要求告警不被吞掉、
  且可辨认）；
- Req 2 的「未签名 / 仅预览」声明若只是 `guidance` 字符串，渲染上与安装指引无从区分。

故新增独立 schema（`packages/protocol`）：

```ts
export const PublishPreviewDataSchema = z.object({
  ok: z.boolean(),
  /** 仅成功时有。 */
  package: z.object({
    id: z.string(),
    version: z.string(),
    kind: PluginKindSchema,
    displayName: z.string(),
  }).optional(),
  /** 将纳入发布的文件与逐文件完整性摘要。 */
  files: z.array(z.object({ path: z.string(), integrity: z.string() })).default([]),
  /** 编译期非阻断告警。**一等字段** —— 不得并入 steps(Req 5.2)。 */
  warnings: z.array(z.string()).default([]),
  /**
   * 预览与真实发布的差异声明(Req 2)。做成**结构化布尔位**而非一句文案:
   * 文案会被翻译/改写/截断,布尔位不会 —— 渲染器据此恒定渲染醒目提示。
   */
  disclaimers: z.object({
    unsigned: z.boolean(),          // 未签名,不含发布者身份
    grantNotChecked: z.boolean(),   // 未校验发布授予与属主关系
  }),
  error: z.object({ code: z.string(), message: z.string(), hint: z.string().optional() }).optional(),
});
```

`disclaimers` 用布尔位而非文案，是为了让 Req 2 成为**可断言的结构**：测试断言
`disclaimers.unsigned === true`，比断言某段中文子串稳固得多，也不会因改文案而静默失效。

### 决策 2：`CommandResult` 增加可选 `dataPart`，覆盖按命令名查表

**问题**：`pi-chat.tsx:981` 是 `builtinResultDataParts?.[cmd.name]` —— 卡片类型由**命令名**决定。
`/agent` 已绑定 `data-install-result`，`/agent publish` 无法用别的卡片。

**三个候选**：

| 方案 | 代价 |
|---|---|
| A. 扩 `InstallResultData` 容纳预览 | 决策 1 已论证会失真；且 `data-install-result` 渲染器变成双头 |
| B. **`CommandResult` 增加可选 `dataPart`，服务端指定，优先于命令名查表** | 改动面：protocol 加一个可选字段 + pi-chat 一行取值 |
| C. 独立 `/publish` 命令 | 与已定的「`/agent publish` / `/plugin publish` 对称」冲突 |

**取 B**。它顺带解掉一个既有限制（一个 host 命令只能有一种结果卡片），且是纯加法：

```ts
// pi-chat.tsx
const partType = outcome.result?.dataPart ?? builtinResultDataParts?.[cmd.name];
```

安全性：`dataPart` 由**服务端一方**（我们自己的 handler）写入，不来自用户输入，故不做白名单。
渲染侧对未知 part 类型本就不匹配任何渲染器 → 静默不渲染（fail-soft），不会造成注入面。
这一判断写进注释，避免后人误以为可以把它接到用户可控的数据上。

### 决策 3：`publish` 是子动作，不是新命令；且**裸 `publish` 意味着真发布**

`publish` 加进 `AGENT_ACTIONS` 与 `PLUGIN_ACTIONS`，由既有 `createPackageHostCommand` 分派 ——
门控顺序、脱敏、审计因此天然一致，不复制第二套。

**语义裁断（重要）**：

- `/<kind> publish <dir> --dry-run` → **预览**
- `/<kind> publish <dir>`（裸） → **真正发布的意图** → 返回 `PUBLISH_NOT_AVAILABLE`，
  说明该部署尚未接入发布身份、并指引改用 `--dry-run`

为什么不让裸 `publish` 直接等于预览：那会让 Req 6「请求真正发布时诚实失败」**永远不可达**，
用户也就无从得知"我其实没发布出去"。且这与 CLI 语义一致（CLI 裸 `publish` 是真发布，
`--dry-run` 才是演练），云端就绪后裸 `publish` 直接开始工作，**语义不变、无需改文案**。

编排本体放 `lib/app/publish-preview.ts`（新），工厂只做分派 —— 保持 `package-host-command.ts`
是调度器而非大杂烩。

### 决策 4：补全 provider 参数化，不新写扫描实现

`ScanInstallSourceProvider` 与 publish 的需求只差两点：判定标志文件、`insertText` 前缀。
故把两者提为选项，保留现有默认值（行为逐字节不变）：

```ts
export interface ScanInstallSourceOptions {
  readonly maxDepth?: number;
  readonly maxItems?: number;
  /** 候选目录的判定标志;缺省 ["index.ts","index.js","package.json",".pi"]。 */
  readonly markers?: readonly string[];
  /** insertText 前缀;缺省 "local:"(安装用),publish 传 "" 直接给路径。 */
  readonly insertPrefix?: string;
}
export function createScanPublishSourceProvider(): InstallSourceProvider; // markers=[PI_WEB_MANIFEST_FILENAME], insertPrefix=""
```

端口类型 `InstallSourceProvider` 复用不改名 —— 它本质是「按基准目录枚举候选目录」，
与用途无关；改名会波及三处装配与既有测试，收益不抵churn。此点在类型注释中说明，
避免读者误以为它只能服务安装。

**realpath 越界防护是安全边界**（`types.ts:37` 已宣言），参数化不得削弱它。

新增补全参数位：`CommandArgKind` 加 `"publishableDir"`，`package-arg-provider` 的两个 SPEC
各加 `publish` 子命令词条。

### 决策 5：`CompileError` → 用户可见说明（Req 5.1）

八个分支逐一给文案，不压成一条。每条给出**改哪里**，而不只是"失败了"：

| code | 说明要点 |
|---|---|
| `MANIFEST_MISSING` | 目标目录缺 `pi-web.json`（附期望路径） |
| `MANIFEST_INVALID` | 逐条列出 schema issues |
| `MANIFEST_KIND_REQUIRED` | 必须显式声明 `kind`；**说明两侧缺省相反，不可推断** |
| `DECLARED_PATH_MISSING` | 清单声明了但不存在的文件清单 |
| `ENTRY_NOT_FOUND` | agent 探测不到入口；列出按序尝试过的候选名 |
| `ENTRY_OVERRIDE_MISSING` | `package.json#pi-web.entry` 指向的文件不存在 |
| `ENTRY_OUTSIDE_PACKAGE` | 入口越出包目录；说明 registry 侧会拒绝，前置拦截以免烧版本号 |
| `WEBEXT_SOURCE_WITHOUT_DIST` | 有 webext 源无产物；提示先构建 |
| `KEY_UNUSABLE` | **本轮不可达**（不签名）；仍在类型上穷尽，附注释 |

## Data Models

新增 `data-publish-preview` data part 与 `PublishPreviewDataSchema`（`packages/protocol`）。
无持久化格式变更，无文件写入。

## Error Handling

- 预览全程**不抛**：`compile()` 的失败以判别联合返回，逐分支映射为卡片。
- **零外部写**是硬约束：不发起网络请求、不修改包目录、不写任何本地状态。Req 8.4 对此有专门断言。
- 脱敏：`<dir>` 是用户 argv，可能夹带凭据形态字符串；一切输出面走 `redactSecrets`（既有机制）。

## Testing Strategy

| 层 | 覆盖 | 位置 |
|---|---|---|
| 单测 · 预览编排 | 成功形状（含 disclaimers 两个布尔位）／kind 不符拒绝并指路／`MANIFEST_KIND_REQUIRED`／告警**逐条**出现在 `warnings` 而非 `steps`／adminGate 拒绝 | `test/commands/publish-preview.test.ts`（新） |
| 单测 · **真实夹具** | 用 `examples/` 下真实包目录跑一次成功预览；用临时目录造一个缺 `kind` 的清单跑一次失败 —— 证明接的是真实 `compile()` 而非替身（Req 8.2） | 同上 |
| 单测 · 零外部写 | 预览前后对包目录做快照比对；全局 `fetch` 替身断言零调用（Req 8.4） | 同上 |
| 单测 · provider | `createScanPublishSourceProvider` 只产出含清单的目录；`insertText` 无 `local:` 前缀；越界防护仍生效；**既有 install provider 行为逐条不变** | 扩 `packages/server` 既有 provider 测试 |
| 单测 · 卡片类型 | `result.dataPart` 存在时优先于命令名查表；缺省时行为不变 | 扩 `packages/ui` 既有 chat 测试 |
| e2e | `/agent publish <examples/某包> --dry-run` → 预览卡片可见、含未签名声明；裸 `publish` → `PUBLISH_NOT_AVAILABLE` 卡片 | `e2e/browser/publish-command.e2e.ts`（新，跑在 install project 上） |

## Open Questions

1. **文件清单可能很长**（大包上百条）。渲染是否需要折叠 / 只显示前 N 条 + 计数？
   倾向：默认折叠、显示总数与前若干条，**不静默截断**（截断而不说明会让人以为漏文件了）。
   实现阶段按真实 `examples/` 包的实际条数定阈值，不拍脑袋。
2. **`examples/` 下是否有现成可用作 e2e 夹具的完整包**（含 `pi-web.json` 且能编译通过）。
   实现前先实跑 `compile()` 确认，若无则造一个最小夹具 —— 不假设。
