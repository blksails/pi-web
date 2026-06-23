# Implementation Plan

- [x] 1. 基础:类型契约与编译器(model 路由)
- [x] 1.1 重写类型契约,拍平 variants 并删除死字段
  - 以 ToolSpec 取代 Category、ModelRoute 取代 Variant 作为公开类型契约
  - label 提升至工具顶层;移除 CategoryUi、userParams、paramOverrides、ProviderOption、altProviders
  - 完成态:类型模块导出 ToolSpec/ModelRoute,且不再导出任何旧抽象类型,主入口仍为纯类型零运行时导入
  - _Requirements: 5.1, 5.3_

- [x] 1.2 重写编译器为 compileTool 并实现 model 枚举路由
  - 据工具的 model 集合注入可选 model 枚举入参;按 args.model > 默认 model > 首项回退路由
  - 在执行明细中记录本次实际 model;保留 requiredVars/ctx 降级门与顶层不抛语义;移除 userParams 校验链
  - 完成态:编译出的工具参数含 model 可选枚举,非法 model 回退默认且不中止,任何失败路径返回结果对象而非抛错
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.2, 6.3, 6.4_
  - _Depends: 1.1_

- [x] 2. Provider 路由项迁移(Variant → ModelRoute)
- [x] 2.1 (P) DashScope 工厂迁移与编辑字段对齐 OpenAI
  - 三个 DashScope 工厂返回 ModelRoute;保留同步与异步轮询两形态
  - 编辑路径读取 prompt/image/mask/reference_images,维持主图+mask+参考 ≤ 3 校验
  - 完成态:DashScope 工厂在新类型下编译通过,编辑请求体按新字段名装配
  - _Requirements: 4.1, 4.2, 3.4_
  - _Boundary: providers/dashscope_
  - _Depends: 1.1_

- [x] 2.2 (P) NewAPI 工厂迁移与 OpenAI 参数透传
  - 工厂返回 ModelRoute;生成路径透传 n/size/background/quality/moderation
  - 编辑路径读取 prompt/image/mask 并装配 multipart,透传 n/size/response_format
  - 完成态:NewAPI 生成请求体含 OpenAI 透传参数,编辑请求体为 multipart 且含新字段
  - _Requirements: 4.1, 2.2, 3.2_
  - _Boundary: providers/newapi_
  - _Depends: 1.1_

- [x] 2.3 (P) OpenRouter 工厂迁移(保留,不进 enum)
  - 工厂返回 ModelRoute;编辑路径读取新字段名
  - 完成态:OpenRouter 工厂在新类型下编译通过,本轮不被任一工具的 model 枚举引用
  - _Requirements: 4.1, 4.4_
  - _Boundary: providers/openrouter_
  - _Depends: 1.1_

- [x] 3. 工具声明(ToolSpec)
- [x] 3.1 (P) image_generation 工具声明
  - 暴露必填 prompt 与可选 model/n/size/negative_prompt/background/moderation/quality
  - 提供 wan2.6-t2i、qwen-image-pro、gpt-image-2 三个可路由 model,默认 gpt-image-2
  - 完成态:image_generation 工具暴露上述参数与 model 集合,缺省 model 为 gpt-image-2,无关参数被目标 model 静默忽略
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - _Boundary: tools/image-generation_
  - _Depends: 2.1, 2.2_

- [x] 3.2 (P) image_edit 工具声明
  - 暴露必填 image/prompt 与可选 mask/model/n/size/reference_images/response_format
  - 提供 qwen-image-edit-max、gpt-image-2 两个可路由 model,默认 qwen-image-edit-max
  - 完成态:image_edit 工具暴露上述参数与 model 集合,att_ 前缀的图像字段在发往 provider 前解析为内联数据
  - _Requirements: 3.1, 3.2, 3.3, 3.5_
  - _Boundary: tools/image-edit_
  - _Depends: 2.1, 2.2_

- [x] 4. 装配与双入口导出
- [x] 4.1 工具集装配与导出契约同步
  - 工具集常量改为 AIGC_TOOLS=[image_generation, image_edit];装配函数经 compileTool 产出工具定义
  - 主入口仅导出声明层符号,执行层符号仅从 runtime 子入口导出,导出列表不再引用已删旧符号
  - 完成态:装配函数产出名为 image_generation/image_edit 的工具定义,主入口不直接或间接顶层引入运行时库
  - _Requirements: 5.2, 5.4, 6.1_
  - _Depends: 1.2, 3.1, 3.2_

- [x] 5. 宿主集成同步
- [x] 5.1 示例 aigc-agent 更新
  - 以新工具名装配工具;系统提示引用 image_generation/image_edit 及 image/prompt 字段
  - 完成态:示例 agent 在新工具名下装配,系统提示与新契约一致
  - _Requirements: 7.1_
  - _Depends: 4.1_

- [x] 5.2 Web 扩展渲染器键与注册表更新
  - 渲染器以 image_generation/image_edit 为键注册;扩展注册表注释更新;明细读取由 variant 改 model
  - 完成态:浏览器触发任一工具时图像产物渲染为图片,保留默认卡片外观与 图片/JSON 切换
  - _Requirements: 7.2, 7.3_
  - _Depends: 4.1_

- [x] 6. 单元测试对齐
- [x] 6.1 (P) 编译器与 model 路由单测
  - 断言 model 枚举等于工具 model 集合;路由命中/缺省/非法回退;明细记录实际 model;降级不抛
  - 完成态:编译器单测在新符号下全绿
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.2, 6.3, 6.4, 8.2_
  - _Boundary: test/engine_
  - _Depends: 1.2_

- [x] 6.2 (P) provider 与 ownership 单测对齐
  - NewAPI 生成/编辑请求体断言;OpenRouter 返回类型与字段;ownership 递归守卫覆盖 image/mask/reference_images
  - 完成态:provider 与 ownership 守卫单测全绿
  - _Requirements: 2.2, 3.2, 3.4, 4.1, 8.2_
  - _Boundary: test/aigc/providers, test/aigc/image-edit-ownership_
  - _Depends: 2.1, 2.2, 2.3_

- [x] 6.3 (P) 工具与装配集成单测对齐
  - image_generation 集成经 mock provider+ctx 走通落库并产出含图像引用的 content
  - 装配集成断言产出工具名为 image_generation/image_edit
  - 完成态:工具与装配集成单测全绿且断言新工具名
  - _Requirements: 2.1, 2.5, 3.1, 7.1, 8.2_
  - _Boundary: test/aigc_
  - _Depends: 3.1, 3.2, 4.1_

- [x] 7. 质量门与端到端验证
- [x] 7.1 类型检查与单测套件
  - 运行 TypeScript 类型检查与 tool-kit 单测套件
  - 完成态:类型检查无错误,单测套件通过
  - _Requirements: 8.1, 8.2_
  - _Depends: 4.1, 6.1, 6.2, 6.3_

- [x] 7.2 浏览器端到端验证
  - e2e 用例工具名对齐;隔离环境完成一次真实 image_generation(默认 gpt-image-2)调用并落库
  - 验证浏览器中工具卡片渲染图片,且即时调用与刷新后历史回放展示一致;缺密钥时降级不崩
  - 完成态:浏览器 e2e 通过,生成图片渲染且历史回放与即时展示一致
  - _Requirements: 4.3, 6.4, 7.3, 8.3_
  - _Depends: 5.1, 5.2, 7.1_
