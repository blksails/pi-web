# Requirements Document

## Introduction
本特性把 `@pi-web/ui` 中**已实现但未接线**的 `PiCommandPalette`("/" 斜杠命令补全浮层)接入富聊天界面 `PiChat`(rich-chat-ui 装配)。终端用户在输入框键入以 "/" 开头的内容时,获得一个实时过滤的命令补全浮层,可用键盘/鼠标导航并选中命令,选中后命令被填入输入框待补参确认。同时把既有"建议气泡/网格"(`useSuggestions`,本文档称**方案 A**)在**会话进行中**的职责让位给浮层,使方案 A 退化为**空会话的 starter 引导**。

命令的真正执行不在 web 端发生:斜杠文本沿用现状,经 `sendMessage` 原样发出,由 pi 后端识别并展开(web 端不解析、不执行命令)。本特性的范围是**补全交互的接线与协调**,不改变命令协议、不改变命令执行语义。

权威组件来源:`packages/ui/src/controls/pi-command-palette.tsx`(浮层,已含单测)、`packages/ui/src/chat/pi-chat.tsx`(装配点)、`packages/ui/src/elements/prompt-input.tsx`(输入外壳,需扩展)。命令数据来源:`usePiControls` 的 `getCommands()` / `controls.commands`(`get_commands` RPC,产出 `RpcSlashCommand[]`)。

## Boundary Context
- **In scope**:
  - 在 `PiChat` 装配层渲染并接线 `PiCommandPalette`,使其在命令模式下可见、可操作。
  - 浮层触发(输入以 "/" 开头)、候选拉取与过滤、键盘/鼠标导航、选中填充。
  - 命令模式下 `PromptInput` 的 Enter 让位协调(新增 `suppressEnterSubmit` 能力)。
  - 方案 A 建议网格的展示条件收敛为"仅空会话"。
  - 浮层的叠加定位与失败/空/不可用时的降级。
- **Out of scope**:
  - 命令的解析与执行(由 pi 后端负责,web 端原样转发)。
  - `RpcSlashCommand` 协议、`get_commands` RPC 与 `usePiControls` 内部实现的改动。
  - 命令参数的语法校验、参数级补全/提示。
  - 命令历史、收藏、模糊排序算法的升级(沿用现有 `includes` 过滤)。
- **Adjacent expectations**:
  - 依赖 `usePiControls` 暴露 `getCommands()` 与 `commands` 状态,且其语义不变。
  - 依赖 pi 后端在收到 `/name …` 文本 prompt 时按命令展开;web 端不为此负责。
  - 依赖 `PiCommandPalette` 既有的命令模式判定、过滤、键盘与 ARIA 行为;本特性复用而非重写。

## Requirements

### Requirement 1: 命令补全浮层的触发与候选获取
**Objective:** 作为终端用户,我想在输入以 "/" 开头时看到可用命令的补全浮层,以便快速发现并发起斜杠命令。

#### Acceptance Criteria
1. When 输入框当前 value 以 "/" 开头, the PiChat shall 渲染命令补全浮层并进入命令模式。
2. When 输入框当前 value 不以 "/" 开头, the PiChat shall 不渲染命令补全浮层。
3. When 进入命令模式且命令尚未加载, the PiChat shall 经 `controls.getCommands()` 拉取可用命令作为候选来源。
4. While 处于命令模式, the PiCommandPalette shall 以 "/" 之后的文本为查询、对命令 `name` 做大小写不敏感的子串过滤,仅展示匹配项。
5. When 候选项展示, the PiCommandPalette shall 对每项展示 `/{name}` 与(若有)`description`。

### Requirement 2: 浮层内导航与选择交互
**Objective:** 作为终端用户,我想用键盘或鼠标在候选命令间导航并选中,以便无需离开输入框即可完成补全。

#### Acceptance Criteria
1. While 命令模式且有候选项, when 用户按 ArrowDown 或 ArrowUp, the PiCommandPalette shall 在候选项间循环移动高亮项并阻止该按键的默认行为。
2. While 命令模式且有候选项, when 用户按 Enter, the PiCommandPalette shall 选中当前高亮项并阻止该按键触发输入框换行或提交。
3. When 用户按 Escape, the PiCommandPalette shall 退出命令模式(清空命令模式输入)。
4. When 用户用鼠标悬停某候选项, the PiCommandPalette shall 将其设为高亮项。
5. When 用户用鼠标点击某候选项, the PiCommandPalette shall 选中该项。
6. While 命令模式, the PiCommandPalette shall 以 `listbox`/`option` 语义与 `aria-activedescendant` 标注当前高亮项。

### Requirement 3: 选中后的填充行为(统一填充待确认)
**Objective:** 作为终端用户,我想选中命令后它被填入输入框而不是立即发送,以便我能补充参数或确认后再发出。

#### Acceptance Criteria
1. When 用户选中某命令, the PiChat shall 将输入框 value 设为 `"/{name} "`(命令名后带一个空格)且不触发发送。
2. When 命令被填入输入框后, the PiChat shall 退出命令模式(此时 value 不再以触发浮层的查询形式存在,浮层据触发规则隐藏或重新匹配)。
3. While 输入框已填入 `"/{name} "`, when 用户继续输入参数并随后按 Enter 提交, the PiChat shall 将完整斜杠文本作为消息发送。

### Requirement 4: 命令模式下的 Enter 协调
**Objective:** 作为终端用户,我想在命令模式下按 Enter 只用于选中命令,以便不会把未完成的 "/foo" 误发出去。

#### Acceptance Criteria
1. The PromptInput shall 提供一个可选的 `suppressEnterSubmit` 能力,用于在命令模式激活时禁用其 textarea 的 Enter 提交。
2. While 命令模式激活且有候选项, when 用户在输入框按 Enter, the PiChat shall 让该 Enter 仅被浮层用于选中、不触发 `PromptInput` 的提交。
3. While 非命令模式, when 用户按 Enter, the PromptInput shall 维持现状行为(非空白则提交,Shift+Enter 换行)。
4. While `suppressEnterSubmit` 启用, when 用户按 Shift+Enter, the PromptInput shall 仍插入换行而不提交。

### Requirement 5: 建议网格退化为空会话引导
**Objective:** 作为终端用户,我想在空会话看到建议引导、在会话进行中靠浮层补全,以便界面不被重复的命令列表占据。

#### Acceptance Criteria
1. While 会话无消息(空态), the PiChat shall 展示方案 A 的建议网格(命令∪预设,或回落 starter 卡片)。
2. While 会话已有消息, the PiChat shall 不展示方案 A 的建议网格,命令补全由浮层承担。
3. The PiChat shall 仍在会话就绪后拉取一次命令(供浮层与空态建议同源使用),不因退化而停止拉取。

### Requirement 6: 浮层定位与布局
**Objective:** 作为终端用户,我想浮层叠加在输入框上方且不挤动布局,以便输入框位置稳定、视线连续。

#### Acceptance Criteria
1. When 浮层渲染, the PiChat shall 以绝对定位将其叠加于输入框上方,不占据常规布局流。
2. While 浮层显示或隐藏, the PiChat shall 保持输入框的位置与尺寸不被浮层顶高或挤压。
3. When 浮层与其他叠加层(如通知浮层)同时存在, the PiChat shall 通过层叠顺序使浮层可见且可交互。

### Requirement 7: 降级与健壮性
**Objective:** 作为终端用户,我想在命令不可用时界面仍正常工作,以便补全能力的缺失不会破坏聊天。

#### Acceptance Criteria
1. If `controls` 不可用(未提供), the PiChat shall 不渲染命令补全浮层且不抛错,聊天其余功能不受影响。
2. If `controls.getCommands()` 失败, the PiCommandPalette shall 展示错误态而不崩溃。
3. If 命令为空或过滤后无匹配, the PiCommandPalette shall 展示空态(如 "No commands")而不崩溃。
4. While 浮层处于错误态或空态, when 用户按 Escape, the PiCommandPalette shall 退出命令模式。

### Requirement 8: 命令执行沿用现状
**Objective:** 作为终端用户,我想斜杠命令按既有方式被后端执行,以便接入浮层不改变命令的实际行为。

#### Acceptance Criteria
1. When 用户提交一条以 "/" 开头的消息, the PiChat shall 将其作为普通文本经 `sendMessage` 原样发出,不在 web 端解析或展开命令。
2. The PiChat shall 不改变 `RpcSlashCommand` 协议、`get_commands` 拉取语义或 `sendMessage` 的现有载荷形状。
