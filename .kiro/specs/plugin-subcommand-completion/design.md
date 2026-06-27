# Technical Design

## Overview

在 `PiCommandPalette` 内做 `/plugin` 的**分阶段补全**（命令名 → 子命令 → 参数），不碰 `@` 通用补全框架、不改 pi SDK / runner。参数候选数据：`uninstall` 等复用 server 端**现成的** `GET /extensions`；`install` 本地目录新增一个按会话 cwd 扫目录的轻量注入路由。候选渲染进命令面板既有浮层，自动获得已统一的 `useCaretAnchor` 锚定与键盘导航。

### 关键约束与既有资产

| 资产 | 位置 | 复用方式 |
| --- | --- | --- |
| `/plugin` 命令 | `packages/tool-kit/src/extension-tools/extension-manager.ts:160`（`pi.registerCommand`，source=extension） | 不改;补全建立在其命令面板可见之上 |
| 命令面板选中路径 | `packages/ui/src/controls/pi-command-palette.tsx:226-232`（builtin→onBuiltinSelect;其它→`onChange(/name )`+onSubmit） | 扩展为"有 argSpec 时分阶段、非终态不提交" |
| caret 锚定 + 键盘导航 | 同文件（已并入 `useCaretAnchor` + active 导航） | 直接复用,候选渲染进同一浮层 |
| 已装扩展列表 | `packages/server/src/extensions/routes/list-extensions.ts` → `GET /extensions` → `{extensions: InstalledExtension[]}`（`id`/`kind`/`version`/`scope`） | 直接 fetch,候选=`id` |
| 会话 cwd | `store.get(sessionId).cwd`;`CompletionCtx.cwd`/file-provider 扫描范式 | install-source 端点复用 |

## Architecture

```
PiCommandPalette
  ├─ stage = parseCommandStage(value, provider.specFor(cmd))   [纯函数, controls/command-arg.ts]
  │     command  → 既有命令名补全(controls.getCommands)
  │     subcommand → spec.subcommands 过滤(静态)
  │     arg       → provider.listArgs(cmd, sub, query)         [异步]
  ├─ 候选渲染进既有浮层(caret 锚定 + active 键盘导航)
  └─ select 分阶段:
        有 argSpec 的命令 / 非终态子命令 → onChange("/cmd sub ")  不提交
        终态子命令(list)               → 既有执行路径
        参数候选                        → 替换最后一段 → onChange("/cmd sub <值> ") 不提交

CommandArgProvider (窄接口, 装配层注入)
  ├─ specFor(command): CommandArgSpec | undefined          静态注册表
  └─ listArgs(command, sub, query, signal): Promise<CommandArgItem[]>
        plugin/uninstall|enable|disable|update → GET /extensions → map id
        plugin/install                          → GET /sessions/:id/install-sources?q

Server(注入路由, 复用 + 新增)
  ├─ GET /extensions                         [现成, 零改]
  └─ GET /sessions/:id/install-sources?q     [新增] 扫 session.cwd 浅层可装目录 → local:<rel>
```

## Components and Interfaces

### 1. `packages/ui/src/controls/command-arg.ts`（新增：注册表契约 + 阶段解析纯函数）

```ts
export interface CommandArgItem {
  readonly id: string;
  readonly label: string;
  readonly insertText: string;   // 填入"最后一段"的文本(如 ext id 或 local:<rel>)
  readonly detail?: string;
}
export interface SubcommandSpec {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly terminal: boolean;            // 无需后续参数(如 list)
  readonly argKind?: "installedExt" | "localSource";  // 非终态的参数类型
}
export interface CommandArgSpec {
  readonly command: string;              // 不含前导 "/"
  readonly subcommands: readonly SubcommandSpec[];
}
export interface CommandArgProvider {
  /** 同步返回某命令的 argSpec;无则该命令走既有命令名补全。 */
  specFor(command: string): CommandArgSpec | undefined;
  /** 异步取参数候选(按子命令路由数据源)。 */
  listArgs(
    command: string,
    sub: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly CommandArgItem[]>;
}

export type CommandStage =
  | { readonly kind: "command"; readonly query: string }
  | { readonly kind: "subcommand"; readonly command: string; readonly query: string }
  | {
      readonly kind: "arg";
      readonly command: string;
      readonly sub: SubcommandSpec;
      readonly query: string;
      /** 参数段在 value 内的替换区间 [start,end)。 */
      readonly start: number;
      readonly end: number;
    };

/** 依据输入与 argSpec 解析当前阶段(纯函数,可单测)。spec 缺省 → 命令名阶段。 */
export function parseCommandStage(
  value: string,
  spec: CommandArgSpec | undefined,
): CommandStage;
```

**`parseCommandStage` 规则**（`value` 以 `/` 开头）：
- 切 token：`rest = value.slice(1)`；`tokens = rest.split(/\s+/)`（保留前导/中间信息）；`endsWithSpace = /\s$/.test(rest)`。
- `tokens.length<=1 && !endsWithSpace` 或 `spec===undefined` → `command`（query=tokens[0]）。
- 已定命令、尚未定子命令（仅 `/cmd ` 或在打 `tokens[1]`）→ `subcommand`（query=tokens[1] ?? ""）。
- 子命令已定且匹配某 `SubcommandSpec`：
  - `terminal` → 仍返回 `subcommand`（终态无参数，靠 Enter 执行）；
  - 非终态 → `arg`：跳过 `-l`/`--local` 等 flag token 定位"参数段"，query=参数段当前文本，`[start,end)` 为该段区间（替换用）。
- 子命令不匹配任何 spec → `subcommand`（按前缀过滤展示）。

### 2. `packages/ui/src/controls/pi-command-palette.tsx`（改）

- 新增可选 prop `commandArgProvider?: CommandArgProvider`。
- 计算命令名（命令模式下 `tokens[0]`），`spec = commandArgProvider?.specFor(cmd)`，`stage = parseCommandStage(value, spec)`。
- **候选来源按阶段**：
  - `command`：既有 `filtered`（getCommands）。
  - `subcommand`：`spec.subcommands` 按 query 前缀过滤 → 统一成"可导航候选"。
  - `arg`：`useEffect` 防抖调 `commandArgProvider.listArgs(cmd, sub.name, query, signal)`（仿既有 `extItems` 异步取数 + cancel）。
- **统一候选列表 + active 导航**：把当前阶段候选投影成一个线性可选数组，复用既有 `active`/`handleKey`（↑↓/Enter/Esc）与渲染（`role=option`、`data-pi-command-item`），caret 锚定不变。
- **select 改造**（替换 226-232 的分支）：
  - 命令名阶段选中命令：若 `specFor(name)` 存在 → `onChange("/name ")`，**不** `onSubmit`（进入子命令）；否则维持既有路径（builtin/extension/onSubmit）。
  - 子命令阶段选中：非终态 → `onChange("/cmd sub ")` 不提交；终态（list）→ `onChange("/cmd sub ")` + `onSubmit`（执行）。
  - 参数阶段选中：用 `stage.start/end` 替换最后一段 → `onChange(value[0..start] + item.insertText + " ")`，不提交；经 inputRef `setSelectionRange` 就位光标（与补全浮层 accept 同范式）。
- 失败/空：`listArgs` 抛错或空 → 该阶段空态收敛（不崩、不阻塞输入）。

### 3. `packages/server/src/extensions/routes/install-sources.ts`（新增注入路由）

`GET /sessions/:id/install-sources?q=<前缀>` → `{ sources: { path: string; insertText: string }[] }`

- `store.get(sessionId)` 取 `session.cwd`；缺会话 → 404。
- 扫描 cwd **浅层**（一级，必要时二级）子目录，判定"可作为 install source"：含 `index.ts`/`index.js`/`package.json`/`.pi/` 任一。
- realpath 归一 + 越界防护：仅返回 `realpath` 仍位于 cwd 内的目录（复用 file-provider 的安全约束思路）；`q` 做前缀/子串过滤；限量（如 ≤30）。
- 候选：`{ path: "<rel>", insertText: "local:<rel>" }`。
- 失败 → 502 可识别错误;空 → `{sources: []}`（非错误）。

挂载：`packages/server/src/extensions/routes.ts` 的 `createExtensionRoutes` 增加该 `InjectedRoute`（与 `GET /extensions` 同处，已接入 `pi-handler.ts:326`）；需要 `store` 注入（`ExtManagementOptions.store` 已有）。

### 4. 装配层默认 provider（`lib/app/` 或 `packages/ui` 的工厂）

提供 `createPluginArgProvider({ apiBase, sessionId })`：
- `specFor("plugin")` → 静态：
  ```
  subcommands: [
    { name:"install", aliases:["add"], terminal:false, argKind:"localSource" },
    { name:"uninstall", aliases:["remove"], terminal:false, argKind:"installedExt" },
    { name:"list", aliases:["ls"], terminal:true },
  ]
  ```
- `listArgs("plugin", sub, q)`：
  - `installedExt`（uninstall/…）→ `GET ${apiBase}/extensions` → `extensions.map(e => ({id:e.id,label:e.id,insertText:e.id,detail:e.kind}))`，按 q 过滤。
  - `localSource`（install）→ `GET ${apiBase}/sessions/${sessionId}/install-sources?q=` → `sources.map(s => ({id:s.path,label:s.path,insertText:s.insertText,detail:"local"}))`。
- 在 `PiChat` 装配处把该 provider 传给 `PiCommandPalette`（PiChat 已有 client/sessionId/apiBase 接缝）。

> 命令面板自身只依赖 `CommandArgProvider` 窄接口，不持有 HTTP（Req 5.5）。

## Data Models

- 新增前端类型：`CommandArgItem` / `SubcommandSpec` / `CommandArgSpec` / `CommandStage`（均 ui 包内部，非协议）。
- 复用协议/DTO：`InstalledExtension`（server `ext.types.ts`，经 `GET /extensions`）。
- 新端点响应：`{ sources: { path: string; insertText: string }[] }`（server 内部 DTO，非 protocol 包）。

## Error Handling

- `listArgs` 失败/超时 → 空候选、阶段空态，不阻塞输入（Req 2.4/3.5）。
- install-sources 端点：无会话 404、扫描失败 502（脱敏）、空目录 `{sources:[]}`。
- `parseCommandStage` 对畸形输入（多空格、纯 flag、未知子命令）安全降级到 subcommand/command 阶段，不抛。
- 无 `commandArgProvider` 或命令无 spec → 完全退回既有命令名补全（Req 5.4）。

## Testing Strategy

> 项目硬规则：单元/集成 + e2e，新鲜证据。

### 单元（vitest，`packages/ui/test` + `packages/server`）
- `command-arg.test.ts`：`parseCommandStage` 全分支——命令名/子命令/参数边界、尾空格、跳 `-l` flag、未知子命令、spec 缺省降级、参数段 `[start,end)`。
- `pi-command-palette` 增测：注入 mock provider → `/plugin ` 出子命令；选 install 进入参数阶段不提交；`/plugin uninstall ` 调 `listArgs` 出候选；选参数替换最后一段并就位；终态 list 执行；无 spec 命令走原路径（不回归）。
- server `install-sources.test.ts`：扫描可装目录、q 过滤、越界/realpath 防护、无会话 404、空 `{sources:[]}`。

### 集成
- 命令面板 + 默认 provider（mock fetch `GET /extensions` 返回 `InstalledExtension[]`）：`/plugin uninstall ` → 候选 = id；选中填 `/plugin uninstall <id> `。

### e2e（Playwright，隔离 build；stub agent）
- 子命令：`/plugin ` → 浮层出 `install`/`uninstall`/`list`（fixed 锚定，与 `@`/`/` 一致）；↓/Enter 选 `install` → 输入变 `/plugin install `、不发送、进入参数阶段。
- install 本地目录：会话 cwd（如 `examples/`）下 `/plugin install ` → 出本地目录候选（`local:<dir>`）；选中填 `/plugin install local:<dir> `。
- （uninstall 已装候选：因 e2e 隔离 agentDir 下 `pi list` 通常为空，候选存在性由**单元/集成**覆盖；e2e 仅验"`/plugin uninstall ` 不崩、空态收敛"。）

### 验证门
- `pnpm --filter @blksails/pi-web-ui test`、`pnpm --filter @blksails/pi-web-server test`、`pnpm typecheck` 全绿；e2e 用例通过，新鲜证据（`kiro-verify-completion`）。
