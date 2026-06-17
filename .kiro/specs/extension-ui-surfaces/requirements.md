# Requirements Document

## Introduction

本特性为 pi 扩展(extension)经 RPC/SSE 控制通道发出的 5 个"单向推送"类 UI 方法补齐 web 端渲染:`notify`、`setStatus`、`setWidget`、`setTitle`、`set_editor_text`。这些方法是 pi 扩展 UI 契约的一部分,协议层已能解析,但当前 web 端仅渲染交互类 4 方法(`select`/`confirm`/`input`/`editor`),推送类方法既不展示、也会因混入对话框队列而阻塞后续交互对话框。

本特性把推送类方法的呈现补全为面向用户的环境化 UI(通知浮层、状态条、widget 区、会话标题、写入输入框),并修复"推送方法阻塞交互对话框"的缺陷。推送类方法为 fire-and-forget(无回包,不需要用户响应)。

同时,本特性把现有的富聊天组件收敛为默认聊天组件:对外默认导出的 `PiChat` 由富版本提供,原最小版本以非破坏方式保留,集成方默认获得富界面。

权威背景与已核实事实见 `.kiro/specs/extension-ui-surfaces/requirements.md` 的「Project Description (Input)」。

## Boundary Context

- **In scope**:
  - 推送类 5 方法的 web 呈现:通知(`notify`)、键控状态(`setStatus`)、键控 widget(`setWidget`,含放置位)、会话标题(`setTitle`)、写入输入框(`set_editor_text`)。
  - 把推送类方法从交互对话框队列中分离,使其不阻塞交互对话框(缺陷修复)。
  - 推送类状态在 web 客户端的可观察暴露,供聊天界面消费。
  - 富聊天组件收敛为默认导出的聊天组件,原最小版本非破坏保留。
- **Out of scope**:
  - 协议契约与服务端路由改动(5 方法已可解析、无回包,无需新增传输或响应)。
  - 仅存在于终端(TUI)、不可经控制通道序列化的富渲染能力(如自定义组件 / 页眉页脚 / 编辑器组件 / 自动补全)。
  - 推送类状态的持久化存储或跨会话恢复。
- **Adjacent expectations**:
  - 推送由 pi 扩展在运行时发出,出现时机与内容由扩展决定;当某会话期间无任何推送时,对应 UI 不呈现(空态)。
  - 交互类 4 方法(`select`/`confirm`/`input`/`editor`)的既有行为保持不变。
  - 主题继承宿主提供的 CSS 变量;不引入与推送内容无关的写死文案或颜色主题。

## Requirements

### Requirement 1: 扩展通知(notify)呈现
**Objective:** 作为 pi-web 终端用户,我想要看到扩展发出的即时通知,以便及时获知扩展的提示、警告与错误。

#### Acceptance Criteria
1. When 扩展发出一个 `notify` 推送, the PiChat shall 以通知浮层展示其消息文本。
2. Where `notify` 携带 `notifyType`(`info`/`warning`/`error`), the PiChat shall 以与该级别对应的视觉样式呈现该通知。
3. When 一条通知展示一段可读时长后, the PiChat shall 自动移除该通知。
4. When 用户主动关闭某条通知, the PiChat shall 立即移除该通知。
5. When 扩展连续发出多条 `notify` 推送, the PiChat shall 以堆叠方式并存展示各条通知且互不覆盖丢失。
6. While 当前会话期间没有任何 `notify` 推送, the PiChat shall 不呈现通知浮层区域。

### Requirement 2: 扩展状态(setStatus)呈现
**Objective:** 作为终端用户,我想要看到扩展发布的键控状态信息,以便了解扩展当前的运行状态。

#### Acceptance Criteria
1. When 扩展发出一个携带非空 `statusText` 的 `setStatus` 推送, the PiChat shall 以该 `statusKey` 为标识在状态区展示对应的状态文本。
2. When 扩展对同一 `statusKey` 再次发出携带新 `statusText` 的 `setStatus` 推送, the PiChat shall 用新文本替换该键的既有状态展示。
3. When 扩展对某个 `statusKey` 发出 `statusText` 为空(未提供)的 `setStatus` 推送, the PiChat shall 移除该键对应的状态展示。
4. When 多个不同 `statusKey` 同时存在有效状态, the PiChat shall 并列展示各键的状态项。
5. While 没有任何有效的键控状态, the PiChat shall 不呈现状态区。

### Requirement 3: 扩展 widget(setWidget)呈现
**Objective:** 作为终端用户,我想要看到扩展在输入框附近发布的多行 widget 内容,以便获取扩展提供的上下文信息。

#### Acceptance Criteria
1. When 扩展发出一个携带非空 `widgetLines` 的 `setWidget` 推送, the PiChat shall 以该 `widgetKey` 为标识展示这些文本行。
2. Where `setWidget` 指定 `widgetPlacement` 为 `aboveEditor` 或 `belowEditor`, the PiChat shall 将该 widget 呈现在输入框的对应上方或下方位置。
3. When 扩展对同一 `widgetKey` 再次发出携带新 `widgetLines` 的 `setWidget` 推送, the PiChat shall 用新内容替换该键的既有 widget 展示。
4. When 扩展对某个 `widgetKey` 发出 `widgetLines` 为空(未提供)的 `setWidget` 推送, the PiChat shall 移除该键对应的 widget 展示。
5. While 没有任何有效的 widget, the PiChat shall 不呈现 widget 区。

### Requirement 4: 扩展会话标题(setTitle)呈现
**Objective:** 作为终端用户,我想要看到扩展设置的会话标题,以便识别当前会话的上下文。

#### Acceptance Criteria
1. When 扩展发出一个 `setTitle` 推送, the PiChat shall 在会话头部展示该标题文本。
2. When 扩展再次发出 `setTitle` 推送, the PiChat shall 用新标题替换既有标题展示。
3. While 扩展未发出任何 `setTitle` 推送, the PiChat shall 不因缺少扩展标题而改变其默认头部呈现。

### Requirement 5: 扩展写入输入框(set_editor_text)
**Objective:** 作为终端用户,我想要扩展能把文本写入我的输入框,以便扩展为我预填或建议待发送内容。

#### Acceptance Criteria
1. When 扩展发出一个 `set_editor_text` 推送, the PiChat shall 将输入框内容设置为该推送携带的文本。
2. When 扩展连续发出多个 `set_editor_text` 推送, the PiChat shall 依次以最新一次推送的文本作为输入框内容。
3. When 用户在收到 `set_editor_text` 后继续编辑输入框, the PiChat shall 允许用户在已写入文本基础上正常增删改。
4. The PiChat shall 仅在收到 `set_editor_text` 推送时写入输入框,不得在无该推送时自行改写用户输入。

### Requirement 6: 推送与交互对话框互不阻塞
**Objective:** 作为终端用户,我想要扩展的推送类消息不影响交互类对话框的弹出,以便我能正常响应需要输入的请求。

#### Acceptance Criteria
1. When 扩展发出任一推送类方法(`notify`/`setStatus`/`setWidget`/`setTitle`/`set_editor_text`), the PiChat shall 呈现对应的环境化 UI 且不弹出需要用户响应的对话框。
2. When 推送类方法与交互类方法(`select`/`confirm`/`input`/`editor`)在同一会话先后到达, the PiChat shall 始终能为交互类方法弹出对应对话框,不被任何推送类方法阻塞。
3. The PiChat shall 不为推送类方法发送任何用户响应(推送类为单向、无回包)。
4. While 存在待响应的交互类对话框, the PiChat shall 保持交互类既有的逐项处理行为不变。

### Requirement 7: 富聊天组件收敛为默认 PiChat
**Objective:** 作为集成方,我想要默认导出的聊天组件即为富界面,以便无需额外切换即可获得完整聊天能力,同时不破坏既有引用。

#### Acceptance Criteria
1. The 组件库 shall 以默认导出的 `PiChat` 提供富聊天界面(即原 `PiChatPro` 的能力)。
2. The 组件库 shall 以非破坏方式保留原最小聊天组件的能力(以另一个明确命名的导出提供)。
3. Where 集成方仍引用原 `PiChatPro` 名称, the 组件库 shall 在一个过渡周期内提供指向新 `PiChat` 的兼容别名。
4. When 宿主应用加载默认聊天界面, the 应用 shall 渲染富版本 `PiChat` 并能完成一次基本对话。

### Requirement 8: 主题、无障碍与非回归
**Objective:** 作为集成方/维护者,我想要新增呈现遵循既有主题与无障碍约定且不回归既有功能,以便平滑集成。

#### Acceptance Criteria
1. The PiChat 及其新增呈现元件 shall 通过宿主的 CSS 变量获取主题,不硬编码颜色主题。
2. The 新增呈现元件 shall 支持基本的键盘操作与 ARIA 语义(尤其通知的可读角色与关闭操作)。
3. When 现有测试套件与类型检查运行, the 仓库 shall 保持全部通过(无回归、无类型错误)。
4. While 推送类与交互类 UI 同时存在, the PiChat shall 保持两类 UI 视觉与可达性互不干扰。
