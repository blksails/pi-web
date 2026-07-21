// [迁移壳层] 源:aigc-agent components/distribute-dialog.tsx。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Check, AlertCircle } from "lucide-react";

/**
 * DistributeDialog — 素材分发弹层(③ app 壳 · C 分发 · 接 /api/material-distribute)。
 *
 * 素材库素材按 asset 维度(assetIds),素材目录素材按 material 维度(materialIds)直投,二选一。
 * 加载已授权广告主(GET ?advertisers=1)→ 多选(搜索/全选/清空)→ 可选妙思打标(仅 GDT)→
 * POST 分发,落 material_distribute_runs 台账。未配 WORKFLOW_API_URL 走 mock 网关(不触达平台)。
 * 精简对齐 pi-labs MaterialDistributeDialog(去掉 aigc 无数据源的 30 日消耗/审核门)。
 */
interface Advertiser {
  readonly id: number;
  readonly name: string | null;
  readonly platform: string;
  readonly status: string | null;
}

export function DistributeDialog({
  assetIds,
  materialIds,
  onClose,
  onSubmitted,
}: {
  readonly assetIds?: readonly string[];
  readonly materialIds?: readonly number[];
  readonly onClose: () => void;
  readonly onSubmitted?: () => void;
}): React.JSX.Element {
  const [ads, setAds] = React.useState<Advertiser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [sel, setSel] = React.useState<Set<number>>(new Set());
  const [query, setQuery] = React.useState("");
  const [distributeOn, setDistributeOn] = React.useState(true);
  const [museOn, setMuseOn] = React.useState(false);
  const [sim, setSim] = React.useState(3);
  const [style, setStyle] = React.useState<"PEOPLE" | "GAME">("PEOPLE");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; msg: string } | null>(
    null,
  );

  const count = assetIds?.length ?? materialIds?.length ?? 0;

  React.useEffect(() => {
    let alive = true;
    void (async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/material-distribute?advertisers=1");
        const json = (await res.json()) as {
          advertisers?: Advertiser[];
          error?: string;
        };
        if (!alive) return;
        if (json.error !== undefined) throw new Error(json.error);
        setAds(json.advertisers ?? []);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Esc 关闭。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = React.useMemo(() => {
    const terms = query
      .toLowerCase()
      .split(/[;,；，\s]+/)
      .filter(Boolean);
    if (terms.length === 0) return ads;
    return ads.filter((ad) => {
      const name = (ad.name ?? "").toLowerCase();
      const id = String(ad.id);
      return terms.some((t) => name.includes(t) || id.includes(t));
    });
  }, [ads, query]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((ad) => sel.has(ad.id));

  const toggle = (id: number): void =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hasNonGdt = React.useMemo(
    () => ads.some((ad) => sel.has(ad.id) && ad.platform !== "GDT"),
    [ads, sel],
  );

  const submit = async (): Promise<void> => {
    if (sel.size === 0) return;
    setSubmitting(true);
    setResult(null);
    const body: Record<string, unknown> = {
      ...(materialIds !== undefined
        ? { materialIds }
        : { assetIds: assetIds ?? [] }),
      advertiserIds: [...sel],
    };
    if (museOn) body.muse = { similarity: sim, img2img_style: style };
    try {
      const res = await fetch("/api/material-distribute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        status?: string;
        itemCount?: number;
        mock?: boolean;
        error?: string;
      };
      if (res.ok && json.status === "submitted") {
        setResult({
          ok: true,
          msg: `已提交分发 ${json.itemCount ?? 0} 条${json.mock ? "(mock 网关,未触达平台)" : ""}`,
        });
        onSubmitted?.();
      } else {
        setResult({
          ok: false,
          msg: json.error === "no_targets" ? "无可投放素材(已全部投过或类型不符)" : (json.error ?? "分发失败"),
        });
      }
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const combos = distributeOn ? count * sel.size : 0;

  return createPortal(
    <div
      className="aigc-dist-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="素材分发"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="aigc-dist" onClick={(e) => e.stopPropagation()}>
        <div className="aigc-dist-head">
          <span>素材分发 · {count} 个素材</span>
          <button type="button" className="x" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {result !== null ? (
          <div className={`aigc-dist-banner${result.ok ? " ok" : " err"}`}>
            {result.ok ? <Check size={14} /> : <AlertCircle size={14} />}
            <span>{result.msg}</span>
          </div>
        ) : null}

        <div className="aigc-dist-body">
          {loading ? (
            <div className="aigc-dist-center">
              <Loader2 className="spin" size={18} />
            </div>
          ) : error !== null ? (
            <div className="aigc-dist-banner err">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          ) : (
            <>
              <div className="aigc-dist-toggles">
                <Toggle label="投放到广告账户" checked={distributeOn} onChange={setDistributeOn} />
                <Toggle label="妙思打标(仅 GDT)" checked={museOn} onChange={setMuseOn} />
              </div>

              {distributeOn ? (
                <>
                  <div className="aigc-dist-selhead">
                    <span>
                      选择广告账户
                      {sel.size > 0 ? <em> · 已选 {sel.size}</em> : null}
                    </span>
                    {filtered.length > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSel((prev) => {
                            if (allVisibleSelected) return new Set();
                            const next = new Set(prev);
                            for (const ad of filtered) next.add(ad.id);
                            return next;
                          })
                        }
                      >
                        {allVisibleSelected ? "清空" : "全选"}
                      </button>
                    ) : null}
                  </div>
                  {ads.length > 0 ? (
                    <input
                      className="aigc-dist-search"
                      type="search"
                      value={query}
                      placeholder="搜索账户名/ID(支持多关键词,空格/逗号分隔)"
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  ) : null}
                  {ads.length === 0 ? (
                    <div className="aigc-dist-empty">
                      暂无已授权广告账户(需在平台侧授权后可分发)
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="aigc-dist-empty">无匹配账户</div>
                  ) : (
                    <div className="aigc-dist-grid">
                      {filtered.map((ad) => {
                        const on = sel.has(ad.id);
                        return (
                          <button
                            key={ad.id}
                            type="button"
                            className={`aigc-dist-card${on ? " on" : ""}`}
                            onClick={() => toggle(ad.id)}
                          >
                            <span className="nm">{ad.name ?? `账户 ${ad.id}`}</span>
                            <span className="pf">{ad.platform}</span>
                            <span className={`ck${on ? " on" : ""}`}>
                              {on ? <Check size={12} /> : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : null}

              {museOn ? (
                <div className="aigc-dist-muse">
                  <div className="row">
                    <label>相似度</label>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={sim}
                      onChange={(e) => setSim(Number(e.target.value))}
                    />
                    <span className="v">{sim}</span>
                  </div>
                  <div className="row">
                    <label>图生图风格</label>
                    <select
                      value={style}
                      onChange={(e) =>
                        setStyle(e.target.value as "PEOPLE" | "GAME")
                      }
                    >
                      <option value="PEOPLE">人物</option>
                      <option value="GAME">游戏</option>
                    </select>
                  </div>
                </div>
              ) : null}

              {distributeOn && sel.size > 0 ? (
                <div className="aigc-dist-count">
                  {count} 素材 × {sel.size} 账户 ={" "}
                  <strong>{combos}</strong> 条投放
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="aigc-dist-foot">
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="primary"
            disabled={
              submitting ||
              (!distributeOn && !museOn) ||
              sel.size === 0 ||
              (museOn && hasNonGdt)
            }
            title={museOn && hasNonGdt ? "妙思打标仅支持 GDT 账户" : undefined}
            onClick={() => void submit()}
          >
            {submitting ? <Loader2 className="spin" size={13} /> : null}
            {submitting ? "提交中…" : "分发"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (v: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`aigc-dist-toggle${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
      {label}
    </button>
  );
}
