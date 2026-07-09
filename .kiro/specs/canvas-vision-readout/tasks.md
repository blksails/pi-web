# Implementation Plan

- [x] 1. 基础：视觉 op 构造器
- [x] 1.1 实现 image_vision 的对话通道载荷构造器
  - 把「当前图 + 问题 + 可选模型」构造成一条可渲染为用户消息的操作载荷
  - 工具行必须内嵌中文指令（沿用生成载荷「请直接按下列参数调用,勿追问、勿复述参数」的形态），否则模型可能复述参数而不调用工具
  - 参数顺序为 图 → 问题 → 可选模型；围栏标识与生成载荷一致
  - 问题为空时使用默认提问；模型为空或省略时**不产生模型参数行**（据此让工具弹层选择）
  - 纯函数、零 React、零 I/O；**不得** import 生成载荷构造器
  - 从包主入口导出该构造器与视觉模型选项类型，供工作台与面板宿主消费
  - 完成态：单元测试断言「无模型 → 渲染文本不含模型参数行」「有模型 → 含 `model: provider/id`」「空问题 → 含默认提问」「工具行含内嵌中文指令」「围栏标识为 canvas-op」「参数顺序为 图 → 问题 → 模型」
  - _Requirements: 1.3, 3.3, 3.4_
  - _Boundary: vision-op_

- [x] 2. 后端：可用视觉模型清单
- [x] 2.1 (P) 实现可用视觉模型枚举
  - 与任务 1 的前端链无任何依赖：后端链（2.1→2.2→2.3）与前端链（1.1→3.1→3.2）边界不相交，可全程并行，仅在 3.3 汇合
  - 与既有「可用模型枚举」同构：解析凭据存储 + 模型注册表，仅取已配置凭据的模型
  - 追加「支持图像输入」过滤，使结果与识别工具自身的候选同源
  - 输出项的取值为 `provider/modelId` 形式（与工具的模型参数格式一致），并只挑选必要字段
  - **禁止**把模型对象整体透传（其含 baseUrl 等字段），必须显式挑字段
  - 完成态：单元测试断言纯文本模型被过滤掉、取值形如 `provider/id`、返回体不含任何凭据字段
  - _Requirements: 3.1_
  - _Boundary: vision-model-options_

- [x] 2.2 实现只读清单端点
  - 沿用既有只读端点范式：返回可注入路由数组，经宿主的路由注入接缝挂载
  - 枚举抛错时捕获并返回空清单，而非把 500 透给前端
  - 完成态：端点测试直测路由处理器（不经完整 handler，避开别名陷阱），断言正常返回 200 与清单形状、枚举抛错时返回 200 与空清单
  - _Depends: 2.1_
  - _Requirements: 3.1_
  - _Boundary: vision-models-routes_

- [x] 2.3 接线端点：宿主路由注入 + 新顶层 API 段的转发器
  - 在宿主装配层的路由数组中追加本端点
  - **新建该顶层 API 段的 catch-all 转发器**（仅需 GET）——缺失会导致该端点静默 404，这是本 spec 最易漏的一项
  - 完成态：节点级 e2e 经真实 handler 请求该端点返回 200 与预期形状（若转发器缺失则此测试为 404，直接暴露）
  - _Depends: 2.2_
  - _Requirements: 3.1_
  - _Boundary: vision-routes-wiring, app 宿主装配层_

- [x] 3. 前端：解读入口与模型偏好
- [x] 3.1 (P) 在提示词栏加入解读按钮与解读回调
  - 不依赖后端链，可越过任务 2 组抢跑（清单缺失时选择器为空态，解读仍可用）
  - 解读按钮与生成按钮并列；点击时取输入框文字作问题（为空则用默认提问），以当前工作图为识别对象
  - 经与生成动作**相同的对话通道**发出载荷；结论因此回流对话记录，可回放、可追问
  - 解读回调与生成回调完全平行：**不进入生成动作的优先级决策**、**不消费**掩码/参考图/标注、不上传标注拍平图
  - 发出后**保留**输入框文字（与生成按钮既有行为一致）
  - 不在工作台内另建结论展示区；识别的成功与失败表现全部交由识别工具承担
  - 完成态：组件测试断言点击解读后对话通道被调用一次、文本含 `tool: image_vision` 与当前图 id、不含 `image_edit`
  - _Depends: 1.1_
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 2.4, 4.2, 4.3, 4.4, 5.1_
  - _Boundary: canvas-workbench_

- [x] 3.2 在提示词栏加入视觉模型选择器与偏好持久化
  - 选择器与既有「生成模型」选择器并列；空值哨兵表示「未设定」
  - 选中的取值为 `provider/modelId`；**注意与生成模型选择器的裸 id 格式不同，不可混用**
  - 偏好持久化到浏览器本地存储；读写失败静默忽略，退化为「本次会话内有效」
  - 清单为空时选择器展示「没有可用的视觉模型」，但解读按钮**仍可用**（此时载荷不带模型参数，由工具弹层兜底）
  - 完成态：组件测试断言选中模型后解读文本含 `model: provider/id`、未选中时不含模型参数行、空清单时选择器显示空态且解读按钮未被禁用
  - _Depends: 3.1_
  - _Requirements: 3.2, 3.3, 3.5, 5.4_
  - _Boundary: canvas-workbench_

- [x] 3.3 在面板宿主拉取清单并注入工作台
  - 面板打开时向只读端点拉取一次清单，注入工作台的新可选入参；不做轮询
  - 任何失败（网络、非 2xx、解析）记为空清单，**不抛、不阻断**解读
  - 完成态：组件测试断言拉取失败时工作台仍渲染、解读按钮可用；成功时选择器出现拉到的模型项
  - _Depends: 2.3, 3.2_
  - _Requirements: 3.1, 3.6_
  - _Boundary: canvas-launcher_

- [x] 4. 验证：不干扰生成与零回归
- [x] 4.1 锁定「解读不吞噬生成输入」
  - 组件测试：先绘制掩码并添加参考图，再点击解读
  - 断言发出的文本**不含**掩码与参考图参数；且点击后掩码与参考图**仍然存在**（证明未调用生成路径的输入消费）
  - 完成态：新增测试全绿；若实现误接入生成路径的输入消费，此测试立刻变红
  - _Depends: 3.1_
  - _Requirements: 4.3, 4.4_
  - _Boundary: canvas-workbench 组件测试_

- [x] 4.2 (P) 回归确认生成路径未被触碰
  - 与 4.1 边界不同（此处只跑既有套件，不新增组件测试），可并行
  - 运行既有的生成决策守恒线测试（逐字节断言生成载荷与优先级决策不变）
  - 运行受影响包的既有测试套件与类型检查
  - 完成态：既有测试全绿；决策守恒线未出现任何差异
  - _Depends: 3.1_
  - _Requirements: 4.1, 4.2, 5.2_
  - _Boundary: 既有回归套件_

- [x] 4.3 (P) 确认示例 agent 已装载识别能力
  - 零依赖，可最早并行执行
  - 校验 Canvas 示例 agent 的扩展装载清单含识别能力，使解读入口开箱即用
  - 完成态：真实启动该示例 agent，工具清单中出现视觉识别工具
  - _Requirements: 5.3_
  - _Boundary: examples/aigc-canvas-agent_

- [x] 4.4 浏览器端到端验证解读闭环
  - 打开工作台 → 点击解读 → 断言对话流中出现视觉识别工具的调用与文字结论
  - 若 Canvas 浏览器 e2e 门控不可用，则以节点级证据替代并在证据中说明
  - 完成态：记录真实运行输出作为完成证据
  - _Depends: 3.3, 4.3_
  - _Requirements: 1.1, 2.1, 2.2_


---

## 完成证据（新鲜运行输出）

### 单元 + 组件 + 集成
- `packages/canvas-ui` `vitest run` → **73 passed (7 files)**，含 `vision-op.test.ts` **24 条**
  与既有 **决策守恒线** `generate-actions.test.ts`（逐字节断言生成载荷未变）。
- `packages/ui` `vitest run` → **738 passed**，含新增 `test/canvas/canvas-readout.test.tsx` **12 条**。
- `packages/server` `vitest run` → **1165 passed | 5 skipped**（较接入前 +8，即新端点的两组测试）。
- `packages/tool-kit` `vitest run` → **335 passed**（未受影响）。
- 根 `tsc --noEmit` → **exit 0**。

### 端到端
- `e2e/node/vision-models-endpoint.e2e.test.ts` → **3 passed**。
  该测试直接 `import("@/app/api/vision/[[...path]]/route")`，**因此真正验证了 Next catch-all 转发器存在**。
- node e2e 全量 → **50 passed / 2 failed**；2 条为 **pre-existing**
  （`webext-build-load` declarative ×1、`config-domains` ×1），已于 `image-vision-tool` spec 期间
  在 `git stash` 基线上逐条复现，与本 spec 无关。

### 变异验证（证明护栏真能抓 bug，而非假绿）
1. **移走 Next 转发器**（`mv app/api/vision /tmp`）→ 端点 e2e 立刻
   `Cannot find module '@/app/api/vision/[[...path]]/route'` 失败。还原后复绿。
   ⇒ 证明「转发器缺失导致静默 404」这条最易漏的风险被真正守住。
2. **在 `readout()` 中注入 `setRefs([])`**（模拟误接入 `consumeSent`）→ 组件测试
   `★ 解读不吞噬生成输入(4.3/4.4)` 精确变红 1 条。还原后复绿。
   ⇒ 证明「解读吞掉用户掩码/参考图」这条风险被真正守住。

### 真实 LLM 验证「围栏隐性契约」（4.4）
design 标记的风险：agent 的 systemPrompt **没有**教 LLM 解析 `canvas-op` 围栏，
理解完全依赖 tool 行内嵌的中文指令。以 `buildVisionOp` + `renderSurfaceOp` 的**逐字输出**
喂给真实 runner（真实 `~/.pi/agent/models.json`，主模型为用户默认模型）：

```
[TOOL] image_vision  args={"image":"att_e2e_img","question":"这张图是什么颜色？只回答颜色。","model":"apiservices/gpt-5.4"}
[FENCE 契约] LLM ✅ 读懂围栏并调用了 image_vision
```

三个参数逐个正确。若去掉 tool 行的内联指令，LLM 很可能复述参数而不调用工具——该形态因此
被 `vision-op.test.ts` 的「围栏隐性契约」回归锁钉死。

> 结论中的 `Attachment storage unavailable` 来自 runner 的 `beforeToolCall` 属主校验
> （裸 runner 未接附件存储），工具尚未进入内核即被拦下；不影响围栏契约的验证。

### 示例 agent 装载（5.3）
真实启动 `examples/aigc-canvas-agent`，主模型自主调用工具：

```
tool_execution_start → toolName=image_vision
tool_execution_end   → ok=false reason=attachment_unavailable
✅ image_vision 工具已注册并被调用（fail-soft 未崩溃）
```

### 需求 2.2 / 2.3 的归属说明（reviewer 首轮指出缺乏真实证据）

- **2.2「结论进入对话记录可回放」** 与 **2.3「可就结论继续追问」** 是 **pi 对话流的既有能力**：
  任何经 `conversation.submitUserMessage` 发出的用户消息、以及其触发的工具卡与助手回复，
  本就进入会话历史、可回放、进 LLM 上下文。本特性**不新增**这条能力，也**无从破坏**它。
- 本 spec 对这两条的责任边界止于：**确保解读请求经该对话通道发出**（而非 surface 命令通道，
  后者不进对话记录）。这一点由组件测试
  `★ 点击解读 → 经对话通道发出 image_vision 载荷` 断言（`onSubmitPrompt` 被调用）。
- 因此**不为 2.2/2.3 新增端到端验证**。这与 spec `image-vision-tool` 中对
  「扩展命令不进消息历史」的归属修正是同类判断：不把既有系统的行为写成本 spec 的验收标准。

> 若将来要真正演示「结论回流 + 追问」，需要一次接通真实 attachment store 的浏览器 e2e
> （工作台开图 → 解读 → 工具卡出结论 → 追问引用它）。这属 Canvas 端到端验收范畴，不在本 spec。

### 补充覆盖（reviewer 首轮 remediation）

- **R3.6 拉取失败仍可解读**：原先 `useVisionModels` 的 fetch 分支**零测试覆盖**。
  已把网络逻辑抽为纯函数 `fetchVisionModels(baseUrl, fetchImpl)`，并补 6 条单测覆盖
  「无 baseUrl / 非 2xx / fetch 抛 / json 抛 / models 非数组 / 形状不合法项」——
  **任何失败都折成空数组，绝不抛出**。`packages/canvas-ui` `vision-op.test.ts` → **24 passed**。
- **R3.2 偏好写入路径**：原先只验证了 localStorage **读取**。已补 2 条组件测试：
  经 Radix Select 真实点选模型 → 断言 `localStorage["pi-web.vision.model"]` 被写入、
  后续载荷带 `model: provider/id`；选回「每次询问」→ 断言键被清除、载荷不再带 model。
  **变异验证**：去掉 `writeVisionModelPref` 调用 → 这 2 条精确变红；还原即复绿。
  `packages/ui` `canvas-readout.test.tsx` → **12 passed**。

### 实现期发现（记录，避免后人重踩）
1. **`CanvasPanel` 的 Hooks 规则违规**：`useVisionModels` 最初被放在 `if (!on || !open) return null`
   **之后**，面板开合改变 hook 数量 → React 报 `Rendered more hooks than during the previous render`。
   修复 = 把 hook 提到所有 early return 之前。
   > 措辞澄清（reviewer 首轮质疑此条）：抓到它的是**既有的** `packages/ui/test/canvas/canvas-launcher.test.tsx`
   > （该文件本 spec **零改动**，不含任何 vision 断言），不是本 spec 新写的回归锁。
   > 但它**确实仍在守护**这个位置——变异验证：把 hook 移回 early return 之后，该文件精确红 2 条
   > `Rendered more hooks than during the previous render`；还原即复绿。
2. **`server/src/index.ts` barrel 的 pi SDK 边界**：`vision-model-options.ts` 含 pi SDK 值导入，
   **不得**经 barrel 重导出（会被拖进 Next 服务端 bundle，dev 路由崩 `node:fs`）。
   与 `config/model-options.ts` 同构：新增 `exports["./vision-model-options"]` 子路径，
   `pi-handler.ts` 从子路径 import，barrel 只出薄路由与纯类型。
3. **出口纪律快照**：`packages/canvas-ui/test/index-exports.test.ts` 用 `Object.keys().sort()`
   逐项断言公开导出面。新增 `buildVisionOp` / `DEFAULT_READOUT_QUESTION` 必须按**字母序**登记
   （大写段与小写段分开），否则该测试红。
