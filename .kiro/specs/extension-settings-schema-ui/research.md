# Research & Design Decisions

## Summary
- **Feature**: `extension-settings-schema-ui`
- **Discovery Scope**: Extension（扩展现有的 schema 驱动配置 UI 体系）
- **Key Findings**:
  - 现有 `configFiles` widget（`packages/ui/src/config/fields/config-files-field.tsx`）已能对含内联 `$schema`(https) 的扫描文件渲染结构化表单，但门控是「文件存在」，且 schema 必须远端托管。
  - 已安装 pi 包真实落盘于 `~/.pi/agent/npm/node_modules/<id>`（npm）、`~/.pi/agent/git/<host>/<path>`（git）、绝对路径（local）；pi 包 `package.json` 已有 `pi` 字段（`extensions`/`image`）；`@aizigao/pi-proxy-fetch` 已把 `schema.json` 打进包并列入 `files[]`。
  - 服务端 `extensions-config-routes.ts` 已有 `extIdFromPackage()`（packages 规格→扩展 id）与 `scanConfigFiles()`（扫盘 `*.json`），GET 响应为 `{ dir, path, values:{commands,extensions,files} }`。
  - `packages/protocol/src/config/json-schema-to-form-schema.ts` 的对象分支只读 `properties`，不认 `additionalProperties`/`patternProperties`，故 `mcpServers` 这类动态键 map 渲染为空；zod 适配器侧已有 `record` kind + `RecordField` 渲染器可复用。
  - `json-schema-config-form` spec 预留但未接线的 `createSchemaFetcher({ allowHosts })` 与 GET 注入 `fileSchemas` 接缝（`docs/product/12-config-ui` §12 标 `[~]`）正是本特性服务端解析所需。

## Research Log

### 已安装包的本地解析
- **Context**: 脊柱方案要服务端按 `packages[]` 把已装包解析到本地目录读包内 schema。
- **Findings**: `npm:@scope/pkg@x` → `~/.pi/agent/npm/node_modules/@scope/pkg`；`git:host/path@ref` → `~/.pi/agent/git/host/path`；`local:/abs` → `/abs`。`extIdFromPackage()`（`extensions-config-routes.ts:79`）已能剥前缀得 id。
- **Implications**: 服务端解析无需联网即可读包内 `package.json` 与 schema 文件，天然「装了才有」、版本匹配、离线可用。

### `fileSchemas` 如何到达 `ConfigFilesField`
- **Context**: GET 响应需把「文件名→已解析 schema」额外通道送到字段控件；现 `ConfigDomainIO.load()` 只返回 `values`，`FieldProps` 无元数据位。
- **Options**:
  | 方案 | 改动面 | 取舍 |
  |---|---|---|
  | 模块级 store（仿 schemaCache） | 仅 ui | 全局可变 + 全局/项目作用域身份歧义，难测 |
  | values 保留键（`__fileSchemas`） | server+ui | 污染表单值语义，校验需排除 |
  | registry 透传链携带 | registry+ui | 语义混淆（注册表承载元数据） |
  | **类型化 prop 贯通（采纳）** | io→hook→shell→form→field | 全类型安全、无全局态、无数据污染；改动机械但分散 |
- **Decision**: 采用类型化 prop 贯通——`ConfigDomainIO.load()` 返回 `{ values, fileSchemas? }`，经 `useConfigDomain` → `SettingsShell` → `SchemaForm` → `FieldRenderer` → `ConfigFilesField`。

### Schema 来源与服务端/客户端分工
- **Findings**: 内联 `$schema`(②) 现状由**客户端** fetch（`json-schema-config-form` 明确客户端拉取以避服务端 SSRF）。包自带(①) 与 registry(③) 需要读盘/受控联网，归**服务端**解析。
- **Decision**: 服务端解析 ①③ 经 `fileSchemas` 回传（客户端直接 `jsonSchemaToFormSchema`，跳过网络）；②保持客户端 fetch 现状。客户端优先级：`fileSchemas[name]`(①③ 服务端结果) > 内联 `$schema`(②) > 原始 JSON。

## Design Decisions
- **`pi.settings` 约定**：扩展在 `package.json` 的既有 `pi` 块下加 `settings: { file, schema } | Array<...>`；pi 仅消费 `pi.extensions`/`pi.image`，忽略未知子键，故零干扰。
- **Registry 形态**：按扩展 id 索引 `{ "<id>": { file, schema } }`，`schema` 可为内联对象或（白名单）URL；离线快照打进 server 包，`PI_WEB_SCHEMA_REGISTRY_URL` 可远端覆盖。v1 每包一份最新，不分版本。
- **SSRF**：实现预留的 `createSchemaFetcher({ allowHosts })`，远端 registry 与 registry 指向的 schema URL 一律走 host 白名单（默认 `raw.githubusercontent.com`、`pi.dev`），非白名单拒绝并回退。
- **record 修复**：`json-schema-to-form-schema.ts` 在对象分支前置识别 `additionalProperties`(对象→`fields` 模板 / 标量→`itemKind`)、`patternProperties`(取首个值 schema)，产出 `record` 描述符，复用现有 `RecordField`。
- **新建文件**：服务端把「声明了 schema 但盘上不存在」的目标文件以空内容补入 `files`，客户端据 schema 渲染空表单；PUT 对「空且原不存在」的文件不落盘，仅在用户填写后创建。
