# Implementation Plan

- [x] 1. IR 扩展(form-schema.ts)
  - `FieldKind` 加 `"objectList"`;`FieldDescriptor` 加 `itemFields?` 与 `variants?{discriminator,cases[{value,label?,fields}]}`。
  - 完成观察:`tsc` 通过;FIELD_KINDS 含 objectList。
  - _Requirements: 1.4, 1.5_

- [x] 2. JSON Schema → FormSchema IR 适配器
  - `protocol/config/json-schema-to-form-schema.ts` `jsonSchemaToFormSchema(schema, opts?)`:object/string(+enum)/number|integer(+const)/boolean/数组(标量→stringList、enum→multiEnum、对象→objectList)/oneOf-对象-const判别→variants/`$ref`(#/$defs|definitions)内联;description/examples/default/const 映射;不支持构造降级为 string 不抛。`config/index.ts` 导出。
  - 完成观察:以 proxy.json schema 为夹具的单测全过。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_
  - _Depends: 1_

- [x]* 2t. 适配器单测
  - `protocol/test/config/json-schema-adapter.test.ts`:profileConfig→objectList+variants、switchRules 嵌套、`$ref` 内联、enabled→boolean、profileName→string。
  - _Requirements: 5.1_
  - _Depends: 2_

- [x] 3. ObjectListField 控件
  - `ui/config/fields/object-list-field.tsx`:数组项增删;有 variants → 判别 select 切换变体并渲染该 case 字段;否则按 itemFields 渲染;经 FieldRenderer 递归。注册到 field-renderer DEFAULTS(kind objectList)。
  - 完成观察:单测增删 + oneOf 判别切换 + 值回写通过。
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Depends: 1_

- [x]* 3t. ObjectListField 单测
  - `ui/test/config/object-list-field.test.tsx`。
  - _Requirements: 5.2_
  - _Depends: 3_

- [x] 4. 客户端 schema 拉取 + ConfigFilesField 结构化渲染
  - `ConfigFilesField`:读文件 `$schema`(https)→ 客户端 fetch → `jsonSchemaToFormSchema` → `<SchemaForm>`;失败/无 schema → 原始 JSON(现状)。按 URL 模块级缓存;加载中态。可注入 fetch(测试)。
  - 完成观察:有 schema 渲染结构化表单;无/失败回退原始 JSON;单测两分支。
  - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3_
  - _Depends: 2, 3_

- [~] 5. (可选接缝)服务端 schema-fetch
  - `server/config/schema-fetch.ts` `createSchemaFetcher`(注入 fetch + host 允许 + 缓存),保留为将来服务端拉取与单测接缝;不接入主链路。
  - _Requirements: 2.3, 2.4, 5.4_

- [x]* 6. node e2e
  - 带 `$schema` 的 proxy.json:PUT 结构化值往返保留 `$schema` 与结构(沿用 config-domains e2e,注入 fetch 替身或仅验证 files 往返)。
  - _Requirements: 5.3_
  - _Depends: 4_

- [x] 7. 收尾
  - typecheck 全绿;重启 dev 验证 proxy.json 渲染结构化表单;更新 `docs/pi-sandbox-integration-research.md`。
  - _Requirements: 4.1, 4.2_
  - _Depends: 4_
