/**
 * ExtensionsKvField — per-扩展 KV 控件(widget:"extensionsKv")。
 *
 * 编辑 `Record<extId, Record<string,string>>`:两级动态增删——
 *  - 外层「扩展条目」:key=扩展 id(新增经输入框;条目 id 创建后只读,改名=删后重加)。
 *  - 内层「键值对」:每行可编辑 key/value,支持增删。
 * 值缺省视为 `{}`。内层经 entries 重建对象(重复键以末值为准,空键允许其一)。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { Input } from "../../ui/input.js";
import { Button } from "../../ui/button.js";
import { Card } from "../../ui/card.js";
import { FieldShell } from "./field-shell.js";

type ExtMap = Record<string, Record<string, string>>;

function asExtMap(value: unknown): ExtMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: ExtMap = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const kv: Record<string, string> = {};
      for (const [ik, iv] of Object.entries(v as Record<string, unknown>)) {
        kv[ik] = typeof iv === "string" ? iv : String(iv);
      }
      out[k] = kv;
    }
  }
  return out;
}

function KvEditor({
  kv,
  onChange,
  disabled,
}: {
  readonly kv: Record<string, string>;
  readonly onChange: (next: Record<string, string>) => void;
  readonly disabled?: boolean;
}): React.JSX.Element {
  const entries = Object.entries(kv);
  const commit = (next: [string, string][]): void => onChange(Object.fromEntries(next));
  return (
    <div className="flex flex-col gap-2">
      {entries.length === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">暂无键值</p>
      ) : null}
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2" data-pi-kv-row={i}>
          <Input
            type="text"
            value={k}
            placeholder="键(如 HTTP_PROXY)"
            disabled={disabled}
            onChange={(e) => {
              const next = entries.slice();
              next[i] = [e.target.value, v];
              commit(next);
            }}
          />
          <Input
            type="text"
            value={v}
            placeholder="值"
            disabled={disabled}
            onChange={(e) => {
              const next = entries.slice();
              next[i] = [k, e.target.value];
              commit(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => commit(entries.filter((_, idx) => idx !== i))}
          >
            删
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => commit([...entries, ["", ""]])}
        >
          + 键值
        </Button>
      </div>
    </div>
  );
}

export function ExtensionsKvField({
  descriptor,
  value,
  onChange,
  disabled,
}: FieldProps): React.JSX.Element {
  const map = asExtMap(value);
  const exts = Object.entries(map);
  const [newExt, setNewExt] = React.useState("");

  const setExt = (extId: string, kv: Record<string, string>): void =>
    onChange({ ...map, [extId]: kv });
  const removeExt = (extId: string): void => {
    const next = { ...map };
    delete next[extId];
    onChange(next);
  };
  const addExt = (): void => {
    const id = newExt.trim();
    if (id.length === 0 || id in map) return;
    onChange({ ...map, [id]: {} });
    setNewExt("");
  };

  return (
    <FieldShell descriptor={descriptor}>
      <div className="flex flex-col gap-3">
        {exts.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">暂无扩展条目</p>
        ) : null}
        {exts.map(([extId, kv]) => (
          <Card key={extId} className="flex flex-col gap-3 p-3" data-pi-ext-entry={extId}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{extId}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => removeExt(extId)}
              >
                删除
              </Button>
            </div>
            <KvEditor kv={kv} onChange={(next) => setExt(extId, next)} disabled={disabled} />
          </Card>
        ))}
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={newExt}
            placeholder="新增扩展条目(如 @alexgorbatchev/pi-env)"
            disabled={disabled}
            onChange={(e) => setNewExt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addExt();
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={addExt}>
            添加扩展条目
          </Button>
        </div>
      </div>
    </FieldShell>
  );
}
