# Brief: rich-chat-ui

> 语言:zh(后续 spec.json.language = "zh")。权威设计参考:`PLAN.md` §1/§4/§13.1/§13.4、`ui-components` 与 `react-client` 两个 spec 的 design.md。
> 状态:discovery 完成,**等待 context 压缩后再进入 spec/实现**。

## Problem
- **谁**:使用 pi-web 的终端用户与集成方。
- **痛点**:当前 `@blksails/ui` 的 `<PiChat>` 是最小实现(纯文本输入 + 基础消息渲染)。缺少现代 AI 聊天产品的核心交互:**附件上传、模型选择器(带 logo/搜索)、语音输入、联网开关、建议气泡、消息分支/多版本、引用来源折叠、思考折叠、自动滚动、随状态变化的发送按钮**。用户给出了两份 AI Elements 参考(富 PromptInput + 完整 Conversation),要据此对齐。

## Current State
- `@blksails/ui`:`<PiChat>`(part-renderer + 简单 PromptInput)、`<PiToolPart>`、`<PiReasoning>`、控制面板(model/thinking/stats/command-palette)、`<PiPermissionDialog>`、渲染器注册表。
- 仓库内**无** `components/ai-elements/*`;参考示例从 AI Elements registry 导入(attachments / model-selector / conversation / message(+branch) / reasoning / sources / suggestion / speech-input / prompt-input)。
- `@blksails/react`:`PiTransport` + `usePiSession` / `usePiControls`(model/thinking/abort/steer/stats/commands)/ `useExtensionUI`。已实现且测试通过。

## Desired Outcome
- 一个**富聊天界面**,具备参考示例的交互能力,且全部**接到 pi 的真实能力**(非写死 mock):
  - PromptInput:附件(拖拽/粘贴/多文件)、ActionMenu(加附件/截图)、SpeechInput(转写填入)、联网开关、ModelSelector(可搜索 + provider logo 分组 + 勾选)、随 `useChat` 流式态变化的 Submit。
  - Conversation:自动滚动 + 回到底部按钮;Message 支持**多版本/分支**切换;Reasoning 折叠;Sources 折叠;Suggestions 气泡。
- 默认源(custom/CLI 两模式)都能用;主题继承 shadcn CSS 变量。

## Approach
**选 A:把 AI Elements registry 组件引入 `@blksails/ui`,组装富 `<PiChat>`(或新增 `<PiChatPro>`),消费 `@blksails/react` hooks。** app 仅消费,符合 §13.1 分层开放包设计、可被第三方复用。
- 落地 AI Elements 组件:优先 `npx ai-elements@latest add <component>`;若 registry 需联网受限,则在 `@blksails/ui/src/elements/` 按 registry 源实现等价组件(shadcn 风格,已具备 radix/clsx/tailwind-merge/streamdown/lucide 依赖)。
- 新增/扩展 hooks(在 `@blksails/react`):模型列表(`get_available_models`)、附件→prompt `images`、分支(`fork`/`get_fork_messages`/`clone`)、建议来源(`get_commands` + 预设)。
- 渐进:保留现有最小 `<PiChat>`,新增富组件;app-shell 切换到富版本。
- **被否方案 B**:直接在 Next app `components/ai-elements/*` 组装(最贴近示例、最快),但不进共享包、复用性差。仅当明确只要 app 内一次性使用时才选。

## Scope
- **In**:
  - AI Elements 组件集落地到 `@blksails/ui`(attachments / model-selector / conversation / message(+branch) / reasoning / sources / suggestions / prompt-input / speech-input 等)。
  - 富 `<PiChat>` 组装 + 与 pi 能力接线(见下「pi 映射」)。
  - 支撑性 hooks(模型列表 / 附件 / 分支 / 建议)在 `@blksails/react`。
  - 组件/集成测试 + 浏览器 e2e(基本对话 + 附件 + 模型切换 + 分支 + 建议点击)。
- **Out**:
  - 后端协议/会话引擎改动(若分支/附件需要新 RPC,记为 upstream 依赖,不在本 spec 实现)。
  - 语音的服务端 STT(本期用浏览器 Web Speech / 本地转写;云端 STT 不做)。
  - 截图工具的系统级实现细节(用浏览器能力,降级可接受)。

## Boundary Candidates
- **元件层**(`@blksails/ui/src/elements/*`):无状态 AI Elements 组件(可独立测)。
- **装配层**(`<PiChat>` 富版):把元件 + hooks + 渲染器注册表组装。
- **数据 hooks 层**(`@blksails/react`):models / attachments / branches / suggestions 的 pi 接线(可独立单测,mock transport)。
- **app 集成层**:app-shell 用富 `<PiChat>` + e2e。

## Out of Boundary
- 不改 `@blksails/protocol` 契约,除非分支/附件确需新 chunk/DTO(那样先回 protocol spec)。
- 不做多租户/鉴权/沙箱(归生产硬化)。
- 不引入与 pi 无关的写死模型列表(模型必须来自 `get_available_models`)。

## Upstream / Downstream
- **Upstream**:`@blksails/react`(hooks/transport)、`@blksails/ui`(现有组件 + 注册表)、`@blksails/protocol`(UIMessage/SSE 帧;分支/附件如需新增帧需先改它)、pi RPC(`get_available_models`/`setModel`/`fork`/`get_fork_messages`/`get_commands`/prompt images)。
- **Downstream**:`app-shell`(消费富 `<PiChat>`);未来 `@pi-web/embed`(Web Component 包富 UI)。

## Existing Spec Touchpoints
- **Extends**:`ui-components`(@blksails/ui — 新增元件 + 富 PiChat + 注册表扩展);`react-client`(@blksails/react — 新增 models/attachments/branches/suggestions hooks)。
- **Adjacent**:`app-shell`(装配点切换);`protocol-contract`(仅当需新帧/DTO)。

## pi 映射(AI Elements 能力 → pi 能力)
| AI Elements | pi 接线 |
|---|---|
| ModelSelector 列表 | RPC `get_available_models` → 分组/搜索;选择 → `usePiControls.setModel` |
| Submit status | `useChat` 流式态(submitted/streaming/ready/error) |
| Attachments | prompt 的 `images`(base64/ImageContent);非图片附件按 pi 支持度降级 |
| Message 分支/多版本 | `fork(entryId)` / `get_fork_messages` / `clone`;UI 的 branch 选择映射到 fork 树 |
| Reasoning 折叠 | 现有 `reasoning-*` chunk(已实现) |
| Sources 折叠 | 工具结果/引用(若 agent 产出);否则隐藏 |
| Suggestions 气泡 | `get_commands`(extension/prompt/skill)+ 可配置预设;点击填入或直接发送 |
| SpeechInput | 浏览器 Web Speech API 本地转写填入输入框 |
| 联网开关 | 透传为 prompt 提示/或预留(pi 侧由 agent/扩展决定) |

## Constraints
- TypeScript strict、no any;主题走 shadcn CSS 变量;基本 a11y(键盘/aria,尤其 dialog/palette/branch)。
- AI Elements 落地优先官方 CLI;离线/受限环境用 registry 源等价实现(已具备依赖)。
- 保持现有 483 测试 + typecheck 全绿,不回归;Node runtime/SSE 约束不变。

## Decisions(已定稿 — 自治模式 `--auto`,采纳 brief 推荐项)
1. **落地位置**:方案 A — 富组件进 `@blksails/ui`(可复用、符合 §13.1 分层开放包);app 仅消费。
2. **替换 vs 新增**:**新增** `<PiChatPro>` 与现有 `<PiChat>` 并存(非破坏性,保现有 483 测试全绿);app-shell 切换到 `<PiChatPro>`,`<PiChat>` 保留为最小实现。
3. **消息分支**:本期接 pi `fork`/`get_fork_messages`,但仅做**线性分支切换**(每条用户消息的多次重发 = 同级版本),不做完整 fork 树可视化;复杂 fork 树映射记为 downstream follow-up。若 RPC 不可用则降级为纯 UI 版本切换并标 upstream 依赖。
4. **附件**:本期**仅图片**(pi `images` 一等支持,base64/ImageContent);非图片附件 UI 接受但提示"暂不支持"并降级(不阻断发送)。
5. **模型分组**:按 **provider 自动分组**(来自 `get_available_models` 的 provider 字段),搜索框过滤;不引入 chef 维度(示例的 chef 概念本期不做)。

> 以上为 spec/实现的权威决策输入。原始 Open Questions 已据此 resolved。
