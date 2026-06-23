# Implementation Plan

- [x] 1. 类型契约:必选项交互声明
- [x] 1.1 新增 InteractionSpec 并扩展 ToolSpec
  - 定义必选项交互声明(目标参数、交互方式 select/input、标题、占位、选项含 $models 哨兵、无 UI 兜底值)
  - 在工具声明类型上新增可选的必选项交互列表字段
  - 完成态:类型模块导出交互声明类型,工具类型可携带必选项交互列表,主入口仍为纯类型零运行时导入
  - _Requirements: 1.1_

- [x] 2. 编译器:必选项交互补全
- [x] 2.1 执行层接入交互上下文并实现缺失补全
  - 工具执行接入第 5 参交互上下文;在合并入参之后、model 路由与 provider 调用之前补全缺失必选项
  - 缺失项:有交互 UI 时经选择器(model/size)或文本输入(prompt)向用户取值;model 选项支持由工具模型列表动态展开
  - 用户取消交互 → 返回结构化 ok:false 且不发起 provider 调用、不落库;无交互 UI 时降级(model 用默认、size 用兜底、prompt 无兜底则 ok:false)
  - 已提供有效值的必选项不发起交互
  - 完成态:缺失 model/size 触发选择、缺失 prompt 触发输入;取消返回 ok:false 且 provider 未被调用;无 UI 走默认/兜底;已传值则不触发交互
  - _Requirements: 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2, 6.1, 6.2, 6.3, 7.1, 7.2_
  - _Depends: 1.1_

- [x] 3. 工具声明:必选项 + 语言指示
- [x] 3.1 (P) image_generation 必选项与原语言指示
  - 声明 model(选择器,选项取该工具模型列表)、size(选择器,预设尺寸+兜底)、prompt(文本输入)三项必选交互
  - 工具描述与 prompt 字段描述强指示「以用户原始语言传递 prompt、不翻译为英文」
  - 完成态:image_generation 携带三项必选交互声明,描述含原语言指示
  - _Requirements: 2.1, 3.1, 4.1, 4.3_
  - _Boundary: tools/image-generation_
  - _Depends: 1.1_

- [x] 3.2 (P) image_edit 必选项与原语言指示
  - 同 3.1:声明 model/size/prompt 三项必选交互;描述强指示原语言不翻译
  - 完成态:image_edit 携带三项必选交互声明,描述含原语言指示
  - _Requirements: 2.1, 3.1, 4.1, 4.3_
  - _Boundary: tools/image-edit_
  - _Depends: 1.1_

- [x] 4. 测试对齐
- [x] 4.1 交互补全/取消/降级单测
  - 以可注入的交互上下文(mock)覆盖:缺 model/size 调用选择器、缺 prompt 调用输入并以结果继续;取消返回 ok:false 且 provider/落库未被调用;无 UI 时 model→默认、size→兜底、prompt→ok:false;三项均已传时交互完全不被调用
  - 完成态:编译器交互补全单测全绿,覆盖交互/取消/降级/不触发四类分支
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2, 6.1, 6.2, 6.3, 7.1, 7.2, 8.2_
  - _Boundary: test/engine_
  - _Depends: 2.1, 3.1, 3.2_

- [x] 4.2 (P) 既有集成与 node e2e 回归对齐
  - 确认既有工具集成测试与 node e2e 在无交互上下文下:size 走兜底、model 走默认、prompt 显式传入,断言不被破坏
  - 完成态:既有 image_generation/image_edit 集成测试与 aigc node e2e 全绿
  - _Requirements: 8.1, 8.2_
  - _Boundary: test/aigc, e2e/node_
  - _Depends: 2.1, 3.1, 3.2_

- [x] 5. 质量门与端到端验证
- [x] 5.1 类型检查与单测套件
  - 运行类型检查与 tool-kit 单测套件
  - 完成态:类型检查无错误,单测套件通过
  - _Requirements: 8.1, 8.2_
  - _Depends: 4.1, 4.2_

- [x] 5.2 浏览器端到端验证交互补全
  - 浏览器中发出「不指定模型/尺寸」的生成请求,触发选择器/输入补全,自动应答后完成一次真实生成并渲染图片
  - 完成态:浏览器 e2e 触发补全弹窗 → 应答 → 生成图片渲染成功
  - _Requirements: 8.3_
  - _Depends: 5.1_
