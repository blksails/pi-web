# Design — schema-config-ui(由 object schema 生成配置 UI)

## 1. 目标

以 **schema 为单一事实源**,自动生成可校验、可读写、可扩展的配置 UI;首批落地 `~/.pi/agent/auth.json` 与 `~/.pi/agent/settings.json`,并以同一内核覆盖后续配置域(AgentDefinition、扩展白名单、应用 env 等),不为每个域手写表单。

设计的核心思路:把现有「描述符 → UI」先例(`RpcExtensionUIRequest` 按 `method` 判别 → `PiPermissionDialog` 渲染 select/confirm/input/editor)**从"按 method 判别"推广为"按字段类型/描述符判别"**,并补上"持久化的多字段表单"这一层。

---

## 2. 配置域清单(盘点结论 · 按优先级)

| 优先级 | 配置域 | 载体 | 字段(示例) | 现状 UI | 备注 |
|---|---|---|---|---|---|
| **P0** | auth(凭证) | `~/.pi/agent/auth.json` | `{ [provider]: { apiKey, baseURL? } }` | ✗ | 全 secret;记录字典(动态键) |
| **P0** | settings(默认偏好) | `~/.pi/agent/settings.json` | `defaultProvider, defaultModel, defaultThinkingLevel, theme` | 部分(运行时显示) | 枚举/字符串为主 |
| P1 | 应用 env | `lib/app/config.ts` / `.env.local` | provider keys、默认 provider/model/source/cwd、stub 开关 | 部分(source 选择器) | 多为 secret + 字符串 |
| P1 | AgentDefinition | `index.ts`(agent-kit) | `model, thinkingLevel, tools[], excludeTools[], noTools, extensions[], allowExtensions[], scopedModels[]` | ✗ | 含数组/枚举/对象,最复杂 |
| P2 | 扩展白名单 | `source-allowlist.ts` | `npmScopes[], gitHosts[], allowLocal` | ✗ | 数组 + 布尔 |
| P2 | 信任策略 | `agent-source/types.ts` | `TrustDecision: "always"\|"never"\|"ask"` | 部分(弹窗) | 单枚举 |
| P3 | 会话创建请求 | `rest-dto.ts` | `source, cwd?, model?, env?` | 部分 | 已有专用 UI |

字段类型覆盖面(决定 IR 与控件需支持的最小集):**string / secret / number / boolean / enum(单选) / multi-enum(多选) / string[] / object(分组) / record(动态键值,auth 用)**。

> 结论:P0 两域用到 string/secret/enum/record,内核第一版即可覆盖;P1 的 AgentDefinition 引入 array/object/multi-enum,作为内核完备性的"压力测试"。

---

## 3. 架构总览

```
            ┌────────────────────── @pi-web/protocol(零运行时依赖,除 zod) ──────────────────────┐
            │  配置域 zod schema(authConfigSchema / settingsConfigSchema / ...)                  │
            │  + UI 元数据(经 .describe() 承载的 JSON,或并行 fieldMeta 注册)                      │
            │  表单 IR 类型:FormSchema / FieldDescriptor(与 zod 解耦的归一化描述)                 │
            │  adapter:zodToFormSchema(schema, meta) → FormSchema                                │
            └───────────────┬───────────────────────────────────────────────┬──────────────────┘
                            │ (类型 + IR + adapter,同构可在前后端跑)         │
        ┌───────────────────▼────────────────┐               ┌──────────────▼───────────────────┐
        │ @pi-web/react                       │               │ server / app(持久化)             │
        │  useSchemaForm(formSchema, initial) │               │  GET/PUT /api/config/:domain      │
        │   - 受控值 + 脏标记 + zod 校验       │               │  codec:读写 ~/.pi/agent/*.json    │
        │   - field error 映射                │               │  secret 掩码/合并(不回传明文)      │
        └───────────────────┬────────────────┘               └───────────────────────────────────┘
        ┌───────────────────▼────────────────────────────────────────────────────────────────────┐
        │ @pi-web/ui                                                                               │
        │  <SchemaForm formSchema values onChange errors/>                                          │
        │   └─ <FieldRenderer descriptor/>  ──按 descriptor.kind 分派──►  字段控件                  │
        │        (复用 shadcn 基元 input/select/checkbox/textarea + 既有 dialog 内的渲染逻辑)        │
        │  fieldRendererRegistry(注册/解析/默认回退/按 kind 或 fieldKey 覆盖)— 复刻 renderer-registry │
        └──────────────────────────────────────────────────────────────────────────────────────────┘
```

依赖方向严格单向:**protocol → react → ui → app**,与现有包结构一致。

---

## 4. 表单 IR:`FormSchema` / `FieldDescriptor`

不让渲染器直接吃 zod 内部结构(zod 3 无 `z.toJSONSchema()`,内部 `_def` 不稳定),而是定义一个**归一化中间表示**。它也可由 JSON Schema 或手写产生,从而解耦 zod 版本与来源。

```ts
// @pi-web/protocol/src/config/form-schema.ts(类型;运行期可选 zod 校验)
export type FieldKind =
  | "string" | "secret" | "number" | "boolean"
  | "enum"   | "multiEnum" | "stringList"
  | "object" | "record";

export interface FieldDescriptor {
  key: string;                 // 字段键(record 子项为动态键)
  kind: FieldKind;
  label: string;               // 来自 meta.label 或 key 美化
  description?: string;        // 帮助文本(来自 .describe())
  placeholder?: string;
  required: boolean;
  default?: unknown;
  group?: string;              // 分组/分区
  order?: number;              // 同组内顺序
  // 约束(供控件与校验展示)
  enumOptions?: { value: string; label?: string }[]; // enum / multiEnum
  min?: number; max?: number; step?: number;          // number
  // 嵌套
  fields?: FieldDescriptor[];  // object 的子字段
  itemKind?: FieldKind;        // stringList / record 值的元素类型
  // 渲染覆盖
  widget?: string;             // 指定自定义渲染器(覆盖默认 kind→控件)
  secret?: boolean;            // 与 kind:"secret" 等价的快捷标记
  readOnly?: boolean;
}

export interface FormSchema {
  domain: string;              // "auth" | "settings" | ...
  title?: string;
  fields: FieldDescriptor[];
  groups?: { id: string; title: string; order?: number }[];
}
```

`FieldDescriptor` 是渲染契约的"窄腰":渲染器只认它,任何来源(zod、JSON Schema、手写)只要产出它即可被渲染。

---

## 5. Schema 元数据策略(zod 3 现实约束)

**约束**:项目用 **zod 3.25.76**,无 `.meta()`,无原生 `z.toJSONSchema()`;protocol 包刻意"零运行时依赖,除 zod"。

采用 **方案 A(推荐):`.describe()` 承载结构化 UI 元数据 + 轻量 adapter**:

- 用 zod 的 `.describe()` 写入一段 **JSON 编码的元数据**(label/placeholder/group/order/widget/secret/enumLabels),adapter 解析它;无元数据时回退到由 key/类型推断的默认。
  ```ts
  const settingsConfigSchema = z.object({
    defaultProvider: z.string().optional()
      .describe(JSON.stringify({ label: "默认 Provider", group: "模型", order: 1 })),
    defaultThinkingLevel: ThinkingLevelSchema.optional()
      .describe(JSON.stringify({ label: "思考等级", group: "模型", order: 3 })),
    theme: z.enum(["light","dark","system"]).default("system")
      .describe(JSON.stringify({ label: "主题", group: "外观" })),
  });
  ```
- adapter `zodToFormSchema()` 遍历 `schema.shape`,据每个字段的 zod 类型推 `kind`(`ZodString→string`、`ZodEnum→enum`、`ZodBoolean→boolean`、`ZodArray<ZodString>→stringList`、`ZodObject→object`、`ZodRecord→record`、`ZodNumber→number`),据 `isOptional()`/`default` 推 `required`/`default`,据解析后的 `.description` 合并 UI 元数据。
- secret 识别:元数据 `secret:true`,或按命名约定(key 含 `apiKey`/`token`/`secret`)兜底。

**备选**:
- 方案 B:**并行 `fieldMeta` 注册表**(`Record<fieldKey, UIMeta>`)与 schema 并列维护——更显式但易与 schema 脱节。
- 方案 C:**升级 zod 4** 用 `.meta()` + `z.toJSONSchema()`——最干净,但触动 protocol 的依赖底线与全仓 zod 版本,影响面大,列为后续独立评估项。

> 取舍:A 在不动依赖底线的前提下让"schema 即 UI 源"成立,且 adapter 可在 zod 4 落地后改为读 `.meta()` 而 IR/渲染层不变。**推荐 A,把 C 作为将来优化。**

---

## 6. 字段类型 → 控件映射(默认渲染)

| FieldKind | 默认控件 | 复用 | 说明 |
|---|---|---|---|
| string | `<Input type=text>` | shadcn input(`pi-permission-dialog` input 分支已有范例) | 单行 |
| secret | `<Input type=password>` + 掩码态 | 新增 secret 控件 | 见 §9 安全 |
| number | `<Input type=number min/max/step>` | shadcn input | |
| boolean | `<Switch>` / `<Checkbox>` | 新增/shadcn | |
| enum | `<Select>` | 既有 `ui/select.tsx` + `PiModelSelector`/`PiThinkingLevel` 范例 | 单选 |
| multiEnum | 复选组 / 多选 | 复用 select 分支(`PiPermissionDialog` select 已有 radio 组范例) | |
| stringList | 可增删的 chip/行列表 | 新增(参考 `Attachments` chip 模式) | npmScopes/gitHosts/tools |
| object | `<fieldset>` 分组 + 递归 `<FieldRenderer>` | 递归 | 嵌套对象 |
| record | 动态键值行(增删键) + 子控件 | 新增 | auth.json 的 `{provider: {...}}` |

控件选择优先级:`descriptor.widget`(注册表覆盖) > `descriptor.kind` 默认。

---

## 7. 渲染层组件(@pi-web/ui)

```
src/config/
  schema-form.tsx        // <SchemaForm>:遍历 fields → 分组 → <FieldRenderer>
  field-renderer.tsx     // 按 kind/widget 分派(同 PartRenderer 的分派语义)
  fields/
    string-field.tsx  secret-field.tsx  number-field.tsx
    boolean-field.tsx enum-field.tsx     multi-enum-field.tsx
    string-list-field.tsx  object-field.tsx  record-field.tsx
  field-registry.ts      // 复刻 renderer-registry:register/resolve/默认回退/覆盖 + 模块单例 + 工厂
```

- `<SchemaForm>` 为**受控**组件:`values` / `onChange(path, value)` / `errors` 由调用方(经 `useSchemaForm`)提供——与 `PiChat` 受控装配风格一致,便于测试与复用。
- `<FieldRenderer>` 分派逻辑与现有 `PartRenderer`(按 part 类型)、`PiPermissionDialog`(按 method)同构:先查注册表覆盖,再回退默认 kind 控件。
- `fieldRendererRegistry`:`registerFieldRenderer(kindOrKey, Component)` / `resolveFieldRenderer(descriptor)`;模块级单例供宿主在挂载前注册,`createFieldRegistry()` 工厂供测试隔离——与 `renderer-registry.ts` 完全一致的语义。

字段组件契约(统一 props,便于注册表与测试):
```ts
export interface FieldProps<V = unknown> {
  descriptor: FieldDescriptor;
  value: V;
  onChange: (next: V) => void;
  error?: string;
  disabled?: boolean;
}
```

---

## 8. 状态与校验 hook(@pi-web/react)

```ts
useSchemaForm(formSchema, { initialValues, validate }) → {
  values, setValue(path, v), errors, dirty, isValid,
  reset(), submit(): { ok: true, values } | { ok: false, errors }
}
```

- 内部用 `useState`(或 `useReducer`)持有受控值;`setValue` 支持点路径(object/record 嵌套)。
- 校验:提交时用**该域的 zod schema**做整体 `safeParse`,把 `ZodError.issues` 按 `path` 映射到 `errors[fieldKey]`(error 文案沿用项目错误呈现风格,见 `chat-error`/`pi-permission-dialog` 的错误展示)。
- 与既有 `ControlStore`/`useExtensionUI` 解耦:配置表单是**持久化表单**,不走 SSE 控制通道的 FIFO/respond,而是经 REST 一次性提交(见 §9)。复用的是它们的"受控 + 错误就地呈现"模式,而非其传输。

---

## 9. 持久化与安全(server / app)

### 9.1 端点
```
GET  /api/config/:domain          → { formSchema, values }   // values 中 secret 字段为掩码占位
PUT  /api/config/:domain          ← { values }               // 服务端 zod 校验 + 写回
```
- 由 server 侧的 **config codec** 读写 `~/.pi/agent/auth.json` / `settings.json`:`load(domain)`、`save(domain, values)`。
- 路径基于 `PI_WEB_AGENT_DIR`(默认 `~/.pi/agent`,见 `lib/app/config.ts`),app 经 catch-all 路由委托(与现有 `/api/sessions` 装配一致)。
- 未知字段:读时保留(merge 回写时不丢失),只覆盖 schema 已知字段——满足 R3。

### 9.2 secret 处理(R4,关键)
- **读(GET)**:auth.json 的 token/apiKey **绝不回传明文**;返回掩码占位(如 `"set"` 布尔或 `"••••1234"` 末位提示)+ `secret:true` 字段标记。前端据此显示"已设置(可覆盖/清除)"。
- **写(PUT)**:secret 字段语义为**仅写**:
  - 提交空 → 保持原值不变(前端发哨兵/不发该键);
  - 提交新值 → 覆盖;
  - 显式"清除" → 删除该键。
- 服务端校验错误消息**不含**密钥明文(沿用 `config.ts` 既有"敏感值不进日志/序列化"不变量);掩码/合并逻辑只在 server 侧。
- auth.json 写入设 `0600` 权限,目录 `0700`(若可行)。

---

## 10. 与现有先例的映射(复用,而非另起炉灶)

| 现有 | 本设计对应 | 复用点 |
|---|---|---|
| `RpcExtensionUIRequest`(按 method 判别联合) | `FieldDescriptor`(按 kind 判别) | 判别式描述符 → 控件 的范式 |
| `PiPermissionDialog`(select/confirm/input/editor 渲染 + 错误就地) | `fields/*` + `<FieldRenderer>` | input/select/textarea 控件实现与错误呈现 |
| `renderer-registry.ts`(register/resolve/默认/覆盖 + 单例 + 工厂) | `field-registry.ts` | 扩展点机制 1:1 复刻 |
| `PartRenderer`(按 part 类型分派) | `<FieldRenderer>`(按 kind 分派) | 分派与默认回退 |
| `PiModelSelector`/`PiThinkingLevel`(受控 + Select) | enum 字段 | Select 控件与受控风格 |
| protocol 既有 zod schema(`ThinkingLevelSchema` 等) | 配置域 schema 直接引用 | 枚举/类型不重复定义 |

---

## 11. 文件结构与边界(File Structure Plan)

```
@pi-web/protocol  src/config/
  form-schema.ts            // FieldDescriptor / FormSchema 类型(+ 可选 zod 校验)
  meta.ts                   // UIMeta 类型 + parseDescribeMeta()
  zod-to-form-schema.ts     // adapter:zod → FormSchema
  domains/
    auth.ts                 // authConfigSchema + meta
    settings.ts             // settingsConfigSchema + meta
  index.ts                  // 聚合导出(config 子面)

@pi-web/react     src/config/
  use-schema-form.ts        // 受控值 + zod 校验 + error 映射
  use-config-domain.ts      // 加载/保存某域(调 REST 端点)

@pi-web/ui        src/config/
  schema-form.tsx  field-renderer.tsx  field-registry.ts  fields/*

server            src/config/
  config-codec.ts           // 读写 ~/.pi/agent/*.json + 未知字段保留
  config-routes.ts          // GET/PUT /config/:domain(经 http-api routes? 注入)
  secret-merge.ts           // secret 掩码/仅写合并

app
  app/api/config/[[...path]]/route.ts   // 委托(或并入既有 sessions 装配)
  app/(settings)/...                    // 设置页装配 <SchemaForm>
```

---

## 12. 分阶段落地路线

1. **内核 + P0**:protocol 的 IR/adapter/auth+settings schema → ui 的 `<SchemaForm>` + string/secret/enum/record 字段 + registry → react 的 `useSchemaForm` → server codec + 端点 → app 设置页。交付:能编辑 settings.json 与 auth.json(secret 安全)。
2. **完备字段**:number/boolean/multiEnum/stringList/object → 覆盖扩展白名单(P2)与 AgentDefinition(P1,压力测试嵌套/数组)。
3. **扩展点开放**:`fieldRendererRegistry` 对外文档化,允许宿主注册自定义控件(如 model 选择器复用 `PiModelSelector`)。
4. **验证**:每域 schema 正反例单测;adapter 单测(各 zod 类型→kind);`<SchemaForm>` 组件测试(渲染/校验/错误/secret 掩码);settings/auth 读写集成测试(含 secret 仅写语义 + 未知字段保留)。

---

## 13. 决策记录(P0 已定稿)

> 原开放问题在"按 Kiro 流程完成 P0"指令下,按以下决策定稿(非阻塞):

1. **元数据策略 → 方案 A**:`.describe()` 承载 JSON 元数据 + adapter 解析。不动 protocol 的 zod 依赖底线;IR 与渲染层对 zod 版本无感,将来升级 zod 4 仅改 adapter 读 `.meta()`。
2. **auth.json 结构 → 务实 schema(`record(provider → {apiKey, baseURL?})`)**:依据 `lib/app/config.ts` 已知的 provider key 命名(anthropic/openai/google/gemini/mistral/openrouter)定 `KNOWN_PROVIDERS`,值对象含 `apiKey`(secret,必填)+ `baseURL`(可选)。passthrough 保留未知 provider 与未知子字段(R3)。SDK 真实形状若有差异,因 codec 采"合并保留未知字段"语义而不致丢数据,后续可微调 schema。
3. **安全边界 → 加 adminPolicy 接缝,默认放行**:复用 `extension-management` 的 `adminPolicy(auth)=>boolean` 接缝模式;P0 默认实现放行(本地单用户场景),但接缝就位,部署方可注入收紧。secret 仅写 + 掩码 + 不回传明文 + 文件 `0600`。
4. **设置页入口 → 独立 `/settings` 路由 + chat 头部入口**:`app/settings/page.tsx` 装配 `<SettingsShell>`;`chat-app` 头部加"设置"按钮跳转。独立路由便于直链与扩展面板。
5. **范围 → 仅 P0(auth/settings)端到端交付**;内核字段类型实现到 P0 所需(string/secret/enum/record),其余 kind(number/boolean/multiEnum/stringList/object)留接缝与 TODO,P1/P2 后续。

## 14. 前端设置系统与注册机制(本目标核心)

P0 不仅渲染表单,还要让配置域**可注册**进一个可扩展的设置系统(当前前端尚无设置系统)。机制与 `renderer-registry`/`field-registry` 同构。

### 14.1 设置面板描述符与注册表

```ts
// @pi-web/react  src/config/settings-registry.ts
export interface SettingsPanelDescriptor {
  id: string;                 // "auth" | "settings" | ...(域 id)
  title: string;              // 导航显示名
  order?: number;             // 导航排序
  icon?: string;              // 可选图标名(lucide)
  formSchema: FormSchema;     // 该面板的表单 IR(由 protocol adapter 产出)
  // 数据源:与持久化端点解耦,便于测试注入 mock
  load: () => Promise<Record<string, unknown>>;          // 取当前值(secret 已掩码)
  save: (values: Record<string, unknown>) => Promise<void>;
}

export interface SettingsRegistry {
  registerPanel(panel: SettingsPanelDescriptor): void;
  resolvePanel(id: string): SettingsPanelDescriptor | undefined;
  listPanels(): SettingsPanelDescriptor[];      // 按 order 排序
}
export const defaultSettingsRegistry: SettingsRegistry;   // 模块级单例
export function createSettingsRegistry(): SettingsRegistry; // 工厂(测试隔离)
```

- 与 `renderer-registry` 完全一致的语义:**模块级单例**供宿主在挂载前注册、**工厂**供测试隔离、**注册/解析/列举**。
- 扩展性:第三方/宿主可 `registerPanel()` 增配置域(如 AgentDefinition、白名单),设置外壳零改动即纳入。

### 14.2 域注册装配

```ts
// app  lib/settings/register-panels.ts(应用启动期 import 一次)
import { defaultSettingsRegistry } from "@pi-web/react";
import { authFormSchema, settingsFormSchema } from "@pi-web/protocol/config";
import { makeConfigDomainIO } from "@pi-web/react"; // 基于 /api/config/:domain

defaultSettingsRegistry.registerPanel({
  id: "auth", title: "凭证", order: 1, icon: "key-round",
  formSchema: authFormSchema,
  ...makeConfigDomainIO("auth"),       // load/save → REST
});
defaultSettingsRegistry.registerPanel({
  id: "settings", title: "通用", order: 2, icon: "settings",
  formSchema: settingsFormSchema,
  ...makeConfigDomainIO("settings"),
});
```

### 14.3 设置外壳

```
@pi-web/ui  src/config/settings-shell.tsx
  <SettingsShell registry?={SettingsRegistry}>
    左侧:listPanels() → 导航项(title/icon,按 order)
    右侧:当前面板 → useConfigDomain(panel) 驱动的 <SchemaForm>
            ├─ 加载态/错误态/保存态(复用 chat-error 风格)
            └─ 保存按钮:校验通过 → panel.save(values) → toast/状态反馈
  </SettingsShell>
```

- `useConfigDomain(panel)`(react):封装 `panel.load()` 初始化 + `useSchemaForm(panel.formSchema)` 受控校验 + `panel.save()` 提交,统一 loading/error/dirty/saved 状态机。
- app 装配:`app/settings/page.tsx` 先 `import "@/lib/settings/register-panels"` 完成注册,再渲染 `<SettingsShell/>`;`chat-app` 头部"设置"按钮 `Link` 到 `/settings`。

### 14.4 注册机制数据流

```
启动 import register-panels.ts → defaultSettingsRegistry 内有 auth/settings 面板
  → /settings 页 <SettingsShell> listPanels() 渲染导航
  → 选中面板 → useConfigDomain → GET /api/config/:id 填值(secret 掩码)
  → 用户改 → useSchemaForm 受控 + zod 就地校验
  → 保存 → PUT /api/config/:id → server codec 合并写回(secret 仅写)
```

> 这样"在前端设置系统中注册"成为一行 `registerPanel(...)`:新增配置域 = 写一个 zod schema(protocol)+ 注册一个面板(app),设置外壳与渲染内核均无需改动。

---

## 14. 小结

- **单一事实源**:配置域 zod schema(+ 轻量 UI 元数据)→ adapter → 归一化 `FieldDescriptor` IR → 注册表驱动的 `<SchemaForm>` 渲染 → `useSchemaForm` 受控校验 → REST 持久化到 `~/.pi/agent/*.json`。
- **不另起炉灶**:判别式描述符→控件、渲染器注册表、受控装配、错误就地呈现,全部复用并推广现有 `extension-ui` + `PiPermissionDialog` + `renderer-registry` 先例。
- **务实约束**:zod 3 现实下用 `.describe()` 承载元数据,IR 与渲染层对 zod 版本无感,为将来升级 zod 4 预留无痛迁移。
- **安全优先**:auth secret 仅写、掩码、不回传明文、不进日志。
