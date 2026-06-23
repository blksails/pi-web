# Requirements Document

## Introduction

本规格在 `aigc-tools-refactor` 既有产物之上,为 `image_generation` 与 `image_edit` 两工具引入「业务必选项 + 交互补全」。`model`、`size`、`prompt` 三个参数对成图质量至关重要,但当前 `model`/`size` 可选(LLM 常漏传或擅自选)、`prompt` 易被 LLM 翻译成英文(丢失用户原语言);而把它们标为 schema `required` 又会让 LLM 漏传时被参数校验拦截报错。

本规格的解法:把三者设为「业务必选」——schema 层不标 `required`,改由工具执行层在缺失时**经 pi 宿主的交互能力(`ctx.ui`)弹出选择器/输入框让用户补全**,而非报错或擅自取默认。消费者有两类:**LLM agent**(调工具、传参)与**终端用户**(在 pi-web 前端响应交互弹窗)。

## Boundary Context

- **In scope**:
  - `image_generation`、`image_edit` 两工具 `model`/`size`/`prompt` 的「缺失即交互补全」行为。
  - 用户取消交互、非交互环境(无 UI)两类边界的可观察行为。
  - `prompt` 维持用户输入语言的描述指示与交互兜底。
- **Out of scope**:
  - 其余参数(`background`/`quality`/`moderation`/`mask`/`reference_images`/`response_format`)维持现状(可选,不触发交互)。
  - 执行前总览二次确认(`confirm`)、每次强制交互——本轮仅「缺失才触发」。
  - 新增工具或新增 provider/model。
- **Adjacent expectations**:
  - 依赖 pi SDK 工具执行上下文(`ExtensionContext`)提供的交互能力(选择器/文本输入)及其「是否具备 UI」标志。
  - 依赖 pi-web 已实现的扩展交互渲染链(把工具发起的交互请求渲染为前端弹窗并回传结果)。
  - 既有 `model` 路由、attachment 落库、降级语义、双入口 externals 边界不变。

## Requirements

### Requirement 1: 必选项以交互补全而非 schema 校验拦截

**Objective:** 作为调用工具的 LLM agent,我希望漏传 `model`/`size`/`prompt` 时工具不被参数校验拦截报错,以便缺失值能在执行期被交互补全。

#### Acceptance Criteria
1. The AIGC 工具 shall 不在 `model`、`size`、`prompt` 的入参 schema 上声明为必填(`required`)。
2. While 工具被调用且缺少 `model`、`size` 或 `prompt`, the AIGC 工具 shall 进入执行而非在调用前因缺参被拒。
3. The AIGC 工具 shall 把 `model`、`size`、`prompt` 视为业务必选:执行完成前每一项都必须取得有效值。

### Requirement 2: model 缺失时交互选择

**Objective:** 作为终端用户,我希望在 LLM 未指定模型时被提示从可用模型中选择,以便由我决定用哪个模型成图。

#### Acceptance Criteria
1. When 调用缺少 `model` 且执行环境具备交互 UI, the AIGC 工具 shall 提示用户从该工具的可用模型列表中选择一项。
2. When 用户在模型选择中作出选择, the AIGC 工具 shall 以所选模型继续执行并路由到对应 model。

### Requirement 3: size 缺失时交互选择

**Objective:** 作为终端用户,我希望在 LLM 未指定尺寸时被提示从预设尺寸中选择,以便控制输出分辨率。

#### Acceptance Criteria
1. When 调用缺少 `size` 且执行环境具备交互 UI, the AIGC 工具 shall 提示用户从预设尺寸集合中选择一项。
2. When 用户选定尺寸, the AIGC 工具 shall 以所选尺寸继续执行。

### Requirement 4: prompt 缺失时交互输入,并维持输入语言

**Objective:** 作为终端用户,我希望在缺少描述时被提示输入图像描述,且我的描述以原始语言被使用而非被翻译,以便成图贴合我的本意。

#### Acceptance Criteria
1. When 调用缺少 `prompt` 且执行环境具备交互 UI, the AIGC 工具 shall 提示用户输入图像描述文本。
2. When 用户输入描述文本, the AIGC 工具 shall 以该文本作为 `prompt` 继续执行。
3. The AIGC 工具 shall 在其面向 LLM 的描述中明确要求以用户原始语言传递 `prompt` 且不翻译为英文。

### Requirement 5: 用户取消交互的容错

**Objective:** 作为终端用户,我希望取消补全交互时工具优雅结束而非崩溃,以便我能中止本次生成。

#### Acceptance Criteria
1. If 用户取消任一必选项的补全交互, then the AIGC 工具 shall 返回 `ok:false` 的结构化结果并附可读说明,而非抛出未捕获错误。
2. If 用户取消补全交互, then the AIGC 工具 shall 不发起 provider 调用、不产出落库产物。

### Requirement 6: 非交互环境的降级

**Objective:** 作为集成开发者,我希望在无交互 UI 的环境(如自动化测试 / 非交互模式)下工具仍可确定地工作,以便既有自动化不被交互阻塞。

#### Acceptance Criteria
1. While 执行环境不具备交互 UI 且缺少 `model`, the AIGC 工具 shall 使用该工具的默认 model 继续执行。
2. While 执行环境不具备交互 UI 且缺少 `size`, the AIGC 工具 shall 使用该项声明的兜底值继续执行。
3. If 执行环境不具备交互 UI 且缺少 `prompt`, then the AIGC 工具 shall 返回 `ok:false` 的结构化结果(无可兜底的描述)。

### Requirement 7: 仅缺失才触发,不打断正常流

**Objective:** 作为终端用户,我希望 LLM 已正确传参时不被任何弹窗打断,以便正常生成保持顺畅。

#### Acceptance Criteria
1. When 调用已包含有效的 `model`、`size`、`prompt`, the AIGC 工具 shall 不发起任何补全交互而直接执行。
2. The AIGC 工具 shall 仅对实际缺失的必选项发起交互,对已提供项不重复询问。

### Requirement 8: 回归保持与端到端验证

**Objective:** 作为集成开发者,我希望本增强不破坏既有能力且经端到端验证,以便确认变更安全。

#### Acceptance Criteria
1. The AIGC 工具 shall 保持既有的 model 路由、attachment 落库、容错降级与前端 bundle externals 边界不变。
2. The tool-kit shall 在本增强后通过类型检查与单元测试,且单元测试覆盖交互补全、用户取消、无 UI 降级三类分支。
3. When 在浏览器中由 LLM 漏传必选项触发, the AIGC 工具 shall 弹出补全交互,用户补全后完成一次真实生成并渲染图片。
