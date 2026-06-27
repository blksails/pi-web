# Implementation Plan

> 范围限定 `@blksails/pi-web-ui`，不改协议/后端。测试位于 `packages/ui/test/`（vitest jsdom）；e2e 扩展 `e2e/browser/completion.e2e.ts`。

- [x] 1. caret 像素坐标工具（mirror-div，无依赖）
  - 新增 `packages/ui/src/completion/caret-coordinates.ts`：`getCaretCoordinates(el, offset) → {top,left,height}`，克隆关键计算样式到屏外镜像 div，追加零宽 span 读 offset 位置；`typeof document==="undefined"` 守卫返回零坐标；用后移除镜像。
  - 单测 `packages/ui/test/caret-coordinates.test.ts`：SSR 守卫返回零、返回结构契约、调用后 document 无残留镜像节点。
  - _Requirements: 2.1, 2.2, 2.5_

- [x] 2. 定位与导航纯函数
  - 新增 `packages/ui/src/completion/placement.ts`：`computePlacement(input) → {left,top,flip:false}|{left,bottom,flip:true}`。
  - 新增 `packages/ui/src/completion/nav.ts`：`flattenSelectable(groups)`（过滤 `insertText===""`、跨组拍平）、`nextActiveIndex(cur,len,dir)`（环绕、空集返回 0）。
  - 单测 `placement.test.ts`（below/翻转/scroll 计入）、`nav.test.ts`（拍平顺序、跳占位、环绕、空集）。
  - _Requirements: 2.3, 2.4, 3.5, 3.7_

- [x] 3. PromptInput 暴露光标与 textarea
  - 改 `packages/ui/src/elements/prompt-input.tsx`：新增可选 props `inputRef?: RefObject<HTMLTextAreaElement|null>` 与 `onSelectionChange?:(n:number)=>void`；合并内/外 ref；在 `onChange/onSelect/onKeyUp/onClick/onFocus` 上报 `selectionStart`。不改 Enter 提交 / ghost / resize 行为。
  - 单测补充进 `prompt-input` 测试（若无则新建 `packages/ui/test/prompt-input-selection.test.tsx`）：输入/点击上报 selectionStart；外部 inputRef 指向真实 textarea。
  - _Requirements: 1.1_

- [x] 4. PiCompletionPopover 键盘导航 + dismiss
  - 改 `packages/ui/src/completion/pi-completion-popover.tsx`：引入 `active` state + `flattenSelectable` + document `keydown`（↑↓/Enter/Esc，复用 command-palette 范式）；查询变化重置 active；`onMouseEnter` 同步；`aria-selected`/`aria-activedescendant`；Esc 经 `dismissedKey===tokenKey` 门控关闭，token 变化解除。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.8, 3.9_

- [x] 5. PiCompletionPopover caret 锚定定位
  - 同文件：新增 prop `inputRef`；`useIsomorphicLayoutEffect`(value/cursor/open) 调 `getCaretCoordinates` + `computePlacement` 算 `position:fixed` 样式；监听 `scroll`(capture)/`resize` 重算；ref 未就绪时安全降级不崩。容器从贴顶全宽改为 fixed 锚定。
  - _Requirements: 2.3, 2.4_

- [x] 6. 选中插入与光标复位
  - 同文件：`select(item)` 占位项早返回；`accept` 取 `nextValue`+`nextCursor`，`onChange(nextValue)` 后经 `requestAnimationFrame` `setSelectionRange(nextCursor)` + `focus()`。
  - 单测 `packages/ui/test/pi-completion-popover.test.tsx`（jsdom + Testing Library，mock CompletionClient）：↓↑ 改 active、Enter 选中调 onChange、Esc 关闭、占位项不可选、setSelectionRange 收到 nextCursor、查询变化重置 active、鼠标悬停同步。
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 7. PiChat 接线真实光标
  - 改 `packages/ui/src/chat/pi-chat.tsx`：新增 `inputRef` + `cursor` state；`PromptInput` 接 `inputRef`/`onSelectionChange={setCursor}`；`PiCompletionPopover` 用 `cursor={cursor}`（替换 `input.length`）+ `inputRef`；挂载容器调整为 fixed 锚定挂载点；不改命令/ webext 浮层让位关系。
  - _Requirements: 1.2, 1.3, 1.4, 5.2, 5.3_

- [x] 8. 回归与不变量
  - `index.ts` 导出新增公共件（如需）；确认未改协议/后端、未新增第三方依赖（`git diff` 校验 `package.json` 无新增 dep）。
  - `pnpm --filter @blksails/pi-web-ui test` 与 `pnpm typecheck` 全绿。
  - _Requirements: 5.1, 5.4, 5.5_

- [x] 10. `/` 命令面板与 `@` 一致(Req 6)
  - 抽 `completion/use-caret-anchor.ts` 共享 hook,`PiCompletionPopover` 重构改用之。
  - `PiCommandPalette` 加 `inputRef`,用 `useCaretAnchor`(offset=0) fixed 锚定;`PiChat` 去掉 `/` 的 `absolute bottom-full` 全宽容器并传 `inputRef`。
  - 单测:命令面板 fixed 定位 + 更新 pi-chat 集成断言;e2e:slash 面板 `position:fixed`;chrome 真机对比 `/` 与 `@` 一致(left=380/width=256)。
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 9. 浏览器 e2e
  - 扩展 `e2e/browser/completion.e2e.ts`：用例（a）键入 `@index` → 浮层 `position:fixed` 且锚定光标附近（非全宽贴顶）；（b）`↓` 高亮第二项后 `Enter` 选中插入 token；（c）中间位置 `hello @index world`（光标在 token 内）→ 仅替换 token、保留 `world`、光标在插入串后。
  - 用既有隔离 build 跑法（`NEXT_DIST_DIR=.next-e2e` + external server + `PI_WEB_STUB_AGENT=1`），留新鲜证据。
  - _Requirements: 1.3, 2.3, 3.1, 3.3, 4.3_
