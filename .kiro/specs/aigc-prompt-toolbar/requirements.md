# Requirements Document

## Introduction

在 pi-web 输入区工具排(附件/语音/联网等内核控件所在行)为 AIGC 场景提供一组"快捷设置":图像模型选择器与尺寸选择器。用户在工具排直接选定后,后续图像生成/编辑自动采用所选值,不必在对话文本里指定,也不再被工具的交互式追问打断;在工具追问中做过的选择同样被自动记住并回显。挂载点本身是宿主的一个领域无关扩展点:仅当 agent source 声明贡献时渲染,宿主不认领域语义,保持 agent-source 独立性。

## Boundary Context

- **In scope**:输入区工具排的 source 贡献扩展点(位置:内核控件之后、发送按钮之前);aigc-canvas-agent 的模型/尺寸快捷设置控件;所选偏好在图像生成/编辑工具执行中的生效与优先级;工具交互追问所选值的自动记住与回显;同一浏览器跨会话保留上次选择。
- **Out of scope**:工具排既有的"模型"控件(它选择的是对话 LLM,与图像模型无关,不改动);Canvas 工作台内既有的模型/尺寸表单(不重构,允许并存);除 aigc-canvas-agent 外其他 source 的快捷设置内容;图像模型清单本身的增删(由既有工具路由决定)。
- **Adjacent expectations**:依赖既有的会话共享状态通道(agent 权威、UI 镜像)在会话内传递偏好——该通道不可用时本功能按退化行为处理,不改动通道本身的语义;依赖既有图像生成/编辑工具的参数决定流程(显式参数、默认模型、交互式追问),本功能仅在其中插入"用户偏好"一级。

## Requirements

### Requirement 1: 输入区工具排的 source 贡献扩展点
**Objective:** 作为 agent source 作者,我想在输入区工具排中挂载自定义控件,以便为我的领域提供随手可及的快捷设置,而无需宿主为我的领域定制。

#### Acceptance Criteria
1. Where agent source 的 web 扩展声明了工具排贡献, the pi-web 宿主 shall 在工具排内核控件之后、发送按钮之前渲染该贡献。
2. When agent source 未声明工具排贡献, the pi-web 宿主 shall 不渲染任何额外容器或占位。
3. The pi-web 宿主 shall 以领域无关方式挂载工具排贡献(不解释贡献内容的领域语义,不因本功能引入领域专有词汇)。
4. Where 宿主持有会话共享状态接入, the pi-web 宿主 shall 将其提供给工具排贡献组件(与其他具名扩展点的注入方式一致)。
5. If 工具排贡献组件渲染抛错, the pi-web 宿主 shall 隔离该错误并保持输入区其余控件可用。

### Requirement 2: 图像模型快捷选择
**Objective:** 作为 aigc-canvas-agent 用户,我想在输入框旁直接选择图像生成模型,以便后续生图不必在对话里写明模型、也不被追问打断。

#### Acceptance Criteria
1. When 用户处于 aigc-canvas-agent 会话, the AIGC 快捷设置 shall 在输入区工具排显示图像模型选择器。
2. The 图像模型选择器 shall 列出该 agent 图像生成与图像编辑工具支持模型的并集。
3. When 用户选择某个模型, the AIGC 快捷设置 shall 将该选择立即记为当前会话的模型偏好。
4. While 用户未做任何模型选择且无历史记忆, the 图像模型选择器 shall 呈现"默认"态(表示交由工具默认模型决定)。

### Requirement 3: 图像尺寸快捷设置
**Objective:** 作为 aigc-canvas-agent 用户,我想在输入框旁直接设置输出图像尺寸,以便控制生成比例而无需在对话里说明。

#### Acceptance Criteria
1. When 用户处于 aigc-canvas-agent 会话, the AIGC 快捷设置 shall 在输入区工具排显示尺寸选择器,提供 1024x1024、1536x1024、1024x1536 与 auto 四档。
2. When 用户选择某档尺寸, the AIGC 快捷设置 shall 将该选择立即记为当前会话的尺寸偏好。
3. While 用户未做任何尺寸选择且无历史记忆, the 尺寸选择器 shall 呈现"默认"态(表示交由工具默认行为决定)。

### Requirement 4: 偏好在图像工具执行中生效
**Objective:** 作为用户,我希望我选定的模型与尺寸自动用于后续图像生成/编辑,以获得连贯、免打断的创作体验。

#### Acceptance Criteria
1. When 图像生成或图像编辑工具被调用且调用参数未显式指定模型, the 图像工具 shall 采用当前会话的模型偏好。
2. When 调用参数显式指定了模型, the 图像工具 shall 采用显式参数并忽略会话偏好。
3. When 图像工具被调用且调用参数未显式指定尺寸, the 图像工具 shall 采用当前会话的尺寸偏好。
4. When 调用参数显式指定了尺寸, the 图像工具 shall 采用显式参数并忽略会话偏好。
5. While 会话偏好已设置, when 工具因缺少模型或尺寸参数而将发起交互式追问, the 图像工具 shall 直接采用偏好并跳过该追问。
6. If 会话共享状态通道不可用, the 图像工具 shall 回落到既有默认行为(默认模型/交互式追问),不报错、不中断执行。

### Requirement 5: 自动记住工具交互追问中的选择
**Objective:** 作为用户,我在工具交互追问里选过的模型或尺寸应被自动记住,以免每次生成都重复回答。

#### Acceptance Criteria
1. When 用户在图像工具的交互式追问中选定模型或尺寸, the 图像工具 shall 将该选择记为当前会话的对应偏好。
2. When 会话偏好经交互式追问更新, the AIGC 快捷设置 shall 同步回显新值,无需刷新页面。

### Requirement 6: 同一浏览器跨会话保留选择
**Objective:** 作为用户,我希望上次选定的模型与尺寸在新会话中仍然生效,免得每个会话都重新设置。

#### Acceptance Criteria
1. When 用户在同一浏览器中新建 aigc-canvas-agent 会话且此前做过选择, the AIGC 快捷设置 shall 以上次选择作为该会话的初始偏好并回显。
2. If 浏览器本地不存在历史选择, the AIGC 快捷设置 shall 呈现"默认"态。
3. When 以历史选择初始化新会话偏好后, the 图像工具 shall 在该会话中按 Requirement 4 的规则采用该偏好。

### Requirement 7: 退化与 agent-source 独立性
**Objective:** 作为 pi-web 运维者,我要求该功能不影响其他 source 的会话体验,且在依赖缺失时安静退化。

#### Acceptance Criteria
1. When 会话的 agent source 未声明工具排贡献(如通用对话 agent), the pi-web 宿主 shall 不显示任何 AIGC 快捷设置,且输入区布局与行为与本功能引入前一致。
2. If 会话共享状态接入未提供, the AIGC 快捷设置 shall 以禁用态呈现或不呈现,不抛错、不阻塞输入。
3. The AIGC 快捷设置的领域语义(模型清单、尺寸档位) shall 仅由 agent source 侧与图像工具侧承载,宿主核心不因本功能包含此类语义。
