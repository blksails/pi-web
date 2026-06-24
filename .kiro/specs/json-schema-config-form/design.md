# Design Document

## Overview
新增「JSON Schema → FormSchema IR」适配器与对象数组/oneOf 的 IR/控件,使扩展独立配置文件(带 `$schema`)
渲染为结构化表单。复用既有 `SchemaForm`/`FieldRenderer`/`field-registry`。

## Boundary Commitments
- **Owns**:`protocol/config/json-schema-to-form-schema.ts`(适配器)+ `form-schema.ts` IR 扩展(`objectList` kind、
  `itemFields`、`variants`);`server` 远端 schema 拉取(`config/schema-fetch.ts`)+ 扩展 GET 注入 `fileSchemas`;
  `ui` `object-list-field.tsx` 控件 + `config-files-field.tsx` 结构化/原始 JSON 分支。
- **Out**:完整 JSON Schema 规范;扩展配置文件发现(沿用 config-ui-sandbox-extensions)。
- **Deps**:`@blksails/protocol` IR、`SchemaForm`、Node `fetch`(服务端拉取)。
- **Revalidation**:IR 渲染契约变化;JSON Schema 用到 in-scope 之外的构造。

## File Structure Plan
### 新建
- `packages/protocol/src/config/json-schema-to-form-schema.ts` — `jsonSchemaToFormSchema(schema): FormSchema`。
- `packages/server/src/config/schema-fetch.ts` — `createSchemaFetcher({fetchImpl?, allowHosts?})`:拉取+缓存+转 IR(注入式)。
- `packages/ui/src/config/fields/object-list-field.tsx` — objectList 控件(增删 + oneOf 判别)。
### 修改
- `packages/protocol/src/config/form-schema.ts` — `FieldKind` 加 `objectList`;`FieldDescriptor` 加 `itemFields?`、`variants?`。
- `packages/protocol/src/config/index.ts` — 导出适配器。
- `packages/server/src/config/extensions-config-routes.ts` — GET 注入 `fileSchemas`(经注入的 fetcher);options 加 `schemaFetcher?`。
- `packages/ui/src/config/field-renderer.tsx` — 注册 `objectList` 默认控件。
- `packages/ui/src/config/fields/config-files-field.tsx` — 有 schema → `SchemaForm`,否则原始 JSON。
- `lib/app/pi-handler.ts` — 注入默认 `schemaFetcher`(允许 github 域)。

## Components and Interfaces
### IR 扩展(form-schema.ts)
```ts
FieldKind |= "objectList"
FieldDescriptor += {
  itemFields?: FieldDescriptor[]      // objectList:item 为单一对象形状时的字段
  variants?: {                        // objectList/object:oneOf 多态
    discriminator: string             // 判别键(如 "type")
    cases: Array<{ value: string; label?: string; fields: FieldDescriptor[] }>
  }
}
```

### 适配器(jsonSchemaToFormSchema)
- 入口:`jsonSchemaToFormSchema(schema, opts?) → FormSchema`(domain 取 schema.title 或传入)。
- 递归 `nodeToField(key, node)`:按 `type`/`enum`/`oneOf`/`$ref`/`array.items` 分派到 IR kind。
- `$ref` 解析:维护 root schema,解析 `#/$defs|definitions/<name>`。
- oneOf-对象:检测各分支 `properties.<k>.const` 共同判别键 → `variants`。

### 远端拉取(schema-fetch.ts)
- `createSchemaFetcher({fetchImpl=fetch, allowHosts=[github...]}) → { get(url): Promise<FormSchema | undefined> }`。
- 校验 https + host 允许;拉取→JSON.parse→jsonSchemaToFormSchema;按 url 缓存(Map);失败返回 undefined。
- 测试注入 `fetchImpl` 替身(不联网)。

### 扩展 GET 注入
- handleGet:扫描 files 后,对每个含 `$schema`(string,https)的文件,`schemaFetcher.get(url)` → `fileSchemas[name]=FormSchema`(best-effort)。返回 `{values:{...files}, fileSchemas}`。

### 控件
- `ObjectListField`(kind objectList):value 为数组。每项卡片:若有 `variants` → 判别 select + 该 case 字段;否则按 `itemFields` 渲染。增/删项;经 `FieldRenderer` 递归。
- `ConfigFilesField`:**客户端**按文件内容的 `$schema`(https URL)拉取 schema、经共享 `jsonSchemaToFormSchema`
  转 IR、用 `<SchemaForm>` 渲染结构化表单;无 `$schema` 或拉取/转换失败 → 回退原始 JSON textarea(现状)。
  拉取按 URL 在模块级 Map 缓存;状态为「加载中 / 表单 / 原始 JSON 回退」。

> **交付决策**:schema 拉取放**客户端**(在 ConfigFilesField 内),而非服务端注入 `fileSchemas`——
> 适配器在 `@blksails/protocol`(前后端共享),浏览器直接 fetch 文件自带的 `$schema`(githubusercontent 允许 CORS),
> 避免把 `fileSchemas` 透传穿过 useConfigDomain→SchemaForm→FieldRenderer 的管线,也避免服务端对任意 URL 的
> SSRF 面。Requirement 2 的「缓存/失败回退/host 校验」在客户端拉取处实现(host 校验为软性:失败即回退)。
> 服务端 `schema-fetch.ts` 仍保留为可选注入接缝(便于将来改服务端拉取与单测),但 MVP 走客户端。

## Error Handling
- 适配器遇不支持的构造 → 该字段降级为原始 JSON(`widget:"configFiles"` 单值)或 `string`,不抛。
- 拉取失败/非法 host → 省略 schema,回退原始 JSON。
- 控件 JSON 解析失败 → 就地报错不回写(沿用现状)。

## Testing Strategy
- 单测(protocol):`jsonSchemaToFormSchema` 以 proxy.json schema 为夹具,断言 profileConfig→objectList+variants、
  switchRules 嵌套、enabled→boolean、profileName→string、`$ref` 内联。
- 单测(ui):ObjectListField 增删 + oneOf 判别切换 + 值回写;ConfigFilesField 有/无 schema 分支。
- 单测(server):createSchemaFetcher 注入替身 fetch,断言缓存、host 校验、失败回退。
- node e2e:写带 `$schema` 的 proxy.json + 注入 fetcher,GET 返回 fileSchemas;PUT 结构化值往返保留 `$schema`。
