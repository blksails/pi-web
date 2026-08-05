import * as React from "react";
import { createRoot } from "react-dom/client";
import { ImagePlus, Layers3, Search, X } from "lucide-react";
import { PaneGuestProvider, usePaneGuest } from "@blksails/pi-web-panes-kit/react";
import { installSearchPaneStyles } from "./styles.js";

type ResultKind = "image" | "cluster";
type Filter = "all" | ResultKind;

interface Hit {
  readonly id: string;
  readonly resultKind?: ResultKind;
  readonly similarity: number;
  readonly name?: string;
  readonly imageUrl?: string;
  readonly size?: number;
  readonly payload?: {
    readonly image_url?: string;
    readonly generation_params?: { readonly name?: string };
  };
}

function unwrapItems(raw: unknown): { items: Hit[]; error?: string } {
  const outer = (raw ?? {}) as { items?: unknown; error?: unknown; data?: unknown };
  const value =
    Array.isArray(outer.items) || typeof outer.error === "string"
      ? outer
      : ((outer.data ?? {}) as { items?: unknown; error?: unknown });
  return {
    items: Array.isArray(value.items) ? value.items as Hit[] : [],
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

const kindOf = (hit: Hit): ResultKind =>
  hit.resultKind === "cluster" ? "cluster" : "image";
const urlOf = (hit: Hit): string =>
  hit.imageUrl ?? hit.payload?.image_url ?? "";
const nameOf = (hit: Hit): string =>
  hit.name ?? hit.payload?.generation_params?.name ?? hit.id;

export function SearchApp(): React.JSX.Element {
  const guest = usePaneGuest();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");
  const [image, setImage] =
    React.useState<{ readonly dataUri: string; readonly name: string }>();
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [phase, setPhase] =
    React.useState<"idle" | "busy" | "empty" | "done" | "error">("idle");
  const [message, setMessage] = React.useState("");
  const [preview, setPreview] = React.useState<Hit>();

  const takeImage = (file: File | undefined): void => {
    if (file === undefined || !file.type.startsWith("image/")) return;
    if (file.size > 15 * 1024 * 1024) {
      setMessage("图片须小于 15MB");
      setPhase("error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage({ dataUri: String(reader.result), name: file.name || "粘贴图片" });
      setPhase("idle");
    };
    reader.readAsDataURL(file);
  };

  const search = async (): Promise<void> => {
    const text = query.trim();
    if ((text === "" && image === undefined) || phase === "busy") return;
    setPhase("busy");
    setMessage("");
    try {
      const result = unwrapItems(await guest.mutate("creative-search", {
        ...(image !== undefined
          ? { imageDataUri: image.dataUri }
          : { query: text }),
        limit: 60,
      }));
      if (result.error !== undefined) {
        const hint =
          result.error === "platform_unavailable"
            ? "搜图服务不可用：请确认桌面已登录且 webapp（PI_LABS_WEBAPP_URL）可达"
            : result.error === "invalid_body"
              ? "请输入描述或上传一张图"
              : result.error === "embedding_unavailable"
                ? "向量服务未配置（DASHSCOPE 等），无法检索"
                : result.error;
        throw new Error(hint);
      }
      setHits(result.items);
      setFilter("all");
      setPhase(result.items.length > 0 ? "done" : "empty");
      if (result.items.length === 0) {
        setMessage(image !== undefined ? "未找到相近图片" : "未找到匹配结果");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setPhase("error");
    }
  };

  const visible = hits.filter((hit) => filter === "all" || kindOf(hit) === filter);
  return (
    <div
      className="pane-layout"
      data-search-pane
      onPaste={(event) => {
        const item = [...event.clipboardData.items]
          .find((candidate) => candidate.type.startsWith("image/"));
        if (item !== undefined) {
          event.preventDefault();
          takeImage(item.getAsFile() ?? undefined);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        takeImage([...event.dataTransfer.files]
          .find((candidate) => candidate.type.startsWith("image/")));
      }}
    >
      <header className="toolbar pane-header">
        <label className="search-field grow">
          <Search size={15} aria-hidden />
          {image !== undefined ? (
            <span className="image-query">
              <img src={image.dataUri} alt="" />
              <span>{image.name}</span>
              <button type="button" aria-label="移除搜索图片" onClick={() => setImage(undefined)}>
                <X size={13} aria-hidden />
              </button>
            </span>
          ) : (
            <input
              placeholder="输入描述，或拖入/粘贴图片搜图…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void search();
              }}
            />
          )}
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            takeImage(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          className="icon-button"
          aria-label="上传图片以图搜图"
          title="上传图片以图搜图"
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="icon-button primary"
          aria-label="搜索"
          disabled={phase === "busy"}
          onClick={() => void search()}
        >
          <Search size={16} aria-hidden className={phase === "busy" ? "spin" : undefined} />
        </button>
      </header>
      {hits.length > 0 ? (
        <nav className="result-filters" aria-label="搜索结果类型">
          {([
            ["all", "全部"],
            ["image", "图片卡片"],
            ["cluster", "聚类卡片"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "on" : ""}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
          <span>{visible.length} 项 · 按接近度</span>
        </nav>
      ) : null}
      <main className="content scroll">
        {phase === "idle" ? <div className="empty">支持以词搜图、以图搜图</div> : null}
        {phase === "empty" ? <div className="empty">无匹配素材</div> : null}
        {phase === "error" ? <div className="empty error">{message}</div> : null}
        <div className="grid" data-search-results>
          {visible.map((hit) => {
            const kind = kindOf(hit);
            const url = urlOf(hit);
            return (
              <figure key={hit.id} className={`card ${kind}`} data-result-kind={kind}>
                <button
                  type="button"
                  className="preview-button"
                  disabled={url === ""}
                  onClick={() => setPreview(hit)}
                >
                  {url !== "" ? <img src={url} alt={nameOf(hit)} loading="lazy" /> : <span className="noimg">无预览</span>}
                  {kind === "cluster" ? (
                    <span className="cluster-count"><Layers3 size={12} aria-hidden />{hit.size ?? 0} 张</span>
                  ) : null}
                </button>
                <figcaption>
                  <span className="badge">{Math.round(hit.similarity * 100)}%</span>
                  <span className="name">{nameOf(hit)}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </main>
      {preview !== undefined ? (
        <div className="preview-dialog" role="dialog" aria-label="搜索图片预览" onClick={() => setPreview(undefined)}>
          <img src={urlOf(preview)} alt={nameOf(preview)} />
          <button type="button" aria-label="关闭预览" onClick={() => setPreview(undefined)}><X size={18} /></button>
        </div>
      ) : null}
    </div>
  );
}

installSearchPaneStyles();
const rootEl = document.getElementById("root");
if (rootEl !== null) {
  createRoot(rootEl).render(
    <PaneGuestProvider paneId="search">
      <SearchApp />
    </PaneGuestProvider>,
  );
}
