# Requirements Document

## Introduction

本功能为 core 触发符补全浮层（`PiCompletionPopover`，由 `attachment-mention-completion` / `completion-provider-framework` 落地的服务端驱动补全）补齐 **GitHub 式输入框自动补全**的交互能力。当前实现存在三处真实缺口：

1. **光标位置硬编码末尾** —— 装配层 `PiChat` 给浮层传 `cursor={input.length}`，导致触发符不在文本末尾（如在中间编辑、多行输入）时无法激活/正确替换。
2. **浮层不锚定光标** —— 浮层用 `absolute bottom-full left-0 right-0` 贴在输入框顶部并占满全宽，不随光标定位。
3. **缺少键盘导航** —— `PiCompletionPopover` 仅支持鼠标点击选中，没有 `↑/↓/Enter/Esc`，而同项目的 `PiCommandPalette`（斜杠命令）已有完整键盘导航。

本功能**参考** `react-textarea-autocomplete` 的交互范式（caret 坐标定位、键盘导航、随输入移动浮层），但**不引入该第三方依赖**，在 `@blksails/pi-web-ui` 内部用无依赖的镜像 div（mirror-div）技术自实现 caret 像素坐标计算，并复用项目内既有的 `PiCommandPalette` 键盘导航与 document 级按键捕获范式。改动限定在前端 UI 层（`@blksails/pi-web-ui`），不改协议、不改后端 provider/端点。

## Boundary Context

- **In scope**:
  - 在 `@blksails/pi-web-ui` 内新增**无第三方依赖**的 textarea caret 像素坐标工具（mirror-div 技术），计算给定字符偏移处相对 textarea 的 `{top, left, height}`。
  - `PromptInput` 暴露当前光标（`selectionStart`）变化与底层 `textarea` 元素，使装配层可读真实光标并做 caret 测量。
  - `PiChat` 用真实光标偏移（`selectionStart`）而非 `input.length` 驱动 `PiCompletionPopover`，从而支持文本中间/多行位置的补全。
  - `PiCompletionPopover` 将浮层锚定到活跃触发符处的 caret 像素坐标（默认在光标下方弹出，空间不足时翻转到上方）。
  - `PiCompletionPopover` 增加键盘导航：`↑/↓` 移动高亮、`Enter` 选中、`Esc` 关闭；激活项有 `aria-selected` 与 `aria-activedescendant` 标注；鼠标悬停同步高亮。
  - 选中候选后，按 `useCompletion.accept()` 返回的 `nextCursor` 复位 textarea 光标（`setSelectionRange`），支持在文本中间插入 token 后光标落在插入串之后。
  - 浮层开启时让位 Enter 提交（沿用既有 `onCaptureChange` → `suppressEnterSubmit` 机制）。
- **Out of scope**:
  - 协议（`@blksails/pi-web-protocol`）、后端 completion provider / 端点 / 注册表的任何改动。
  - webext 专属的 `PiMentionPopover` / `PiAutocompletePopover` 浮层（本功能仅改 core `PiCompletionPopover`；新增 caret 工具为可复用公共件，但不强制接入这些浮层）。
  - 富文本 / `contenteditable` / 第三方编辑器（保持原生 `<textarea>`）。
  - 候选项图像缩略图渲染、补全数据来源与排序逻辑（沿用现状）。
  - 引入 `react-textarea-autocomplete` 或任何等价第三方补全/caret 库。
- **Adjacent expectations**:
  - 复用既有 `useCompletion` hook 的 `open / groups / activeToken / accept` 契约；`activeToken.start/end` 已表达替换区间，`accept` 已返回 `nextCursor`，本功能负责将其正确接线到光标。
  - 复用 `extractors.findActiveToken(specs, value, cursor)`，其已支持任意 `cursor`，本功能负责喂入真实光标。
  - 键盘按键捕获沿用 `PiCommandPalette` 的 document 级 `keydown` 监听 + capturing 上报范式，保证浮层开启时即便焦点在 textarea 也能导航。
  - SSR 安全：caret 测量与 DOM 读写仅在浏览器执行，服务端渲染不报错。

## Requirements

### Requirement 1: 真实光标位置驱动补全
**Objective:** 作为在输入框中编辑的用户，我希望在文本任意位置（含中间、多行）键入触发符都能触发补全，以便不必把光标移到末尾。

#### Acceptance Criteria
1. The PromptInput shall 在 textarea 的光标位置变化（输入、点击、方向键移动、选区变化）时，向装配层上报当前 `selectionStart`。
2. The PiChat shall 用 PromptInput 上报的真实 `selectionStart` 作为 `cursor` 传入 PiCompletionPopover，而非 `input.length`。
3. When 触发符位于文本中间且光标处于该触发符的 token 内, the Completion 浮层 shall 基于真实光标提取活跃 token 并展示候选。
4. When 光标移出活跃 token（如移到 token 之前或键入空白打断）, the Completion 浮层 shall 关闭。

### Requirement 2: 浮层锚定光标位置
**Objective:** 作为用户，我希望补全浮层出现在我正在输入的触发符附近，而不是固定贴在输入框顶部占满全宽，以获得 GitHub 式直观体验。

#### Acceptance Criteria
1. The pi-web-ui shall 提供一个无第三方依赖的工具，根据 textarea 元素与字符偏移计算该偏移处相对 textarea 的 caret 像素坐标 `{top, left, height}`。
2. The caret 坐标工具 shall 仅在浏览器环境读写 DOM；在无 `window`/`document` 的环境被调用时安全降级（返回零坐标或不抛出），不破坏 SSR。
3. The PiCompletionPopover shall 将浮层水平定位到活跃触发符起始处的 caret `left`、垂直定位到 caret 下方（caret `top + height`）。
4. Where 浮层在光标下方空间不足（接近视口/容器底部）, the PiCompletionPopover shall 翻转到光标上方显示。
5. The caret 坐标工具 shall 正确处理多行 textarea：不同行的偏移得到不同的 `top`。

### Requirement 3: 键盘导航
**Objective:** 作为用户，我希望用键盘在补全候选间移动并选中，无需切换到鼠标，以保持输入流畅。

#### Acceptance Criteria
1. While 补全浮层开启且焦点在 textarea, when 用户按 `↓`, the PiCompletionPopover shall 将高亮移到下一候选（末项循环回首项）并阻止默认行为。
2. While 补全浮层开启且焦点在 textarea, when 用户按 `↑`, the PiCompletionPopover shall 将高亮移到上一候选（首项循环回末项）并阻止默认行为。
3. While 补全浮层开启, when 用户按 `Enter`, the PiCompletionPopover shall 选中当前高亮候选并阻止 textarea 提交/换行。
4. While 补全浮层开启, when 用户按 `Esc`, the PiCompletionPopover shall 关闭浮层并阻止默认行为。
5. The PiCompletionPopover shall 跨越所有 kind 分组维护单一线性高亮索引，使 `↑/↓` 可在分组之间连续移动。
6. When 候选列表因查询变化而刷新, the PiCompletionPopover shall 把高亮重置到第一个可选候选。
7. The PiCompletionPopover shall 跳过不可选的占位项（`insertText === ""`），不让高亮停留其上。
8. When 鼠标悬停某候选, the PiCompletionPopover shall 将高亮同步到该候选。
9. The PiCompletionPopover shall 以 `role=listbox` / `role=option` / `aria-selected` / `aria-activedescendant` 标注当前高亮，满足无障碍。

### Requirement 4: 选中后插入与光标复位
**Objective:** 作为用户，我希望选中候选后 token 被插入到触发符处、光标落在插入内容之后，以便继续输入。

#### Acceptance Criteria
1. When 用户经鼠标点击或 `Enter` 选中某候选, the PiCompletionPopover shall 用 `accept()` 计算的 `nextValue` 替换 `[activeToken.start, activeToken.end)` 区间并经 `onChange` 写回输入。
2. When 候选被选中, the PiCompletionPopover shall 将 textarea 光标经 `setSelectionRange` 复位到 `accept()` 返回的 `nextCursor`（插入串之后），并保持 textarea 焦点。
3. When 触发符 token 位于文本中间（其后仍有文本）, the 选中插入 shall 仅替换 token 区间、保留其后文本，且光标落在插入串之后而非文本末尾。
4. The PiCompletionPopover shall 不选中占位项（`insertText === ""`）。

### Requirement 5: 不回归既有行为
**Objective:** 作为维护者，我希望本功能不破坏既有补全、命令浮层与提交流程。

#### Acceptance Criteria
1. The 本功能 shall 不修改 `@blksails/pi-web-protocol` 与后端 completion provider / 端点 / 注册表。
2. The PiCompletionPopover shall 维持既有 `onCaptureChange` 语义（开→true、关→false），使 Enter 在浮层开启时让位提交。
3. The PiChat shall 不改变 `PiCommandPalette`（`/` 命令）与 webext mention/autocomplete 浮层的既有行为与让位关系。
4. When 没有可用 `client`/`sessionId` 或无候选, the PiCompletionPopover shall 不渲染、不监听全局按键、不抛错（空安全收敛）。
5. The 本功能 shall 不引入 `react-textarea-autocomplete` 或等价第三方补全/caret 依赖。

### Requirement 6: 全系统输入框浮层呈现一致
**Objective:** 作为用户，我希望同一输入框里所有触发符浮层（`@` 补全、`/` 命令、webext 的 mention 与 autocomplete）采用一致的弹出方式（同样锚定光标、同样的浮层形态），避免割裂的视觉体验。

#### Acceptance Criteria
1. The pi-web-ui shall 把 caret 锚定定位逻辑抽为可复用单元（hook），供所有输入框触发符浮层共用。
2. The `/` 命令面板（PiCommandPalette）shall 经该 caret 锚定以 `position: fixed` 定位到 `/` 所在光标（行首），而非旧的全宽 `absolute bottom-full` 贴顶布局。
3. The `/` 命令面板 shall 维持其既有键盘导航（↑↓/Enter/Esc）、过滤、内置/扩展命令合流与让位语义不变，仅改变定位呈现。
4. When 未提供底层 textarea ref, 各浮层 shall 安全降级（不崩），不要求调用方一定接线锚定。
5. The webext mention 浮层（PiMentionPopover）shall 经该 caret 锚定 `position: fixed` 定位到 mention 触发符起点；其取候选/选中/让位语义不变。
6. The webext autocomplete 浮层（PiAutocompletePopover）shall 经该 caret 锚定 `position: fixed` 定位到当前光标；其取候选/选中语义不变。
7. The 附件按钮的下拉菜单（非触发符、锚定到按钮）shall 保持按钮锚定，不纳入 caret 锚定范围。
