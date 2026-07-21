// [迁移壳层] 源:aigc-agent components/folder-picker-dialog.tsx。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Folder, Search, X } from "lucide-react";

interface FolderItem {
  readonly id: number;
  readonly name: string;
  readonly depth: number;
}

export function FolderPickerDialog({
  open,
  title,
  folders,
  excludeId,
  allowRoot,
  batchCount,
  busy,
  onPick,
  onClose,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly folders: ReadonlyArray<FolderItem>;
  readonly excludeId?: number;
  readonly allowRoot?: boolean;
  readonly batchCount?: number;
  readonly busy?: boolean;
  readonly onPick: (folderId: number | null) => void;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<number | null>(null);
  const [selectedRoot, setSelectedRoot] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected(null);
      setSelectedRoot(false);
    }
  }, [open]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    if (!open) return;
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const filtered = query.length > 0
    ? folders.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
    : folders;

  const canPick = selectedRoot || selected !== null;
  const pickLabel = batchCount !== undefined
    ? `移动 ${batchCount} 个素材到`
    : "移动到";

  return createPortal(
    <div
      className="aigc-folder-picker fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border shadow-xl"
        style={{
          background: "var(--surface)",
          borderColor: "var(--border)",
          boxShadow: "var(--shadow-panel, var(--shadow))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              border: "none",
              background: "none",
              color: "var(--ink-3)",
              cursor: "pointer",
              padding: 3,
              borderRadius: 6,
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="shrink-0 px-4 py-2">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "var(--surface-2)",
              padding: "4px 9px",
            }}
          >
            <Search size={13} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
            <input
              type="text"
              value={query}
              placeholder="搜索目录…"
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: "100%",
                border: "none",
                background: "none",
                color: "var(--ink)",
                fontSize: 12,
                outline: "none",
              }}
            />
          </div>
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto px-2 py-1">
          {allowRoot ? (
            <button
              type="button"
              onClick={() => {
                setSelectedRoot(true);
                setSelected(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                borderRadius: 7,
                fontSize: 12.5,
                color: selectedRoot ? "var(--accent)" : "var(--ink-2)",
                background: selectedRoot ? "var(--accent-soft)" : "none",
                border: "none",
                cursor: "pointer",
                fontWeight: selectedRoot ? 600 : 400,
              }}
            >
              <Folder size={14} />
              根目录（未分类）
            </button>
          ) : null}
          {filtered.length === 0 ? (
            <div
              style={{
                padding: 18,
                textAlign: "center",
                fontSize: 12,
                color: "var(--ink-3)",
              }}
            >
              {query.length > 0 ? "无匹配目录" : "暂无目录"}
            </div>
          ) : (
            filtered.map((f) => {
              if (f.id === excludeId) return null;
              const on = selected === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setSelected(f.id);
                    setSelectedRoot(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "7px 10px",
                    paddingLeft: 10 + f.depth * 14,
                    borderRadius: 7,
                    fontSize: 12.5,
                    color: on ? "var(--accent)" : "var(--ink-2)",
                    background: on ? "var(--accent-soft)" : "none",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  <Folder size={14} style={{ flex: "0 0 auto" }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.name}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div
          className="flex shrink-0 items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 13px",
              borderRadius: 7,
              fontSize: 12,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--ink-2)",
              cursor: "pointer",
            }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canPick || busy}
            onClick={() => onPick(selectedRoot ? null : selected)}
            style={{
              padding: "6px 13px",
              borderRadius: 7,
              fontSize: 12,
              border: "none",
              background: canPick && !busy ? "var(--accent)" : "var(--border)",
              color: canPick && !busy ? "var(--accent-ink)" : "var(--ink-3)",
              cursor: canPick && !busy ? "pointer" : "default",
              fontWeight: 600,
            }}
          >
            {busy ? "处理中…" : `${pickLabel} ${selectedRoot ? "根目录" : (folders.find((f) => f.id === selected)?.name ?? "")}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
