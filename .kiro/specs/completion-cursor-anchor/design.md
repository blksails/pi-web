# Technical Design

## Overview

为 core 补全浮层 `PiCompletionPopover` 补齐 GitHub 式自动补全交互：**真实光标驱动**、**caret 像素锚定**、**键盘导航**、**选中后光标复位**。改动全部落在 `@blksails/pi-web-ui`，不触碰协议与后端。参考 `react-textarea-autocomplete` 的交互范式，但用无依赖的镜像 div 技术自实现 caret 测量，键盘导航沿用项目内 `PiCommandPalette` 的 document 级按键捕获范式。

### 现状与缺口（代码锚点）

| 缺口 | 现状代码 |
| --- | --- |
| 光标硬编码 | `chat/pi-chat.tsx:817` `cursor={input.length}` |
| 浮层贴顶全宽 | `chat/pi-chat.tsx:814` `absolute bottom-full left-0 right-0`；`completion/pi-completion-popover.tsx:62` 容器无定位 |
| 无键盘导航 | `completion/pi-completion-popover.tsx` 仅 `onClick`，无 `active` 状态/按键监听 |
| 选中丢弃光标 | `completion/pi-completion-popover.tsx:57` `const { nextValue } = accept(...)` 丢弃 `nextCursor` |
| textarea 不外露 | `elements/prompt-input.tsx:93` `textareaRef` 为内部私有，无 selection 上报 |

既有可复用资产：`completion/extractors.ts:findActiveToken(specs,value,cursor)` 已支持任意 cursor；`completion/use-completion.ts:accept()` 已返回 `nextCursor`；`controls/pi-command-palette.tsx:263-270` 的 document keydown 捕获范式。

## Architecture

```
PromptInput (elements/prompt-input.tsx)
  ├─ <textarea>  ── onChange / onSelect / onKeyUp / onClick ─→ reportSelection(selectionStart)
  ├─ inputRef (merged: 内部 resize ref + 外部 inputRef prop)
  └─ onSelectionChange(selectionStart) ───────────────┐
                                                       ▼
PiChat (chat/pi-chat.tsx)
  ├─ inputRef = useRef<HTMLTextAreaElement>            (传入 PromptInput)
  ├─ cursor = useState(0)  ← onSelectionChange         (传入 Popover)
  └─ <PiCompletionPopover value cursor inputRef ... />
        │
        ▼
PiCompletionPopover (completion/pi-completion-popover.tsx)
  ├─ useCompletion({ value, cursor }) → { open, groups, activeToken, accept }
  ├─ selectable = flattenSelectable(groups)            (completion/nav.ts, 纯函数)
  ├─ active index + document keydown(↑↓/Enter/Esc)    (复用 command-palette 范式)
  ├─ caret 锚定: getCaretCoordinates(inputEl, activeToken.start)  (completion/caret-coordinates.ts)
  │              + computePlacement(...)               (completion/placement.ts, 纯函数)
  └─ select(item): onChange(nextValue) + inputEl.setSelectionRange(nextCursor)
```

## Components and Interfaces

### 1. `completion/caret-coordinates.ts`（新增，无依赖）

镜像 div 技术（参考 textarea-caret-coordinates 思路，自实现）：克隆 textarea 的关键计算样式到一个屏幕外 `<div>`，把 `value` 截至 `offset` 的文本写入镜像，再追加一个零宽 `<span>` 标记，读取该 span 相对镜像的 `offsetTop/offsetLeft` 与行高，得出 caret 在 textarea **内容坐标系**（未计 textarea 自身滚动）的位置。

```ts
export interface CaretCoordinates {
  readonly top: number;    // caret 顶相对 textarea 内容原点
  readonly left: number;
  readonly height: number; // 行高
}
export function getCaretCoordinates(
  el: HTMLTextAreaElement,
  offset: number,
): CaretCoordinates;
```

- **SSR/环境安全**：`typeof document === "undefined"` 时返回 `{top:0,left:0,height:0}`，不抛。
- 复制的样式属性集合（box-sizing、width、padding*、border*、font*、line-height、letter-spacing、white-space、word-wrap、tab-size、text-indent 等）；镜像 `position:absolute; visibility:hidden; whiteSpace:pre-wrap; wordWrap:break-word; overflow:hidden; top:0; left:-9999px`。
- 用后即从 DOM 移除镜像（无残留）。
- 多行：因镜像保留换行与 wrap，不同行偏移自然得到不同 `top`（满足 Req 2.5）。

### 2. `completion/placement.ts`（新增，纯函数）

把"视口几何 → 浮层定位样式"抽成纯函数以便单测（不依赖真实 layout）。

```ts
export interface PlacementInput {
  readonly rect: { top: number; left: number };  // textarea getBoundingClientRect
  readonly caret: CaretCoordinates;
  readonly scrollTop: number; readonly scrollLeft: number; // textarea 自身滚动
  readonly viewportHeight: number;
  readonly estPopoverHeight: number;  // 估高，用于翻转判断
}
export type PlacementStyle =
  | { left: number; top: number;  flip: false }
  | { left: number; bottom: number; flip: true };
export function computePlacement(i: PlacementInput): PlacementStyle;
```

- `x = rect.left + caret.left - scrollLeft`
- `caretTopVp = rect.top + caret.top - scrollTop`
- below 起点 `y = caretTopVp + caret.height`；若 `y + estPopoverHeight > viewportHeight` 则翻转：返回 `{ left:x, bottom: viewportHeight - caretTopVp, flip:true }`（浮层底贴 caret 顶）。
- 否则 `{ left:x, top:y, flip:false }`。
- 浮层用 `position: fixed` + 该样式渲染，绕开 offsetParent 链计算。

### 3. `completion/nav.ts`（新增，纯函数）

```ts
// 把分组拍平为线性可选项序列(过滤占位项 insertText==="")，供单一 active 索引跨组导航。
export function flattenSelectable(
  groups: readonly CompletionGroupView[],
): readonly CompletionItem[];
// 方向移动并环绕(len 为 0 时返回 0)。
export function nextActiveIndex(current: number, len: number, dir: 1 | -1): number;
```

### 4. `elements/prompt-input.tsx`（改）

新增 props（均可选，向后兼容）：

```ts
/** 外部 textarea ref；与内部 resize ref 合并。 */
readonly inputRef?: React.RefObject<HTMLTextAreaElement | null>;
/** 光标(selectionStart)变化上报：输入/点击/方向键/选区变化时触发。 */
readonly onSelectionChange?: (selectionStart: number) => void;
```

- 合并 ref：内部仍持 `textareaRef`（resize 需要），用回调 ref 同时写 `textareaRef.current` 与 `inputRef.current`。
- `reportSelection()`：从 `textareaRef.current.selectionStart` 读并调 `onSelectionChange`。挂在 `onChange`（值变即报，保证 value+cursor 同帧一致）、`onSelect`、`onKeyUp`、`onClick`、`onFocus`。
- 不改既有 Enter 提交 / ghost / resize 行为。

### 5. `chat/pi-chat.tsx`（改）

- 新增 `const inputRef = React.useRef<HTMLTextAreaElement|null>(null)` 与 `const [cursor, setCursor] = React.useState(0)`。
- `PromptInput` 增加 `inputRef={inputRef}` 与 `onSelectionChange={setCursor}`。
- `PiCompletionPopover`：`cursor={cursor}`（替换 `input.length`），新增 `inputRef={inputRef}`。
- 容器从 `absolute bottom-full left-0 right-0 z-50` 改为不约束尺寸/位置的挂载点（`z-50`，定位交给浮层内部的 fixed 样式）；保留挂载条件 `client && sessionId`。

### 6. `completion/pi-completion-popover.tsx`（改）

新增 prop `inputRef?: React.RefObject<HTMLTextAreaElement|null>`。逻辑增量：

- `selectable = flattenSelectable(groups)`；`active` state；查询变化（`groups` 引用变化）`useEffect` 重置 `active=0`（Req 3.6）。
- document keydown（`open` 时挂载，复用 command-palette 范式，Req 3.1-3.4）：
  - `ArrowDown/Up` → `setActive(nextActiveIndex(...))` + `preventDefault`。
  - `Enter` → 选中 `selectable[active]` + `preventDefault`（让位 textarea 提交）。
  - `Esc` → 设 `dismissedKey = tokenKey` 关闭 + `preventDefault`。
- **dismiss 机制**：因 `open` 由 `activeToken && items` 推出，Esc 不应清空输入。引入 `dismissedKey` ref/state，渲染门控 `open && dismissedKey !== tokenKey`；`tokenKey` 变化即解除 dismiss（Req 3.4 关闭、token 变重新可弹）。
- 渲染：
  - 容器改 `position: fixed`，`left/top|bottom` 来自 `computePlacement`，在 `useIsomorphicLayoutEffect`（依赖 value/cursor/open）内调用 `getCaretCoordinates(inputRef.current, activeToken.start)` 计算；并监听 `scroll`(capture)/`resize` 重算。
  - `aria-activedescendant` 指向 active 项；各项 `aria-selected={globalIndex===active}`，active 项高亮类；`onMouseEnter` → `setActive(globalIndex)`（Req 3.8）。
  - 跨组渲染时维护"全局可选序号"映射 group/item → 线性 index。
- `select(item)`：
  - 占位项（`insertText===""`）直接返回（Req 4.4）。
  - `const { nextValue, nextCursor } = accept(item, value); onChange(nextValue);`
  - `requestAnimationFrame` 后 `inputRef.current?.setSelectionRange(nextCursor, nextCursor)` 并 `focus()`（在 onChange 引发的重渲染后复位，Req 4.2/4.3）。同时 `setCursor` 经一次 `onSelectionChange`——由 textarea focus/select 自然上报，无需额外通道。
- 既有 `onCaptureChange(open)` 语义保留（Req 5.2）；`if (!shouldRender) return null` 时不挂键盘监听（Req 5.4）。

## Data Models

无新增协议/持久化模型。新增的纯 TS 接口：`CaretCoordinates`、`PlacementInput`、`PlacementStyle`（均在 ui 包内部，非协议）。

## Error Handling

- caret 工具：无 `document` → 返回零坐标；测量异常（理论上不抛）兜底零坐标，浮层退化为 `top-left` 不崩。
- `inputRef.current === null`（首帧/卸载）：跳过定位计算，浮层用安全默认（如贴输入框顶部）或暂不显示坐标直至 ref 就绪；不抛错。
- 空候选 / 无 client：维持现有空安全（`return null`），不挂全局监听。

## Testing Strategy

> 项目硬规则：单元/集成测试 + e2e，且需新鲜运行证据。

### 单元测试（vitest，`packages/ui`）

- `placement.test.ts`：`computePlacement` 纯函数——below 正常、底部空间不足翻转、left 计入 scroll。覆盖 Req 2.3/2.4。
- `nav.test.ts`：`flattenSelectable`（跳过占位项、跨组拍平顺序）、`nextActiveIndex`（环绕、空集）。覆盖 Req 3.5/3.7。
- `caret-coordinates.test.ts`：SSR 守卫（无 document 返回零）、返回结构形状、镜像 div 用后从 DOM 清除（jsdom 不做 layout，故只验证守卫/契约/无副作用残留，不验像素值）。覆盖 Req 2.2。
- `pi-completion-popover.test.tsx`（jsdom + Testing Library）：键盘 ↓↑ 移动 active、Enter 选中调 onChange、Esc 关闭、查询变化重置 active、鼠标悬停同步、占位项不可选、`accept` 的 nextCursor 经 setSelectionRange 被调用（mock textarea）。覆盖 Req 3 / Req 4。

### 集成/e2e（Playwright，隔离 build `NEXT_DIST_DIR=.next-e2e`）

- 真浏览器：键入 `@` → 浮层出现并锚定在光标附近（验证 fixed 定位非贴顶全宽，断言 `position:fixed` 且 left 接近 caret）；`↓` 高亮第二项、`Enter` 选中、token 插入、输入框光标在插入串之后；在文本中间（如 `hello @ world` 光标在 `@` 后）触发补全并仅替换 token、保留尾部 `world`。
- 沿用既有 stub/completion e2e 跑法（参考 `attachment-mention-completion` 的 e2e）。

### 验证门

- `pnpm --filter @blksails/pi-web-ui test`、`pnpm typecheck` 全绿（TS strict、无 any）。
- e2e 用例通过，新鲜输出留证（`kiro-verify-completion`）。
