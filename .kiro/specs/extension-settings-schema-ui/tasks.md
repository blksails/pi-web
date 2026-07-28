# Implementation Plan

- [x] 1. 基础：协议层 record 支持、配置域贯通契约、测试夹具
- [x] 1.1 (P) 表单 IR 适配器支持动态键 map（additionalProperties / patternProperties → record）
  - 在 JSON Schema → FormSchema 适配器的对象判定前置识别 `additionalProperties`（对象值 → 以其字段为每条目子字段模板的 record；标量值 → 带元素类型的 record）与 `patternProperties`（取首个模式值 schema 作为值模板）。
  - `additionalProperties: false` 或 `true`（布尔）不触发 record；既有 `properties`/数组/`oneOf`/枚举映射不回归。
  - 观察完成：新增单测覆盖「`mcpServers` 式动态键对象」转出 `kind:"record"` 且每条目可按值 schema 子字段渲染；旧用例全绿。
  - _Requirements: 7.1, 7.2, 7.3_
  - _Boundary: jsonSchemaToFormSchema_

- [x] 1.2 配置域加载契约贯通 fileSchemas
  - 将配置域 IO 的加载结果由「仅表单值」改为「表单值 + 可选 fileSchemas」，并适配所有现有 IO 工厂（含 app 层 URL IO、通用域 IO、沙箱项目 IO）与受影响的既有测试。
  - 配置域 hook 捕获并对外暴露 fileSchemas；其余配置域（auth/settings/sandbox/logging）行为不回归。
  - 观察完成：现有所有配置面板加载/保存测试在新契约下通过；hook 返回值新增 fileSchemas 字段且默认 undefined。
  - _Requirements: 3.1, 8.1_
  - _Boundary: ConfigDomainIO, useConfigDomain_

- [x] 1.3 (P) 测试夹具：临时 agentDir 种入「已安装假扩展」
  - 提供可复用 helper：在临时目录构造 `npm/node_modules/<id>/package.json`（含 `pi.settings`）+ 包内 schema 文件 + 可选配置文件 + `settings.json`（`packages[]` 含/不含该包）。
  - 覆盖 npm 作用域包、git、local 三种安装规格的目录布局。
  - 观察完成：helper 返回 agentDir 路径，被后续解析器单测/集成/e2e 复用，单测能据此断言「装/未装」两态。
  - _Requirements: 1.1, 1.3_
  - _Boundary: test fixtures_

- [x] 2. 服务端：registry 与 schema 解析器
- [x] 2.1 (P) Schema registry（离线快照 + 查询 + 白名单远端拉取）
  - 实现按扩展 id 索引的 registry：内置离线快照（JSON 数据文件，含 pi-mcp-adapter / @aizigao/pi-proxy-fetch 等初始条目）+ `lookup(extId)`；条目 schema 为内联对象直接用、为 URL 则经受控拉取。
  - 实现预留的受控拉取器：仅放行 host 白名单（默认 `raw.githubusercontent.com`、`pi.dev`）的 URL，非白名单拒绝；支持 env 远端 registry 覆盖快照；按 key/URL 缓存；远端不可用回退快照；fetch 实现可注入以便测试。
  - 观察完成：单测证明 快照命中、远端覆盖、非白名单 host 被拒并回退、缓存命中、远端失败回退快照。
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3_
  - _Boundary: schema-registry_

- [x] 2.2 已安装扩展 → settings schema 解析器（三源 ①③ + install 门控）
  - 解析 `settings.json` 的 `packages[]` → 扩展 id → 本地包目录（npm/git/local 三布局）；读包 `pi.settings`（单个或数组）并加载包内 schema（①）；①未命中且该目标文件内容无内联 `$schema` 时按 id 查 registry（③）；②留客户端不在此解析。
  - 仅处理 `packages[]` 内（已安装/启用）扩展；任一来源读取异常即略过该扩展不抛；产出 fileSchemas 与「声明了 schema 但磁盘缺失」的待补空文件清单。
  - 观察完成：单测用 1.3 夹具证明 装包→fileSchemas 含其文件、未装→不含（install 门控）、缺文件→出现在待补清单、registry 兜底命中。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 3.1, 3.2, 3.3, 3.4, 8.4_
  - _Depends: 2.1, 1.3_
  - _Boundary: schema-resolver_

- [x] 3. 客户端：fileSchemas 透传与 ConfigFilesField 渲染
- [x] 3.1 (P) 表单层贯通 fileSchemas 并优先采用、支持空表单新建与回退
  - 在表单渲染层为顶层字段新增 fileSchemas 透传位（表单组件 props → 字段 props），由设置外壳把 hook 暴露的 fileSchemas 注入。
  - 配置文件控件：对某文件优先用 `fileSchemas[name]` 同步转为结构化表单（不发网络）；无则维持内联 `$schema` 客户端拉取（现状）；皆无则原始 JSON；文件内容为空但有 schema 时渲染空结构化表单以供新建。
  - 观察完成：组件测试证明 提供 fileSchemas 时不触发 fetch 且渲染结构化表单、空内容+schema 渲染空表单、无任何 schema 回退原始 JSON、内联 $schema 路径不回归。
  - _Requirements: 1.5, 2.1, 3.1, 3.3, 4.1, 4.2, 7.1_
  - _Depends: 1.1, 1.2_
  - _Boundary: SchemaForm, FieldRenderer, ConfigFilesField, SettingsShell_

- [x] 4. 集成：服务端路由接入与端到端接通
- [x] 4.1 扩展配置端点接入解析器（GET 注入 fileSchemas + 补空文件；PUT 新建/非破坏）
  - GET 调用解析器，将 fileSchemas 随响应回传，并把「待补空文件」以空内容并入返回的文件集合以供前端新建；保持鉴权与全局/项目作用域不变。
  - PUT：对「内容为空且原文件不存在」的目标文件跳过落盘，其余维持既有非破坏写盘；用户填写后正常创建于扩展实际读取路径。
  - 观察完成：集成测试（真实路由 + 1.3 临时 agentDir）断言 装包 GET 响应含 fileSchemas 与空占位文件、卸载后不含（门控）、PUT 写出新建文件且不破坏既有键、空未改文件不落盘。
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 8.1, 8.2, 8.3_
  - _Depends: 2.2_
  - _Boundary: extensions-config-routes_

- [x] 4.2 端到端接通扩展面板（app 层 IO 回传 fileSchemas 直达控件）
  - 让扩展面板实际使用的 URL IO 从 GET 响应中取出 fileSchemas 并经契约回传，确保设置外壳→表单→配置文件控件全链拿到服务端解析结果。
  - 观察完成：在 app 层装配下，已装且声明 schema 的扩展在扩展面板渲染为结构化表单（而非原始 JSON），未装扩展无该表单。
  - _Requirements: 1.2, 3.1_
  - _Depends: 3.1, 4.1_
  - _Boundary: register-panels(扩展面板 IO), SettingsShell_

- [x] 5. 验证：端到端测试
- [x] 5.1 Node 端 e2e（真实 handler + 临时 agentDir，确定性无网络）
  - 经真实配置端点端到端验证：①包自带 schema 解析、③registry-内联条目解析、install 门控（装/未装）、PUT 新建文件落盘与非破坏写盘。
  - 使用受控注入避免真实联网；隔离 agentDir 与构建产物。
  - 观察完成：新增 e2e 用例全绿，输出可佐证「装包→结构化 schema 经端点抵达 + 未装→无」「新建文件成功且既有键保留」。
  - _Requirements: 1.1, 1.3, 2.2, 2.3, 3.4, 5.1, 6.1, 8.2_
  - _Depends: 4.1_
  - _Boundary: server e2e_

- [x]* 5.2 浏览器 e2e（补充：可视化结构化表单与门控）
  - Playwright（隔离构建 + 外部 server）打开设置→扩展，对种入的已装假包断言渲染出结构化表单（含动态键 map 条目控件），对未装包断言无表单。
  - 观察完成：浏览器用例可见 record 条目控件与类型化字段，未装扩展无表单；作为 5.1 之上的可视化补充验证 1.1/3.1/7.1。
  - _Requirements: 1.1, 3.1, 7.1_
  - _Depends: 4.2_
  - _Boundary: browser e2e_

## 5.2 实现记录(2026-07-24)

本项原为 `*` 可选补充,现已实现:`e2e/browser/extension-settings-schema.e2e.ts`(2 用例)。

**夹具**(种在 `playwright.config.ts` 的隔离 agentDir 内,不触碰真实 `~/.pi/agent`)——
对应 schema-resolver 来源①「包自带」的三件套:
1. `settings.json` 的 `packages[]` 含假扩展(install 门控只处理已装扩展);
2. `<agentDir>/npm/node_modules/pi-e2e-schema-ext/package.json` 的 `pi.settings = {file, schema}`;
3. 包内 schema 文件(含一个 record 型属性 `headers`,用于驱动动态键 map 条目控件)。

**断言**(用仓库真实 `data-pi-*` 属性,不猜 testid):`data-pi-config-file` 卡片可见、
卡片内存在 `data-pi-field`(证明 schema 抵达前端、未回退裸 JSON)、`data-pi-record-entry="X-E2E"`
(证明动态键 map 条目控件渲染);另一用例断言未装扩展不产生卡片(门控)。

**★ 变异验证(证明用例有牙)**:把夹具的 `packages[]` 清空(模拟扩展未安装)后,
第一个用例**转红**(`data-pi-record-entry` 不可见)—— 证明它真在验证「install 门控 + schema
抵达」链路,而非恒真断言。还原后 2/2 复绿。

**回归**:既有 `settings-config.e2e.ts` 2/2 通过,新夹具未污染。
