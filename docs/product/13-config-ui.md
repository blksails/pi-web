# 12 · Schema 驱动配置 UI

配置 UI 以 **schema 为单一事实源**，自动生成可校验、可读写、可扩展的设置界面；不为每个配置域手写表单，而是用统一的表单 IR（`FormSchema`）把 zod schema / JSON Schema 推导为控件树，再经可插拔的渲染器注册表渲染。

---

## 1. 三个 Spec 的分工

| Spec | 路径 | 核心职责 |
|---|---|---|
| `schema-config-ui` | `.kiro/specs/schema-config-ui/` | 基础架构：`FormSchema` IR、`zodToFormSchema` 适配器、`SchemaForm` 渲染层、`SettingsShell` + 面板注册表、`GET·PUT /api/config/:domain` 端点、凭证 secret 安全 |
| `config-ui-sandbox-extensions` | `.kiro/specs/config-ui-sandbox-extensions/` | 沙箱配置域（全局 + 项目）、扩展配置域（Slash 命令可用性 + per-扩展 KV）、分组 Tab 布局、沙箱强制注入 |
| `json-schema-config-form` | `.kiro/specs/json-schema-config-form/` | JSON Schema → IR 适配器、远端 `$schema` 拉取与缓存、`objectList` / `oneOf` 多态控件，供扩展独立配置文件（如 `proxy.json`）结构化编辑 |

三个 spec 共享同一 IR 和渲染层，仅扩展配置域或控件。

---

## 2. 核心架构

```
@blksails/pi-web-protocol(零运行时依赖，除 zod)
  form-schema.ts        → FieldDescriptor / FormSchema 类型
  meta.ts               → UIMeta + parseDescribeMeta()
  zod-to-form-schema.ts → zodToFormSchema(domain, zodSchema) → FormSchema
  json-schema-to-form-schema.ts → jsonSchemaToFormSchema(jsonSchema) → FormSchema
  config/domains/
    auth.ts      settings.ts     sandbox.ts     extensions.ts
           ↓
@blksails/pi-web-react
  use-schema-form.ts    → useSchemaForm(formSchema, { validate }) — 受控值 + zod 校验
  use-config-domain.ts  → useConfigDomain(panel)  — load/save + 状态机
  settings-registry.ts  → defaultSettingsRegistry  — 面板注册表(单例 + 工厂)
  makeConfigDomainIO()  → 基于 /api/config/:domain 的 load/save
           ↓
@blksails/pi-web-ui
  config/schema-form.tsx    → <SchemaForm>
  config/field-renderer.tsx → <FieldRenderer>  — 按 widget/kind 分派
  config/field-registry.ts  → defaultFieldRegistry  — 渲染器注册表
  config/fields/
    string-field.tsx  secret-field.tsx  enum-field.tsx  record-field.tsx
    boolean-field.tsx  string-list-field.tsx  object-field.tsx
    object-list-field.tsx  extensions-kv-field.tsx  model-select-field.tsx
           ↓
server
  config/config-codec.ts         → 读写 ~/.pi/agent/*.json + 保留未知字段
  config/config-routes.ts        → GET·PUT /config/:domain
  config/secret-merge.ts         → maskSecrets / mergeSecrets
  config/sandbox-project-routes.ts  → /config/sandbox/project
  config/extensions-config-routes.ts → /config/extensions[/project]
           ↓
app
  lib/settings/register-panels.ts   → 幂等注册所有面板(auth/settings/sandbox/extensions)
  app/settings/page.tsx             → <SettingsShell> 挂载点
```

依赖方向严格单向：`protocol → react → ui → server/app`。

---

## 3. 表单 IR：`FormSchema` / `FieldDescriptor`

渲染层不直接消费 zod 结构或 JSON Schema；一切来源都先经适配器转为**归一化中间表示**。

```ts
// packages/protocol/src/config/form-schema.ts
export type FieldKind =
  | "string" | "secret" | "number" | "boolean"
  | "enum"   | "multiEnum" | "stringList"
  | "object" | "record"    | "objectList";

export interface FieldDescriptor {
  key: string;
  kind: FieldKind;
  label: string;
  description?: string;
  placeholder?: string;
  required: boolean;
  default?: unknown;
  group?: string;
  order?: number;
  enumOptions?: readonly { value: string; label?: string }[];
  fields?: readonly FieldDescriptor[];   // object 子字段 / record 值模板
  itemFields?: readonly FieldDescriptor[]; // objectList 项字段
  variants?: FieldVariants;              // oneOf 多态判别
  itemKind?: FieldKind;                  // stringList / record 标量元素类型
  widget?: string;                       // 自定义渲染器键名
  secret?: boolean;
  readOnly?: boolean;
}

export interface FormSchema {
  domain: string;
  title?: string;
  fields: readonly FieldDescriptor[];
  groups?: readonly FieldGroup[];
}
```

`FieldDescriptor` 是渲染契约的"窄腰"：渲染器只认它，任何来源（zod / JSON Schema / 手写）只要产出 `FormSchema` 即可被渲染。

---

## 4. zod → IR 适配器（`zodToFormSchema`）

```ts
// packages/protocol/src/config/zod-to-form-schema.ts
export function zodToFormSchema(
  domain: string,
  schema: z.ZodTypeAny,
  opts?: { title?: string; groups?: readonly FieldGroup[] },
): FormSchema
```

适配器的两个关键机制：

**类型推断**（`packages/protocol/src/config/zod-to-form-schema.ts:75`）：

| zod 类型 | 推断 `kind` |
|---|---|
| `ZodString`（普通）| `string` |
| `ZodString`（key 含 `apiKey`/`token`/`secret`，或 meta.secret=true）| `secret` |
| `ZodNumber` | `number` |
| `ZodBoolean` | `boolean` |
| `ZodEnum` / `ZodNativeEnum` | `enum` |
| `ZodArray<ZodEnum>` | `multiEnum` |
| `ZodArray<其他>` | `stringList` |
| `ZodObject` | `object` |
| `ZodRecord` | `record` |

**UI 元数据策略**（`packages/protocol/src/config/meta.ts`）：

项目使用 zod 3.x，无 `.meta()`，故约定把 UI 提示以 **JSON 字符串**写入 `.describe()`：

```ts
// packages/protocol/src/config/domains/settings.ts
defaultProvider: z.string().optional().describe(
  JSON.stringify({
    label: "默认 Provider",
    group: "model",
    order: 1,
    placeholder: "如 anthropic / openrouter",
    widget: "providerSelect",   // 指定自定义渲染器
  }),
),
```

`parseDescribeMeta()` 解析上述字符串；非 JSON 内容降级为 `{ description: text }`；缺省时安全返回空元数据。

---

## 5. 内置配置域

| 域 id | 文件 | schema | 端点 |
|---|---|---|---|
| `auth` | `~/.pi/agent/auth.json` | `authConfigSchema`（`record(provider → {apiKey, baseURL?})`） | `GET·PUT /api/config/auth` |
| `settings` | `~/.pi/agent/settings.json` | `settingsConfigSchema`（defaultProvider/Model/ThinkingLevel/theme） | `GET·PUT /api/config/settings` |
| `sandbox` | `~/.pi/agent/sandbox.json` | `sandboxConfigSchema`（enabled/network/filesystem） | `GET·PUT /api/config/sandbox` |
| `sandbox-project` | `<cwd>/.pi/sandbox.json` | 同上，项目覆盖全局 | `GET·PUT /api/config/sandbox/project` |
| `extensions`（全局）| `~/.pi/agent/settings.json` 中 commands + per-扩展 KV | `extensionsConfigSchema` | `GET·PUT /api/config/extensions/global` |
| `extensions-project` | `<cwd>/.pi/settings.json` | 同上 | `GET·PUT /api/config/extensions/project` |

> `extensions` 和 `sandbox/project` 有自定义互映逻辑，不走通用 `CONFIG_FORM_SCHEMAS` 注册表，而是经专属路由（`extensions-config-routes.ts` / `sandbox-project-routes.ts`）处理。
>
> 全局配置目录默认 `~/.pi/agent`，可经环境变量 `PI_WEB_AGENT_DIR` 覆盖（见 `config-codec.ts:16`）。本表中的 `~/.pi/agent/*.json` 均指该默认目录。

### API 响应格式

```
GET /api/config/:domain
→ { formSchema: FormSchema, values: Record<string, unknown> }   # values 中 secret 字段已掩码

PUT /api/config/:domain
← { values: Record<string, unknown> }
→ 200 | 422（校验失败）| 403（鉴权）| 404（未知域）
```

**Secret 安全**：GET 时 auth 的 apiKey **绝不回传明文**，返回掩码占位；PUT 时空值保留原值不变，提交新值覆盖，显式"清除"删除该键。文件权限写入 `0600`。

---

## 6. 渲染层组件（`@blksails/pi-web-ui`）

### `<SchemaForm>`（`packages/ui/src/config/schema-form.tsx`）

受控组件：`values`（整域对象）/ `onChange(next)`（返回完整的下一对象）/ `errors`（点路径 → 错误消息）由调用方（经 `useSchemaForm`）提供。遍历 `fields`，按 `group` 分区，调用 `<FieldRenderer>`。

### `<FieldRenderer>`（`packages/ui/src/config/field-renderer.tsx`）

分派优先级：**注册表 fieldKey 覆盖 → widget key → kind 内置控件 → FallbackField（只读 JSON 文本）**。

```ts
// 内置默认控件映射
const DEFAULTS = {
  string: StringField,
  secret: SecretField,
  enum: EnumField,
  record: RecordField,
  boolean: BooleanField,
  stringList: StringListField,
  object: ObjectField,
  objectList: ObjectListField,
};
```

容器字段（`record` / `object` / `objectList`）透传当前注册表给嵌套渲染，宿主覆盖在嵌套层同样生效。

### 字段控件统一 props（`packages/ui/src/config/field-registry.ts`）

```ts
export interface FieldProps<V = unknown> {
  descriptor: FieldDescriptor;
  value: V;
  onChange: (next: V) => void;
  path: readonly string[];    // 自根起的点路径（用于 errors 索引）
  errors: Readonly<Record<string, string>>;
  disabled?: boolean;
  registry?: FieldRegistry;   // 容器字段透传
}
```

---

## 7. 字段渲染器注册表（`FieldRegistry`）

```ts
// packages/ui/src/config/field-registry.ts
export const defaultFieldRegistry: FieldRegistry;    // 模块级单例
export function createFieldRegistry(): FieldRegistry; // 工厂（测试隔离）

export function registerFieldRendererByKey(widget: string, component): void;
export function registerFieldRendererByKind(kind: FieldKind, component): void;
```

`resolve(descriptor)` 解析优先级：`byKey[descriptor.key]` → `byKey[descriptor.widget]` → `byKind[descriptor.kind]` → `undefined`（`FieldRenderer` 回退内置）。

---

## 8. 已落地的自定义 widget

### `providerSelect` / `modelSelect`（`packages/ui/src/config/fields/model-select-field.tsx`）

可搜索下拉（Popover + Command/cmdk），选项来自 **`GET /api/config/models`**（需在 `createConfigRoutes` 时注入 `listModelOptions` 接缝）。注册于 `lib/settings/register-panels.ts`：

```ts
registerFieldRendererByKey("providerSelect", ModelSelectField);
registerFieldRendererByKey("modelSelect", ModelSelectField);
```

`settings.json` 的 `defaultProvider` / `defaultModel` 字段在 schema 中通过 `.describe(JSON.stringify({ widget: "providerSelect" / "modelSelect" }))` 声明使用此 widget。

### `extensionsKv`（`packages/ui/src/config/fields/extensions-kv-field.tsx`）

两级动态增删：外层"扩展条目"（key = extId）、内层"键值对"，用于 per-扩展 KV 参数配置。

### `configFiles`（`packages/ui/src/config/fields/config-files-field.tsx`）

扩展独立配置文件（如 `proxy.json`）编辑器：有 `$schema` 时渲染结构化 `<SchemaForm>`，无 schema 时回退原始 JSON 文本框。

---

## 9. 面板注册表（`SettingsRegistry`）

```ts
// packages/react/src/config/settings-registry.ts
export interface SettingsPanelDescriptor extends ConfigDomainIO {
  id: string;
  title: string;
  order?: number;
  icon?: string;
  formSchema: FormSchema;
  validate?: Validator;
  // 分组 Tab（同 group 的多个面板合并为一个菜单项）
  group?: string;
  groupTitle?: string;
  groupOrder?: number;
  tabLabel?: string;
  tabOrder?: number;
}

export const defaultSettingsRegistry: SettingsRegistry;
export function createSettingsRegistry(): SettingsRegistry; // 工厂
```

**`SettingsShell`**（`packages/ui/src/config/settings-shell.tsx`）读 `listPanels()` 渲染左侧导航；同 `group` 的多个面板显示为一个菜单项 + Tab 切换（沙箱、扩展均以此方式呈现全局/项目两个作用域）。

---

## 10. 数据流完整链路

```
1. 应用启动 import "lib/settings/register-panels.ts"
   → registerConfigPanels() 幂等注册所有面板 + 自定义 widget

2. 用户打开 /settings
   → <SettingsShell> 调 listPanels() 渲染左侧导航

3. 选中面板
   → useConfigDomain(panel)
   → panel.load() → GET /api/config/:domain
   → server: config-codec 读 ~/.pi/agent/*.json → maskSecrets → 返回

4. 用户编辑
   → useSchemaForm 受控值 + 就地 zod 校验 → errors 就地展示

5. 点"保存"
   → submit() 校验通过 → panel.save(values)
   → PUT /api/config/:domain
   → server: zod 校验 → mergeSecrets(原始, 提交) → config-codec 写盘
```

---

## 11. 自定义 widget 接入示例

以接入一个「颜色选择器」为例，步骤如下：

**步骤 1**：实现字段控件组件（满足 `FieldProps` 契约）：

```tsx
// 自定义文件，如 lib/fields/color-picker-field.tsx
import type { FieldProps } from "@blksails/pi-web-ui";

// 注：内置控件复用的 `FieldShell` 是包内相对模块，未从 @blksails/pi-web-ui 导出；
// 包外自定义 widget 自行渲染 label / 错误即可。errors 以「点路径」为键，
// 用 path.join(".") 取本字段错误。
export function ColorPickerField({ descriptor, value, onChange, path, errors }: FieldProps) {
  const current = typeof value === "string" ? value : "#000000";
  const error = errors[path.join(".")];
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{descriptor.label}</span>
      <input
        type="color"
        value={current}
        onChange={(e) => onChange(e.target.value)}
      />
      {error !== undefined ? (
        <span role="alert" className="text-xs text-red-500">{error}</span>
      ) : null}
    </label>
  );
}
```

**步骤 2**：在配置域 schema 的对应字段声明 `widget` 名称：

```ts
// packages/protocol/src/config/domains/your-domain.ts
accentColor: z.string().optional().describe(
  JSON.stringify({
    label: "强调色",
    group: "appearance",
    widget: "colorPicker",   // 与注册键一致
  }),
),
```

**步骤 3**：在 `lib/settings/register-panels.ts`（或应用入口）注册 widget：

```ts
import { registerFieldRendererByKey } from "@blksails/pi-web-ui";
import { ColorPickerField } from "../fields/color-picker-field";

registerFieldRendererByKey("colorPicker", ColorPickerField);
```

**步骤 4**（可选，新增配置域时）：注册面板：

```ts
import { registerSettingsPanel, makeConfigDomainIO, zodValidator } from "@blksails/pi-web-react";
import { yourDomainFormSchema, yourDomainConfigSchema } from "@blksails/pi-web-protocol";

registerSettingsPanel({
  id: "your-domain",
  title: "你的配置域",
  order: 5,
  icon: "palette",
  formSchema: yourDomainFormSchema,
  validate: zodValidator(yourDomainConfigSchema),
  ...makeConfigDomainIO("your-domain"), // 对应 GET·PUT /api/config/your-domain
});
```

完成后 `<SettingsShell>` 无需任何改动，新面板自动出现在左侧导航。

> **预期结果**：打开 `/settings`，对应字段渲染为你的自定义控件。
>
> **常见报错**：
> - 字段仍渲染成默认文本框 → `widget` 名（schema 的 `.describe()`）与 `registerFieldRendererByKey` 的注册键不一致，或 `register-panels.ts` 未在应用启动时被 import（注册有副作用、需被加载一次）。
> - 字段完全不出现 → 该字段在 schema 里被 `.describe()` 写了非法 JSON，`parseDescribeMeta()` 降级时不会报错但 `widget`/`label` 丢失；检查 JSON 是否合法。
> - 更多排查见 [23 故障排查 / FAQ](./23-troubleshooting-faq.md)。

---

## 12. JSON Schema 来源（`json-schema-config-form`）

对于带 `$schema` 字段的扩展独立配置文件（如 `proxy.json`），`ConfigFilesField`（`packages/ui/src/config/fields/config-files-field.tsx`）在**客户端**完成结构化渲染：

1. 读取文件内容里的 `$schema`（仅接受 `https://` 前缀的 URL），在浏览器侧用 `globalThis.fetch` 拉取该 JSON Schema（按 URL 模块级缓存；测试经 `__setSchemaFetchImpl` 注入替身）。
2. 经 `jsonSchemaToFormSchema()`（`packages/protocol/src/config/json-schema-to-form-schema.ts`，前后端共享）转为 `FormSchema` IR，支持 object / string / number|integer / boolean / array（标量 → `stringList`、enum → `multiEnum`、对象/oneOf → `objectList`）/ oneOf-const 判别（`variants`）/ `#/$defs|definitions/<name>` 内部 `$ref`；不支持的构造降级为 `string`，不抛错。
3. 有 schema 时用 `<SchemaForm>` 渲染结构化表单；无 `$schema` 或拉取/解析失败则回退原始 JSON 文本编辑（解析失败就地报错、不回写），不致整体失败。

> **架构注**：schema 拉取走客户端是 `json-schema-config-form` spec 的明确交付决策（适配器在 `@blksails/pi-web-protocol` 前后端共享，浏览器直接 fetch 文件自带的 `$schema`），目的是避免服务端对任意 URL 的 SSRF 面、也避免把 schema 透传穿过 `useConfigDomain → SchemaForm` 管线。
>
> **规划中/未实现**：服务端拉取（`schema-fetch.ts` 的 `createSchemaFetcher({ allowHosts })` host 白名单 + GET 注入 `fileSchemas`）在 spec 中保留为可选注入接缝（task 5 标记 `[~]`，未接入主链路），当前无对应源文件，扩展配置响应也不返回 `fileSchemas`。

---

## 下一步 / 相关

- 配置文件与 env 变量详情（含 `PI_WEB_AGENT_DIR`）→ [06 配置参考](./06-configuration.md)
- Provider 与模型设置（`settings.json` 对应页）→ [07 Provider 与模型](./07-providers-and-models.md)
- 扩展配置域、沙箱注入 → [10 扩展与 Skills](./10-extensions-and-skills.md)
- HTTP API 端点完整列表（含 `GET·PUT /api/config/:domain`）→ [24 HTTP/SSE API 参考](./24-http-api-reference.md)
- widget 不显示 / 保存 422 / secret 被清空等问题 → [23 故障排查 / FAQ](./23-troubleshooting-faq.md)
