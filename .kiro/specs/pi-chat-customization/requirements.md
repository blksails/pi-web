# Requirements Document

## Introduction

本规格为 pi-web 的 `PiChat` 建立一套面向集成方开发者的「四维可定制契约」,使其在不修改 `@pi-web/ui` 源码的前提下完成外观与装配的定制。四个维度为:(1) 主题与 CSS 变量;(2) 整块区域插槽 slots;(3) 细粒度组件覆盖 components;(4) 布局预设 layout 与图标主题 icons。

架构边界已与干系人确认:外观定制完全归属前端,agent source 不参与外观驱动;agent 仅负责内容/语义/交互流(server-driven UI 与 `ctx.ui` 交互),其行为不受本规格影响。本规格只定义「单个 PiChat 的可定制契约」,作为后续任意「多实例打包形态」的稳定地基;多实例打包本期不实现。

本规格的「用户」即集成方开发者:验收以开发者通过公开 API 能达成的、可观察的运行时效果为准。

## Boundary Context

- **In scope**:
  - `@pi-web/ui` 包内,单个 `PiChat` 的主题、slots、components、layout、icons 五类公开定制入口(归为四维)。
  - 全部以非破坏式新增方式提供:现有 `slots`(header/footer/sidebar/messageActions)、三个渲染注册表、CSS 变量用法保持原状仍可运行。
  - 可由下游 Tailwind 配置一行引用的样式预设导出。
  - 覆盖关键定制路径的端到端测试。
- **Out of scope**:
  - 由 agent source 驱动外观的任何机制(如 `emitAppearance`、`ambient.appearance`、agent 自带 React 组件、运行时加载 agent 前端包)。
  - 协议层 / server 层 / `@pi-web/react` / `@pi-web/agent-kit` 的改动。
  - 多 PiChat 实例的打包形态(工厂 / 预设变体 / preset 对象)。
  - Artifact 分栏的完整功能实现;`split` 仅作为布局骨架预设提供让位区域,区域内容由现有插槽/子节点承接。
- **Adjacent expectations**:
  - 主题模式取值(light / dark / system)与协议层既有的 `settings.theme` 配置语义一致;本规格消费该取值,不重新定义其来源。
  - agent 的 server-driven UI(`data-pi-ui`)与交互流(`extension-ui`)继续按既有管线渲染,不因本规格而改变。

## Requirements

### Requirement 1: 向后兼容与非破坏式扩展

**Objective:** 作为既有 PiChat 集成方,我希望升级到含本能力的版本后无需改动现有代码,以便平滑获得新定制能力而不承担迁移成本。

#### Acceptance Criteria
1. The PiChat shall 在未提供任何新增定制入口(components/icons/layout/theme/新 slots)时,渲染出与本能力引入前一致的默认外观与行为。
2. Where 集成方使用既有的 `slots`(header/footer/sidebar/messageActions)、渲染注册表(toolRenderer/dataPartRenderer/uiComponent)或 CSS 变量, the PiChat shall 保持其原有效果不变。
3. The PiChat shall 将所有新增定制入口设为可选;当其缺省时不影响任何既有行为。

### Requirement 2: 主题模式与暗色/跟随系统

**Objective:** 作为集成方开发者,我希望以声明方式设定亮色/暗色/跟随系统主题,以便无需手写 DOM 类切换逻辑即可获得正确的明暗外观。

#### Acceptance Criteria
1. When 集成方将主题模式设为 `dark`, the PiChat shall 应用暗色配色令牌。
2. When 集成方将主题模式设为 `light`, the PiChat shall 应用亮色配色令牌。
3. While 主题模式为 `system`, the PiChat shall 依据操作系统的明暗偏好选择对应配色,且当系统偏好在运行时变化时随之更新。
4. When 集成方未指定主题模式, the PiChat shall 默认采用 `system` 行为。
5. The PiChat 主题取值 shall 接受 `light` / `dark` / `system` 三值,与 `settings.theme` 既有语义保持一致。

### Requirement 3: 品牌令牌与样式预设导出

**Objective:** 作为集成方开发者,我希望通过覆盖设计令牌定制品牌色/圆角/字体,并以最小配置接入构建,以便统一应用品牌外观。

#### Acceptance Criteria
1. The PiChat shall 通过既有 CSS 变量(颜色、圆角等令牌)驱动全部组件配色,使集成方覆盖变量即可全局换肤而无需改组件代码。
2. Where 集成方覆盖品牌令牌(如主色、圆角), the PiChat shall 在亮色与暗色下分别采用集成方提供的对应取值。
3. The `@pi-web/ui` 包 shall 导出一份样式预设,使下游构建配置能够以一行引用方式获得本包的令牌到工具类映射,而无需手工重复声明该映射。

### Requirement 4: 整块区域插槽扩展(background 与 empty)

**Objective:** 作为集成方开发者,我希望整块替换对话背景层与空态/欢迎页,以便实现自定义视觉底层与首屏体验。

#### Acceptance Criteria
1. Where 集成方提供 `background` 插槽, the PiChat shall 在消息内容层之下渲染该背景且不遮挡消息交互。
2. Where 集成方提供 `empty` 插槽且当前会话无消息, the PiChat shall 以该插槽内容替换默认空态/欢迎页。
3. While 会话已有消息, the PiChat shall 不渲染 `empty` 插槽内容。
4. The PiChat shall 保留既有 header/footer/sidebar/messageActions 插槽并与新增插槽共存。

### Requirement 5: 细粒度组件覆盖(components)

**Objective:** 作为集成方开发者,我希望单独替换某一个原子组件而复用其余装配与数据接线,以便只改需要改的部分(如只换发送键),不必重写整块区域。

#### Acceptance Criteria
1. Where 集成方为某可覆盖组件提供替换实现, the PiChat shall 以该实现渲染对应位置,并继续向其传入该位置原有的数据与回调接线。
2. The PiChat shall 支持覆盖以下组件位:SubmitButton、Attachments、ModelSelector、SpeechInput、MessageActions、Markdown、Reasoning、EmptyState、StarterCard、ConversationBackground。
3. Where 集成方为消息渲染按角色(user / assistant / system)提供替换实现, the PiChat shall 对相应角色的消息使用该实现,并对未提供替换的角色回退默认渲染。
4. If 集成方将某可移除控件(SpeechInput、Attachments、ModelSelector 之类输入区控件)显式置为移除(传入 null), the PiChat shall 不渲染该控件且其余控件装配保持可用。
5. When 集成方未覆盖某组件位, the PiChat shall 使用该位的默认实现。

### Requirement 6: 输入区控件装配与排序

**Objective:** 作为集成方开发者,我希望调整输入区工具条中各控件的取舍与顺序,以便适配不同产品形态的输入体验。

#### Acceptance Criteria
1. The PiChat shall 以可被集成方覆盖的具名控件组成输入区工具条(附件、模型选择、语音、联网开关、发送)。
2. Where 集成方指定工具条控件顺序, the PiChat shall 按该顺序渲染存在的控件。
3. When 集成方未指定顺序, the PiChat shall 采用既有默认顺序渲染。
4. While 某控件被移除或其依赖能力不可用, the PiChat shall 渲染其余控件而不产生布局错位或报错。

### Requirement 7: 布局预设(layout)

**Objective:** 作为集成方开发者,我希望从一组布局预设中选择对话骨架,以便快速获得居中/宽屏/全屏/分栏等不同排布。

#### Acceptance Criteria
1. The PiChat shall 提供 `centered` / `wide` / `full` / `split` 四种布局预设。
2. When 集成方选择某布局预设, the PiChat shall 按该预设排布对话区(含内容最大宽度与区域划分)。
3. When 集成方未指定布局, the PiChat shall 采用与既有版面等价的默认布局。
4. Where 集成方选择 `split` 预设, the PiChat shall 划分出一个并列让位区域,该区域内容由现有插槽/子节点承接(本期不实现 Artifact 专属功能)。

### Requirement 8: 图标主题(icons)

**Objective:** 作为集成方开发者,我希望统一替换界面图标集,以便贴合品牌图标风格。

#### Acceptance Criteria
1. Where 集成方提供图标主题, the PiChat shall 以该主题对应图标渲染受支持的图标位(如发送、附件、模型、语音、联网、复制、赞、踩)。
2. When 集成方未提供某图标或未提供图标主题, the PiChat shall 回退到默认图标。
3. The PiChat shall 在替换图标后保持各图标位原有的尺寸约束与可访问性标签语义。

### Requirement 9: 定制入口解析优先级

**Objective:** 作为集成方开发者,我希望在同时使用多种定制入口时有确定的覆盖优先级,以便结果可预测、无歧义。

#### Acceptance Criteria
1. When 同一位置同时存在整块插槽(slots)与细粒度组件覆盖(components), the PiChat shall 优先采用 slots 的整块替换。
2. When 某位置存在 components 覆盖而无对应 slots, the PiChat shall 采用 components 覆盖。
3. When 某位置既无 slots 也无 components 覆盖, the PiChat shall 采用默认实现。
4. The PiChat shall 在文档化的优先级 `slots > components > 默认` 下保持一致行为。

### Requirement 10: 关键定制路径的端到端可验证性

**Objective:** 作为维护者,我希望关键定制路径具备端到端测试覆盖,以便定制契约在演进中不被回归破坏。

#### Acceptance Criteria
1. The 测试套件 shall 验证:提供细粒度组件覆盖(如自定义发送键)后,运行时渲染出该自定义组件而非默认实现。
2. The 测试套件 shall 验证:在 `dark` 与 `light` 之间切换主题模式后,呈现对应明暗外观。
3. The 测试套件 shall 验证:提供 `background` 与 `empty` 插槽后,背景层与空态分别被替换。
4. The 测试套件 shall 验证:选择不同 `layout` 预设后,对话区按对应骨架排布。
5. The 测试套件 shall 验证:在不提供任何新增定制入口时,默认外观与既有版本一致(向后兼容回归)。
