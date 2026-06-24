# Implementation Plan — aigc-generation-tools

> Wave 1:text_to_image + image_edit,纯执行→落库→默认卡片闭环。引擎承载于新建 `@blksails/pi-web-tool-kit`(双入口)。
> spike-first:**任务 4** 是首个端到端可验证点(text_to_image + 单 provider 跑通),据此确认「移植精简引擎」策略;任务 5 起再扩展。

- [ ] 1. Foundation:`@blksails/pi-web-tool-kit` 包脚手架与引擎类型
- [x] 1.1 创建 `@blksails/pi-web-tool-kit` 包骨架(双入口)并接入 workspace
  - 新建包目录,配置 `package.json`:主入口(声明,零运行时依赖)+ `./runtime` 子入口(node-only);`peerDependencies` 含 pi SDK / pi-ai,`dependencies` 含 undici 与 type-only 的 agent-kit
  - 配置 tsconfig(strict,禁 any)、build、vitest;主入口构建产物中**不得**出现 pi SDK / undici 值导入
  - 在仓库根 `pnpm install` 后,其它包可解析 `@blksails/pi-web-tool-kit` 与 `@blksails/pi-web-tool-kit/runtime`;`pnpm -F @blksails/pi-web-tool-kit build` 成功
  - _Requirements: 6.1, 6.3_
- [x] 1.2 定义引擎类型契约
  - 移植精简引擎类型:`Category`/`Variant`/`EndpointBehavior`/`PickedResult`/`UserParamSpec`/`AsyncSpec`/`EndpointInputSchema`
  - 类型零运行时依赖,可从主入口安全导出;`tsc` 通过且无 any
  - _Requirements: 6.1_
  - _Boundary: engine/types_

- [ ] 2. Core:执行内核(provider 调用 + 变量解析)
- [x] 2.1 (P) 实现 env-only 变量解析与必需变量校验
  - `${VAR}` 从 `process.env` 解析;缺失语义区分必需(报错)与可选(返回空)
  - 提供必需变量校验,返回缺失清单供上层判定降级
  - 单测覆盖:命中、缺失、可选缺失、必需缺失清单
  - _Requirements: 5.1, 5.2_
  - _Boundary: engine/var-resolver_
- [x] 2.2 (P) 实现可选代理 fetch
  - 基于 undici 支持 http/socks5 代理;代理 env 未配置时直连
  - 提供可注入的 fetch 实现(供测试 mock 与 endpoint 复用)
  - 单测覆盖:无代理直连路径(mock)与代理 URL 解析
  - _Requirements: 1.3, 1.6_
  - _Boundary: engine/proxy-fetch_
- [x] 2.3 实现执行适配器 runEndpoint(同步 / 异步轮询 / 超时 / 取消)
  - 同步路径:构造请求体、调用、`detectError`、`pickResult` → PickedResult
  - 异步路径:提交 → 轮询 status(pollMs)→ 完成取 response;到 timeoutMs 抛超时;`AbortSignal` 中断 sleep 与请求
  - provider 错误/超时返回可读错误信息;buildBody 可异步、headers/url 经变量解析展开
  - 单测覆盖:同步成功、异步 PENDING→SUCCEEDED、超时抛错、abort 取消、provider 错误检测
  - _Requirements: 1.3, 1.4, 1.6, 7.3, 7.4_
  - _Depends: 2.1, 2.2_
  - _Boundary: engine/endpoint-adapter_

- [ ] 3. Core:附件落库适配
- [x] 3.1 (P) 实现 attachment ctx seam 读取
  - 以约定 seam key 读取注入的 attachment ctx;缺失返回 `available:false` 的安全降级上下文
  - 单测:注入时返回真实 ctx;未注入时返回降级上下文(不抛)
  - _Requirements: 3.1, 5.3_
  - _Boundary: attachment/seam_
- [x] 3.2 实现产物落库与输入解析适配
  - 产物落库:对 PickedResult 的远程 url 逐个 fetch 字节 → `putOutput` → 回 `att_<id>` + displayUrl
  - 输入解析:`att_id` → `resolve().bytes()` → data URI(供 provider 请求内联)
  - putOutput 失败抛错(不回半引用);单测以 mock ctx 断言多 url 多次落库、data URI 转换
  - _Requirements: 2.1, 3.1, 3.2, 3.3_
  - _Depends: 3.1_
  - _Boundary: attachment/persist_

- [ ] 4. Core spike:编译器 + text_to_image 端到端跑通(引擎策略确认点)
- [x] 4.1 实现 Category→ToolDefinition 编译器
  - 参数合并(LLM args > userParam 默认)、默认变体选取(LLM model > defaultVariant)
  - 入参 schema 映射为 pi 工具参数并暴露给 LLM;非法/越界参数返回可读参数错误
  - execute 入口:必需变量缺失或 ctx 不可用 → 返回 `{ok:false,error}` 降级(不抛、不崩溃)
  - 成功路径:调 runEndpoint → 落库 → 组装 content(文本说明 + 可选 inline image)+ 判别联合 details
  - 单测:默认变体、model 覆盖、参数越界报错、缺密钥降级、ctx 不可用降级
  - _Requirements: 1.1, 1.2, 1.5, 1.6, 4.1, 4.2, 4.3, 5.2, 5.3_
  - _Boundary: engine/compile-category_
- [x] 4.2 声明首个 provider 变体与 text_to_image 工具,端到端跑通
  - 实现一个 DashScope provider 工厂(含一个 sync 与一个 async 变体)
  - 声明 `text_to_image` category(required `prompt`,默认变体指向最易获得密钥的 provider)
  - 提供 `buildAigcTools` 装配入口,产出可进 `defineAgent({customTools})` 的工具
  - 集成测试(mock fetch + mock ctx):prompt → 生成 image-set → 落库 → details 含 `att_id`,验证 sync 与 async 两路径
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 3.1, 3.4, 6.2_
  - _Depends: 2.3, 3.2, 4.1_
  - _Boundary: aigc/providers/dashscope, aigc/categories/text-to-image, aigc/index_

- [ ] 5. Core:扩展 provider 与 image_edit
- [x] 5.1 (P) 扩展 text_to_image 的 OpenRouter 与 NewAPI 变体
  - 实现 OpenRouter(chat/completions + modalities + inline data URI 经注入 fetch)与 NewAPI provider 工厂
  - 接入 text_to_image variants;`paramOverrides`(隐藏不支持参数)生效
  - 单测:各 provider buildBody 形态、pickResult 提取 url
  - _Requirements: 1.1, 1.2_
  - _Boundary: aigc/providers/openrouter, aigc/providers/newapi_
- [x] 5.2 声明 image_edit 工具(输入附件解析 + mask/参考图)
  - 声明 `image_edit` category(required `instruction` + 输入图);输入图经落库适配 `att_id`→data URI 喂 provider
  - DashScope mask-aware 变体(content 顺序 主图→mask→参考→指令)与 OpenRouter/NewAPI 无 mask 变体
  - 属主由 beforeToolCall 前置保证;输入引用无效/越权 → 可读错误且不访问越权资源
  - 集成测试(mock fetch + mock ctx):instruction + 输入 att_id → 编辑 → 落库回引用;mask/参考图路径
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Depends: 4.1, 3.2_
  - _Boundary: aigc/providers/dashscope, aigc/categories/image-edit_
- [x] 5.3 将 image_edit 纳入 buildAigcTools 并支持工具集筛选
  - `buildAigcTools` 输出 text_to_image 与 image_edit 两工具;支持 include 选择子集
  - 集成测试:装配产物含两工具且类型通过
  - _Requirements: 6.1, 6.2_
  - _Depends: 4.2, 5.2_
  - _Boundary: aigc/index_

- [ ] 6. Integration:示例 agent 与降级集成
- [x] 6.1 创建端到端示例 agent 并装配 AIGC 工具
  - 新增 `examples/aigc-agent`,`defineAgent({ customTools: buildAigcTools(), ... })`,带引导 systemPrompt
  - 集成测试:未注入 seam ctx(模拟未装配)时 agent 工具仍加载成功、调用返回降级,不崩溃
  - _Requirements: 5.3, 6.1, 6.2, 7.1_
  - _Depends: 5.3_
  - _Boundary: examples/aigc-agent_

- [ ] 7. Validation:端到端验证
- [x] 7.1 text_to_image 浏览器 e2e(真实闭环 + 默认卡片)
  - 选 `examples/aigc-agent` 源 → prompt 触发 text_to_image(优先 sync 变体)→ 生成 → 落库 → 默认工具卡片展示产物
  - 历史回放/卡片中只见 `att_<id>` 引用与图像,不暴露内联 base64 或占位符(afterToolCall 闸门 + 默认卡片)
  - 提供密钥时验证真实生成路径;无密钥时验证降级路径;以新鲜证据(截图/输出)证明
  - _Requirements: 1.5, 3.2, 3.3, 3.4, 5.3, 7.2_
  - _Depends: 6.1_
