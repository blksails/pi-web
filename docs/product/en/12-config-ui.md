# 12 · Schema-Driven Config UI

The config UI uses **schema as the single source of truth** to automatically generate a settings interface that is validatable, readable/writable, and extensible. Instead of hand-writing a form for each config domain, it uses a unified form IR (`FormSchema`) to derive a control tree from a zod schema / JSON Schema, then renders it through a pluggable renderer registry.

---

## 1. Division of Labor Across Three Specs

| Spec | Path | Core Responsibility |
|---|---|---|
| `schema-config-ui` | `.kiro/specs/schema-config-ui/` | Foundation: the `FormSchema` IR, the `zodToFormSchema` adapter, the `SchemaForm` rendering layer, `SettingsShell` + panel registry, the `GET·PUT /api/config/:domain` endpoints, and credential secret safety |
| `config-ui-sandbox-extensions` | `.kiro/specs/config-ui-sandbox-extensions/` | Sandbox config domains (global + project), extension config domains (Slash command availability + per-extension KV), grouped Tab layout, sandbox enforced injection |
| `json-schema-config-form` | `.kiro/specs/json-schema-config-form/` | JSON Schema → IR adapter, remote `$schema` fetch and caching, `objectList` / `oneOf` polymorphic controls, enabling structured editing of standalone extension config files (e.g. `proxy.json`) |

All three specs share the same IR and rendering layer; they only extend config domains or controls.

---

## 2. Core Architecture

```
@blksails/pi-web-protocol(zero runtime deps, except zod)
  form-schema.ts        → FieldDescriptor / FormSchema types
  meta.ts               → UIMeta + parseDescribeMeta()
  zod-to-form-schema.ts → zodToFormSchema(domain, zodSchema) → FormSchema
  json-schema-to-form-schema.ts → jsonSchemaToFormSchema(jsonSchema) → FormSchema
  config/domains/
    auth.ts      settings.ts     sandbox.ts     extensions.ts
           ↓
@blksails/pi-web-react
  use-schema-form.ts    → useSchemaForm(formSchema, { validate }) — controlled values + zod validation
  use-config-domain.ts  → useConfigDomain(panel)  — load/save + state machine
  settings-registry.ts  → defaultSettingsRegistry  — panel registry (singleton + factory)
  makeConfigDomainIO()  → load/save built on /api/config/:domain
           ↓
@blksails/pi-web-ui
  config/schema-form.tsx    → <SchemaForm>
  config/field-renderer.tsx → <FieldRenderer>  — dispatches by widget/kind
  config/field-registry.ts  → defaultFieldRegistry  — renderer registry
  config/fields/
    string-field.tsx  secret-field.tsx  enum-field.tsx  record-field.tsx
    boolean-field.tsx  string-list-field.tsx  object-field.tsx
    object-list-field.tsx  extensions-kv-field.tsx  model-select-field.tsx
           ↓
server
  config/config-codec.ts         → reads/writes ~/.pi/agent/*.json + preserves unknown fields
  config/config-routes.ts        → GET·PUT /config/:domain
  config/secret-merge.ts         → maskSecrets / mergeSecrets
  config/sandbox-project-routes.ts  → /config/sandbox/project
  config/extensions-config-routes.ts → /config/extensions[/project]
           ↓
app
  lib/settings/register-panels.ts   → idempotently registers all panels (auth/settings/sandbox/extensions)
  app/settings/page.tsx             → <SettingsShell> mount point
```

The dependency direction is strictly one-way: `protocol → react → ui → server/app`.

---

## 3. The Form IR: `FormSchema` / `FieldDescriptor`

The rendering layer never consumes zod structures or JSON Schema directly; every source is first converted by an adapter into a **normalized intermediate representation**.

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
  fields?: readonly FieldDescriptor[];   // object child fields / record value template
  itemFields?: readonly FieldDescriptor[]; // objectList item fields
  variants?: FieldVariants;              // oneOf polymorphic discriminator
  itemKind?: FieldKind;                  // stringList / record scalar element type
  widget?: string;                       // custom renderer key
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

`FieldDescriptor` is the "narrow waist" of the rendering contract: renderers only recognize it, so any source (zod / JSON Schema / hand-written) can be rendered as long as it produces a `FormSchema`.

---

## 4. The zod → IR Adapter (`zodToFormSchema`)

```ts
// packages/protocol/src/config/zod-to-form-schema.ts
export function zodToFormSchema(
  domain: string,
  schema: z.ZodTypeAny,
  opts?: { title?: string; groups?: readonly FieldGroup[] },
): FormSchema
```

The adapter has two key mechanisms:

**Type inference** (`packages/protocol/src/config/zod-to-form-schema.ts:75`):

| zod type | inferred `kind` |
|---|---|
| `ZodString` (plain) | `string` |
| `ZodString` (key contains `apiKey`/`token`/`secret`, or meta.secret=true) | `secret` |
| `ZodNumber` | `number` |
| `ZodBoolean` | `boolean` |
| `ZodEnum` / `ZodNativeEnum` | `enum` |
| `ZodArray<ZodEnum>` | `multiEnum` |
| `ZodArray<other>` | `stringList` |
| `ZodObject` | `object` |
| `ZodRecord` | `record` |

**UI metadata strategy** (`packages/protocol/src/config/meta.ts`):

The project uses zod 3.x, which has no `.meta()`, so by convention UI hints are written into `.describe()` as a **JSON string**:

```ts
// packages/protocol/src/config/domains/settings.ts
defaultProvider: z.string().optional().describe(
  JSON.stringify({
    label: "Default Provider",
    group: "model",
    order: 1,
    placeholder: "e.g. anthropic / openrouter",
    widget: "providerSelect",   // specifies the custom renderer
  }),
),
```

`parseDescribeMeta()` parses the string above; non-JSON content degrades to `{ description: text }`; when absent it safely returns empty metadata.

---

## 5. Built-in Config Domains

| Domain id | File | Schema | Endpoint |
|---|---|---|---|
| `auth` | `~/.pi/agent/auth.json` | `authConfigSchema` (`record(provider → {apiKey, baseURL?})`) | `GET·PUT /api/config/auth` |
| `settings` | `~/.pi/agent/settings.json` | `settingsConfigSchema` (defaultProvider/Model/ThinkingLevel/theme) | `GET·PUT /api/config/settings` |
| `sandbox` | `~/.pi/agent/sandbox.json` | `sandboxConfigSchema` (enabled/network/filesystem) | `GET·PUT /api/config/sandbox` |
| `sandbox-project` | `<cwd>/.pi/sandbox.json` | same as above, project overrides global | `GET·PUT /api/config/sandbox/project` |
| `extensions` (global) | commands + per-extension KV in `~/.pi/agent/settings.json` | `extensionsConfigSchema` | `GET·PUT /api/config/extensions/global` |
| `extensions-project` | `<cwd>/.pi/settings.json` | same as above | `GET·PUT /api/config/extensions/project` |

> `extensions` and `sandbox/project` have custom cross-mapping logic; they do not go through the generic `CONFIG_FORM_SCHEMAS` registry, but are instead handled by dedicated routes (`extensions-config-routes.ts` / `sandbox-project-routes.ts`).
>
> The global config directory defaults to `~/.pi/agent`, overridable via the environment variable `PI_WEB_AGENT_DIR` (see `config-codec.ts:16`). The `~/.pi/agent/*.json` entries in this table all refer to that default directory.

### API Response Format

```
GET /api/config/:domain
→ { formSchema: FormSchema, values: Record<string, unknown> }   # secret fields in values are already masked

PUT /api/config/:domain
← { values: Record<string, unknown> }
→ 200 | 422 (validation failure) | 403 (auth) | 404 (unknown domain)
```

**Secret safety**: On GET, the auth apiKey is **never returned in plaintext**; a masked placeholder is returned instead. On PUT, an empty value keeps the original value unchanged, submitting a new value overwrites it, and an explicit "clear" deletes that key. The file is written with `0600` permissions.

---

## 6. Rendering-Layer Components (`@blksails/pi-web-ui`)

### `<SchemaForm>` (`packages/ui/src/config/schema-form.tsx`)

A controlled component: `values` (the whole-domain object) / `onChange(next)` (returns the complete next object) / `errors` (dot path → error message) are provided by the caller (via `useSchemaForm`). It iterates over `fields`, partitions them by `group`, and calls `<FieldRenderer>`.

### `<FieldRenderer>` (`packages/ui/src/config/field-renderer.tsx`)

Dispatch priority: **registry fieldKey override → widget key → kind built-in control → FallbackField (read-only JSON text)**.

```ts
// Built-in default control mapping
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

Container fields (`record` / `object` / `objectList`) pass the current registry through to nested rendering, so host overrides also take effect at the nested level.

### Unified Field-Control Props (`packages/ui/src/config/field-registry.ts`)

```ts
export interface FieldProps<V = unknown> {
  descriptor: FieldDescriptor;
  value: V;
  onChange: (next: V) => void;
  path: readonly string[];    // dot path from the root (used for errors indexing)
  errors: Readonly<Record<string, string>>;
  disabled?: boolean;
  registry?: FieldRegistry;   // passed through by container fields
}
```

---

## 7. Field Renderer Registry (`FieldRegistry`)

```ts
// packages/ui/src/config/field-registry.ts
export const defaultFieldRegistry: FieldRegistry;    // module-level singleton
export function createFieldRegistry(): FieldRegistry; // factory (test isolation)

export function registerFieldRendererByKey(widget: string, component): void;
export function registerFieldRendererByKind(kind: FieldKind, component): void;
```

`resolve(descriptor)` dispatch priority: `byKey[descriptor.key]` → `byKey[descriptor.widget]` → `byKind[descriptor.kind]` → `undefined` (`FieldRenderer` falls back to the built-in).

---

## 8. Custom Widgets Already Shipped

### `providerSelect` / `modelSelect` (`packages/ui/src/config/fields/model-select-field.tsx`)

A searchable dropdown (Popover + Command/cmdk) whose options come from **`GET /api/config/models`** (requires injecting the `listModelOptions` seam at `createConfigRoutes` time). Registered in `lib/settings/register-panels.ts`:

```ts
registerFieldRendererByKey("providerSelect", ModelSelectField);
registerFieldRendererByKey("modelSelect", ModelSelectField);
```

The `defaultProvider` / `defaultModel` fields of `settings.json` declare the use of this widget in the schema via `.describe(JSON.stringify({ widget: "providerSelect" / "modelSelect" }))`.

### `extensionsKv` (`packages/ui/src/config/fields/extensions-kv-field.tsx`)

Two-level dynamic add/remove: the outer level is "extension entries" (key = extId), the inner level is "key-value pairs", used for per-extension KV parameter configuration.

### `configFiles` (`packages/ui/src/config/fields/config-files-field.tsx`)

An editor for standalone extension config files (e.g. `proxy.json`): when a `$schema` is present it renders a structured `<SchemaForm>`, and when no schema is present it falls back to a raw JSON text box.

---

## 9. Panel Registry (`SettingsRegistry`)

```ts
// packages/react/src/config/settings-registry.ts
export interface SettingsPanelDescriptor extends ConfigDomainIO {
  id: string;
  title: string;
  order?: number;
  icon?: string;
  formSchema: FormSchema;
  validate?: Validator;
  // Grouped Tabs (multiple panels in the same group merge into one menu item)
  group?: string;
  groupTitle?: string;
  groupOrder?: number;
  tabLabel?: string;
  tabOrder?: number;
}

export const defaultSettingsRegistry: SettingsRegistry;
export function createSettingsRegistry(): SettingsRegistry; // factory
```

**`SettingsShell`** (`packages/ui/src/config/settings-shell.tsx`) reads `listPanels()` to render the left navigation; multiple panels in the same `group` are shown as one menu item + Tab switching (both sandbox and extensions present their global/project scopes this way).

---

## 10. Full Data-Flow Path

```
1. App startup imports "lib/settings/register-panels.ts"
   → registerConfigPanels() idempotently registers all panels + custom widgets

2. User opens /settings
   → <SettingsShell> calls listPanels() to render the left navigation

3. Select a panel
   → useConfigDomain(panel)
   → panel.load() → GET /api/config/:domain
   → server: config-codec reads ~/.pi/agent/*.json → maskSecrets → returns

4. User edits
   → useSchemaForm controlled values + in-place zod validation → errors shown in place

5. Click "Save"
   → submit() validation passes → panel.save(values)
   → PUT /api/config/:domain
   → server: zod validation → mergeSecrets(original, submitted) → config-codec writes to disk
```

---

## 11. Custom Widget Integration Example

Taking the integration of a "color picker" as an example, the steps are as follows:

**Step 1**: Implement the field-control component (satisfying the `FieldProps` contract):

```tsx
// custom file, e.g. lib/fields/color-picker-field.tsx
import type { FieldProps } from "@blksails/pi-web-ui";

// Note: the `FieldShell` reused by built-in controls is an internal relative module,
// not exported from @blksails/pi-web-ui; custom widgets outside the package should
// render label / errors themselves. errors is keyed by "dot path", so use
// path.join(".") to get this field's error.
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

**Step 2**: Declare the `widget` name on the corresponding field in the config-domain schema:

```ts
// packages/protocol/src/config/domains/your-domain.ts
accentColor: z.string().optional().describe(
  JSON.stringify({
    label: "Accent Color",
    group: "appearance",
    widget: "colorPicker",   // matches the registration key
  }),
),
```

**Step 3**: Register the widget in `lib/settings/register-panels.ts` (or the app entry point):

```ts
import { registerFieldRendererByKey } from "@blksails/pi-web-ui";
import { ColorPickerField } from "../fields/color-picker-field";

registerFieldRendererByKey("colorPicker", ColorPickerField);
```

**Step 4** (optional, when adding a new config domain): Register the panel:

```ts
import { registerSettingsPanel, makeConfigDomainIO, zodValidator } from "@blksails/pi-web-react";
import { yourDomainFormSchema, yourDomainConfigSchema } from "@blksails/pi-web-protocol";

registerSettingsPanel({
  id: "your-domain",
  title: "Your Config Domain",
  order: 5,
  icon: "palette",
  formSchema: yourDomainFormSchema,
  validate: zodValidator(yourDomainConfigSchema),
  ...makeConfigDomainIO("your-domain"), // corresponds to GET·PUT /api/config/your-domain
});
```

Once done, `<SettingsShell>` requires no changes at all — the new panel automatically appears in the left navigation.

> **Expected result**: Open `/settings` and the corresponding field renders as your custom control.
>
> **Common errors**:
> - The field still renders as a default text box → the `widget` name (in the schema's `.describe()`) does not match the registration key of `registerFieldRendererByKey`, or `register-panels.ts` was not imported at app startup (registration has side effects and must be loaded once).
> - The field does not appear at all → that field's `.describe()` in the schema contains invalid JSON; when `parseDescribeMeta()` degrades it does not throw, but `widget`/`label` are lost; check whether the JSON is valid.
> - For more troubleshooting, see [18 Troubleshooting / FAQ](./18-troubleshooting-faq.md).

---

## 12. JSON Schema Source (`json-schema-config-form`)

For standalone extension config files that carry a `$schema` field (e.g. `proxy.json`), `ConfigFilesField` (`packages/ui/src/config/fields/config-files-field.tsx`) performs structured rendering **on the client**:

1. Reads the `$schema` from the file content (only accepting URLs with the `https://` prefix), and uses `globalThis.fetch` on the browser side to fetch that JSON Schema (cached at the module level by URL; tests inject a stand-in via `__setSchemaFetchImpl`).
2. Converts it via `jsonSchemaToFormSchema()` (`packages/protocol/src/config/json-schema-to-form-schema.ts`, shared front and back end) into the `FormSchema` IR, supporting object / string / number|integer / boolean / array (scalar → `stringList`, enum → `multiEnum`, object/oneOf → `objectList`) / oneOf-const discriminators (`variants`) / internal `$ref` of the form `#/$defs|definitions/<name>`; unsupported constructs degrade to `string` without throwing.
3. When a schema is present it renders the structured form with `<SchemaForm>`; when there is no `$schema`, or fetch/parse fails, it falls back to raw JSON text editing (parse failures are reported in place and not written back), avoiding an overall failure.

> **Architecture note**: Routing the schema fetch through the client is an explicit delivery decision of the `json-schema-config-form` spec (the adapter is shared front and back end in `@blksails/pi-web-protocol`, and the browser directly fetches the `$schema` the file ships with). The goal is to avoid an SSRF surface on the server for arbitrary URLs, and to avoid threading the schema through the `useConfigDomain → SchemaForm` pipeline.
>
> **Planned / not yet implemented**: A server-side fetch (`createSchemaFetcher({ allowHosts })` host allowlist in `schema-fetch.ts` + GET injecting `fileSchemas`) is kept in the spec as an optional injection seam (task 5 marked `[~]`, not wired into the main path); there is currently no corresponding source file, and the extension config response does not return `fileSchemas` either.

---

## Next Steps / Related

- Config file and env variable details (including `PI_WEB_AGENT_DIR`) → [05 Configuration Reference](./05-configuration.md)
- Provider and model settings (the page for `settings.json`) → [06 Providers and Models](./06-providers-and-models.md)
- Extension config domains, sandbox injection → [09 Extensions and Skills](./09-extensions-and-skills.md)
- Complete list of HTTP API endpoints (including `GET·PUT /api/config/:domain`) → [13 HTTP/SSE API Reference](./13-http-api-reference.md)
- Issues like widget not showing / save returning 422 / secret being cleared → [18 Troubleshooting / FAQ](./18-troubleshooting-faq.md)
