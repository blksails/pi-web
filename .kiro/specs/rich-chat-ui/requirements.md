# Requirements Document

## Introduction

本特性把 `@blksails/ui` 的聊天界面升级为对标 AI Elements 参考示例的**富聊天界面**。在不破坏现有最小 `<PiChat>` 的前提下,**新增** `<PiChatPro>` 组件(及其支撑的无状态元件与数据 hooks),提供:富 PromptInput(附件、模型选择器、语音输入、联网开关、随流式状态变化的发送按钮)与完整 Conversation(自动滚动与回到底部、消息分支/多版本切换、引用来源折叠、思考折叠、建议气泡)。所有能力**接到 pi 的真实 RPC 能力**(`get_available_models`/`setModel`/`fork`/`get_fork_messages`/`get_commands`/prompt `images`),不使用写死的 mock 数据。最终由 app-shell 消费 `<PiChatPro>`。权威设计与决策见 `.kiro/specs/rich-chat-ui/brief.md`(含已定稿 Decisions)与 `PLAN.md` §1/§4/§13.1/§13.4。

## Boundary Context

- **In scope**:
  - 在 `@blksails/ui` 落地 AI Elements 风格无状态元件(attachments / model-selector / conversation / message(+branch) / reasoning / sources / suggestions / prompt-input / speech-input)。
  - 附件呈现增强(对齐 AI Elements `attachments`):图片缩略图的悬停大图预览、可切换布局变体(紧凑 inline / 网格 grid / 列表 list)、附件名称与类型标签呈现;真实附件处理仍仅限图片(承接 Req 3,非图片维持降级提示)。
  - 富装配组件 `<PiChatPro>`,接线 `@blksails/react` 的数据 hooks 与现有渲染器注册表。
  - `@blksails/react` 新增数据 hooks:模型列表、附件(图片)、消息分支、建议(commands)。
  - app-shell 切换到 `<PiChatPro>`;组件/集成单测 + 浏览器 e2e。
- **Out of scope**:
  - 后端协议/会话引擎改动;仅当分支/附件确需新 chunk/DTO 时记为对 `protocol-contract`/会话引擎的 **upstream 依赖**,本特性不实现这些后端改动。
  - 云端 STT(本期仅浏览器 Web Speech / 本地转写);完整 fork 树可视化;非图片附件的真实上传处理(仅 UI 降级提示)。
  - 多租户/鉴权/沙箱(归生产硬化)。
- **Adjacent expectations**:
  - 依赖 pi RPC 提供 `get_available_models`/`setModel`/`fork`/`get_fork_messages`/`get_commands` 与 prompt `images` 支持;当某能力在当前会话不可用时,对应 UI 必须优雅降级(隐藏或禁用 + 可读提示),不得阻断基本对话。
  - 主题继承宿主 shadcn CSS 变量;不引入与 pi 无关的写死模型列表。

## Requirements

### Requirement 1: 富 PromptInput 组合与提交
**Objective:** 作为 pi-web 终端用户,我想要一个集成附件、动作菜单与状态化发送按钮的富输入区,以便在一个控件内完成多模态输入与发送。

#### Acceptance Criteria
1. The PiChatPro shall 在输入区呈现一个多行文本框、动作菜单(附件/截图)、模型选择器、语音输入按钮、联网开关与发送按钮。
2. When 用户在文本框输入非空文本并触发提交(点击发送或按 Enter), the PiChatPro shall 将当前文本(及已添加的图片附件)作为一条 user 消息发送给当前会话。
3. While 文本框为空且无任何附件, the PiChatPro shall 禁用发送按钮以阻止空消息提交。
4. When 用户在文本框按下 Shift+Enter, the PiChatPro shall 插入换行而不提交。
5. Where 宿主提供自定义 placeholder 或初始模型等 props, the PiChatPro shall 采用这些 props 覆盖默认值。

### Requirement 2: 发送按钮反映流式状态
**Objective:** 作为终端用户,我想要发送按钮随会话流式状态变化,以便我知道当前是可发送、生成中还是出错,并能中断生成。

#### Acceptance Criteria
1. While 会话状态为 ready(空闲), the PiChatPro shall 显示"发送"态按钮,且仅在有可发送内容时可用。
2. While 会话状态为 submitted 或 streaming(生成中), the PiChatPro shall 显示"停止/中断"态按钮。
3. When 用户在生成中点击"停止"态按钮, the PiChatPro shall 调用中断能力终止当前生成。
4. If 会话状态为 error, the PiChatPro shall 显示可读的错误态并允许用户重试或继续输入。

### Requirement 3: 图片附件
**Objective:** 作为终端用户,我想要通过拖拽、粘贴或选择文件添加图片附件,以便发送多模态提问。

#### Acceptance Criteria
1. When 用户拖拽图片到输入区、粘贴图片或经动作菜单选择图片文件, the PiChatPro shall 将其加入待发送附件列表并显示缩略图与移除按钮。
2. When 用户提交带图片附件的消息, the PiChatPro shall 将图片以 pi 支持的形式(`images`/ImageContent,base64)随 prompt 一并发送。
3. When 用户点击某个附件的移除按钮, the PiChatPro shall 从待发送列表移除该附件。
4. If 用户尝试添加非图片文件, the PiChatPro shall 提示"暂不支持该类型附件"并不将其加入发送列表,且不阻断已有图片或文本的发送。
5. If 当前会话或 agent 不支持图片输入, the PiChatPro shall 隐藏或禁用附件入口并给出可读提示。

### Requirement 4: 模型选择器
**Objective:** 作为终端用户,我想要从一个可搜索、按 provider 分组的列表中选择模型,以便切换当前会话使用的模型。

#### Acceptance Criteria
1. When 模型选择器打开, the PiChatPro shall 通过 `get_available_models` 获取可用模型并按 provider 分组展示,当前选中模型带勾选标记。
2. When 用户在模型选择器的搜索框输入关键字, the PiChatPro shall 按模型名/provider 过滤展示结果。
3. When 用户选择某个模型, the PiChatPro shall 调用 `setModel` 切换当前会话模型并在选择器上更新选中标记。
4. If `get_available_models` 不可用或返回空, the PiChatPro shall 隐藏或禁用模型选择器并保留会话默认模型,不阻断对话。
5. The PiChatPro shall 不展示任何与 pi 无关的写死模型项;所有模型项必须来自 `get_available_models`。

### Requirement 5: 语音输入
**Objective:** 作为终端用户,我想要用语音转写填入输入框,以便免打字提问。

#### Acceptance Criteria
1. Where 浏览器支持 Web Speech API, the PiChatPro shall 提供语音输入按钮。
2. When 用户点击语音输入按钮并讲话, the PiChatPro shall 将转写文本填入输入框(追加到当前内容)。
3. When 用户再次点击以停止录音, the PiChatPro shall 停止监听并保留已转写文本。
4. If 浏览器不支持 Web Speech API 或用户拒绝麦克风权限, the PiChatPro shall 隐藏或禁用语音按钮并给出可读提示,不影响其他输入方式。

### Requirement 6: 联网开关
**Objective:** 作为终端用户,我想要切换"联网/网络搜索"意图,以便让 agent 知晓本次提问是否期望联网。

#### Acceptance Criteria
1. The PiChatPro shall 在输入区提供一个联网开关,默认关闭。
2. When 用户切换联网开关, the PiChatPro shall 持久化该状态于当前输入会话并在 UI 上反映。
3. When 用户在联网开关开启时提交消息, the PiChatPro shall 将该意图随消息传达给会话(以 pi 支持的提示/元数据形式)。
4. If pi 侧无对应联网能力, the PiChatPro shall 仍可切换开关但仅作为提示传递,不报错。

### Requirement 7: Conversation 自动滚动
**Objective:** 作为终端用户,我想要对话视图在新内容到达时自动滚动并提供回到底部入口,以便始终看到最新输出又能自由回看历史。

#### Acceptance Criteria
1. While 用户视图停留在底部且有新消息或流式增量到达, the PiChatPro shall 自动滚动到底部。
2. When 用户向上滚动离开底部, the PiChatPro shall 停止自动滚动并显示"回到底部"按钮。
3. When 用户点击"回到底部"按钮, the PiChatPro shall 平滑滚动到最新消息并恢复自动滚动。

### Requirement 8: 消息分支与多版本切换
**Objective:** 作为终端用户,我想要对同一轮提问保留多个版本并在其间切换,以便比较不同回答。

#### Acceptance Criteria
1. Where 当前会话支持 `fork`/`get_fork_messages`, the PiChatPro shall 为存在多个版本的消息显示分支切换控件(上一个/下一个与"第 N / 共 M"指示)。
2. When 用户在某条用户消息处重新发送/编辑后重发, the PiChatPro shall 经由 `fork` 创建一个同级版本并展示新分支。
3. When 用户切换分支版本, the PiChatPro shall 经由 `get_fork_messages` 加载对应分支的消息序列并更新对话视图。
4. If `fork`/`get_fork_messages` 在当前会话不可用, the PiChatPro shall 隐藏分支控件并退化为线性会话,不阻断对话。

### Requirement 9: 思考与引用来源折叠
**Objective:** 作为终端用户,我想要折叠/展开模型的思考过程与引用来源,以便控制信息密度。

#### Acceptance Criteria
1. When 某条助手消息包含思考(reasoning)内容, the PiChatPro shall 以可折叠区块呈现,默认折叠并可展开。
2. While 思考内容正在流式产生, the PiChatPro shall 在思考区块内实时展示增量。
3. Where 某条助手消息包含引用来源(sources), the PiChatPro shall 以可折叠区块列出来源,默认折叠。
4. If 某条消息既无思考也无来源, the PiChatPro shall 不渲染对应折叠区块。

### Requirement 10: 建议气泡
**Objective:** 作为终端用户,我想要看到可点击的建议气泡(命令/技能/预设),以便快速发起常用操作。

#### Acceptance Criteria
1. When 会话就绪, the PiChatPro shall 通过 `get_commands` 获取可用命令/技能并结合可配置预设,以建议气泡形式展示。
2. When 用户点击某个建议气泡, the PiChatPro shall 将其内容填入输入框或直接发送(依该建议的配置)。
3. If `get_commands` 不可用或返回空且无预设, the PiChatPro shall 不渲染建议气泡区域。

### Requirement 11: 非破坏共存、集成与无障碍
**Objective:** 作为集成方/维护者,我想要新富组件与现有组件并存且可被宿主复用,以便平滑升级且不回归既有功能。

#### Acceptance Criteria
1. The 富组件 shall 作为 `@blksails/ui` 的新增导出 `<PiChatPro>` 提供,且保留现有 `<PiChat>` 不变。
2. When 现有测试套件(基线 483 测试)与类型检查运行, the 仓库 shall 保持全部通过(无回归)。
3. While app-shell 加载, the app shall 渲染 `<PiChatPro>` 作为默认聊天界面并完成一次基本对话(浏览器 e2e 可验证)。
4. The PiChatPro 及其元件 shall 支持键盘操作与基本 ARIA 语义(尤其对话框、模型选择器、分支切换、建议气泡)。
5. The PiChatPro shall 通过宿主的 shadcn CSS 变量获取主题,不硬编码颜色主题。

### Requirement 12: 附件呈现增强(悬停预览、布局变体与元信息)
**Objective:** 作为终端用户,我想要附件以更可读的方式呈现——悬停查看大图、在不同位置以合适布局展示、看到文件名与类型——以便在输入区与已发送消息中都能清晰辨识附件,而不改变本期"仅图片"的处理边界。

#### Acceptance Criteria
1. While 待发送列表或已发送消息中存在图片附件, the Attachments 元件 shall 呈现其缩略图、文件名与可读的附件类型标签。
2. Where 宿主启用悬停预览, when 用户将指针悬停于某图片附件缩略图或经键盘聚焦该附件, the Attachments 元件 shall 展示该图片的放大预览,并在指针移开或失焦时关闭该预览。
3. Where 宿主指定布局变体(紧凑 inline / 网格 grid / 列表 list), the Attachments 元件 shall 按该变体排列附件项;While 宿主未指定变体, the Attachments 元件 shall 采用其默认变体并保持与现有 `panel`/`compact` 用法向后兼容。
4. If 某附件缺少可用缩略图而无法生成预览, the Attachments 元件 shall 以代表该附件类型的占位图标替代缩略图,并仍呈现其文件名与移除按钮。
5. The 附件呈现增强 shall 不改变 Requirement 3 的处理边界——仅图片被真实加入发送列表,非图片维持"暂不支持该类型附件"的降级提示且不入列、不阻断已有图片或文本的发送。
6. The Attachments 元件的悬停预览、移除与布局切换 shall 保持键盘可达与基本 ARIA 语义,并经宿主 shadcn CSS 变量取色、不硬编码颜色。
