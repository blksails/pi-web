# Research & Design Decisions

## Summary
- **Feature**: `aigc-tools-interactive-params`
- **Discovery Scope**: Extension(在 `aigc-tools-refactor` 之上增强 `image_generation`/`image_edit`)
- **Key Findings**:
  - pi SDK 0.79.6 工具 `execute` 的**第 5 参是 `ExtensionContext`**(`{ ui, mode, hasUI, ... }`);`ctx.ui` 是 `ExtensionUIContext`,提供 `select(title, options[], opts?)→string|undefined`、`input(title, placeholder?, opts?)→string|undefined`、`confirm(title, message)→boolean`、`notify(message, type?)`。`hasUI` 在 TUI 与 RPC mode 为 true,print/json 为 false。
  - **pi-web 已桥接 runner 工具的 ctx.ui**:`packages/server/src/session/pi-session.ts` 订阅 `channel.onExtensionUIRequest(req => handleExtensionUIRequest(req))`,登记挂起表并广播 control 帧;前端经 `packages/react/src/hooks/use-extension-ui.ts` + `packages/ui/src/elements/pi-interaction.tsx` + `packages/ui/src/ui/dialog.tsx` 渲染弹窗并回传。故工具内 `ctx.ui.select/input` 会在 pi-web 弹出真实对话框。
  - 当前 `compile-tool.ts` 的 `execute` 仅用前 3 参(toolCallId/params/signal),**第 5 参 ctx 未接入** —— 本规格接入它。

## Research Log

### ctx.ui 可用性与 pi-web 桥接
- **Sources**: `@earendil-works/pi-coding-agent@0.79.6` `dist/core/extensions/types.d.ts`(`ExtensionUIContext` L67-75、`ExtensionContext` L208-214、`execute` L361);`packages/server/src/session/pi-session.ts`(L89 `onExtensionUIRequest`、L353 `handleExtensionUIRequest`);前端 `use-extension-ui.ts`/`pi-interaction.tsx`/`dialog.tsx`。
- **Findings**: 工具发起的交互在 RPC mode 经 ExtensionUIRequest 上行 → server 挂起表 + control 帧 → 前端弹窗 → 用户响应回传 runner 兑现 Promise。`extension-ui-surfaces`/`extension-ui-inline-interaction` spec 已落地此链路。
- **Implications**: 「缺失即交互补全」在 pi-web 完全可行,无需自建交互层。

## Design Decisions

### Decision: 必选项 = schema 可选 + 执行层交互补全
- **Alternatives**:
  1. schema 标 `required` — LLM 漏传被参数校验拦截报错,违背"不报错"。
  2. schema 可选 + 执行层经 ctx.ui 补全(选定)。
- **Selected**: `model`/`size`/`prompt` 不标 `required`;`ToolSpec.requiredParams: InteractionSpec[]` 声明补全方式;`compile-tool` 在 buildBody 前对缺失项交互补全。
- **Rationale**: 唯一能同时满足「业务必选」与「缺失不报错」的形态。

### Decision: 触发条件与降级
- **触发**: 仅当 `merged[param]` 为空(undefined/"")才交互;已有值跳过(R7)。
- **降级**(`hasUI=false`):`model`→`tool.defaultModel`;`size`→`spec.fallback`;`prompt` 无兜底→`ok:false`。保现有无 UI 测试(node e2e/单测以 `{}` 作 ctx)走默认通过。
- **取消**: `select`/`input` 返回 `undefined` → `ok:false`("用户取消"),在 buildBody 前,故不触发 provider 调用(R5)。

### Decision: model 选项动态化
- **Selected**: `InteractionSpec.options` 含哨兵 `"$models"` 时,运行时展开为 `tool.models.map(m=>m.model)`;否则用静态字符串数组(size 预设)。
- **Rationale**: model 列表是工具数据,避免在 spec 重复维护。

### Decision: prompt 语言保持
- **Selected**: 工具 description 与 `prompt` 字段描述强指示「用用户原语言、不翻译」;缺失时用户经 `input` 亲自输入原文。pi SDK 下最强组合(无法强制 LLM 不翻译)。

## Risks & Mitigations
- **ctx 在某些调用路径为 undefined / 缺 ui** — 代码以 `ctx?.hasUI === true && ctx?.ui` 守卫;不满足即走降级,不抛错。
- **现有集成测试以 `{}` 作 ctx 触发新降级路径** — size 给 `fallback`(如 `auto`/`1024x1024`),model 回退 `defaultModel`,prompt 测试均显式传值,故现有测试不被破坏。
- **交互在 e2e 阻塞** — 交互仅"缺失才触发";浏览器 e2e 用「不传必选项」prompt 主动触发并自动应答弹窗。

## References
- 既有 spec:`.kiro/specs/aigc-tools-refactor/`(被本规格增强)
- pi SDK `ExtensionUIContext` / `ExtensionContext`(0.79.6)
