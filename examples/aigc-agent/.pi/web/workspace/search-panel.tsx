// [迁移壳层] 源:aigc-agent components/search-panel.tsx。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
"use client";

import * as React from "react";
import { useSearchQuery } from "./lib/search-query-store.js";

/**
 * 以词搜图面板（原 `src/routes/search.tsx` 的正文，抽成可复用组件）。
 *
 * 两处消费：① 工作区模块 `search`（右栏，与对话并存）；② 路由 `/search`（薄壳）。
 * 从 `search-query-store` 接浮层（Cmd/Ctrl+K）派来的查询词并自动检索（Search-to-Tab）。
 *
 * 输入自然语言 → POST /api/creative-search(DashScope 多模态编码 + creative_vectors 相似检索)→
 * 瀑布结果,右上角标相似度%。空/未配 embedding → 友好提示。图走 payload.image_url(不进 base64)。
 */
interface Hit {
  id: string;
  similarity: number;
  payload: { image_url?: string; generation_params?: { name?: string } };
}

export function SearchPanel({
  headerSlot,
}: {
  /** 路由页用它挂「返回」；模块内不传。 */
  readonly headerSlot?: React.ReactNode;
}): React.JSX.Element {
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<Hit[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const external = useSearchQuery();

  const run = React.useCallback(async (term: string): Promise<void> => {
    if (term.trim() === "") return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/creative-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: term, limit: 40 }),
      });
      if (res.status === 503) {
        setErr("以词搜图未启用:需配置 DASHSCOPE_API_KEY(多模态 embedding)。");
        setHits([]);
        return;
      }
      const json = (await res.json()) as { items?: Hit[] };
      setHits(json.items ?? []);
    } catch {
      setErr("检索失败,请重试。");
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 浮层派词 → 回填输入框并立刻检索。seq 变化即视为一次新请求（同词连搜也重跑）。
  React.useEffect(() => {
    if (external.seq === 0 || external.query.trim() === "") return;
    setQ(external.query);
    void run(external.query);
  }, [external, run]);

  return (
    <div className="aigc-searchpanel" data-search-panel>
      <header>
        <h1>以词搜图</h1>
        <span className="sub">语义检索历史生成素材(向量相似度)</span>
        {headerSlot}
      </header>

      <div className="bar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run(q);
          }}
          placeholder="描述你要找的画面,如「赛博朋克 蓝色霓虹 居中构图」"
          data-search-input
        />
        <button
          type="button"
          disabled={loading || q.trim() === ""}
          onClick={() => void run(q)}
        >
          {loading ? "检索中…" : "搜索"}
        </button>
      </div>

      {err !== null ? <div className="note">{err}</div> : null}

      {hits !== null && err === null ? (
        hits.length === 0 ? (
          <div className="empty">无匹配素材(库中尚无向量,或未生成过素材)。</div>
        ) : (
          <div className="grid" data-search-results>
            {hits.map((h) => (
              <div key={h.id} className="cell">
                {typeof h.payload?.image_url === "string" ? (
                  <img
                    src={h.payload.image_url}
                    alt={h.payload.generation_params?.name ?? ""}
                    loading="lazy"
                  />
                ) : (
                  <div className="ph">无预览</div>
                )}
                <span className="pct">{Math.round(h.similarity * 100)}%</span>
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
