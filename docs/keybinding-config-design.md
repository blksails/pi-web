# 快捷键配置系统 · 设计讨论稿

> 状态：pre-spec 讨论稿（未走 kiro）。目标是把「pi-web 的键盘快捷键从三套割裂的硬编码/声明式机制，
> 收敛成一套用户可配置、可发现、可检冲突的系统」这件事的**现状边界**与**可行设计**钉清楚，
> 再决定是否落正式 spec。
>
> 调研日期：2026-07-01。所有现状结论均落到真实代码 `file:line`。

## 1. 目标

让快捷键成为**用户可配置的一等公民**，而不是散落在各组件里的硬编码常量：

- **可枚举**：所有可绑定的动作（内置的 + 扩展声明的）能被列出来。
- **可覆盖**：用户能改内置键（例：把提交从 `Enter` 换成 `Cmd+Enter`）、覆盖或禁用扩展声明的键。
- **可发现**：设置页有快捷键面板；命令面板/浮层能显示对应快捷键提示。
- **可检冲突**：两个动作绑同一 combo 时能检测并高亮，而非静默取第一个。
- **不破坏现状**：现有 `Enter` 提交 / `Shift+Enter` 换行 / 浮层导航 / webext `keybindings` 声明全部保持默认行为不变。

一句话：一个 **中央 Command Registry + 用户可覆盖的 keybindings 配置域 + 统一分发器 + 设置面板**。

## 2. 现状核验（已实现到哪 / 边界在哪）

结论：**快捷键当前是三套互不相通的机制，只有第三套「可配置」，且配置者是扩展作者而非终端用户。没有任何中央注册表、没有用户配置层、没有冲突检测。**

### 2.1 组件内置键（硬编码，用户不可改）

`PromptInput.handleKeyDown`（`packages/ui/src/elements/prompt-input.tsx:180-215`）：

| 按键 | 行为 | 依赖的运行时条件 |
| --- | --- | --- |
| `Tab` | 接受 inlineComplete ghost 后缀 | `hasGhost && !suppressEnterSubmit` |
| `Esc` / `Alt+↑` | 把已排队消息取回编辑器 | `canRetrieve && !suppressEnterSubmit`（message-queue-ui） |
| `Shift+Enter` | 换行（浏览器默认，不提交） | — |
| `Enter` | 提交 | `!suppressEnterSubmit && canSubmit` |
| `Alt+Enter` | 提交（followUp 变体） | 同上 |

这些是**私有事件处理**，无 `commandId`，无法被外部枚举、覆盖、展示。要"可配置"，前提是先把它们抽成有稳定 id 的命令。

### 2.2 浮层导航键（硬编码，`document` 级）

- `PiCommandPalette`（`packages/ui/src/controls/pi-command-palette.tsx`）：`↑↓` 导航 / `Enter`·`Tab` 确认 / `Esc` 关闭。
- `PiCompletionPopover`（`packages/ui/src/completion/pi-completion-popover.tsx:110-141`）：同上一套。

两者各自在 `document` 上挂 `keydown` 监听，与 §2.1 的编辑器键靠 `suppressEnterSubmit` 这个临时 flag 硬协调优先级。**没有作用域栈**——谁先注册谁先吃事件，靠 flag 打补丁。

### 2.3 扩展声明键（唯一"可配置"，但配置者是扩展作者）

类型（`packages/web-kit/src/define-web-extension.ts:55-77`）：

```ts
export interface Keybinding {
  readonly combo: string;     // "Mod+k" / "Ctrl+Shift+s"
  readonly commandId: string; // 关联的斜杠命令 id
}
// ContributionPoints.keybindings?: readonly Keybinding[]
```

监听（`packages/ui/src/chat/pi-chat.tsx:1037-1069`）：

```ts
const keybindings = extension?.contributions?.keybindings;
// document 级 keydown，匹配后：
setInput(`/${kb.commandId} `);   // 只是"把 /commandId 填进输入框"，并非执行
```

**三个关键局限**：

1. **效果只是填充输入框**，不是真正触发命令（`pi-chat.tsx:1062`）。真正执行还得用户再按 Enter → 走命令面板/扩展命令通道。
2. **combo 解析弱**（`pi-chat.tsx:1041-1057`）：`Mod/Ctrl/Cmd/Meta` 全归一成"要不要修饰键"，**不区分 Cmd 与 Ctrl**；`needMod === (e.metaKey || e.ctrlKey)`。不支持双键 chord，不处理键盘布局。
3. **无冲突检测**：`for` 循环取第一个 `matches` 的绑定，多个绑同一 combo 时后者静默失效。

### 2.4 用户配置系统（完全没有 keybindings 域）

现有 5 个配置域（`packages/protocol/src/config/domains/`）：`auth` / `settings` / `sandbox` / `extensions` / `logging`。**没有 keybindings**。

配置域的落地机制（关键，决定新域怎么加）：

- **域 schema**：一个 zod object，字段的 `.describe()` 里塞 JSON 元数据（`label`/`group`/`order`/`widget`…），`zodToFormSchema` 转表单 schema（见 `settings.ts:17-77`）。
- **面板注册**：`lib/settings/register-panels.ts` 里 `registerSettingsPanel(...)` 追加一次，`<SettingsShell>` 零改动（文件头注释明示）。
- **读写 IO**：`makeConfigDomainIO` 走 `/api/config/:domain`（写 `~/.pi/agent/<domain>.json`），或自定义 `makeUrlIO(url)` 走专用端点（如 sandbox 项目域走 `/api/config/sandbox/project`）。
- **复杂控件**：非平铺表单字段用**自定义 field renderer**——已有先例 `ExtensionsKvField` / `ConfigFilesField` / `ModelSelectField` / `NamespaceTogglesField`（`register-panels.ts` import 段）。快捷键"录制 + 冲突高亮"正属于这类，必须走自定义 renderer，不能靠纯 zod 表单。

**这条与 memory「配置 UI 静态 schema + widget 动态」一致**：前端不读后端注入的 formSchema，动态/交互控件必须走 widget + 数据端点 + 自定义 renderer。

## 3. 设计提案（对应调研档 B：中央注册表 + 可配置内置键）

四个部件，从内到外：

### 3.1 Command Registry（新增，`@blksails/pi-web-ui` 或新 kit 包）

把"可被快捷键触发的动作"抽成注册表条目：

```ts
interface Command {
  readonly id: string;              // 稳定 id，例 "prompt.submit" / "queue.retrieve"
  readonly title: string;           // 面板展示名
  readonly category: string;        // 分组：编辑器 / 浮层 / 扩展
  readonly defaultCombo?: string;   // 默认绑定（可空 = 默认无键）
  readonly scope: KeybindingScope;  // 见 §3.3
  run(ctx: CommandRunCtx): void;    // 执行体（内置命令直接调；扩展命令走既有命令通道）
}
```

内置动作首批迁移清单（对应 §2.1/§2.2）：

| commandId | 默认 combo | 迁移来源 |
| --- | --- | --- |
| `prompt.submit` | `Enter` | prompt-input |
| `prompt.newline` | `Shift+Enter` | prompt-input |
| `prompt.followUp` | `Alt+Enter` | prompt-input |
| `prompt.acceptGhost` | `Tab` | prompt-input |
| `queue.retrieve` | `Esc` / `Alt+ArrowUp` | prompt-input（message-queue-ui） |
| `palette.next/prev/confirm/close` | `↓`/`↑`/`Enter`/`Esc` | 浮层 |

> ⚠️ **迁移风险**：`prompt.submit` 等键与 `suppressEnterSubmit`（命令/补全浮层捕获态）深度耦合。
> 迁移**不能**丢掉这层门控——注册表分发器必须复刻"浮层捕获时让位"的作用域优先级，否则回归
> Enter 双触发 / 换行失灵。这是本设计**最高风险点**，建议首版内置命令**保留原 handler 作为
> 兜底路径**，注册表只在"用户显式覆盖了默认 combo"时接管该命令，降低回归面。

### 3.2 keybindings 配置域（新增，`packages/protocol/src/config/domains/keybindings.ts`）

数据形态——**覆盖表**（只存用户改过的，默认从注册表来）：

```jsonc
// ~/.pi/agent/keybindings.json
{
  "overrides": {
    "prompt.submit": "Mod+Enter",   // 用户把提交改成 Cmd/Ctrl+Enter
    "prompt.newline": "Enter",
    "deploy": null                    // null = 禁用该命令的快捷键
  }
}
```

- 域 schema 用 zod（`overrides: record(string, string | null)`），但**面板不用纯表单**——挂自定义 renderer `KeybindingsField`（录制器 + 冲突高亮 + 重置），类比 `ExtensionsKvField`。
- IO 走标准 `makeConfigDomainIO`（`/api/config/keybindings` → `~/.pi/agent/keybindings.json`），或项目级 `.pi/keybindings.json`（比照 sandbox 双层）。
- 面板注册：`register-panels.ts` 追加一次 `registerSettingsPanel`，外壳零改动。

### 3.3 统一分发器 `useKeybindings`（新增，替代散落的 `document` 监听）

- **单一** `document` 级 `keydown` 入口，取代 §2.1/§2.2/§2.3 各自的监听。
- **作用域栈**（scope stack）：`global` < `editor` < `overlay`。浮层打开时 push `overlay` 作用域，事件先给栈顶，未消费再冒泡到下层——用真正的栈替代 `suppressEnterSubmit` flag。
- **combo 解析升级**：区分 `Cmd`(metaKey) 与 `Ctrl`(ctrlKey)；`Mod` 保留为"Mac=Cmd, 其他=Ctrl"的跨平台别名；为 chord（双键序列）预留解析位（首版可只支持单 combo）。
- **合并规则**：有效绑定 = 注册表 `defaultCombo` 叠加 keybindings 域 `overrides`（`null` 删除，字符串覆盖）。
- **冲突检测**：合并时同一 (scope, combo) 映射到多个 command → 标记冲突，面板高亮，分发时按注册顺序或报错（首版：面板警告 + 分发取先注册者，与现状行为一致但可见）。

### 3.4 可发现性（设置面板 + 浮层提示）

- **设置页快捷键面板**：列命令（按 category 分组）、当前 combo、录制新 combo、冲突高亮、"恢复默认"。这是 `KeybindingsField` renderer 的主体。
- **浮层内联提示**：`PiCommandPalette` 每个命令项右侧显示其 combo（数据来自注册表），补齐现状"可发现性为零"。

## 4. 传输与约束（哪些是硬约束）

- **纯前端 + 配置文件**：快捷键分发全在浏览器；配置持久化复用既有 config 域机制（`/api/config/:domain` → JSON 文件）。**不涉及 agent 子进程、不涉及 pi SDK 协议、不涉及 SSE 帧**——比双向 state / 命令通道简单得多，无 pi 协议约束。
- **不碰 pi RPC**：与 memory「统一命令分离层」「context 外双向 state」的复杂接缝**无关**。这是纯 pi-web 前端 + 配置层特性。
- **扩展键语义保持**：webext `contributions.keybindings` 的 `{combo, commandId}` 声明**继续有效**，只是被纳入统一注册表作为一类 command（category=扩展），并可被用户 overrides 覆盖/禁用。现有"填充 `/commandId `"的效果默认不变（除非后续单独决定改成直接执行）。
- **跨平台**：`Mod` 别名 + Cmd/Ctrl 区分必须在分发器里处理干净，否则 Mac/Win 用户体验分叉。
- **SSR/水合**：分发器用 `useEffect` 挂载（现状 `pi-chat.tsx` 已是此模式），无 SSR 键盘监听问题。

## 5. 影响面（若落 spec，跨哪些包）

| 包 | 改动 |
| --- | --- |
| `packages/protocol` | 新增 `config/domains/keybindings.ts`（域 schema + formSchema） |
| `packages/ui`（`@blksails/pi-web-ui`） | Command Registry、`useKeybindings` 分发器、`KeybindingsField` renderer；迁移 `prompt-input` / 浮层监听；`PiCommandPalette` 显示 combo |
| `packages/web-kit` | `Keybinding` 类型纳入统一注册表（大概率零改或仅补注释） |
| `app` / `lib/settings` | `register-panels.ts` 追加快捷键面板注册；`/api/config/keybindings` 端点（若走标准域可能零改，catch-all 已覆盖需核） |

> ⚠️ 参照 memory「新顶层 API 段须自带 Next catch-all 转发器」：若 keybindings 走**已有** `/api/config/:domain`
> 段则复用现有转发器；若另起顶层段则需自带 `[[...path]]/route.ts`，否则静默 404。设计上**强烈建议复用
> `/api/config/*`**，避免这个坑。

## 6. 决策点（已定 · 2026-07-01 用户拍板，全部采纳"倾向"）

1. **内置键迁移策略** ✅ **保留原 handler 兜底、仅"用户覆盖了默认 combo"时接管**（稳，首版注册表可不完整）。
   *不* 走全量迁移。
2. **配置层级** ✅ **仅全局 `~/.pi/agent/keybindings.json`**。首版不做项目级 `.pi/keybindings.json`。
3. **扩展键语义** ✅ **保持现状"填充 `/commandId `"语义，不改成直接执行**。纳入统一注册表但不改行为；
   "直接执行"另立 issue，不进本特性。
4. **chord（双键序列）** ✅ **首版不支持**，仅在 combo 解析器里预留扩展位。
5. **作用域模型** ✅ **三层固定作用域 global/editor/overlay**，不做 VS Code 式 `when` DSL（那是调研档 C）。

## 7. 建议

- 本稿对应调研档 **B**。若落 spec，按 §6 的"倾向"取最小可行切面：**保留兜底的内置命令迁移 + 全局单层
  keybindings 域 + 三层固定作用域 + 单 combo（无 chord/无 when）+ 设置面板 + 浮层提示**。
- 跨 `protocol`/`ui`/`app` 三包，属典型 spec 级特性，建议走 `/kiro-spec-init`。**但本轮按用户要求止于调研，不立 spec。**
- 最高风险是 §3.1 的 `suppressEnterSubmit` 耦合迁移——spec 的验收里必须有"Enter 提交 / Shift+Enter 换行 /
  浮层捕获态让位"的回归 e2e，否则极易砸掉最核心的输入体验。
