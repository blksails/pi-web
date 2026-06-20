/**
 * ExtensionsKvField — per-扩展控件(widget:"extensionsKv")。
 *
 * 编辑 `Record<extId, { enabled, spec?, params }>`:
 *  - 每个「扩展条目」头部:**启用开关**(仅 package 条目即带 spec 者可切;关 → 回写时移入
 *    `disabledPackages[]`,可重新开启)+ 删除。
 *  - 「键值对」两级:每行可编辑 key/value,支持增删(绑定到 `params`)。
 * 新增条目为手动 KV(无 spec、恒启用)。值缺省视为空。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { Input } from "../../ui/input.js";
import { Button } from "../../ui/button.js";
import { Card } from "../../ui/card.js";
import { FieldShell } from "./field-shell.js";

type ExtEntry = {
  enabled: boolean;
  spec?: string;
  params: Record<string, string>;
};
type ExtMap = Record<string, ExtEntry>;

function asExtMap(value: unknown): ExtMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: ExtMap = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
    const entry = v as Record<string, unknown>;
    const rawParams = entry["params"];
    const params: Record<string, string> = {};
    if (typeof rawParams === "object" && rawParams !== null && !Array.isArray(rawParams)) {
      for (const [ik, iv] of Object.entries(rawParams as Record<string, unknown>)) {
        params[ik] = typeof iv === "string" ? iv : String(iv);
      }
    }
    out[k] = {
      enabled: entry["enabled"] !== false,
      ...(typeof entry["spec"] === "string" ? { spec: entry["spec"] } : {}),
      params,
    };
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

  const patchExt = (extId: string, patch: Partial<ExtEntry>): void =>
    onChange({ ...map, [extId]: { ...map[extId]!, ...patch } });
  const removeExt = (extId: string): void => {
    const next = { ...map };
    delete next[extId];
    onChange(next);
  };
  const addExt = (): void => {
    const id = newExt.trim();
    if (id.length === 0 || id in map) return;
    onChange({ ...map, [id]: { enabled: true, params: {} } });
    setNewExt("");
  };

  return (
    <FieldShell descriptor={descriptor}>
      <div className="flex flex-col gap-3">
        {exts.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">暂无扩展条目</p>
        ) : null}
        {exts.map(([extId, entry]) => (
          <Card
            key={extId}
            className="flex flex-col gap-3 p-3"
            data-pi-ext-entry={extId}
            data-pi-ext-enabled={entry.enabled}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{extId}</span>
              <div className="flex items-center gap-3">
                {entry.spec !== undefined ? (
                  <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      disabled={disabled}
                      data-pi-ext-toggle={extId}
                      onChange={(e) => patchExt(extId, { enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-[hsl(var(--input))]"
                    />
                    {entry.enabled ? "已启用" : "已禁用"}
                  </label>
                ) : null}
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
            </div>
            <KvEditor
              kv={entry.params}
              onChange={(next) => patchExt(extId, { params: next })}
              disabled={disabled}
            />
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
