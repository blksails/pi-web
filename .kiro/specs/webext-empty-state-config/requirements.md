# Requirements Document

## Introduction
聊天空状态(EmptyState,即 "What can I help with?" 欢迎页)目前显示的标题、副标题以及建议按钮,要么写死在宿主默认值中,要么由 agent 的 slash 命令动态生成;agent 作者无法通过其 `.pi/web` 声明式配置(Tier5 `WebExtConfig`)自定义这块内容。本特性让 agent 作者仅凭声明式配置(零代码、零 bundle)即可配置空状态的标题、副标题与建议项,并控制这些建议项与 agent 自身 slash 命令的合并方式。消费路径对齐现有 `theme`/`layout` 两个 Tier5 字段的既有惯例,保持向后兼容:未配置时行为与当前完全一致。

## Boundary Context
- **In scope**:
  - 在 `WebExtConfig` 增加可序列化的 `empty` 配置(标题、副标题、建议项列表、合并策略)。
  - 建议项复用既有可序列化 `Suggestion` 结构(`id`/`label`/`value`/`mode`)。
  - 空状态的标题/副标题/建议项在加载了相应配置的 agent 下按配置渲染。
  - 配置建议项与 agent slash 命令的三种合并策略:append(默认)、prepend、replace。
  - 配置非法或缺失时的容错与向后兼容。
- **Out of scope**:
  - 空状态的完全自定义布局(已由既有 Tier1 `empty` slot 覆盖,本特性不改动)。
  - 非空状态(对话进行中)的建议气泡渲染逻辑。
  - agent slash 命令本身的来源、拉取与映射规则(沿用现状)。
  - 宿主 app 通过 React props 直接定制空状态的能力(已存在,本特性不移除)。
- **Adjacent expectations**:
  - 依赖既有 agent web 扩展加载链路把 `manifest.config` 合成为运行时 `WebExtension.config`(纯声明式路径,零 bundle)。
  - 依赖既有 `Suggestion` 数据结构与空状态渲染组件,不改变其对外契约。

## Requirements

### Requirement 1: 声明式空状态配置 Schema
**Objective:** 作为 agent 作者,我想在 `.pi/web` 的声明式配置中描述空状态的标题、副标题与建议项,以便无需编写任何 UI 代码即可定制欢迎页。

#### Acceptance Criteria
1. The WebExtConfig schema shall 接受一个可选的 `empty` 对象字段,与既有 `theme`、`layout` 字段并列。
2. Where `empty` 字段存在, the WebExtConfig schema shall 接受其下可选的 `title`(字符串)、`subtitle`(字符串)、`starters`(建议项数组)、`mergeCommands`(枚举)子字段。
3. The WebExtConfig schema shall 要求 `starters` 中每一项包含 `id`、`label`、`value`(均为字符串)与 `mode`(取值 `fill` 或 `send`)。
4. If `starters` 中某一项的 `mode` 不是 `fill` 或 `send`, then the WebExtConfig schema shall 拒绝该配置并报告校验失败。
5. If `mergeCommands` 取值不在 `append`、`prepend`、`replace` 之内, then the WebExtConfig schema shall 拒绝该配置并报告校验失败。
6. Where `empty` 字段整体省略, the WebExtConfig schema shall 校验通过且不影响 `theme`/`layout` 的既有解析。

### Requirement 2: 空状态标题与副标题按配置渲染
**Objective:** 作为 agent 作者,我想让加载我的扩展的会话在空状态展示我配置的标题与副标题,以便欢迎页符合我的产品语气。

#### Acceptance Criteria
1. When 一个声明了 `empty.title` 的扩展被加载且会话处于空状态, the chat empty state shall 以该 `title` 作为标题文本渲染。
2. When 一个声明了 `empty.subtitle` 的扩展被加载且会话处于空状态, the chat empty state shall 以该 `subtitle` 作为副标题文本渲染。
3. Where 扩展未声明 `empty.title`, the chat empty state shall 使用宿主默认标题 "What can I help with?"。
4. Where 扩展未声明 `empty.subtitle`, the chat empty state shall 使用宿主默认副标题 "Ask a question, write code, or explore ideas."。
5. While 会话已有消息(非空状态), the chat empty state shall 不被渲染,标题/副标题配置不产生可见效果。

### Requirement 3: 空状态建议项按配置渲染
**Objective:** 作为 agent 作者,我想在空状态展示我精选的建议项,以便引导用户使用我的 agent 的关键能力。

#### Acceptance Criteria
1. When 一个声明了 `empty.starters` 的扩展被加载且会话处于空状态, the chat empty state shall 渲染配置中每个建议项,按钮文本取自该项 `label`。
2. When 用户点击一个 `mode` 为 `fill` 的配置建议项, the chat input shall 把该项 `value` 填入输入框而不直接发送。
3. When 用户点击一个 `mode` 为 `send` 的配置建议项, the chat session shall 直接以该项 `value` 发送消息。
4. Where 扩展未声明 `empty.starters` 且无可用 agent 命令, the chat empty state shall 回落到宿主既有默认起始建议。

### Requirement 4: 配置建议项与 agent 命令的合并策略
**Objective:** 作为 agent 作者,我想控制我配置的建议项与 agent 自身 slash 命令在空状态中的共存方式,以便既保留命令发现性又能突出我的精选项。

#### Acceptance Criteria
1. Where `empty.mergeCommands` 为 `append` 或被省略, the chat empty state shall 先展示 agent 命令、再展示配置建议项。
2. Where `empty.mergeCommands` 为 `prepend`, the chat empty state shall 先展示配置建议项、再展示 agent 命令。
3. Where `empty.mergeCommands` 为 `replace` 且配置建议项非空, the chat empty state shall 只展示配置建议项,不展示 agent 命令。
4. If `empty.mergeCommands` 为 `replace` 但配置建议项为空, then the chat empty state shall 回落为展示 agent 命令,避免空状态无任何建议。
5. The chat empty state shall 在合并后保持各建议项点击行为(`fill`/`send`)与其 `mode` 一致。

### Requirement 5: 宿主消费链路与既有定制兼容
**Objective:** 作为宿主集成者,我想让扩展声明式空状态配置经由与 `theme`/`layout` 一致的链路生效,以便定制机制保持统一且互不冲突。

#### Acceptance Criteria
1. When 宿主装配聊天界面且扩展声明了 `empty` 配置, the host assembly shall 把该配置翻译为聊天组件可消费的标题/副标题/建议项/合并策略输入。
2. The chat component shall 仅消费显式传入的空状态 props(标题/副标题/建议项/合并策略),不直接读取扩展配置;因此当宿主显式传入这些 props 时其值即为最终值,扩展配置仅作为宿主翻译扩展配置时的默认来源,二者不在聊天组件层竞争。
3. Where 既有 Tier1 `empty` slot 提供了整块空状态替换, the chat empty state shall 维持既有优先级行为,本特性不改变其结果。
4. The host assembly shall 在扩展未声明 `empty` 配置时不向聊天组件注入任何空状态相关输入,使行为与本特性引入前一致。

### Requirement 6: 向后兼容与默认行为
**Objective:** 作为现有用户与现有 agent,我想在不修改任何配置的情况下保持空状态行为不变,以便升级无感知、无回归。

#### Acceptance Criteria
1. While 没有任何扩展声明 `empty` 配置, the chat empty state shall 渲染与本特性引入前完全一致的标题、副标题与建议项。
2. The suggestion merge logic shall 在未指定合并策略时采用 `append`,与既有 "命令在前、预设在后" 的合并顺序一致。
3. When 一个仅声明 `theme` 或 `layout`(不含 `empty`)的既有扩展被加载, the WebExtConfig consumption shall 与本特性引入前行为一致。
