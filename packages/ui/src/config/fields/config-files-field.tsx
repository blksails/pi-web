/**
 * ConfigFilesField — 扩展独立配置文件控件(widget:"configFiles")。
 *
 * 编辑 `Record<文件名, 原始 JSON 内容>`(如 `proxy.json`)。每个文件:
 *  - 若内容含 `$schema`(https URL):**客户端**拉取该 JSON Schema → `jsonSchemaToFormSchema` → IR →
 *    用 `<SchemaForm>` 渲染**结构化表单**(对象数组/oneOf 经 ObjectListField/ObjectField);
 *  - 否则 / 拉取失败:回退**原始 JSON** 文本编辑(解析失败就地报错不回写)。
 * 拉取按 URL 模块级缓存。文件来自磁盘扫描,不支持增删。
 */
import * as React from "react";
import { jsonSchemaToFormSchema, type FormSchema } from "@blksails/pi-web-protocol";
import type { FieldProps, FieldRegistry } from "../field-registry.js";
import { SchemaForm } from "../schema-form.js";
import { Card } from "../../ui/card.js";
import { FieldShell } from "./field-shell.js";
import { useI18n } from "../../i18n/index.js";

function asFiles(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** 由内容的 `$schema` 尽力推导所属扩展(github(usercontent).com/owner/repo → owner/repo)。 */
function ownerFromSchema(content: unknown): string | undefined {
  if (typeof content !== "object" || content === null) return undefined;
  const s = (content as Record<string, unknown>)["$schema"];
  if (typeof s !== "string") return undefined;
  const m = s.match(/github(?:usercontent)?\.com\/([^/]+\/[^/]+)/);
  if (m?.[1] !== undefined) return m[1].replace(/\.git$/, "");
  try {
    return new URL(s).hostname;
  } catch {
    return undefined;
  }
}

function schemaUrlOf(content: unknown): string | undefined {
  if (typeof content !== "object" || content === null) return undefined;
  const s = (content as Record<string, unknown>)["$schema"];
  return typeof s === "string" && s.startsWith("https://") ? s : undefined;
}

// ── 客户端 schema 拉取(按 URL 缓存;null = 失败/不可用)──
const schemaCache = new Map<string, FormSchema | null>();
/** 测试注入点:覆盖拉取实现(默认 globalThis.fetch)。 */
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
export function __setSchemaFetchImpl(f: typeof fetch): void {
  fetchImpl = f;
}

async function loadFormSchema(url: string): Promise<FormSchema | null> {
  const cached = schemaCache.get(url);
  if (cached !== undefined) return cached;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: unknown = await res.json();
    const fs = jsonSchemaToFormSchema(json);
    schemaCache.set(url, fs);
    return fs;
  } catch {
    schemaCache.set(url, null);
    return null;
  }
}

function RawJsonEditor({
  content,
  onChange,
  disabled,
}: {
  readonly content: unknown;
  readonly onChange: (next: unknown) => void;
  readonly disabled?: boolean;
}): React.JSX.Element {
  const t = useI18n();
  const [text, setText] = React.useState<string>(() => JSON.stringify(content ?? {}, null, 2));
  const [error, setError] = React.useState<string | undefined>(undefined);
  return (
    <>
      <textarea
        value={text}
        spellCheck={false}
        disabled={disabled}
        rows={Math.min(20, Math.max(4, text.split("\n").length))}
        aria-invalid={error !== undefined}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          try {
            const parsed: unknown = v.trim().length === 0 ? {} : JSON.parse(v);
            setError(undefined);
            onChange(parsed);
          } catch {
            setError(t("config.configFiles.jsonError"));
          }
        }}
        className="w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] p-2 font-mono text-xs"
      />
      {error !== undefined ? (
        <p role="alert" className="text-xs text-[hsl(var(--destructive))]">
          {error}
        </p>
      ) : null}
    </>
  );
}

function FileEditor({
  name,
  content,
  onChange,
  disabled,
  registry,
  providedSchema,
}: {
  readonly name: string;
  readonly content: unknown;
  readonly onChange: (next: unknown) => void;
  readonly disabled?: boolean;
  readonly registry?: FieldRegistry;
  /** ①③ 服务端已解析的原始 JSON Schema(优先于内联 $schema,免远端拉取)。 */
  readonly providedSchema?: unknown;
}): React.JSX.Element {
  const t = useI18n();
  const owner = ownerFromSchema(content);
  // 服务端结果优先:同步转 IR,不发网络;此时不再走内联 $schema 远端路径。
  const provided = React.useMemo<FormSchema | undefined>(
    () => (providedSchema !== undefined ? jsonSchemaToFormSchema(providedSchema) : undefined),
    [providedSchema],
  );
  const url = provided !== undefined ? undefined : schemaUrlOf(content);
  // undefined = 加载中;null = 无 schema / 失败 → 原始 JSON;FormSchema = 结构化。
  const [fetched, setFetched] = React.useState<FormSchema | null | undefined>(
    url === undefined ? null : undefined,
  );

  React.useEffect(() => {
    if (url === undefined) {
      setFetched(null);
      return;
    }
    let alive = true;
    void loadFormSchema(url).then((fs) => {
      if (alive) setFetched(fs);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  const schema = provided ?? fetched;

  return (
    <Card className="flex flex-col gap-2 p-3" data-pi-config-file={name}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">{name}</span>
        {owner !== undefined ? (
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{owner}</span>
        ) : null}
      </div>
      {schema === undefined ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("config.configFiles.loadingSchema")}</p>
      ) : schema !== null ? (
        <SchemaForm
          formSchema={schema}
          values={asFiles(content)}
          onChange={(next) => onChange(next)}
          registry={registry}
          disabled={disabled}
        />
      ) : (
        <RawJsonEditor content={content} onChange={onChange} disabled={disabled} />
      )}
    </Card>
  );
}

export function ConfigFilesField({
  descriptor,
  value,
  onChange,
  disabled,
  registry,
  fileSchemas,
}: FieldProps): React.JSX.Element {
  const t = useI18n();
  const files = asFiles(value);
  const entries = Object.entries(files);

  return (
    <FieldShell descriptor={descriptor}>
      <div className="flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("config.configFiles.empty")}</p>
        ) : null}
        {entries.map(([name, content]) => (
          <FileEditor
            key={name}
            name={name}
            content={content}
            disabled={disabled}
            registry={registry}
            providedSchema={fileSchemas?.[name]}
            onChange={(next) => onChange({ ...files, [name]: next })}
          />
        ))}
      </div>
    </FieldShell>
  );
}
